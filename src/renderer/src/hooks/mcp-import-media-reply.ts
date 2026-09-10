import type { ImportOutcome } from './use-media-import'

/**
 * Trả lời của công cụ `import_media`, và chốt chặn đường dẫn.
 *
 * Ở file riêng vì đây là hàm THUẦN: kiểm thử được mà không cần dựng app, khác
 * hẳn phần còn lại của cầu MCP vốn phải có `window.api` và một dự án đang mở.
 */

/**
 * Đường dẫn TƯƠNG ĐỐI không có nghĩa ở đây: agent chạy ở thư mục của nó, tiến
 * trình main lại ở thư mục khác. Chặn sớm và nói rõ, thay vì để nó thành lỗi
 * "không tìm thấy file" mà agent sẽ đi sửa nhầm chỗ.
 */
export function relativePaths(filePaths: string[]): string[] {
  return filePaths.filter((path) => !path.startsWith('/'))
}

/**
 * Kết quả nhập media, viết cho agent đọc.
 *
 * Trả về ID của asset vừa nhập là phần quan trọng nhất: không có nó thì agent
 * phải gọi `list_media` thêm một lượt mới đặt được clip lên timeline.
 *
 * File trùng cũng phải nói ra kèm id của bản đã có — im lặng bỏ qua thì agent
 * tưởng nhập hỏng và đi nhập lại.
 */
export function formatImportOutcome(outcome: ImportOutcome | null): string {
  if (!outcome) return 'Chưa mở dự án nào, hoặc không có đường dẫn nào để nhập.'

  const lines: string[] = []
  if (outcome.assets.length > 0) {
    lines.push(`Đã nhập ${outcome.assets.length} file:`)
    for (const asset of outcome.assets) {
      const seconds = asset.probe?.durationUs
        ? ` ${(asset.probe.durationUs / 1_000_000).toFixed(2)}s`
        : ''
      const audio = asset.probe?.hasAudio ? ' +audio' : ''
      lines.push(`- id=${asset.id} ${asset.kind} "${asset.name}"${seconds}${audio}`)
    }
  }
  for (const duplicate of outcome.duplicates) {
    lines.push(`- bỏ qua (đã có trong dự án, id=${duplicate.existingAssetId}): ${duplicate.path}`)
  }
  for (const failure of outcome.failures) {
    lines.push(`- hỏng: ${failure.path} — ${failure.error}`)
  }
  if (lines.length === 0) return 'Không nhập được file nào.'

  lines.push('', 'Dùng insert_clip với id ở trên để đặt lên timeline.')
  return lines.join('\n')
}
