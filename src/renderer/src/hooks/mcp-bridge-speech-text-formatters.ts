import type { ProjectDocument } from '../../../shared/domain/project-document-types'

/**
 * Định dạng transcript và bản dịch thành văn bản cho agent MCP đọc.
 *
 * Mốc thời gian ghi bằng GIÂY vì công cụ cũng nhận giây; để mô hình tự đổi micro
 * giây là mời nó nhầm ba chữ số.
 */

function secondsLabel(us: number): string {
  return (us / 1_000_000).toFixed(2)
}

export function formatTranscript(document: ProjectDocument, transcriptId?: string): string {
  const transcript = transcriptId
    ? document.transcripts.find((item) => item.id === transcriptId)
    : document.transcripts[0]

  if (!transcript) {
    return transcriptId
      ? `Không tìm thấy transcript "${transcriptId}".`
      : 'Dự án chưa có bản phiên âm nào.'
  }

  const asset = document.assets.find((item) => item.id === transcript.assetId)
  const header = [
    `transcript id=${transcript.id}`,
    `language=${transcript.language}`,
    `asset=${asset?.name ?? transcript.assetId}`,
    `segments=${transcript.segments.length}`
  ].join(' ')

  const lines = transcript.segments.map(
    (segment) =>
      `- id=${segment.id} ${secondsLabel(segment.startUs)}s–${secondsLabel(segment.endUs)}s: ${segment.text}`
  )

  return [header, '', ...lines].join('\n')
}

export function formatTranslation(document: ProjectDocument, translationId?: string): string {
  const translation = translationId
    ? document.translations.find((item) => item.id === translationId)
    : document.translations[0]

  if (!translation) {
    return translationId
      ? `Không tìm thấy bản dịch "${translationId}".`
      : 'Dự án chưa có bản dịch nào.'
  }

  const header = [
    `translation id=${translation.id}`,
    `transcript=${translation.transcriptId}`,
    `${translation.sourceLanguage}→${translation.targetLanguage}`,
    `segments=${translation.segments.length}`
  ].join(' ')

  const glossary =
    translation.glossary.length === 0
      ? ['glossary: none']
      : ['glossary:', ...translation.glossary.map((entry) => `- ${entry.from} → ${entry.to}`)]

  // Kèm mốc và lời gốc của đoạn transcript tương ứng: bản dịch không mang thời gian
  // riêng, và sửa bản dịch mà không thấy câu gốc thì chỉ là đoán.
  const sourceSegments = new Map(
    document.transcripts
      .find((item) => item.id === translation.transcriptId)
      ?.segments.map((segment) => [segment.id, segment]) ?? []
  )
  const lines = translation.segments.map((segment) => {
    const source = sourceSegments.get(segment.sourceSegmentId)
    const timing = source ? `${secondsLabel(source.startUs)}s–${secondsLabel(source.endUs)}s ` : ''
    const original = source ? ` (gốc: ${source.text})` : ''
    const edited = segment.edited ? ' [đã sửa tay]' : ''
    return `- id=${segment.id} ${timing}${segment.text}${original}${edited}`
  })

  return [header, ...glossary, '', ...lines].join('\n')
}
