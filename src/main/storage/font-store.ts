import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Kho font dùng cho việc NUNG phụ đề vào video.
 *
 * Vì sao phải chép file font ra: preview vẽ bằng Chromium nên chỉ cần tên họ
 * font là đủ, nhưng bản nung đi qua libass của ffmpeg — nó tra font bằng
 * fontconfig, và bản ffmpeg đi kèm không nhất thiết thấy font hệ thống của máy.
 * Không tìm thấy thì libass LẶNG LẼ rơi về một font mặc định, và bản xuất khác
 * hẳn bản xem trước.
 *
 * Nên renderer đọc chính byte của font đã chọn (qua Local Font Access API) rồi
 * gửi sang đây; lúc nung, ffmpeg được chỉ thẳng vào thư mục này.
 *
 * Kho nằm ở cấp userData chứ không theo từng dự án: cùng một font dùng cho nhiều
 * dự án thì không có lý do chép nhiều lần.
 */

export interface StoredFont {
  /** Đường dẫn file font đã lưu. */
  path: string
  /** Thư mục chứa, để truyền cho `fontsdir` của ffmpeg. */
  directory: string
}

export function fontsDirectory(): string {
  return join(app.getPath('userData'), 'fonts')
}

/** Tên file an toàn, không phụ thuộc tên họ font vốn có thể chứa dấu và khoảng trắng. */
function fileNameFor(family: string, bytes: Uint8Array): string {
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const slug = family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'font'}-${digest}.ttf`
}

export async function storeFontForBurnIn(family: string, bytes: Uint8Array): Promise<StoredFont> {
  const directory = fontsDirectory()
  await mkdir(directory, { recursive: true })

  const path = join(directory, fileNameFor(family, bytes))
  // Tên file mang sẵn mã băm nội dung, nên file đã có nghĩa là đúng font đó.
  if (!existsSync(path)) await writeFile(path, bytes)

  return { path, directory }
}
