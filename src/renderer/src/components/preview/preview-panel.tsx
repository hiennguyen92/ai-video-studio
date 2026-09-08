import { useCallback, useMemo, type JSX } from 'react'
import { resolveCompositionAt } from '../../../../shared/domain/composition-resolver'
import { formatTimecode, frameDurationUs } from '../../../../shared/domain/time-units'
import { mediaFileUrl } from '../../../../shared/ipc/ipc-contract'
import { selectDocument, selectDurationUs, useEditorStore } from '../../state/editor-store'
import { usePlaybackEngine } from '../../playback/use-playback-engine'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { ToolButton } from '../ui/tool-button'
import { IconPause, IconPlay, IconStepBack, IconStepForward } from '../ui/icons'
import { SubtitleOverlay } from './subtitle-overlay'
import './preview-panel.css'

/**
 * Panel giữa — xem trước.
 *
 * Khung hình được ghép bằng các thẻ <video> xếp lớp thay vì vẽ lên canvas: giữ
 * được tăng tốc phần cứng khi giải mã, và đây cũng là cách duy nhất phát mượt
 * nhiều clip cùng lúc mà không tự viết bộ giải mã.
 */

export function PreviewPanel(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const isPlaying = useEditorStore((state) => state.isPlaying)
  const setPlaying = useEditorStore((state) => state.setPlaying)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const durationUs = useEditorStore(selectDurationUs)

  const registry = usePlaybackEngine(document)

  const frame = useMemo(
    () => (document ? resolveCompositionAt(document, playheadUs) : null),
    [document, playheadUs]
  )

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
            {frame?.video.map((layer) => {
              const asset = document.assets.find((item) => item.id === layer.assetId)
              if (!asset || asset.missing) return null

              const { transform } = layer
              const style = {
                opacity: layer.opacity,
                transform: `translate(${transform.x * 100}%, ${transform.y * 100}%) scale(${transform.scale}) rotate(${transform.rotationDeg}deg)`
              }

              // Ảnh không có dòng thời gian nên dùng <img>; video mới cần <video> để seek.
              return asset.kind === 'image' ? (
                <img
                  key={layer.clip.id}
                  className="preview__layer"
                  style={style}
                  src={mediaFileUrl(asset.source.path)}
                  alt=""
                  draggable={false}
                />
              ) : (
                <video
                  key={layer.clip.id}
                  className="preview__layer"
                  style={style}
                  ref={(element) => registry.set(layer.clip.id, element)}
                  src={mediaFileUrl(asset.source.path)}
                  // Tiếng của video đi theo track audio riêng, không phát từ lớp hình.
                  muted
                  playsInline
                  preload="auto"
                />
              )
            })}

            {frame && <SubtitleOverlay entries={frame.subtitles} stageHeight={settings.height} />}
          </div>
        )}

        {/* Clip audio không hiện hình nhưng vẫn cần một phần tử thật để phát tiếng. */}
        <div className="preview__audio-pool" aria-hidden="true">
          {frame?.audio.map((layer) => {
            const asset = document.assets.find((item) => item.id === layer.assetId)
            if (!asset || asset.missing) return null
            return (
              <audio
                key={layer.clip.id}
                ref={(element) => registry.set(layer.clip.id, element)}
                src={mediaFileUrl(asset.source.path)}
                preload="auto"
              />
            )
          })}
        </div>
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
