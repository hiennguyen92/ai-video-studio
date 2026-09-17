import type { EditorCommand } from '../commands/editor-command-types'
import {
  DEFAULT_TRANSITION_DURATION_US,
  clipEndUs,
  type Clip,
  type Track,
  type TransitionKind
} from './timeline-track-types'

/**
 * Chuyển cảnh đặt ở CHỖ NỐI giữa hai clip, không đặt trên từng clip.
 *
 * Người dùng kéo một kiểu chuyển cảnh thả vào chỗ nối: cuối clip trước nhận hiệu
 * ứng RA, đầu clip sau nhận hiệu ứng VÀO, cùng một kiểu. Dữ liệu vẫn nằm ở
 * `transitionOut`/`transitionIn` của hai clip — lớp dựng hình và dự án cũ không
 * phải đổi gì — nhưng giao diện chỉ còn nói về chỗ nối.
 */

/**
 * Hai clip coi là liền nhau khi khe hở không quá chừng này. Cắt đôi và hít biên
 * cho ra khớp tuyệt đối; nới ra một khung (ở 30 khung/giây) để khe làm tròn từ dự
 * án cũ vẫn nhận ra là chỗ nối.
 */
export const CUT_JOIN_TOLERANCE_US = 40_000

export interface CutPoint {
  trackId: string
  /** Mốc thời gian của chỗ nối (hoặc của mép clip lẻ). */
  atUs: number
  /** Clip đứng trước chỗ nối. */
  leftClip?: Clip
  /** Clip đứng sau chỗ nối. */
  rightClip?: Clip
  /** Kiểu chuyển cảnh đang dùng ở đây, nếu có. */
  kind?: TransitionKind
}

/** Chỗ nối thật: có đủ clip ở cả hai phía — chỉ chỗ này mới nhận thả chuyển cảnh. */
export function isJunction(point: CutPoint): boolean {
  return Boolean(point.leftClip && point.rightClip)
}

/**
 * Mọi chỗ nối trên một track, cộng các mép clip lẻ đang mang chuyển cảnh.
 *
 * Mép lẻ đến từ dự án cũ, khi chuyển cảnh còn đặt trên từng clip (hiệu ứng ra ở
 * clip cuối, hiệu ứng vào ở clip không có ai phía trước). Vẫn liệt kê để chúng
 * hiện ra và XOÁ ĐƯỢC — giấu đi là chúng vẫn chạy trong video mà không còn chỗ nào
 * trên giao diện để gỡ.
 */
export function findCutPoints(track: Track): CutPoint[] {
  const clips = [...track.clips].sort((left, right) => left.startUs - right.startUs)
  const points: CutPoint[] = []
  const joinedAsLeft = new Set<string>()
  const joinedAsRight = new Set<string>()

  for (let index = 0; index + 1 < clips.length; index++) {
    const leftClip = clips[index]
    const rightClip = clips[index + 1]
    if (Math.abs(rightClip.startUs - clipEndUs(leftClip)) > CUT_JOIN_TOLERANCE_US) continue
    joinedAsLeft.add(leftClip.id)
    joinedAsRight.add(rightClip.id)
    points.push({
      trackId: track.id,
      atUs: rightClip.startUs,
      leftClip,
      rightClip,
      kind: leftClip.transitionOut?.kind ?? rightClip.transitionIn?.kind
    })
  }

  for (const clip of clips) {
    if (clip.transitionIn && !joinedAsRight.has(clip.id)) {
      points.push({
        trackId: track.id,
        atUs: clip.startUs,
        rightClip: clip,
        kind: clip.transitionIn.kind
      })
    }
    if (clip.transitionOut && !joinedAsLeft.has(clip.id)) {
      points.push({
        trackId: track.id,
        atUs: clipEndUs(clip),
        leftClip: clip,
        kind: clip.transitionOut.kind
      })
    }
  }

  return points.sort((left, right) => left.atUs - right.atUs)
}

/** Chỗ nối gần mốc `atUs` nhất trong phạm vi cho phép, hoặc `null`. */
export function nearestJunction(
  points: CutPoint[],
  atUs: number,
  maxDistanceUs: number
): CutPoint | null {
  let best: CutPoint | null = null
  for (const point of points) {
    if (!isJunction(point)) continue
    const distance = Math.abs(point.atUs - atUs)
    if (distance > maxDistanceUs) continue
    if (!best || distance < Math.abs(best.atUs - atUs)) best = point
  }
  return best
}

/**
 * Lệnh đặt một kiểu chuyển cảnh vào chỗ nối: ra ở clip trước, vào ở clip sau.
 *
 * Đổi kiểu thì GIỮ thời lượng đang có ở mỗi phía: thử liền vài kiểu mà mỗi lần lại
 * về mặc định là mất công chỉnh.
 */
export function setCutTransitionCommands(
  point: CutPoint,
  kind: TransitionKind,
  /** Thời lượng cho CẢ hai phía. Bỏ trống thì giữ thời lượng đang có mỗi phía. */
  durationUs?: number
): EditorCommand[] {
  const commands: EditorCommand[] = []
  if (point.leftClip) {
    commands.push({
      type: 'clip/set-transition',
      clipId: point.leftClip.id,
      edge: 'out',
      transition: {
        kind,
        durationUs:
          durationUs ?? point.leftClip.transitionOut?.durationUs ?? DEFAULT_TRANSITION_DURATION_US
      }
    })
  }
  if (point.rightClip) {
    commands.push({
      type: 'clip/set-transition',
      clipId: point.rightClip.id,
      edge: 'in',
      transition: {
        kind,
        durationUs:
          durationUs ?? point.rightClip.transitionIn?.durationUs ?? DEFAULT_TRANSITION_DURATION_US
      }
    })
  }
  return commands
}

/** Các mức thời lượng chọn được trong menu chuột phải của chỗ nối, tính cho MỖI phía. */
export const CUT_TRANSITION_DURATIONS_US = [200_000, 300_000, 500_000, 1_000_000, 2_000_000]

/** Thời lượng đang dùng ở chỗ nối: phía ra trước, không có thì phía vào. */
export function cutTransitionDurationUs(point: CutPoint): number | undefined {
  return point.leftClip?.transitionOut?.durationUs ?? point.rightClip?.transitionIn?.durationUs
}

/**
 * Lệnh đổi thời lượng chuyển cảnh ở chỗ nối, GIỮ nguyên kiểu, đặt cùng một con số
 * cho cả hai phía — hai phía lệch nhau thì phần ra và phần vào không gặp nhau ở
 * giữa chỗ nối.
 */
export function setCutTransitionDurationCommands(
  point: CutPoint,
  durationUs: number
): EditorCommand[] {
  if (!point.kind) return []
  const commands: EditorCommand[] = []
  if (point.leftClip) {
    commands.push({
      type: 'clip/set-transition',
      clipId: point.leftClip.id,
      edge: 'out',
      transition: { kind: point.leftClip.transitionOut?.kind ?? point.kind, durationUs }
    })
  }
  if (point.rightClip) {
    commands.push({
      type: 'clip/set-transition',
      clipId: point.rightClip.id,
      edge: 'in',
      transition: { kind: point.rightClip.transitionIn?.kind ?? point.kind, durationUs }
    })
  }
  return commands
}

/** Lệnh gỡ chuyển cảnh ở chỗ nối, cả hai phía, chỉ những phía đang có. */
export function removeCutTransitionCommands(point: CutPoint): EditorCommand[] {
  const commands: EditorCommand[] = []
  if (point.leftClip?.transitionOut) {
    commands.push({ type: 'clip/set-transition', clipId: point.leftClip.id, edge: 'out' })
  }
  if (point.rightClip?.transitionIn) {
    commands.push({ type: 'clip/set-transition', clipId: point.rightClip.id, edge: 'in' })
  }
  return commands
}
