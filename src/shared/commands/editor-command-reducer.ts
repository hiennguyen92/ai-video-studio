import { NEUTRAL_COLOR_GRADE, clampColorGrade } from '../domain/clip-color-grade'
import { current, isDraft } from 'immer'
import type { EditorCommand } from './editor-command-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { isAssetInUse } from '../domain/project-document-types'
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_TRACK_HEIGHT,
  clipEndUs,
  type Clip
} from '../domain/timeline-track-types'
import { createId } from '../domain/project-document-factory'
import {
  placeClip,
  rippleDeleteRange,
  sortClips,
  splitClipAt,
  trimClipEdgeTo
} from './timeline-mutations'

/**
 * Reducer thuần: áp một command lên draft của project document.
 *
 * Hàm này KHÔNG tự tạo lịch sử undo và KHÔNG tăng revision — việc đó do
 * `command-history.ts` lo, để reducer chỉ có đúng một trách nhiệm.
 *
 * Trả về lỗi thay vì ném ngoại lệ: lệnh có thể đến từ AI, và một lệnh sai
 * không được phép làm sập ứng dụng.
 */

export type CommandResult = { ok: true } | { ok: false; error: string }

/**
 * Ảnh chụp dữ liệu thuần từ draft của immer.
 *
 * `current()` chỉ nhận draft, trong khi một nhánh chưa bị chạm tới vẫn là dữ liệu
 * gốc đã đóng băng. Các hàm trong `timeline-mutations` cần mảng thuần nên phải đi
 * qua đây thay vì gọi thẳng `current()`.
 */
function snapshot<T>(value: T): T {
  return isDraft(value) ? (current(value) as T) : value
}

const OK: CommandResult = { ok: true }
const MIN_CLIP_DURATION_US = 1000 // 1 ms

function fail(error: string): CommandResult {
  return { ok: false, error }
}

/** Ảnh không có thời lượng cố định nên không bị kẹp biên khi kéo dài. */
function assetDurationLimitUs(doc: ProjectDocument, assetId?: string): number | undefined {
  if (!assetId) return undefined
  const asset = doc.assets.find((item) => item.id === assetId)
  if (!asset || asset.kind === 'image') return undefined
  return asset.probe.durationUs
}

function locateClip(
  doc: ProjectDocument,
  clipId: string
): { trackIndex: number; clipIndex: number } | null {
  for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex += 1) {
    const clipIndex = doc.tracks[trackIndex].clips.findIndex((clip) => clip.id === clipId)
    if (clipIndex >= 0) return { trackIndex, clipIndex }
  }
  return null
}

/**
 * Track có vẽ ra khung hình không.
 *
 * Lane ảnh và lane hình cùng vẽ ra hình nên cùng nhận chuyển cảnh, chuyển động và
 * chỉnh màu. Chỉ so `kind === 'video'` thì các ô đó vẫn hiện trên panel nhưng
 * lệnh bị từ chối, và người dùng bấm mãi không thấy gì đổi.
 */
function isVisualTrack(track: { kind: string }): boolean {
  return track.kind === 'video' || track.kind === 'image'
}

export function applyEditorCommand(doc: ProjectDocument, command: EditorCommand): CommandResult {
  switch (command.type) {
    case 'project/rename': {
      doc.name = command.name
      return OK
    }

    case 'project/set-settings': {
      Object.assign(doc.settings, command.settings)
      return OK
    }

    case 'track/add': {
      const index = command.index ?? doc.tracks.length
      doc.tracks.splice(Math.min(index, doc.tracks.length), 0, {
        id: command.trackId ?? createId('track'),
        kind: command.kind,
        role: command.role,
        name: command.name,
        hidden: false,
        muted: false,
        solo: false,
        locked: false,
        volume: 1,
        height: command.height ?? DEFAULT_TRACK_HEIGHT,
        subtitleTrackId: command.subtitleTrackId,
        clips: []
      })
      return OK
    }

    case 'track/remove': {
      const index = doc.tracks.findIndex((track) => track.id === command.trackId)
      if (index < 0) return fail(`Không tìm thấy track ${command.trackId}`)
      if (doc.tracks[index].locked) return fail('Track đang bị khoá')

      // Chữ overlay nằm ở cấp tài liệu chứ không nằm trong track, nên xoá lane
      // chữ phải xoá luôn những dòng thuộc nó — cùng MỘT lệnh, để hoàn tác trả
      // lại cả hai. Không làm thì lane biến mất còn chữ vẫn hiện trên hình mà
      // không còn chỗ nào bấm vào để sửa.
      if (doc.tracks[index].kind === 'text') {
        doc.textOverlays = doc.textOverlays.filter((overlay) => overlay.trackId !== command.trackId)
      }

      doc.tracks.splice(index, 1)
      return OK
    }

    case 'track/reorder': {
      const from = doc.tracks.findIndex((track) => track.id === command.trackId)
      if (from < 0) return fail(`Không tìm thấy track ${command.trackId}`)
      const [moved] = doc.tracks.splice(from, 1)
      doc.tracks.splice(Math.min(command.toIndex, doc.tracks.length), 0, moved)
      return OK
    }

    case 'track/update': {
      const track = doc.tracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track ${command.trackId}`)
      Object.assign(track, command.patch)
      // Solo chỉ có nghĩa với audio và mỗi lúc chỉ một track được solo.
      if (command.patch.solo === true && track.kind === 'audio') {
        for (const other of doc.tracks) {
          if (other.id !== track.id) other.solo = false
        }
      }
      return OK
    }

    case 'clip/insert': {
      const track = doc.tracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track ${command.trackId}`)
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      const asset = doc.assets.find((item) => item.id === command.assetId)
      if (!asset) return fail(`Không tìm thấy media ${command.assetId}`)
      if (track.kind === 'subtitle') return fail('Không thể chèn media vào track phụ đề')

      const clip: Clip = {
        id: command.clipId ?? createId('clip'),
        assetId: command.assetId,
        startUs: command.startUs,
        durationUs: command.durationUs,
        sourceInUs: command.sourceInUs,
        speed: 1,
        volume: 1,
        fadeInUs: 0,
        fadeOutUs: 0,
        // Lane ảnh cũng cần biến đổi: đặt logo hay ảnh sản phẩm là phải kéo cỡ
        // và dời chỗ được, y như clip hình.
        transform: isVisualTrack(track) ? { ...DEFAULT_CLIP_TRANSFORM } : undefined,
        linkGroupId: command.linkGroupId,
        label: command.label
      }
      track.clips = placeClip({ ...track, clips: snapshot(track.clips) }, clip, () =>
        createId('clip')
      )
      return OK
    }

    case 'clip/remove': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      track.clips.splice(found.clipIndex, 1)
      return OK
    }

    case 'clip/move': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const sourceTrack = doc.tracks[found.trackIndex]
      if (sourceTrack.locked) return fail(`Track "${sourceTrack.name}" đang bị khoá`)

      const targetTrack = command.toTrackId
        ? doc.tracks.find((item) => item.id === command.toTrackId)
        : sourceTrack
      if (!targetTrack) return fail(`Không tìm thấy track ${command.toTrackId}`)
      if (targetTrack.locked) return fail(`Track "${targetTrack.name}" đang bị khoá`)
      if (targetTrack.kind !== sourceTrack.kind) {
        return fail('Không thể chuyển clip sang track khác loại')
      }

      const clip = snapshot(sourceTrack.clips[found.clipIndex])
      sourceTrack.clips.splice(found.clipIndex, 1)
      const moved: Clip = { ...clip, startUs: command.toStartUs }
      targetTrack.clips = placeClip(
        { ...targetTrack, clips: snapshot(targetTrack.clips) },
        moved,
        () => createId('clip')
      )
      return OK
    }

    case 'clip/trim': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)

      const clip = snapshot(track.clips[found.clipIndex])
      const trimmed = trimClipEdgeTo(clip, command.edge, command.toUs, {
        assetDurationUs: assetDurationLimitUs(doc, clip.assetId),
        minDurationUs: MIN_CLIP_DURATION_US
      })
      if (!trimmed) return fail('Kết quả cắt không hợp lệ')

      const others = snapshot(track.clips).filter((item) => item.id !== clip.id)
      track.clips = placeClip({ ...track, clips: others }, trimmed, () => createId('clip'))
      return OK
    }

    case 'clip/split': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)

      const clip = snapshot(track.clips[found.clipIndex])
      const halves = splitClipAt(clip, command.atUs, command.newClipId ?? createId('clip'))
      if (!halves) return fail('Điểm cắt nằm ngoài clip')
      track.clips.splice(found.clipIndex, 1, ...halves)
      return OK
    }

    case 'clip/set-transition': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      // Chuyển cảnh là hiệu ứng hình; đặt lên track tiếng không có nghĩa gì.
      // Lane ảnh cũng vẽ ra khung hình nên vẫn nhận.
      if (!isVisualTrack(track)) return fail('Chỉ đặt được chuyển cảnh cho clip hình')

      const clip = track.clips[found.clipIndex]
      clip.transitionIn = command.transition ? { ...command.transition } : undefined
      return OK
    }

    case 'clip/set-motion': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      // Chuyển động là hiệu ứng hình, đặt lên track tiếng không có nghĩa gì.
      if (!isVisualTrack(track)) return fail('Chỉ đặt được chuyển động cho clip hình')

      const clip = track.clips[found.clipIndex]
      clip.motion = command.motion ? { ...command.motion } : undefined
      return OK
    }

    case 'clip/set-color-grade': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      if (!isVisualTrack(track)) return fail('Chỉ chỉnh màu được cho clip hình')

      const clip = track.clips[found.clipIndex]
      // Trộn vào giá trị đang có: chỉnh riêng một thông số không được xoá những
      // thông số đã đặt trước đó.
      clip.colorGrade = command.grade
        ? clampColorGrade({ ...(clip.colorGrade ?? NEUTRAL_COLOR_GRADE), ...command.grade })
        : undefined
      return OK
    }

    case 'timeline/ripple-delete': {
      if (command.toUs <= command.fromUs) return fail('Khoảng cần xoá phải lớn hơn 0')

      const targets = command.trackIds
        ? doc.tracks.filter((track) => command.trackIds?.includes(track.id))
        : doc.tracks
      if (targets.length === 0) return fail('Không tìm thấy track nào để xoá')

      const locked = targets.find((track) => track.locked)
      if (locked) return fail(`Track "${locked.name}" đang bị khoá`)

      for (const track of targets) {
        track.clips = rippleDeleteRange(snapshot(track.clips), command.fromUs, command.toUs, {
          makeId: () => createId('clip')
        })
      }

      // Cue phụ đề cũng phải trôi theo, nếu không phụ đề sẽ lệch hẳn khỏi hình.
      // Chỉ làm khi ripple áp cho toàn bộ track; ripple lệch track là chủ ý của
      // người dùng, không nên tự ý đụng vào phụ đề.
      if (!command.trackIds) {
        const span = command.toUs - command.fromUs
        for (const subtitleTrack of doc.subtitleTracks) {
          subtitleTrack.cues = snapshot(subtitleTrack.cues)
            .filter((cue) => !(cue.startUs >= command.fromUs && cue.endUs <= command.toUs))
            .map((cue) =>
              cue.startUs >= command.toUs
                ? { ...cue, startUs: cue.startUs - span, endUs: cue.endUs - span }
                : cue
            )
        }
      }
      return OK
    }

    case 'clip/duplicate': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)

      const clip = snapshot(track.clips[found.clipIndex])
      const copy: Clip = {
        ...clip,
        id: command.newClipId ?? createId('clip'),
        startUs: clipEndUs(clip),
        linkGroupId: undefined
      }
      track.clips = placeClip({ ...track, clips: snapshot(track.clips) }, copy, () =>
        createId('clip')
      )
      return OK
    }

    case 'clip/update': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)

      const clip = track.clips[found.clipIndex]
      Object.assign(clip, command.patch)
      // Fade không bao giờ được dài hơn chính clip.
      clip.fadeInUs = Math.min(clip.fadeInUs, clip.durationUs)
      clip.fadeOutUs = Math.min(clip.fadeOutUs, clip.durationUs)
      return OK
    }

    case 'transcript/add': {
      if (doc.transcripts.some((item) => item.id === command.transcript.id)) {
        return fail(`Transcript ${command.transcript.id} đã tồn tại`)
      }
      doc.transcripts.push(command.transcript)
      return OK
    }

    case 'transcript/remove': {
      const index = doc.transcripts.findIndex((item) => item.id === command.transcriptId)
      if (index < 0) return fail(`Không tìm thấy transcript ${command.transcriptId}`)
      doc.transcripts.splice(index, 1)
      // Bản dịch mất gốc thì không còn ý nghĩa; xoá theo để không tạo dữ liệu mồ côi.
      doc.translations = doc.translations.filter(
        (translation) => translation.transcriptId !== command.transcriptId
      )
      return OK
    }

    case 'transcript/update-segment': {
      const transcript = doc.transcripts.find((item) => item.id === command.transcriptId)
      if (!transcript) return fail(`Không tìm thấy transcript ${command.transcriptId}`)
      const segment = transcript.segments.find((item) => item.id === command.segmentId)
      if (!segment) return fail(`Không tìm thấy đoạn ${command.segmentId}`)

      segment.text = command.text
      // Đánh dấu đã sửa tay để lần phiên âm lại không ghi đè công sức người dùng.
      segment.edited = true
      // Timestamp mức từ không còn khớp với chữ mới; bỏ đi thay vì giữ dữ liệu sai.
      segment.words = undefined
      return OK
    }

    case 'transcript/merge-segments': {
      const transcript = doc.transcripts.find((item) => item.id === command.transcriptId)
      if (!transcript) return fail(`Không tìm thấy transcript ${command.transcriptId}`)
      const index = transcript.segments.findIndex((item) => item.id === command.segmentId)
      if (index < 0) return fail(`Không tìm thấy đoạn ${command.segmentId}`)
      if (index + 1 >= transcript.segments.length) return fail('Không có đoạn kế tiếp để gộp')

      const current = transcript.segments[index]
      const next = transcript.segments[index + 1]
      current.text = `${current.text} ${next.text}`.trim()
      current.endUs = next.endUs
      current.words = current.words && next.words ? [...current.words, ...next.words] : undefined
      current.edited = true
      transcript.segments.splice(index + 1, 1)
      return OK
    }

    case 'translation/add': {
      if (doc.translations.some((item) => item.id === command.translation.id)) {
        return fail(`Bản dịch ${command.translation.id} đã tồn tại`)
      }
      // Bản dịch không được tồn tại tách rời bản gốc: mất gốc thì mốc thời gian
      // của nó không quy chiếu vào đâu được nữa.
      if (!doc.transcripts.some((item) => item.id === command.translation.transcriptId)) {
        return fail(`Không tìm thấy transcript ${command.translation.transcriptId}`)
      }
      doc.translations.push(command.translation)
      return OK
    }

    case 'translation/remove': {
      const index = doc.translations.findIndex((item) => item.id === command.translationId)
      if (index < 0) return fail(`Không tìm thấy bản dịch ${command.translationId}`)
      doc.translations.splice(index, 1)
      return OK
    }

    case 'translation/update-segment': {
      const translation = doc.translations.find((item) => item.id === command.translationId)
      if (!translation) return fail(`Không tìm thấy bản dịch ${command.translationId}`)
      const segment = translation.segments.find((item) => item.id === command.segmentId)
      if (!segment) return fail(`Không tìm thấy đoạn ${command.segmentId}`)

      segment.text = command.text
      // Đánh dấu để lần dịch lại không ghi đè bản người dùng đã chỉnh.
      segment.edited = true
      return OK
    }

    case 'translation/set-glossary': {
      const translation = doc.translations.find((item) => item.id === command.translationId)
      if (!translation) return fail(`Không tìm thấy bản dịch ${command.translationId}`)
      translation.glossary = command.glossary.map((entry) => ({ ...entry }))
      return OK
    }

    case 'text/add': {
      if (doc.textOverlays.some((item) => item.id === command.overlay.id)) {
        return fail(`Chữ overlay ${command.overlay.id} đã tồn tại`)
      }
      if (command.overlay.endUs <= command.overlay.startUs) {
        return fail('Thời điểm kết thúc phải sau thời điểm bắt đầu')
      }
      doc.textOverlays.push(command.overlay)
      return OK
    }

    case 'text/remove': {
      const index = doc.textOverlays.findIndex((item) => item.id === command.overlayId)
      if (index < 0) return fail(`Không tìm thấy chữ overlay ${command.overlayId}`)
      doc.textOverlays.splice(index, 1)
      return OK
    }

    case 'text/update': {
      const overlay = doc.textOverlays.find((item) => item.id === command.overlayId)
      if (!overlay) return fail(`Không tìm thấy chữ overlay ${command.overlayId}`)

      const nextStart = command.startUs ?? overlay.startUs
      const nextEnd = command.endUs ?? overlay.endUs
      // Khoảng ngược sẽ khiến chữ biến mất khỏi preview mà không báo gì.
      if (nextEnd <= nextStart) return fail('Thời điểm kết thúc phải sau thời điểm bắt đầu')

      if (command.text !== undefined) overlay.text = command.text
      if (command.trackId !== undefined) {
        // Lane phải có thật và phải là lane chữ. Nhận bừa thì dòng chữ trỏ vào
        // một lane không tồn tại và lặng lẽ rơi xuống lane ảo.
        const lane = doc.tracks.find((item) => item.id === command.trackId)
        if (!lane || lane.kind !== 'text') return fail(`Không tìm thấy lane chữ ${command.trackId}`)
        overlay.trackId = command.trackId
      }
      if (command.animation !== undefined) overlay.animation = command.animation
      if (command.exitAnimation !== undefined) overlay.exitAnimation = command.exitAnimation
      if (command.glow !== undefined) overlay.glow = command.glow
      if (command.animationDurationUs !== undefined) {
        overlay.animationDurationUs = command.animationDurationUs
      }
      overlay.startUs = nextStart
      overlay.endUs = nextEnd
      return OK
    }

    case 'text/set-style': {
      const overlay = doc.textOverlays.find((item) => item.id === command.overlayId)
      if (!overlay) return fail(`Không tìm thấy chữ overlay ${command.overlayId}`)
      overlay.style = { ...command.style }
      return OK
    }

    case 'subtitle/add-track': {
      if (doc.subtitleTracks.some((item) => item.id === command.track.id)) {
        return fail(`Track phụ đề ${command.track.id} đã tồn tại`)
      }
      doc.subtitleTracks.push(command.track)
      return OK
    }

    case 'subtitle/remove-track': {
      const index = doc.subtitleTracks.findIndex((item) => item.id === command.trackId)
      if (index < 0) return fail(`Không tìm thấy track phụ đề ${command.trackId}`)
      doc.subtitleTracks.splice(index, 1)
      // Lane trên timeline đang trỏ tới track vừa xoá thì phải bỏ tham chiếu,
      // nếu không preview sẽ đọc vào track không còn tồn tại.
      for (const track of doc.tracks) {
        if (track.subtitleTrackId === command.trackId) track.subtitleTrackId = undefined
      }
      return OK
    }

    case 'subtitle/rename-track': {
      const track = doc.subtitleTracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track phụ đề ${command.trackId}`)
      track.name = command.name
      return OK
    }

    case 'subtitle/set-style': {
      const track = doc.subtitleTracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track phụ đề ${command.trackId}`)
      track.style = { ...command.style }
      return OK
    }

    case 'subtitle/update-cue': {
      const track = doc.subtitleTracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track phụ đề ${command.trackId}`)
      const cue = track.cues.find((item) => item.id === command.cueId)
      if (!cue) return fail(`Không tìm thấy cue ${command.cueId}`)

      const nextStart = command.startUs ?? cue.startUs
      const nextEnd = command.endUs ?? cue.endUs
      // Cue kết thúc trước khi bắt đầu sẽ biến mất khỏi preview mà không báo gì.
      if (nextEnd <= nextStart) return fail('Thời điểm kết thúc phải sau thời điểm bắt đầu')

      if (command.text !== undefined) cue.text = command.text
      if (command.textSecondary !== undefined) cue.textSecondary = command.textSecondary
      cue.startUs = nextStart
      cue.endUs = nextEnd
      cue.edited = true
      return OK
    }

    case 'subtitle/move-cue': {
      const from = doc.subtitleTracks.find((item) => item.id === command.fromTrackId)
      if (!from) return fail(`Không tìm thấy track phụ đề ${command.fromTrackId}`)
      const to = doc.subtitleTracks.find((item) => item.id === command.toTrackId)
      if (!to) return fail(`Không tìm thấy track phụ đề ${command.toTrackId}`)

      const index = from.cues.findIndex((item) => item.id === command.cueId)
      if (index < 0) return fail(`Không tìm thấy cue ${command.cueId}`)

      const cue = from.cues[index]
      const nextStart = command.startUs ?? cue.startUs
      const nextEnd = command.endUs ?? cue.endUs
      if (nextEnd <= nextStart) return fail('Thời điểm kết thúc phải sau thời điểm bắt đầu')

      // Kiểm tra XONG mới đụng vào dữ liệu: thoát giữa chừng sau khi đã gỡ cue ra
      // là làm mất hẳn nó.
      if (command.fromTrackId === command.toTrackId) {
        cue.startUs = nextStart
        cue.endUs = nextEnd
        return OK
      }

      from.cues.splice(index, 1)
      cue.startUs = nextStart
      cue.endUs = nextEnd
      // Chèn đúng chỗ theo thời gian: danh sách cue được đọc tuần tự khi ghi file
      // SRT/ASS, và mốc thời gian nhảy lung tung thì trình phát không tua đúng.
      const at = to.cues.findIndex((item) => item.startUs > cue.startUs)
      to.cues.splice(at < 0 ? to.cues.length : at, 0, cue)
      return OK
    }

    case 'subtitle/remove-cue': {
      const track = doc.subtitleTracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track phụ đề ${command.trackId}`)
      const index = track.cues.findIndex((item) => item.id === command.cueId)
      if (index < 0) return fail(`Không tìm thấy cue ${command.cueId}`)
      track.cues.splice(index, 1)
      return OK
    }

    case 'subtitle/replace-cues': {
      const track = doc.subtitleTracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track phụ đề ${command.trackId}`)
      track.cues = command.cues.map((cue) => ({ ...cue }))
      return OK
    }

    case 'dubbing/add-session': {
      if (doc.dubbingSessions.some((item) => item.id === command.session.id)) {
        return fail(`Phiên lồng tiếng ${command.session.id} đã tồn tại`)
      }
      doc.dubbingSessions.push(command.session)
      return OK
    }

    case 'dubbing/remove-session': {
      const index = doc.dubbingSessions.findIndex((item) => item.id === command.sessionId)
      if (index < 0) return fail(`Không tìm thấy phiên lồng tiếng ${command.sessionId}`)
      doc.dubbingSessions.splice(index, 1)
      return OK
    }

    case 'dubbing/update-segment': {
      const session = doc.dubbingSessions.find((item) => item.id === command.sessionId)
      if (!session) return fail(`Không tìm thấy phiên lồng tiếng ${command.sessionId}`)
      const segment = session.segments.find((item) => item.id === command.segmentId)
      if (!segment) return fail(`Không tìm thấy đoạn ${command.segmentId}`)

      if (command.assetId !== undefined) segment.assetId = command.assetId
      if (command.generatedDurationUs !== undefined) {
        segment.generatedDurationUs = command.generatedDurationUs
      }
      if (command.status !== undefined) segment.status = command.status
      segment.error = command.error
      return OK
    }

    case 'dubbing/set-overflow-strategy': {
      const session = doc.dubbingSessions.find((item) => item.id === command.sessionId)
      if (!session) return fail(`Không tìm thấy phiên lồng tiếng ${command.sessionId}`)
      const segment = session.segments.find((item) => item.id === command.segmentId)
      if (!segment) return fail(`Không tìm thấy đoạn ${command.segmentId}`)

      // Chỉ cho chọn tăng tốc khi nó thật sự đủ và còn trong ngưỡng nghe được.
      if (command.strategy === 'speed-up') {
        const span = segment.targetEndUs - segment.targetStartUs
        const measured = segment.generatedDurationUs
        if (measured === undefined) return fail('Chưa tạo audio nên chưa tính được tốc độ')
        if (span <= 0 || measured / span > session.maxSpeedUp) {
          return fail('Tăng tốc vượt quá giới hạn cho phép; hãy rút ngắn lời hoặc kéo dài timeline')
        }
      }
      segment.overflowStrategy = command.strategy
      return OK
    }

    case 'asset/add': {
      if (doc.assets.some((asset) => asset.id === command.asset.id)) {
        return fail(`Media ${command.asset.id} đã có trong dự án`)
      }
      doc.assets.push(command.asset)
      return OK
    }

    case 'asset/relink': {
      const index = doc.assets.findIndex((asset) => asset.id === command.asset.id)
      if (index < 0) return fail(`Không tìm thấy media ${command.asset.id}`)
      // Giữ nguyên id nên mọi clip đang dùng asset này vẫn hoạt động.
      doc.assets[index] = command.asset
      return OK
    }

    case 'asset/remove': {
      const index = doc.assets.findIndex((asset) => asset.id === command.assetId)
      if (index < 0) return fail(`Không tìm thấy media ${command.assetId}`)
      if (isAssetInUse(doc, command.assetId) && !command.removeUsages) {
        return fail('Media đang được dùng trên timeline')
      }
      for (const track of doc.tracks) {
        track.clips = sortClips(
          snapshot(track.clips).filter((clip) => clip.assetId !== command.assetId)
        )
      }
      doc.assets.splice(index, 1)
      return OK
    }

    case 'asset/set-tags': {
      const asset = doc.assets.find((item) => item.id === command.assetId)
      if (!asset) return fail(`Không tìm thấy media ${command.assetId}`)
      asset.tags = command.tags
      return OK
    }

    default: {
      const exhaustive: never = command
      return fail(`Lệnh không được hỗ trợ: ${JSON.stringify(exhaustive)}`)
    }
  }
}
