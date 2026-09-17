import type { EditorCommand } from '../commands/editor-command-types'
import type { ProjectDocument } from '../domain/project-document-types'
import type { Transcript, Translation } from '../domain/transcript-types'
import { chatToolSchemas, type ChatToolName } from './chat-tool-catalog'

/**
 * Dịch các công cụ sửa DỮ LIỆU LỜI NÓI thành lệnh: track phụ đề (đổi tên, xoá),
 * đoạn phiên âm (sửa chữ, gộp, xoá cả bản), bản dịch (sửa chữ, glossary, xoá).
 *
 * Đúng các lệnh mà panel Phiên âm / Dịch / Phụ đề phát ra, nên reducer kiểm tra
 * và hoàn tác y hệt. Ở đây chỉ tra id trước để agent nhận lỗi dễ hiểu — kèm tên
 * và đoạn chữ — thay vì một câu "không áp dụng được lệnh nào".
 */

type Planned = { description: string; commands: EditorCommand[] }

function findTranscript(document: ProjectDocument, transcriptId: string): Transcript {
  const transcript = document.transcripts.find((item) => item.id === transcriptId)
  if (!transcript) throw new Error(`Không tìm thấy transcript "${transcriptId}"`)
  return transcript
}

function findTranslation(document: ProjectDocument, translationId: string): Translation {
  const translation = document.translations.find((item) => item.id === translationId)
  if (!translation) throw new Error(`Không tìm thấy bản dịch "${translationId}"`)
  return translation
}

function findSubtitleTrackName(document: ProjectDocument, subtitleTrackId: string): string {
  const track = document.subtitleTracks.find((item) => item.id === subtitleTrackId)
  if (!track) throw new Error(`Không tìm thấy track phụ đề "${subtitleTrackId}"`)
  return track.name
}

/** Rút gọn một đoạn chữ cho dòng mô tả, để lịch sử hoàn tác đọc được. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat
}

export function planTranscriptDataTool(
  document: ProjectDocument,
  tool: ChatToolName,
  args: unknown
): Planned {
  switch (tool) {
    case 'rename_subtitle_track': {
      const input = chatToolSchemas.rename_subtitle_track.parse(args)
      const name = findSubtitleTrackName(document, input.subtitleTrackId)
      return {
        description: `Đổi tên phụ đề "${name}" thành "${input.name}"`,
        commands: [
          { type: 'subtitle/rename-track', trackId: input.subtitleTrackId, name: input.name }
        ]
      }
    }

    case 'remove_subtitle_track': {
      const input = chatToolSchemas.remove_subtitle_track.parse(args)
      const name = findSubtitleTrackName(document, input.subtitleTrackId)
      return {
        description: `Xoá track phụ đề "${name}"`,
        commands: [{ type: 'subtitle/remove-track', trackId: input.subtitleTrackId }]
      }
    }

    case 'update_transcript_segment': {
      const input = chatToolSchemas.update_transcript_segment.parse(args)
      const transcript = findTranscript(document, input.transcriptId)
      if (!transcript.segments.some((item) => item.id === input.segmentId)) {
        throw new Error(`Không tìm thấy đoạn "${input.segmentId}" trong transcript`)
      }
      return {
        description: `Sửa đoạn phiên âm thành "${excerpt(input.text)}"`,
        commands: [
          {
            type: 'transcript/update-segment',
            transcriptId: transcript.id,
            segmentId: input.segmentId,
            text: input.text
          }
        ]
      }
    }

    case 'merge_transcript_segments': {
      const input = chatToolSchemas.merge_transcript_segments.parse(args)
      const transcript = findTranscript(document, input.transcriptId)
      const index = transcript.segments.findIndex((item) => item.id === input.segmentId)
      if (index < 0) throw new Error(`Không tìm thấy đoạn "${input.segmentId}" trong transcript`)
      if (index + 1 >= transcript.segments.length) {
        throw new Error('Đây là đoạn cuối, không có đoạn kế tiếp để gộp')
      }
      return {
        description: `Gộp đoạn "${excerpt(transcript.segments[index].text)}" với đoạn sau`,
        commands: [
          {
            type: 'transcript/merge-segments',
            transcriptId: transcript.id,
            segmentId: input.segmentId
          }
        ]
      }
    }

    case 'remove_transcript': {
      const input = chatToolSchemas.remove_transcript.parse(args)
      const transcript = findTranscript(document, input.transcriptId)
      const translations = document.translations.filter(
        (item) => item.transcriptId === transcript.id
      ).length
      return {
        // Nói rõ phần kéo theo: reducer xoá luôn bản dịch của transcript này.
        description: `Xoá transcript ${transcript.language}${translations > 0 ? ` cùng ${translations} bản dịch` : ''}`,
        commands: [{ type: 'transcript/remove', transcriptId: transcript.id }]
      }
    }

    case 'update_translation_segment': {
      const input = chatToolSchemas.update_translation_segment.parse(args)
      const translation = findTranslation(document, input.translationId)
      if (!translation.segments.some((item) => item.id === input.segmentId)) {
        throw new Error(`Không tìm thấy đoạn "${input.segmentId}" trong bản dịch`)
      }
      return {
        description: `Sửa đoạn dịch thành "${excerpt(input.text)}"`,
        commands: [
          {
            type: 'translation/update-segment',
            translationId: translation.id,
            segmentId: input.segmentId,
            text: input.text
          }
        ]
      }
    }

    case 'set_translation_glossary': {
      const input = chatToolSchemas.set_translation_glossary.parse(args)
      const translation = findTranslation(document, input.translationId)
      return {
        description: `Đặt glossary ${input.entries.length} mục cho bản dịch ${translation.targetLanguage}`,
        commands: [
          {
            type: 'translation/set-glossary',
            translationId: translation.id,
            glossary: input.entries
          }
        ]
      }
    }

    case 'remove_translation': {
      const input = chatToolSchemas.remove_translation.parse(args)
      const translation = findTranslation(document, input.translationId)
      return {
        description: `Xoá bản dịch ${translation.targetLanguage}`,
        commands: [{ type: 'translation/remove', translationId: translation.id }]
      }
    }

    default:
      throw new Error(`Công cụ "${tool}" không thuộc nhóm dữ liệu lời nói`)
  }
}
