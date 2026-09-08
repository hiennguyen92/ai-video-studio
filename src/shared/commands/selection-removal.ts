import type { EditorCommand } from './editor-command-types'
import type { TextBlockRef } from '../domain/text-block-drag'

/**
 * Lệnh xoá thứ đang được chọn trên timeline.
 *
 * Tách khỏi giao diện vì có HAI đường cùng gọi tới nó — phím Delete và nút thùng
 * rác trên thanh công cụ — và ba loại đối tượng chọn được lại đi qua ba lệnh khác
 * nhau. Viết hai bản thì phím Delete xoá được câu phụ đề trong khi cái nút vẫn
 * mờ đi, hoặc ngược lại.
 *
 * Trả `null` khi không có gì để xoá, để nơi gọi biết mà làm mờ nút thay vì phát
 * ra một danh sách lệnh rỗng rồi ghi một bước hoàn tác không làm gì cả.
 */

export interface SelectionRemoval {
  commands: EditorCommand[]
  /** Nhãn hiện trong lịch sử hoàn tác. */
  label: string
}

export function selectionRemovalCommands(selection: {
  clipIds: string[]
  text?: TextBlockRef
}): SelectionRemoval | null {
  // Khối chữ được xét TRƯỚC, đúng thứ tự ưu tiên của panel thuộc tính: vùng chọn
  // chỉ giữ một trong hai, và khối chữ là thứ người dùng vừa bấm vào.
  if (selection.text) {
    if (selection.text.kind === 'overlay') {
      return {
        commands: [{ type: 'text/remove', overlayId: selection.text.overlayId }],
        label: 'Xoá chữ'
      }
    }
    return {
      commands: [
        {
          type: 'subtitle/remove-cue',
          trackId: selection.text.subtitleTrackId,
          cueId: selection.text.cueId
        }
      ],
      label: 'Xoá câu phụ đề'
    }
  }

  if (selection.clipIds.length === 0) return null

  return {
    commands: selection.clipIds.map((clipId) => ({ type: 'clip/remove', clipId }) as EditorCommand),
    label: 'Xoá clip'
  }
}
