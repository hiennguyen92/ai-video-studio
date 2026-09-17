import type { LookDefinition, LookStage } from './clip-look-catalog'

/**
 * Dựng bộ lọc SVG cho một look màu, ở một cường độ.
 *
 * Chuỗi SVG thuần ASCII, dùng chung cho composition (preview + bản xuất) và ảnh
 * minh hoạ trên thẻ tab LUT — cùng một chuỗi thì thẻ hiện đúng màu video sẽ ra.
 *
 * `color-interpolation-filters="sRGB"`: công thức đã tự xử lý đường truyền
 * (log → tuyến tính → 709). Để trình duyệt tự đổi sang linearRGB là áp đường
 * truyền hai lần và màu lệch hẳn.
 */

/** Id bộ lọc theo look và cường độ, dùng trong `filter: url(#...)`. */
export function lookFilterId(lookId: string, intensity: number): string {
  return `look-${lookId}-${Math.round(clampIntensity(intensity) * 100)}`
}

export function clampIntensity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}

const n = (value: number): string => String(Math.round(value * 10_000) / 10_000)

function stageSvg(stage: LookStage, index: number, input: string): string {
  const result = `s${index}`
  switch (stage.type) {
    case 'curve':
      return (
        `<feComponentTransfer in="${input}" result="${result}">` +
        `<feFuncR type="table" tableValues="${stage.r.map(n).join(' ')}"/>` +
        `<feFuncG type="table" tableValues="${stage.g.map(n).join(' ')}"/>` +
        `<feFuncB type="table" tableValues="${stage.b.map(n).join(' ')}"/>` +
        `</feComponentTransfer>`
      )
    case 'matrix':
      return `<feColorMatrix in="${input}" type="matrix" values="${stage.values.map(n).join(' ')}" result="${result}"/>`
    case 'grain':
      // Nhiễu xám trộn cộng quanh giá trị giữa: không làm sáng hay tối cả hình,
      // chỉ rải hạt. Hạt tĩnh theo khung hình (không nhảy mỗi khung) để preview
      // không phải dựng lại bộ lọc liên tục.
      return (
        `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="7" result="${result}n"/>` +
        `<feColorMatrix in="${result}n" type="saturate" values="0" result="${result}g"/>` +
        `<feComposite in="${input}" in2="${result}g" operator="arithmetic" k1="0" k2="1" k3="${n(stage.amount)}" k4="${n(-stage.amount / 2)}" result="${result}"/>`
      )
  }
}

/**
 * Chuỗi `<filter>` hoàn chỉnh. Cường độ < 1 trộn tuyến tính kết quả với ảnh gốc;
 * cường độ 0 vẫn dựng bộ lọc (trả ảnh gốc) để đổi cường độ không làm nháy hình.
 */
export function buildLookFilterSvg(look: LookDefinition, intensity: number): string {
  const amount = clampIntensity(intensity)
  let input = 'SourceGraphic'
  const parts: string[] = []
  look.stages.forEach((stage, index) => {
    parts.push(stageSvg(stage, index, input))
    input = `s${index}`
  })
  if (amount < 1) {
    parts.push(
      `<feComposite in="${input}" in2="SourceGraphic" operator="arithmetic" k1="0" k2="${n(amount)}" k3="${n(1 - amount)}" k4="0"/>`
    )
  }
  return (
    `<filter id="${lookFilterId(look.id, amount)}" color-interpolation-filters="sRGB" ` +
    `x="0" y="0" width="100%" height="100%">${parts.join('')}</filter>`
  )
}
