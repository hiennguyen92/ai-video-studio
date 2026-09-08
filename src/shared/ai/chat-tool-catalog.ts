import { z } from 'zod'

/**
 * Danh mục công cụ mà AI Chat được phép gọi.
 *
 * Đây là RANH GIỚI AN TOÀN của tính năng chat (DESCRIPTION §5: "Không tự sửa
 * project JSON bằng đầu ra văn bản không xác thực").
 *
 * Mô hình ngôn ngữ không bao giờ chạm được vào tài liệu project. Nó chỉ phát ra
 * lời gọi công cụ; lời gọi đó phải khớp một mục trong danh mục này và qua được
 * schema tương ứng, rồi mới được dịch sang các lệnh sửa đã có sẵn. Tên công cụ lạ
 * hoặc tham số sai kiểu bị loại ngay, không có đường vòng nào khác.
 *
 * Công cụ nhận THỜI GIAN BẰNG GIÂY chứ không phải micro giây. Mô hình xử lý số
 * nhỏ và quen thuộc chính xác hơn nhiều; việc quy đổi sang đơn vị chuẩn của dự án
 * được làm ở một chỗ duy nhất, nơi có thể kiểm soát cách làm tròn.
 */

/** Giây, không âm. Chặn NaN và Infinity vốn phá mọi phép tính thời gian phía sau. */
const seconds = z.number().finite().min(0).max(86_400)
const gain = z.number().min(0).max(4)

/**
 * Id clip. Bỏ trống nghĩa là "clip đang chọn" — cách người dùng nói tự nhiên
 * nhất, và cũng tránh việc mô hình bịa ra id không tồn tại.
 */
const optionalClipId = z.string().min(1).max(120).optional()

export const chatToolSchemas = {
  split_clip: z.object({
    clipId: optionalClipId,
    atSeconds: seconds
  }),

  trim_clip: z.object({
    clipId: optionalClipId,
    edge: z.enum(['start', 'end']),
    toSeconds: seconds
  }),

  move_clip: z.object({
    clipId: optionalClipId,
    toSeconds: seconds,
    toTrackId: z.string().min(1).max(120).optional()
  }),

  remove_clip: z.object({
    clipId: optionalClipId
  }),

  duplicate_clip: z.object({
    clipId: optionalClipId
  }),

  set_clip_volume: z.object({
    clipId: optionalClipId,
    volume: gain
  }),

  set_clip_fade: z.object({
    clipId: optionalClipId,
    fadeInSeconds: seconds.optional(),
    fadeOutSeconds: seconds.optional()
  }),

  set_track_volume: z.object({
    trackId: z.string().min(1).max(120),
    volume: gain
  }),

  set_track_muted: z.object({
    trackId: z.string().min(1).max(120),
    muted: z.boolean()
  }),

  rename_project: z.object({
    name: z.string().min(1).max(120)
  }),

  create_subtitle_track: z.object({
    transcriptId: z.string().min(1).max(120).optional(),
    translationId: z.string().min(1).max(120).optional(),
    bilingual: z.boolean().optional()
  }),

  auto_duck_music: z.object({
    duckVolume: gain.optional(),
    baseVolume: gain.optional(),
    paddingSeconds: seconds.optional()
  })
} as const

export type ChatToolName = keyof typeof chatToolSchemas

export function isChatToolName(value: string): value is ChatToolName {
  return Object.prototype.hasOwnProperty.call(chatToolSchemas, value)
}

/**
 * Mô tả công cụ gửi cho mô hình.
 *
 * Viết bằng tiếng Anh vì mô hình bám theo mô tả tiếng Anh ổn định hơn, kể cả khi
 * người dùng gõ tiếng Việt. Phần hiện cho người dùng luôn là tiếng Việt.
 */
export const chatToolDescriptions: Record<ChatToolName, string> = {
  split_clip: 'Split a clip in two at a time position, in seconds on the timeline.',
  trim_clip: 'Move one edge of a clip to a new timeline position, in seconds.',
  move_clip: 'Move a clip to a new start position, optionally onto another track.',
  remove_clip: 'Delete a clip from the timeline.',
  duplicate_clip: 'Duplicate a clip in place.',
  set_clip_volume: 'Set the volume of one clip, where 1 is unchanged.',
  set_clip_fade: 'Set fade in and/or fade out on a clip, in seconds.',
  set_track_volume: 'Set the volume of a whole track, where 1 is unchanged.',
  set_track_muted: 'Mute or unmute a track.',
  rename_project: 'Rename the project.',
  create_subtitle_track:
    'Build a subtitle track from an existing transcript, optionally using a translation, optionally bilingual. Requires a transcript to already exist.',
  auto_duck_music:
    'Lower music volume wherever there is speech, by cutting the music at speech boundaries and setting a lower volume on those pieces.'
}

/** Mô tả tham số cho mô hình — dựng thủ công để không phải kéo thêm thư viện. */
export const chatToolParameterHints: Record<ChatToolName, string> = {
  split_clip: '{ clipId?: string, atSeconds: number }',
  trim_clip: "{ clipId?: string, edge: 'start' | 'end', toSeconds: number }",
  move_clip: '{ clipId?: string, toSeconds: number, toTrackId?: string }',
  remove_clip: '{ clipId?: string }',
  duplicate_clip: '{ clipId?: string }',
  set_clip_volume: '{ clipId?: string, volume: number }',
  set_clip_fade: '{ clipId?: string, fadeInSeconds?: number, fadeOutSeconds?: number }',
  set_track_volume: '{ trackId: string, volume: number }',
  set_track_muted: '{ trackId: string, muted: boolean }',
  rename_project: '{ name: string }',
  create_subtitle_track: '{ transcriptId?: string, translationId?: string, bilingual?: boolean }',
  auto_duck_music: '{ duckVolume?: number, baseVolume?: number, paddingSeconds?: number }'
}

/**
 * Việc mô hình KHÔNG làm được, để nó nói thẳng thay vì hứa suông.
 *
 * Những tác vụ này cần hàng đợi job, tốn tiền hoặc tốn nhiều phút, nên phải do
 * người dùng tự bấm ở đúng tab chứ không để một câu chat khởi động ngầm.
 */
export const chatUnsupportedRequests = [
  'generating speech, music or sound effects',
  'running transcription',
  'running translation',
  'exporting video'
] as const
