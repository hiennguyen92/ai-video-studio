import type { EditorCommand } from '../commands/editor-command-types'
import type { ProjectDocument } from './project-document-types'
import type { Clip } from './timeline-track-types'
import type { Micros } from './time-units'

/**
 * Nhóm clip: các clip mang cùng `linkGroupId` được chọn, dời và xoá như một.
 *
 * Nhóm là chuyện của VÙNG CHỌN và của việc DỜI, không phải của mọi lệnh: cắt mép,
 * slip, đổi tốc độ vẫn tác động lên đúng một clip. Kéo mép clip hình mà clip tiếng
 * cùng nhóm cũng co theo là điều người dùng không đoán được, còn dời lệch hình với
 * tiếng thì ai cũng thấy ngay là hỏng.
 *
 * Giao diện và agent đều mở rộng qua đây, nên không bên nào dời lệch nhóm được.
 */

/** Mọi clip trong tài liệu, kèm track chứa nó. */
function allClips(document: ProjectDocument): Array<{ clip: Clip; trackId: string }> {
  return document.tracks.flatMap((track) =>
    track.clips.map((clip) => ({ clip, trackId: track.id }))
  )
}

/**
 * Mở rộng danh sách clip ra CẢ NHÓM của từng clip. Giữ thứ tự: clip được nêu
 * trước, thành viên kéo theo sau — chỗ gọi hay lấy phần tử đầu làm clip "chính".
 */
export function expandToLinkGroups(
  document: ProjectDocument,
  clipIds: readonly string[]
): string[] {
  const groupIds = new Set<string>()
  for (const { clip } of allClips(document)) {
    if (clipIds.includes(clip.id) && clip.linkGroupId) groupIds.add(clip.linkGroupId)
  }

  const result = [...clipIds]
  if (groupIds.size === 0) return result
  for (const { clip } of allClips(document)) {
    if (clip.linkGroupId && groupIds.has(clip.linkGroupId) && !result.includes(clip.id)) {
      result.push(clip.id)
    }
  }
  return result
}

/** Clip có thuộc nhóm nào còn ít nhất một thành viên khác không. */
export function isGroupedClip(document: ProjectDocument, clipId: string): boolean {
  const clips = allClips(document).map((item) => item.clip)
  const clip = clips.find((item) => item.id === clipId)
  if (!clip?.linkGroupId) return false
  return clips.some((item) => item.id !== clipId && item.linkGroupId === clip.linkGroupId)
}

/**
 * Dời một loạt clip đi cùng một khoảng `deltaUs`, giữ nguyên khoảng cách giữa chúng.
 *
 * Khoảng dời bị kẹp để clip sớm nhất không lọt xuống dưới 0 — kẹp riêng từng clip
 * thì chúng dồn cục ở đầu timeline và nhóm vỡ hình dạng. `toTrackId` chỉ dùng khi
 * CẢ loạt đang nằm trên một track: dời nhiều track cùng lúc sang một track sẽ đè
 * chúng lên nhau.
 */
export function planMoveClips(
  document: ProjectDocument,
  clipIds: readonly string[],
  deltaUs: Micros,
  toTrackId?: string
): EditorCommand | null {
  const moving = allClips(document).filter((item) => clipIds.includes(item.clip.id))
  if (moving.length === 0) return null

  const earliest = Math.min(...moving.map((item) => item.clip.startUs))
  const delta = Math.max(deltaUs, -earliest)
  const singleTrack = moving.every((item) => item.trackId === moving[0].trackId)
  const changesTrack = singleTrack && toTrackId !== undefined && toTrackId !== moving[0].trackId

  if (delta === 0 && !changesTrack) return null
  return {
    type: 'clip/move-many',
    moves: moving.map((item) => ({
      clipId: item.clip.id,
      toTrackId: changesTrack ? toTrackId : undefined,
      toStartUs: item.clip.startUs + delta
    }))
  }
}

/**
 * Lệnh gộp các clip thành một nhóm mới. Clip đang ở nhóm khác thì rời nhóm cũ —
 * một clip chỉ thuộc một nhóm. `null` khi chưa đủ hai clip.
 */
export function planGroupClips(clipIds: readonly string[], groupId: string): EditorCommand | null {
  const unique = [...new Set(clipIds)]
  if (unique.length < 2) return null
  return { type: 'clip/set-link-group', clipIds: unique, linkGroupId: groupId }
}

/** Lệnh rã nhóm của mọi clip được nêu. `null` khi không clip nào đang trong nhóm. */
export function planUngroupClips(
  document: ProjectDocument,
  clipIds: readonly string[]
): EditorCommand | null {
  const members = expandToLinkGroups(document, clipIds).filter(
    (id) => allClips(document).find((item) => item.clip.id === id)?.clip.linkGroupId
  )
  if (members.length === 0) return null
  return { type: 'clip/set-link-group', clipIds: members, linkGroupId: null }
}
