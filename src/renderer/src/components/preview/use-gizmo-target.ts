import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { resolveTextFrame } from '../../../../shared/domain/remotion-render-plan'
import { frameBasePaddingPx } from '../../../../remotion/text-overlay-frame-css'
import type { TextBlockRef } from '../../../../shared/domain/text-block-drag'
import type { TextPosition } from '../../../../shared/domain/text-placement'
import { DEFAULT_CLIP_TRANSFORM } from '../../../../shared/domain/timeline-track-types'
import { useEditorStore, type Selection } from '../../state/editor-store'

/**
 * Thứ đang được khung điều khiển trên bản xem trước thao tác.
 *
 * Chữ và clip nằm ở hai chỗ khác nhau trong tài liệu và ghi bằng hai lệnh khác
 * nhau, nhưng thao tác thì giống hệt: kéo để dời, xoay, và (với clip) kéo góc để
 * đổi cỡ. Gom về một mô tả chung ở đây để lớp giao diện chỉ còn lo phần chuột.
 */

/** Đệm khung của chữ đang chọn, để kéo mép khung trên xem trước. */
export interface GizmoFramePadding {
  scaleX: number
  scaleY: number
  /** Đệm một bên ở hệ số 1, px composition. */
  basePaddingPx: { x: number; y: number }
  write(axis: 'x' | 'y', scale: number, label: string): void
}

export interface GizmoTarget {
  /** Bộ chọn tìm ĐÚNG phần tử đang vẽ thứ này trong khung xem trước. */
  selector: string
  /** Tâm, theo phần khung hình (0..1). `null` nghĩa là chưa đặt — đo trên màn hình. */
  position: TextPosition | null
  rotationDeg: number
  /** Hệ số phóng. `null` với chữ: chữ đổi cỡ bằng cỡ phông, không bằng kéo góc. */
  scale: number | null
  write(next: { position: TextPosition; rotationDeg: number; scale: number }, label: string): void
  /** Chỉ có khi thứ đang chọn là chữ overlay CÓ khung. */
  framePadding?: GizmoFramePadding
}

/** Đổi `ClipTransform.x/y` (-1..1, 0 là giữa) sang phần khung hình (0..1). */
export function clipTransformToPosition(transform: { x: number; y: number }): TextPosition {
  return { xPct: 0.5 + transform.x / 2, yPct: 0.5 + transform.y / 2 }
}

/** Chiều ngược lại. */
export function positionToClipTransform(position: TextPosition): { x: number; y: number } {
  return { x: (position.xPct - 0.5) * 2, y: (position.yPct - 0.5) * 2 }
}

function textTarget(document: ProjectDocument, block: TextBlockRef): GizmoTarget | null {
  const run = useEditorStore.getState().run

  if (block.kind === 'overlay') {
    const overlay = document.textOverlays.find((item) => item.id === block.overlayId)
    if (!overlay) return null
    // Tra khung như lớp vẽ tra: khung có id lạ thì lớp vẽ bỏ khung, và tay nắm mép
    // cũng không được hiện ra để kéo một thứ không có trên hình.
    const resolvedFrame = resolveTextFrame(overlay)
    const frame = overlay.frame
    const framePadding: GizmoFramePadding | undefined =
      resolvedFrame && frame
        ? {
            scaleX: resolvedFrame.padding.x,
            scaleY: resolvedFrame.padding.y,
            basePaddingPx: frameBasePaddingPx(resolvedFrame, overlay.style.fontSizePx),
            write: (axis, scale, label) =>
              void run(
                [
                  {
                    type: 'text/update',
                    overlayId: overlay.id,
                    frame: {
                      ...frame,
                      [axis === 'x' ? 'paddingScaleX' : 'paddingScaleY']: scale
                    }
                  }
                ],
                label
              )
          }
        : undefined
    return {
      framePadding,
      selector: `[data-block-id="${overlay.id}"] .text-block`,
      position: overlay.style.position ?? null,
      rotationDeg: overlay.style.rotationDeg ?? 0,
      scale: null,
      write: ({ position, rotationDeg }, label) =>
        void run(
          [
            {
              type: 'text/set-style',
              overlayId: overlay.id,
              style: { ...overlay.style, position, rotationDeg }
            }
          ],
          label
        )
    }
  }

  const track = document.subtitleTracks.find((item) => item.id === block.subtitleTrackId)
  const cue = track?.cues.find((item) => item.id === block.cueId)
  if (!track || !cue) return null
  return {
    selector: `[data-block-id="${cue.id}"] .text-block`,
    position: track.style.position ?? null,
    rotationDeg: track.style.rotationDeg ?? 0,
    scale: null,
    // Kiểu chữ phụ đề thuộc về CẢ track, nên kéo một câu là dời mọi câu. Panel
    // thuộc tính nói rõ điều đó ngay bên cạnh.
    write: ({ position, rotationDeg }, label) =>
      void run(
        [
          {
            type: 'subtitle/set-style',
            trackId: track.id,
            style: { ...track.style, position, rotationDeg }
          }
        ],
        label
      )
  }
}

function clipTarget(document: ProjectDocument, clipId: string): GizmoTarget | null {
  const run = useEditorStore.getState().run

  for (const track of document.tracks) {
    // Chỉ clip VẼ RA HÌNH mới kéo được; clip tiếng không có gì trên khung hình.
    if (track.kind !== 'video' && track.kind !== 'image') continue
    const clip = track.clips.find((item) => item.id === clipId)
    if (!clip) continue

    const transform = clip.transform ?? DEFAULT_CLIP_TRANSFORM
    return {
      selector: `[data-clip-id="${clip.id}"]`,
      position: clipTransformToPosition(transform),
      rotationDeg: transform.rotationDeg,
      scale: transform.scale,
      write: ({ position, rotationDeg, scale }, label) =>
        void run(
          [
            {
              type: 'clip/update',
              clipId: clip.id,
              patch: {
                transform: {
                  ...transform,
                  ...positionToClipTransform(position),
                  rotationDeg,
                  scale
                }
              }
            }
          ],
          label
        )
    }
  }
  return null
}

/**
 * Vùng chọn hiện tại, đổi thành thứ khung điều khiển thao tác được.
 *
 * Khối chữ được ưu tiên vì vùng chọn chỉ giữ MỘT trong hai, và khối chữ là thứ
 * người dùng vừa bấm vào.
 */
export function resolveGizmoTarget(
  document: ProjectDocument,
  selection: Selection
): GizmoTarget | null {
  if (selection.text) return textTarget(document, selection.text)
  const clipId = selection.clipIds[0]
  return clipId ? clipTarget(document, clipId) : null
}
