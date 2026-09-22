import { z } from 'zod'
import { MARKER_COLORS } from '../domain/timeline-marker-types'
import type { Clip } from '../domain/timeline-track-types'
import type { MediaAsset } from '../domain/media-asset-types'
import type { Transcript, Translation } from '../domain/transcript-types'
import type { SubtitleCue, SubtitleStyle, SubtitleTrack } from '../domain/subtitle-types'
import { isTransitionKind, type TransitionKind } from '../domain/timeline-track-types'
import type { DubbingSession } from '../domain/transcript-types'
import {
  TEXT_FRAME_PADDING_SCALE_MAX,
  type TextAnimation,
  type TextOverlay
} from '../domain/text-overlay-types'

/**
 * Tập lệnh chỉnh sửa — ĐƯỜNG GHI DUY NHẤT vào project document.
 *
 * Thao tác tay và thao tác của AI dùng CHUNG tập lệnh này. AI không được phép
 * ghi thẳng JSON từ đầu ra văn bản; nó chỉ có thể phát ra các command dưới đây và
 * payload phải qua được schema (DESCRIPTION §5).
 *
 * Mỗi schema ở đây vừa là kiểm tra lúc chạy, vừa là nguồn sinh JSON Schema cho
 * phần mô tả tool của AI, nên hai bên không thể lệch nhau.
 */

const nonNegativeMicros = z.number().int().min(0)
const positiveMicros = z.number().int().positive()
const gainSchema = z.number().min(0).max(2)

export const clipTransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().positive(),
  rotationDeg: z.number(),
  opacity: z.number().min(0).max(1)
})

/** Chủ thể mang keyframe: một clip trên timeline, hoặc một khối chữ overlay. */
export const keyframeTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clip'), clipId: z.string() }),
  z.object({ kind: z.literal('text'), overlayId: z.string() })
])

export const keyframeEasingSchema = z.enum(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'])

export const frameRateSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive()
})

/* ── Lệnh cấp project ──────────────────────────────────────────── */

const setProjectSettings = z.object({
  type: z.literal('project/set-settings'),
  settings: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      frameRate: frameRateSchema,
      aspectRatio: z.enum(['16:9', '9:16', '1:1']),
      sampleRate: z.number().int().positive(),
      backgroundColor: z.string()
    })
    .partial()
})

const renameProject = z.object({
  type: z.literal('project/rename'),
  name: z.string().min(1).max(200)
})

/* ── Lệnh track ────────────────────────────────────────────────── */

const addTrack = z.object({
  type: z.literal('track/add'),
  trackId: z.string().optional(),
  kind: z.enum(['video', 'audio', 'subtitle', 'text', 'image']),
  name: z.string().min(1).max(120),
  role: z.enum(['dialogue', 'voiceover', 'music', 'sfx']).optional(),
  subtitleTrackId: z.string().optional(),
  /** Chèn vào vị trí này; bỏ trống thì thêm vào cuối. */
  index: z.number().int().min(0).optional(),
  /**
   * Chiều cao lane. Bỏ trống thì dùng mặc định.
   *
   * Có mặt ở đây để track thêm sau khớp cỡ lane người dùng đang chọn; thiếu nó
   * thì chọn lane nhỏ xong thêm track mới lại ra một lane cao ngất giữa đám.
   */
  height: z.number().int().min(24).max(200).optional()
})

const removeTrack = z.object({
  type: z.literal('track/remove'),
  trackId: z.string()
})

const reorderTrack = z.object({
  type: z.literal('track/reorder'),
  trackId: z.string(),
  toIndex: z.number().int().min(0)
})

const updateTrack = z.object({
  type: z.literal('track/update'),
  trackId: z.string(),
  patch: z
    .object({
      name: z.string().min(1).max(120),
      hidden: z.boolean(),
      muted: z.boolean(),
      solo: z.boolean(),
      locked: z.boolean(),
      volume: gainSchema,
      height: z.number().int().min(28).max(400),
      role: z.enum(['dialogue', 'voiceover', 'music', 'sfx']),
      /** Gắn lane phụ đề vào một SubtitleTrack; lane không trỏ đâu thì không hiện gì. */
      subtitleTrackId: z.string()
    })
    .partial()
})

/* ── Lệnh clip ─────────────────────────────────────────────────── */

const insertClip = z.object({
  type: z.literal('clip/insert'),
  clipId: z.string().optional(),
  trackId: z.string(),
  assetId: z.string(),
  startUs: nonNegativeMicros,
  durationUs: positiveMicros,
  sourceInUs: nonNegativeMicros.default(0),
  label: z.string().max(200).optional(),
  linkGroupId: z.string().optional()
})

/**
 * Dán một clip đã chép vào track, giữ NGUYÊN mọi thuộc tính của nó.
 *
 * Không dùng `clip/insert` được: lệnh đó dựng một clip mới với giá trị mặc
 * định, nên dán bằng nó là mất sạch âm lượng, fade, tốc độ, transform, effect
 * và keyframe — đúng những thứ người dùng chép clip vì muốn giữ.
 *
 * Payload đi qua `z.custom` như `subtitle/set-style` và `text/set-style`: hình
 * dạng đầy đủ của một clip quá lớn để tả lại bằng zod mà không trôi khỏi kiểu
 * gốc. Bù lại, reducer KHÔNG tin payload — nó dựng lại clip từ danh sách trường
 * đã biết và kẹp từng con số.
 */
const pasteClip = z.object({
  type: z.literal('clip/paste'),
  trackId: z.string(),
  /** Id cho bản dán; bỏ trống thì reducer tự sinh. */
  clipId: z.string().optional(),
  startUs: nonNegativeMicros,
  clip: z.custom<Clip>((value) => Boolean(value) && typeof value === 'object', {
    message: 'clip không hợp lệ'
  })
})

const removeClip = z.object({
  type: z.literal('clip/remove'),
  clipId: z.string()
})

const moveClip = z.object({
  type: z.literal('clip/move'),
  clipId: z.string(),
  /** Track đích; bỏ trống nghĩa là giữ nguyên track. */
  toTrackId: z.string().optional(),
  toStartUs: nonNegativeMicros
})

/**
 * Dời nhiều clip trong MỘT bước.
 *
 * Không ghép từ nhiều `clip/move` được: track đặt clip theo kiểu ghi đè, nên dời
 * clip A vào chỗ cũ của clip B khi B chưa kịp dời là B bị cắt mất một đoạn. Lệnh
 * này nhấc HẾT clip ra trước rồi mới đặt lại.
 */
const moveClips = z.object({
  type: z.literal('clip/move-many'),
  moves: z
    .array(
      z.object({
        clipId: z.string(),
        toTrackId: z.string().optional(),
        toStartUs: nonNegativeMicros
      })
    )
    .min(1)
    .max(500)
})

/** Đưa các clip vào một nhóm (`linkGroupId`), hoặc rã nhóm khi truyền `null`. */
const setClipLinkGroup = z.object({
  type: z.literal('clip/set-link-group'),
  clipIds: z.array(z.string()).min(1).max(500),
  linkGroupId: z.string().min(1).max(120).nullable()
})

/**
 * Cắt gọn một mép clip. Dùng giá trị TUYỆT ĐỐI chứ không dùng delta, để lệnh
 * mang tính idempotent và AI không phải tự cộng trừ.
 */
const trimClip = z.object({
  type: z.literal('clip/trim'),
  clipId: z.string(),
  edge: z.enum(['start', 'end']),
  /** Vị trí mới của mép đó trên timeline. */
  toUs: nonNegativeMicros
})

/**
 * Ripple trim: cắt/kéo dài một mép rồi dời mọi clip phía sau trên cùng track theo
 * lượng độ dài vừa đổi (chế độ Trim của timeline).
 */
const rippleTrimClip = z.object({
  type: z.literal('clip/ripple-trim'),
  clipId: z.string(),
  edge: z.enum(['start', 'end']),
  toUs: z.number().int()
})

/** Slip: đổi điểm vào nguồn, giữ vị trí và độ dài trên timeline. */
const slipClipCommand = z.object({
  type: z.literal('clip/slip'),
  clipId: z.string(),
  toSourceInUs: z.number().int()
})

/** Rate stretch: kéo một mép đổi độ dài, giữ đoạn nguồn, tốc độ tự đổi cho vừa. */
const rateStretchClipCommand = z.object({
  type: z.literal('clip/rate-stretch'),
  clipId: z.string(),
  edge: z.enum(['start', 'end']),
  toUs: z.number().int()
})

/**
 * Cắt bỏ một khoảng thời gian rồi kéo phần sau lùi lên lấp chỗ trống.
 *
 * Áp cho MỌI track theo mặc định để giữ đồng bộ hình–tiếng; chỉ định `trackIds`
 * khi thật sự muốn lệch nhau.
 */
const rippleDelete = z.object({
  type: z.literal('timeline/ripple-delete'),
  fromUs: nonNegativeMicros,
  toUs: nonNegativeMicros,
  trackIds: z.array(z.string()).optional()
})

const splitClip = z.object({
  type: z.literal('clip/split'),
  clipId: z.string(),
  atUs: positiveMicros,
  /** Id gán cho nửa sau; bỏ trống thì tự sinh. */
  newClipId: z.string().optional()
})

const duplicateClip = z.object({
  type: z.literal('clip/duplicate'),
  clipId: z.string(),
  newClipId: z.string().optional()
})

/**
 * Đặt hoặc gỡ hiệu ứng xuất hiện của một clip.
 *
 * Tách khỏi `clip/update` vì nó không phải một thuộc tính hiển thị đơn lẻ: thời
 * lượng chuyển cảnh còn bị kẹp theo phần nguồn còn lại lúc dựng khung hình.
 */
const setClipTransition = z.object({
  type: z.literal('clip/set-transition'),
  clipId: z.string(),
  /**
   * Mép nào của clip. Bỏ trống là mép VÀO, giữ nguyên ý nghĩa cũ của lệnh này
   * nên dự án và lịch sử hoàn tác cũ không đổi nghĩa.
   */
  edge: z.enum(['in', 'out']).optional(),
  /** Bỏ trống nghĩa là gỡ chuyển cảnh. */
  transition: z
    .object({
      // Danh sách kiểu lấy thẳng từ `timeline-track-types`. Bản sao chép tay từng
      // lệch với danh sách thật khi thêm kiểu mới, và cái lệch đó chỉ lộ ra lúc
      // người dùng kéo một thẻ có thật mà lệnh lại từ chối.
      kind: z.custom<TransitionKind>(isTransitionKind, {
        message: 'kiểu chuyển cảnh không hợp lệ'
      }),
      durationUs: positiveMicros
    })
    .optional()
})

/**
 * Đổi tốc độ phát của một clip.
 *
 * Tách khỏi `clip/update` vì nó KHÔNG chỉ ghi một trường: đổi tốc độ thì độ dài
 * clip trên timeline phải đổi theo, và clip dài ra có thể lấn sang clip bên cạnh.
 * `clip/update` chỉ gán thẳng vào clip nên đi qua nó sẽ phá vỡ bất biến "clip
 * trong cùng track không chồng lấn".
 *
 * Khoảng 0,25–4 lần: ffmpeg ghép nhiều tầng `atempo` nên chịu được rộng hơn,
 * nhưng ngoài khoảng này thì tiếng nát tới mức không dùng được.
 */
const setClipSpeed = z.object({
  type: z.literal('clip/set-speed'),
  clipId: z.string(),
  speed: z.number().min(0.25).max(4)
})

/**
 * Đặt hoặc gỡ chuyển động chạy suốt clip.
 *
 * Tách khỏi `clip/update` cùng lý do như chuyển cảnh: `transform` trong đó là một
 * giá trị tĩnh cho cả clip, còn cái này đổi theo từng khung hình.
 */
/**
 * Đặt hoặc gỡ look màu (LUT dựng sẵn) cho clip hình. Chỉ kiểm HÌNH DẠNG: id lạ
 * được lớp dựng kế hoạch hạ về "không look", không làm chết bản xuất.
 */
const setClipLook = z.object({
  type: z.literal('clip/set-look'),
  clipId: z.string(),
  /** Bỏ trống nghĩa là gỡ look. */
  look: z
    .object({
      id: z.string().min(1).max(60),
      intensity: z.number().min(0).max(1)
    })
    .optional()
})

/**
 * Thay CẢ chồng effect của clip hình. Thêm, sửa, gỡ, đổi thứ tự đều đi qua lệnh
 * này, nên mỗi thao tác là đúng một bước hoàn tác. Chỉ kiểm hình dạng: kind lạ và
 * thông số ngoài khoảng được lớp dựng kế hoạch hạ về an toàn.
 */
const setClipEffects = z.object({
  type: z.literal('clip/set-effects'),
  clipId: z.string(),
  effects: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        kind: z.string().min(1).max(60),
        intensity: z.number().min(0).max(1),
        params: z.record(z.string().max(40), z.union([z.number(), z.string().max(40)]))
      })
    )
    .max(16)
})

const setClipMotion = z.object({
  type: z.literal('clip/set-motion'),
  clipId: z.string(),
  /** Bỏ trống nghĩa là gỡ chuyển động. */
  motion: z
    .object({
      kind: z.enum([
        'zoom-in',
        'zoom-out',
        'pan-left',
        'pan-right',
        'pan-up',
        'pan-down',
        'punch-in',
        'shake'
      ]),
      intensity: z.number().min(0).max(1)
    })
    .optional()
})

/**
 * Đặt hoặc gỡ chỉnh màu của một clip.
 *
 * Nhận từng phần: chỉnh riêng độ tương phản không được xoá mất nhiệt độ đã đặt.
 * Bỏ trống cả `grade` nghĩa là trả clip về màu gốc.
 */
const setClipColorGrade = z.object({
  type: z.literal('clip/set-color-grade'),
  clipId: z.string(),
  grade: z
    .object({
      brightness: z.number().min(0.5).max(1.5),
      contrast: z.number().min(0.5).max(1.5),
      saturation: z.number().min(0).max(2),
      temperature: z.number().min(-1).max(1),
      vignette: z.number().min(0).max(1)
    })
    .partial()
    .optional()
})

const updateClip = z.object({
  type: z.literal('clip/update'),
  clipId: z.string(),
  patch: z
    .object({
      volume: gainSchema,
      fadeInUs: nonNegativeMicros,
      fadeOutUs: nonNegativeMicros,
      speed: z.number().min(0.25).max(4),
      label: z.string().max(200),
      transform: clipTransformSchema,
      /** `null` bỏ nền mờ. */
      backgroundFill: z
        .object({ kind: z.literal('blur'), amount: z.number().min(0).max(1) })
        .nullable()
    })
    .partial()
})

/* ── Lệnh asset ────────────────────────────────────────────────── */

/**
 * Asset được TIẾN TRÌNH MAIN dựng sẵn (sau khi probe/hash/sinh thumbnail) rồi mới
 * gửi sang, nên ở đây chỉ cần kiểm tra hình dạng tối thiểu thay vì lặp lại toàn bộ
 * schema của `MediaAsset`. AI không phát ra lệnh này — nó tạo media qua job, và
 * job mới là nơi gọi `asset/add`.
 */
const mediaAssetShape = z.custom<MediaAsset>(
  (value) => {
    if (!value || typeof value !== 'object') return false
    const asset = value as Partial<MediaAsset>
    return (
      typeof asset.id === 'string' &&
      typeof asset.name === 'string' &&
      (asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'image') &&
      typeof asset.source?.path === 'string' &&
      typeof asset.probe?.durationUs === 'number'
    )
  },
  { message: 'media asset không hợp lệ' }
)

const addAsset = z.object({
  type: z.literal('asset/add'),
  asset: mediaAssetShape
})

const relinkAsset = z.object({
  type: z.literal('asset/relink'),
  asset: mediaAssetShape
})

const removeAsset = z.object({
  type: z.literal('asset/remove'),
  assetId: z.string(),
  /** Xoá luôn các clip đang dùng asset này. Mặc định false: từ chối nếu đang dùng. */
  removeUsages: z.boolean().default(false)
})

const updateAssetTags = z.object({
  type: z.literal('asset/set-tags'),
  assetId: z.string(),
  tags: z.array(z.string().max(60)).max(30)
})

/* ── Lệnh transcript ───────────────────────────────────────────── */

/**
 * Transcript do engine nhận dạng sinh ra nên được kiểm tra hình dạng tối thiểu,
 * giống cách `asset/add` làm: dữ liệu đã qua adapter và parser rồi mới tới đây.
 */
const transcriptShape = z.custom<Transcript>(
  (value) => {
    if (!value || typeof value !== 'object') return false
    const transcript = value as Partial<Transcript>
    return (
      typeof transcript.id === 'string' &&
      typeof transcript.assetId === 'string' &&
      Array.isArray(transcript.segments)
    )
  },
  { message: 'transcript không hợp lệ' }
)

const addTranscript = z.object({
  type: z.literal('transcript/add'),
  transcript: transcriptShape
})

const removeTranscript = z.object({
  type: z.literal('transcript/remove'),
  transcriptId: z.string()
})

const updateTranscriptSegment = z.object({
  type: z.literal('transcript/update-segment'),
  transcriptId: z.string(),
  segmentId: z.string(),
  text: z.string().max(5000)
})

/** Gộp hai đoạn liền nhau — hay dùng khi engine cắt giữa câu. */
const mergeTranscriptSegments = z.object({
  type: z.literal('transcript/merge-segments'),
  transcriptId: z.string(),
  segmentId: z.string()
})

/* ── Lệnh bản dịch ─────────────────────────────────────────────── */

const translationShape = z.custom<Translation>(
  (value) => {
    if (!value || typeof value !== 'object') return false
    const translation = value as Partial<Translation>
    return (
      typeof translation.id === 'string' &&
      typeof translation.transcriptId === 'string' &&
      typeof translation.targetLanguage === 'string' &&
      Array.isArray(translation.segments)
    )
  },
  { message: 'bản dịch không hợp lệ' }
)

const addTranslation = z.object({
  type: z.literal('translation/add'),
  translation: translationShape
})

const removeTranslation = z.object({
  type: z.literal('translation/remove'),
  translationId: z.string()
})

const updateTranslationSegment = z.object({
  type: z.literal('translation/update-segment'),
  translationId: z.string(),
  segmentId: z.string(),
  text: z.string().max(5000)
})

/**
 * Sửa glossary của một bản dịch.
 *
 * Thay cả danh sách thay vì thêm/xoá từng mục: glossary luôn được sửa nguyên
 * bảng trên giao diện, và thay cả cụm giữ cho một lần hoàn tác đúng bằng một
 * lần chỉnh sửa của người dùng.
 */
const setTranslationGlossary = z.object({
  type: z.literal('translation/set-glossary'),
  translationId: z.string(),
  glossary: z.array(z.object({ from: z.string().max(200), to: z.string().max(200) })).max(200)
})

/* ── Lệnh phụ đề ───────────────────────────────────────────────── */

const subtitleTrackShape = z.custom<SubtitleTrack>(
  (value) => {
    if (!value || typeof value !== 'object') return false
    const track = value as Partial<SubtitleTrack>
    return (
      typeof track.id === 'string' && Array.isArray(track.cues) && typeof track.style === 'object'
    )
  },
  { message: 'track phụ đề không hợp lệ' }
)

const addSubtitleTrack = z.object({
  type: z.literal('subtitle/add-track'),
  track: subtitleTrackShape
})

const removeSubtitleTrack = z.object({
  type: z.literal('subtitle/remove-track'),
  trackId: z.string()
})

const renameSubtitleTrack = z.object({
  type: z.literal('subtitle/rename-track'),
  trackId: z.string(),
  name: z.string().min(1).max(120)
})

/** Thay cả bảng style; giao diện luôn sửa style theo cụm nên hoàn tác cũng theo cụm. */
const setSubtitleStyle = z.object({
  type: z.literal('subtitle/set-style'),
  trackId: z.string(),
  style: z.custom<SubtitleStyle>((value) => Boolean(value) && typeof value === 'object', {
    message: 'style phụ đề không hợp lệ'
  })
})

const updateSubtitleCue = z.object({
  type: z.literal('subtitle/update-cue'),
  trackId: z.string(),
  cueId: z.string(),
  text: z.string().max(5000).optional(),
  textSecondary: z.string().max(5000).optional(),
  startUs: z.number().int().min(0).optional(),
  endUs: z.number().int().min(0).optional()
})

/**
 * Dời một cue sang track phụ đề khác.
 *
 * Phải là MỘT lệnh chứ không phải xoá-rồi-thêm: hai lệnh rời thì một bước hoàn
 * tác chỉ trả lại được nửa việc, và giữa hai lệnh có một khoảnh khắc cue không
 * tồn tại ở đâu cả.
 */
const moveSubtitleCue = z.object({
  type: z.literal('subtitle/move-cue'),
  fromTrackId: z.string(),
  toTrackId: z.string(),
  cueId: z.string(),
  startUs: z.number().int().min(0).optional(),
  endUs: z.number().int().min(0).optional()
})

const removeSubtitleCue = z.object({
  type: z.literal('subtitle/remove-cue'),
  trackId: z.string(),
  cueId: z.string()
})

/** Dựng lại toàn bộ cue từ transcript/bản dịch — thay hẳn danh sách cũ. */
const replaceSubtitleCues = z.object({
  type: z.literal('subtitle/replace-cues'),
  trackId: z.string(),
  cues: z.array(
    z.custom<SubtitleCue>((value) => Boolean(value) && typeof value === 'object', {
      message: 'cue không hợp lệ'
    })
  )
})

/* ── Lệnh lồng tiếng ───────────────────────────────────────────── */

const dubbingSessionShape = z.custom<DubbingSession>(
  (value) => {
    if (!value || typeof value !== 'object') return false
    const session = value as Partial<DubbingSession>
    return (
      typeof session.id === 'string' &&
      typeof session.sourceId === 'string' &&
      Array.isArray(session.segments)
    )
  },
  { message: 'phiên lồng tiếng không hợp lệ' }
)

const addDubbingSession = z.object({
  type: z.literal('dubbing/add-session'),
  session: dubbingSessionShape
})

const removeDubbingSession = z.object({
  type: z.literal('dubbing/remove-session'),
  sessionId: z.string()
})

/**
 * Ghi kết quả đã tạo cho một đoạn.
 *
 * `generatedDurationUs` là thời lượng ĐO ĐƯỢC của file audio, không phải ước
 * lượng — mọi tính toán tràn giờ đều dựa vào con số này.
 */
const updateDubbingSegment = z.object({
  type: z.literal('dubbing/update-segment'),
  sessionId: z.string(),
  segmentId: z.string(),
  assetId: z.string().optional(),
  generatedDurationUs: z.number().int().min(0).optional(),
  status: z.enum(['pending', 'generating', 'ready', 'failed']).optional(),
  error: z.string().max(1000).optional()
})

/** Hướng xử lý khi audio dài hơn khoảng gốc. Không có lựa chọn cắt bớt lời. */
const setDubbingOverflowStrategy = z.object({
  type: z.literal('dubbing/set-overflow-strategy'),
  sessionId: z.string(),
  segmentId: z.string(),
  strategy: z.enum(['speed-up', 'shorten-text', 'extend-timeline']).optional()
})

/* ── Lệnh chữ overlay ──────────────────────────────────────────── */

const textAnimationSchema = z.custom<TextAnimation>(
  (value) =>
    typeof value === 'string' && ['none', 'fade', 'pop', 'slide-up', 'typewriter'].includes(value),
  { message: 'hiệu ứng chữ không hợp lệ' }
)

const textOverlayShape = z.custom<TextOverlay>(
  (value) => {
    if (!value || typeof value !== 'object') return false
    const overlay = value as Partial<TextOverlay>
    return (
      typeof overlay.id === 'string' &&
      typeof overlay.text === 'string' &&
      typeof overlay.startUs === 'number' &&
      typeof overlay.endUs === 'number' &&
      typeof overlay.style === 'object'
    )
  },
  { message: 'chữ overlay không hợp lệ' }
)

const addTextOverlay = z.object({
  type: z.literal('text/add'),
  overlay: textOverlayShape
})

const removeTextOverlay = z.object({
  type: z.literal('text/remove'),
  overlayId: z.string()
})

/**
 * Khung nền chữ trong lệnh. Chỉ kiểm HÌNH DẠNG ở đây, không kiểm id có thật hay
 * không: id lạ đã được hạ về "không khung" ở tầng dựng kế hoạch, nên nó làm mất
 * cái khung chứ không làm chết bản xuất.
 */
const textOverlayFrameSchema = z.object({
  styleId: z.string(),
  paletteId: z.string().optional(),
  decorId: z.string().optional(),
  paddingScaleX: z.number().min(0).max(TEXT_FRAME_PADDING_SCALE_MAX).optional(),
  paddingScaleY: z.number().min(0).max(TEXT_FRAME_PADDING_SCALE_MAX).optional()
})

const updateTextOverlay = z.object({
  type: z.literal('text/update'),
  overlayId: z.string(),
  /** Lane chữ mới. Bỏ trống nghĩa là giữ nguyên lane đang có. */
  trackId: z.string().optional(),
  text: z.string().max(500).optional(),
  startUs: nonNegativeMicros.optional(),
  endUs: nonNegativeMicros.optional(),
  animation: textAnimationSchema.optional(),
  animationDurationUs: nonNegativeMicros.optional(),
  exitAnimation: z.enum(['none', 'fade', 'shrink', 'slide-down']).optional(),
  glow: z.boolean().optional(),
  /**
   * Khung nền, BA trạng thái chứ không phải hai.
   *
   * `undefined` = giữ nguyên khung đang có · đối tượng = đặt/đổi · `null` = BỎ
   * khung. Phải có `null` vì `undefined` đã mang nghĩa "giữ nguyên" — thiếu nó
   * thì không có cách nào diễn đạt "bỏ khung đi", và nút tắt khung sẽ không tắt
   * được. Khác `glow`: boolean không cần trạng thái xoá vì `false` đã là tắt.
   */
  frame: z.union([textOverlayFrameSchema, z.null()]).optional()
})

/** Thay cả bảng style; giao diện luôn sửa theo cụm nên hoàn tác cũng theo cụm. */
const setTextOverlayStyle = z.object({
  type: z.literal('text/set-style'),
  overlayId: z.string(),
  style: z.custom<SubtitleStyle>((value) => Boolean(value) && typeof value === 'object', {
    message: 'style chữ không hợp lệ'
  })
})

/**
 * Đặt hoặc ghi đè một keyframe.
 *
 * `atUs` là offset TỪ MÉP ĐẦU chủ thể, không phải giờ trên timeline: chỗ gọi
 * chịu trách nhiệm trừ `clip.startUs`. Để lệnh tự đoán thì cùng một lệnh gửi từ
 * nút kim cương và gửi từ agent sẽ mang hai nghĩa khác nhau.
 *
 * `path` được đối chiếu với danh mục thuộc tính lúc chạy (`keyframe-property-catalog`),
 * nên đường dẫn bịa ra bị từ chối chứ không lặng lẽ tạo một khoá rác.
 */
const setKeyframe = z.object({
  type: z.literal('keyframe/set'),
  target: keyframeTargetSchema,
  path: z.string().min(1).max(120),
  atUs: z.number().int().min(0),
  value: z.number(),
  easing: keyframeEasingSchema.optional()
})

/**
 * Thay CẢ đường keyframe của từng khoá được nêu — dùng cho việc dán cụm.
 *
 * Không dùng nhiều `keyframe/set` vì cách đó chỉ THÊM: keyframe cũ trên cùng
 * đường vẫn nằm lại, và kết quả là trộn hai cụm của hai clip khác nhau ra một
 * thứ không ai đoán được. Cùng lối `clip/set-effects`, vốn cũng thay cả mảng.
 */
const setKeyframeTracks = z.object({
  type: z.literal('keyframe/set-tracks'),
  target: keyframeTargetSchema,
  tracks: z.record(
    z.string().min(1).max(120),
    z
      .array(
        z.object({
          atUs: z.number().int(),
          v: z.number(),
          e: keyframeEasingSchema.optional()
        })
      )
      .max(500)
  )
})

const removeKeyframe = z.object({
  type: z.literal('keyframe/remove'),
  target: keyframeTargetSchema,
  path: z.string().min(1).max(120),
  atUs: z.number().int().min(0)
})

/**
 * Dời một keyframe sang mốc khác, tiện thể đổi kiểu nội suy của nó.
 *
 * Gộp hai việc vào một lệnh vì menu trên chấm keyframe làm cả hai, và một lệnh
 * riêng chỉ để đổi `easing` sẽ là lệnh thứ tư cho cùng một thao tác của người
 * dùng.
 */
const moveKeyframe = z.object({
  type: z.literal('keyframe/move'),
  target: keyframeTargetSchema,
  path: z.string().min(1).max(120),
  fromAtUs: z.number().int().min(0),
  toAtUs: z.number().int().min(0),
  easing: keyframeEasingSchema.optional()
})

/**
 * Chèn một khoảng thời gian vào các track phụ đề đi theo lời nói (đứng hình).
 * Câu sau mốc lùi, câu đang hiện tại mốc kéo dài qua khoảng chèn.
 */
const insertSubtitleTime = z.object({
  type: z.literal('subtitle/insert-time'),
  subtitleTrackIds: z.array(z.string()).min(1),
  atUs: nonNegativeMicros,
  durationUs: positiveMicros
})

/* ── Marker ────────────────────────────────────────────────────── */

const markerColorSchema = z.enum(MARKER_COLORS)

const addMarker = z.object({
  type: z.literal('marker/add'),
  marker: z.object({
    id: z.string().min(1).max(120),
    atUs: nonNegativeMicros,
    label: z.string().max(200),
    color: markerColorSchema
  })
})

const updateMarker = z.object({
  type: z.literal('marker/update'),
  markerId: z.string(),
  patch: z.object({
    atUs: nonNegativeMicros.optional(),
    label: z.string().max(200).optional(),
    color: markerColorSchema.optional()
  })
})

const removeMarker = z.object({
  type: z.literal('marker/remove'),
  markerId: z.string()
})

export const editorCommandSchema = z.discriminatedUnion('type', [
  setProjectSettings,
  renameProject,
  addTrack,
  removeTrack,
  reorderTrack,
  updateTrack,
  insertClip,
  pasteClip,
  removeClip,
  moveClip,
  moveClips,
  setClipLinkGroup,
  addMarker,
  insertSubtitleTime,
  updateMarker,
  removeMarker,
  trimClip,
  rippleTrimClip,
  slipClipCommand,
  rateStretchClipCommand,
  splitClip,
  rippleDelete,
  duplicateClip,
  updateClip,
  setClipTransition,
  setClipMotion,
  setClipLook,
  setClipEffects,
  setClipSpeed,
  setClipColorGrade,
  setKeyframe,
  setKeyframeTracks,
  removeKeyframe,
  moveKeyframe,
  addTranscript,
  removeTranscript,
  updateTranscriptSegment,
  mergeTranscriptSegments,
  addTranslation,
  removeTranslation,
  updateTranslationSegment,
  setTranslationGlossary,
  addDubbingSession,
  removeDubbingSession,
  updateDubbingSegment,
  setDubbingOverflowStrategy,
  addTextOverlay,
  removeTextOverlay,
  updateTextOverlay,
  setTextOverlayStyle,
  addSubtitleTrack,
  removeSubtitleTrack,
  renameSubtitleTrack,
  setSubtitleStyle,
  updateSubtitleCue,
  moveSubtitleCue,
  removeSubtitleCue,
  replaceSubtitleCues,
  addAsset,
  relinkAsset,
  removeAsset,
  updateAssetTags
])

export type EditorCommand = z.infer<typeof editorCommandSchema>
export type EditorCommandType = EditorCommand['type']

/** Kiểm tra một command đến từ AI hoặc từ IPC trước khi cho chạy. */
export function parseEditorCommand(
  input: unknown
): { ok: true; command: EditorCommand } | { ok: false; error: string } {
  const result = editorCommandSchema.safeParse(input)
  if (result.success) return { ok: true, command: result.data }
  const issue = result.error.issues[0]
  const path = issue?.path.join('.') || '(gốc)'
  return { ok: false, error: `${path}: ${issue?.message ?? 'payload không hợp lệ'}` }
}
