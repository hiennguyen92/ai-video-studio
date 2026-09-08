import { z } from 'zod'
import type { MediaAsset } from '../domain/media-asset-types'

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
  kind: z.enum(['video', 'audio', 'subtitle']),
  name: z.string().min(1).max(120),
  role: z.enum(['dialogue', 'voiceover', 'music', 'sfx']).optional(),
  subtitleTrackId: z.string().optional(),
  /** Chèn vào vị trí này; bỏ trống thì thêm vào cuối. */
  index: z.number().int().min(0).optional()
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
      role: z.enum(['dialogue', 'voiceover', 'music', 'sfx'])
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
      transform: clipTransformSchema
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

export const editorCommandSchema = z.discriminatedUnion('type', [
  setProjectSettings,
  renameProject,
  addTrack,
  removeTrack,
  reorderTrack,
  updateTrack,
  insertClip,
  removeClip,
  moveClip,
  trimClip,
  splitClip,
  duplicateClip,
  updateClip,
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
