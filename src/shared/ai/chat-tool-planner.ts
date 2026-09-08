import type { EditorCommand } from '../commands/editor-command-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { findClip } from '../domain/project-document-types'
import { clipEndUs, type Clip } from '../domain/timeline-track-types'
import { buildSubtitleCues } from '../domain/subtitle-cue-builder'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleTrack } from '../domain/subtitle-types'
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
  makeId(): string
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

      const trackId = context.makeId()
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
