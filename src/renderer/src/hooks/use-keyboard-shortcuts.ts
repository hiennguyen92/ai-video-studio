import { useEffect } from 'react'
import { groupSelectedClips, ungroupSelectedClips } from '../state/clip-group-actions'
import {
  addMarkerAtPlayhead,
  jumpToMarker,
  rippleDeleteSelection
} from '../state/timeline-marker-actions'
import { frameDurationUs } from '../../../shared/domain/time-units'
import { selectionRemovalCommands } from '../../../shared/commands/selection-removal'
import { useEditorStore } from '../state/editor-store'
import { TIMELINE_TOOL_KEYS } from '../state/timeline-tool-keys'
import { SHOW_SHORTCUTS_EVENT } from '../state/keyboard-shortcut-catalog'

/**
 * Phím tắt của trình soạn thảo.
 *
 * Quy tắc bắt buộc (DESCRIPTION §4): KHÔNG kích hoạt khi con trỏ đang ở trong ô
 * nhập liệu. Không có chốt chặn này thì gõ chữ "s" vào tên dự án sẽ cắt clip, và
 * dấu cách sẽ phát video giữa lúc đang gõ.
 */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return

      const store = useEditorStore.getState()
      const document = store.session?.document
      if (!document) return

      const modifier = event.metaKey || event.ctrlKey
      const selectedClipId = store.selection.clipIds[0]
      const stepUs = frameDurationUs(document.settings.frameRate)

      // `?` (Shift+/) mở bảng phím tắt — quy ước chung của GitHub, Gmail, Figma.
      if (event.key === '?') {
        event.preventDefault()
        window.dispatchEvent(new Event(SHOW_SHORTCUTS_EVENT))
        return
      }

      // Cmd+G gộp nhóm, Cmd+Shift+G rã nhóm — cùng cặp phím với Premiere và Figma.
      if (modifier && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        if (event.shiftKey) ungroupSelectedClips('Rã nhóm clip')
        else groupSelectedClips('Gộp nhóm clip')
        return
      }

      // M đặt marker tại đầu phát; Shift+M tới marker kế, Cmd+Shift+M về marker
      // trước — cùng bộ phím với Premiere. So bằng `code` vì Shift đổi `key`
      // thành chữ hoa, còn Option trên macOS đổi hẳn sang ký tự khác.
      if (event.code === 'KeyM' && !event.altKey) {
        event.preventDefault()
        if (!event.shiftKey && !modifier) addMarkerAtPlayhead('Thêm marker')
        else if (event.shiftKey) jumpToMarker(modifier ? -1 : 1)
        return
      }

      // Chép/dán CLIP. Đặt trước nhánh hoàn tác cho gọn nhóm phím có phím bổ trợ;
      // phần chặn "đang gõ trong ô nhập" nằm ở đầu hàm nên Cmd+C trong ô chữ vẫn
      // là chép chữ như thường.
      if (modifier && event.key.toLowerCase() === 'c') {
        if (!selectedClipId) return
        event.preventDefault()
        store.copyClip()
        return
      }

      if (modifier && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        store.pasteClip('Dán clip')
        return
      }

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }

      switch (event.key) {
        case ' ': {
          event.preventDefault()
          store.setPlaying(!store.isPlaying)
          return
        }
        case 'ArrowLeft': {
          event.preventDefault()
          store.setPlaying(false)
          // Shift nhảy nhanh hơn: mười frame một nhịp.
          store.setPlayhead(store.playheadUs - stepUs * (event.shiftKey ? 10 : 1))
          return
        }
        case 'ArrowRight': {
          event.preventDefault()
          store.setPlaying(false)
          store.setPlayhead(store.playheadUs + stepUs * (event.shiftKey ? 10 : 1))
          return
        }
        case 'Home': {
          event.preventDefault()
          store.setPlayhead(0)
          return
        }
        case 'Delete':
        case 'Backspace': {
          // Shift+Delete: ripple delete — xoá clip và kéo phần sau trên cùng track
          // lùi lên lấp chỗ trống.
          if (event.shiftKey) {
            event.preventDefault()
            rippleDeleteSelection('Ripple delete')
            return
          }
          // Xoá được cả clip lẫn khối chữ. Trước đây nhánh này chỉ nhìn
          // `clipIds`, nên chọn một câu phụ đề rồi bấm Delete thì không có gì
          // xảy ra và cũng không có gì báo vì sao.
          const removal = selectionRemovalCommands(store.selection)
          if (!removal) return
          event.preventDefault()
          store.run(removal.commands, removal.label)
          store.clearSelection()
          return
        }
        case 's':
        case 'S': {
          if (modifier || !selectedClipId) return
          event.preventDefault()
          store.run(
            [{ type: 'clip/split', clipId: selectedClipId, atUs: store.playheadUs }],
            'Cắt clip'
          )
          return
        }
        case 'd':
        case 'D': {
          if (!modifier || !selectedClipId) return
          event.preventDefault()
          store.run([{ type: 'clip/duplicate', clipId: selectedClipId }], 'Nhân bản clip')
          return
        }
        case '=':
        case '+': {
          event.preventDefault()
          store.setPixelsPerSecond(store.pixelsPerSecond * 1.4)
          return
        }
        case '-':
        case '_': {
          event.preventDefault()
          store.setPixelsPerSecond(store.pixelsPerSecond / 1.4)
          return
        }
        case 'Escape': {
          store.clearSelection()
          return
        }
      }

      // Chế độ công cụ timeline: phím đơn, không kèm phím bổ trợ (Cmd+R là tải lại…).
      const tool = TIMELINE_TOOL_KEYS[event.key.toLowerCase()]
      if (tool && !modifier && !event.altKey) {
        event.preventDefault()
        store.setTimelineTool(tool)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
