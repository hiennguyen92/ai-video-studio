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

  insert_clip: z.object({
    assetId: z.string().min(1).max(120),
    trackId: z.string().min(1).max(120).optional(),
    startSeconds: seconds,
    /** Điểm bắt đầu bên trong file nguồn. */
    sourceInSeconds: seconds.optional(),
    /** Bỏ trống thì lấy hết phần còn lại của nguồn. */
    durationSeconds: seconds.optional()
  }),

  ripple_delete_range: z.object({
    fromSeconds: seconds,
    toSeconds: seconds
  }),

  /**
   * Dựng bản cut từ những đoạn lời được giữ lại.
   *
   * Đây là công cụ trục chính cho dựng phim theo transcript: một lượt gọi ra cả
   * bản dựng, thay vì để mô hình phát hàng chục lệnh cắt/xoá/dời rời rạc.
   */
  build_cut_from_transcript: z.object({
    transcriptId: z.string().min(1).max(120).optional(),
    keepSegmentIds: z.array(z.string().min(1).max(120)).min(1).max(500),
    trackId: z.string().min(1).max(120).optional()
  }),

  add_track: z.object({
    kind: z.enum(['video', 'audio', 'subtitle']),
    name: z.string().min(1).max(120),
    role: z.enum(['dialogue', 'voiceover', 'music', 'sfx']).optional()
  }),

  /**
   * Thêm chữ đè lên hình — hook, giá, lời kêu gọi hành động.
   *
   * Đây là thứ mô hình ngôn ngữ làm tốt nhất trong cả bộ công cụ: viết câu, chứ
   * không phải cộng trừ micro giây.
   */
  add_text_overlay: z.object({
    text: z.string().min(1).max(300),
    startSeconds: seconds,
    endSeconds: seconds,
    animation: z.enum(['none', 'fade', 'pop', 'slide-up', 'typewriter']).optional(),
    /** 2 = dưới, 5 = giữa, 8 = trên. Bỏ trống thì đặt giữa khung hình. */
    position: z.enum(['bottom', 'middle', 'top']).optional(),
    fontSizePx: z.number().int().min(12).max(300).optional()
  }),

  remove_text_overlay: z.object({
    overlayId: z.string().min(1).max(120)
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
    'Lower music volume wherever there is speech, by cutting the music at speech boundaries and setting a lower volume on those pieces.',
  insert_clip: 'Place a media asset from the library onto a timeline track.',
  ripple_delete_range:
    'Cut a time range out of the timeline and pull everything after it back to close the gap. Applies to every track so picture and sound stay in sync.',
  build_cut_from_transcript:
    'Assemble a cut from a transcript: keep only the listed segments, laid end to end in transcript order on one track. Replaces whatever is already on that track. This is the main tool for editing by what was said.',
  add_track: 'Add a new track to the timeline.',
  add_text_overlay:
    'Put text on top of the video for a stretch of time — a hook, a price, a call to action. Separate from subtitles, which come from speech.',
  remove_text_overlay: 'Remove a text overlay.'
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
  auto_duck_music: '{ duckVolume?: number, baseVolume?: number, paddingSeconds?: number }',
  insert_clip:
    '{ assetId: string, trackId?: string, startSeconds: number, sourceInSeconds?: number, durationSeconds?: number }',
  ripple_delete_range: '{ fromSeconds: number, toSeconds: number }',
  build_cut_from_transcript:
    '{ transcriptId?: string, keepSegmentIds: string[], trackId?: string }',
  add_track:
    "{ kind: 'video' | 'audio' | 'subtitle', name: string, role?: 'dialogue' | 'voiceover' | 'music' | 'sfx' }",
  add_text_overlay:
    "{ text: string, startSeconds: number, endSeconds: number, animation?: 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter', position?: 'bottom' | 'middle' | 'top', fontSizePx?: number }",
  remove_text_overlay: '{ overlayId: string }'
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
