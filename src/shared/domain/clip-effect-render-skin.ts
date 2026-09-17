import { n, num, str, type EffectRecipe, type PrimitiveIo } from './clip-effect-render-types'

/**
 * Làm mịn và nâng sáng RIÊNG vùng da, giữ nguyên phần còn lại của khung.
 *
 * Không có nhận diện khuôn mặt — vùng da tìm bằng màu, ngay trong bộ lọc SVG, nên
 * preview và bản xuất cho ra cùng một hình. Da mọi tông đều thoả hai điều kiện
 * cùng lúc: đỏ hơn lục một khoảng vừa phải, và lục hơn lam một khoảng vừa phải.
 * Mỗi điều kiện là một dải: dưới dải là xám/trắng (chênh lệch bằng 0), trên dải là
 * đồ vật đỏ rực. Tông da càng sẫm thì chênh lệch càng nhỏ chứ không đổi dấu, nên
 * mép dưới của dải phải sát 0 — nó hạ tới 0.015 chứ không dừng ở 0.05.
 *
 * Hai dải nhân với nhau bằng alpha (`feComposite operator="in"` nhân alpha), rồi
 * làm mờ nhẹ mặt nạ cho mép mềm: mặt nạ cứng theo từng điểm ảnh sẽ lấm tấm và lộ
 * đường biên ngay giữa mảng da.
 *
 * KHÔNG cần cổng chặn theo độ sáng: điểm gần đen có cả ba kênh sát nhau nên chênh
 * lệch tự rơi xuống dưới dải, điểm cháy sáng thì cả ba kênh bằng 1 — cả hai bị dải
 * đỏ-lục loại sẵn.
 *
 * Giới hạn phải nói thẳng: dò theo màu thì cảnh ám vàng hay đèn vonfram làm CẢ
 * khung đỏ hơn lục, nên cả khung lọt mặt nạ một phần. Gặp vậy thì hạ "Dải tông da"
 * và bật "Soi vùng da" mà chỉnh cho thấy.
 */

/** Nhân chênh lệch kênh lên trước khi tra bảng: dải da trải rộng ra giữa bảng 33 ô. */
const RED_GREEN_SCALE = 2
const GREEN_BLUE_SCALE = 3

/** Bề rộng mép dốc của dải, tính theo đơn vị đã nhân. Rộng hơn 2 ô bảng để mép không răng cưa. */
const BAND_FEATHER = 0.08

/** Số ô bảng tra của mỗi dải. */
const BAND_TABLE_CELLS = 33

/**
 * Bảng tra hình thang: 0 dưới `lo`, 1 trong dải, 0 trên `hi`, hai mép dốc đều.
 * `lo`/`hi` tính theo đơn vị đã nhân.
 */
function bandTable(lo: number, hi: number): string {
  return Array.from({ length: BAND_TABLE_CELLS }, (_, index) => {
    const value = index / (BAND_TABLE_CELLS - 1)
    const rise = (value - lo) / BAND_FEATHER
    const fall = (hi - value) / BAND_FEATHER
    return n(Math.min(1, Math.max(0, Math.min(rise, fall))))
  }).join(' ')
}

/** Ma trận chỉ ghi vào alpha: `alpha = scale × (kênh a − kênh b)`. RGB bỏ trống, mặt nạ chỉ dùng alpha. */
function channelDifferenceToAlpha(first: 0 | 1, second: 1 | 2, scale: number): string {
  const alphaRow = [0, 0, 0, 0, 0]
  alphaRow[first] = scale
  alphaRow[second] = -scale
  return `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${alphaRow.map(n).join(' ')}`
}

/**
 * Trộn `source` vào ảnh gốc theo mặt nạ, alpha ra ĐÚNG BẰNG alpha vào.
 *
 * `operator="atop"` chứ không phải "over": "atop" cho `alpha = alpha ảnh nền` ở
 * mọi mức trong suốt, còn "over" thì cộng phồng alpha. Khác biệt này chỉ lộ ra
 * khi ảnh vào ĐÃ trong suốt một phần — tức là khi effect này đứng sau một effect
 * tách nền trong cùng chồng. Mặt nạ da tính bằng MÀU nên không biết gì về alpha,
 * và bước làm mờ mặt nạ còn kéo nó tràn ra ngoài mép vùng đã bị tách; "over" sẽ
 * vẽ một quầng da sáng ra ngoài phông đã tách, "atop" thì không vì nó nhân với
 * alpha nền. Ảnh vào đục đặc thì hai cách ra kết quả y hệt nhau.
 */
function blendThroughMask(source: string, mask: string, io: PrimitiveIo): string {
  return (
    `<feComposite in="${source}" in2="${mask}" operator="in" result="${io.prefix}on"/>` +
    `<feComposite in="${io.prefix}on" in2="${io.input}" operator="atop" result="${io.output}"/>`
  )
}

export const skinSmooth: EffectRecipe = ({ intensity, params }, { width }, io) => {
  const range = num(params, 'range', 50) / 100
  // Ngay ở mức HẸP nhất dải vẫn phải trùm trọn cụm màu da đo được (đỏ−lục 0.08…0.20,
  // lục−lam 0.04…0.11): "Dải tông da" là để lọc bớt đồ vật màu ấm, không phải để
  // loại da. Nó nới chủ yếu về phía trên — mép dưới là ranh giới với màu xám, dịch
  // nhiều thì cả khung bị coi là da.
  const redLo = (0.05 - 0.035 * range) * RED_GREEN_SCALE
  const redHi = (0.28 + 0.16 * range) * RED_GREEN_SCALE
  const warmLo = 0.01 * GREEN_BLUE_SCALE
  const warmHi = (0.15 + 0.15 * range) * GREEN_BLUE_SCALE

  const scale = Math.max(0.25, width / 1920)
  const mask =
    `<feColorMatrix in="${io.input}" type="matrix" values="${channelDifferenceToAlpha(0, 1, RED_GREEN_SCALE)}" result="${io.prefix}r"/>` +
    `<feComponentTransfer in="${io.prefix}r" result="${io.prefix}rb">` +
    `<feFuncA type="table" tableValues="${bandTable(redLo, redHi)}"/>` +
    `</feComponentTransfer>` +
    `<feColorMatrix in="${io.input}" type="matrix" values="${channelDifferenceToAlpha(1, 2, GREEN_BLUE_SCALE)}" result="${io.prefix}w"/>` +
    `<feComponentTransfer in="${io.prefix}w" result="${io.prefix}wb">` +
    `<feFuncA type="table" tableValues="${bandTable(warmLo, warmHi)}"/>` +
    `</feComponentTransfer>` +
    `<feComposite in="${io.prefix}rb" in2="${io.prefix}wb" operator="in" result="${io.prefix}m"/>` +
    `<feGaussianBlur in="${io.prefix}m" stdDeviation="${n(4 * scale)}" edgeMode="duplicate" result="${io.prefix}ms"/>`

  // Chế độ soi vùng da: tô xanh đúng chỗ bộ lọc coi là da, để chỉnh "Dải tông da"
  // mà nhìn thấy được. Nhớ TẮT trước khi xuất — bản xuất vẽ y như preview.
  if (str(params, 'showArea', 'off') === 'on') {
    return {
      primitives:
        mask +
        `<feFlood flood-color="#33FF99" result="${io.prefix}f"/>` +
        blendThroughMask(`${io.prefix}f`, `${io.prefix}ms`, io)
    }
  }

  // Nâng sáng bằng gamma chứ không kéo về trắng: giữ nguyên điểm đen và điểm
  // trắng, da sáng lên ở vùng trung tính mà không bị bạc màu.
  //
  // Cố ý KHÔNG nhân với cường độ, khác các effect còn lại: cường độ là mức làm mờ,
  // và "sáng da nhưng đừng mờ da" là nhu cầu có thật. Nhân vào thì muốn nâng sáng
  // là buộc phải làm mờ theo.
  const exponent = 1 - 0.45 * (num(params, 'brighten', 25) / 100)
  const gamma = (channel: string): string =>
    `<feFunc${channel} type="gamma" exponent="${n(exponent)}"/>`

  return {
    primitives:
      mask +
      `<feGaussianBlur in="${io.input}" stdDeviation="${n(intensity * 5 * scale)}" edgeMode="duplicate" result="${io.prefix}b"/>` +
      `<feComponentTransfer in="${io.prefix}b" result="${io.prefix}l">${gamma('R')}${gamma('G')}${gamma('B')}</feComponentTransfer>` +
      blendThroughMask(`${io.prefix}l`, `${io.prefix}ms`, io)
  }
}
