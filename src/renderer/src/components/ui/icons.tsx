import type { JSX, SVGProps } from 'react'

/**
 * Bộ icon nội bộ dạng SVG inline.
 *
 * Không kéo cả thư viện icon về chỉ để dùng vài chục hình: bundle nhỏ hơn, và
 * icon thừa hưởng `currentColor` nên tự đổi màu theo trạng thái nút.
 */

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconImport = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </Icon>
)

export const IconUndo = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 8h11a5 5 0 0 1 0 10H9" />
    <path d="m7 4-4 4 4 4" />
  </Icon>
)

export const IconRedo = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M21 8H10a5 5 0 0 0 0 10h5" />
    <path d="m17 4 4 4-4 4" />
  </Icon>
)

export const IconSave = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 4v5h7V4" />
    <path d="M8 20v-6h8v6" />
  </Icon>
)

export const IconExport = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
  </Icon>
)

export const IconPlay = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconPause = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="7" y="4.5" width="3.5" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.5" y="4.5" width="3.5" height="15" rx="1" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconStepBack = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M17 5v14L7 12z" fill="currentColor" stroke="none" />
    <path d="M5 5v14" />
  </Icon>
)

export const IconStepForward = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M7 5v14l10-7z" fill="currentColor" stroke="none" />
    <path d="M19 5v14" />
  </Icon>
)

export const IconSplit = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 3v18" strokeDasharray="3 3" />
    <path d="M4 7h5v10H4z" />
    <path d="M15 7h5v10h-5z" />
  </Icon>
)

export const IconTrash = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </Icon>
)

export const IconDuplicate = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Icon>
)

export const IconZoomIn = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M11 8v6M8 11h6M20 20l-3.5-3.5" />
  </Icon>
)

export const IconZoomOut = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M8 11h6M20 20l-3.5-3.5" />
  </Icon>
)

export const IconMagnet = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M6 4v8a6 6 0 0 0 12 0V4" />
    <path d="M6 9h4M14 9h4" />
  </Icon>
)

export const IconEye = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.5" />
  </Icon>
)

export const IconEyeOff = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M4 4l16 16" />
    <path d="M9.5 5.6A9.7 9.7 0 0 1 12 5.3c6.5 0 10 6 10 6a17 17 0 0 1-3.3 3.9" />
    <path d="M6.3 7.4A17 17 0 0 0 2 11.3s3.5 6 10 6a9.6 9.6 0 0 0 4-.85" />
  </Icon>
)

export const IconVolume = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M16.5 9.5a3.5 3.5 0 0 1 0 5" />
  </Icon>
)

export const IconVolumeOff = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="m17 10 4 4M21 10l-4 4" />
  </Icon>
)

export const IconLock = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
)

export const IconUnlock = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </Icon>
)

export const IconPlus = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const IconSearch = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
)

export const IconFilm = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 5v14M17 5v14M3 12h18" />
  </Icon>
)

export const IconWaveform = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M4 12h2M8 7v10M12 4v16M16 8v8M20 11h0.5" />
  </Icon>
)

export const IconImage = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m5 17 4.5-4.5 3 3L16 12l3 3" />
  </Icon>
)

export const IconChevronLeft = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="m14 6-6 6 6 6" />
  </Icon>
)

export const IconSparkle = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </Icon>
)
