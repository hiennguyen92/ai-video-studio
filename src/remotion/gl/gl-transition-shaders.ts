/**
 * Sổ đăng ký shader chuyển cảnh: kiểu → mã GLSL + uniform mặc định.
 *
 * Giá trị mặc định lấy theo `src/gl/transitions.ts` của OpenChatCut
 * (AGPL-3.0-or-later) — xem `NOTICE`.
 *
 * Chỉ có ở đây những kiểu CSS KHÔNG làm nổi: cả ba đều lấy mẫu lại toạ độ của hai
 * luồng hình. Kiểu nào CSS làm được thì nằm ở `clip-transition-cinematic.ts`, rẻ
 * hơn hẳn vì không tốn context WebGL nào.
 *
 * Nhúng GLSL thẳng vào TypeScript chứ không nạp bằng `?raw`: bản xem trước đi qua
 * electron-vite còn bản xuất đi qua bundler của Remotion, hai bộ đóng gói khác
 * nhau, mà một chuỗi trong mã nguồn thì bộ nào cũng hiểu.
 */

import type { GlTransitionKind } from '../../shared/domain/clip-transition-gl'
import type { UniformValue } from './gl-transition-runtime'
import { ORGANIC_DISSOLVE_FRAG } from './gl-shader-organic-dissolve'
import { PAGE_CURL_FRAG } from './gl-shader-page-curl'
import { RADIAL_BLUR_FRAG } from './gl-shader-radial-blur'

export interface GlTransitionShader {
  frag: string
  /** Uniform riêng của kiểu, ngoài `u_progress` / `u_resolution` / `u_aspect`. */
  uniforms(context: { time: number; aspect: number }): Record<string, UniformValue>
}

export const GL_TRANSITION_SHADERS: Record<GlTransitionKind, GlTransitionShader> = {
  'page-curl': {
    frag: PAGE_CURL_FRAG,
    uniforms: () => ({
      u_radius: 0.12,
      u_glossiness: 0.6,
      // Mặt sau của trang: trắng ngà chứ không trắng tinh — trắng tinh trông như
      // một mảng khuyết chứ không như tờ giấy.
      u_paperTint: [0.97, 0.95, 0.9]
    })
  },
  'organic-dissolve': {
    frag: ORGANIC_DISSOLVE_FRAG,
    uniforms: ({ time, aspect }) => ({
      u_ratio: aspect,
      u_time: time,
      u_glowWidth: 0.05,
      u_depth: 1.8,
      // Mép cháy màu cam.
      u_glowColor: [1.0, 0.55, 0.18]
    })
  },
  'radial-blur': {
    frag: RADIAL_BLUR_FRAG,
    uniforms: () => ({ u_blurStrength: 0.22, u_center: [0.5, 0.5] })
  }
}
