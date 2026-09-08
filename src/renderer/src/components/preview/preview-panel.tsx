import { useCallback, type JSX } from 'react'
import { formatTimecode, frameDurationUs } from '../../../../shared/domain/time-units'
import { selectDocument, selectDurationUs, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { ToolButton } from '../ui/tool-button'
import { IconPause, IconPlay, IconStepBack, IconStepForward } from '../ui/icons'
import { RemotionPreviewStage } from './remotion-preview-stage'
import './preview-panel.css'

/**
 * Panel giữa — xem trước.
 *
 * Khung hình do `RemotionPreviewStage` vẽ, bằng ĐÚNG composition mà lúc xuất file
 * dùng. Panel này chỉ còn lo khung viền, thanh điều khiển và các trạng thái rỗng.
 */

export function PreviewPanel(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const isPlaying = useEditorStore((state) => state.isPlaying)
  const setPlaying = useEditorStore((state) => state.setPlaying)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const durationUs = useEditorStore(selectDurationUs)

  const frameStepUs = document ? frameDurationUs(document.settings.frameRate) : 33333

  const stepFrames = useCallback(
    (direction: -1 | 1) => {
      setPlaying(false)
      setPlayhead(playheadUs + direction * frameStepUs)
    },
    [playheadUs, frameStepUs, setPlaying, setPlayhead]
  )

  if (!document) {
    return (
      <section className="panel">
        <div className="panel__header">{t.preview.title}</div>
        <div className="panel__body">
          <EmptyState title={t.app.loading} hint={t.preview.emptyHint} />
        </div>
      </section>
    )
  }

  const { settings } = document
  const hasContent = durationUs > 0

  return (
    <section className="panel preview" aria-label={t.preview.title}>
      <div className="panel__header">
        {t.preview.title}
        <span className="preview__aspect" title={t.preview.aspectRatio}>
          {settings.aspectRatio} · {settings.width}×{settings.height}
        </span>
      </div>

      <div className="preview__stage-wrap">
        {!hasContent && <EmptyState title={t.preview.empty} hint={t.preview.emptyHint} />}

        {hasContent && (
          <div
            className="preview__stage"
            style={{
              aspectRatio: `${settings.width} / ${settings.height}`,
              backgroundColor: settings.backgroundColor
            }}
          >
            <RemotionPreviewStage document={document} />
          </div>
        )}
      </div>

      <div className="preview__transport">
        <ToolButton
          label={t.preview.previousFrame}
          icon={<IconStepBack />}
          iconOnly
          onClick={() => stepFrames(-1)}
          disabled={!hasContent}
        />
        <ToolButton
          label={isPlaying ? t.preview.pause : t.preview.play}
          icon={isPlaying ? <IconPause /> : <IconPlay />}
          iconOnly
          variant="outline"
          onClick={() => setPlaying(!isPlaying)}
          disabled={!hasContent}
        />
        <ToolButton
          label={t.preview.nextFrame}
          icon={<IconStepForward />}
          iconOnly
          onClick={() => stepFrames(1)}
          disabled={!hasContent}
        />

        <span className="preview__timecode">
          {formatTimecode(playheadUs, settings.frameRate)}
          <span className="preview__timecode-total">
            {' / '}
            {formatTimecode(durationUs, settings.frameRate)}
          </span>
        </span>
      </div>
    </section>
  )
}
