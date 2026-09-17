import { CLIP_EFFECTS } from '../domain/clip-effect-catalog'
import type { ClipEffect, EffectParamSpec } from '../domain/clip-effect-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { projectDurationUs } from '../domain/project-document-types'
import { clipEndUs, clipSourceSpanUs, type Clip } from '../domain/timeline-track-types'
import { NEUTRAL_COLOR_GRADE, type ClipColorGrade } from '../domain/clip-color-grade'
import {
  cutTransitionDurationUs,
  findCutPoints,
  isJunction
} from '../domain/timeline-cut-transitions'
import { SOUND_EFFECTS } from '../domain/sound-effect-catalog'
import { CLIP_LOOKS } from '../domain/clip-look-catalog'
import {
  TEXT_FRAME_DECORS,
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES
} from '../domain/text-frame-catalog'
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
const MAX_CUES_LISTED = 40
const MAX_CLIPS_LISTED = 60

function seconds(us: number): string {
  return (us / 1_000_000).toFixed(2)
}

export interface ChatContextInput {
  document: ProjectDocument
  selectedClipIds: string[]
  playheadUs: number
}

/**
 * Chữ có xuống dòng in ra dạng `\n` trên một dòng: bản tổng quan mỗi mục một
 * dòng, xuống dòng thật sẽ cắt mục làm đôi và agent đọc nhầm phần sau là mục mới.
 */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, '\\n')
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

  // Nói thẳng ý nghĩa của thứ tự: agent muốn đặt logo lên trên cảnh quay thì phải
  // biết lane nào vẽ trên lane nào, và con số trong ngoặc là thứ `reorder_track` nhận.
  lines.push('', 'Tracks (index 0 is the top lane; the LOWEST lane draws on top):')
  for (const [index, track] of document.tracks.entries()) {
    const parts = [
      `- [${index}] id=${track.id}`,
      `kind=${track.kind}`,
      track.role ? `role=${track.role}` : '',
      `name="${track.name}"`,
      `clips=${track.clips.length}`,
      track.muted ? 'muted' : '',
      track.hidden ? 'hidden' : '',
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
        `${describeClipSource(clip, asset?.probe.durationUs)} volume=${clip.volume}` +
        describeClipState(clip) +
        `${asset ? ` asset="${asset.name}"` : ''}`
    )
  }
  if (allClips.length > MAX_CLIPS_LISTED) {
    // Nói rõ là đã cắt bớt, để mô hình không kết luận rằng dự án chỉ có bấy nhiêu.
    lines.push(`- … và ${allClips.length - MAX_CLIPS_LISTED} clip nữa không liệt kê`)
  }

  // Chỗ nối giữa hai clip hình: nơi DUY NHẤT đặt được chuyển cảnh. Không liệt kê thì
  // agent phải tự suy từ mốc start/end của từng clip, và dễ chọn nhầm hai clip có
  // khe hở ở giữa.
  const cuts = document.tracks
    .filter((track) => track.kind === 'video' || track.kind === 'image')
    .flatMap((track) => findCutPoints(track).filter(isJunction))
  lines.push('', 'Cuts between back-to-back clips (use set_cut_transition with fromClipId):')
  if (cuts.length === 0) lines.push('- none')
  for (const cut of cuts.slice(0, MAX_CLIPS_LISTED)) {
    const durationUs = cutTransitionDurationUs(cut)
    lines.push(
      `- fromClipId=${cut.leftClip!.id} toClipId=${cut.rightClip!.id} at=${seconds(cut.atUs)}s` +
        ` transition=${cut.kind ? `${cut.kind} ${seconds(durationUs ?? 0)}s` : 'none'}`
    )
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

  lines.push('', 'Text overlays:')
  if (document.textOverlays.length === 0) lines.push('- none')
  for (const overlay of document.textOverlays) {
    // Kèm khung đang dùng: không có nó thì agent ĐẶT được khung nhưng không SỬA
    // được, vì "đổi màu khung sang hồng" buộc phải đoán kiểu khung đang có.
    const frame = overlay.frame
      ? ` frame=${overlay.frame.styleId}${overlay.frame.paletteId ? `/${overlay.frame.paletteId}` : ''}${
          overlay.frame.decorId ? `+${overlay.frame.decorId}` : ''
        }${
          overlay.frame.paddingScaleX !== undefined || overlay.frame.paddingScaleY !== undefined
            ? ` padding=${overlay.frame.paddingScaleX ?? 1}x${overlay.frame.paddingScaleY ?? 1}`
            : ''
        }`
      : ''
    lines.push(
      `- id=${overlay.id} ${seconds(overlay.startUs)}s–${seconds(overlay.endUs)}s "${oneLine(overlay.text)}"${frame}`
    )
  }

  // Danh mục filter cũng là hằng số: không in ra thì agent phải đoán id.
  lines.push('', 'Filters (use set_clip_filter with the id):')
  for (const look of CLIP_LOOKS) {
    lines.push(`- id=${look.id} "${look.nameEn}" [${look.tags.join(', ')}]`)
  }

  // Danh mục effect hình kèm thông số và khoảng: thiếu khoảng thì agent gửi số ngoài
  // khoảng, bị kẹp lặng lẽ, và không hiểu vì sao hình không như nó muốn.
  lines.push(
    '',
    'Effects (use add_clip_effect with the kind; effects stack in order, reorder with move_clip_effect):'
  )
  for (const effect of CLIP_EFFECTS) {
    const params = effect.params.map(describeParamSpec)
    if (effect.usesIntensity) params.unshift('intensity 0..1')
    lines.push(
      `- kind=${effect.kind} "${effect.nameEn}" (${effect.group}) params: ${params.join(', ') || 'none'} [${effect.tags.join(', ')}]`
    )
  }

  // Danh mục hiệu ứng là HẰNG SỐ, không phụ thuộc dự án — nhưng agent không có
  // cách nào biết nếu không nói. Vài chục dòng, vẫn đủ ngắn để in thẳng ra.
  lines.push('', 'Built-in sound effects (use add_sound_effect with the id):')
  for (const effect of SOUND_EFFECTS) {
    lines.push(
      `- id=${effect.id} "${effect.nameEn}" ${Math.round(effect.durationUs / 1000)}ms [${effect.tags.join(', ')}]`
    )
  }

  // Cùng lý do với danh mục hiệu ứng: khung là HẰNG SỐ, agent không có cách nào
  // biết id nếu không nói ra. Không nói thì nó phải đoán, ăn một lỗi rồi mới sửa
  // được ở lượt sau — mà mô tả của `add_text_overlay` lại bảo nó lấy id "from the
  // project overview", tức là chính chỗ này.
  lines.push('', 'Cute text frames (pass as frame on add_text_overlay/update_text_overlay):')
  lines.push(
    `- vector styleId (needs paletteId): ${TEXT_FRAME_STYLES.filter(
      (item) => item.kind === 'vector'
    )
      .map((item) => `${item.id} "${item.nameEn}"`)
      .join(', ')}`
  )
  // Khung ảnh kèm từ khoá: bốn mươi mấy cái tên tiếng Anh ngắn không đủ để agent
  // chọn đúng "khung giáng sinh" hay "khung bảng đen cho menu".
  lines.push(
    `- picture styleId (styleId only, colours baked in): ${TEXT_FRAME_STYLES.filter(
      (item) => item.kind === 'image'
    )
      .map((item) => `${item.id} [${item.tags.join(', ')}]`)
      .join('; ')}`
  )
  lines.push(
    `- paletteId (vector only): ${TEXT_FRAME_PALETTES.map((item) => `${item.id} "${item.nameEn}"`).join(', ')}`
  )
  lines.push(
    `- decorId (optional, vector only): ${TEXT_FRAME_DECORS.map((item) => `${item.id} "${item.nameEn}"`).join(', ')}`
  )

  lines.push('', 'Subtitle tracks:')
  if (document.subtitleTracks.length === 0) lines.push('- none')
  for (const track of document.subtitleTracks) {
    lines.push(`- id=${track.id} name="${track.name}" cues=${track.cues.length}`)
    // Liệt kê id cue: không có chúng thì agent không sửa hay dời được câu nào.
    // Cắt bớt vì một track phụ đề dài có hàng trăm câu và sẽ nuốt sạch ngữ cảnh.
    for (const cue of track.cues.slice(0, MAX_CUES_LISTED)) {
      lines.push(
        `  - cue=${cue.id} ${seconds(cue.startUs)}s–${seconds(cue.endUs)}s "${oneLine(cue.text)}"`
      )
    }
    if (track.cues.length > MAX_CUES_LISTED) {
      lines.push(`  - … còn ${track.cues.length - MAX_CUES_LISTED} câu nữa`)
    }
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

/** Một effect trên clip, gọn một dòng: `id:kind@cường độ {thông số}`. */
/**
 * Đoạn nguồn clip đang phát — agent cần nó để slip. Ảnh tĩnh không có đoạn nguồn
 * thì bỏ qua.
 */
function describeClipSource(clip: Clip, assetDurationUs: number | undefined): string {
  if (assetDurationUs === undefined) return ''
  return ` source=${seconds(clip.sourceInUs)}–${seconds(clip.sourceInUs + clipSourceSpanUs(clip))}s`
}

/**
 * Những gì đang áp trên clip, chỉ in phần khác mặc định để dòng clip khỏi phình:
 * tốc độ, fade, Adjust, filter, zoom, effect. Thiếu thì agent phải đoán trạng thái
 * hiện tại trước khi sửa — ví dụ đổi zoom mà không biết clip đang có zoom gì.
 */
function describeClipState(clip: Clip): string {
  const parts: string[] = []
  if (clip.speed !== 1) parts.push(`speed=${clip.speed}`)
  if (clip.fadeInUs > 0) parts.push(`fadeIn=${seconds(clip.fadeInUs)}s`)
  if (clip.fadeOutUs > 0) parts.push(`fadeOut=${seconds(clip.fadeOutUs)}s`)
  if (clip.colorGrade) {
    const adjust = (Object.keys(NEUTRAL_COLOR_GRADE) as Array<keyof ClipColorGrade>)
      .filter((key) => clip.colorGrade![key] !== NEUTRAL_COLOR_GRADE[key])
      .map((key) => `${key}=${clip.colorGrade![key]}`)
    if (adjust.length) parts.push(`adjust=[${adjust.join(', ')}]`)
  }
  if (clip.look) parts.push(`filter=${clip.look.id}@${clip.look.intensity}`)
  if (clip.motion) parts.push(`zoom=${clip.motion.kind}@${clip.motion.intensity}`)
  if (clip.effects?.length) parts.push(`effects=[${clip.effects.map(describeEffect).join('; ')}]`)
  return parts.map((part) => ` ${part}`).join('')
}

function describeEffect(effect: ClipEffect): string {
  const params = Object.entries(effect.params)
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
  return `${effect.id}:${effect.kind}@${effect.intensity}${params ? ` {${params}}` : ''}`
}

function describeParamSpec(spec: EffectParamSpec): string {
  if (spec.type === 'number')
    return `${spec.key} ${spec.min}..${spec.max}${spec.unit ?? ''} (default ${spec.default})`
  if (spec.type === 'color') return `${spec.key} #RRGGBB (default ${spec.default})`
  return `${spec.key} ${spec.options.map((option) => option.value).join('|')} (default ${spec.default})`
}
