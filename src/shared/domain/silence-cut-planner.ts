import type { EditorCommand } from '../commands/editor-command-types'
import type { SilenceInterval } from '../ipc/silence-detection-types'
import { mergeIntervals, type Interval } from './auto-ducking-planner'
import { expandToLinkGroups } from './clip-link-groups'
import type { ProjectDocument } from './project-document-types'
import { clipEndUs, type Clip } from './timeline-track-types'
import { snapMicrosToFrame, type FrameRate, type Micros } from './time-units'

/**
 * Cắt khoảng lặng: biến khoảng im (trên trục NGUỒN của clip) thành các lệnh ripple
 * xoá trên timeline.
 *
 * Hàm thuần — phần dò bằng ffmpeg nằm ở tiến trình main. Tách ra để kiểm được
 * chuyện khó nhất mà không cần file âm thanh: quy đổi nguồn → timeline khi clip
 * đã cắt đầu và đổi tốc độ, và chừa lại bao nhiêu im cạnh lời nói.
 */

export type SilenceCutScope = 'clip-tracks' | 'all-tracks'

export interface SilenceCutOptions {
  /**
   * Im GIỮ LẠI cạnh lời nói, mỗi bên. Cắt sát tận chữ thì câu nọ dính câu kia
   * và hơi thở đầu câu bị cụt — nghe như băng bị hỏng.
   */
  paddingUs: Micros
  /**
   * `clip-tracks`: chỉ các track của clip (và nhóm của nó) co lại — nhạc nền đặt
   * sẵn không bị băm thành mảnh.
   * `all-tracks`: cả video co lại — phụ đề, chữ, marker trôi theo, không lệch hình.
   */
  scope: SilenceCutScope
  frameRate: FrameRate
}

/** Cắt ngắn hơn chừng này thì bỏ: một vết cắt vài mili giây chỉ để lại tiếng "tách". */
const MIN_CUT_US = 50_000

/**
 * Khoảng lặng của một clip, quy về timeline và đã chừa `paddingUs`.
 *
 * Phía chạm MÉP clip thì không chừa: im ở đầu clip không có lời nói nào phía trước
 * cần giữ hơi, nên cắt sát mép.
 */
export function silenceRangesOnTimeline(
  clip: Clip,
  silences: readonly SilenceInterval[],
  paddingUs: Micros
): Interval[] {
  const clipStart = clip.startUs
  const clipEnd = clipEndUs(clip)
  const toTimeline = (sourceUs: Micros): Micros =>
    clipStart + (sourceUs - clip.sourceInUs) / clip.speed

  const ranges: Interval[] = []
  for (const silence of silences) {
    const from = Math.max(clipStart, toTimeline(silence.startUs))
    const to = Math.min(clipEnd, toTimeline(silence.endUs))
    const paddedFrom = from <= clipStart ? from : from + paddingUs
    const paddedTo = to >= clipEnd ? to : to - paddingUs
    if (paddedTo - paddedFrom >= MIN_CUT_US) ranges.push({ startUs: paddedFrom, endUs: paddedTo })
  }
  return ranges
}

export interface SilenceCutPlan {
  commands: EditorCommand[]
  cutCount: number
  removedUs: Micros
}

/**
 * Lệnh ripple xoá cho mọi khoảng lặng của các clip được nêu.
 *
 * Xoá từ khoảng MUỘN NHẤT về trước: xoá khoảng sau không dời khoảng trước, nên
 * toạ độ của những lệnh còn lại vẫn đúng. Mốc làm tròn về khung hình để timeline
 * không mọc ra clip lệch nửa khung.
 */
export function planSilenceCuts(
  document: ProjectDocument,
  silencesByClip: Record<string, readonly SilenceInterval[]>,
  options: SilenceCutOptions
): SilenceCutPlan {
  const clips = document.tracks.flatMap((track) =>
    track.clips.map((clip) => ({ clip, trackId: track.id }))
  )

  const raw: Interval[] = []
  for (const [clipId, silences] of Object.entries(silencesByClip)) {
    const found = clips.find((item) => item.clip.id === clipId)
    if (found) raw.push(...silenceRangesOnTimeline(found.clip, silences, options.paddingUs))
  }

  const snap = (us: Micros): Micros => snapMicrosToFrame(us, options.frameRate)
  const ranges = mergeIntervals(
    raw.map((range) => ({ startUs: snap(range.startUs), endUs: snap(range.endUs) }))
  )
  if (ranges.length === 0) return { commands: [], cutCount: 0, removedUs: 0 }

  // Cả nhóm của clip co cùng lúc: cắt tiếng mà để hình nguyên là lệch khẩu hình.
  const members = expandToLinkGroups(document, Object.keys(silencesByClip))
  const trackIds =
    options.scope === 'clip-tracks'
      ? [
          ...new Set(
            clips.filter((item) => members.includes(item.clip.id)).map((item) => item.trackId)
          )
        ]
      : undefined

  const commands: EditorCommand[] = [...ranges]
    .sort((left, right) => right.startUs - left.startUs)
    .map((range) => ({
      type: 'timeline/ripple-delete',
      fromUs: range.startUs,
      toUs: range.endUs,
      ...(trackIds ? { trackIds } : {})
    }))

  return {
    commands,
    cutCount: ranges.length,
    removedUs: ranges.reduce((sum, range) => sum + (range.endUs - range.startUs), 0)
  }
}
