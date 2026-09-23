import { describe, expect, it } from 'vitest'
import { carriesFiles, droppedFilePaths } from './use-file-drop'

/**
 * Kéo file từ hệ điều hành thả vào khu Media.
 *
 * Hai chỗ dễ sai, và cả hai đều hỏng âm thầm:
 *
 *   - Nhận nhầm thứ đang kéo: thẻ chuyển cảnh trong Library cũng là thao tác kéo,
 *     mà nó không mang file nào.
 *   - Nhập đường dẫn rỗng: thả ảnh từ trang web hay clipboard vẫn sinh ra `File`
 *     nhưng không có file trên đĩa, và lỗi nổ tít sâu trong đường nhập media.
 */

const file = (name: string): File => ({ name }) as File

describe('nhận đúng thứ đang kéo', () => {
  it('chỉ nhận khi thao tác kéo có mang file', () => {
    expect(carriesFiles(['Files'])).toBe(true)
    expect(carriesFiles(['Files', 'text/plain'])).toBe(true)
  })

  it('bỏ qua thẻ kéo trong chính ứng dụng', () => {
    // Kéo thẻ chuyển cảnh từ Library cũng là dragover; nhận nhầm thì khu Media
    // sáng lên mời thả một thứ nó không nhập được.
    expect(carriesFiles(['application/x-ai-video-studio-transition'])).toBe(false)
    expect(carriesFiles([])).toBe(false)
  })
})

describe('đường dẫn của file được thả', () => {
  it('lấy đúng đường dẫn thật', () => {
    const paths = droppedFilePaths([file('a.mp4'), file('b.mov')], (f) => `/media/${f.name}`)
    expect(paths).toEqual(['/media/a.mp4', '/media/b.mov'])
  })

  it('bỏ thứ không có file trên đĩa', () => {
    const paths = droppedFilePaths([file('a.mp4'), file('web.png')], (f) =>
      f.name === 'web.png' ? '' : `/media/${f.name}`
    )
    expect(paths).toEqual(['/media/a.mp4'])
  })

  it('thả toàn thứ không có đường dẫn thì không nhập gì', () => {
    expect(droppedFilePaths([file('web.png')], () => '')).toEqual([])
  })
})
