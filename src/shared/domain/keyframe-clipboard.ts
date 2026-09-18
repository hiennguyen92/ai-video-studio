import { parseEffectPath, effectIntensityPath, effectParamPath } from './keyframe-property-catalog'
import type { ClipEffect } from './clip-effect-types'
import type { KeyframeTracks } from './keyframe-types'

/**
 * Chép một cụm keyframe rồi dán sang chủ thể khác.
 *
 * Phần khó duy nhất là EFFECT. Keyframe của effect khoá theo `effect.<id>`, mà
 * `id` là id riêng của từng lần áp effect — clip đích có effect y hệt về loại
 * thì id vẫn khác. Dán thẳng id nguồn sang là đẻ ra một đống keyframe mồ côi,
 * và chúng chỉ bị dọn khi tình cờ có ai đổi chồng effect của clip đó.
 *
 * Nên bảng tạm chụp lại LOẠI của từng effect lúc chép, và lúc dán thì khớp
 * theo loại, theo thứ tự xuất hiện: effect `hsl` thứ nhất của nguồn ứng với
 * effect `hsl` thứ nhất của đích. Không khớp được thì bỏ đường đó và ĐẾM lại —
 * bỏ im lặng là kiểu hỏng người dùng chỉ phát hiện khi tua tới đúng chỗ.
 */

export interface KeyframeClipboard {
  tracks: KeyframeTracks
  /** Loại của từng effect tại thời điểm chép, tra theo id. */
  effectKinds: Record<string, string>
  /** Chủ thể nguồn là clip hay khối chữ — quyết định đường nào dán được sang đâu. */
  from: 'clip' | 'text'
}

/** Chụp cụm keyframe của một chủ thể. `null` khi nó chẳng có gì để chép. */
export function copyKeyframes(
  keyframes: KeyframeTracks | undefined,
  effects: readonly ClipEffect[] | undefined,
  from: 'clip' | 'text'
): KeyframeClipboard | null {
  if (!keyframes) return null

  const tracks: KeyframeTracks = {}
  for (const path of Object.keys(keyframes)) {
    if (keyframes[path].length > 0) tracks[path] = keyframes[path].map((frame) => ({ ...frame }))
  }
  if (Object.keys(tracks).length === 0) return null

  const effectKinds: Record<string, string> = {}
  for (const effect of effects ?? []) effectKinds[effect.id] = effect.kind
  return { tracks, effectKinds, from }
}

export interface PasteResult {
  /** Những đường sẽ ghi vào chủ thể đích. Rỗng nghĩa là không dán được gì. */
  tracks: KeyframeTracks
  /** Số đường phải bỏ vì đích không nhận được. */
  dropped: number
}

/**
 * Đổi cụm đã chép sang đường dẫn hợp lệ với chủ thể đích.
 *
 * Mốc thời gian GIỮ NGUYÊN, không co giãn theo độ dài clip đích. Co giãn nghe
 * như chiều người dùng nhưng nó lặng lẽ đổi nhịp: một cú mờ dần nửa giây dán
 * sang clip dài gấp ba sẽ thành một giây rưỡi mà không ai yêu cầu. Giữ nguyên
 * thì kết quả đoán được, còn mốc lố ra ngoài clip đích vẫn vô hại vì phần đánh
 * giá kẹp hai đầu.
 */
export function pasteKeyframes(
  clipboard: KeyframeClipboard,
  target: { kind: 'clip'; effects: readonly ClipEffect[] | undefined } | { kind: 'text' }
): PasteResult {
  const tracks: KeyframeTracks = {}
  let dropped = 0

  for (const path of Object.keys(clipboard.tracks)) {
    const mapped = mapPath(path, clipboard, target)
    if (!mapped) {
      dropped += 1
      continue
    }
    tracks[mapped] = clipboard.tracks[path].map((frame) => ({ ...frame }))
  }

  return { tracks, dropped }
}

function mapPath(
  path: string,
  clipboard: KeyframeClipboard,
  target: { kind: 'clip'; effects: readonly ClipEffect[] | undefined } | { kind: 'text' }
): string | null {
  // Chữ và clip không chung thuộc tính nào: `transform.*` với `style.*` là hai
  // thế giới khác nhau, nên dán chéo là bỏ sạch chứ không phải lỗi.
  if (clipboard.from !== target.kind) return null
  if (target.kind === 'text') return path

  const effectPath = parseEffectPath(path)
  if (!effectPath) return path

  const kind = clipboard.effectKinds[effectPath.effectId]
  if (!kind) return null

  // Thứ tự xuất hiện trong chồng effect quyết định cái nào ứng với cái nào:
  // clip nguồn có hai `vignette` thì cái thứ nhất ứng với cái thứ nhất ở đích.
  const sourceIndex = indexAmongKind(
    Object.keys(clipboard.effectKinds),
    clipboard.effectKinds,
    effectPath.effectId
  )
  const candidates = (target.effects ?? []).filter((effect) => effect.kind === kind)
  const match = candidates[sourceIndex]
  if (!match) return null

  return effectPath.paramKey
    ? effectParamPath(match.id, effectPath.paramKey)
    : effectIntensityPath(match.id)
}

/** Vị trí của một effect trong số những effect CÙNG LOẠI với nó. */
function indexAmongKind(ids: string[], kinds: Record<string, string>, effectId: string): number {
  const kind = kinds[effectId]
  let index = 0
  for (const id of ids) {
    if (id === effectId) return index
    if (kinds[id] === kind) index += 1
  }
  return index
}
