import type { EditorCommand } from './editor-command-types'
import type { TextOverlay } from '../domain/text-overlay-types'
import type { TextPosition } from '../domain/text-placement'
import type { Micros } from '../domain/time-units'

/**
 * Lệnh phát ra khi thả chuột sau một cú kéo khối chữ trên bản xem trước.
 *
 * Thuộc tính nào ĐÃ có keyframe thì cú kéo ghi vào keyframe tại đầu phát; thuộc
 * tính nào chưa thì vẫn ghi giá trị tĩnh như trước. Không tự bật chế độ keyframe
 * sau lưng người dùng: bấm nút kim cương mới là lời tuyên bố "chỗ này tôi muốn
 * nó đổi theo thời gian", còn kéo chữ thì không.
 *
 * Trả về một MẢNG để chỗ gọi chạy chúng trong đúng một `run()`. Lịch sử hoàn tác
 * gom cả nhóm thành một bước, nên một cú kéo chạm ba thuộc tính vẫn chỉ tốn một
 * lần Ctrl+Z — nếu tách thành nhiều `run()` thì người dùng phải hoàn tác ba lần
 * cho một thao tác họ thấy là một.
 */
export function textGizmoWriteCommands(
  overlay: TextOverlay,
  next: { position: TextPosition; rotationDeg: number },
  playheadUs: Micros
): EditorCommand[] {
  // Mốc tính từ lúc khối chữ bắt đầu hiện. Kẹp về 0 cho chắc: khung điều khiển
  // chỉ hiện khi chữ đang trên hình nên đầu phát luôn nằm trong khoảng, nhưng
  // một mốc âm sẽ bị lệnh từ chối và cú kéo im lặng không làm gì cả.
  const atUs = Math.max(0, playheadUs - overlay.startUs)
  const animated = overlay.keyframes ?? {}

  const commands: EditorCommand[] = []
  const staticStyle = { ...overlay.style }
  let staticChanged = false

  const write = (path: string, value: number, apply: () => void): void => {
    if (animated[path]?.length) {
      commands.push({
        type: 'keyframe/set',
        target: { kind: 'text', overlayId: overlay.id },
        path,
        atUs,
        value
      })
    } else {
      apply()
      staticChanged = true
    }
  }

  // Hai trục của vị trí đi cùng nhau về mặt dữ liệu tĩnh (`position` là một
  // object), nhưng tách nhau về keyframe — ghim ngang mà vẫn để dọc tự do là
  // chuyện có thật khi làm chữ chạy ngang màn hình.
  write('style.position.xPct', next.position.xPct, () => {
    staticStyle.position = { ...(staticStyle.position ?? next.position), xPct: next.position.xPct }
  })
  write('style.position.yPct', next.position.yPct, () => {
    staticStyle.position = { ...(staticStyle.position ?? next.position), yPct: next.position.yPct }
  })
  write('style.rotationDeg', next.rotationDeg, () => {
    staticStyle.rotationDeg = next.rotationDeg
  })

  if (staticChanged) {
    commands.push({ type: 'text/set-style', overlayId: overlay.id, style: staticStyle })
  }
  return commands
}
