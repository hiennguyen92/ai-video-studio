/**
 * Chọn file rác trong một dự án — phần thuần, không đụng đĩa.
 *
 * "Rác" ở đây là file do ứng dụng SINH RA mà không còn ai trỏ tới: giọng đọc và
 * nhạc của những asset đã xoá, thumbnail và waveform của asset không còn tồn tại.
 *
 * File NGƯỜI DÙNG nhập vào không nằm trong diện này và không thể nằm: nhập media
 * không sao chép file, `source.path` trỏ thẳng tới chỗ gốc ngoài thư mục dự án.
 *
 * Tách khỏi phần xoá thật để quyết định "xoá cái gì" kiểm được bằng test mà không
 * cần dựng cả một thư mục dự án — và quan trọng hơn, không cần rủi ro xoá nhầm
 * để phát hiện là mình chọn sai.
 */

export interface ProjectFileEntry {
  path: string
  /** Tên riêng trong thư mục, dùng để đối chiếu với id asset. */
  name: string
  sizeBytes: number
}

export interface GarbageSelection {
  /** File trong thư mục media không còn asset nào trỏ tới. */
  media: ProjectFileEntry[]
  /** File cache mang id của asset đã bị xoá. */
  cache: ProjectFileEntry[]
}

/**
 * File cache PHẢI giữ dù không mang id asset nào.
 *
 * `job-results.json` là chỉ mục dùng lại kết quả; xoá nó khiến mọi thứ đã sinh
 * bị sinh lại, và với provider tính tiền thì đó là tiền mất thật.
 */
const PROTECTED_CACHE_NAMES = new Set(['job-results.json'])

/**
 * Dấu hiệu một file cache thuộc về một asset, ví dụ `asset_abc-thumb.jpg` hay
 * `shots-asset_abc.json`.
 */
const ASSET_KEYED_MARKER = 'asset_'

export function selectProjectGarbage(options: {
  mediaFiles: ProjectFileEntry[]
  cacheEntries: ProjectFileEntry[]
  /** Mọi đường dẫn mà asset đang trỏ tới: nguồn, thumbnail, filmstrip, waveform, cú máy. */
  referencedPaths: Iterable<string>
  liveAssetIds: Iterable<string>
}): GarbageSelection {
  const referenced = new Set(options.referencedPaths)
  const live = new Set(options.liveAssetIds)

  const media = options.mediaFiles.filter((file) => !referenced.has(file.path))

  const cache = options.cacheEntries.filter((entry) => {
    if (PROTECTED_CACHE_NAMES.has(entry.name)) return false
    if (referenced.has(entry.path)) return false

    // Chỉ đụng vào file MANG id asset. File cache kiểu khác — kể cả loại thêm sau
    // này mà chỗ dọn rác chưa biết — được để nguyên; dọn nhầm một thứ mình không
    // hiểu là cách nhanh nhất để hỏng một tính năng khác.
    if (!entry.name.includes(ASSET_KEYED_MARKER)) return false

    // Đối chiếu bằng cách TÌM CHUỖI CON, không tách id ra khỏi tên. Tách id phải
    // đoán trước bộ ký tự của id, và đoán hụt một ký tự là xoá nhầm file đang
    // dùng — id chứa dấu gạch dưới đã đủ làm hỏng cách đó.
    //
    // Đánh đổi đã biết: id này là tiền tố của id kia thì file rác có thể được giữ
    // lại. Giữ nhầm rác chỉ tốn chỗ; xoá nhầm thì mất dữ liệu.
    return ![...live].some((id) => entry.name.includes(id))
  })

  return { media, cache }
}

export function totalBytes(selection: GarbageSelection): number {
  return [...selection.media, ...selection.cache].reduce(
    (total, entry) => total + entry.sizeBytes,
    0
  )
}
