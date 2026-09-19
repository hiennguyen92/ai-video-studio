import type { ProjectDocument } from './project-document-types'
import type { SubtitleCue, SubtitleTrack } from './subtitle-types'
import type { Micros } from './time-units'

/**
 * Câu phụ đề khi cắt bỏ khoảng `[fromUs, toUs)` và dồn phần sau lên.
 *
 * Cùng phép quy đổi thời gian với chữ overlay: trước khoảng giữ nguyên, trong
 * khoảng dồn về `fromUs`, sau khoảng lùi đúng độ dài khoảng. Câu nằm trọn trong
 * khoảng thì mất theo.
 *
 * Trước đây câu VẮT QUA mép khoảng không được co cũng không được dời: xuất một
 * đoạn 10 s mà có câu vắt qua mép đầu thì câu đó giữ nguyên giờ cũ, và vì thời
 * lượng dự án tính cả phụ đề, file ra dài 13 s với ba giây cuối đen kịt.
 */
export function rippleSubtitleCues(
  cues: readonly SubtitleCue[],
  fromUs: Micros,
  toUs: Micros
): SubtitleCue[] {
  const span = toUs - fromUs
  const remap = (atUs: Micros): Micros =>
    atUs <= fromUs ? atUs : atUs >= toUs ? atUs - span : fromUs

  const result: SubtitleCue[] = []
  for (const cue of cues) {
    const startUs = remap(cue.startUs)
    const endUs = remap(cue.endUs)
    // Nằm trọn trong khoảng, hoặc co còn không gì.
    if (endUs <= startUs) continue
    if (startUs === cue.startUs && endUs === cue.endUs) {
      result.push(cue)
      continue
    }
    // Mốc chữ đi qua cùng phép quy đổi: chữ bị cắt mất dồn về mép cắt, chữ sau
    // khoảng lùi theo — lời còn lại vẫn sáng đúng lúc được nói.
    const words = cue.words?.map((word) => ({
      ...word,
      startUs: remap(word.startUs),
      endUs: remap(word.endUs)
    }))
    result.push({ ...cue, startUs, endUs, ...(words ? { words } : {}) })
  }
  return result
}

/**
 * Câu phụ đề khi CHÈN `durationUs` vào tại `atUs` (đứng hình): câu từ mốc đó trở đi
 * lùi sau; câu đang hiện đúng lúc đứng hình thì kéo dài qua đoạn đứng hình — lời
 * nói tạm dừng, câu vẫn nằm trên màn hình, không biến mất rồi hiện lại.
 */
export function insertIntoSubtitleCues(
  cues: readonly SubtitleCue[],
  atUs: Micros,
  durationUs: Micros
): SubtitleCue[] {
  return cues.map((cue) => {
    const words = cue.words?.map((word) =>
      word.startUs >= atUs
        ? { ...word, startUs: word.startUs + durationUs, endUs: word.endUs + durationUs }
        : word
    )
    if (cue.startUs >= atUs) {
      return {
        ...cue,
        startUs: cue.startUs + durationUs,
        endUs: cue.endUs + durationUs,
        ...(words ? { words } : {})
      }
    }
    if (cue.endUs > atUs)
      return { ...cue, endUs: cue.endUs + durationUs, ...(words ? { words } : {}) }
    return cue
  })
}

/** Lane mang lời nói: lane hình (clip quay có tiếng người) và lane tiếng thoại / lồng tiếng. */
function isSpeechLane(track: ProjectDocument['tracks'][number]): boolean {
  return (
    track.kind === 'video' ||
    (track.kind === 'audio' && (track.role === 'dialogue' || track.role === 'voiceover'))
  )
}

/** File nguồn mà một track phụ đề được phiên âm ra, nếu lần ngược được. */
function sourceAssetId(document: ProjectDocument, track: SubtitleTrack): string | undefined {
  const refId = track.source.refId
  if (!refId) return undefined
  const transcriptId =
    track.source.kind === 'translation'
      ? document.translations.find((item) => item.id === refId)?.transcriptId
      : track.source.kind === 'transcript'
        ? refId
        : undefined
  return document.transcripts.find((item) => item.id === transcriptId)?.assetId
}

/**
 * Track phụ đề nào đi theo khi chỉ vài lane bị cắt (ripple xoá clip, cắt khoảng
 * lặng theo lane, chèn đứng hình).
 *
 * Phụ đề đi theo LỜI NÓI mà nó ghi lại: phiên âm từ file nào thì đi theo lane chứa
 * clip của file đó. Phụ đề nhập tay hay nhập từ file không lần ngược được nguồn —
 * chúng đi theo khi lane bị cắt là lane lời nói, vì gần như luôn là phụ đề của lời
 * nói đó. Lane nhạc, hiệu ứng âm thanh bị cắt thì phụ đề đứng yên.
 */
export function subtitleTracksFollowingLanes(
  document: ProjectDocument,
  laneIds: readonly string[]
): SubtitleTrack[] {
  const lanes = document.tracks.filter((track) => laneIds.includes(track.id))
  const assetsOnLanes = new Set(lanes.flatMap((track) => track.clips.map((clip) => clip.assetId)))
  const cutsSpeech = lanes.some(isSpeechLane)

  return document.subtitleTracks.filter((track) => {
    const assetId = sourceAssetId(document, track)
    return assetId ? assetsOnLanes.has(assetId) : cutsSpeech
  })
}
