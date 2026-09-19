import { chatToolSchemas } from '../../../shared/ai/chat-tool-catalog'
import type { ChatEditContext } from '../../../shared/ai/chat-tool-planner'
import { expandToLinkGroups } from '../../../shared/domain/clip-link-groups'
import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import { clipSourceSpanUs } from '../../../shared/domain/timeline-track-types'
import { resolveVoiceCleanupTarget } from '../../../shared/domain/voice-cleanup-planner'

/**
 * Chạy phần ffmpeg mà `remove_silences` và `clean_voice` cần, TRƯỚC khi lập kế
 * hoạch — planner là hàm thuần, không gọi được IPC.
 *
 * Dùng chung cho AI Chat trong app và agent qua MCP, nên hai lối không lệch nhau.
 * Lỗi không làm hỏng cả loạt: nó được ghi vào kết quả theo từng clip, và planner
 * báo đúng lỗi đó cho bước tương ứng.
 */

type Calls = Array<{ name: string; arguments: unknown }>

/** Clip mà công cụ nhắm tới — cùng luật với `resolveClipId` của planner. */
function targetClipId(clipId: string | undefined, selectedClipIds: string[]): string | undefined {
  return clipId ?? (selectedClipIds.length === 1 ? selectedClipIds[0] : undefined)
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function resolveSilences(
  calls: Calls,
  document: ProjectDocument,
  selectedClipIds: string[]
): Promise<NonNullable<ChatEditContext['silences']>> {
  const result: NonNullable<ChatEditContext['silences']> = {}

  for (const call of calls) {
    if (call.name !== 'remove_silences') continue
    const parsed = chatToolSchemas.remove_silences.safeParse(call.arguments)
    if (!parsed.success) continue
    const clipId = targetClipId(parsed.data.clipId, selectedClipIds)
    if (!clipId) continue

    for (const id of expandToLinkGroups(document, [clipId])) {
      if (result[id]) continue
      const track = document.tracks.find((item) => item.clips.some((clip) => clip.id === id))
      const clip = track?.clips.find((item) => item.id === id)
      const asset = document.assets.find((item) => item.id === clip?.assetId)
      if (!clip || !asset?.probe.hasAudio || (track?.kind !== 'audio' && track?.kind !== 'video')) {
        continue
      }
      try {
        const detected = await window.api.media.detectSilences({
          sourcePath: asset.source.path,
          startUs: clip.sourceInUs,
          endUs: clip.sourceInUs + clipSourceSpanUs(clip),
          noiseDb: parsed.data.thresholdDb ?? -35,
          minSilenceUs: Math.round((parsed.data.minSilenceSeconds ?? 0.5) * 1_000_000)
        })
        result[id] = detected.ok ? { intervals: detected.data } : { error: detected.error }
      } catch (error) {
        result[id] = { error: message(error) }
      }
    }
  }
  return result
}

export async function resolveCleanedVoices(
  calls: Calls,
  document: ProjectDocument,
  selectedClipIds: string[]
): Promise<NonNullable<ChatEditContext['cleanedVoices']>> {
  const result: NonNullable<ChatEditContext['cleanedVoices']> = {}

  for (const call of calls) {
    if (call.name !== 'clean_voice') continue
    const parsed = chatToolSchemas.clean_voice.safeParse(call.arguments)
    if (!parsed.success) continue
    const clipId = targetClipId(parsed.data.clipId, selectedClipIds)
    if (!clipId || result[clipId]) continue

    try {
      // Clip không làm sạch được thì để planner tự ném đúng lỗi của nó.
      const target = resolveVoiceCleanupTarget(document, clipId)
      const cleaned = await window.api.media.cleanVoice({
        projectId: document.id,
        source: target.sourceAsset,
        strength: parsed.data.strength ?? 'medium',
        existing: document.assets
      })
      result[clipId] = cleaned.ok ? { asset: cleaned.data } : { error: cleaned.error }
    } catch {
      continue
    }
  }
  return result
}
