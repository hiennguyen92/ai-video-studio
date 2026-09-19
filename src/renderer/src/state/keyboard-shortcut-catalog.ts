import { TIMELINE_TOOL_KEYS } from './timeline-tool-keys'

/**
 * Bảng phím tắt để HIỂN THỊ — cho bảng trợ giúp (phím `?`).
 *
 * Nằm cạnh `use-keyboard-shortcuts` và phải đổi cùng lúc với nó. Phím chọn công cụ
 * đọc thẳng từ `TIMELINE_TOOL_KEYS`, nên thêm công cụ là bảng tự có dòng mới.
 *
 * `mod` là ⌘ trên macOS, Ctrl ở nơi khác — đúng như bộ xử lý phím nhận cả hai.
 */

export type ShortcutGroupKey = 'playback' | 'editing' | 'markers' | 'tools' | 'app'

export interface ShortcutEntry {
  /** Các phím bấm cùng lúc; `mod` được đổi thành ⌘ hoặc Ctrl lúc hiển thị. */
  keys: string[]
  /** Khoá mô tả trong từ điển (`t.shortcuts.*`). */
  label: string
}

export const SHORTCUT_GROUPS: Array<{ group: ShortcutGroupKey; entries: ShortcutEntry[] }> = [
  {
    group: 'playback',
    entries: [
      { keys: ['Space'], label: 'playPause' },
      { keys: ['←', '→'], label: 'stepFrame' },
      { keys: ['Shift', '← →'], label: 'stepTenFrames' },
      { keys: ['Home'], label: 'goToStart' },
      { keys: ['+', '−'], label: 'zoom' }
    ]
  },
  {
    group: 'editing',
    entries: [
      { keys: ['S'], label: 'split' },
      { keys: ['Delete'], label: 'delete' },
      { keys: ['Shift', 'Delete'], label: 'rippleDelete' },
      { keys: ['mod', 'D'], label: 'duplicate' },
      { keys: ['mod', 'C'], label: 'copy' },
      { keys: ['mod', 'V'], label: 'paste' },
      { keys: ['mod', 'G'], label: 'group' },
      { keys: ['mod', 'Shift', 'G'], label: 'ungroup' },
      { keys: ['Shift', 'Click'], label: 'addToSelection' },
      { keys: ['mod', 'Z'], label: 'undo' },
      { keys: ['mod', 'Shift', 'Z'], label: 'redo' },
      { keys: ['Esc'], label: 'deselect' }
    ]
  },
  {
    group: 'markers',
    entries: [
      { keys: ['M'], label: 'addMarker' },
      { keys: ['Shift', 'M'], label: 'nextMarker' },
      { keys: ['mod', 'Shift', 'M'], label: 'previousMarker' }
    ]
  },
  {
    group: 'tools',
    entries: Object.entries(TIMELINE_TOOL_KEYS).map(([key, tool]) => ({
      keys: [key.toUpperCase()],
      label: `tool:${tool}`
    }))
  },
  {
    group: 'app',
    entries: [{ keys: ['?'], label: 'showShortcuts' }]
  }
]

/** Đổi `mod` thành phím của nền tảng. */
export function displayKey(key: string, platform: string): string {
  if (key !== 'mod') return key
  return platform === 'darwin' ? '⌘' : 'Ctrl'
}

/** Sự kiện mở bảng phím tắt — phím `?` và nút trên thanh trên cùng cùng phát nó. */
export const SHOW_SHORTCUTS_EVENT = 'avs:show-shortcuts'
