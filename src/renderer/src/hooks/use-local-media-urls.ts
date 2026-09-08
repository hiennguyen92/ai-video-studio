import { useEffect, useState } from 'react'
import { useEditorStore } from '../state/editor-store'

/**
 * URL http của media trong dự án đang mở.
 *
 * Remotion — cả Player lúc xem trước lẫn bộ dựng lúc xuất — chỉ nạp được `http://`,
 * không đọc được đường dẫn đĩa và cũng không biết scheme `avstudio-media://` của
 * Electron. Hook này đăng ký media với máy chủ cục bộ rồi giữ bảng URL.
 *
 * Đăng ký lại mỗi khi danh sách asset đổi: import thêm media hoặc AI tạo giọng đọc
 * đều sinh asset mới, thiếu bước này thì chúng không hiện trong preview.
 */
export function useLocalMediaUrls(): Record<string, string> {
  const assets = useEditorStore((state) => state.session?.document.assets)
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    // Đặt state trong nhánh bất đồng bộ, không đặt thẳng trong thân effect: gọi
    // setState đồng bộ ở đây sẽ kéo theo một lượt render thừa mỗi lần chạy.
    void (async () => {
      if (!assets || assets.length === 0) {
        if (!cancelled) setUrls({})
        return
      }

      const result = await window.api.media.registerLocal(
        assets.map((asset) => ({ id: asset.id, path: asset.source.path }))
      )
      if (!cancelled && result.ok) setUrls(result.data)
    })()

    return () => {
      cancelled = true
    }
  }, [assets])

  return urls
}
