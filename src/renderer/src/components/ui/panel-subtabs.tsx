import type { JSX } from 'react'

/**
 * Thanh tab con trong một panel (Thuộc tính clip/câu phụ đề, tab Phụ đề của AI
 * Studio). Bám mép trên vùng cuộn. Chỉ vẽ nút; nội dung từng tab do nơi gọi quyết định.
 */
export function PanelSubtabs<Key extends string>({
  tabs,
  active,
  label,
  onChange,
  sticky = true
}: {
  tabs: Array<{ key: Key; label: string }>
  active: Key
  /** Tên của cả thanh tab, cho trình đọc màn hình. */
  label: string
  onChange(key: Key): void
  /** Bám mép trên vùng cuộn. Tắt khi thanh tab nằm lồng trong một thẻ. */
  sticky?: boolean
}): JSX.Element {
  return (
    <div className={sticky ? 'panel-subtabs' : 'panel-subtabs panel-subtabs--inline'}>
      <div className="subtab-bar" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            className={`subtab ${active === tab.key ? 'subtab--active' : ''}`}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
