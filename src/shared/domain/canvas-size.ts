import type { EditorCommand } from '../commands/editor-command-types'
import type { MediaAsset } from './media-asset-types'
import type { AspectRatio, ProjectDocument } from './project-document-types'

/**
 * Kích thước khung dự án.
 *
 * Trước đây mỗi tỉ lệ khoá cứng một bộ số 1080 (`ASPECT_RATIO_DIMENSIONS`), nên
 * nguồn 4K vào thì bản xuất vẫn ra 1080p và ô "Độ phân giải 100%" nói dối: 100%
 * đó là của KHUNG DỰ ÁN, không phải của nguồn.
 *
 * Phép tính nằm ở đây, một chỗ duy nhất, vì có ba nơi cần nó: ô chọn trên thanh
 * preview, công cụ `set_canvas` của agent, và bước khớp khung theo clip đầu tiên.
 */

/** Cạnh phải CHẴN: h264 với yuv420p không mã hoá được cạnh lẻ. */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Kích thước khung theo tỉ lệ và CẠNH DÀI.
 *
 * Trích từ `set_canvas` của bộ lập kế hoạch để agent và giao diện không tự tính
 * lấy hai bộ số khác nhau cho cùng một tỉ lệ.
 */
export function canvasSizeForLongEdge(
  aspect: AspectRatio,
  longEdgePx: number
): { width: number; height: number } {
  if (aspect === '9:16') return { width: even((longEdgePx * 9) / 16), height: even(longEdgePx) }
  if (aspect === '16:9') return { width: even(longEdgePx), height: even((longEdgePx * 9) / 16) }
  return { width: even(longEdgePx), height: even(longEdgePx) }
}

/**
 * Các mức độ phân giải chọn được trên giao diện, đặt tên theo CẠNH NGẮN.
 *
 * Cạnh ngắn mới là con số người ta quen gọi: "1080p" đúng cho cả 1920×1080 lẫn
 * 1080×1920, còn cạnh dài thì đổi theo hướng khung và không ai gọi thế.
 */
export const CANVAS_SHORT_EDGES = [720, 1080, 1440, 2160] as const
export type CanvasShortEdge = (typeof CANVAS_SHORT_EDGES)[number]

/** Cạnh dài ứng với một cạnh ngắn, theo tỉ lệ khung. */
export function longEdgeForShortEdge(aspect: AspectRatio, shortEdgePx: number): number {
  return aspect === '1:1' ? shortEdgePx : Math.round((shortEdgePx * 16) / 9)
}

/** Cạnh ngắn của một khung — dùng để biết ô chọn đang ở mức nào. */
export function shortEdgeOf(size: { width: number; height: number }): number {
  return Math.min(size.width, size.height)
}

/**
 * Tỉ lệ khung gần nhất với một nguồn.
 *
 * Dự án chỉ có ba tỉ lệ, nên nguồn 4:3 hay 2:1 phải quy về cái gần nhất. Ngưỡng
 * đặt lệch hẳn về phía vuông: 4:3 (1,33) là khung NGANG, quy về 1:1 thì tự dưng
 * cắt mất hai bên của thứ người dùng vừa quay.
 */
export function aspectForSource(width: number, height: number): AspectRatio {
  const ratio = width / Math.max(1, height)
  if (ratio > 1.15) return '16:9'
  if (ratio < 0.87) return '9:16'
  return '1:1'
}

/** Cạnh ngắn cao nhất mà khung dự án tự nhận theo nguồn. */
const MAX_AUTO_SHORT_EDGE = 2160

/**
 * Cạnh ngắn THẤP NHẤT mà khung dự án tự nhận theo nguồn.
 *
 * Khung chỉ đi LÊN theo nguồn, không đi xuống. Lý do không nằm ở số điểm ảnh mà ở
 * cỡ CHỮ: chữ overlay mặc định 84px và phụ đề 48px đều tính bằng pixel của khung,
 * và chúng được chọn cho khung cao 1080. Hạ khung xuống 360 thì 84px thành 23%
 * chiều cao khung thay vì 7,8% — chữ tràn ra ngoài, khung nền bị bóp méo, và người
 * dùng không hiểu vì sao chỉ mình dự án này chữ to bất thường.
 *
 * Đổi lại, nguồn 720p bị phóng nhẹ lên 1080. Đó là cái giá rẻ hơn nhiều.
 */
const MIN_AUTO_SHORT_EDGE = 1080

/**
 * Khung dự án khớp với một nguồn: đúng hướng, đúng độ phân giải.
 *
 * Chặn trên ở 4K: mỗi tab dựng ngốn bộ nhớ theo số điểm ảnh, tự nhảy lên 8K là tự
 * làm máy người dùng quỳ. Chặn dưới ở 1080 vì cỡ chữ mặc định tính theo pixel khung
 * — xem `MIN_AUTO_SHORT_EDGE`.
 *
 * Nên bước này chỉ NÂNG khung lên cho khớp nguồn, và luôn sửa HƯỚNG khung cho đúng.
 */
export function canvasSizeForSource(
  width: number,
  height: number
): { aspectRatio: AspectRatio; width: number; height: number } {
  const aspectRatio = aspectForSource(width, height)
  const shortEdge = Math.min(
    Math.max(Math.min(width, height), MIN_AUTO_SHORT_EDGE),
    MAX_AUTO_SHORT_EDGE
  )
  return {
    aspectRatio,
    ...canvasSizeForLongEdge(aspectRatio, longEdgeForShortEdge(aspectRatio, shortEdge))
  }
}

/** Track có clip hình nào chưa. */
function hasVisualClip(document: ProjectDocument): boolean {
  return document.tracks.some(
    (track) => (track.kind === 'video' || track.kind === 'image') && track.clips.length > 0
  )
}

/**
 * Lệnh khớp khung dự án theo clip hình ĐẦU TIÊN đặt lên timeline.
 *
 * Chỉ chạy khi timeline còn trống hẳn. Clip thứ hai mà vẫn đổi khung là đổi thứ
 * người dùng đã nhìn thấy và đã chấp nhận — tệ hơn nữa, nó dời chỗ mọi chữ và
 * mọi clip đã dựng.
 *
 * Trả mảng rỗng khi không cần đổi: nguồn không có kích thước (file âm thanh, hay
 * probe đọc hụt), hoặc khung đang dùng vốn đã khớp rồi.
 */
export function matchCanvasToSourceCommands(
  document: ProjectDocument,
  asset: MediaAsset
): EditorCommand[] {
  if (asset.kind !== 'video' && asset.kind !== 'image') return []
  const { width, height } = asset.probe
  if (!width || !height) return []
  if (hasVisualClip(document)) return []

  const wanted = canvasSizeForSource(width, height)
  const current = document.settings
  if (
    current.width === wanted.width &&
    current.height === wanted.height &&
    current.aspectRatio === wanted.aspectRatio
  ) {
    return []
  }
  return [{ type: 'project/set-settings', settings: wanted }]
}
