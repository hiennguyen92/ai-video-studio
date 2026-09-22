import { Composition, registerRoot } from 'remotion'
import { ProjectComposition, type ProjectCompositionProps } from './project-composition'
import { frameRateToNumber } from '../shared/domain/time-units'

/**
 * Điểm vào cho `@remotion/bundler` khi xuất file.
 *
 * Kích thước và nhịp hình KHÔNG được đặt cứng ở đây — chúng lấy từ chính bản dựng
 * qua `calculateMetadata`. Đặt cứng thì một dự án dọc 9:16 sẽ bị xuất ra khung
 * ngang, và lỗi đó chỉ lộ ra khi đã xem lại file.
 *
 * Preview không đi qua file này: renderer nhúng thẳng `ProjectComposition` vào
 * `@remotion/player`. Vẫn là một component, hai nơi dùng.
 */

const EMPTY_PROPS: ProjectCompositionProps = {
  plan: {
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
    durationInFrames: 1,
    backgroundColor: '#000000',
    video: [],
    glTransitions: [],
    audio: [],
    subtitles: [],
    textOverlays: []
  },
  mediaUrls: {}
}

registerRoot(() => (
  <Composition
    id="project"
    component={ProjectComposition}
    defaultProps={EMPTY_PROPS}
    calculateMetadata={({ props }) => ({
      width: props.plan.width,
      height: props.plan.height,
      fps: frameRateToNumber(props.plan.fps),
      durationInFrames: props.plan.durationInFrames
    })}
    // Bắt buộc phải có giá trị ban đầu, nhưng calculateMetadata ghi đè hết.
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
  />
))
