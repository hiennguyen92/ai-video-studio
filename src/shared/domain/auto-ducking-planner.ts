import type { EditorCommand } from '../commands/editor-command-types'
import type { ProjectDocument } from './project-document-types'
import { clipEndUs } from './timeline-track-types'
import type { Micros } from './time-units'
import { buildDuckEnvelope, envelopeKeyframesForClip } from './auto-ducking-volume-envelope'

/**
 * Tự động giảm nhạc nền ở những đoạn có lời nói (DESCRIPTION §3, §5).
 *
 * Mỗi clip nhạc nhận một đường keyframe `volume`: dốc xuống trước câu nói, giữ
 * mức thấp suốt câu, dốc lên sau khi dứt lời. Clip KHÔNG bị cắt — cắt thành mảnh
 * với mức tĩnh từng mảnh là cách cũ, và nó nghe ra bậc thang.
 *
 * Không dùng fadeIn/fadeOut để làm dốc: chúng luôn ramp từ/về IM LẶNG, dùng vào
 * đây nhạc sẽ tụt hẳn xuống 0 rồi mới lên lại.
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
  /** Độ dài mỗi đoạn dốc, nằm ngoài phần nới. Kẹp tối thiểu `MIN_DUCK_RAMP_US`. */
  rampUs: Micros
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

export interface AutoDuckingPlan {
  commands: EditorCommand[]
  /** Số clip nhạc bị hạ âm lượng — dùng để báo lại cho người dùng. */
  duckedClips: number
  /** Không có lời nói nào thì không có gì để làm. */
  speechIntervals: Interval[]
}

/**
 * Dựng kế hoạch giảm nhạc.
 *
 * Ghi đè TOÀN BỘ đường keyframe âm lượng và đặt mức nền TUYỆT ĐỐI cho mọi clip
 * trên track nhạc, thay vì nhân vào thứ sẵn có. Nhờ vậy chạy lại lần hai cho ra
 * đúng kết quả lần một, và chạy lại sau khi dời lời nói thì đường cũ không nằm
 * lại chồng lên đường mới.
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
    return { commands: [], duckedClips: 0, speechIntervals }
  }

  const envelope = buildDuckEnvelope(
    speechIntervals,
    options.rampUs,
    options.duckVolume,
    options.baseVolume
  )
  const commands: EditorCommand[] = []
  let duckedClips = 0

  for (const track of document.tracks) {
    if (!options.musicTrackIds.includes(track.id)) continue

    for (const clip of track.clips) {
      const keyframes = envelopeKeyframesForClip(
        envelope,
        clip.startUs,
        clipEndUs(clip),
        options.baseVolume
      )
      if (keyframes) duckedClips += 1

      // Mức tĩnh cũng đặt về nền: xoá tay đường keyframe sau này thì clip trở về
      // mức bình thường chứ không về một con số cũ nào đó.
      commands.push({ type: 'clip/update', clipId: clip.id, patch: { volume: options.baseVolume } })
      // Đường rỗng xoá hẳn khoá — chỉ gửi khi clip đang có đường để xoá.
      if (keyframes || clip.keyframes?.['volume']) {
        commands.push({
          type: 'keyframe/set-tracks',
          target: { kind: 'clip', clipId: clip.id },
          tracks: { volume: keyframes ?? [] }
        })
      }
    }
  }

  return { commands, duckedClips, speechIntervals }
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
