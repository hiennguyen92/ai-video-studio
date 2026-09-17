import type { TimelineTool } from './editor-store'

/**
 * Phím tắt chọn chế độ công cụ timeline, theo quen tay của các trình dựng phổ biến:
 * V chọn, T trim, Y slip, R rate stretch, B blade. (S vẫn là cắt clip đang chọn tại
 * đầu phát.)
 */
export const TIMELINE_TOOL_KEYS: Record<string, TimelineTool> = {
  v: 'select',
  t: 'trim',
  y: 'slip',
  r: 'rate-stretch',
  b: 'blade'
}
