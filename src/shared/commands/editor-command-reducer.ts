import { NEUTRAL_COLOR_GRADE, clampColorGrade } from '../domain/clip-color-grade'
import { current, isDraft } from 'immer'
import type { EditorCommand } from './editor-command-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { isAssetInUse } from '../domain/project-document-types'
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_TRACK_HEIGHT,
  clipEndUs,
  clipSourceSpanUs,
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
import { rateStretchClip, rippleTrimTrackClips, slipClip } from './timeline-edit-tools'
import { sanitizeClipForPaste } from './clip-paste-sanitize'
import {
  cloneKeyframes,
  compactKeyframes,
  pruneEffectKeyframes,
  scaleKeyframes
} from '../domain/keyframe-clip-edits'
import {
  normalizeKeyframeTrack,
  type Keyframe,
  type KeyframeTracks
} from '../domain/keyframe-types'
import {
  resolveClipProperty,
  resolveTextProperty,
  type ResolvedProperty
} from '../domain/keyframe-property-catalog'

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

/**
 * Chủ thể mang keyframe, kèm cách tra khoảng giá trị của một đường dẫn.
 *
 * Gom hai nhánh (clip / chữ overlay) về một chỗ để ba lệnh keyframe không phải
 * lặp lại cùng một bộ kiểm tra ba lần — và để lời từ chối luôn cùng một câu chữ
 * dù người dùng đang đụng vào clip hay đụng vào chữ.
 */
function locateKeyframeSubject(
  doc: ProjectDocument,
  target: { kind: 'clip'; clipId: string } | { kind: 'text'; overlayId: string },
  path: string
):
  | { ok: true; subject: { keyframes?: KeyframeTracks }; property: ResolvedProperty }
  | { ok: false; error: string } {
  if (target.kind === 'clip') {
    const found = locateClip(doc, target.clipId)
    if (!found) return { ok: false, error: `Không tìm thấy clip ${target.clipId}` }
    const track = doc.tracks[found.trackIndex]
    if (track.locked) return { ok: false, error: `Track "${track.name}" đang bị khoá` }
    const clip = track.clips[found.clipIndex]
    const property = resolveClipProperty(snapshot(clip), path)
    if (!property) return { ok: false, error: `Thuộc tính "${path}" không đặt keyframe được` }
    return { ok: true, subject: clip, property }
  }

  const overlay = doc.textOverlays.find((item) => item.id === target.overlayId)
  if (!overlay) return { ok: false, error: `Không tìm thấy chữ overlay ${target.overlayId}` }
  const property = resolveTextProperty(snapshot(overlay), path)
  if (!property) return { ok: false, error: `Thuộc tính "${path}" không đặt keyframe được` }
  return { ok: true, subject: overlay, property }
}

/** Ghi lại một đường keyframe đã sửa, dọn luôn khoá rỗng. */
function writeKeyframeTrack(
  subject: { keyframes?: KeyframeTracks },
  path: string,
  track: Keyframe[]
): void {
  const tracks: KeyframeTracks = { ...snapshot(subject.keyframes) }
  if (track.length > 0) tracks[path] = track
  else delete tracks[path]
  subject.keyframes = compactKeyframes(tracks)
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

    case 'clip/paste': {
      const track = doc.tracks.find((item) => item.id === command.trackId)
      if (!track) return fail(`Không tìm thấy track ${command.trackId}`)
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      if (track.kind === 'subtitle') return fail('Không dán được clip vào track phụ đề')

      const pasted = sanitizeClipForPaste(command.clip, {
        id: command.clipId ?? createId('clip'),
        startUs: command.startUs
      })
      if (!pasted) return fail('Clip đã chép không còn hợp lệ')
      // Media phải còn trong dự án: dán một clip trỏ tới asset đã xoá là tạo ra
      // một clip không bao giờ vẽ được gì.
      if (!doc.assets.some((asset) => asset.id === pasted.assetId)) {
        return fail('Media của clip đã chép không còn trong dự án')
      }

      track.clips = placeClip({ ...track, clips: snapshot(track.clips) }, pasted, () =>
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

    case 'clip/ripple-trim': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      const clip = track.clips[found.clipIndex]
      const next = rippleTrimTrackClips(
        snapshot(track.clips),
        clip.id,
        command.edge,
        command.toUs,
        {
          assetDurationUs: assetDurationLimitUs(doc, clip.assetId),
          minDurationUs: MIN_CLIP_DURATION_US
        }
      )
      if (!next) return fail('Kết quả cắt không hợp lệ')
      track.clips = next
      return OK
    }

    case 'clip/slip': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      const clip = track.clips[found.clipIndex]
      const limit = assetDurationLimitUs(doc, clip.assetId)
      // Ảnh tĩnh không có đoạn nguồn nào để trượt.
      if (limit === undefined) return fail('Chỉ slip được clip hình hoặc clip tiếng')
      clip.sourceInUs = slipClip(snapshot(clip), command.toSourceInUs, limit).sourceInUs
      return OK
    }

    case 'clip/rate-stretch': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      // Cùng lý do với đổi tốc độ: ảnh tĩnh không có trục thời gian để phát nhanh chậm.
      if (track.kind !== 'video' && track.kind !== 'audio') {
        return fail('Chỉ đổi được tốc độ của clip hình hoặc clip tiếng')
      }
      const clip = snapshot(track.clips[found.clipIndex])
      const stretched = rateStretchClip(clip, command.edge, command.toUs, MIN_CLIP_DURATION_US)
      if (!stretched) return fail('Tốc độ này làm clip ngắn quá')
      // Cùng bản chất với đổi tốc độ: thang thời gian của clip co lại hay giãn
      // ra, nên mốc keyframe phải đi theo.
      stretched.keyframes = scaleKeyframes(clip.keyframes, clip.durationUs, stretched.durationUs)
      const others = snapshot(track.clips).filter((item) => item.id !== clip.id)
      track.clips = placeClip({ ...track, clips: others }, stretched, () => createId('clip'))
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
      const next = command.transition ? { ...command.transition } : undefined
      if (command.edge === 'out') clip.transitionOut = next
      else clip.transitionIn = next
      return OK
    }

    case 'clip/set-speed': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      // Ảnh tĩnh không có trục thời gian riêng, nên "phát nhanh gấp đôi" vô nghĩa
      // — kéo dài ngắn một tấm ảnh là việc của cắt mép.
      if (track.kind !== 'video' && track.kind !== 'audio') {
        return fail('Chỉ đổi được tốc độ của clip hình hoặc clip tiếng')
      }

      const clip = snapshot(track.clips[found.clipIndex])
      // GIỮ NGUYÊN khoảng nguồn, đổi độ dài trên timeline. Hai cái lợi: nó khớp
      // thứ người dùng mong đợi ("cùng đoạn phim đó, phát nhanh hơn"), và nó
      // không bao giờ phá được bất biến nguồn — phần nguồn tiêu thụ không đổi thì
      // `sourceInUs + span` cũng không đổi.
      const span = clipSourceSpanUs(clip)
      const nextDuration = Math.round(span / command.speed)
      if (nextDuration < MIN_CLIP_DURATION_US) return fail('Tốc độ này làm clip ngắn quá')

      const others = snapshot(track.clips).filter((item) => item.id !== clip.id)
      track.clips = placeClip(
        { ...track, clips: others },
        {
          ...clip,
          speed: command.speed,
          durationUs: nextDuration,
          // Clip phát nhanh gấp đôi thì keyframe đặt "ở cuối clip" phải vẫn nằm
          // ở cuối. Không co giãn theo là mọi chuyển động dồn về nửa đầu còn
          // nửa sau đứng hình.
          keyframes: scaleKeyframes(clip.keyframes, clip.durationUs, nextDuration)
        },
        () => createId('clip')
      )
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

    case 'clip/set-look': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      // Look là hiệu ứng hình: clip tiếng không có gì để đổi màu.
      if (!isVisualTrack(track)) return fail('Chỉ đặt được look màu cho clip hình')

      const clip = track.clips[found.clipIndex]
      clip.look = command.look ? { ...command.look } : undefined
      return OK
    }

    case 'clip/set-effects': {
      const found = locateClip(doc, command.clipId)
      if (!found) return fail(`Không tìm thấy clip ${command.clipId}`)
      const track = doc.tracks[found.trackIndex]
      if (track.locked) return fail(`Track "${track.name}" đang bị khoá`)
      if (!isVisualTrack(track)) return fail('Chỉ đặt được effect cho clip hình')

      const clip = track.clips[found.clipIndex]
      // Mảng rỗng lưu thành "không có" để dự án không mang trường thừa.
      clip.effects = command.effects.length
        ? command.effects.map((effect) => ({ ...effect, params: { ...effect.params } }))
        : undefined
      // Lệnh này thay CẢ chồng effect, nên nó là nguồn keyframe mồ côi duy nhất
      // trong hệ: gỡ một effect mà không dọn thì đường keyframe của nó nằm lại
      // mãi, và thêm lại đúng id đó sẽ thấy chuyển động cũ sống dậy.
      clip.keyframes = pruneEffectKeyframes(snapshot(clip.keyframes), clip.effects)
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
        linkGroupId: undefined,
        // Sao chép SÂU. Spread chỉ chép một tầng, nên bản sao sẽ dùng chung mảng
        // keyframe với bản gốc — immer che được chuyện đó khi ghi qua draft,
        // nhưng đây là loại phụ thuộc không nên bắt người đọc sau phải suy ra.
        keyframes: cloneKeyframes(clip.keyframes)
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
      // Ba nhánh, không phải hai: `undefined` giữ nguyên, `null` XOÁ, còn lại thì
      // gán. Dùng mẫu một dòng như `glow` ngay trên thì `null` sẽ được gán thẳng
      // vào trường và lớp vẽ nhận một khung rỗng thay vì không có khung nào.
      if (command.frame !== undefined) {
        if (command.frame === null) delete overlay.frame
        else overlay.frame = command.frame
      }
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

    case 'keyframe/set': {
      const located = locateKeyframeSubject(doc, command.target, command.path)
      if (!located.ok) return fail(located.error)

      const current = snapshot(located.subject.keyframes)?.[command.path] ?? []
      // Kẹp ngay lúc GHI, không kẹp lại lúc vẽ: hai đầu mút đã nằm trong khoảng
      // và mọi hàm easing đều đơn điệu trên [0,1], nên giá trị nội suy không thể
      // ra ngoài. Kẹp lại mỗi khung là một phép tính thừa nhân với số thuộc tính
      // nhân với số khung hình.
      const next = normalizeKeyframeTrack(
        [...current, { atUs: command.atUs, v: command.value, e: command.easing }],
        located.property.min,
        located.property.max
      )
      writeKeyframeTrack(located.subject, command.path, next)
      return OK
    }

    case 'keyframe/set-tracks': {
      const paths = Object.keys(command.tracks)
      if (paths.length === 0) return fail('Không có keyframe nào để dán')

      // Kiểm TỪNG đường trước khi ghi bất cứ thứ gì: dán một cụm mà nửa đường
      // hợp lệ nửa không thì người dùng nhận một clip nửa vời, khó lần ra chỗ
      // hỏng hơn hẳn so với bị từ chối thẳng.
      const located = paths.map((path) => ({
        path,
        found: locateKeyframeSubject(doc, command.target, path)
      }))
      const bad = located.find((item) => !item.found.ok)
      if (bad && !bad.found.ok) return fail(bad.found.error)

      for (const item of located) {
        if (!item.found.ok) continue
        writeKeyframeTrack(
          item.found.subject,
          item.path,
          normalizeKeyframeTrack(
            command.tracks[item.path],
            item.found.property.min,
            item.found.property.max
          )
        )
      }
      return OK
    }

    case 'keyframe/remove': {
      const located = locateKeyframeSubject(doc, command.target, command.path)
      if (!located.ok) return fail(located.error)

      const current = snapshot(located.subject.keyframes)?.[command.path] ?? []
      const next = current.filter((frame) => frame.atUs !== command.atUs)
      // Không có gì để xoá thì báo hẳn ra: một bước hoàn tác rỗng mang nhãn "Xoá
      // keyframe" trông như lệnh đã chạy, và người dùng đi tìm thứ không tồn tại.
      if (next.length === current.length) {
        return fail(`Không có keyframe nào của "${command.path}" ở mốc này`)
      }
      writeKeyframeTrack(located.subject, command.path, next)
      return OK
    }

    case 'keyframe/move': {
      const located = locateKeyframeSubject(doc, command.target, command.path)
      if (!located.ok) return fail(located.error)

      const current = snapshot(located.subject.keyframes)?.[command.path] ?? []
      const moving = current.find((frame) => frame.atUs === command.fromAtUs)
      if (!moving) return fail(`Không có keyframe nào của "${command.path}" ở mốc này`)

      const rest = current.filter((frame) => frame.atUs !== command.fromAtUs)
      // Đặt cuối mảng để luật "bản sau thắng" của phần chuẩn hoá xử giúp ca kéo
      // một keyframe đè lên một keyframe khác.
      const next = normalizeKeyframeTrack(
        [...rest, { atUs: command.toAtUs, v: moving.v, e: command.easing ?? moving.e }],
        located.property.min,
        located.property.max
      )
      writeKeyframeTrack(located.subject, command.path, next)
      return OK
    }

    default: {
      const exhaustive: never = command
      return fail(`Lệnh không được hỗ trợ: ${JSON.stringify(exhaustive)}`)
    }
  }
}
