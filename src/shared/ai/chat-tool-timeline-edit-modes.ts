import type { EditorCommand } from '../commands/editor-command-types'
import { roundHalfUp } from '../domain/time-units'
import type { Clip, Track } from '../domain/timeline-track-types'

/**
 * Dịch ba công cụ của các chế độ sửa trên timeline (ripple trim, slip, rate stretch)
 * thành lệnh — đúng các lệnh mà thao tác kéo chuột phát ra, nên agent và người dùng
 * đi chung một đường kiểm tra trong reducer.
 *
 * Chỉ chặn sớm những trường hợp chắc chắn hỏng (ảnh tĩnh không có đoạn nguồn), kèm
 * lý do dễ hiểu, để agent sửa được ở lượt sau thay vì nhận một lỗi áp lệnh mơ hồ.
 */

type Planned = { description: string; commands: EditorCommand[] }

function toMicros(seconds: number): number {
  return roundHalfUp(seconds * 1_000_000)
}

function label(us: number): string {
  return `${(us / 1_000_000).toFixed(2)}s`
}

function assertTimedTrack(track: Track, action: string): void {
  if (track.kind !== 'video' && track.kind !== 'audio') {
    throw new Error(
      `Chỉ ${action} được clip hình hoặc clip tiếng — clip này nằm trên track ${track.kind}`
    )
  }
}

export function planRippleTrimClip(
  clip: Clip,
  input: { edge: 'start' | 'end'; toSeconds: number }
): Planned {
  const toUs = toMicros(input.toSeconds)
  return {
    description: `Ripple trim mép ${input.edge === 'start' ? 'đầu' : 'cuối'} clip về ${label(toUs)}`,
    commands: [{ type: 'clip/ripple-trim', clipId: clip.id, edge: input.edge, toUs }]
  }
}

export function planSlipClip(
  clip: Clip,
  track: Track,
  input: { sourceInSeconds: number }
): Planned {
  assertTimedTrack(track, 'slip')
  const toSourceInUs = toMicros(input.sourceInSeconds)
  return {
    description: `Slip clip cho phát từ ${label(toSourceInUs)} của nguồn`,
    commands: [{ type: 'clip/slip', clipId: clip.id, toSourceInUs }]
  }
}

export function planRateStretchClip(
  clip: Clip,
  track: Track,
  input: { edge: 'start' | 'end'; toSeconds: number }
): Planned {
  assertTimedTrack(track, 'rate stretch')
  const toUs = toMicros(input.toSeconds)
  return {
    description: `Rate stretch mép ${input.edge === 'start' ? 'đầu' : 'cuối'} clip về ${label(toUs)}`,
    commands: [{ type: 'clip/rate-stretch', clipId: clip.id, edge: input.edge, toUs }]
  }
}
