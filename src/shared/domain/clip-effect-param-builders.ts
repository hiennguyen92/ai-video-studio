import type { EffectParamSpec } from './clip-effect-types'

/**
 * Cách viết gọn đặc tả thông số effect, để danh mục đọc như một bảng.
 */

export function numberParam(
  key: string,
  labelVi: string,
  labelEn: string,
  min: number,
  max: number,
  defaultValue: number,
  step = 1,
  unit?: string
): EffectParamSpec {
  return { key, labelVi, labelEn, type: 'number', min, max, step, default: defaultValue, unit }
}

export function colorParam(
  key: string,
  labelVi: string,
  labelEn: string,
  defaultValue: string
): EffectParamSpec {
  return { key, labelVi, labelEn, type: 'color', default: defaultValue }
}

export function selectParam(
  key: string,
  labelVi: string,
  labelEn: string,
  options: Array<[value: string, labelVi: string, labelEn: string]>,
  defaultValue: string
): EffectParamSpec {
  return {
    key,
    labelVi,
    labelEn,
    type: 'select',
    default: defaultValue,
    options: options.map(([value, vi, en]) => ({ value, labelVi: vi, labelEn: en }))
  }
}

/** Vị trí tâm theo phần trăm khung (0..100). */
export const centerX = (value = 50): EffectParamSpec =>
  numberParam('x', 'Tâm ngang', 'Centre X', 0, 100, value, 1, '%')
export const centerY = (value = 50): EffectParamSpec =>
  numberParam('y', 'Tâm dọc', 'Centre Y', 0, 100, value, 1, '%')
