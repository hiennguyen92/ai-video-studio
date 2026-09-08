import type { ProjectDocument } from '../domain/project-document-types'
import { projectDurationUs } from '../domain/project-document-types'
import { clipEndUs } from '../domain/timeline-track-types'
import {
  chatToolDescriptions,
  chatToolParameterHints,
  chatUnsupportedRequests,
  type ChatToolName
} from './chat-tool-catalog'

/**
 * Tóm tắt project để mô hình đọc (DESCRIPTION §5: "Đọc project, clip được chọn,
 * playhead và thiết lập AI Studio").
 *
 * Gửi nguyên project JSON là hỏng: nó phình rất nhanh, tốn tiền, và chôn thông
 * tin cần dùng dưới hàng nghìn dòng dữ liệu phái sinh (hash, đường dẫn thumbnail,
 * waveform). Bản tóm tắt này chỉ nêu những gì mô hình cần để chọn công cụ và điền
 * đúng id.
 *
 * Thời gian ghi bằng GIÂY vì công cụ cũng nhận giây; để mô hình tự đổi micro giây
 * là mời nó nhầm ba chữ số.
 */

/** Cắt bớt danh sách clip cho ngữ cảnh khỏi phình theo dự án dài. */
const MAX_CLIPS_LISTED = 60

function seconds(us: number): string {
  return (us / 1_000_000).toFixed(2)
}

export interface ChatContextInput {
  document: ProjectDocument
  selectedClipIds: string[]
  playheadUs: number
}

export function buildProjectContext(input: ChatContextInput): string {
  const { document, selectedClipIds, playheadUs } = input
  const lines: string[] = []

  lines.push(`Project: "${document.name}"`)
  lines.push(
    `Canvas: ${document.settings.width}x${document.settings.height} @ ${document.settings.frameRate.num}/${document.settings.frameRate.den} fps`
  )
  lines.push(`Timeline duration: ${seconds(projectDurationUs(document))}s`)
  lines.push(`Playhead: ${seconds(playheadUs)}s`)
  lines.push(
    selectedClipIds.length > 0
      ? `Selected clips: ${selectedClipIds.join(', ')}`
      : 'Selected clips: none'
  )

  lines.push('', 'Tracks:')
  for (const track of document.tracks) {
    const parts = [
      `- id=${track.id}`,
      `kind=${track.kind}`,
      track.role ? `role=${track.role}` : '',
      `name="${track.name}"`,
      `clips=${track.clips.length}`,
      track.muted ? 'muted' : '',
      track.locked ? 'locked' : ''
    ].filter(Boolean)
    lines.push(parts.join(' '))
  }

  const allClips = document.tracks.flatMap((track) =>
    track.clips.map((clip) => ({ trackId: track.id, clip }))
  )
  lines.push('', `Clips (${allClips.length}):`)
  for (const { trackId, clip } of allClips.slice(0, MAX_CLIPS_LISTED)) {
    const asset = document.assets.find((item) => item.id === clip.assetId)
    lines.push(
      `- id=${clip.id} track=${trackId} start=${seconds(clip.startUs)}s end=${seconds(clipEndUs(clip))}s` +
        ` volume=${clip.volume}${asset ? ` asset="${asset.name}"` : ''}`
    )
  }
  if (allClips.length > MAX_CLIPS_LISTED) {
    // Nói rõ là đã cắt bớt, để mô hình không kết luận rằng dự án chỉ có bấy nhiêu.
    lines.push(`- … và ${allClips.length - MAX_CLIPS_LISTED} clip nữa không liệt kê`)
  }

  lines.push('', 'Transcripts:')
  if (document.transcripts.length === 0) lines.push('- none')
  for (const transcript of document.transcripts) {
    lines.push(
      `- id=${transcript.id} language=${transcript.language} segments=${transcript.segments.length}`
    )
  }

  lines.push('', 'Translations:')
  if (document.translations.length === 0) lines.push('- none')
  for (const translation of document.translations) {
    lines.push(
      `- id=${translation.id} transcript=${translation.transcriptId} target=${translation.targetLanguage} segments=${translation.segments.length}`
    )
  }

  lines.push('', 'Subtitle tracks:')
  if (document.subtitleTracks.length === 0) lines.push('- none')
  for (const track of document.subtitleTracks) {
    lines.push(`- id=${track.id} name="${track.name}" cues=${track.cues.length}`)
  }

  return lines.join('\n')
}

/**
 * Chỉ dẫn hệ thống.
 *
 * Nói rõ những việc mô hình KHÔNG làm được thay vì để nó hứa rồi không có gì xảy
 * ra — người dùng sẽ ngồi chờ một tác vụ không bao giờ chạy.
 */
export function buildChatSystemPrompt(): string {
  const tools = (Object.keys(chatToolDescriptions) as ChatToolName[])
    .map((name) => `- ${name}${chatToolParameterHints[name]}: ${chatToolDescriptions[name]}`)
    .join('\n')

  return [
    'You are the editing assistant inside a video editor called AI Video Studio.',
    'The user writes in Vietnamese. Always reply in Vietnamese.',
    '',
    'You can change the project ONLY by calling the tools listed below.',
    'You never output project JSON and never invent ids: use exactly the ids from the context.',
    'Times are in SECONDS on the timeline.',
    'When the user says "clip đang chọn" or does not name a clip, omit clipId so the app uses the selected clip.',
    '',
    'Available tools:',
    tools,
    '',
    'You cannot do these; say so plainly and point the user at the right tab in AI Studio:',
    ...chatUnsupportedRequests.map((item) => `- ${item}`),
    '',
    'Reply with a single JSON object and nothing else:',
    '{"reply": "<câu trả lời tiếng Việt>", "toolCalls": [{"name": "<tool>", "arguments": {…}}]}',
    'Use an empty toolCalls array when the user only asks a question.',
    'Keep "reply" short: say what you are about to change, not how the editor works.'
  ].join('\n')
}
