import type { EditorCommand } from '../commands/editor-command-types'
import { expandToLinkGroups } from './clip-link-groups'
import type { MediaAsset } from './media-asset-types'
import type { ProjectDocument } from './project-document-types'
import { clipEndUs, type Clip } from './timeline-track-types'
import { snapMicrosToFrame, type Micros } from './time-units'

/**
 * Chèn một đoạn đứng hình tại đầu phát.
 *
 * Tách clip (và cả nhóm của nó) tại mốc, dời mọi clip từ mốc đó trở đi TRÊN CÁC
 * LANE ĐÓ sang phải đúng độ dài đoạn đứng hình, rồi đặt clip đứng hình vào chỗ
 * trống. Chỉ các lane của clip và nhóm của nó dời — cùng luật với ripple xoá clip:
 * nhạc nền đặt sẵn không bị đẩy lệch khỏi chỗ người dùng canh.
 */

export const DEFAULT_FREEZE_US: Micros = 2_000_000

export interface FreezeFrameSource {
  clip: Clip
  trackId: string
  sourceAsset: MediaAsset
  /** Mốc trên timeline, đã làm tròn về khung. */
  atUs: Micros
  /** Mốc tương ứng trên trục nguồn — khung sẽ đóng băng. */
  sourceUs: Micros
}

/** Khung sẽ đóng băng, hoặc ném lỗi tiếng Việt nói rõ vì sao không làm được. */
export function resolveFreezeFrameSource(
  document: ProjectDocument,
  clipId: string,
  playheadUs: Micros
): FreezeFrameSource {
  const track = document.tracks.find((item) => item.clips.some((clip) => clip.id === clipId))
  const clip = track?.clips.find((item) => item.id === clipId)
  if (!track || !clip) throw new Error(`Không tìm thấy clip "${clipId}"`)
  if (track.kind !== 'video') throw new Error('Chỉ đóng băng được clip trên lane hình')
  const sourceAsset = document.assets.find((item) => item.id === clip.assetId)
  if (!sourceAsset || sourceAsset.kind !== 'video') {
    throw new Error('Clip này là ảnh tĩnh — vốn đã đứng yên, không cần đóng băng')
  }

  const atUs = snapMicrosToFrame(playheadUs, document.settings.frameRate)
  if (atUs < clip.startUs || atUs >= clipEndUs(clip)) {
    throw new Error('Đầu phát phải nằm trong clip cần đóng băng')
  }
  const sourceUs = Math.round(clip.sourceInUs + (atUs - clip.startUs) * clip.speed)
  return { clip, trackId: track.id, sourceAsset, atUs, sourceUs }
}

export function planFreezeFrame(
  document: ProjectDocument,
  source: FreezeFrameSource,
  freezeAsset: MediaAsset,
  durationUs: Micros,
  makeId: (prefix: 'clip') => string
): EditorCommand[] {
  const { atUs, clip } = source
  const commands: EditorCommand[] = []
  if (!document.assets.some((asset) => asset.id === freezeAsset.id)) {
    commands.push({ type: 'asset/add', asset: freezeAsset })
  }

  const members = expandToLinkGroups(document, [clip.id])
  const laneIds = new Set(
    document.tracks
      .filter((track) => track.clips.some((item) => members.includes(item.id)))
      .map((track) => track.id)
  )

  // Tách mọi thành viên của nhóm đang vắt qua mốc; nửa sau bắt đầu đúng tại mốc.
  const moves: Array<{ clipId: string; toStartUs: Micros }> = []
  for (const track of document.tracks) {
    if (!laneIds.has(track.id)) continue
    for (const item of track.clips) {
      if (item.startUs < atUs && clipEndUs(item) > atUs) {
        const tailId = makeId('clip')
        commands.push({ type: 'clip/split', clipId: item.id, atUs, newClipId: tailId })
        moves.push({ clipId: tailId, toStartUs: atUs + durationUs })
      } else if (item.startUs >= atUs) {
        moves.push({ clipId: item.id, toStartUs: item.startUs + durationUs })
      }
    }
  }
  if (moves.length > 0) commands.push({ type: 'clip/move-many', moves })

  // Clip đứng hình mang cùng "diện mạo" với clip gốc — cùng vị trí, màu, effect,
  // nền mờ — để chỗ nối không nhảy hình. Chuyển động, keyframe, chuyển cảnh và
  // fade thì không: chúng thuộc về dòng thời gian của clip gốc.
  const freezeId = makeId('clip')
  commands.push({
    type: 'clip/paste',
    trackId: source.trackId,
    clipId: freezeId,
    startUs: atUs,
    clip: {
      id: freezeId,
      assetId: freezeAsset.id,
      startUs: atUs,
      durationUs,
      sourceInUs: 0,
      speed: 1,
      volume: 0,
      fadeInUs: 0,
      fadeOutUs: 0,
      transform: clip.transform,
      colorGrade: clip.colorGrade,
      look: clip.look,
      effects: clip.effects,
      backgroundFill: clip.backgroundFill
    } as Clip
  })
  if (clip.linkGroupId) {
    commands.push({
      type: 'clip/set-link-group',
      clipIds: [freezeId],
      linkGroupId: clip.linkGroupId
    })
  }
  return commands
}
