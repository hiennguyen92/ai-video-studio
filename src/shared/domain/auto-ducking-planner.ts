import type { EditorCommand } from '../commands/editor-command-types'
import type { ProjectDocument } from './project-document-types'
import { clipEndUs } from './timeline-track-types'
import type { Micros } from './time-units'

/**
 * Tự động giảm nhạc nền ở những đoạn có lời nói (DESCRIPTION §3, §5).
 *
 * Mô hình dữ liệu chỉ có âm lượng theo TỪNG CLIP, không có đường automation theo
 * thời gian. Nên cách làm ở đây là: cắt clip nhạc tại ranh giới lời nói rồi đặt
 * âm lượng thấp cho những mảnh nằm trong vùng có tiếng.
 *
 * Hệ quả phải nói thẳng: chuyển mức là BẬC THANG, không phải dốc mượt. Không thể
 * dùng fadeIn/fadeOut để làm dốc, vì chúng luôn ramp từ/về IM LẶNG — dùng vào đây
 * nhạc sẽ tụt hẳn xuống 0 rồi mới lên lại, nghe tệ hơn hẳn một bậc nhảy. Muốn dốc
 * thật thì phải thêm automation vào mô hình clip, không phải mẹo với fade.
 *
 * Kế hoạch trả về là danh sách lệnh đã có sẵn của trình sửa, nên AI Chat gọi được
 * mà không cần đường ghi riêng nào vào project.
 */

export interface AutoDuckingOptions {
  /** Track nhạc sẽ bị giảm. */
  musicTrackIds: string[]
  /** Track chứa lời nói dùng làm căn cứ. */
  speechTrackIds: string[]
  /** Âm lượng nhạc khi ĐANG có lời nói. */
  duckVolume: number
  /** Âm lượng nhạc khi không có lời nói. */
  baseVolume: number
  /**
   * Nới vùng giảm ra hai đầu.
   *
   * Không có phần nới này thì nhạc trở lại to đúng lúc câu nói vừa dứt, nghe như
   * bị giật; và chữ đầu câu dễ bị nhạc át.
   */
  paddingUs: Micros
  makeId(): string
}

export interface Interval {
  startUs: Micros
  endUs: Micros
}

/** Gộp các khoảng chồng nhau hoặc chạm nhau thành một. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((interval) => interval.endUs > interval.startUs)
    .sort((left, right) => left.startUs - right.startUs)

  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged.at(-1)
    if (last && interval.startUs <= last.endUs) {
      last.endUs = Math.max(last.endUs, interval.endUs)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

/** Khoảng có lời nói, lấy từ clip trên các track được chỉ định. */
export function collectSpeechIntervals(
  document: ProjectDocument,
  speechTrackIds: string[],
  paddingUs: Micros
): Interval[] {
  const raw: Interval[] = []

  for (const track of document.tracks) {
    if (!speechTrackIds.includes(track.id)) continue
    // Track đang tắt tiếng thì không có lời nào để tránh.
    if (track.muted) continue

    for (const clip of track.clips) {
      raw.push({
        startUs: Math.max(0, clip.startUs - paddingUs),
        endUs: clipEndUs(clip) + paddingUs
      })
    }
  }

  return mergeIntervals(raw)
}

function overlaps(clipStart: Micros, clipEnd: Micros, interval: Interval): boolean {
  return interval.startUs < clipEnd && interval.endUs > clipStart
}

export interface AutoDuckingPlan {
  commands: EditorCommand[]
  /** Số mảnh nhạc bị hạ âm lượng — dùng để báo lại cho người dùng. */
  duckedPieces: number
  /** Không có lời nói nào thì không có gì để làm. */
  speechIntervals: Interval[]
}

/**
 * Dựng kế hoạch giảm nhạc.
 *
 * Đặt âm lượng TUYỆT ĐỐI cho cả mảnh bị giảm lẫn mảnh không bị giảm, thay vì nhân
 * vào âm lượng sẵn có. Nhờ vậy chạy lại lần hai cho ra đúng kết quả lần một; nhân
 * dồn sẽ khiến mỗi lần chạy lại làm nhạc nhỏ dần đi mà không ai hiểu vì sao.
 */
export function planAutoDucking(
  document: ProjectDocument,
  options: AutoDuckingOptions
): AutoDuckingPlan {
  const speechIntervals = collectSpeechIntervals(
    document,
    options.speechTrackIds,
    options.paddingUs
  )
  if (speechIntervals.length === 0) {
    return { commands: [], duckedPieces: 0, speechIntervals }
  }

  const commands: EditorCommand[] = []
  let duckedPieces = 0

  for (const track of document.tracks) {
    if (!options.musicTrackIds.includes(track.id)) continue

    for (const clip of track.clips) {
      const startUs = clip.startUs
      const endUs = clipEndUs(clip)

      // Mọi ranh giới lời nói rơi vào GIỮA clip đều là một điểm cắt.
      const cutPoints = [
        ...new Set(
          speechIntervals
            .flatMap((interval) => [interval.startUs, interval.endUs])
            .filter((point) => point > startUs && point < endUs)
        )
      ].sort((left, right) => left - right)

      // Mỗi lần cắt sinh ra một mảnh mới; id được cấp trước để lệnh sau tham
      // chiếu được vào mảnh do lệnh trước tạo ra.
      const pieces: Array<{ id: string; startUs: Micros; endUs: Micros }> = []
      let currentId = clip.id
      let currentStart = startUs

      for (const point of cutPoints) {
        const newId = options.makeId()
        commands.push({ type: 'clip/split', clipId: currentId, atUs: point, newClipId: newId })
        pieces.push({ id: currentId, startUs: currentStart, endUs: point })
        currentId = newId
        currentStart = point
      }
      pieces.push({ id: currentId, startUs: currentStart, endUs })

      for (const piece of pieces) {
        const ducked = speechIntervals.some((interval) =>
          overlaps(piece.startUs, piece.endUs, interval)
        )
        if (ducked) duckedPieces += 1

        commands.push({
          type: 'clip/update',
          clipId: piece.id,
          patch: { volume: ducked ? options.duckVolume : options.baseVolume }
        })
      }
    }
  }

  return { commands, duckedPieces, speechIntervals }
}

/** Track nhạc và track lời nói mà tính năng này nhắm tới, suy từ vai trò của track. */
export function guessDuckingTracks(document: ProjectDocument): {
  musicTrackIds: string[]
  speechTrackIds: string[]
} {
  const musicTrackIds: string[] = []
  const speechTrackIds: string[] = []

  for (const track of document.tracks) {
    if (track.kind !== 'audio') continue
    if (track.role === 'music' || track.role === 'sfx') musicTrackIds.push(track.id)
    // Lời thoại gốc và lồng tiếng đều được coi là "có người nói".
    if (track.role === 'voiceover' || track.role === 'dialogue') speechTrackIds.push(track.id)
  }

  return { musicTrackIds, speechTrackIds }
}

/** Clip nào là clip nhạc — dùng khi cần kiểm tra nhanh trước khi chạy. */
export function hasMusicAndSpeech(document: ProjectDocument): boolean {
  const { musicTrackIds, speechTrackIds } = guessDuckingTracks(document)
  const hasMusic = document.tracks.some(
    (track) => musicTrackIds.includes(track.id) && track.clips.length > 0
  )
  const hasSpeech = document.tracks.some(
    (track) => speechTrackIds.includes(track.id) && track.clips.length > 0
  )
  return hasMusic && hasSpeech
}
