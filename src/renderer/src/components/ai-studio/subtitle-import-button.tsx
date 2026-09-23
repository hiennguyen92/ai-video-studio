import { shortEdgeOf } from '../../../../shared/domain/canvas-size'
import { useState, type JSX } from 'react'
import { parseSubtitleFile } from '../../../../shared/domain/subtitle-file-parser'
import {
  createDefaultSubtitleStyle,
  type SubtitleTrack
} from '../../../../shared/domain/subtitle-types'
import { createId } from '../../../../shared/domain/project-document-factory'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { interpolate, useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { ToolButton } from '../ui/tool-button'

/**
 * Nhập một file phụ đề có sẵn thành track phụ đề của dự án.
 *
 * Trước bản này app chỉ GHI được phụ đề ra file: có sẵn một bản `.srt` làm bằng
 * công cụ khác thì phải gõ lại từng câu — mà cũng không có nút thêm câu nào.
 *
 * Track nhập vào mang `source.kind: 'imported'`, khác với track dựng từ transcript
 * hay bản dịch: nó không có segment nguồn để truy ngược, nên phần dựng lại phụ đề
 * phải biết mà không đụng vào.
 */
export function SubtitleImportButton({
  document,
  onImported
}: {
  document: ProjectDocument
  onImported(trackId: string): void
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const setError = useEditorStore((state) => state.setError)
  const [busy, setBusy] = useState(false)

  const importFile = async (): Promise<void> => {
    setBusy(true)
    try {
      const picked = await window.api.subtitle.pickFile()
      if (!picked.ok) {
        setError(picked.error)
        return
      }
      // Người dùng bấm Huỷ: im lặng, không phải lỗi.
      if (!picked.data) return

      const { cues, skipped } = parseSubtitleFile(picked.data.content)
      if (cues.length === 0) {
        setError(t.subtitles.importEmpty)
        return
      }

      const track: SubtitleTrack = {
        id: createId('sub'),
        // Tên file là thứ người dùng nhận ra ngay, hơn hẳn một cái tên tự đặt.
        name: picked.data.name.replace(/\.(srt|vtt)$/i, ''),
        language: '',
        source: { kind: 'imported' },
        style: createDefaultSubtitleStyle(shortEdgeOf(document.settings)),
        cues: cues.map((cue) => ({
          id: createId('cue'),
          startUs: cue.startUs,
          endUs: cue.endUs,
          text: cue.text,
          // Chữ tới từ ngoài, không phải do máy sinh rồi người sửa.
          edited: true
        }))
      }

      const commands: EditorCommand[] = [{ type: 'subtitle/add-track', track }]
      // Dùng lại lane phụ đề còn trống nếu có, đúng lối form tạo track đang làm:
      // hai đường tạo track mà xếp lane khác nhau thì timeline trông tuỳ hứng.
      const freeLane = document.tracks.find(
        (item) => item.kind === 'subtitle' && !item.subtitleTrackId
      )
      commands.push(
        freeLane
          ? { type: 'track/update', trackId: freeLane.id, patch: { subtitleTrackId: track.id } }
          : { type: 'track/add', kind: 'subtitle', name: track.name, subtitleTrackId: track.id }
      )

      if (!run(commands, t.subtitles.importFile)) return
      // Nói ra số khối phải bỏ: file tải trên mạng hay có vài khối lỗi, và im
      // lặng bỏ thì người dùng đếm thiếu câu mà không hiểu vì sao.
      if (skipped > 0) setError(interpolate(t.subtitles.importSkipped, { count: skipped }))
      onImported(track.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolButton
      label={t.subtitles.importFile}
      variant="outline"
      disabled={busy}
      onClick={() => void importFile()}
    />
  )
}
