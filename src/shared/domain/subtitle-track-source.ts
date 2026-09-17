import type { ProjectDocument } from './project-document-types'
import { buildSubtitleCues } from './subtitle-cue-builder'
import type { SubtitleCue, SubtitleTrack } from './subtitle-types'

/**
 * Dựng lại cue cho một track phụ đề TỪ CHÍNH NGUỒN của track đó (bản phiên âm hay
 * bản dịch đã tạo ra nó), không phải từ nguồn đang chọn trong ô tạo mới — dựng lại
 * track tiếng Anh mà lại lấy bản dịch tiếng Việt đang chọn ở form là thay nhầm
 * toàn bộ lời.
 *
 * Trả `null` khi nguồn không còn (đã xoá) hoặc track không dựng từ nguồn nào, hoặc
 * chưa có clip nào dùng asset đã phiên âm — không có mốc timeline để gắn cue.
 */
export function rebuildTrackCues(
  document: ProjectDocument,
  track: SubtitleTrack,
  makeId: () => string
): SubtitleCue[] | null {
  const { kind, refId } = track.source
  const translation =
    kind === 'translation' ? document.translations.find((item) => item.id === refId) : undefined
  const transcriptId = kind === 'transcript' ? refId : translation?.transcriptId
  const transcript = document.transcripts.find((item) => item.id === transcriptId)
  if (!transcript || (kind === 'translation' && !translation)) return null

  const clips = document.tracks.flatMap((item) => item.clips)
  if (!clips.some((clip) => clip.assetId === transcript.assetId)) return null

  return buildSubtitleCues({
    transcript,
    translation,
    clips,
    bilingual: Boolean(translation && track.secondaryLanguage),
    makeId
  })
}
