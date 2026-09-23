import type { EditorCommand } from '../commands/editor-command-types'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { canvasSizeForLongEdge, longEdgeForShortEdge, shortEdgeOf } from '../domain/canvas-size'
import { findEditStyle } from '../domain/edit-style-catalog'
import { editStyleAspectMismatch, expandEditStyle } from '../domain/edit-style-expand'
import type { MediaAsset } from '../domain/media-asset-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { findSoundEffect } from '../domain/sound-effect-catalog'
import { countAssetUsages, findClip } from '../domain/project-document-types'
import { DEFAULT_MOTION_INTENSITY } from '../domain/clip-motion-types'
import {
  IMAGE_DEFAULT_DURATION_US,
  DEFAULT_CLIP_TRANSFORM,
  clipEndUs,
  type Clip
} from '../domain/timeline-track-types'
import { buildSubtitleCues } from '../domain/subtitle-cue-builder'
import {
  createDefaultSubtitleStyle,
  type SubtitleCue,
  type SubtitleStyle,
  type SubtitleTrack
} from '../domain/subtitle-types'
import {
  DEFAULT_TEXT_ANIMATION_DURATION_US,
  applyTextOverlayBox,
  applyTextOverlayFrame,
  createDefaultTextOverlayStyle,
  defaultTextTrackId,
  type TextOverlay,
  type TextOverlayFrame
} from '../domain/text-overlay-types'
import {
  TEXT_FRAME_DECORS,
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES,
  findTextFrameDecor,
  findTextFramePalette,
  findTextFrameStyle
} from '../domain/text-frame-catalog'
import {
  findCutPoints,
  isJunction,
  removeCutTransitionCommands,
  setCutTransitionCommands
} from '../domain/timeline-cut-transitions'
import { guessDuckingTracks, planAutoDucking } from '../domain/auto-ducking-planner'
import { planRippleDeleteClips } from '../commands/clip-ripple-delete'
import { planSilenceCuts } from '../domain/silence-cut-planner'
import {
  DEFAULT_FREEZE_US,
  planFreezeFrame,
  resolveFreezeFrameSource
} from '../domain/freeze-frame-planner'
import { planVoiceCleanup, resolveVoiceCleanupTarget } from '../domain/voice-cleanup-planner'
import type { SilenceInterval } from '../ipc/silence-detection-types'
import {
  expandToLinkGroups,
  planGroupClips,
  planMoveClips,
  planSplitClip,
  singleSelectedClipId,
  planUngroupClips
} from '../domain/clip-link-groups'
import { roundHalfUp } from '../domain/time-units'
import { CLIP_LOOKS, findClipLook } from '../domain/clip-look-catalog'
import { resolveKeyframeTool } from './chat-tool-keyframes'
import { chatToolSchemas, isChatToolName, type ChatToolName } from './chat-tool-catalog'
import {
  planAddClipEffect,
  planMoveClipEffect,
  planRemoveClipEffect,
  planUpdateClipEffect
} from './chat-tool-clip-effects'
import {
  planRateStretchClip,
  planRippleTrimClip,
  planSlipClip
} from './chat-tool-timeline-edit-modes'
import { planSetTextStyle } from './chat-tool-text-style'
import { planSubtitleWordHighlight } from './chat-tool-word-highlight'
import { planTranscriptDataTool } from './chat-tool-transcript-subtitle-data'

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
/** Một đường dẫn sau khi nhập: thành asset, trùng với asset đã có, hoặc hỏng. */
export interface ImportedMediaOutcome {
  asset?: MediaAsset
  /** Id của asset đã có trong dự án, khi file này trùng nội dung với nó. */
  duplicateOf?: string
  error?: string
}

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
  makeId(prefix?: 'clip' | 'track' | 'text' | 'fx' | 'group' | 'marker'): string
  /**
   * Cú máy đã dò, theo id asset.
   *
   * Không nằm trong tài liệu project vì đây là dữ liệu phái sinh nằm trong cache;
   * nơi gọi nạp vào khi cần dựng theo hình.
   */
  shots?: Record<string, Array<{ startUs: number; endUs: number }>>
  /**
   * Kết quả nhập media, theo đường dẫn file, do nơi gọi dựng SẴN.
   *
   * Cùng lý do như hiệu ứng âm thanh và phông chữ: planner là hàm thuần, không
   * probe được file, không băm được nội dung, không dựng được thumbnail. Nơi gọi
   * làm phần nặng rồi đưa asset đã xong vào đây; planner chỉ phát lệnh `asset/add`.
   */
  importedMedia?: Record<string, ImportedMediaOutcome>
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
  /**
   * Khoảng lặng đã dò (trục NGUỒN), theo id clip — cho `remove_silences`.
   *
   * Cùng lý do như `soundEffects`: dò là chạy ffmpeg, planner là hàm thuần. Nơi
   * gọi dò trước rồi đưa kết quả — hoặc lỗi — vào đây.
   */
  silences?: Record<string, { intervals?: SilenceInterval[]; error?: string }>
  /** Đoạn video đứng hình đã dựng, theo id clip — cho `freeze_frame`. */
  freezeFrames?: Record<string, { asset?: MediaAsset; error?: string }>
  /** Asset giọng đã làm sạch, theo id clip — cho `clean_voice`. */
  cleanedVoices?: Record<string, { asset?: MediaAsset; error?: string }>
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
/** Ném lỗi kèm danh sách id có thật, để agent sửa được ở lượt sau. */
function requireMarker(document: ProjectDocument, markerId: string): void {
  if (document.markers.some((marker) => marker.id === markerId)) return
  const known = document.markers.map((marker) => marker.id).join(', ') || 'chưa có marker nào'
  throw new Error(`Không tìm thấy marker "${markerId}". Marker hiện có: ${known}`)
}

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
  // Nhiều clip RỜI đang chọn thì không đoán; hỏi lại rẻ hơn sửa nhầm. Một nhóm
  // thì là một clip — clip người dùng bấm.
  const single = singleSelectedClipId(context.document, context.selectedClipIds)
  if (!single) throw new Error('Đang chọn nhiều clip — hãy chọn đúng một clip')
  return single
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
    case 'set_keyframe': {
      const input = chatToolSchemas.set_keyframe.parse(args)
      const resolved = resolveKeyframeTool(document, input, (clipId) =>
        resolveClipId(context, clipId)
      )
      return {
        tool,
        description: `Đặt keyframe ${resolved.label} tại ${formatSeconds(resolved.atUs)} trong clip`,
        commands: [
          {
            type: 'keyframe/set',
            target: resolved.target,
            path: resolved.path,
            atUs: resolved.atUs,
            value: input.value,
            easing: input.easing
          }
        ]
      }
    }

    case 'remove_keyframe': {
      const input = chatToolSchemas.remove_keyframe.parse(args)
      const resolved = resolveKeyframeTool(document, input, (clipId) =>
        resolveClipId(context, clipId)
      )
      return {
        tool,
        description: `Xoá keyframe ${resolved.label} tại ${formatSeconds(resolved.atUs)}`,
        commands: [
          {
            type: 'keyframe/remove',
            target: resolved.target,
            path: resolved.path,
            atUs: resolved.atUs
          }
        ]
      }
    }

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
        commands: planSplitClip(document, clipId, atUs, (prefix) => context.makeId(prefix)).commands
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

    case 'ripple_trim_clip':
    case 'slip_clip':
    case 'rate_stretch_clip': {
      const clipId = resolveClipId(context, (args as { clipId?: string } | null)?.clipId)
      const located = findClip(document, clipId)!
      const track = document.tracks.find((item) => item.id === located.trackId)!
      const clip = track.clips[located.clipIndex]
      const planned =
        tool === 'ripple_trim_clip'
          ? planRippleTrimClip(clip, chatToolSchemas.ripple_trim_clip.parse(args))
          : tool === 'slip_clip'
            ? planSlipClip(clip, track, chatToolSchemas.slip_clip.parse(args))
            : planRateStretchClip(clip, track, chatToolSchemas.rate_stretch_clip.parse(args))
      return { tool, ...planned }
    }

    case 'move_clip': {
      const input = chatToolSchemas.move_clip.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      if (input.toTrackId) requireTrack(context, input.toTrackId)
      const toStartUs = secondsToMicros(input.toSeconds)
      // Clip trong nhóm kéo cả nhóm đi cùng một khoảng; dời riêng nó là tách
      // hình khỏi tiếng — đúng thứ nhóm sinh ra để chặn.
      const members = expandToLinkGroups(document, [clipId])
      if (members.length > 1) {
        const clip = findClipById(document, clipId)!
        // Nhóm trải nhiều lane thì không chuyển lane được (dồn về một lane là đè lên
        // nhau). Nói ra, thay vì lặng lẽ bỏ `toTrackId` rồi báo "đã dời".
        const laneCount = new Set(
          document.tracks
            .filter((track) => track.clips.some((item) => members.includes(item.id)))
            .map((track) => track.id)
        ).size
        if (input.toTrackId && laneCount > 1) {
          throw new Error(
            'Nhóm này trải trên nhiều lane nên không chuyển lane được. Bỏ toTrackId, hoặc ungroup_clips trước.'
          )
        }
        const command = planMoveClips(document, members, toStartUs - clip.startUs, input.toTrackId)
        if (!command) {
          throw new Error(
            'Không dời được: clip sớm nhất của nhóm đã ở giây 0, không lùi thêm được nữa'
          )
        }
        // Khoảng dời có thể bị kẹp (clip sớm nhất không lùi quá 0): báo chỗ clip THẬT
        // SỰ tới, không phải chỗ được xin.
        const moved =
          command.type === 'clip/move-many'
            ? command.moves.find((move) => move.clipId === clipId)?.toStartUs
            : undefined
        const landed = moved ?? toStartUs
        return {
          tool,
          description:
            landed === toStartUs
              ? `Dời nhóm ${members.length} clip tới ${formatSeconds(toStartUs)}`
              : `Dời nhóm ${members.length} clip tới ${formatSeconds(landed)} (xin ${formatSeconds(toStartUs)} nhưng clip sớm nhất của nhóm không lùi quá 0 s)`,
          commands: [command]
        }
      }
      return {
        tool,
        description: `Dời clip tới ${formatSeconds(toStartUs)}`,
        commands: [{ type: 'clip/move', clipId, toStartUs, toTrackId: input.toTrackId }]
      }
    }

    case 'ripple_delete_clip': {
      const input = chatToolSchemas.ripple_delete_clip.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const members = expandToLinkGroups(document, [clipId])
      const plan = planRippleDeleteClips(document, members)
      if (!plan) throw new Error('Không tìm thấy clip để xoá')
      if ('error' in plan) throw new Error(plan.error)
      const commands = plan.commands
      return {
        tool,
        description:
          members.length > 1
            ? `Xoá nhóm ${members.length} clip và dồn phần sau lên`
            : 'Xoá clip và dồn phần sau lên',
        commands
      }
    }

    case 'add_marker': {
      const input = chatToolSchemas.add_marker.parse(args)
      const atUs = secondsToMicros(input.atSeconds)
      return {
        tool,
        description: `Đặt marker tại ${formatSeconds(atUs)}`,
        commands: [
          {
            type: 'marker/add',
            marker: {
              id: context.makeId('marker'),
              atUs,
              label: input.label ?? '',
              color: input.color ?? 'blue'
            }
          }
        ]
      }
    }

    case 'update_marker': {
      const input = chatToolSchemas.update_marker.parse(args)
      requireMarker(document, input.markerId)
      return {
        tool,
        description: 'Sửa marker',
        commands: [
          {
            type: 'marker/update',
            markerId: input.markerId,
            patch: {
              ...(input.atSeconds !== undefined ? { atUs: secondsToMicros(input.atSeconds) } : {}),
              ...(input.label !== undefined ? { label: input.label } : {}),
              ...(input.color !== undefined ? { color: input.color } : {})
            }
          }
        ]
      }
    }

    case 'remove_marker': {
      const input = chatToolSchemas.remove_marker.parse(args)
      requireMarker(document, input.markerId)
      return {
        tool,
        description: 'Xoá marker',
        commands: [{ type: 'marker/remove', markerId: input.markerId }]
      }
    }

    case 'set_background_fill': {
      const input = chatToolSchemas.set_background_fill.parse(args)
      const clipIds = input.all
        ? document.tracks
            // Lane khoá bị bỏ qua, như nút trên giao diện — không thì một lane khoá
            // làm cả loạt bị từ chối.
            .filter((track) => (track.kind === 'video' || track.kind === 'image') && !track.locked)
            .flatMap((track) => track.clips.map((clip) => clip.id))
        : [resolveClipId(context, input.clipId)]
      if (clipIds.length === 0) throw new Error('Dự án chưa có clip hình nào')
      if (!input.all) {
        const track = document.tracks.find((item) =>
          item.clips.some((clip) => clip.id === clipIds[0])
        )
        if (track?.kind !== 'video' && track?.kind !== 'image') {
          throw new Error('Nền mờ chỉ dùng cho clip trên lane hình hoặc lane ảnh')
        }
      }
      const backgroundFill =
        input.kind === 'none' ? null : { kind: 'blur' as const, amount: input.amount ?? 0.5 }
      return {
        tool,
        description:
          input.kind === 'none'
            ? `Bỏ nền mờ (${clipIds.length} clip)`
            : `Đặt nền mờ cho ${clipIds.length} clip`,
        commands: clipIds.map((clipId) => ({
          type: 'clip/update' as const,
          clipId,
          patch: { backgroundFill }
        }))
      }
    }

    case 'remove_silences': {
      const input = chatToolSchemas.remove_silences.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const detected: Record<string, SilenceInterval[]> = {}
      for (const id of expandToLinkGroups(document, [clipId])) {
        const entry = context.silences?.[id]
        if (entry?.error) throw new Error(`Không dò được khoảng lặng: ${entry.error}`)
        if (entry?.intervals) detected[id] = entry.intervals
      }
      if (Object.keys(detected).length === 0) {
        throw new Error('Clip này (và nhóm của nó) không có tiếng để dò khoảng lặng')
      }
      const plan = planSilenceCuts(document, detected, {
        paddingUs: secondsToMicros(input.paddingSeconds ?? 0.15),
        scope: input.scope ?? 'clip-tracks',
        frameRate: document.settings.frameRate
      })
      if (plan.cutCount === 0) {
        throw new Error(
          'Không có khoảng lặng nào đủ dài. Nếu có chỗ im mà không bị bắt, đặt thresholdDb cao hơn (gần 0 hơn) mức tự đo'
        )
      }
      return {
        tool,
        description: `Cắt ${plan.cutCount} khoảng lặng, bớt ${formatSeconds(plan.removedUs)}`,
        commands: plan.commands
      }
    }

    case 'freeze_frame': {
      const input = chatToolSchemas.freeze_frame.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const atUs =
        input.atSeconds !== undefined ? secondsToMicros(input.atSeconds) : context.playheadUs
      const source = resolveFreezeFrameSource(document, clipId, atUs)
      const entry = context.freezeFrames?.[clipId]
      if (entry?.error) throw new Error(`Không dựng được khung đứng hình: ${entry.error}`)
      if (!entry?.asset) throw new Error('Chưa dựng được khung đứng hình cho clip này')
      const durationUs = secondsToMicros(input.durationSeconds ?? DEFAULT_FREEZE_US / 1_000_000)
      return {
        tool,
        description: `Đứng hình ${formatSeconds(durationUs)} tại ${formatSeconds(source.atUs)}`,
        commands: planFreezeFrame(document, source, entry.asset, durationUs, () =>
          context.makeId('clip')
        )
      }
    }

    case 'clean_voice': {
      const input = chatToolSchemas.clean_voice.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const target = resolveVoiceCleanupTarget(document, clipId)
      const entry = context.cleanedVoices?.[clipId]
      if (entry?.error) throw new Error(`Không làm sạch được giọng: ${entry.error}`)
      if (!entry?.asset) throw new Error('Chưa làm sạch được giọng cho clip này')
      return {
        tool,
        description:
          target.mode === 'add-partner'
            ? `Làm sạch giọng (${input.strength ?? 'medium'}), thêm tiếng sạch và tắt tiếng gốc`
            : `Làm sạch giọng (${input.strength ?? 'medium'})`,
        commands: planVoiceCleanup(document, target, entry.asset, (prefix) =>
          context.makeId(prefix)
        )
      }
    }

    case 'group_clips': {
      const input = chatToolSchemas.group_clips.parse(args)
      const clipIds = input.clipIds ?? context.selectedClipIds
      for (const id of clipIds) resolveClipId(context, id)
      const command = planGroupClips(clipIds, context.makeId('group'))
      if (!command) throw new Error('Cần ít nhất hai clip để gộp nhóm')
      return { tool, description: `Gộp ${clipIds.length} clip thành nhóm`, commands: [command] }
    }

    case 'ungroup_clips': {
      const input = chatToolSchemas.ungroup_clips.parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const command = planUngroupClips(document, [clipId])
      if (!command) throw new Error('Clip này không nằm trong nhóm nào')
      return { tool, description: 'Rã nhóm clip', commands: [command] }
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
        style: createDefaultSubtitleStyle(shortEdgeOf(context.document.settings)),
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
      // Hai công cụ chia đôi theo loại media, và mỗi bên từ chối phần của bên
      // kia. Nhận bừa thì agent không bao giờ biết mình đang gọi nhầm, và một
      // tấm ảnh đặt qua đường video sẽ mang theo `sourceInSeconds` vô nghĩa.
      if (asset?.kind === 'image') {
        throw new Error(`"${asset.name}" là ảnh — dùng insert_image để đặt ảnh lên timeline`)
      }
      return planInsertOnTimeline(tool, context, input)
    }

    case 'insert_image': {
      const input = chatToolSchemas.insert_image.parse(args)
      const asset = document.assets.find((item) => item.id === input.assetId)
      if (asset && asset.kind !== 'image') {
        throw new Error(`"${asset.name}" không phải ảnh — dùng insert_clip cho video và tiếng`)
      }
      return planInsertOnTimeline(tool, context, input)
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

      let style = createDefaultTextOverlayStyle(shortEdgeOf(context.document.settings))
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

      const frame = checkedFrame(input.frame) ?? undefined
      const frameColors = frame ? frameTextColors(frame) : undefined
      if (frameColors) style = applyTextOverlayFrame(style, frameColors)

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
        frame
      }

      return {
        tool,
        description: `Thêm Text "${input.text.slice(0, 30)}" từ ${formatSeconds(startUs)} tới ${formatSeconds(endUs)}`,
        commands: [{ type: 'text/add', overlay }]
      }
    }

    case 'remove_text_overlay': {
      const input = chatToolSchemas.remove_text_overlay.parse(args)
      const overlay = document.textOverlays.find((item) => item.id === input.overlayId)
      if (!overlay) throw new Error(`Không tìm thấy chữ overlay "${input.overlayId}"`)

      return {
        tool,
        description: `Xoá Text "${overlay.text.slice(0, 30)}"`,
        commands: [{ type: 'text/remove', overlayId: input.overlayId }]
      }
    }

    case 'apply_edit_style': {
      const input = chatToolSchemas.apply_edit_style.parse(args)
      const style = findEditStyle(input.styleId)
      if (!style) throw new Error(`Không có kiểu dựng "${input.styleId}"`)

      // Gọi lại chính bộ lập kế hoạch cho các bước bên trong. Đệ quy có đáy: kiểu
      // dựng chỉ chứa công cụ lẻ, không kiểu nào chứa `apply_edit_style`.
      //
      // Đi qua đường này chứ không tự lặp, vì nó đã lo phần khó: mỗi bước lập
      // trên kết quả của bước trước, và bước nào không áp được thì bị bỏ HẲN
      // thay vì để các bước sau dựng trên một trạng thái không bao giờ có thật.
      const inner = planChatToolCalls(context, expandEditStyle(style, document))
      const commands = inner.steps.flatMap((step) => step.commands)
      if (commands.length === 0) {
        throw new Error(inner.failures[0]?.reason ?? 'Timeline chưa có gì để áp kiểu dựng lên')
      }

      const mismatch = editStyleAspectMismatch(style, document)
      const warning = mismatch
        ? ` — LƯU Ý: khung đổi từ ${mismatch.from} sang ${mismatch.to}, clip đang có sẽ nằm trong hai dải đen`
        : ''
      // Kể ra từng việc: agent đọc lại để biết kiểu dựng vừa làm gì, y như phần
      // xem trước mà người dùng đọc trước khi bấm Áp.
      const did = inner.steps.map((step) => step.description).join('; ')
      return { tool, description: `Áp kiểu dựng ${style.id}: ${did}${warning}`, commands }
    }

    case 'set_canvas': {
      const input = chatToolSchemas.set_canvas.parse(args)
      // Bỏ trống thì GIỮ độ phân giải dự án đang dùng, không rơi về 1080.
      //
      // Đổi tỉ lệ là đổi HƯỚNG khung; ai không nói gì về số điểm ảnh thì không có
      // ý định đổi nó. Mặc định cứng 1920 biến mỗi lần đổi hướng trên dự án 4K
      // thành một cú hạ xuống 1080p mà không ai được hỏi — và đây là đường mà cả
      // agent lẫn MCP đi.
      const longEdge =
        input.longEdgePx ??
        longEdgeForShortEdge(input.aspect, shortEdgeOf(context.document.settings))
      // Phép tính dùng CHUNG với ô chọn trên thanh preview: hai đường tự tính lấy
      // sẽ cho ra hai bộ số khác nhau cho cùng một tỉ lệ.
      const size = canvasSizeForLongEdge(input.aspect, longEdge)

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

    case 'set_cut_transition': {
      const input = chatToolSchemas.set_cut_transition.parse(args)
      const fromClipId = resolveClipId(context, input.fromClipId)

      const track = document.tracks.find((item) =>
        item.clips.some((clip) => clip.id === fromClipId)
      )
      if (!track || (track.kind !== 'video' && track.kind !== 'image')) {
        throw new Error('Chỉ đặt được chuyển cảnh giữa hai clip hình')
      }

      // Cùng phép tìm chỗ nối mà timeline dùng, để agent và người dùng cùng nhìn
      // thấy một tập chỗ nối.
      const point = findCutPoints(track).find((item) => item.leftClip?.id === fromClipId)

      if (input.kind === 'none') {
        const commands = point ? removeCutTransitionCommands(point) : []
        if (commands.length === 0) {
          throw new Error(`Sau clip "${fromClipId}" không có chuyển cảnh nào để gỡ`)
        }
        return { tool, description: 'Gỡ transition ở chỗ nối', commands }
      }

      if (!point || !isJunction(point)) {
        throw new Error(
          `Clip "${fromClipId}" không liền với clip nào phía sau trên cùng track — chuyển cảnh chỉ đặt được vào chỗ nối giữa hai clip sát nhau`
        )
      }

      const durationUs =
        input.durationSeconds !== undefined ? secondsToMicros(input.durationSeconds) : undefined
      return {
        tool,
        description: `Đặt transition ${input.kind}${
          durationUs !== undefined ? ` ${formatSeconds(durationUs)}` : ''
        } ở chỗ nối sau clip`,
        commands: setCutTransitionCommands(point, input.kind, durationUs)
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

    case 'set_clip_filter': {
      const input = chatToolSchemas.set_clip_filter.parse(args)
      const clipId = resolveClipId(context, input.clipId)

      if (input.filterId === 'none') {
        return {
          tool,
          description: 'Gỡ filter của clip',
          commands: [{ type: 'clip/set-look', clipId }]
        }
      }

      // Kiểm id ở đây và NÉM kèm danh sách: agent sửa được ở lượt sau. Lớp dựng hình
      // thì lặng lẽ bỏ id lạ để không làm chết bản xuất — hai tầng, hai cách xử.
      const look = findClipLook(input.filterId)
      if (!look) {
        throw new Error(
          `Không có filter "${input.filterId}". Chọn một trong: ${CLIP_LOOKS.map((item) => item.id).join(', ')}`
        )
      }
      const current = findClipById(document, clipId)?.look
      return {
        tool,
        description: `Đặt filter ${look.nameVi} cho clip`,
        commands: [
          {
            type: 'clip/set-look',
            clipId,
            look: { id: look.id, intensity: input.intensity ?? current?.intensity ?? 1 }
          }
        ]
      }
    }

    case 'add_clip_effect':
    case 'update_clip_effect':
    case 'remove_clip_effect':
    case 'move_clip_effect': {
      const input = chatToolSchemas[tool].parse(args)
      const clipId = resolveClipId(context, input.clipId)
      const clip = findClipById(document, clipId)!
      const planned =
        tool === 'add_clip_effect'
          ? planAddClipEffect(
              clip,
              chatToolSchemas.add_clip_effect.parse(args),
              context.makeId('fx')
            )
          : tool === 'update_clip_effect'
            ? planUpdateClipEffect(clip, chatToolSchemas.update_clip_effect.parse(args))
            : tool === 'remove_clip_effect'
              ? planRemoveClipEffect(clip, chatToolSchemas.remove_clip_effect.parse(args))
              : planMoveClipEffect(clip, chatToolSchemas.move_clip_effect.parse(args))
      return { tool, ...planned }
    }

    case 'set_clip_zoom': {
      const input = chatToolSchemas.set_clip_zoom.parse(args)
      const clipId = resolveClipId(context, input.clipId)

      if (input.kind === 'none') {
        return {
          tool,
          description: 'Gỡ zoom của clip',
          commands: [{ type: 'clip/set-motion', clipId }]
        }
      }

      return {
        tool,
        description: `Đặt zoom ${input.kind} cho clip`,
        commands: [
          {
            type: 'clip/set-motion',
            clipId,
            motion: { kind: input.kind, intensity: input.intensity ?? DEFAULT_MOTION_INTENSITY }
          }
        ]
      }
    }

    case 'set_clip_adjust': {
      const input = chatToolSchemas.set_clip_adjust.parse(args)
      const clipId = resolveClipId(context, input.clipId)

      if (input.reset) {
        return {
          tool,
          description: 'Đặt lại Adjust của clip',
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
        description: `Chỉnh Adjust của clip (${Object.keys(grade).join(', ')})`,
        commands: [{ type: 'clip/set-color-grade', clipId, grade }]
      }
    }

    case 'import_media': {
      const input = chatToolSchemas.import_media.parse(args)

      // Chặn đường dẫn tương đối ở ĐÂY chứ không ở nơi gọi: đây là hàm thuần nên
      // luật này kiểm thử được, và nó áp cho mọi lối vào chứ không riêng MCP.
      const relative = input.filePaths.filter((path) => !path.startsWith('/'))
      if (relative.length > 0) {
        throw new Error(`Đường dẫn phải là tuyệt đối: ${relative.join(', ')}`)
      }

      const prepared = context.importedMedia
      if (!prepared) throw new Error('Chưa nhập được file nào — nơi gọi không dựng sẵn asset.')

      const commands: EditorCommand[] = []
      const parts: string[] = []
      for (const path of input.filePaths) {
        const outcome = prepared[path]
        if (!outcome) {
          parts.push(`hỏng: ${path} — không có kết quả nhập`)
          continue
        }
        if (outcome.error) {
          parts.push(`hỏng: ${path} — ${outcome.error}`)
          continue
        }
        if (outcome.duplicateOf) {
          // Trùng thì KHÔNG thêm lần nữa, nhưng phải nói ra kèm id bản đã có:
          // im lặng bỏ qua thì agent tưởng nhập hỏng và đi nhập lại mãi.
          parts.push(`đã có sẵn id=${outcome.duplicateOf}: ${path}`)
          continue
        }
        if (!outcome.asset) continue

        commands.push({ type: 'asset/add', asset: outcome.asset })
        const seconds = outcome.asset.probe?.durationUs
          ? ` ${(outcome.asset.probe.durationUs / 1_000_000).toFixed(2)}s`
          : ''
        const audio = outcome.asset.probe?.hasAudio ? ' +audio' : ''
        parts.push(
          `id=${outcome.asset.id} ${outcome.asset.kind} "${outcome.asset.name}"${seconds}${audio}`
        )
      }

      // Không được gì cả thì BÁO LỖI thay vì báo thành công rỗng — agent sẽ dựng
      // tiếp trên một thư viện tưởng tượng.
      if (commands.length === 0 && !parts.some((part) => part.startsWith('đã có sẵn'))) {
        throw new Error(`Không nhập được file nào. ${parts.join('; ')}`)
      }

      return { tool, description: `Nhập media — ${parts.join('; ')}`, commands }
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
        description: `Xoá track "${track.name}"${losing.length > 0 ? ` cùng ${losing.join(' và ')}` : ''}`,
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
        description: `Dời track "${document.tracks[from].name}" xuống vị trí ${input.toIndex} (track dưới vẽ trên)`,
        commands: [{ type: 'track/reorder', trackId: input.trackId, toIndex: input.toIndex }]
      }
    }

    case 'set_track': {
      const input = chatToolSchemas.set_track.parse(args)
      const track = document.tracks.find((item) => item.id === input.trackId)
      if (!track) throw new Error(`Không tìm thấy track "${input.trackId}"`)

      const patch: Extract<EditorCommand, { type: 'track/update' }>['patch'] = {}
      if (input.name !== undefined) patch.name = input.name
      if (input.hidden !== undefined) patch.hidden = input.hidden
      if (input.locked !== undefined) patch.locked = input.locked
      // Solo và vai trò chỉ được đọc ở lane tiếng; nhận cho lane khác là báo agent
      // "đã áp dụng" một thứ không có tác dụng gì.
      if ((input.solo !== undefined || input.role !== undefined) && track.kind !== 'audio') {
        throw new Error('Chỉ lane tiếng mới có solo và vai trò')
      }
      if (input.solo !== undefined) patch.solo = input.solo
      if (input.role !== undefined) {
        patch.role = input.role
      }
      if (Object.keys(patch).length === 0) throw new Error('Chưa nêu thứ gì để đổi')

      return {
        tool,
        description: `Đổi track "${track.name}": ${Object.keys(patch).join(', ')}`,
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

      if (input.trackId !== undefined) {
        const lane = document.tracks.find((item) => item.id === input.trackId)
        if (!lane || lane.kind !== 'text') {
          throw new Error(`"${input.trackId}" không phải lane chữ`)
        }
      }

      const frame = input.frame !== undefined ? checkedFrame(input.frame) : undefined
      const frameColors = frame ? frameTextColors(frame) : undefined

      return {
        tool,
        description: `Sửa Text "${input.text ?? overlay.text}"`,
        commands: [
          {
            type: 'text/update',
            overlayId: overlay.id,
            ...(input.text !== undefined ? { text: input.text } : {}),
            ...(startUs !== undefined ? { startUs } : {}),
            ...(endUs !== undefined ? { endUs } : {}),
            ...(input.trackId !== undefined ? { trackId: input.trackId } : {}),
            ...(input.animation !== undefined ? { animation: input.animation } : {}),
            ...(input.animationDurationSeconds !== undefined
              ? { animationDurationUs: secondsToMicros(input.animationDurationSeconds) }
              : {}),
            ...(input.exit !== undefined ? { exitAnimation: input.exit } : {}),
            ...(input.glow !== undefined ? { glow: input.glow } : {}),
            // `!== undefined` chứ KHÔNG phải kiểm truthy: `null` là lệnh bỏ khung
            // và phải đi lọt tới reducer. Kiểm truthy sẽ nuốt mất nó, và nút tắt
            // khung im lặng không làm gì.
            ...(input.frame !== undefined ? { frame: frame ?? null } : {})
          },
          // Cùng một bước với lệnh đổi khung, để một lần hoàn tác gỡ cả khung lẫn màu.
          ...(frameColors
            ? [
                {
                  type: 'text/set-style' as const,
                  overlayId: overlay.id,
                  style: applyTextOverlayFrame(overlay.style, frameColors)
                }
              ]
            : [])
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
            ...(input.secondaryText !== undefined ? { textSecondary: input.secondaryText } : {}),
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
        throw new Error(`Không có sound effect "${input.soundEffectId}"`)
      }

      // Asset do tiến trình main dựng sẵn (probe thời lượng thật, hash nội dung)
      // rồi đưa vào ngữ cảnh — planner là hàm thuần, không đọc file được. Cùng
      // lối với đường dẫn phông chữ.
      const asset = context.soundEffects?.[input.soundEffectId]
      if (!asset) {
        throw new Error(`Bản cài này không có file cho sound effect "${input.soundEffectId}"`)
      }

      const commands: EditorCommand[] = [{ type: 'asset/add', asset }]

      if (input.atSeconds !== undefined) {
        const track = input.trackId
          ? document.tracks.find((item) => item.id === input.trackId)
          : document.tracks.find((item) => item.kind === 'audio' && !item.locked)
        if (!track) throw new Error('Không tìm thấy track âm thanh nào để đặt sound effect')
        if (track.kind !== 'audio')
          throw new Error(`Track "${track.name}" không phải track âm thanh`)

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
            ? `Đặt sound effect "${definition.nameVi}" ở ${formatSeconds(secondsToMicros(input.atSeconds))}`
            : `Thêm sound effect "${definition.nameVi}" vào Media`,
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

    case 'set_text_style':
      return { tool, ...planSetTextStyle(document, chatToolSchemas.set_text_style.parse(args)) }

    case 'set_subtitle_word_highlight':
      return {
        tool,
        ...planSubtitleWordHighlight(
          document,
          chatToolSchemas.set_subtitle_word_highlight.parse(args),
          () => context.makeId()
        )
      }

    case 'rename_subtitle_track':
    case 'remove_subtitle_track':
    case 'update_transcript_segment':
    case 'merge_transcript_segments':
    case 'remove_transcript':
    case 'update_translation_segment':
    case 'set_translation_glossary':
    case 'remove_translation':
      return { tool, ...planTranscriptDataTool(document, tool, args) }

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
        description: `Dời ${targets.length} Text ${where}`,
        commands: targets.map((overlay) => ({
          type: 'text/set-style' as const,
          overlayId: overlay.id,
          style: applyPosition(overlay.style)
        }))
      }
    }

    case 'set_text_color': {
      const input = chatToolSchemas.set_text_color.parse(args)
      // Chỉ ghi đè viền khi agent NÊU: bỏ trống nghĩa là giữ nguyên, và một cái
      // viền bị xoá âm thầm làm chữ mất hút trên footage sáng.
      const patch = {
        color: input.color,
        ...(input.outlineColor ? { outlineColor: input.outlineColor } : {}),
        ...(input.outlineWidthPx !== undefined ? { outlineWidthPx: input.outlineWidthPx } : {})
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
          description: `Đổi màu phụ đề "${subtitleTrack.name}" sang ${input.color}`,
          commands: [
            {
              type: 'subtitle/set-style',
              trackId: subtitleTrack.id,
              style: { ...subtitleTrack.style, ...patch }
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
        description: `Đổi màu ${targets.length} Text sang ${input.color}`,
        commands: targets.map((overlay) => ({
          type: 'text/set-style' as const,
          overlayId: overlay.id,
          style: { ...overlay.style, ...patch }
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
        description: `Xoay ${targets.length} Text ${input.rotationDeg}°`,
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
        description: `Đổi phông ${overlays.length} Text sang ${input.fontFamily}`,
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
        rampUs: secondsToMicros(input.rampSeconds ?? 0.3)
      })

      if (plan.duckedClips === 0) {
        throw new Error('Không có đoạn nhạc nào trùng với lời nói')
      }
      return {
        tool,
        description: `Giảm nhạc ở ${plan.duckedClips} clip nhạc có lời nói đè lên`,
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
  frame: TextOverlayFrame | null | undefined
): TextOverlayFrame | null | undefined {
  if (!frame) return frame

  const style = findTextFrameStyle(frame.styleId)
  if (!style) {
    throw new Error(
      `Không có kiểu khung "${frame.styleId}". Chọn một trong: ${TEXT_FRAME_STYLES.map((item) => item.id).join(', ')}`
    )
  }
  // Khung ảnh mang màu sẵn trong ảnh: bộ màu và trang trí agent gửi kèm bị bỏ đi
  // thay vì báo lỗi, vì chúng vô hại và bắt agent gọi lại chỉ tốn một lượt.
  const padding = {
    ...(frame.paddingScaleX !== undefined ? { paddingScaleX: frame.paddingScaleX } : {}),
    ...(frame.paddingScaleY !== undefined ? { paddingScaleY: frame.paddingScaleY } : {})
  }
  if (style.kind === 'image') return { styleId: style.id, ...padding }

  if (!frame.paletteId || !findTextFramePalette(frame.paletteId)) {
    throw new Error(
      `${frame.paletteId ? `Không có bộ màu khung "${frame.paletteId}"` : `Khung "${style.id}" cần paletteId`}. Chọn một trong: ${TEXT_FRAME_PALETTES.map((item) => item.id).join(', ')}`
    )
  }
  if (frame.decorId && !findTextFrameDecor(frame.decorId)) {
    throw new Error(
      `Không có trang trí "${frame.decorId}". Chọn một trong: ${TEXT_FRAME_DECORS.map((item) => item.id).join(', ')}`
    )
  }
  return frame
}

/**
 * Màu chữ đi kèm khung, để chữ không mất hút trong ruột khung.
 *
 * Cùng việc giao diện làm khi đổi khung (`applyTextOverlayFrame`): chữ trắng mặc
 * định đặt vào giấy nhớ vàng là không đọc được.
 */
function frameTextColors(frame: TextOverlayFrame): { text: string } | undefined {
  const style = findTextFrameStyle(frame.styleId)
  if (!style) return undefined
  if (style.kind === 'image') return { text: style.textColor }
  return frame.paletteId ? findTextFramePalette(frame.paletteId) : undefined
}

/**
 * Đặt một asset lên timeline. Dùng chung cho `insert_clip` và `insert_image`.
 *
 * Hai công cụ, một nhánh: chép làm hai bản thì phần chọn track và phần kẹp biên
 * sẽ lệch nhau, và lệch ở đây nghĩa là cùng một asset đặt ra hai kết quả khác
 * nhau tuỳ agent gọi công cụ nào.
 *
 * ẢNH LÀ NGOẠI LỆ, đúng như bất biến của domain đã ghi: ảnh tĩnh không có thời
 * lượng nguồn (`probe.durationUs` bằng 0) nên kéo dài bao lâu cũng được. Áp phép
 * kiểm biên nguồn của video lên ảnh thì `remainingUs` luôn bằng 0 và KHÔNG BAO
 * GIỜ đặt được ảnh — kể cả khi đã nêu thời lượng.
 *
 * Ảnh chỉ tới được nhánh này qua `insert_image`; `insert_clip` từ chối ảnh từ
 * trước đó. Nhánh vẫn giữ ngoại lệ vì nó là luật của DOMAIN, không phải luật của
 * một công cụ — đổi công cụ không được làm luật đó biến mất.
 */
function planInsertOnTimeline(
  tool: ChatToolName,
  context: ChatEditContext,
  input: {
    assetId: string
    trackId?: string
    startSeconds: number
    sourceInSeconds?: number
    durationSeconds?: number
  }
): PlannedToolCall {
  const { document } = context
  const asset = document.assets.find((item) => item.id === input.assetId)
  if (!asset) throw new Error(`Không tìm thấy media "${input.assetId}"`)
  if (asset.missing) throw new Error(`File của "${asset.name}" hiện không còn trên đĩa`)

  // Không nêu track thì chọn track hợp kiểu media; ảnh cũng nằm trên track hình.
  const wantedKind = asset.kind === 'audio' ? 'audio' : 'video'
  const track = input.trackId
    ? document.tracks.find((item) => item.id === input.trackId)
    : document.tracks.find((item) => item.kind === wantedKind)
  if (!track) throw new Error(`Không tìm thấy track phù hợp cho "${asset.name}"`)

  const startUs = secondsToMicros(input.startSeconds)
  let durationUs: number
  let sourceInUs: number

  if (asset.kind === 'image') {
    // Ảnh không có trục thời gian nguồn nên điểm vào vô nghĩa; ép về 0 thay vì
    // nhận bừa một con số rồi để nó nằm đó không có tác dụng.
    sourceInUs = 0
    durationUs =
      input.durationSeconds === undefined
        ? IMAGE_DEFAULT_DURATION_US
        : secondsToMicros(input.durationSeconds)
  } else {
    sourceInUs = secondsToMicros(input.sourceInSeconds ?? 0)
    const remainingUs = asset.probe.durationUs - sourceInUs
    if (remainingUs <= 0) {
      throw new Error(`Điểm vào ${formatSeconds(sourceInUs)} nằm ngoài "${asset.name}"`)
    }
    // Bỏ trống thời lượng thì lấy hết phần còn lại; nêu quá dài thì kẹp lại thay
    // vì để reducer tạo clip đọc quá cuối file.
    durationUs = Math.min(
      input.durationSeconds === undefined ? remainingUs : secondsToMicros(input.durationSeconds),
      remainingUs
    )
  }
  if (durationUs <= 0) throw new Error('Thời lượng phải lớn hơn 0')

  return {
    tool,
    description: `Chèn "${asset.name}" vào ${track.name} tại ${formatSeconds(startUs)}`,
    commands: [
      {
        type: 'clip/insert',
        clipId: context.makeId(),
        trackId: track.id,
        assetId: asset.id,
        startUs,
        durationUs,
        sourceInUs
      }
    ]
  }
}

export function planChatToolCalls(
  context: ChatEditContext,
  calls: Array<{ name: string; arguments: unknown }>
): ChatToolPlan {
  const steps: PlannedToolCall[] = []
  const failures: ToolPlanFailure[] = []
  // Tài liệu SAU các bước đã lập — mỗi bước lập trên kết quả của bước trước.
  //
  // Lập mọi bước trên cùng một bản chụp ban đầu là sai với mọi công cụ theo vị
  // trí: "ripple xoá clip a" rồi "ripple xoá clip c" thì bước hai tính toạ độ của c
  // TRƯỚC khi a được xoá, và áp vào thực tế nó xoá nhầm clip đứng sau c.
  let working = context.document

  for (const call of calls) {
    if (!isChatToolName(call.name)) {
      // Mô hình bịa ra công cụ không tồn tại — chặn tại đây.
      failures.push({ tool: call.name, reason: 'Công cụ không tồn tại' })
      continue
    }

    try {
      const step = planOne({ ...context, document: working }, call.name, call.arguments)
      // Áp thử lên bản sao. Chỉ một bước thì khỏi — không bước nào đứng sau nó.
      if (calls.length > 1 && step.commands.length > 0) {
        const next = structuredClone(working)
        for (const command of step.commands) {
          const applied = applyEditorCommand(next, command)
          // Bước không áp được thì bỏ HẲN: để lại nó là để các bước sau lập trên
          // một trạng thái không bao giờ có thật.
          if (!applied.ok) throw new Error(applied.error)
        }
        working = next
      }
      steps.push(step)
    } catch (error) {
      failures.push({
        tool: call.name,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { steps, failures }
}
