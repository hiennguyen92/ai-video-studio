import type { EditorCommand } from '../commands/editor-command-types'
import { expandToLinkGroups } from './clip-link-groups'
import type { MediaAsset } from './media-asset-types'
import type { ProjectDocument } from './project-document-types'
import { clipEndUs, type Clip, type Track } from './timeline-track-types'

/**
 * Đưa giọng đã làm sạch lên timeline.
 *
 * Ba trường hợp:
 *
 * - `swap-audio`: clip nằm trên lane TIẾNG — thay asset tại chỗ, giữ nguyên id,
 *   vị trí, âm lượng, fade, keyframe.
 * - `add-partner`: clip HÌNH mang tiếng của chính nó — thêm một clip tiếng sạch
 *   cùng khoảng trên lane lời thoại, tắt tiếng clip hình, gộp hai clip vào một
 *   nhóm để dời hay xoá cũng đi cùng nhau.
 * - `swap-partner`: clip hình đã có clip tiếng sạch trong nhóm (làm lại với mức
 *   khác) — thay asset của clip tiếng đó, không đẻ thêm clip thứ hai.
 *
 * Luôn làm sạch từ asset GỐC: lọc chồng lên bản đã lọc là dồn méo tiếng.
 */

export type VoiceCleanupMode = 'swap-audio' | 'add-partner' | 'swap-partner'

export interface VoiceCleanupTarget {
  clipId: string
  mode: VoiceCleanupMode
  /** Asset gốc để đưa vào ffmpeg. */
  sourceAsset: MediaAsset
  /** Clip sẽ nhận asset mới khi `swap-*`. */
  swapClipId?: string
}

const CLEAN_TRACK_NAME = 'Giọng đã làm sạch'

function locate(document: ProjectDocument, clipId: string): { clip: Clip; track: Track } | null {
  for (const track of document.tracks) {
    const clip = track.clips.find((item) => item.id === clipId)
    if (clip) return { clip, track }
  }
  return null
}

const isCleaned = (asset: MediaAsset | undefined): boolean =>
  asset?.generated?.task === 'voice-cleanup'

/** Xác định làm gì với clip này, hoặc ném lỗi tiếng Việt nói rõ vì sao không làm được. */
export function resolveVoiceCleanupTarget(
  document: ProjectDocument,
  clipId: string
): VoiceCleanupTarget {
  const found = locate(document, clipId)
  if (!found) throw new Error(`Không tìm thấy clip "${clipId}"`)
  const { clip, track } = found
  const asset = document.assets.find((item) => item.id === clip.assetId)

  if (track.kind === 'audio') {
    const sourceAsset = isCleaned(asset)
      ? document.assets.find((item) => item.id === asset?.generated?.sourceAssetId)
      : asset
    if (!sourceAsset?.probe.hasAudio) throw new Error('Clip này không có tiếng để làm sạch')
    return { clipId, mode: 'swap-audio', sourceAsset, swapClipId: clipId }
  }

  if (track.kind === 'video') {
    if (!asset?.probe.hasAudio) throw new Error('Clip hình này không mang tiếng')
    const partner = expandToLinkGroups(document, [clipId])
      .map((id) => locate(document, id))
      .find((item) => {
        if (!item || item.track.kind !== 'audio') return false
        const partnerAsset = document.assets.find((a) => a.id === item.clip.assetId)
        return isCleaned(partnerAsset) && partnerAsset?.generated?.sourceAssetId === asset.id
      })
    return partner
      ? { clipId, mode: 'swap-partner', sourceAsset: asset, swapClipId: partner.clip.id }
      : { clipId, mode: 'add-partner', sourceAsset: asset }
  }

  throw new Error('Chỉ làm sạch được clip hình hoặc clip tiếng')
}

/** Thay asset của một clip tại chỗ: xoá rồi dán lại đúng id, đúng chỗ, đủ thuộc tính. */
function swapAssetCommands(
  document: ProjectDocument,
  clipId: string,
  assetId: string
): EditorCommand[] {
  const { clip, track } = locate(document, clipId)!
  const commands: EditorCommand[] = [
    { type: 'clip/remove', clipId },
    {
      type: 'clip/paste',
      trackId: track.id,
      clipId,
      startUs: clip.startUs,
      clip: { ...clip, assetId }
    }
  ]
  // Dán luôn bỏ nhóm; clip đang trong nhóm thì gắn lại.
  if (clip.linkGroupId) {
    commands.push({ type: 'clip/set-link-group', clipIds: [clipId], linkGroupId: clip.linkGroupId })
  }
  return commands
}

/** Lane tiếng lời thoại còn trống đúng khoảng `[startUs, endUs)`, nếu có. */
function freeDialogueTrack(
  document: ProjectDocument,
  startUs: number,
  endUs: number
): Track | undefined {
  return document.tracks.find(
    (track) =>
      track.kind === 'audio' &&
      !track.locked &&
      (track.role === 'dialogue' || track.name === CLEAN_TRACK_NAME) &&
      !track.clips.some((item) => item.startUs < endUs && clipEndUs(item) > startUs)
  )
}

export function planVoiceCleanup(
  document: ProjectDocument,
  target: VoiceCleanupTarget,
  cleaned: MediaAsset,
  makeId: (prefix: 'clip' | 'track' | 'group') => string
): EditorCommand[] {
  const commands: EditorCommand[] = []
  if (!document.assets.some((asset) => asset.id === cleaned.id)) {
    commands.push({ type: 'asset/add', asset: cleaned })
  }

  if (target.mode !== 'add-partner') {
    return [...commands, ...swapAssetCommands(document, target.swapClipId!, cleaned.id)]
  }

  const { clip } = locate(document, target.clipId)!
  let trackId = freeDialogueTrack(document, clip.startUs, clipEndUs(clip))?.id
  if (!trackId) {
    trackId = makeId('track')
    commands.push({
      type: 'track/add',
      trackId,
      kind: 'audio',
      name: CLEAN_TRACK_NAME,
      role: 'dialogue'
    })
  }

  const partnerId = makeId('clip')
  // Chỉ mang những gì thuộc về TIẾNG: transform, màu, effect của clip hình không
  // có nghĩa gì trên một clip âm thanh.
  const volumeTrack = clip.keyframes?.['volume']
  const partner = {
    id: partnerId,
    assetId: cleaned.id,
    startUs: clip.startUs,
    durationUs: clip.durationUs,
    sourceInUs: clip.sourceInUs,
    speed: clip.speed,
    volume: clip.volume,
    fadeInUs: clip.fadeInUs,
    fadeOutUs: clip.fadeOutUs,
    ...(volumeTrack ? { keyframes: { volume: volumeTrack } } : {})
  } as Clip
  commands.push({
    type: 'clip/paste',
    trackId,
    clipId: partnerId,
    startUs: clip.startUs,
    clip: partner
  })

  // Tắt tiếng gốc. Đường keyframe âm lượng phải xoá luôn: còn nó thì mức tĩnh 0
  // bị bỏ qua và tiếng bẩn vẫn phát chồng lên tiếng sạch.
  commands.push({ type: 'clip/update', clipId: clip.id, patch: { volume: 0 } })
  if (volumeTrack) {
    commands.push({
      type: 'keyframe/set-tracks',
      target: { kind: 'clip', clipId: clip.id },
      tracks: { volume: [] }
    })
  }

  commands.push({
    type: 'clip/set-link-group',
    clipIds: [clip.id, partnerId],
    linkGroupId: clip.linkGroupId ?? makeId('group')
  })
  return commands
}
