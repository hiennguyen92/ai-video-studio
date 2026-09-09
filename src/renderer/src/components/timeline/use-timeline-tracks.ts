import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import {
  DEFAULT_TRACK_HEIGHT,
  TRACK_HEIGHT_PRESETS,
  trackHeightPresetOf,
  type TrackHeightPreset
} from '../../../../shared/domain/timeline-track-types'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'

/**
 * Quản lý danh sách track của timeline: thêm track, đổi cỡ lane, và đưa track
 * vừa thêm vào tầm nhìn.
 *
 * Ba việc này gom một chỗ vì chúng dính chặt nhau: thêm track phải khớp cỡ lane
 * đang chọn, và thêm xong phải nhìn thấy được. Nằm rải trong panel thì lần sau
 * sửa một cái rất dễ quên hai cái kia.
 */

export type AddableTrackKind = 'video' | 'audio' | 'text'

export interface TimelineTracks {
  /** Chiều cao lane đang dùng, tính bằng pixel. */
  trackHeightPx: number
  /** Nấc gần nhất, để ô chọn trên thanh công cụ hiện đúng giá trị. */
  heightPreset: TrackHeightPreset
  setTrackHeight(preset: TrackHeightPreset): void
  addTrack(kind: AddableTrackKind): void
}

export function useTimelineTracks(options: {
  document: ProjectDocument | null
  /** Khung cuộn dọc chứa CẢ cột đầu track lẫn cột lane. */
  bodyRef: RefObject<HTMLDivElement | null>
  trackRowRefs: RefObject<Map<string, HTMLDivElement>>
}): TimelineTracks {
  const { document, bodyRef, trackRowRefs } = options
  const t = useT()
  const run = useEditorStore((state) => state.run)

  /**
   * Cỡ lane đang dùng, đọc từ chính track đầu tiên.
   *
   * Không giữ thành một trường riêng trong dự án: chiều cao vốn đã nằm ở từng
   * track và được lưu sẵn, thêm một chỗ nữa là mở đường cho hai con số lệch nhau.
   */
  const trackHeightPx = document?.tracks[0]?.height ?? DEFAULT_TRACK_HEIGHT
  const heightPreset = trackHeightPresetOf(trackHeightPx)

  const setTrackHeight = useCallback(
    (preset: TrackHeightPreset) => {
      const next = TRACK_HEIGHT_PRESETS.find((item) => item.id === preset)
      if (!document || !next) return
      // Đổi cả loạt trong MỘT lệnh: một lần chọn cỡ là một bước hoàn tác, không
      // phải một bước cho mỗi track.
      run(
        document.tracks.map(
          (track) =>
            ({
              type: 'track/update',
              trackId: track.id,
              patch: { height: next.px }
            }) as EditorCommand
        ),
        t.timeline.trackHeight
      )
    },
    [document, run, t.timeline.trackHeight]
  )

  const addTrack = useCallback(
    (kind: AddableTrackKind) => {
      if (!document) return
      const count = document.tracks.filter((track) => track.kind === kind).length + 1
      const names = { video: `Video ${count}`, audio: `Âm thanh ${count}`, text: `Text ${count}` }
      const labels = {
        video: t.timeline.addVideoTrack,
        audio: t.timeline.addAudioTrack,
        text: t.timeline.addTextTrack
      }
      run(
        [
          {
            type: 'track/add',
            kind,
            name: names[kind],
            role: kind === 'audio' ? 'dialogue' : undefined,
            // Khớp cỡ lane đang chọn, nếu không lane mới cao chênh giữa đám.
            height: trackHeightPx
          }
        ],
        labels[kind]
      )
    },
    [
      document,
      run,
      trackHeightPx,
      t.timeline.addVideoTrack,
      t.timeline.addAudioTrack,
      t.timeline.addTextTrack
    ]
  )

  /**
   * Đưa track vừa thêm vào tầm nhìn.
   *
   * Ở chiều cao mặc định của timeline chỉ vừa khoảng bốn lane, nên track thứ năm
   * trở đi được tạo ra NGOÀI tầm nhìn: bấm "Thêm track" xong màn hình không đổi
   * gì cả và trông y như cái nút không ăn.
   *
   * Cuộn VỪA ĐỦ chứ không nhảy xuống đáy: nhảy đáy thì những lane phía trên biến
   * mất hết, và người dùng mất luôn chỗ dựa để nhận ra có gì vừa thêm.
   *
   * Mốc so sánh phải kèm id dự án. Lần đầu tài liệu về, số track nhảy từ 0 lên N
   * — không phân biệt thì mở một dự án có sẵn năm track cũng bị cuộn, và hai lane
   * đầu rơi khỏi màn hình ngay khi vừa mở.
   */
  const projectIdRef = useRef<string | null>(null)
  const trackCountRef = useRef(0)
  const projectId = document?.id ?? null
  const trackCount = document?.tracks.length ?? 0
  const lastTrackId = document?.tracks.at(-1)?.id

  useLayoutEffect(() => {
    const sameProject = projectIdRef.current === projectId
    const previous = trackCountRef.current
    projectIdRef.current = projectId
    trackCountRef.current = trackCount
    if (!sameProject || trackCount <= previous) return

    // Tự tính rồi cuộn CHÍNH `.timeline__body`, không dùng `scrollIntoView`.
    // `scrollIntoView` cuộn khung cuộn gần nhất, mà khung đó là `.timeline__scroll`
    // — nơi chỉ chứa cột lane, không chứa cột đầu track. Đo được: nó kéo lane đi
    // còn đầu track đứng yên, và hai cột lệch hàng nhau.
    const row = lastTrackId ? trackRowRefs.current.get(lastTrackId) : undefined
    const body = bodyRef.current
    if (!row || !body) return

    const rowRect = row.getBoundingClientRect()
    const frame = body.getBoundingClientRect()
    if (rowRect.bottom > frame.bottom) body.scrollTop += rowRect.bottom - frame.bottom
    else if (rowRect.top < frame.top) body.scrollTop -= frame.top - rowRect.top
  }, [projectId, trackCount, lastTrackId, bodyRef, trackRowRefs])

  return { trackHeightPx, heightPreset, setTrackHeight, addTrack }
}
