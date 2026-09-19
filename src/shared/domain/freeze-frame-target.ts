import { resolveFreezeFrameSource, type FreezeFrameSource } from './freeze-frame-planner'
import type { ProjectDocument } from './project-document-types'
import { clipEndUs } from './timeline-track-types'
import { snapMicrosToFrame, type Micros } from './time-units'

/**
 * Clip nên đóng băng trong vùng chọn.
 *
 * Bấm clip trong nhóm là chọn cả nhóm, và clip đứng đầu có thể là clip TIẾNG ở
 * lane lời thoại — đóng băng nó báo "chỉ đóng băng được clip trên lane hình" dù
 * clip hình của cùng nhóm nằm ngay dưới đầu phát. Ưu tiên clip đã bấm nếu dùng
 * được, không thì lấy thành viên trên lane hình đang chứa đầu phát.
 */
export function pickFreezeFrameClipId(
  document: ProjectDocument,
  selectedClipIds: readonly string[],
  playheadUs: Micros
): string | undefined {
  const atUs = snapMicrosToFrame(playheadUs, document.settings.frameRate)
  const usable = (clipId: string): boolean =>
    document.tracks.some(
      (track) =>
        track.kind === 'video' &&
        track.clips.some(
          (clip) => clip.id === clipId && atUs >= clip.startUs && atUs < clipEndUs(clip)
        )
    )
  return selectedClipIds.find(usable) ?? selectedClipIds[0]
}

/**
 * Dựng lại nguồn đóng băng từ mốc trên trục NGUỒN, sau khi ffmpeg xong.
 *
 * Khung đã dựng là khung `sourceUs` của file. Nếu trong lúc chờ người dùng dời
 * clip, giữ mốc timeline cũ thì chèn khung đó vào sai chỗ trong clip (hình đứng ở
 * giây 5 chèn vào chỗ giây 8). Quy ngược từ nguồn ra timeline theo vị trí MỚI của
 * clip thì khung luôn nằm đúng chỗ nó được lấy ra.
 */
export function freezeFrameSourceAt(
  document: ProjectDocument,
  clipId: string,
  sourceUs: Micros
): FreezeFrameSource {
  const clip = document.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)
  if (!clip) throw new Error(`Không tìm thấy clip "${clipId}"`)
  const atUs = clip.startUs + (sourceUs - clip.sourceInUs) / clip.speed
  if (atUs < clip.startUs || atUs >= clipEndUs(clip)) {
    throw new Error('Khung cần đóng băng không còn nằm trong clip (clip đã bị cắt trong lúc chờ)')
  }
  return resolveFreezeFrameSource(document, clipId, atUs)
}
