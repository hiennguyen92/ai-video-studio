import { pxToUs, usToPx } from './timeline-geometry'

/**
 * Chia dải filmstrip của một clip thành các Ô, mỗi ô là MỘT khung hình.
 *
 * Vì sao không kéo cả sprite cho vừa bề rộng clip (cách cũ): sprite có số khung
 * cố định trải trên toàn bộ asset, nên bề rộng mỗi khung trên màn hình bằng
 * bề_rộng_clip / số_khung — con số chẳng liên quan gì tới tỉ lệ khung hình. Clip
 * 4K dọc dài 2 phút ở zoom mặc định cho ra ô rộng 232px cao 55px, tức khung 9:16
 * bị kéo ngang gần 7 lần. Clip ngắn thì ngược lại: ô rộng 12px, khung bị bóp dẹt.
 *
 * Cách này đặt bề rộng ô bằng đúng bề rộng của khung hình khi nó cao bằng track,
 * rồi mỗi ô lấy khung gần thời điểm của nó nhất. Khung luôn hiện NGUYÊN VẸN và
 * đúng tỉ lệ.
 *
 * Hệ quả phải chấp nhận: ô hẹp hơn bước thời gian nên cần nhiều khung hơn số
 * sprite có — các ô cạnh nhau sẽ lặp lại cùng một khung. Đó là đánh đổi đúng:
 * một khung lặp vài lần vẫn nhìn ra cảnh gì, còn một lát cắt mỏng giữa khung
 * hay một khung bị kéo méo thì không.
 */

export interface FilmstripCell {
  leftPx: number
  widthPx: number
  /** Khung thứ mấy trong sprite. */
  tileIndex: number
}

export interface FilmstripLayoutInput {
  clipWidthPx: number
  pixelsPerSecond: number
  /** Điểm vào trong asset (micro giây, theo trục của asset). */
  sourceInUs: number
  speed: number
  assetDurationUs: number
  frameCount: number
  /** Rộng ÷ cao của khung nguồn. Bỏ trống khi probe không đọc được kích thước. */
  sourceAspect?: number
  trackHeightPx: number
}

/**
 * Trần số ô cho MỘT clip.
 *
 * Zoom sâu vào một clip dài cho ra hàng ngàn ô, mà phần lớn nằm ngoài màn hình —
 * trả giá bằng DOM cho thứ không ai thấy. Chạm trần thì ô nới rộng ra, khung bị
 * cắt bớt trên dưới; ở mức zoom đó mỗi khung đã rất to nên phần còn lại vẫn thừa
 * sức nhìn.
 *
 * 400 đủ để một clip dọc dài 4 phút hiện khung nguyên vẹn ở zoom mặc định, mà
 * vẫn chặn được trường hợp zoom kịch khung.
 */
const MAX_CELLS = 400

export function filmstripCells(input: FilmstripLayoutInput): FilmstripCell[] {
  const {
    clipWidthPx,
    pixelsPerSecond,
    sourceInUs,
    speed,
    assetDurationUs,
    frameCount,
    sourceAspect,
    trackHeightPx
  } = input

  if (clipWidthPx <= 0 || frameCount <= 0 || assetDurationUs <= 0 || pixelsPerSecond <= 0) {
    return []
  }

  // Bề rộng một khung nếu trải đều sprite trên toàn asset — tức bước THỜI GIAN.
  const pitchPx = usToPx(assetDurationUs / speed, pixelsPerSecond) / frameCount
  // Bề rộng khung hình khi nó cao bằng track: hiện nguyên khung, không cắt gì.
  const uprightPx = sourceAspect && sourceAspect > 0 ? trackHeightPx * sourceAspect : 0
  // Không đọc được kích thước nguồn thì lùi về cách cũ — bước thời gian.
  const cellWidthPx = uprightPx > 0 ? Math.max(uprightPx, clipWidthPx / MAX_CELLS) : pitchPx
  if (cellWidthPx <= 0) return []

  const count = Math.min(Math.ceil(clipWidthPx / cellWidthPx), MAX_CELLS)

  const cells: FilmstripCell[] = []
  for (let index = 0; index < count; index += 1) {
    // Lấy khung ở GIỮA ô: mép ô rơi đúng vào ranh giới hai khung, lấy mép sẽ
    // nhảy qua nhảy lại giữa hai khung khi zoom đổi một chút.
    const centerUs = sourceInUs + pxToUs((index + 0.5) * cellWidthPx, pixelsPerSecond) * speed
    const tileIndex = Math.min(
      frameCount - 1,
      Math.max(0, Math.floor((centerUs / assetDurationUs) * frameCount))
    )
    cells.push({ leftPx: index * cellWidthPx, widthPx: cellWidthPx, tileIndex })
  }
  return cells
}
