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

/** Clip bị tắt tiếng hẳn: âm lượng 0 và không có đường keyframe nào kéo nó lên. */
function isMuted(clip: Clip): boolean {
  return clip.volume === 0 && !clip.keyframes?.['volume']?.some((frame) => frame.v > 0)
}

/** `from` trừ đi mọi khoảng trong `minus`. Cả hai đã gộp và sắp theo thời gian. */
function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const result: Interval[] = []
  for (const range of from) {
    let cursor = range.startUs
    for (const cut of minus) {
      if (cut.endUs <= cursor || cut.startUs >= range.endUs) continue
      if (cut.startUs > cursor) result.push({ startUs: cursor, endUs: cut.startUs })
      cursor = Math.max(cursor, cut.endUs)
    }
    if (cursor < range.endUs) result.push({ startUs: cursor, endUs: range.endUs })
  }
  return result
}

/**
 * Lệnh ripple xoá cho khoảng lặng của các clip được nêu.
 *
 * Một mốc chỉ bị cắt khi MỌI clip đang phát tiếng ở mốc đó đều im. Lấy hợp các
 * khoảng im là sai: máy quay thu xa thì "im" đúng lúc micro cài áo đang có lời,
 * và lời bị cắt mất. Clip đã tắt tiếng (ví dụ tiếng gốc nằm dưới giọng đã làm
 * sạch) không tính — nó không phát ra gì cả.
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

  const silent: Interval[] = []
  const sounding: Interval[] = []
  for (const [clipId, silences] of Object.entries(silencesByClip)) {
    const found = clips.find((item) => item.clip.id === clipId)
    if (!found || isMuted(found.clip)) continue
    const quiet = mergeIntervals(silenceRangesOnTimeline(found.clip, silences, options.paddingUs))
    silent.push(...quiet)
    // Phần còn lại của clip là chỗ nó CÓ tiếng — kể cả phần chừa cạnh lời nói.
    sounding.push(
      ...subtractIntervals([{ startUs: found.clip.startUs, endUs: clipEndUs(found.clip) }], quiet)
    )
  }

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

  // Chỉ vài lane co thì MỌI clip đang phát tiếng trên các lane đó đều tính — kể cả
  // clip không được dò. Không dò thì không biết nó im chỗ nào, nên coi cả clip là
  // có tiếng: thà cắt ít đi còn hơn cắt mất lời của một clip chưa ai nghe qua.
  if (trackIds) {
    for (const { clip, trackId } of clips) {
      if (!trackIds.includes(trackId) || clip.id in silencesByClip || isMuted(clip)) continue
      if (!document.assets.find((asset) => asset.id === clip.assetId)?.probe.hasAudio) continue
      sounding.push({ startUs: clip.startUs, endUs: clipEndUs(clip) })
    }
  }

  const snap = (us: Micros): Micros => snapMicrosToFrame(us, options.frameRate)
  const ranges = subtractIntervals(mergeIntervals(silent), mergeIntervals(sounding))
    .map((range) => ({ startUs: snap(range.startUs), endUs: snap(range.endUs) }))
    .filter((range) => range.endUs - range.startUs >= MIN_CUT_US)
  if (ranges.length === 0) return { commands: [], cutCount: 0, removedUs: 0 }

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
