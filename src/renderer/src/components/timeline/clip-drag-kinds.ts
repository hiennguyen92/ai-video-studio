import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import {
  rateStretchClip,
  slipClip,
  slipSourceInForDrag
} from '../../../../shared/commands/timeline-edit-tools'
import { formatClockTime, type Micros } from '../../../../shared/domain/time-units'
import {
  clipEndUs,
  type Clip,
  type TrackKind
} from '../../../../shared/domain/timeline-track-types'
import type { TimelineTool } from '../../state/editor-store'
import type { ClipDragMode } from './timeline-clip'

/**
 * Bấm/kéo lên clip làm gì, theo chế độ công cụ đang bật và chỗ bấm (thân hay mép).
 *
 * Tách khỏi hook con trỏ để phần "kéo này nghĩa là gì" là hàm thuần: nhìn một bảng
 * là thấy hết, và hook chỉ còn việc nghe chuột.
 */
export type ClipDragKind =
  | 'move'
  | 'trim-start'
  | 'trim-end'
  | 'ripple-start'
  | 'ripple-end'
  | 'slip'
  | 'rate-start'
  | 'rate-end'
  /** Chỉ chọn clip (và tua nếu cần), không kéo gì. */
  | 'none'

/** Clip có trục thời gian nguồn (slip, đổi tốc độ được) — ảnh tĩnh thì không. */
const hasSourceTimeline = (kind: TrackKind): boolean => kind === 'video' || kind === 'audio'

export function clipDragKind(
  tool: TimelineTool,
  zone: ClipDragMode,
  trackKind: TrackKind
): ClipDragKind {
  const edge = zone === 'trim-start' ? 'start' : zone === 'trim-end' ? 'end' : null
  switch (tool) {
    case 'select':
      return zone
    case 'trim':
      return edge ? `ripple-${edge}` : 'none'
    case 'slip':
      return hasSourceTimeline(trackKind) ? 'slip' : 'none'
    case 'rate-stretch':
      return edge && hasSourceTimeline(trackKind) ? `rate-${edge}` : 'none'
    case 'blade':
      // Blade cắt ngay lúc bấm, ở hook; không có thao tác kéo.
      return 'none'
  }
}

export interface ClipDragPreview {
  clipId: string
  kind: ClipDragKind
  /** Track đang được nhắm tới — có thể khác track ban đầu khi kéo dọc. */
  targetTrackId: string
  startUs: number
  durationUs: number
  /** Mốc vừa bắt dính vào, để vẽ đường chỉ dẫn. */
  snappedToUs: number | null
  /** Slip: điểm vào nguồn mới, để filmstrip trượt theo tay. */
  sourceInUs?: number
  /** Rate stretch: tốc độ mới. */
  speed?: number
  /** Chữ nhỏ trên clip lúc kéo: tốc độ mới, điểm vào mới… */
  badge?: string
  /**
   * Kéo nhiều clip: vị trí xem trước của CẢ loạt, clip đang cầm đứng đầu. Vắng
   * mặt nghĩa là chỉ kéo một clip.
   */
  group?: Array<{ clipId: string; startUs: number; durationUs: number }>
}

/** Bước kéo mép chung cho trim thường, ripple trim và rate stretch. */
export function edgePreview(
  clip: Clip,
  kind: 'trim-start' | 'trim-end' | 'ripple-start' | 'ripple-end',
  snappedUs: Micros,
  minDurationUs: Micros
): { startUs: number; durationUs: number } {
  if (kind.endsWith('start')) {
    const startUs = Math.min(snappedUs, clipEndUs(clip) - minDurationUs)
    return { startUs, durationUs: clipEndUs(clip) - startUs }
  }
  const endUs = Math.max(snappedUs, clip.startUs + minDurationUs)
  return { startUs: clip.startUs, durationUs: endUs - clip.startUs }
}

export function ratePreview(
  clip: Clip,
  kind: 'rate-start' | 'rate-end',
  snappedUs: Micros,
  minDurationUs: Micros
): Pick<ClipDragPreview, 'startUs' | 'durationUs' | 'speed' | 'badge'> | null {
  const stretched = rateStretchClip(
    clip,
    kind === 'rate-start' ? 'start' : 'end',
    snappedUs,
    minDurationUs
  )
  if (!stretched) return null
  return {
    startUs: stretched.startUs,
    durationUs: stretched.durationUs,
    speed: stretched.speed,
    badge: `${stretched.speed.toFixed(2)}×`
  }
}

export function slipPreview(
  clip: Clip,
  deltaUs: Micros,
  assetDurationUs: Micros | undefined
): Pick<ClipDragPreview, 'sourceInUs' | 'badge'> {
  const slipped = slipClip(clip, slipSourceInForDrag(clip, deltaUs), assetDurationUs)
  return { sourceInUs: slipped.sourceInUs, badge: `In ${formatClockTime(slipped.sourceInUs)}` }
}

/** Lệnh ghi lúc thả chuột, hoặc rỗng nếu kéo xong mà không đổi gì. */
export function clipDragCommands(
  clip: Clip,
  sourceTrackId: string,
  final: ClipDragPreview
): EditorCommand[] {
  const endUs = final.startUs + final.durationUs
  switch (final.kind) {
    case 'move': {
      const movedTrack = final.targetTrackId !== sourceTrackId
      if (!movedTrack && final.startUs === clip.startUs) return []
      return [
        {
          type: 'clip/move',
          clipId: clip.id,
          toTrackId: movedTrack ? final.targetTrackId : undefined,
          toStartUs: final.startUs
        }
      ]
    }
    case 'trim-start':
      return final.startUs === clip.startUs
        ? []
        : [{ type: 'clip/trim', clipId: clip.id, edge: 'start', toUs: final.startUs }]
    case 'trim-end':
      return endUs === clipEndUs(clip)
        ? []
        : [{ type: 'clip/trim', clipId: clip.id, edge: 'end', toUs: endUs }]
    case 'ripple-start':
      return final.startUs === clip.startUs
        ? []
        : [{ type: 'clip/ripple-trim', clipId: clip.id, edge: 'start', toUs: final.startUs }]
    case 'ripple-end':
      return endUs === clipEndUs(clip)
        ? []
        : [{ type: 'clip/ripple-trim', clipId: clip.id, edge: 'end', toUs: endUs }]
    case 'rate-start':
      return final.startUs === clip.startUs
        ? []
        : [{ type: 'clip/rate-stretch', clipId: clip.id, edge: 'start', toUs: final.startUs }]
    case 'rate-end':
      return endUs === clipEndUs(clip)
        ? []
        : [{ type: 'clip/rate-stretch', clipId: clip.id, edge: 'end', toUs: endUs }]
    case 'slip':
      return final.sourceInUs === undefined || final.sourceInUs === clip.sourceInUs
        ? []
        : [{ type: 'clip/slip', clipId: clip.id, toSourceInUs: final.sourceInUs }]
    case 'none':
      return []
  }
}

/** Nhãn hoàn tác cho từng kiểu kéo. */
export function clipDragLabel(kind: ClipDragKind): string {
  if (kind === 'move') return 'Di chuyển clip'
  if (kind === 'ripple-start' || kind === 'ripple-end') return 'Ripple trim'
  if (kind === 'rate-start' || kind === 'rate-end') return 'Rate stretch'
  if (kind === 'slip') return 'Slip clip'
  return 'Cắt clip'
}
