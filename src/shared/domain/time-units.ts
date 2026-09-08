/**
 * Quy ước thời gian thống nhất cho toàn bộ ứng dụng.
 *
 * Đơn vị chuẩn: MICROGIÂY (số nguyên). Mọi trường thời gian trong project
 * document đều có hậu tố `Us`.
 *
 * Vì sao microgiây số nguyên:
 * - Số nguyên nên không tích luỹ sai số dấu phẩy động khi kéo/cắt clip nhiều lần.
 * - Đủ mịn cho mọi sample rate ta dùng (48 kHz => 1 sample = 20.833 µs).
 * - Tránh phải làm số học hữu tỉ ở khắp nơi, nhưng vẫn sống được với 29.97/23.976 fps
 *   vì frame rate luôn được lưu dạng phân số `{ num, den }`.
 *
 * Nguyên tắc quan trọng: vị trí luôn TUYỆT ĐỐI, không bao giờ cộng dồn.
 * Mỗi clip lưu `startUs` tuyệt đối trên timeline và `sourceInUs` tuyệt đối trong asset,
 * nên sai số làm tròn không bao giờ dồn lại.
 */

/** Microgiây, luôn là số nguyên. */
export type Micros = number

/** Frame rate dạng phân số — 29.97 fps được lưu là { num: 30000, den: 1001 }. */
export interface FrameRate {
  num: number
  den: number
}

export const MICROS_PER_SECOND = 1_000_000

export const FRAME_RATE_PRESETS: Record<string, FrameRate> = {
  '23.976': { num: 24000, den: 1001 },
  '24': { num: 24, den: 1 },
  '25': { num: 25, den: 1 },
  '29.97': { num: 30000, den: 1001 },
  '30': { num: 30, den: 1 },
  '50': { num: 50, den: 1 },
  '59.94': { num: 60000, den: 1001 },
  '60': { num: 60, den: 1 }
}

/**
 * Quy tắc làm tròn duy nhất của ứng dụng: làm tròn nửa lên (round half up).
 * Dùng cho MỌI phép chuyển đổi thời gian để kết quả luôn tái lập được.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5)
}

/** fps dạng số thực — chỉ dùng để hiển thị, không dùng để tính toán. */
export function frameRateToNumber(fps: FrameRate): number {
  return fps.num / fps.den
}

export function isDropFrameRate(fps: FrameRate): boolean {
  return fps.den === 1001
}

/** Micro giây -> chỉ số frame. Làm tròn nửa lên. */
export function frameOfMicros(us: Micros, fps: FrameRate): number {
  return roundHalfUp((us * fps.num) / (fps.den * MICROS_PER_SECOND))
}

/** Chỉ số frame -> microgiây. Làm tròn nửa lên. */
export function microsOfFrame(frame: number, fps: FrameRate): Micros {
  return roundHalfUp((frame * fps.den * MICROS_PER_SECOND) / fps.num)
}

/** Độ dài một frame, tính bằng microgiây (đã làm tròn). */
export function frameDurationUs(fps: FrameRate): Micros {
  return microsOfFrame(1, fps)
}

/**
 * Bắt dính một mốc thời gian vào lưới frame.
 * Chỉ gọi ở đúng hai chỗ: (a) khi người dùng thao tác có bật snap, (b) khi export.
 * Không gọi rải rác trong reducer — document giữ nguyên giá trị µs người dùng chọn.
 */
export function snapMicrosToFrame(us: Micros, fps: FrameRate): Micros {
  return microsOfFrame(frameOfMicros(us, fps), fps)
}

export function secondsToMicros(seconds: number): Micros {
  return roundHalfUp(seconds * MICROS_PER_SECOND)
}

export function microsToSeconds(us: Micros): number {
  return us / MICROS_PER_SECOND
}

/** Micro giây -> chỉ số sample, dùng khi trộn audio. */
export function microsToSamples(us: Micros, sampleRate: number): number {
  return roundHalfUp((us * sampleRate) / MICROS_PER_SECOND)
}

export function clampMicros(us: Micros, minUs: Micros, maxUs: Micros): Micros {
  if (us < minUs) return minUs
  if (us > maxUs) return maxUs
  return us
}

function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, '0')
}

/**
 * Timecode HH:MM:SS:FF dùng cho thước thời gian và ô nhập timecode.
 * Không xử lý drop-frame timecode (29.97 vẫn đếm frame liên tục) — ứng dụng
 * là editor local, không phát sóng, nên đếm liên tục là đủ và ít gây nhầm hơn.
 */
export function formatTimecode(us: Micros, fps: FrameRate): string {
  const sign = us < 0 ? '-' : ''
  const totalFrames = Math.abs(frameOfMicros(us, fps))
  const fpsRounded = Math.round(frameRateToNumber(fps))
  const frames = totalFrames % fpsRounded
  const totalSeconds = Math.floor(totalFrames / fpsRounded)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}:${pad(frames, 2)}`
}

/** HH:MM:SS.mmm — dùng cho transcript, phụ đề và nhãn thời lượng. */
export function formatClockTime(us: Micros, showMillis = true): string {
  const sign = us < 0 ? '-' : ''
  const abs = Math.abs(us)
  const millis = Math.floor(abs / 1000) % 1000
  const totalSeconds = Math.floor(abs / MICROS_PER_SECOND)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const head = `${sign}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}`
  return showMillis ? `${head}.${pad(millis, 3)}` : head
}

/** Nhận "HH:MM:SS:FF", "MM:SS:FF" hoặc "SS". Trả null nếu không hợp lệ. */
export function parseTimecode(input: string, fps: FrameRate): Micros | null {
  const trimmed = input.trim()
  if (!/^-?\d+(:\d+){0,3}$/.test(trimmed)) return null
  const negative = trimmed.startsWith('-')
  const parts = (negative ? trimmed.slice(1) : trimmed).split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null

  // Đọc từ phải sang trái: frames, giây, phút, giờ.
  const [frames = 0, seconds = 0, minutes = 0, hours = 0] = parts.slice().reverse()
  const fpsRounded = Math.round(frameRateToNumber(fps))
  if (frames >= fpsRounded && parts.length > 1) return null

  const totalFrames = ((hours * 60 + minutes) * 60 + seconds) * fpsRounded + frames
  const us = microsOfFrame(totalFrames, fps)
  return negative ? -us : us
}
