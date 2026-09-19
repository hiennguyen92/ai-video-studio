import type { JSX } from 'react'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'
import { SliderRow } from './inspector-slider-row'
import { useKeyframeField } from './use-keyframe-field'
import { ClipVoiceCleanupControl } from './clip-voice-cleanup-control'

/**
 * Fade tính bằng giây, hai chữ số lẻ: fade dài tối đa 5 s, nên mã thời gian đầy
 * đủ "00:00:00.000" chỉ tốn chỗ và ép thanh trượt còn một mẩu.
 */
const formatFadeSeconds = (us: number): string => `${(us / 1_000_000).toFixed(2)} s`

/** Tab Audio: âm lượng và fade vào/ra của clip. */
export function ClipAudioSection({
  clip,
  onUpdate
}: {
  clip: Clip
  onUpdate(patch: { volume?: number; fadeInUs?: number; fadeOutUs?: number }, label: string): void
}): JSX.Element {
  const t = useT()
  const maxFadeUs = Math.min(clip.durationUs, 5_000_000)
  const volumeKeyframe = useKeyframeField(
    { kind: 'clip', clipId: clip.id },
    ['volume'],
    t.inspector.volume
  )
  // Mức to NHẤT mà clip từng đạt tới, kể cả ở mốc đầu phát đang không đứng: lời
  // nhắc bên dưới nói về bản xem trước, mà bản xem trước chạy qua CẢ clip.
  const peakVolume = Math.max(
    clip.volume,
    ...(clip.keyframes?.['volume']?.map((frame) => frame.v) ?? [])
  )
  return (
    <>
      <p className="field-group__title">{t.inspector.volume}</p>
      <SliderRow
        label={t.inspector.volume}
        value={clip.volume}
        min={0}
        max={2}
        step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onCommit={(value) => onUpdate({ volume: value }, t.inspector.volume)}
        keyframe={volumeKeyframe}
      />
      {/*
        Trên 100% thì BẢN XEM TRƯỚC không to thêm được, còn file xuất ra thì có.

        Không phải lỗi sửa được bằng một dòng: thẻ media của trình duyệt chỉ nhận
        âm lượng trong khoảng 0..1, muốn to hơn phải dựng cả một đồ thị WebAudio
        cho lớp phát. Nói thẳng ra rẻ hơn nhiều so với để người dùng kéo lên 150%,
        nghe không thấy khác, rồi chỉ phát hiện khi đã xuất file.
      */}
      {peakVolume > 1 && <p className="inspector__hint">{t.inspector.volumeAbovePreviewCap}</p>}
      <SliderRow
        label={t.inspector.fadeIn}
        value={clip.fadeInUs}
        min={0}
        max={maxFadeUs}
        step={10_000}
        format={formatFadeSeconds}
        onCommit={(value) => onUpdate({ fadeInUs: Math.round(value) }, t.inspector.fadeIn)}
      />
      <SliderRow
        label={t.inspector.fadeOut}
        value={clip.fadeOutUs}
        min={0}
        max={maxFadeUs}
        step={10_000}
        format={formatFadeSeconds}
        onCommit={(value) => onUpdate({ fadeOutUs: Math.round(value) }, t.inspector.fadeOut)}
      />
      <ClipVoiceCleanupControl clipId={clip.id} />
    </>
  )
}
