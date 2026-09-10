/**
 * Hình học thuần cho khung nền chữ: sinh chuỗi `d` của path, không biết gì về màu.
 *
 * Tách khỏi `text-frame-svg-builders` vì hai thứ đổi vì hai lý do khác nhau — sửa
 * dáng khung là sửa file này, đổi cách tô màu hay cách bọc data URI là sửa bên
 * kia. Và gộp lại thì chắc chắn vượt 200 dòng.
 *
 * MỌI hình vẽ trong lưới 120×120, góc chiếm 40 đơn vị mỗi bên. Cạnh lặp lại nằm
 * ĐÚNG trong khoảng 40..80: đó là ô mép mà `border-image` lát gạch, nên hai đầu
 * của nó phải trùng cao độ, nếu không chỗ nối giữa hai viên gạch lộ ra vết gãy.
 */

export const TEXT_FRAME_VIEWBOX = 120

/** Cắt số cho URI ngắn lại. Data URI đi vào từng khung hình nên độ dài có giá. */
export const n = (value: number): string => String(Math.round(value * 10) / 10)

/**
 * Một cạnh gồ ghề, dùng cho giấy xé và nét vẽ tay.
 *
 * `amps` là biên độ nhô ra tại từng bước, tính theo hướng pháp tuyến `(outX,outY)`.
 * **Phần tử cuối phải bằng 0**: bước cuối phải rơi đúng vào điểm kết thúc, lệch
 * ra là hai viên gạch mép nối vào nhau hở.
 */
export function raggedEdge(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  outX: number,
  outY: number,
  amps: number[]
): string {
  let path = ''
  for (let i = 0; i < amps.length; i++) {
    const t = (i + 1) / amps.length
    path += `L${n(x0 + (x1 - x0) * t + outX * amps[i])},${n(y0 + (y1 - y0) * t + outY * amps[i])}`
  }
  return path
}

/** Ngôi sao bốn cánh, dùng cho cả viền lấp lánh lẫn điểm trang trí. */
export function star(cx: number, cy: number, outer: number, inner: number): string {
  return (
    `M${n(cx)},${n(cy - outer)}L${n(cx + inner)},${n(cy - inner)}L${n(cx + outer)},${n(cy)}` +
    `L${n(cx + inner)},${n(cy + inner)}L${n(cx)},${n(cy + outer)}L${n(cx - inner)},${n(cy + inner)}` +
    `L${n(cx - outer)},${n(cy)}L${n(cx - inner)},${n(cy - inner)}Z`
  )
}

export function roundedRect(inset: number, radius: number): string {
  const far = TEXT_FRAME_VIEWBOX - inset
  return (
    `M${n(inset + radius)},${n(inset)}H${n(far - radius)}` +
    `A${n(radius)},${n(radius)} 0 0 1 ${n(far)},${n(inset + radius)}` +
    `V${n(far - radius)}A${n(radius)},${n(radius)} 0 0 1 ${n(far - radius)},${n(far)}` +
    `H${n(inset + radius)}A${n(radius)},${n(radius)} 0 0 1 ${n(inset)},${n(far - radius)}` +
    `V${n(inset + radius)}A${n(radius)},${n(radius)} 0 0 1 ${n(inset + radius)},${n(inset)}Z`
  )
}

/**
 * Mây: mỗi cạnh một bướu tròn nằm gọn trong ô mép, mỗi góc một cung tròn.
 *
 * Bướu chiếm ĐÚNG ô mép 40..80 nên lát gạch ra một dãy bướu liền nhau, và tiếp
 * tuyến ở hai đầu bướu thẳng đứng nên chỗ nối không lộ vết.
 */
export const cloudPath =
  'M24,40A16,16 0 0 1 40,24A20,20 0 0 1 80,24A16,16 0 0 1 96,40' +
  'A20,20 0 0 1 96,80A16,16 0 0 1 80,96A20,20 0 0 1 40,96' +
  'A16,16 0 0 1 24,80A20,20 0 0 1 24,40Z'

/**
 * Giấy xé: răng to và KHÔNG đều.
 *
 * Răng đều nhau thì mắt đọc ra "nét chấm chấm" chứ không ra giấy rách — đây là
 * lỗi của bản vẽ đầu, sửa bằng cách cho biên độ chênh nhau nhiều. Góc cũng phải
 * gồ ghề: một góc vát thẳng giữa hai cạnh rách nhìn ra hình cắt bằng kéo.
 */
const RANG_CANH = [15, 4, 17, 0]
const RANG_GOC = [9, 0]
const CHEO = 0.7 // pháp tuyến của cạnh chéo ở góc, xấp xỉ 1/√2

export const tornPath =
  'M20,40' +
  raggedEdge(40, 20, 80, 20, 0, -1, RANG_CANH) +
  raggedEdge(80, 20, 100, 40, CHEO, -CHEO, RANG_GOC) +
  raggedEdge(100, 40, 100, 80, 1, 0, RANG_CANH) +
  raggedEdge(100, 80, 80, 100, CHEO, CHEO, RANG_GOC) +
  raggedEdge(80, 100, 40, 100, 0, 1, RANG_CANH) +
  raggedEdge(40, 100, 20, 80, -CHEO, CHEO, RANG_GOC) +
  raggedEdge(20, 80, 20, 40, -1, 0, RANG_CANH) +
  raggedEdge(20, 40, 40, 20, -CHEO, -CHEO, RANG_GOC) +
  'Z'

/**
 * Nét vẽ tay: cạnh run nhẹ, góc vẫn là cung tròn.
 *
 * Biên độ đổi DẤU — nét vẽ tay lệch qua lệch lại quanh đường thẳng, chứ không nhô
 * hẳn ra một phía như răng giấy xé.
 *
 * Và ÍT bước thôi. Một viên gạch mép chỉ rộng đúng bằng bề dày viền, nên sáu bước
 * nhồi vào đó ra bước sóng chừng 4px — mắt đọc thành gợn sóng lăn tăn, gần giống
 * giấy xé chứ không giống nét vẽ tay. Ba bước cho bước sóng dài gấp đôi.
 */
const RUN = [3.6, -3, 0]

export function wobblyRect(inset: number, radius: number): string {
  const far = TEXT_FRAME_VIEWBOX - inset
  const r = n(radius)
  const cung = (x: number, y: number): string => `A${r},${r} 0 0 1 ${n(x)},${n(y)}`
  return (
    `M${n(inset)},${n(inset + radius)}${cung(inset + radius, inset)}L40,${n(inset)}` +
    raggedEdge(40, inset, 80, inset, 0, -1, RUN) +
    `L${n(far - radius)},${n(inset)}${cung(far, inset + radius)}L${n(far)},40` +
    raggedEdge(far, 40, far, 80, 1, 0, RUN) +
    `L${n(far)},${n(far - radius)}${cung(far - radius, far)}L80,${n(far)}` +
    raggedEdge(80, far, 40, far, 0, 1, RUN) +
    `L${n(inset + radius)},${n(far)}${cung(inset, far - radius)}L${n(inset)},80` +
    raggedEdge(inset, 80, inset, 40, -1, 0, RUN) +
    `L${n(inset)},${n(inset + radius)}Z`
  )
}

/**
 * Sao rải dọc cạnh cho viền lấp lánh.
 *
 * To hơn hẳn bản đầu và mỗi ô mép hai cỡ khác nhau: sao nhỏ đều tăm tắp thì mắt
 * đọc ra dấu cộng, không ra lấp lánh. Sao nằm trong ô mép nên lát gạch ra cả dãy.
 */
export function sparkleEdges(): string {
  return (
    star(60, 12, 14, 3.5) +
    star(108, 60, 14, 3.5) +
    star(60, 108, 14, 3.5) +
    star(12, 60, 14, 3.5) +
    star(13, 13, 9, 2.5) +
    star(107, 13, 9, 2.5) +
    star(107, 107, 9, 2.5) +
    star(13, 107, 9, 2.5)
  )
}
