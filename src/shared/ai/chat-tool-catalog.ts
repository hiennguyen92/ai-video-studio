import { z } from 'zod'
import { MAX_TEXT_ROTATION_DEG } from '../domain/text-placement'
import { MAX_TEXT_OUTLINE_WIDTH_PX } from '../domain/subtitle-types'

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

  insert_image: z.object({
    assetId: z.string().min(1).max(120),
    trackId: z.string().min(1).max(120).optional(),
    startSeconds: seconds,
    /** Bỏ trống thì dùng mặc định 5 giây. Ảnh muốn dài bao lâu cũng được. */
    durationSeconds: z.number().positive().max(3600).optional()
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
    kind: z.enum(['video', 'audio', 'subtitle', 'text', 'image']),
    name: z.string().min(1).max(120),
    role: z.enum(['dialogue', 'voiceover', 'music', 'sfx']).optional()
  }),

  remove_track: z.object({
    trackId: z.string().min(1).max(120)
  }),

  reorder_track: z.object({
    trackId: z.string().min(1).max(120),
    /** Vị trí mới, đếm từ 0 ở lane trên cùng. */
    toIndex: z.number().int().min(0).max(200)
  }),

  set_track: z.object({
    trackId: z.string().min(1).max(120),
    name: z.string().min(1).max(120).optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional()
  }),

  set_clip_transform: z.object({
    clipId: z.string().min(1).max(120).optional(),
    // Tỉ lệ khung hình: 0 là giữa, 1 là đẩy tâm ra đúng mép.
    x: z.number().min(-1).max(1).optional(),
    y: z.number().min(-1).max(1).optional(),
    scale: z.number().min(0.1).max(4).optional(),
    rotationDeg: z.number().min(-180).max(180).optional(),
    opacity: z.number().min(0).max(1).optional(),
    reset: z.boolean().optional()
  }),

  update_text_overlay: z.object({
    overlayId: z.string().min(1).max(120),
    text: z.string().max(500).optional(),
    startSeconds: seconds.optional(),
    endSeconds: seconds.optional(),
    animation: z.enum(['none', 'fade', 'pop', 'slide-up', 'typewriter']).optional(),
    exit: z.enum(['none', 'fade', 'shrink', 'slide-down']).optional(),
    glow: z.boolean().optional(),
    /**
     * Khung nền dễ thương sau chữ, gọi bằng id trong danh mục.
     *
     * `null` nghĩa là BỎ khung; bỏ trống nghĩa là giữ nguyên khung đang có.
     */
    frame: z
      .union([
        z.object({
          styleId: z.string().min(1).max(60),
          paletteId: z.string().min(1).max(60).optional(),
          decorId: z.string().min(1).max(60).optional(),
          paddingScaleX: z.number().min(0).max(3).optional(),
          paddingScaleY: z.number().min(0).max(3).optional()
        }),
        z.null()
      ])
      .optional()
  }),

  update_subtitle_cue: z.object({
    subtitleTrackId: z.string().min(1).max(120),
    cueId: z.string().min(1).max(120),
    text: z.string().max(5000).optional(),
    startSeconds: seconds.optional(),
    endSeconds: seconds.optional()
  }),

  move_subtitle_cue: z.object({
    subtitleTrackId: z.string().min(1).max(120),
    toSubtitleTrackId: z.string().min(1).max(120),
    cueId: z.string().min(1).max(120)
  }),

  add_sound_effect: z.object({
    /** Id trong danh mục dựng sẵn. Gọi `list_sound_effects` để biết có những gì. */
    soundEffectId: z.string().min(1).max(120),
    /** Đặt luôn lên timeline ở mốc này. Bỏ trống thì chỉ thêm vào thư viện. */
    atSeconds: seconds.optional(),
    trackId: z.string().min(1).max(120).optional(),
    volume: z.number().min(0).max(2).optional()
  }),

  remove_subtitle_cue: z.object({
    subtitleTrackId: z.string().min(1).max(120),
    cueId: z.string().min(1).max(120)
  }),

  /**
   * Thêm chữ đè lên hình — hook, giá, lời kêu gọi hành động.
   *
   * Đây là thứ mô hình ngôn ngữ làm tốt nhất trong cả bộ công cụ: viết câu, chứ
   * không phải cộng trừ micro giây.
   */
  /**
   * Dựng bản cut từ các CÚ MÁY được chọn.
   *
   * Song song với `build_cut_from_transcript`, dành cho footage KHÔNG có tiếng —
   * quay review sản phẩm chẳng hạn. Ở đó transcript rỗng nên agent phải chọn
   * theo hình, dùng ảnh đại diện mà `list_shots` trả về.
   */
  build_cut_from_shots: z.object({
    assetId: z.string().min(1).max(120),
    /** Chỉ số cú máy, THEO ĐÚNG THỨ TỰ muốn xếp trên timeline. */
    shotIndexes: z.array(z.number().int().min(0).max(2000)).min(1).max(200),
    trackId: z.string().min(1).max(120).optional(),
    /** Cắt bớt mỗi cú còn bấy nhiêu giây; bỏ trống thì giữ nguyên độ dài. */
    maxShotSeconds: z.number().positive().max(60).optional()
  }),

  add_text_overlay: z.object({
    text: z.string().min(1).max(300),
    startSeconds: seconds,
    endSeconds: seconds,
    animation: z.enum(['none', 'fade', 'pop', 'slide-up', 'typewriter']).optional(),
    /** 2 = dưới, 5 = giữa, 8 = trên. Bỏ trống thì đặt giữa khung hình. */
    position: z.enum(['bottom', 'middle', 'top']).optional(),
    fontSizePx: z.number().int().min(12).max(300).optional(),
    /** Nền hộp sau chữ. Bỏ trống thì không hộp, chỉ viền chữ. */
    box: z.enum(['none', 'dark', 'light']).optional(),
    /** Hiệu ứng khi chữ biến mất. Bỏ trống thì tắt phụt. */
    exit: z.enum(['none', 'fade', 'shrink', 'slide-down']).optional(),
    /** Viền phát sáng quanh chữ. */
    glow: z.boolean().optional(),
    /** Góc xoay, tính bằng độ theo chiều kim đồng hồ. */
    rotationDeg: z.number().min(-MAX_TEXT_ROTATION_DEG).max(MAX_TEXT_ROTATION_DEG).optional(),
    /**
     * Khung nền dễ thương sau chữ, gọi bằng id trong danh mục.
     *
     * `null` nghĩa là BỎ khung; bỏ trống nghĩa là giữ nguyên khung đang có.
     */
    frame: z
      .union([
        z.object({
          styleId: z.string().min(1).max(60),
          paletteId: z.string().min(1).max(60).optional(),
          decorId: z.string().min(1).max(60).optional(),
          paddingScaleX: z.number().min(0).max(3).optional(),
          paddingScaleY: z.number().min(0).max(3).optional()
        }),
        z.null()
      ])
      .optional()
  }),

  remove_text_overlay: z.object({
    overlayId: z.string().min(1).max(120)
  }),

  /**
   * Đổi khung hình của dự án.
   *
   * Bắt buộc phải có cho video dọc: footage quay dọc đặt vào khung 16:9 thì hai
   * bên là hai dải đen, và không sửa được bằng bất kỳ công cụ nào khác trong bộ
   * này. Nhận TỈ LỆ chứ không nhận hai số pixel — mô hình nhớ sai độ phân giải
   * thường xuyên, còn "9:16" thì không nhầm được.
   */
  set_canvas: z.object({
    aspect: z.enum(['16:9', '9:16', '1:1']),
    /** Cạnh dài tính bằng pixel. Bỏ trống thì 1920 (1080 cho khung vuông). */
    longEdgePx: z.number().int().min(240).max(4320).optional()
  }),

  /**
   * Đặt chuyển cảnh vào CHỖ NỐI giữa hai clip liền nhau trên cùng một track hình.
   *
   * Cùng mô hình với giao diện: cuối clip trước nhận hiệu ứng ra, đầu clip sau
   * nhận hiệu ứng vào, cùng một kiểu và cùng thời lượng. Chỗ nối xác định bằng
   * clip ĐỨNG TRƯỚC nó. `none` để gỡ.
   *
   * Thời lượng tối đa 2 giây, khớp các mức trong menu chuột phải của timeline.
   */
  set_cut_transition: z.object({
    /** Clip đứng TRƯỚC chỗ nối. Bỏ trống thì lấy clip đang chọn. */
    fromClipId: z.string().min(1).max(120).optional(),
    kind: z.enum([
      'none',
      'fade',
      'slide-left',
      'slide-right',
      'slide-up',
      'slide-down',
      'wipe-left',
      'wipe-right',
      'zoom',
      'whip-left',
      'whip-right',
      'blur',
      'glitch',
      'spin',
      'flash'
    ]),
    durationSeconds: z.number().min(0.1).max(2).optional()
  }),

  /**
   * Chuyển động chạy suốt clip.
   *
   * Đây là hiệu ứng có tác động lớn nhất trên footage gần như tĩnh: một cú đẩy
   * chậm làm khung hình thôi bị coi là ảnh chết. `none` để gỡ.
   */
  set_clip_speed: z.object({
    clipId: z.string().min(1).max(120).optional(),
    /** 1 = tốc độ gốc, 2 = nhanh gấp đôi, 0.5 = chậm một nửa. */
    speed: z.number().min(0.25).max(4)
  }),

  /**
   * Look màu dựng sẵn (tab LUT) cho clip hình. Id phải có trong danh mục look —
   * bản tổng quan dự án liệt kê sẵn. `none` để gỡ.
   */
  set_clip_look: z.object({
    clipId: z.string().min(1).max(120).optional(),
    lookId: z.string().min(1).max(60),
    /** 0–1, trộn với hình gốc. Bỏ trống thì giữ cường độ đang có (look mới: 1). */
    intensity: z.number().min(0).max(1).optional()
  }),

  /**
   * Effect hình chồng lên clip (tab Effects). Kind phải có trong danh mục — bản
   * tổng quan liệt kê kèm thông số. Thông số lạ bị bỏ, số ngoài khoảng bị kẹp.
   */
  add_clip_effect: z.object({
    clipId: z.string().min(1).max(120).optional(),
    kind: z.string().min(1).max(60),
    intensity: z.number().min(0).max(1).optional(),
    params: z.record(z.string().max(40), z.union([z.number(), z.string().max(40)])).optional()
  }),

  update_clip_effect: z.object({
    clipId: z.string().min(1).max(120).optional(),
    effectId: z.string().min(1).max(80),
    intensity: z.number().min(0).max(1).optional(),
    params: z.record(z.string().max(40), z.union([z.number(), z.string().max(40)])).optional()
  }),

  /** Bỏ trống `effectId` thì gỡ HẾT effect của clip. */
  remove_clip_effect: z.object({
    clipId: z.string().min(1).max(120).optional(),
    effectId: z.string().min(1).max(80).optional()
  }),

  set_clip_motion: z.object({
    clipId: z.string().min(1).max(120).optional(),
    kind: z.enum([
      'none',
      'zoom-in',
      'zoom-out',
      'pan-left',
      'pan-right',
      'pan-up',
      'pan-down',
      'punch-in',
      'shake'
    ]),
    /** 0–1. Bỏ trống thì 0,5. */
    intensity: z.number().min(0).max(1).optional()
  }),

  /**
   * Chỉnh màu clip.
   *
   * Nhận từng phần, nên gọi lại để sửa một thông số không xoá mất thông số khác.
   * Bỏ trống mọi trường nghĩa là trả clip về màu gốc.
   */
  set_clip_color: z.object({
    clipId: z.string().min(1).max(120).optional(),
    brightness: z.number().min(0.5).max(1.5).optional(),
    contrast: z.number().min(0.5).max(1.5).optional(),
    saturation: z.number().min(0).max(2).optional(),
    /** -1 lạnh, 0 giữ nguyên, 1 ấm. */
    temperature: z.number().min(-1).max(1).optional(),
    vignette: z.number().min(0).max(1).optional(),
    /** Đặt true để trả clip về màu gốc, bỏ qua mọi trường khác. */
    reset: z.boolean().optional()
  }),

  /**
   * Xoá một media khỏi thư viện.
   *
   * Mặc định TỪ CHỐI khi media đang được dùng: agent thường không biết trên
   * timeline còn gì, và xoá nhầm sẽ kéo theo cả loạt clip biến mất. Muốn xoá
   * kèm thì phải nói rõ `removeClips`.
   */
  import_media: z.object({
    /**
     * Đường dẫn TUYỆT ĐỐI. Tương đối không có nghĩa: agent chạy ở thư mục của
     * nó, còn app chạy ở thư mục khác.
     */
    filePaths: z.array(z.string().min(1)).min(1).max(50)
  }),

  remove_media: z.object({
    assetId: z.string().min(1).max(120),
    removeClips: z.boolean().optional()
  }),

  /**
   * Đổi phông chữ.
   *
   * Bỏ trống cả `overlayId` lẫn `subtitleTrackId` nghĩa là áp cho MỌI chữ overlay
   * — thứ agent hay muốn nhất khi dựng một video ngắn.
   */
  set_text_font: z.object({
    /** Tên họ phông, đúng như `list_fonts` trả về. */
    fontFamily: z.string().min(1).max(120),
    /** Tên PostScript của kiểu cụ thể. Bỏ trống thì dùng kiểu mặc định của họ. */
    fontPostScriptName: z.string().min(1).max(160).optional(),
    overlayId: z.string().min(1).max(120).optional(),
    subtitleTrackId: z.string().min(1).max(120).optional()
  }),

  /** Xoay chữ đã có. Bỏ trống cả hai id thì áp cho MỌI chữ overlay. */
  set_text_color: z.object({
    /** Mã màu `#RRGGBB`. Kiểm ngay ở đây vì màu sai cú pháp làm chữ biến mất. */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Màu phải có dạng #RRGGBB'),
    /** Màu viền quanh chữ. Bỏ trống thì giữ nguyên viền đang có. */
    outlineColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Màu phải có dạng #RRGGBB')
      .optional(),
    /** Độ dày viền, px. Bỏ trống thì giữ nguyên; 0 là bỏ viền. */
    outlineWidthPx: z.number().int().min(0).max(MAX_TEXT_OUTLINE_WIDTH_PX).optional(),
    overlayId: z.string().min(1).max(120).optional(),
    subtitleTrackId: z.string().min(1).max(120).optional()
  }),

  set_text_rotation: z.object({
    rotationDeg: z.number().min(-MAX_TEXT_ROTATION_DEG).max(MAX_TEXT_ROTATION_DEG),
    overlayId: z.string().min(1).max(120).optional(),
    subtitleTrackId: z.string().min(1).max(120).optional()
  }),

  set_text_position: z.object({
    // Tỉ lệ chứ không phải pixel: agent không biết dự án đang ở độ phân giải nào,
    // và tỉ lệ thì đúng ở mọi độ phân giải.
    xPct: z.number().min(0).max(1).optional(),
    yPct: z.number().min(0).max(1).optional(),
    /** Bỏ ghim, trả chữ về cho alignment và lề. */
    clear: z.boolean().optional(),
    overlayId: z.string().min(1).max(120).optional(),
    subtitleTrackId: z.string().min(1).max(120).optional()
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
  insert_clip:
    'Place a VIDEO or AUDIO asset from the library onto a timeline track. NOT for still images — use insert_image for those; this tool rejects them. Leave durationSeconds out to use the whole remaining source from sourceInSeconds onward; a duration longer than the source is clamped to it.',
  insert_image:
    'Place a STILL IMAGE on the timeline for a stretch of time — a logo, a product shot, a title card. NOT for video or audio — use insert_clip for those; this tool rejects them. An image has no length of its own, so durationSeconds decides how long it stays on screen; leave it out for 5 seconds. There is no sourceInSeconds because there is nothing to seek into.',
  ripple_delete_range:
    'Cut a time range out of the timeline and pull everything after it back to close the gap. Applies to every track so picture and sound stay in sync.',
  build_cut_from_transcript:
    'Assemble a cut from a transcript: keep only the listed segments, laid end to end in transcript order on one track. Replaces whatever is already on that track. This is the main tool for editing by what was said.',
  add_track:
    'Add a lane to the timeline. Lane ORDER decides layering: the lowest lane draws on top. Kinds: video and image hold clips, text holds on-screen text, audio holds sound, subtitle shows a subtitle track.',
  remove_track:
    'Delete a lane. Clips on it go with it, and a text lane takes its on-screen text with it. One undo step restores everything.',
  reorder_track:
    'Move a lane to another position, counting from 0 at the top. This is how you change what covers what: the lowest lane draws on top of everything above it.',
  set_track:
    'Rename a lane, hide it, or lock it. A hidden lane disappears from the preview and from the exported file.',
  set_clip_transform:
    'Place a clip inside the frame: x and y are fractions of the frame from the centre (0 is centred, 1 pushes the centre to the edge), scale multiplies its size, rotationDeg tilts it, opacity fades it. Use this to put a logo or a product photo where you want it. Pass reset:true to put it back.',
  update_text_overlay:
    'Change an existing on-screen text: its words, its timing, or its enter/exit animation.',
  update_subtitle_cue: 'Change the words or the timing of one subtitle cue.',
  move_subtitle_cue: 'Move one cue to a different subtitle track. It keeps its words and timing.',
  remove_subtitle_cue: 'Delete one subtitle cue.',
  add_sound_effect:
    'Put a built-in sound effect into the project. These ship with the app: no network, no cost, no licence to worry about. The project overview lists every id with its name, tags and length. Pass atSeconds to drop it straight onto an audio lane, or leave it out to only add it to the media library.',
  build_cut_from_shots:
    'Assemble a cut from detected camera shots, laid end to end in the order given. Use this for footage with no speech, where there is no transcript to work from. Call list_shots first to see each shot and its still frame.',
  add_text_overlay:
    'Put text on top of the video for a stretch of time — a hook, a price, a call to action. Use a newline (\\n) in text to break it onto several lines. Separate from subtitles, which come from speech. Set box to "dark" or "light" when the footage behind the text is bright or busy — an outline alone is not enough to keep it readable. Set exit so the text leaves instead of snapping off, and glow to make it carry over busy footage. For a playful look pass frame with a styleId from the project overview: vector frames also need a paletteId (and take an optional decorId), picture frames take styleId only because their colours are baked into the image. A cute frame replaces the plain box and sets a matching text colour, so do not set both. paddingScaleX/paddingScaleY (0 to 3, default 1) set the space between the text and the frame edge: 0 hugs the text, 2 doubles the space.',
  remove_text_overlay: 'Remove a text overlay.',
  set_canvas:
    'Set the project canvas shape. Use 9:16 for TikTok, Reels and Shorts, 16:9 for YouTube, 1:1 for square. Do this before laying out text, because it changes where text sits in frame.',
  set_cut_transition:
    'Put a transition on the cut between two clips that sit back to back on the same visual track. fromClipId is the clip BEFORE the cut (defaults to the selected clip); the Cuts list in the project overview shows every cut and the transition on it. The end of that clip plays out and the start of the next clip plays in, with the same kind and duration. durationSeconds is 0.1 to 2 (keeps the current duration when left out, 0.5 for a new one). Use kind "none" to remove it.',
  set_clip_speed:
    'Change how fast a clip plays. The clip keeps the same stretch of source footage, so speeding it up makes it SHORTER on the timeline and slowing it down makes it longer — a longer clip pushes into whatever sits next to it. Use it to tighten a slow take or to stretch a moment out. Audio pitch shifts in the preview but is corrected in the exported file.',
  set_clip_look:
    'Give a visual clip a ready-made colour look (a LUT), such as a warm film, teal and orange, black and white, or a log-to-Rec.709 conversion for flat camera footage. Use a lookId from the Colour looks list in the project overview. intensity 0 to 1 blends it with the original (keeps the current one when left out, 1 for a new look). The look is applied after the clip colour grade. Use lookId "none" to remove it.',
  add_clip_effect:
    'Stack a visual effect on a clip: stylize (vignette, film grain, bloom, light leak, retro CRT, edge glow, posterize), distort (RGB split, glitch, mirror, pixelate, handheld shake, magnifier), blur (soft, motion, tilt-shift), masks (rectangle, circle, local mosaic to hide a face or plate), keys (luma key, green/blue screen chroma key) and colour (levels, HSL, colour wheels, clarity, shadows/highlights, duotone, sepia, invert). Effects STACK: each call adds one more at the end, applied after the colour grade and look, in order. Use a kind from the Visual effects list in the project overview, which also lists the params of each effect with their ranges; leave params out for sensible defaults. intensity 0 to 1 (default 0.7) only matters for effects that list it. The reply names the new effect id; the clip line in the project overview lists it too.',
  update_clip_effect:
    'Change the intensity or some params of one effect already on a clip. effectId comes from the clip line in the project overview (effects=[id:kind…]). Params you leave out keep their value.',
  remove_clip_effect:
    'Remove one effect from a clip by effectId, or every effect on the clip when effectId is left out.',
  set_clip_motion:
    'Move the frame over the whole length of a clip: a slow push in or out, a slow pan, a punch in at the cut, or a shake. Use this on footage that barely moves — a still product shot with a slow push reads as edited, the same shot held still reads as a frozen photo. Use "none" to remove it.',
  set_clip_color:
    'Grade one clip: brightness, contrast, saturation, warm/cool temperature, and a vignette. Fields are applied on top of what is already set, so changing one does not clear the others. Pass reset to put the clip back to its original colour. For a ready-made look use set_clip_look.',
  import_media:
    'Import files from disk into the media pool so they can be placed on the timeline. Paths must be ABSOLUTE. The reply gives the id of each imported asset — pass those to insert_clip. A file already in the project is reported as a duplicate with the id of the existing asset instead of being imported twice. This only fills the media pool; it does not put anything on the timeline.',
  remove_media:
    'Remove one asset from the media library. Refuses if any clip on the timeline still uses it; pass removeClips to delete those clips as well. The file on disk is never touched.',
  set_text_color:
    'Set the colour of text overlays or a subtitle track, as #RRGGBB. Pass outlineColor too when the text sits on busy footage — the outline is what keeps it readable, and a fill colour alone can disappear into the picture. outlineWidthPx (0 to 20) sets how thick the outline is; 0 removes it. With no overlayId and no subtitleTrackId it applies to every text overlay. Note that choosing a cute frame or a box background sets its own matching colours, so set the colour AFTER those, not before.',
  set_text_rotation:
    'Tilt text by an angle, clockwise, from -180 to 180 degrees (90 stands the text upright, 180 turns it upside down). Works in the preview and in the exported file alike. With no overlayId and no subtitleTrackId it applies to every text overlay.',
  set_text_position:
    'Pin text to an exact spot on the frame. xPct/yPct are fractions of frame width and height (0..1) for the CENTER of the text block, so 0.5/0.5 is dead centre and 0.5/0.85 sits low. Overrides the alignment and margins in both the preview and the exported file. Pass clear:true to unpin and go back to alignment. With no overlayId and no subtitleTrackId it applies to every text overlay.',
  set_text_font:
    'Change the font of text overlays or a subtitle track. Call list_fonts first and use a family name from it — a font that is not installed silently falls back to the default. Pass fontPostScriptName to pick a specific weight or width within the family; the family name alone cannot select a face. With no overlayId and no subtitleTrackId it applies to every text overlay.'
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
  insert_image:
    '{ assetId: string, trackId?: string, startSeconds: number, durationSeconds?: number }',
  ripple_delete_range: '{ fromSeconds: number, toSeconds: number }',
  build_cut_from_transcript:
    '{ transcriptId?: string, keepSegmentIds: string[], trackId?: string }',
  add_track:
    "{ kind: 'video' | 'audio' | 'subtitle' | 'text' | 'image', name: string, role?: 'dialogue' | 'voiceover' | 'music' | 'sfx' }",
  remove_track: '{ trackId: string }',
  reorder_track: '{ trackId: string, toIndex: number }',
  set_track: '{ trackId: string, name?: string, hidden?: boolean, locked?: boolean }',
  set_clip_transform:
    '{ clipId?: string, x?: number, y?: number, scale?: number, rotationDeg?: number, opacity?: number, reset?: boolean }',
  update_text_overlay:
    "{ overlayId: string, text?: string, startSeconds?: number, endSeconds?: number, animation?: 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter', exit?: 'none' | 'fade' | 'shrink' | 'slide-down', glow?: boolean, frame?: { styleId: string, paletteId?: string, decorId?: string, paddingScaleX?: number, paddingScaleY?: number } | null }",
  update_subtitle_cue:
    '{ subtitleTrackId: string, cueId: string, text?: string, startSeconds?: number, endSeconds?: number }',
  move_subtitle_cue: '{ subtitleTrackId: string, toSubtitleTrackId: string, cueId: string }',
  remove_subtitle_cue: '{ subtitleTrackId: string, cueId: string }',
  add_sound_effect:
    '{ soundEffectId: string, atSeconds?: number, trackId?: string, volume?: number }',
  build_cut_from_shots:
    '{ assetId: string, shotIndexes: number[], trackId?: string, maxShotSeconds?: number }',
  add_text_overlay:
    "{ text: string, startSeconds: number, endSeconds: number, animation?: 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter', position?: 'bottom' | 'middle' | 'top', fontSizePx?: number, box?: 'none' | 'dark' | 'light', exit?: 'none' | 'fade' | 'shrink' | 'slide-down', glow?: boolean, rotationDeg?: number, frame?: { styleId: string, paletteId?: string, decorId?: string, paddingScaleX?: number, paddingScaleY?: number } | null }",
  remove_text_overlay: '{ overlayId: string }',
  set_canvas: "{ aspect: '16:9' | '9:16' | '1:1', longEdgePx?: number }",
  set_cut_transition:
    "{ fromClipId?: string, kind: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'wipe-left' | 'wipe-right' | 'zoom' | 'whip-left' | 'whip-right' | 'blur' | 'glitch' | 'spin' | 'flash', durationSeconds?: number }",
  set_clip_speed: '{ clipId?: string, speed: number }',
  set_clip_look: '{ clipId?: string, lookId: string, intensity?: number }',
  add_clip_effect:
    '{ clipId?: string, kind: string, intensity?: number, params?: Record<string, number | string> }',
  update_clip_effect:
    '{ clipId?: string, effectId: string, intensity?: number, params?: Record<string, number | string> }',
  remove_clip_effect: '{ clipId?: string, effectId?: string }',
  set_clip_motion:
    "{ clipId?: string, kind: 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'punch-in' | 'shake', intensity?: number }",
  set_clip_color:
    '{ clipId?: string, brightness?: number, contrast?: number, saturation?: number, temperature?: number, vignette?: number, reset?: boolean }',
  import_media: '{ filePaths: string[] }',
  remove_media: '{ assetId: string, removeClips?: boolean }',
  set_text_font:
    '{ fontFamily: string, fontPostScriptName?: string, overlayId?: string, subtitleTrackId?: string }',
  set_text_position:
    '{ xPct?: number, yPct?: number, clear?: boolean, overlayId?: string, subtitleTrackId?: string }',
  set_text_color:
    '{ color: string, outlineColor?: string, outlineWidthPx?: number, overlayId?: string, subtitleTrackId?: string }',
  set_text_rotation: '{ rotationDeg: number, overlayId?: string, subtitleTrackId?: string }'
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
