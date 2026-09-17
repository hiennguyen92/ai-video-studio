/**
 * Chia một ảnh khung thành các mảnh 9-slice và tính chỗ đặt từng mảnh, bằng
 * PIXEL NGUYÊN.
 *
 * Vì sao không dùng `border-image` của CSS cho khung ảnh: trình duyệt vẽ chín
 * mảnh rời tại toạ độ lẻ, và mép hai mảnh kề nhau hoặc hở (lộ footage) hoặc chồng
 * (sáng lên thành vệt) — nhìn rõ trên xem trước, ở mọi độ đệm. Đặt mọi mảnh vào
 * toạ độ nguyên trên MỘT canvas thì mép mảnh này là mép mảnh kia, không hở không
 * chồng.
 *
 * Hàm thuần, không đụng DOM, để kiểm được tính khít bằng test.
 */

export type NineSliceRepeat = 'stretch' | 'round'

export interface NineSliceDraw {
  /** Vùng lấy trong ảnh gốc. */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Vùng vẽ trên canvas, số nguyên. */
  dx: number
  dy: number
  dw: number
  dh: number
}

/**
 * Chia đoạn `[start, end)` thành `count` khúc có mép là số nguyên.
 *
 * Làm tròn MÉP chứ không làm tròn độ dài: làm tròn độ dài thì sai số cộng dồn và
 * khúc cuối hụt hoặc tràn khỏi đoạn.
 */
function splitSpan(start: number, end: number, count: number): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (let index = 0; index < count; index++) {
    const from = Math.round(start + ((end - start) * index) / count)
    const to = Math.round(start + ((end - start) * (index + 1)) / count)
    if (to > from) spans.push([from, to])
  }
  return spans
}

/**
 * Số viên lát theo kiểu `round` của CSS: bao nhiêu viên nguyên vừa đoạn, co giãn
 * nhẹ từng viên cho khít. `stretch` thì luôn một viên kéo dài.
 */
function tileCount(length: number, naturalTile: number, repeat: NineSliceRepeat): number {
  if (repeat === 'stretch' || naturalTile <= 0) return 1
  return Math.max(1, Math.round(length / naturalTile))
}

export function layoutNineSlice(input: {
  imageWidth: number
  imageHeight: number
  /** Bề rộng góc trong ảnh gốc, cùng giá trị cho bốn cạnh. */
  slicePx: number
  canvasWidth: number
  canvasHeight: number
  /** Bề rộng góc trên canvas. */
  borderPx: number
  repeat: NineSliceRepeat
}): NineSliceDraw[] {
  const { imageWidth, imageHeight, slicePx, repeat } = input
  const width = Math.max(0, Math.round(input.canvasWidth))
  const height = Math.max(0, Math.round(input.canvasHeight))
  // Khối quá nhỏ so với góc thì thu góc lại, như CSS làm, để bốn góc không đè nhau.
  const border = Math.max(
    0,
    Math.min(Math.round(input.borderPx), Math.floor(width / 2), Math.floor(height / 2))
  )

  const sourceMidW = imageWidth - 2 * slicePx
  const sourceMidH = imageHeight - 2 * slicePx
  const scale = slicePx > 0 ? border / slicePx : 0

  // Cột và hàng: [vùng nguồn, danh sách khúc đích].
  const columns: Array<{ sx: number; sw: number; spans: Array<[number, number]> }> = [
    { sx: 0, sw: slicePx, spans: splitSpan(0, border, 1) },
    {
      sx: slicePx,
      sw: sourceMidW,
      spans: splitSpan(
        border,
        width - border,
        tileCount(width - 2 * border, sourceMidW * scale, repeat)
      )
    },
    { sx: imageWidth - slicePx, sw: slicePx, spans: splitSpan(width - border, width, 1) }
  ]
  const rows: Array<{ sy: number; sh: number; spans: Array<[number, number]> }> = [
    { sy: 0, sh: slicePx, spans: splitSpan(0, border, 1) },
    {
      sy: slicePx,
      sh: sourceMidH,
      spans: splitSpan(
        border,
        height - border,
        tileCount(height - 2 * border, sourceMidH * scale, repeat)
      )
    },
    { sy: imageHeight - slicePx, sh: slicePx, spans: splitSpan(height - border, height, 1) }
  ]

  const draws: NineSliceDraw[] = []
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, column] of columns.entries()) {
      // Ruột luôn kéo dài một viên: ruột ảnh đồng màu, lát gạch chỉ thêm mối nối.
      const isCenter = rowIndex === 1 && columnIndex === 1
      const xSpans = isCenter ? splitSpan(border, width - border, 1) : column.spans
      const ySpans = isCenter ? splitSpan(border, height - border, 1) : row.spans
      for (const [dy, dyEnd] of ySpans) {
        for (const [dx, dxEnd] of xSpans) {
          draws.push({
            sx: column.sx,
            sy: row.sy,
            sw: column.sw,
            sh: row.sh,
            dx,
            dy,
            dw: dxEnd - dx,
            dh: dyEnd - dy
          })
        }
      }
    }
  }
  return draws.filter((draw) => draw.sw > 0 && draw.sh > 0 && draw.dw > 0 && draw.dh > 0)
}
