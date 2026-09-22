import type { JSX } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'
import { ClipAnimationSection } from './clip-animation-section'
import type { FrameRate } from '../../../../shared/domain/time-units'
import { ClipAudioSection } from './clip-audio-section'
import { ClipBasicSection } from './clip-basic-section'
import { clipInspectorTabs, type ClipInspectorTab } from './clip-inspector-tab-list'
import { ClipVideoSection } from './clip-video-section'
import { PanelSubtabs } from '../ui/panel-subtabs'

const TAB_LABEL_KEYS = {
  basic: 'tabBasic',
  video: 'tabVideo',
  audio: 'tabAudio',
  animation: 'tabAnimation'
} as const satisfies Record<ClipInspectorTab, string>

type ClipUpdatePatch = Extract<EditorCommand, { type: 'clip/update' }>['patch']

/**
 * Thuộc tính của clip đang chọn, chia tab con Basic / Video / Audio / Animation.
 *
 * Tab đang mở do panel cha giữ, để chọn sang clip khác vẫn ở đúng tab đó — đang chỉnh
 * màu hàng loạt clip mà mỗi lần chọn lại bật về Basic là phải bấm lại mãi. Tab
 * không có với loại clip này (ảnh không có Audio) thì hiện tab Basic.
 */
export function ClipInspector({
  clip,
  track,
  asset,
  frameRate,
  tab,
  onTabChange,
  run
}: {
  clip: Clip
  track: Track
  asset: MediaAsset | undefined
  frameRate: FrameRate
  tab: ClipInspectorTab
  onTabChange(tab: ClipInspectorTab): void
  run(commands: EditorCommand[], label: string): void
}): JSX.Element {
  const t = useT()
  const tabs = clipInspectorTabs(track.kind)
  const active = tabs.includes(tab) ? tab : 'basic'
  const update = (patch: ClipUpdatePatch, label: string): void => {
    run([{ type: 'clip/update', clipId: clip.id, patch }], label)
  }

  return (
    <div className="inspector">
      <PanelSubtabs<ClipInspectorTab>
        label={t.inspector.clip}
        active={active}
        onChange={onTabChange}
        tabs={tabs.map((key) => ({ key, label: t.inspector[TAB_LABEL_KEYS[key]] }))}
      />

      <div role="tabpanel" aria-label={t.inspector[TAB_LABEL_KEYS[active]]}>
        {active === 'basic' && <ClipBasicSection clip={clip} track={track} asset={asset} />}
        {active === 'video' && (
          <ClipVideoSection
            clip={clip}
            run={run}
            onTransform={(transform, label) => update({ transform }, label)}
          />
        )}
        {active === 'audio' && <ClipAudioSection clip={clip} onUpdate={update} />}
        {active === 'animation' && (
          <ClipAnimationSection clip={clip} track={track} frameRate={frameRate} run={run} />
        )}
      </div>
    </div>
  )
}
