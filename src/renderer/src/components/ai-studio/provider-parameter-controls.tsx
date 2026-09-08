import type { JSX } from 'react'
import type { ProviderParameter } from '../../../../shared/ai/ai-capability-types'
import { useLocale } from '../../i18n/use-translation'

/**
 * Dựng ô điều khiển TỪ khai báo năng lực của provider.
 *
 * Component này cố tình không biết provider nào có tham số gì. Nó chỉ vẽ đúng
 * những gì adapter khai báo. Nhờ vậy không thể xảy ra chuyện giao diện bày ra
 * một thanh trượt "cảm xúc" trong khi provider không nhận tham số đó
 * (DESCRIPTION §3.B).
 */
export function ProviderParameterControls({
  parameters,
  values,
  disabled,
  onChange
}: {
  parameters: ProviderParameter[]
  values: Record<string, number | string | boolean>
  disabled?: boolean
  onChange(key: string, value: number | string | boolean): void
}): JSX.Element | null {
  const { locale } = useLocale()
  if (parameters.length === 0) return null

  const label = (parameter: ProviderParameter): string =>
    locale === 'vi' ? parameter.labelVi : parameter.labelEn
  const hint = (parameter: ProviderParameter): string | undefined =>
    locale === 'vi' ? parameter.hintVi : parameter.hintEn

  return (
    <div className="parameter-controls">
      {parameters.map((parameter) => {
        const value = values[parameter.key] ?? parameter.defaultValue

        return (
          <div key={parameter.key} className="field-row" title={hint(parameter)}>
            <span className="field-row__label">{label(parameter)}</span>

            {parameter.control === 'range' && (
              <div className="parameter-controls__range">
                <input
                  type="range"
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  value={Number(value)}
                  disabled={disabled}
                  aria-label={label(parameter)}
                  onChange={(event) => onChange(parameter.key, Number(event.target.value))}
                />
                <span className="field-row__value parameter-controls__value">
                  {Number(value).toFixed(2)}
                </span>
              </div>
            )}

            {parameter.control === 'toggle' && (
              <input
                type="checkbox"
                checked={Boolean(value)}
                disabled={disabled}
                aria-label={label(parameter)}
                onChange={(event) => onChange(parameter.key, event.target.checked)}
              />
            )}

            {parameter.control === 'select' && (
              <select
                value={String(value)}
                disabled={disabled}
                aria-label={label(parameter)}
                onChange={(event) => onChange(parameter.key, event.target.value)}
              >
                {(parameter.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {locale === 'vi' ? option.labelVi : option.labelEn}
                  </option>
                ))}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}
