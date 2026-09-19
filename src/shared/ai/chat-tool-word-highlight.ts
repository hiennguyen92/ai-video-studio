import type { z } from 'zod'
import type { EditorCommand } from '../commands/editor-command-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { splitCuesIntoWordChunks } from '../domain/subtitle-word-timing'
import type { chatToolSchemas } from './chat-tool-catalog'

/**
 * Dịch `set_subtitle_word_highlight` thành lệnh: bật/tắt tô chữ đang nói và, nếu
 * được nêu, chia câu thành cụm ngắn — hai lệnh, MỘT bước hoàn tác.
 */

type Input = z.infer<(typeof chatToolSchemas)['set_subtitle_word_highlight']>
type Planned = { description: string; commands: EditorCommand[] }

const DEFAULT_HIGHLIGHT_COLOR = '#FFE45C'

export function planSubtitleWordHighlight(
  document: ProjectDocument,
  input: Input,
  makeId: () => string
): Planned {
  const track = document.subtitleTracks.find((item) => item.id === input.subtitleTrackId)
  if (!track) throw new Error(`Không tìm thấy track phụ đề "${input.subtitleTrackId}"`)
  if (input.mode === undefined && input.color === undefined && input.wordsPerChunk === undefined) {
    throw new Error('Cần ít nhất một trong mode, color hoặc wordsPerChunk')
  }

  const commands: EditorCommand[] = []
  const parts: string[] = []

  const current = track.style.wordHighlight
  const mode = input.mode ?? (current ? current.mode : input.color ? 'word' : 'off')
  if (input.mode !== undefined || input.color !== undefined) {
    const style = { ...track.style }
    if (mode === 'off') {
      delete style.wordHighlight
      parts.push('tắt tô chữ')
    } else {
      style.wordHighlight = {
        mode,
        color: input.color ?? current?.color ?? DEFAULT_HIGHLIGHT_COLOR
      }
      parts.push(
        `${mode === 'word' ? 'tô chữ đang nói' : 'tô dần theo lời'} màu ${style.wordHighlight.color}`
      )
    }
    commands.push({ type: 'subtitle/set-style', trackId: track.id, style })
  }

  if (input.wordsPerChunk !== undefined) {
    const cues = splitCuesIntoWordChunks(track.cues, input.wordsPerChunk, makeId)
    if (cues.length !== track.cues.length) {
      commands.push({ type: 'subtitle/replace-cues', trackId: track.id, cues })
      parts.push(
        `chia ${track.cues.length} câu thành ${cues.length} cụm ≤${input.wordsPerChunk} chữ`
      )
    } else {
      parts.push(`không câu nào dài hơn ${input.wordsPerChunk} chữ, giữ nguyên`)
    }
  }

  if (commands.length === 0) throw new Error(parts.join('; '))
  return { description: `Phụ đề "${track.name}": ${parts.join('; ')}`, commands }
}
