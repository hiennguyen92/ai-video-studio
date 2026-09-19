import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import type { Micros } from '../../../../shared/domain/time-units'

/**
 * Kéo nhiều clip cùng lúc: mọi clip dời đúng một khoảng như clip đang cầm.
 *
 * Tách khỏi hook con trỏ cho thành hàm thuần, cùng lý do `clip-drag-kinds`: phần
 * "kéo này tính ra sao" kiểm được mà không cần dựng chuột.
 */

export interface GroupDragMember {
  clipId: string
  startUs: Micros
  durationUs: Micros
}

/** Clip sẽ dời theo, kèm track của từng cái. Clip đang cầm luôn đứng đầu. */
export function collectGroupDragClips(
  document: ProjectDocument,
  clipIds: readonly string[],
  primaryClipId: string
): Array<{ clip: Clip; trackId: string }> {
  const found = document.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clipIds.includes(clip.id))
      .map((clip) => ({ clip, trackId: track.id }))
  )
  return [
    ...found.filter((item) => item.clip.id === primaryClipId),
    ...found.filter((item) => item.clip.id !== primaryClipId)
  ]
}

/**
 * Vị trí xem trước của cả loạt khi clip đang cầm tới `primaryStartUs`.
 *
 * Kẹp khoảng dời theo clip SỚM NHẤT, không theo clip đang cầm: cầm clip thứ hai
 * kéo về 0 thì clip đầu phải dừng ở 0, nếu không cả loạt vỡ hình dạng. Cùng quy
 * tắc với `planMoveClips`, nên thứ nhìn thấy lúc kéo đúng là thứ được ghi.
 */
export function groupDragPreview(
  members: ReadonlyArray<{ clip: Clip }>,
  primary: Clip,
  primaryStartUs: Micros
): { deltaUs: Micros; group: GroupDragMember[] } {
  const earliest = Math.min(...members.map((item) => item.clip.startUs))
  const deltaUs = Math.max(primaryStartUs - primary.startUs, -earliest)
  return {
    deltaUs,
    group: members.map(({ clip }) => ({
      clipId: clip.id,
      startUs: clip.startUs + deltaUs,
      durationUs: clip.durationUs
    }))
  }
}
