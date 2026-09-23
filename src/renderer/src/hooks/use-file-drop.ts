import { useCallback, useRef, useState, type DragEvent } from 'react'

/**
 * Nhận file kéo từ hệ điều hành thả vào một vùng.
 *
 * Đường dẫn thật phải hỏi qua preload: từ Electron 32, `File.path` đã bị gỡ khỏi
 * renderer. Hỏi NGAY trong nhịp xử lý `drop` — `dataTransfer` chỉ sống trong đúng
 * nhịp đó, đợi tới `await` đầu tiên là danh sách file rỗng.
 */

/** Có phải thứ đang kéo là file từ hệ điều hành không, hay chỉ là thẻ trong app. */
export function carriesFiles(types: readonly string[]): boolean {
  return Array.from(types).includes('Files')
}

/**
 * Đường dẫn thật của những file vừa được thả, bỏ qua thứ không có file trên đĩa.
 *
 * Thả ảnh từ một trang web hay từ clipboard vẫn sinh ra `File`, nhưng nó không
 * nằm trên đĩa nên Electron trả về chuỗi rỗng. Nhập chuỗi rỗng thì lỗi nổ ở tít
 * sâu trong đường nhập media, chỗ không ai đoán ra nguyên nhân.
 */
export function droppedFilePaths(
  files: readonly File[],
  pathFor: (file: File) => string
): string[] {
  return files.map(pathFor).filter((path) => path.length > 0)
}

export function useFileDrop(onFiles: (paths: string[]) => void): {
  /** `true` khi đang rê file lên trên vùng nhận. */
  active: boolean
  dropProps: {
    onDragEnter(event: DragEvent): void
    onDragOver(event: DragEvent): void
    onDragLeave(event: DragEvent): void
    onDrop(event: DragEvent): void
  }
} {
  const [active, setActive] = useState(false)
  // Rê qua phần tử con sinh ra dragenter/dragleave lồng nhau; đếm để vùng nhận
  // không nhấp nháy mỗi lần con trỏ đi qua một cái thẻ bên trong.
  const depth = useRef(0)

  const reset = useCallback((): void => {
    depth.current = 0
    setActive(false)
  }, [])

  return {
    active,
    dropProps: {
      onDragEnter: (event) => {
        if (!carriesFiles(event.dataTransfer.types)) return
        event.preventDefault()
        depth.current += 1
        setActive(true)
      },
      onDragOver: (event) => {
        if (!carriesFiles(event.dataTransfer.types)) return
        // Không chặn ở đây thì trình duyệt từ chối cú thả, và `drop` không bao giờ chạy.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (event) => {
        if (!carriesFiles(event.dataTransfer.types)) return
        depth.current -= 1
        if (depth.current <= 0) reset()
      },
      onDrop: (event) => {
        if (!carriesFiles(event.dataTransfer.types)) return
        event.preventDefault()
        reset()
        const paths = droppedFilePaths(Array.from(event.dataTransfer.files), (file) =>
          window.api.media.pathForFile(file)
        )
        if (paths.length > 0) onFiles(paths)
      }
    }
  }
}
