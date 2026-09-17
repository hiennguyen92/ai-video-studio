import type { SubtitleAlignment } from './subtitle-types'

/**
 * Đặt chỗ cho khối chữ: neo theo alignment, hoặc thả tự do ở một điểm bất kỳ.
 *
 * Gom về đây vì CÙNG những quyết định này phải ra kết quả giống nhau ở hai nơi
 * hoàn toàn khác nhau — CSS của bản xem trước và thẻ ghi đè của file ASS lúc nung
 * (DESCRIPTION §4). Để mỗi bên tự suy ra là mở đường cho chuyện chữ nằm một chỗ
 * trên preview và một chỗ khác trong file xuất ra, mà cả hai đều "chạy" nên
 * chẳng có gì báo lỗi.
 */

/**
 * Tâm khối chữ, tính theo PHẦN của khung hình (0..1).
 *
 * Dùng tỉ lệ chứ không dùng pixel: dự án đổi độ phân giải khi xuất thì chữ vẫn
 * nằm đúng chỗ tương đối, còn pixel sẽ trôi đi.
 */
export interface TextPosition {
  xPct: number
  yPct: number
}

/** Kéo ra ngoài khung thì kẹp lại — chữ rơi khỏi hình là mất hẳn, không lấy lại được. */
export function clampTextPosition(position: TextPosition): TextPosition {
  return {
    xPct: Math.min(1, Math.max(0, position.xPct)),
    yPct: Math.min(1, Math.max(0, position.yPct))
  }
}

/** Alignment kiểu bàn phím số của ASS đổi thành cặp giá trị của flexbox. */
export function alignmentToFlex(alignment: SubtitleAlignment): {
  vertical: 'flex-start' | 'center' | 'flex-end'
  horizontal: 'flex-start' | 'center' | 'flex-end'
} {
  return {
    // 1–3 dưới, 4–6 giữa, 7–9 trên.
    vertical: alignment >= 7 ? 'flex-start' : alignment >= 4 ? 'center' : 'flex-end',
    // 1,4,7 trái · 2,5,8 giữa · 3,6,9 phải.
    horizontal: alignment % 3 === 1 ? 'flex-start' : alignment % 3 === 2 ? 'center' : 'flex-end'
  }
}

/**
 * `transform-origin` cho khối chữ.
 *
 * Phải khớp điểm mà ASS xoay quanh, và ASS xoay quanh ĐIỂM NEO của alignment chứ
 * không quanh tâm khối. Đo bằng ffmpeg thật trên khung 600×400, chữ xoay 30°:
 * alignment 5 thì trọng tâm đứng yên; alignment 2 thì trọng tâm dịch (+28,−22);
 * alignment 8 thì dịch (−30,+23).
 *
 * Để CSS dùng mặc định (tâm khối) thì phụ đề mặc định — alignment 2 — sẽ nằm
 * lệch hẳn giữa bản xem trước và bản nung ngay khi xoay.
 *
 * Vị trí tự do luôn neo tâm, vì lúc nung ta phát ra `\an5`.
 */
export function textTransformOrigin(alignment: SubtitleAlignment, position?: TextPosition): string {
  if (position) return '50% 50%'
  const { vertical, horizontal } = alignmentToFlex(alignment)
  const x = horizontal === 'flex-start' ? '0%' : horizontal === 'center' ? '50%' : '100%'
  const y = vertical === 'flex-start' ? '0%' : vertical === 'center' ? '50%' : '100%'
  return `${x} ${y}`
}

/**
 * Thẻ ghi đè đặt ở ĐẦU dòng Dialogue để thả chữ vào một điểm.
 *
 * `\an5` bắt buộc đi kèm `\pos`: ASS đặt ĐIỂM NEO vào toạ độ đã cho, nên không
 * ép neo về giữa thì chữ lệch đi nửa khối. Đo thật: `{\an5\pos(200,120)}` cho ra
 * trọng tâm đúng (199,119), và giữ nguyên chỗ đó cả khi xoay 30°.
 *
 * Toạ độ tính theo PlayRes của file ASS, mà lớp ghi ASS đặt đúng bằng độ phân
 * giải xuất — nên nhân thẳng với chiều rộng/cao là ra.
 */
export function assPositionTag(
  position: TextPosition | undefined,
  width: number,
  height: number
): string {
  if (!position) return ''
  const x = Math.round(position.xPct * width)
  const y = Math.round(position.yPct * height)
  return `{\\an5\\pos(${x},${y})}`
}

/**
 * Giới hạn góc xoay, dùng chung cho thanh trượt, tay nắm xoay và công cụ MCP.
 *
 * ±180° là trọn một vòng: chữ dựng đứng hay lộn ngược đều là lựa chọn của người
 * dùng, cùng mức mà clip hình đã cho phép.
 */
export const MAX_TEXT_ROTATION_DEG = 180

/**
 * Vị trí mới sau khi kéo khối chữ đi một quãng trên khung xem trước.
 *
 * Nhận quãng dời tính bằng PIXEL trên màn hình cùng kích thước khung đang hiện,
 * vì đó là thứ sự kiện chuột cho; đổi sang tỉ lệ ngay tại đây để nơi gọi không
 * phải tự chia và tự nhớ chia cho cạnh nào.
 */
export function dragTextPosition(
  start: TextPosition,
  dxPx: number,
  dyPx: number,
  stageWidthPx: number,
  stageHeightPx: number
): TextPosition {
  // Khung chưa đo được (bề rộng 0) thì đứng yên, đừng chia cho 0 rồi cho ra NaN
  // — NaN lọt vào style là chữ biến mất mà không có lỗi nào.
  if (stageWidthPx <= 0 || stageHeightPx <= 0) return start
  return clampTextPosition({
    xPct: start.xPct + dxPx / stageWidthPx,
    yPct: start.yPct + dyPx / stageHeightPx
  })
}

/**
 * Góc của con trỏ so với tâm khối chữ, tính bằng độ theo chiều KIM ĐỒNG HỒ.
 *
 * Mốc 0 là hướng thẳng lên, vì tay nắm xoay nằm phía trên khối. Ra trong khoảng
 * −180..180, khớp với thanh trượt và công cụ MCP; vẫn kẹp theo `maxDeg` cho nơi
 * gọi nào muốn hẹp hơn.
 */
export function pointerRotationDeg(
  centerX: number,
  centerY: number,
  pointerX: number,
  pointerY: number,
  maxDeg: number = MAX_TEXT_ROTATION_DEG
): number {
  const degrees = (Math.atan2(pointerX - centerX, centerY - pointerY) * 180) / Math.PI
  return Math.round(Math.min(maxDeg, Math.max(-maxDeg, degrees)))
}
