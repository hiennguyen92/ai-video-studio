import type { ClipMotionKind } from '../../../../shared/domain/clip-motion-types'
import type { TransitionKind } from '../../../../shared/domain/timeline-track-types'
import type { Dictionary } from '../../i18n/dictionary-vi'

/**
 * Khoá nhãn của từng kiểu chuyển cảnh và chuyển động.
 *
 * Dùng chung cho ô chọn trong Inspector và thẻ trong tab Library: hai nơi cùng
 * nói về một thứ thì phải gọi nó bằng cùng một tên.
 */

type InspectorKey = keyof Dictionary['inspector']

export const TRANSITION_LABEL_KEYS: Record<TransitionKind, InspectorKey> = {
  fade: 'transitionFade',
  'slide-left': 'transitionSlideLeft',
  'slide-right': 'transitionSlideRight',
  'slide-up': 'transitionSlideUp',
  'slide-down': 'transitionSlideDown',
  'wipe-left': 'transitionWipeLeft',
  'wipe-right': 'transitionWipeRight',
  zoom: 'transitionZoom',
  'whip-left': 'transitionWhipLeft',
  'whip-right': 'transitionWhipRight',
  blur: 'transitionBlur',
  glitch: 'transitionGlitch',
  spin: 'transitionSpin',
  flash: 'transitionFlash',
  'soft-wipe-left': 'transitionSoftWipeLeft',
  'soft-wipe-right': 'transitionSoftWipeRight',
  'circle-open': 'transitionCircleOpen',
  'line-wipe': 'transitionLineWipe',
  'dip-to-black': 'transitionDipToBlack',
  impact: 'transitionImpact',
  'punch-zoom': 'transitionPunchZoom',
  'rack-focus': 'transitionRackFocus',
  'luma-blend': 'transitionLumaBlend',
  'whip-up': 'transitionWhipUp',
  'whip-down': 'transitionWhipDown',
  'page-curl': 'transitionPageCurl',
  'organic-dissolve': 'transitionOrganicDissolve',
  'radial-blur': 'transitionRadialBlur'
}

export const MOTION_LABEL_KEYS: Record<ClipMotionKind, InspectorKey> = {
  'zoom-in': 'motionZoomIn',
  'zoom-out': 'motionZoomOut',
  'pan-left': 'motionPanLeft',
  'pan-right': 'motionPanRight',
  'pan-up': 'motionPanUp',
  'pan-down': 'motionPanDown',
  'punch-in': 'motionPunchIn',
  shake: 'motionShake'
}
