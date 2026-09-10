import type { EditorCommand } from '../commands/editor-command-types'
import type { MediaAsset } from '../domain/media-asset-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { findSoundEffect } from '../domain/sound-effect-catalog'
import { countAssetUsages, findClip } from '../domain/project-document-types'
import { DEFAULT_MOTION_INTENSITY } from '../domain/clip-motion-types'
import { DEFAULT_CLIP_TRANSFORM, clipEndUs, type Clip } from '../domain/timeline-track-types'
import { buildSubtitleCues } from '../domain/subtitle-cue-builder'
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleCue,
  type SubtitleStyle,
  type SubtitleTrack
} from '../domain/subtitle-types'
import {
  DEFAULT_TEXT_ANIMATION_DURATION_US,
  applyTextOverlayBox,
  createDefaultTextOverlayStyle,
  defaultTextTrackId,
  type TextOverlay
} from '../domain/text-overlay-types'
import {
  TEXT_FRAME_DECORS,
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES,
  findTextFrameDecor,
  findTextFramePalette,
  findTextFrameStyle
} from '../domain/text-frame-catalog'
import { guessDuckingTracks, planAutoDucking } from '../domain/auto-ducking-planner'
import { roundHalfUp } from '../domain/time-units'
import { chatToolSchemas, isChatToolName, type ChatToolName } from './chat-tool-catalog'

/**
 * Dịch lời gọi công cụ của AI thành LỆNH SỬA đã có sẵn của trình biên tập.
 *
 * Không có đường nào từ văn bản của mô hình đi thẳng vào tài liệu project: mọi
 * thứ phải đi qua đây, và ở đây chỉ phát ra `EditorCommand` — cùng tập lệnh mà
 * thao tác tay dùng, nên cũng được kiểm tra dữ liệu và hoàn tác y hệt.
 *
 * Module này còn là nơi giải nghĩa những gì người dùng nói tắt: "clip đang chọn",
 * "giây thứ 5". Mô hình không phải tự tra id, nhờ vậy đỡ hẳn một nguồn bịa đặt.
 */

/** Ngữ cảnh biên tập mà mô hình được biết. */
export interface ChatEditContext {
  document: ProjectDocument
  selectedClipIds: string[]
  playheadUs: number
  /**
   * Sinh id mới. Tiền tố cho biết đó là clip, track hay chữ overlay.
   *
   * Không phải chuyện thẩm mỹ: agent đọc bản tổng quan rồi thao tác theo id, và
   * một chữ overlay mang id `clip_…` sẽ khiến nó gọi nhầm công cụ dành cho clip.
   */
  makeId(prefix?: 'clip' | 'track' | 'text'): string
  /**
   * Cú máy đã dò, theo id asset.
   *
   * Không nằm trong tài liệu project vì đây là dữ liệu phái sinh nằm trong cache;
   * nơi gọi nạp vào khi cần dựng theo hình.
   */
  shots?: Record<string, Array<{ startUs: number; endUs: number }>>
  /**
   * Đường dẫn file phông đã chép ra kho, theo tên PostScript (hoặc tên họ khi
   * không nêu kiểu).
   *
   * Cùng lý do như `shots`: planner là hàm thuần, không đọc được byte phông từ hệ
   * thống. Nơi gọi chép sẵn rồi đưa vào đây.
   */
  fontFiles?: Record<string, string>
  /**
   * Asset hiệu ứng âm thanh đã dựng sẵn, theo id trong danh mục.
   *
   * Cùng lý do như `fontFiles`: planner là hàm thuần, không probe được file để
   * biết thời lượng thật hay hash nội dung. Nơi gọi dựng trước rồi đưa vào.
   */
  soundEffects?: Record<string, MediaAsset>
}

export interface PlannedToolCall {
  tool: ChatToolName
  /** Mô tả tiếng Việt để người dùng đọc trước khi áp dụng. */
  description: string
  commands: EditorCommand[]
}

export interface ToolPlanFailure {
  tool: string
  reason: string
}

export interface ChatToolPlan {
  steps: PlannedToolCall[]
  failures: ToolPlanFailure[]
}

/** Giây (mô hình nói) → micro giây nguyên (đơn vị chuẩn của dự án). */
export function secondsToMicros(seconds: number): number {
  return roundHalfUp(seconds * 1_000_000)
}

function formatSeconds(us: number): string {
  return `${(us / 1_000_000).toFixed(2)}s`
}

/** Lấy chính clip theo id, không chỉ vị trí của nó. */
function findClipById(document: ProjectDocument, clipId: string): Clip | undefined {
  const located = findClip(document, clipId)
  if (!located) return undefined
  return document.tracks.find((track) => track.id === located.trackId)?.clips[located.clipIndex]
}

/** Clip mà lệnh nhắm tới: id được nêu rõ, hoặc clip đang chọn. */
function resolveClipId(context: ChatEditContext, clipId?: string): string {
  if (clipId) {
    if (!findClip(context.document, clipId)) {
      throw new Error(`Không tìm thấy clip "${clipId}" trong dự án`)
    }
    return clipId
  }

  if (context.selectedClipIds.length === 0) {
    throw new Error('Chưa chọn clip nào trên timeline')
  }
  // Nhiều clip đang chọn thì không đoán; hỏi lại rẻ hơn sửa nhầm.
  if (context.selectedClipIds.length > 1) {
    throw new Error('Đang chọn nhiều clip — hãy chọn đúng một clip')
  }
  return context.selectedClipIds[0]
}

function requireTrack(context: ChatEditContext, trackId: string): void {
  if (!context.document.tracks.some((track) => track.id === trackId)) {
    throw new Error(`Không tìm thấy track "${trackId}"`)
  }
}

/** Cue phụ đề theo id, kèm track chứa nó. Báo lỗi rõ ràng thay vì trả undefined. */
function locateCue(
  document: ProjectDocument,
  subtitleTrackId: string,
  cueId: string
): { track: SubtitleTrack; cue: SubtitleCue } {
  const track = document.subtitleTracks.find((item) => item.id === subtitleTrackId)
  if (!track) throw new Error(`Không tìm thấy track phụ đề "${subtitleTrackId}"`)
  const cue = track.cues.find((item) => item.id === cueId)
  if (!cue) throw new Error(`Không tìm thấy cue "${cueId}" trong "${track.name}"`)
  return { track, cue }
}

/** Dựng lệnh cho một lời gọi đã qua schema. */
function planOne(context: ChatEditContext, tool: ChatToolName, args: unknown): PlannedToolCall {
  const { document } = context

  switch (tool) {
    case 'split_clip': {
      const input = chatToolSchemas.split_clip.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const atUs = secondsToMicros(input.atSeconds)

      // Kiểm tra ngay tại đây để báo lỗi dễ hiểu, thay vì để reducer trả về
      // "điểm cắt nằm ngoài clip" sau khi người dùng đã bấm áp dụng.
      const target = findClipById(document, clipId)
      if (target && (atUs <= target.startUs || atUs >= clipEndUs(target))) {
        throw new Error(`Vị trí ${formatSeconds(atUs)} nằm ngoài clip`)
      }

      return {
        tool,
        description: `Cắt clip tại ${formatSeconds(atUs)}`,
        commands: [{ type: 'clip/split', clipId, atUs, newClipId: context.makeId() }]
      }
    }

    case 'trim_clip': {
      const input = chatToolSchemas.trim_clip.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const toUs = secondsToMicros(input.toSeconds)
      return {
        tool,
        description: `Kéo mép ${input.edge === 'start' ? 'đầu' : 'cuối'} clip về ${formatSeconds(toUs)}`,
        commands: [{ type: 'clip/trim', clipId, edge: input.edge, toUs }]
      }
    }

    case 'move_clip': {
      const input = chatToolSchemas.move_clip.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      if (input.toTrackId) requireTrack(context, input.toTrackId)
      const toStartUs = secondsToMicros(input.toSeconds)
      return {
        tool,
        description: `Dời clip tới ${formatSeconds(toStartUs)}`,
        commands: [{ type: 'clip/move', clipId, toStartUs, toTrackId: input.toTrackId }]
      }
    }

    case 'remove_clip': {
      const input = chatToolSchemas.remove_clip.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      return { tool, description: 'Xoá clip', commands: [{ type: 'clip/remove', clipId }] }
    }

    case 'duplicate_clip': {
      const input = chatToolSchemas.duplicate_clip.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      return {
        tool,
        description: 'Nhân đôi clip',
        commands: [{ type: 'clip/duplicate', clipId, newClipId: context.makeId() }]
      }
    }

    case 'set_clip_volume': {
      const input = chatToolSchemas.set_clip_volume.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      return {
        tool,
        description: `Đặt âm lượng clip thành ${Math.round(input.volume * 100)}%`,
        commands: [{ type: 'clip/update', clipId, patch: { volume: input.volume } }]
      }
    }

    case 'set_clip_fade': {
      const input = chatToolSchemas.set_clip_fade.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      if (input.fadeInSeconds === undefined && input.fadeOutSeconds === undefined) {
        throw new Error('Chưa nêu fade in hay fade out')
      }
      const patch: { fadeInUs?: number; fadeOutUs?: number } = {}
      if (input.fadeInSeconds !== undefined) patch.fadeInUs = secondsToMicros(input.fadeInSeconds)
      if (input.fadeOutSeconds !== undefined)
        patch.fadeOutUs = secondsToMicros(input.fadeOutSeconds)

      return {
        tool,
        description: 'Đặt fade cho clip',
        commands: [{ type: 'clip/update', clipId, patch }]
      }
    }

    case 'set_track_volume': {
      const input = chatToolSchemas.set_track_volume.parse(args)
      requireTrack(context, input.trackId)
      return {
        tool,
        description: `Đặt âm lượng track thành ${Math.round(input.volume * 100)}%`,
        commands: [
          { type: 'track/update', trackId: input.trackId, patch: { volume: input.volume } }
        ]
      }
    }

    case 'set_track_muted': {
      const input = chatToolSchemas.set_track_muted.parse(args)
      requireTrack(context, input.trackId)
      return {
        tool,
        description: input.muted ? 'Tắt tiếng track' : 'Bật tiếng track',
        commands: [{ type: 'track/update', trackId: input.trackId, patch: { muted: input.muted } }]
      }
    }

    case 'rename_project': {
      const input = chatToolSchemas.rename_project.parse(args)
      return {
        tool,
        description: `Đổi tên dự án thành "${input.name}"`,
        commands: [{ type: 'project/rename', name: input.name }]
      }
    }

    case 'create_subtitle_track': {
      const input = chatToolSchemas.create_subtitle_track.parse(args)
      const transcript = input.transcriptId
        ? document.transcripts.find((item) => item.id === input.transcriptId)
        : document.transcripts[0]
      if (!transcript) throw new Error('Dự án chưa có bản phiên âm nào')

      const translation = input.translationId
        ? document.translations.find((item) => item.id === input.translationId)
        : undefined
      if (input.translationId && !translation) {
        throw new Error(`Không tìm thấy bản dịch "${input.translationId}"`)
      }

      const clips = document.tracks.flatMap((track) => track.clips)
      const cues = buildSubtitleCues({
        transcript,
        translation,
        clips,
        bilingual: input.bilingual ?? false,
        makeId: context.makeId
      })
      if (cues.length === 0) {
        throw new Error(
          'Không dựng được cue nào — asset của bản phiên âm chưa có clip trên timeline'
        )
      }

      const trackId = context.makeId('track')
      const subtitleTrack: SubtitleTrack = {
        id: trackId,
        name: `Phụ đề ${translation?.targetLanguage ?? transcript.language}`,
        language: translation?.targetLanguage ?? transcript.language,
        secondaryLanguage: input.bilingual && translation ? transcript.language : undefined,
        source: translation
          ? { kind: 'translation', refId: translation.id }
          : { kind: 'transcript', refId: transcript.id },
        style: { ...DEFAULT_SUBTITLE_STYLE },
        cues
      }

      // Kèm luôn lane trên timeline, nếu không thì track dựng ra mà không hiện đâu cả.
      const freeLane = document.tracks.find(
        (track) => track.kind === 'subtitle' && !track.subtitleTrackId
      )
      const commands: EditorCommand[] = [{ type: 'subtitle/add-track', track: subtitleTrack }]
      commands.push(
        freeLane
          ? { type: 'track/update', trackId: freeLane.id, patch: { subtitleTrackId: trackId } }
          : {
              type: 'track/add',
              kind: 'subtitle',
              name: subtitleTrack.name,
              subtitleTrackId: trackId
            }
      )

      return { tool, description: `Tạo track phụ đề với ${cues.length} cue`, commands }
    }

    case 'insert_clip': {
      const input = chatToolSchemas.insert_clip.parse(args)
      const asset = document.assets.find((item) => item.id === input.assetId)
      if (!asset) throw new Error(`Không tìm thấy media "${input.assetId}"`)
      if (asset.missing) throw new Error(`File của "${asset.name}" hiện không còn trên đĩa`)

      // Không nêu track thì chọn track hợp kiểu media; ảnh cũng nằm trên track hình.
      const wantedKind = asset.kind === 'audio' ? 'audio' : 'video'
      const track = input.trackId
        ? document.tracks.find((item) => item.id === input.trackId)
        : document.tracks.find((item) => item.kind === wantedKind)
      if (!track) throw new Error(`Không tìm thấy track phù hợp cho "${asset.name}"`)

      const sourceInUs = secondsToMicros(input.sourceInSeconds ?? 0)
      const remainingUs = asset.probe.durationUs - sourceInUs
      if (remainingUs <= 0) {
        throw new Error(`Điểm vào ${formatSeconds(sourceInUs)} nằm ngoài "${asset.name}"`)
      }

      // Bỏ trống thời lượng thì lấy hết phần còn lại; nêu quá dài thì kẹp lại
      // thay vì để reducer tạo clip đọc quá cuối file.
      const durationUs = Math.min(
        input.durationSeconds === undefined ? remainingUs : secondsToMicros(input.durationSeconds),
        remainingUs
      )
      if (durationUs <= 0) throw new Error('Thời lượng phải lớn hơn 0')

      return {
        tool,
        description: `Chèn "${asset.name}" vào ${track.name} tại ${formatSeconds(secondsToMicros(input.startSeconds))}`,
        commands: [
          {
            type: 'clip/insert',
            clipId: context.makeId(),
            trackId: track.id,
            assetId: asset.id,
            startUs: secondsToMicros(input.startSeconds),
            durationUs,
            sourceInUs
          }
        ]
      }
    }

    case 'ripple_delete_range': {
      const input = chatToolSchemas.ripple_delete_range.parse(args)
      const fromUs = secondsToMicros(input.fromSeconds)
      const toUs = secondsToMicros(input.toSeconds)
      if (toUs <= fromUs) throw new Error('Điểm kết thúc phải sau điểm bắt đầu')

      return {
        tool,
        description: `Cắt bỏ ${formatSeconds(fromUs)}–${formatSeconds(toUs)} và dồn phần sau lên`,
        commands: [{ type: 'timeline/ripple-delete', fromUs, toUs }]
      }
    }

    case 'build_cut_from_transcript': {
      const input = chatToolSchemas.build_cut_from_transcript.parse(args)
      const transcript = input.transcriptId
        ? document.transcripts.find((item) => item.id === input.transcriptId)
        : document.transcripts[0]
      if (!transcript) throw new Error('Dự án chưa có bản phiên âm nào')

      const asset = document.assets.find((item) => item.id === transcript.assetId)
      if (!asset) throw new Error('Không tìm thấy media của bản phiên âm')

      // Giữ THỨ TỰ CỦA TRANSCRIPT, không theo thứ tự mô hình liệt kê: lời nói phải
      // chạy đúng mạch, và mô hình rất hay trả về id lộn xộn.
      // Báo id sai TRƯỚC: nếu mọi id đều sai thì thông báo "không đoạn nào khớp"
      // đúng nhưng vô dụng — agent cần biết chính xác id nào nó bịa ra.
      const unknown = input.keepSegmentIds.filter(
        (id) => !transcript.segments.some((segment) => segment.id === id)
      )
      if (unknown.length > 0) {
        throw new Error(`Không tìm thấy đoạn: ${unknown.slice(0, 3).join(', ')}`)
      }

      const wanted = new Set(input.keepSegmentIds)
      const kept = transcript.segments.filter((segment) => wanted.has(segment.id))
      if (kept.length === 0) throw new Error('Không có đoạn nào khớp id được nêu')

      const wantedKind = asset.kind === 'audio' ? 'audio' : 'video'
      const track = input.trackId
        ? document.tracks.find((item) => item.id === input.trackId)
        : document.tracks.find((item) => item.kind === wantedKind)
      if (!track) throw new Error('Không tìm thấy track để dựng bản cut')
      if (track.locked) throw new Error(`Track "${track.name}" đang bị khoá`)

      // Dọn sạch track trước rồi mới xếp lại: chèn đè lên clip cũ sẽ kích hoạt
      // chính sách ghi đè và cho ra kết quả không đoán trước được.
      const commands: EditorCommand[] = track.clips.map((clip) => ({
        type: 'clip/remove' as const,
        clipId: clip.id
      }))

      let cursorUs = 0
      for (const segment of kept) {
        const durationUs = segment.endUs - segment.startUs
        if (durationUs <= 0) continue
        commands.push({
          type: 'clip/insert',
          clipId: context.makeId(),
          trackId: track.id,
          assetId: asset.id,
          startUs: cursorUs,
          durationUs,
          sourceInUs: segment.startUs
        })
        cursorUs += durationUs
      }

      return {
        tool,
        description: `Dựng bản cut ${kept.length} đoạn (${formatSeconds(cursorUs)}) trên ${track.name}`,
        commands
      }
    }

    case 'add_track': {
      const input = chatToolSchemas.add_track.parse(args)
      return {
        tool,
        description: `Thêm track ${input.kind} "${input.name}"`,
        commands: [
          {
            type: 'track/add',
            trackId: context.makeId('track'),
            kind: input.kind,
            name: input.name,
            role: input.role
          }
        ]
      }
    }

    case 'build_cut_from_shots': {
      const input = chatToolSchemas.build_cut_from_shots.parse(args)
      const asset = document.assets.find((item) => item.id === input.assetId)
      if (!asset) throw new Error(`Không tìm thấy media "${input.assetId}"`)

      const shots = context.shots?.[input.assetId]
      if (!shots || shots.length === 0) {
        throw new Error('Chưa dò cú máy cho media này. Gọi list_shots trước.')
      }

      const unknown = input.shotIndexes.filter((index) => !shots[index])
      if (unknown.length > 0) {
        throw new Error(`Không có cú máy số: ${unknown.slice(0, 3).join(', ')}`)
      }

      const wantedKind = asset.kind === 'audio' ? 'audio' : 'video'
      const track = input.trackId
        ? document.tracks.find((item) => item.id === input.trackId)
        : document.tracks.find((item) => item.kind === wantedKind)
      if (!track) throw new Error('Không tìm thấy track để dựng bản cut')
      if (track.locked) throw new Error(`Track "${track.name}" đang bị khoá`)

      // Dọn track trước rồi mới xếp lại, cùng lý do như dựng theo transcript:
      // chèn đè lên clip cũ sẽ kích hoạt chính sách ghi đè khó đoán.
      const commands: EditorCommand[] = track.clips.map((clip) => ({
        type: 'clip/remove' as const,
        clipId: clip.id
      }))

      const maxUs = input.maxShotSeconds ? secondsToMicros(input.maxShotSeconds) : undefined
      let cursorUs = 0

      // Giữ ĐÚNG thứ tự agent đưa ra — khác dựng theo transcript, nơi thứ tự lời
      // nói là bắt buộc. Với footage câm, xếp lại cảnh chính là việc dựng phim.
      for (const index of input.shotIndexes) {
        const shot = shots[index]
        const fullUs = shot.endUs - shot.startUs
        const durationUs = maxUs ? Math.min(fullUs, maxUs) : fullUs
        if (durationUs <= 0) continue

        commands.push({
          type: 'clip/insert',
          clipId: context.makeId(),
          trackId: track.id,
          assetId: asset.id,
          startUs: cursorUs,
          durationUs,
          sourceInUs: shot.startUs
        })
        cursorUs += durationUs
      }

      return {
        tool,
        description: `Dựng bản cut ${input.shotIndexes.length} cú máy (${formatSeconds(cursorUs)}) trên ${track.name}`,
        commands
      }
    }

    case 'add_text_overlay': {
      const input = chatToolSchemas.add_text_overlay.parse(args)
      const startUs = secondsToMicros(input.startSeconds)
      const endUs = secondsToMicros(input.endSeconds)
      if (endUs <= startUs) throw new Error('Thời điểm kết thúc phải sau thời điểm bắt đầu')

      let style = createDefaultTextOverlayStyle()
      if (input.box) style = applyTextOverlayBox(style, input.box)
      // Vị trí nhận bằng chữ chứ không phải số 1–9 kiểu ASS: mô hình đoán số bàn
      // phím rất hay sai, còn "top/middle/bottom" thì không nhầm được.
      if (input.position === 'bottom') {
        style.alignment = 2
        style.marginVerticalPx = 160
      } else if (input.position === 'top') {
        style.alignment = 8
        style.marginVerticalPx = 160
      }
      if (input.fontSizePx) style.fontSizePx = input.fontSizePx
      if (input.rotationDeg !== undefined) style.rotationDeg = input.rotationDeg

      const overlay: TextOverlay = {
        id: context.makeId('text'),
        // Cùng quy tắc với nút thêm chữ trên giao diện: rơi vào lane chữ cuối
        // cùng, để agent và người dùng không đặt chữ vào hai chỗ khác nhau.
        trackId: defaultTextTrackId(document.tracks),
        text: input.text,
        startUs,
        endUs,
        style,
        animation: input.animation ?? 'pop',
        animationDurationUs: DEFAULT_TEXT_ANIMATION_DURATION_US,
        exitAnimation: input.exit,
        glow: input.glow,
        frame: checkedFrame(input.frame) ?? undefined
      }

      return {
        tool,
        description: `Thêm chữ "${input.text.slice(0, 30)}" từ ${formatSeconds(startUs)} tới ${formatSeconds(endUs)}`,
        commands: [{ type: 'text/add', overlay }]
      }
    }

    case 'remove_text_overlay': {
      const input = chatToolSchemas.remove_text_overlay.parse(args)
      const overlay = document.textOverlays.find((item) => item.id === input.overlayId)
      if (!overlay) throw new Error(`Không tìm thấy chữ overlay "${input.overlayId}"`)

      return {
        tool,
        description: `Xoá chữ "${overlay.text.slice(0, 30)}"`,
        commands: [{ type: 'text/remove', overlayId: input.overlayId }]
      }
    }

    case 'set_canvas': {
      const input = chatToolSchemas.set_canvas.parse(args)
      // Cạnh phải CHẴN: h264 với yuv420p không mã hoá được cạnh lẻ, và lỗi đó chỉ
      // lộ ra lúc xuất, khi người dùng đã dựng xong cả video.
      const even = (value: number): number => Math.round(value / 2) * 2
      const longEdge = input.longEdgePx ?? (input.aspect === '1:1' ? 1080 : 1920)
      const size =
        input.aspect === '9:16'
          ? { width: even((longEdge * 9) / 16), height: even(longEdge) }
          : input.aspect === '16:9'
            ? { width: even(longEdge), height: even((longEdge * 9) / 16) }
            : { width: even(longEdge), height: even(longEdge) }

      return {
        tool,
        description: `Đổi khung hình sang ${input.aspect} (${size.width}x${size.height})`,
        commands: [
          {
            type: 'project/set-settings',
            settings: { ...size, aspectRatio: input.aspect }
          }
        ]
      }
    }

    case 'set_clip_transition': {
      const input = chatToolSchemas.set_clip_transition.parse(args)
      const clipId = resolveClipId(context, input.clipId)

      const edge = input.edge ?? 'in'
      const edgeLabel = edge === 'out' ? 'hiệu ứng ra' : 'chuyển cảnh'

      if (input.kind === 'none') {
        return {
          tool,
          description: `Gỡ ${edgeLabel} của clip`,
          commands: [{ type: 'clip/set-transition', clipId, edge }]
        }
      }

      const durationUs = secondsToMicros(input.durationSeconds ?? 0.5)
      return {
        tool,
        description: `Đặt ${edgeLabel} ${input.kind} ${formatSeconds(durationUs)} cho clip`,
        commands: [
          {
            type: 'clip/set-transition',
            clipId,
            edge,
            transition: { kind: input.kind, durationUs }
          }
        ]
      }
    }

    case 'set_clip_speed': {
      const input = chatToolSchemas.set_clip_speed.parse(args)
      return {
        tool,
        description: `Đổi tốc độ clip sang ${input.speed}×`,
        commands: [
          {
            type: 'clip/set-speed',
            clipId: resolveClipId(context, input.clipId),
            speed: input.speed
          }
        ]
      }
    }

    case 'set_clip_motion': {
      const input = chatToolSchemas.set_clip_motion.parse(args)
      const clipId = resolveClipId(context, input.clipId)

      if (input.kind === 'none') {
        return {
          tool,
          description: 'Gỡ chuyển động của clip',
          commands: [{ type: 'clip/set-motion', clipId }]
        }
      }

      return {
        tool,
        description: `Đặt chuyển động ${input.kind} cho clip`,
        commands: [
          {
            type: 'clip/set-motion',
            clipId,
            motion: { kind: input.kind, intensity: input.intensity ?? DEFAULT_MOTION_INTENSITY }
          }
        ]
      }
    }

    case 'set_clip_color': {
      const input = chatToolSchemas.set_clip_color.parse(args)
      const clipId = resolveClipId(context, input.clipId)

      if (input.reset) {
        return {
          tool,
          description: 'Trả clip về màu gốc',
          commands: [{ type: 'clip/set-color-grade', clipId }]
        }
      }

      // Lọc theo DANH SÁCH TRẮNG thay vì bóc `clipId`/`reset` ra: thêm một trường
      // điều khiển mới sau này mà quên bóc thì nó sẽ lọt thẳng vào bản chỉnh màu.
      const grade = Object.fromEntries(
        (['brightness', 'contrast', 'saturation', 'temperature', 'vignette'] as const)
          .filter((key) => input[key] !== undefined)
          .map((key) => [key, input[key]])
      )
      if (Object.keys(grade).length === 0) {
        throw new Error('Chưa nêu thông số màu nào cần chỉnh')
      }

      return {
        tool,
        description: `Chỉnh màu clip (${Object.keys(grade).join(', ')})`,
        commands: [{ type: 'clip/set-color-grade', clipId, grade }]
      }
    }

    case 'remove_media': {
      const input = chatToolSchemas.remove_media.parse(args)
      const asset = document.assets.find((item) => item.id === input.assetId)
      if (!asset) throw new Error(`Không tìm thấy media "${input.assetId}"`)

      const usages = countAssetUsages(document, input.assetId)
      // Chặn ngay tại đây thay vì để reducer từ chối: thông báo ở đây nói RA số
      // clip sẽ mất, còn lỗi của reducer thì không.
      if (usages > 0 && !input.removeClips) {
        throw new Error(
          `"${asset.name}" đang được dùng bởi ${usages} clip. Gọi lại với removeClips nếu muốn xoá cả chúng.`
        )
      }

      return {
        tool,
        description:
          usages > 0
            ? `Xoá media "${asset.name}" và ${usages} clip đang dùng nó`
            : `Xoá media "${asset.name}"`,
        commands: [{ type: 'asset/remove', assetId: input.assetId, removeUsages: usages > 0 }]
      }
    }

    case 'remove_track': {
      const input = chatToolSchemas.remove_track.parse(args)
      const track = document.tracks.find((item) => item.id === input.trackId)
      if (!track) throw new Error(`Không tìm thấy track "${input.trackId}"`)
      if (track.locked) throw new Error(`Track "${track.name}" đang bị khoá`)

      // Nói rõ sẽ mất gì: agent xoá một lane tưởng là rỗng rồi kéo theo cả chục
      // clip là chuyện không hoàn tác lại được trong đầu người dùng.
      const overlays = document.textOverlays.filter((item) => item.trackId === track.id).length
      const losing = [
        track.clips.length > 0 ? `${track.clips.length} clip` : '',
        overlays > 0 ? `${overlays} chữ` : ''
      ].filter(Boolean)

      return {
        tool,
        description: `Xoá lane "${track.name}"${losing.length > 0 ? ` cùng ${losing.join(' và ')}` : ''}`,
        commands: [{ type: 'track/remove', trackId: track.id }]
      }
    }

    case 'reorder_track': {
      const input = chatToolSchemas.reorder_track.parse(args)
      const from = document.tracks.findIndex((item) => item.id === input.trackId)
      if (from < 0) throw new Error(`Không tìm thấy track "${input.trackId}"`)
      if (input.toIndex >= document.tracks.length) {
        throw new Error(`Dự án chỉ có ${document.tracks.length} lane`)
      }
      if (input.toIndex === from) throw new Error('Lane đã ở đúng vị trí đó')

      return {
        tool,
        // Nói cả nghĩa của phép dời: agent thường gọi lệnh này để đổi lớp che.
        description: `Dời lane "${document.tracks[from].name}" xuống vị trí ${input.toIndex} (lane dưới vẽ trên)`,
        commands: [{ type: 'track/reorder', trackId: input.trackId, toIndex: input.toIndex }]
      }
    }

    case 'set_track': {
      const input = chatToolSchemas.set_track.parse(args)
      const track = document.tracks.find((item) => item.id === input.trackId)
      if (!track) throw new Error(`Không tìm thấy track "${input.trackId}"`)

      const patch: { name?: string; hidden?: boolean; locked?: boolean } = {}
      if (input.name !== undefined) patch.name = input.name
      if (input.hidden !== undefined) patch.hidden = input.hidden
      if (input.locked !== undefined) patch.locked = input.locked
      if (Object.keys(patch).length === 0) throw new Error('Chưa nêu thứ gì để đổi')

      return {
        tool,
        description: `Đổi lane "${track.name}": ${Object.keys(patch).join(', ')}`,
        commands: [{ type: 'track/update', trackId: track.id, patch }]
      }
    }

    case 'set_clip_transform': {
      const input = chatToolSchemas.set_clip_transform.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const clip = findClipById(document, clipId)
      const current = clip?.transform ?? DEFAULT_CLIP_TRANSFORM

      if (input.reset) {
        return {
          tool,
          description: 'Đưa clip về vị trí và cỡ gốc',
          commands: [
            { type: 'clip/update', clipId, patch: { transform: { ...DEFAULT_CLIP_TRANSFORM } } }
          ]
        }
      }

      const transform = {
        ...current,
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.scale !== undefined ? { scale: input.scale } : {}),
        ...(input.rotationDeg !== undefined ? { rotationDeg: input.rotationDeg } : {}),
        ...(input.opacity !== undefined ? { opacity: input.opacity } : {})
      }
      // Gọi mà không nêu gì thì ghi đè bằng chính giá trị cũ — một bước hoàn tác
      // rỗng, và agent tưởng mình vừa làm được việc.
      if (
        input.x === undefined &&
        input.y === undefined &&
        input.scale === undefined &&
        input.rotationDeg === undefined &&
        input.opacity === undefined
      ) {
        throw new Error('Chưa nêu thứ gì để đổi')
      }

      return {
        tool,
        description: `Đặt clip ở ${Math.round(transform.x * 100)}% · ${Math.round(transform.y * 100)}%, cỡ ${Math.round(transform.scale * 100)}%`,
        commands: [{ type: 'clip/update', clipId, patch: { transform } }]
      }
    }

    case 'update_text_overlay': {
      const input = chatToolSchemas.update_text_overlay.parse(args)
      const overlay = document.textOverlays.find((item) => item.id === input.overlayId)
      if (!overlay) throw new Error(`Không tìm thấy chữ overlay "${input.overlayId}"`)

      const startUs =
        input.startSeconds !== undefined ? secondsToMicros(input.startSeconds) : undefined
      const endUs = input.endSeconds !== undefined ? secondsToMicros(input.endSeconds) : undefined
      const nextStart = startUs ?? overlay.startUs
      const nextEnd = endUs ?? overlay.endUs
      if (nextEnd <= nextStart) throw new Error('Thời điểm kết thúc phải sau thời điểm bắt đầu')

      return {
        tool,
        description: `Sửa chữ "${input.text ?? overlay.text}"`,
        commands: [
          {
            type: 'text/update',
            overlayId: overlay.id,
            ...(input.text !== undefined ? { text: input.text } : {}),
            ...(startUs !== undefined ? { startUs } : {}),
            ...(endUs !== undefined ? { endUs } : {}),
            ...(input.animation !== undefined ? { animation: input.animation } : {}),
            ...(input.exit !== undefined ? { exitAnimation: input.exit } : {}),
            ...(input.glow !== undefined ? { glow: input.glow } : {}),
            // `!== undefined` chứ KHÔNG phải kiểm truthy: `null` là lệnh bỏ khung
            // và phải đi lọt tới reducer. Kiểm truthy sẽ nuốt mất nó, và nút tắt
            // khung im lặng không làm gì.
            ...(input.frame !== undefined ? { frame: checkedFrame(input.frame) ?? null } : {})
          }
        ]
      }
    }

    case 'update_subtitle_cue': {
      const input = chatToolSchemas.update_subtitle_cue.parse(args)
      const { cue } = locateCue(document, input.subtitleTrackId, input.cueId)

      const startUs =
        input.startSeconds !== undefined ? secondsToMicros(input.startSeconds) : undefined
      const endUs = input.endSeconds !== undefined ? secondsToMicros(input.endSeconds) : undefined
      if ((endUs ?? cue.endUs) <= (startUs ?? cue.startUs)) {
        throw new Error('Thời điểm kết thúc phải sau thời điểm bắt đầu')
      }

      return {
        tool,
        description: `Sửa cue "${input.text ?? cue.text}"`,
        commands: [
          {
            type: 'subtitle/update-cue',
            trackId: input.subtitleTrackId,
            cueId: input.cueId,
            ...(input.text !== undefined ? { text: input.text } : {}),
            ...(startUs !== undefined ? { startUs } : {}),
            ...(endUs !== undefined ? { endUs } : {})
          }
        ]
      }
    }

    case 'move_subtitle_cue': {
      const input = chatToolSchemas.move_subtitle_cue.parse(args)
      const { cue } = locateCue(document, input.subtitleTrackId, input.cueId)
      const destination = document.subtitleTracks.find(
        (item) => item.id === input.toSubtitleTrackId
      )
      if (!destination) {
        throw new Error(`Không tìm thấy track phụ đề "${input.toSubtitleTrackId}"`)
      }

      return {
        tool,
        description: `Dời cue "${cue.text}" sang "${destination.name}"`,
        commands: [
          {
            type: 'subtitle/move-cue',
            fromTrackId: input.subtitleTrackId,
            toTrackId: input.toSubtitleTrackId,
            cueId: input.cueId
          }
        ]
      }
    }

    case 'add_sound_effect': {
      const input = chatToolSchemas.add_sound_effect.parse(args)
      const definition = findSoundEffect(input.soundEffectId)
      if (!definition) {
        throw new Error(`Không có hiệu ứng âm thanh "${input.soundEffectId}"`)
      }

      // Asset do tiến trình main dựng sẵn (probe thời lượng thật, hash nội dung)
      // rồi đưa vào ngữ cảnh — planner là hàm thuần, không đọc file được. Cùng
      // lối với đường dẫn phông chữ.
      const asset = context.soundEffects?.[input.soundEffectId]
      if (!asset) {
        throw new Error(`Bản cài này không có file cho hiệu ứng "${input.soundEffectId}"`)
      }

      const commands: EditorCommand[] = [{ type: 'asset/add', asset }]

      if (input.atSeconds !== undefined) {
        const track = input.trackId
          ? document.tracks.find((item) => item.id === input.trackId)
          : document.tracks.find((item) => item.kind === 'audio' && !item.locked)
        if (!track) throw new Error('Không tìm thấy track tiếng nào để đặt hiệu ứng')
        if (track.kind !== 'audio') throw new Error(`Track "${track.name}" không phải track tiếng`)

        commands.push({
          type: 'clip/insert',
          trackId: track.id,
          assetId: asset.id,
          startUs: secondsToMicros(input.atSeconds),
          // Thời lượng lấy từ asset đã probe, không lấy con số khai trong danh
          // mục: bộ mã hoá chèn thêm vài chục mili giây và đuôi tiếng sẽ bị cắt.
          durationUs: asset.probe.durationUs,
          sourceInUs: 0
        })
      }

      return {
        tool,
        description:
          input.atSeconds !== undefined
            ? `Đặt hiệu ứng "${definition.nameVi}" ở ${formatSeconds(secondsToMicros(input.atSeconds))}`
            : `Thêm hiệu ứng "${definition.nameVi}" vào thư viện`,
        commands
      }
    }

    case 'remove_subtitle_cue': {
      const input = chatToolSchemas.remove_subtitle_cue.parse(args)
      const { cue } = locateCue(document, input.subtitleTrackId, input.cueId)
      return {
        tool,
        description: `Xoá cue "${cue.text}"`,
        commands: [
          {
            type: 'subtitle/remove-cue',
            trackId: input.subtitleTrackId,
            cueId: input.cueId
          }
        ]
      }
    }

    case 'set_text_position': {
      const input = chatToolSchemas.set_text_position.parse(args)

      // Phải nói rõ định làm gì: không có toạ độ mà cũng không bảo bỏ ghim thì
      // lệnh này chẳng có nghĩa nào, và im lặng bỏ qua là để agent tưởng đã xong.
      if (!input.clear && (input.xPct === undefined || input.yPct === undefined)) {
        throw new Error('Cần cả xPct và yPct, hoặc clear=true để bỏ ghim')
      }

      const applyPosition = (style: SubtitleStyle): SubtitleStyle => {
        if (input.clear) {
          const next = { ...style }
          delete next.position
          return next
        }
        return { ...style, position: { xPct: input.xPct as number, yPct: input.yPct as number } }
      }

      const where = input.clear
        ? 'về vị trí mặc định'
        : `tới ${Math.round((input.xPct as number) * 100)}% · ${Math.round((input.yPct as number) * 100)}%`

      if (input.subtitleTrackId) {
        const subtitleTrack = document.subtitleTracks.find(
          (item) => item.id === input.subtitleTrackId
        )
        if (!subtitleTrack) {
          throw new Error(`Không tìm thấy track phụ đề "${input.subtitleTrackId}"`)
        }
        return {
          tool,
          description: `Dời phụ đề "${subtitleTrack.name}" ${where}`,
          commands: [
            {
              type: 'subtitle/set-style',
              trackId: subtitleTrack.id,
              style: applyPosition(subtitleTrack.style)
            }
          ]
        }
      }

      const targets = input.overlayId
        ? document.textOverlays.filter((item) => item.id === input.overlayId)
        : document.textOverlays
      if (targets.length === 0) {
        throw new Error(
          input.overlayId
            ? `Không tìm thấy chữ overlay "${input.overlayId}"`
            : 'Dự án chưa có chữ overlay nào'
        )
      }

      return {
        tool,
        description: `Dời ${targets.length} chữ ${where}`,
        commands: targets.map((overlay) => ({
          type: 'text/set-style' as const,
          overlayId: overlay.id,
          style: applyPosition(overlay.style)
        }))
      }
    }

    case 'set_text_rotation': {
      const input = chatToolSchemas.set_text_rotation.parse(args)

      if (input.subtitleTrackId) {
        const subtitleTrack = document.subtitleTracks.find(
          (item) => item.id === input.subtitleTrackId
        )
        if (!subtitleTrack) {
          throw new Error(`Không tìm thấy track phụ đề "${input.subtitleTrackId}"`)
        }
        return {
          tool,
          description: `Xoay phụ đề "${subtitleTrack.name}" ${input.rotationDeg}°`,
          commands: [
            {
              type: 'subtitle/set-style',
              trackId: subtitleTrack.id,
              style: { ...subtitleTrack.style, rotationDeg: input.rotationDeg }
            }
          ]
        }
      }

      const targets = input.overlayId
        ? document.textOverlays.filter((item) => item.id === input.overlayId)
        : document.textOverlays
      if (targets.length === 0) {
        throw new Error(
          input.overlayId
            ? `Không tìm thấy chữ overlay "${input.overlayId}"`
            : 'Dự án chưa có chữ overlay nào'
        )
      }

      return {
        tool,
        description: `Xoay ${targets.length} chữ ${input.rotationDeg}°`,
        commands: targets.map((overlay) => ({
          type: 'text/set-style' as const,
          overlayId: overlay.id,
          style: { ...overlay.style, rotationDeg: input.rotationDeg }
        }))
      }
    }

    case 'set_text_font': {
      const input = chatToolSchemas.set_text_font.parse(args)
      // File phông do nơi gọi chép sẵn ra kho trước khi lập kế hoạch; planner là
      // hàm thuần nên không tự đọc byte phông được.
      const fontFilePath = context.fontFiles?.[input.fontPostScriptName ?? input.fontFamily]
      const patch = {
        fontFamily: input.fontFamily,
        fontPostScriptName: input.fontPostScriptName,
        fontFilePath
      }

      if (input.subtitleTrackId) {
        const subtitleTrack = document.subtitleTracks.find(
          (item) => item.id === input.subtitleTrackId
        )
        if (!subtitleTrack) {
          throw new Error(`Không tìm thấy track phụ đề "${input.subtitleTrackId}"`)
        }
        return {
          tool,
          description: `Đổi phông phụ đề "${subtitleTrack.name}" sang ${input.fontFamily}`,
          commands: [
            {
              type: 'subtitle/set-style',
              trackId: subtitleTrack.id,
              style: { ...subtitleTrack.style, ...patch }
            }
          ]
        }
      }

      const overlays = input.overlayId
        ? document.textOverlays.filter((item) => item.id === input.overlayId)
        : document.textOverlays
      if (overlays.length === 0) {
        throw new Error(
          input.overlayId
            ? `Không tìm thấy chữ overlay "${input.overlayId}"`
            : 'Dự án chưa có chữ overlay nào'
        )
      }

      return {
        tool,
        description: `Đổi phông ${overlays.length} chữ sang ${input.fontFamily}`,
        commands: overlays.map((overlay) => ({
          type: 'text/set-style' as const,
          overlayId: overlay.id,
          style: { ...overlay.style, ...patch }
        }))
      }
    }

    case 'auto_duck_music': {
      const input = chatToolSchemas.auto_duck_music.parse(args)
      const { musicTrackIds, speechTrackIds } = guessDuckingTracks(document)
      if (musicTrackIds.length === 0) throw new Error('Dự án chưa có track nhạc')
      if (speechTrackIds.length === 0) throw new Error('Dự án chưa có track lời nói')

      const plan = planAutoDucking(document, {
        musicTrackIds,
        speechTrackIds,
        duckVolume: input.duckVolume ?? 0.25,
        baseVolume: input.baseVolume ?? 1,
        paddingUs: secondsToMicros(input.paddingSeconds ?? 0.25),
        makeId: context.makeId
      })

      if (plan.commands.length === 0) {
        throw new Error('Không có đoạn nhạc nào trùng với lời nói')
      }
      return {
        tool,
        description: `Giảm nhạc ở ${plan.duckedPieces} đoạn có lời nói`,
        commands: plan.commands
      }
    }
  }
}

/**
 * Kiểm tra và dịch cả loạt lời gọi công cụ.
 *
 * Bước nào hỏng thì bị bỏ RIÊNG và ghi lý do, các bước còn lại vẫn dựng được.
 * Ném cả loạt đi chỉ vì một tham số sai sẽ khiến người dùng phải gõ lại từ đầu.
 */
/**
 * Kiểm id khung do agent gửi lên, NÉM LỖI kèm danh sách id hợp lệ.
 *
 * Khác hẳn tầng dựng kế hoạch, chỗ đó hạ id lạ về "không khung" một cách lặng lẽ:
 * bản dựng phải chịu đựng dữ liệu xấu để không làm chết cả video, còn công cụ thì
 * phải NÓI RA để agent sửa được ở lượt sau. Hai tầng, hai cách xử, cả hai đều cố ý.
 */
function checkedFrame(
  frame: { styleId: string; paletteId: string; decorId?: string } | null | undefined
): { styleId: string; paletteId: string; decorId?: string } | null | undefined {
  if (!frame) return frame

  if (!findTextFrameStyle(frame.styleId)) {
    throw new Error(
      `Không có kiểu khung "${frame.styleId}". Chọn một trong: ${TEXT_FRAME_STYLES.map((item) => item.id).join(', ')}`
    )
  }
  if (!findTextFramePalette(frame.paletteId)) {
    throw new Error(
      `Không có bộ màu khung "${frame.paletteId}". Chọn một trong: ${TEXT_FRAME_PALETTES.map((item) => item.id).join(', ')}`
    )
  }
  if (frame.decorId && !findTextFrameDecor(frame.decorId)) {
    throw new Error(
      `Không có trang trí "${frame.decorId}". Chọn một trong: ${TEXT_FRAME_DECORS.map((item) => item.id).join(', ')}`
    )
  }
  return frame
}

export function planChatToolCalls(
  context: ChatEditContext,
  calls: Array<{ name: string; arguments: unknown }>
): ChatToolPlan {
  const steps: PlannedToolCall[] = []
  const failures: ToolPlanFailure[] = []

  for (const call of calls) {
    if (!isChatToolName(call.name)) {
      // Mô hình bịa ra công cụ không tồn tại — chặn tại đây.
      failures.push({ tool: call.name, reason: 'Công cụ không tồn tại' })
      continue
    }

    try {
      steps.push(planOne(context, call.name, call.arguments))
    } catch (error) {
      failures.push({
        tool: call.name,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { steps, failures }
}
