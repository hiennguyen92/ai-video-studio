import {
  ALL_EFFECTS_TAG_KEY,
  clipAppliedTags,
  type ClipAppliedTag
} from '../../../../shared/domain/clip-applied-tags'
import { findClipEffect } from '../../../../shared/domain/clip-effect-catalog'
import { findClipLook } from '../../../../shared/domain/clip-look-catalog'
import type { ClipMotionKind } from '../../../../shared/domain/clip-motion-types'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useLocale } from '../../i18n/use-translation'
import { MOTION_LABEL_KEYS } from '../library/clip-effect-labels'

/**
 * Nhãn đã tra tên theo ngôn ngữ: `text` hiện trên nhãn, `full` kèm loại cho tooltip.
 * `collapseEffects` gom nhiều loại effect thành "Effect ×N" (xem `clipAppliedTags`).
 */
export function useClipTagDescriptions(
  clip: Clip,
  options: { collapseEffects?: boolean } = {}
): Array<{ tag: ClipAppliedTag; text: string; full: string }> {
  const { t, locale } = useLocale()
  const tags = clipAppliedTags(clip, options)

  const nameOf = (tag: ClipAppliedTag): string => {
    if (tag.category === 'lut') {
      const look = findClipLook(tag.key)
      return look ? (locale === 'en' ? look.nameEn : look.nameVi) : tag.key
    }
    if (tag.category === 'zoom') {
      const key = MOTION_LABEL_KEYS[tag.key as ClipMotionKind]
      return key ? t.inspector[key] : tag.key
    }
    if (tag.key === ALL_EFFECTS_TAG_KEY) return t.timeline.effectsTag
    const effect = findClipEffect(tag.key)
    return effect ? (locale === 'en' ? effect.nameEn : effect.nameVi) : tag.key
  }
  const categoryOf = (tag: ClipAppliedTag): string =>
    tag.category === 'lut'
      ? t.library.tabs.lut
      : tag.category === 'zoom'
        ? t.library.tabs.zoom
        : t.library.tabs.effects

  return tags.map((tag) => {
    const count = tag.count > 1 ? ` ×${tag.count}` : ''
    return {
      tag,
      text: `${nameOf(tag)}${count}`,
      full:
        tag.key === ALL_EFFECTS_TAG_KEY
          ? `${nameOf(tag)}${count}`
          : `${categoryOf(tag)}: ${nameOf(tag)}${count}`
    }
  })
}
