import { frameOfMicros } from '../../../../shared/domain/time-units'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { KeyframeTracks } from '../../../../shared/domain/keyframe-types'
import type { Micros } from '../../../../shared/domain/time-units'
import { selectDocument, useEditorStore, type EditorState } from '../../state/editor-store'

/**
 * Trạng thái và hành vi của một ô số có thể đặt keyframe.
 *
 * RÀNG BUỘC HIỆU NĂNG — đây là lý do cả file này viết theo lối hơi vòng vo:
 * panel Thuộc tính TUYỆT ĐỐI không được theo dõi đầu phát. Đo được trong repo
 * này: một panel theo dõi `playheadUs` làm Player tụt còn ≈24/30 khung mỗi
 * giây, hình chậm hơn tiếng, và Remotion kéo tiếng lùi ~0,7 giây cho khớp —
 * nghe như tiếng lặp.
 *
 * Hai kỹ thuật bắt buộc, cả hai đều đã có tiền lệ trong repo:
 *
 *   - Mọi selector ở đây trả về BOOLEAN. Đầu phát đổi 30 lần/giây thì selector
 *     chạy 30 lần (vài phép so sánh), nhưng component chỉ vẽ lại đúng lúc
 *     boolean lật — tức lúc đầu phát đi vào hoặc ra khỏi một keyframe. Mẫu:
 *     `timeline-text-block.tsx`.
 *   - Giá trị đầu phát lúc BẤM đọc bằng `getState()` trong handler, không theo
 *     dõi. Mẫu: `preview-panel.tsx`.
 */

export type KeyframeTarget = { kind: 'clip'; clipId: string } | { kind: 'text'; overlayId: string }

export interface KeyframeField {
  /** `none` chưa có gì · `off` có keyframe nhưng đầu phát ở chỗ khác · `on` đang đứng trên một keyframe. */
  state: 'none' | 'off' | 'on'
  /** Đầu phát nằm ngoài clip/khối chữ: không đặt được keyframe cho thứ không hiện trên hình. */
  disabled: boolean
  /** Thuộc tính này đang chạy keyframe — chỗ gọi phải ghi keyframe thay vì giá trị tĩnh. */
  animated: boolean
  /** Bấm nút: chốt giá trị đang hiển thị thành keyframe, hoặc xoá keyframe đang đứng trên. */
  toggle(value: number | number[]): void
  /** Kéo thanh xong: ghi vào keyframe tại đầu phát. Chỉ gọi khi `animated`. */
  commit(value: number | number[]): void
}

/** Chủ thể mang keyframe, tra từ tài liệu theo `target`. */
function subjectOf(
  state: EditorState,
  target: KeyframeTarget | undefined
): { keyframes?: KeyframeTracks; startUs: Micros; durationUs: Micros } | null {
  const document = selectDocument(state)
  if (!document || !target) return null

  if (target.kind === 'text') {
    const overlay = document.textOverlays.find((item) => item.id === target.overlayId)
    return overlay
      ? {
          keyframes: overlay.keyframes,
          startUs: overlay.startUs,
          durationUs: overlay.endUs - overlay.startUs
        }
      : null
  }

  for (const track of document.tracks) {
    const clip = track.clips.find((item) => item.id === target.clipId)
    if (clip) {
      return { keyframes: clip.keyframes, startUs: clip.startUs, durationUs: clip.durationUs }
    }
  }
  return null
}

/**
 * `target` được phép vắng mặt để chỗ gọi khỏi phải gọi hook có điều kiện — một
 * hàng không animate được vẫn gọi hook này và nhận về trạng thái tắt.
 */
export function useKeyframeField(
  target: KeyframeTarget | undefined,
  paths: readonly string[],
  label: string
): KeyframeField {
  const animated = useEditorStore((state) => {
    const subject = subjectOf(state, target)
    return paths.some((path) => (subject?.keyframes?.[path]?.length ?? 0) > 0)
  })

  const disabled = useEditorStore((state) => {
    const subject = subjectOf(state, target)
    if (!subject) return true
    return (
      state.playheadUs < subject.startUs || state.playheadUs >= subject.startUs + subject.durationUs
    )
  })

  const atKeyframe = useEditorStore((state) => {
    const subject = subjectOf(state, target)
    const document = selectDocument(state)
    if (!subject || !document) return false
    // So bằng KHUNG HÌNH, không bằng micro giây: đầu phát gần như không bao giờ
    // rơi đúng một mốc tới từng micro giây, nên so thẳng thì nút không bao giờ
    // sáng. Dùng đúng phép quy đổi mà chỗ dựng kế hoạch dùng — lệch nhau thì nút
    // nói "đang đứng trên keyframe" trong khi hình vẽ một giá trị nội suy.
    const fps = document.settings.frameRate
    const here = frameOfMicros(state.playheadUs - subject.startUs, fps)
    return paths.some((path) =>
      subject.keyframes?.[path]?.some((frame) => frameOfMicros(frame.atUs, fps) === here)
    )
  })

  const write = (value: number | number[], remove: boolean): void => {
    const state = useEditorStore.getState()
    const subject = subjectOf(state, target)
    if (!subject || !target) return
    const atUs = Math.max(0, state.playheadUs - subject.startUs)
    const values = Array.isArray(value) ? value : paths.map(() => value)

    const commands: EditorCommand[] = paths.map((path, index) =>
      remove
        ? { type: 'keyframe/remove', target, path, atUs }
        : { type: 'keyframe/set', target, path, atUs, value: values[index] }
    )
    // Cả cụm trong MỘT lần chạy: đặt keyframe cho vị trí là hai lệnh (hai trục)
    // nhưng với người dùng đó là một thao tác, nên phải là một bước hoàn tác.
    state.run(commands, label)
  }

  return {
    state: !animated ? 'none' : atKeyframe ? 'on' : 'off',
    disabled,
    // Đầu phát ở ngoài clip thì cú kéo thanh trượt quay về ghi giá trị TĨNH,
    // đúng như nút kim cương lúc đó bị tắt — một luật cho cả hai đường ghi.
    //
    // Thiếu điều kiện này thì kéo thanh khi đầu phát nằm ngoài clip vẫn đẻ ra
    // một keyframe ở mốc không nhìn thấy được, trong khi cái nút ngay cạnh nó từ
    // chối làm đúng việc đó. Phép thử đầu-cuối bắt được mâu thuẫn này.
    animated: animated && !disabled,
    toggle: (value) => write(value, atKeyframe),
    commit: (value) => write(value, false)
  }
}
