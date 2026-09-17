import { useCallback, useRef, useState, type JSX } from 'react'
import { useT } from '../../i18n/use-translation'
import { DropdownMenu } from '../ui/dropdown-menu'
import { IconFilm, IconImage, IconPlus, IconWaveform } from '../ui/icons'
import type { AddableTrackKind } from './use-timeline-tracks'

/**
 * Một nút "+ Thêm track" mở menu chọn loại track (Video, Âm thanh, Hình ảnh, Text),
 * thay cho bốn nút dàn hàng chiếm gần hết thanh công cụ.
 *
 * Mục trong menu hiện nhãn ngắn ("Video") nhưng tên cho trình đọc màn hình vẫn là
 * "Thêm track video" — nghe riêng một mục thì phải biết nó làm gì.
 */
export function AddTrackMenuButton({
  onAddTrack
}: {
  onAddTrack(kind: AddableTrackKind): void
}): JSX.Element {
  const t = useT()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = useCallback(() => setAnchor(null), [])

  const items: Array<{
    kind: AddableTrackKind
    label: string
    ariaLabel: string
    icon: JSX.Element
  }> = [
    {
      kind: 'video',
      label: t.timeline.trackKindVideo,
      ariaLabel: t.timeline.addVideoTrack,
      icon: <IconFilm />
    },
    {
      kind: 'audio',
      label: t.timeline.trackKindAudio,
      ariaLabel: t.timeline.addAudioTrack,
      icon: <IconWaveform />
    },
    {
      kind: 'image',
      label: t.timeline.trackKindImage,
      ariaLabel: t.timeline.addImageTrack,
      icon: <IconImage />
    },
    {
      kind: 'text',
      label: t.timeline.trackKindText,
      ariaLabel: t.timeline.addTextTrack,
      icon: <span className="context-menu__glyph">T</span>
    }
  ]

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`button${anchor ? ' button--active' : ''}`}
        title={t.timeline.addTrack}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => setAnchor((current) => (current ? null : buttonRef.current))}
      >
        <IconPlus />
        <span>{t.timeline.addTrack}</span>
        <span className="button__caret" aria-hidden>
          ▾
        </span>
      </button>
      {anchor && (
        <DropdownMenu
          anchor={anchor}
          label={t.timeline.addTrack}
          onClose={close}
          items={items.map((item) => ({
            key: item.kind,
            label: item.label,
            ariaLabel: item.ariaLabel,
            icon: item.icon,
            onSelect: () => onAddTrack(item.kind)
          }))}
        />
      )}
    </>
  )
}
