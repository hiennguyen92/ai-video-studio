import type { EditorCommand } from '../commands/editor-command-types'
import { findClipLook } from './clip-look-catalog'
import { DEFAULT_MOTION_INTENSITY, type ClipMotionKind } from './clip-motion-types'
import { type Clip, type TrackKind, type TransitionKind } from './timeline-track-types'

/**
 * Danh mục và lệnh của các thẻ trong tab Library.
 *
 * Chuyển cảnh KHÔNG áp lên một clip: nó thả vào chỗ nối giữa hai clip (xem
 * `timeline-cut-transitions`). Zoom thì áp lên clip — bấm thẻ khi đã chọn clip,
 * hoặc kéo thẻ thả lên clip — và cả hai lối cùng đi qua `libraryMotionCommands`.
 */

/**
 * Kiểu dữ liệu gắn vào `dataTransfer`, TÁCH theo loại thẻ.
 *
 * Trong lúc đang rê, trình duyệt chỉ cho đọc danh sách kiểu, chưa cho đọc nội dung.
 * Tách kiểu thì clip và lane biết ngay thẻ đang rê là chuyển cảnh hay zoom, để tô
 * sáng đúng chỗ nhận: chỗ nối cho chuyển cảnh, cả clip cho zoom.
 */
export const LIBRARY_TRANSITION_DRAG_MIME = 'application/x-ai-video-studio-transition'
export const LIBRARY_MOTION_DRAG_MIME = 'application/x-ai-video-studio-motion'
/** Thẻ LUT: dữ liệu kéo là id look trần, không phải JSON. */
export const LIBRARY_LOOK_DRAG_MIME = 'application/x-ai-video-studio-look'

/** Kiểu dữ liệu kéo ứng với loại thẻ. */
export function libraryDragMime(item: LibraryClipItem): string {
  return item.type === 'transition' ? LIBRARY_TRANSITION_DRAG_MIME : LIBRARY_MOTION_DRAG_MIME
}

export type LibraryClipItem =
  { type: 'transition'; kind: TransitionKind } | { type: 'motion'; kind: ClipMotionKind }

/** Mọi kiểu chuyển cảnh, đúng thứ tự hiển thị. */
export const LIBRARY_TRANSITION_KINDS: TransitionKind[] = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'wipe-left',
  'wipe-right',
  'zoom',
  'whip-left',
  'whip-right',
  'blur',
  'glitch',
  'spin',
  'flash'
]

/** Mọi kiểu chuyển động chạy suốt clip, đúng thứ tự hiển thị. */
export const LIBRARY_MOTION_KINDS: ClipMotionKind[] = [
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
  'punch-in',
  'shake'
]

/** Chuyển cảnh và chuyển động chỉ có nghĩa với clip vẽ ra hình. */
export function acceptsLibraryItem(trackKind: TrackKind): boolean {
  return trackKind === 'video' || trackKind === 'image'
}

/**
 * Lệnh áp một kiểu chuyển động (zoom, lia…) vào clip, hoặc `null` khi clip không
 * nhận được.
 *
 * Đổi kiểu thì GIỮ cường độ người dùng đã chỉnh: thử liền vài kiểu mà mỗi lần lại
 * về mặc định là phải chỉnh lại từ đầu.
 */
export function libraryMotionCommands(
  kind: ClipMotionKind,
  clip: Clip,
  trackKind: TrackKind
): { commands: EditorCommand[]; label: string } | null {
  if (!acceptsLibraryItem(trackKind)) return null
  return {
    commands: [
      {
        type: 'clip/set-motion',
        clipId: clip.id,
        motion: { kind, intensity: clip.motion?.intensity ?? DEFAULT_MOTION_INTENSITY }
      }
    ],
    label: 'Đổi zoom'
  }
}

/**
 * Lệnh áp một look màu vào clip, hoặc `null` khi clip không nhận được hay id lạ.
 * Đổi look thì GIỮ cường độ đang có: thử liền vài look mà mỗi lần về 100% là mất
 * công chỉnh lại.
 */
export function libraryLookCommands(
  lookId: string,
  clip: Clip,
  trackKind: TrackKind
): { commands: EditorCommand[]; label: string } | null {
  if (!acceptsLibraryItem(trackKind) || !findClipLook(lookId)) return null
  return {
    commands: [
      {
        type: 'clip/set-look',
        clipId: clip.id,
        look: { id: lookId, intensity: clip.look?.intensity ?? 1 }
      }
    ],
    label: 'Đổi filter'
  }
}

/** Đọc mục Library từ chuỗi JSON trong `dataTransfer`. Hỏng hay lạ thì `null`. */
export function parseLibraryDragPayload(raw: string): LibraryClipItem | null {
  try {
    const value = JSON.parse(raw) as Partial<LibraryClipItem>
    if (
      value.type === 'transition' &&
      LIBRARY_TRANSITION_KINDS.includes(value.kind as TransitionKind)
    ) {
      return { type: 'transition', kind: value.kind as TransitionKind }
    }
    if (value.type === 'motion' && LIBRARY_MOTION_KINDS.includes(value.kind as ClipMotionKind)) {
      return { type: 'motion', kind: value.kind as ClipMotionKind }
    }
  } catch {
    // Chuỗi hỏng đến từ nguồn kéo lạ: bỏ qua, không làm gì.
  }
  return null
}
