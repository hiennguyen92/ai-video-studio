import type { Clip } from './timeline-track-types'
import type { SubtitleCue } from './subtitle-types'
import type { Transcript, Translation } from './transcript-types'
import type { Micros } from './time-units'

/**
 * Dựng cue phụ đề từ transcript (và bản dịch nếu có).
 *
 * Đây là chỗ đổi HỆ TOẠ ĐỘ, và là lý do module này tồn tại riêng:
 *
 *   - transcript ghi mốc thời gian theo ASSET (giây thứ mấy trong file gốc)
 *   - phụ đề cần mốc theo TIMELINE (giây thứ mấy trong video xuất ra)
 *
 * Ba hệ quả không hiển nhiên, đều được xử lý ở đây:
 *
 *   1. Clip bị cắt bớt thì đoạn nằm ngoài phần còn lại KHÔNG được lên phụ đề —
 *      lời đó đã bị cắt khỏi video, hiện chữ ra là sai.
 *   2. Đoạn chớm mép clip bị cắt cụt theo đúng phần còn nhìn thấy.
 *   3. Một asset dùng lại ở nhiều clip thì một đoạn sinh ra NHIỀU cue, mỗi clip
 *      một cue. Bỏ qua chuyện này thì cảnh lặp lại sẽ mất phụ đề.
 *
 * Tốc độ phát của clip cũng được tính vào: clip chạy 2x thì lời thoại trôi nhanh
 * gấp đôi trên timeline.
 */

export interface BuildSubtitleCuesInput {
  transcript: Transcript
  /** Có thì dùng làm dòng chính; transcript thành dòng phụ khi bật song ngữ. */
  translation?: Translation
  /** Mọi clip của dự án; chỉ clip dùng đúng asset của transcript được xét. */
  clips: Clip[]
  /** Hiện cả hai ngôn ngữ trên một cue (DESCRIPTION §3.F). */
  bilingual: boolean
  makeId(): string
}

/** Khoảng thời gian trong asset mà clip thật sự hiển thị. */
function sourceRangeOf(clip: Clip): { fromUs: Micros; toUs: Micros } {
  // durationUs đo trên timeline; nhân tốc độ để ra độ dài tương ứng trong asset.
  return {
    fromUs: clip.sourceInUs,
    toUs: clip.sourceInUs + Math.round(clip.durationUs * clip.speed)
  }
}

/** Đổi một mốc trong asset sang mốc trên timeline theo một clip cụ thể. */
function toTimelineUs(clip: Clip, assetUs: Micros): Micros {
  return clip.startUs + Math.round((assetUs - clip.sourceInUs) / clip.speed)
}

export function buildSubtitleCues(input: BuildSubtitleCuesInput): SubtitleCue[] {
  const { transcript, translation, clips, bilingual, makeId } = input

  const translatedBySource = new Map(
    (translation?.segments ?? []).map((segment) => [segment.sourceSegmentId, segment.text])
  )

  // Chỉ những clip đang phát chính asset đã phiên âm.
  const relevantClips = clips.filter((clip) => clip.assetId === transcript.assetId)
  const cues: SubtitleCue[] = []

  for (const clip of relevantClips) {
    const range = sourceRangeOf(clip)

    for (const segment of transcript.segments) {
      // Cắt đoạn theo phần asset mà clip còn giữ lại.
      const fromUs = Math.max(segment.startUs, range.fromUs)
      const toUs = Math.min(segment.endUs, range.toUs)
      // Không giao nhau, hoặc chỉ chạm đúng một điểm: không có gì để hiện.
      if (toUs <= fromUs) continue

      const translated = translatedBySource.get(segment.id)
      const primary = translated ?? segment.text
      // Song ngữ: dòng dưới là bản gốc. Không có bản dịch thì không có dòng hai —
      // lặp lại cùng một câu hai lần chỉ tổ che mất hình.
      const secondary = bilingual && translated ? segment.text : undefined

      if (!primary.trim()) continue

      cues.push({
        id: makeId(),
        startUs: toTimelineUs(clip, fromUs),
        endUs: toTimelineUs(clip, toUs),
        text: primary,
        textSecondary: secondary,
        sourceSegmentId: segment.id,
        edited: false
      })
    }
  }

  // Xếp theo thời gian trình chiếu; clip có thể nằm lộn xộn trên timeline.
  return cues.sort((left, right) => left.startUs - right.startUs)
}

/**
 * Tìm những cue chồng thời gian lên nhau.
 *
 * Xảy ra thật khi hai clip cùng phát một asset ở hai lane khác nhau, hoặc khi
 * người dùng sửa tay mốc thời gian. Chỉ báo chứ không tự sửa: gộp hay bỏ bớt là
 * quyết định về nội dung, không phải chuyện máy tự làm được.
 */
export function findOverlappingCues(cues: SubtitleCue[]): Array<[string, string]> {
  const sorted = [...cues].sort((left, right) => left.startUs - right.startUs)
  const overlaps: Array<[string, string]> = []

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (current.startUs < previous.endUs) overlaps.push([previous.id, current.id])
  }
  return overlaps
}
