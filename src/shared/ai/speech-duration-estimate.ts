/**
 * Ước lượng một câu đọc ra sẽ dài bao nhiêu giây.
 *
 * Vì sao cần: kịch bản viết xong mới biết đọc mất bao lâu, mà lúc đó audio đã
 * sinh rồi. Với video ngắn, một câu dài hơn cảnh của nó là phải viết lại — nên
 * con số phải hiện ra TRƯỚC khi bấm tạo.
 *
 * Nguyên tắc: **ưu tiên số đo thật của chính dự án này**. Mỗi giọng, mỗi tốc độ,
 * mỗi provider đọc một nhịp khác nhau, nên một hằng số viết cứng sẽ sai với phần
 * lớn trường hợp. Khi trong dự án đã có vài đoạn audio thật, dùng chính chúng để
 * hiệu chỉnh; chưa có thì mới dùng mức mặc định, và giao diện phải nói rõ đang
 * dùng cái nào (DESCRIPTION §3.B — không bày số như thể đã đo).
 */

export interface SpeechCalibration {
  /** Khoảng lặng cố định hai đầu, không phụ thuộc câu dài hay ngắn. */
  interceptSeconds: number
  secondsPerCharacter: number
  /** Số mẫu đã dùng để hiệu chỉnh. 0 nghĩa là đang dùng mức mặc định. */
  sampleCount: number
}

export interface SpeechSample {
  characters: number
  seconds: number
}

/**
 * Mức mặc định khi chưa có mẫu nào.
 *
 * Hồi quy từ 9 câu tiếng Việt đọc thật bằng Edge TTS, giọng HoaiMy, tốc độ +10%:
 * `giây ≈ 0,72 + 0,064 × số ký tự`. Đây là ĐIỂM XUẤT PHÁT, không phải hằng số
 * đúng cho mọi giọng — sai số quan sát được là ±0,2s ngay trong chính bộ mẫu đó
 * (hai câu cùng 24 ký tự cho ra 2,31s và 2,52s).
 */
export const DEFAULT_SPEECH_CALIBRATION: SpeechCalibration = {
  interceptSeconds: 0.72,
  secondsPerCharacter: 0.064,
  sampleCount: 0
}

/** Dưới ngần này mẫu thì hồi quy chỉ là nhiễu; giữ mức mặc định. */
const MIN_SAMPLES = 3

/**
 * Hiệu chỉnh từ những đoạn ĐÃ sinh audio trong dự án.
 *
 * Trả về `null` khi không đủ dữ liệu để tin: quá ít mẫu, hoặc mọi mẫu dài bằng
 * nhau nên không có độ dốc. Trả mặc định trong những trường hợp đó tốt hơn là
 * trả một đường hồi quy dựng trên hai điểm.
 */
export function calibrateFromSamples(samples: SpeechSample[]): SpeechCalibration | null {
  const usable = samples.filter(
    (sample) =>
      Number.isFinite(sample.characters) &&
      Number.isFinite(sample.seconds) &&
      sample.characters > 0 &&
      sample.seconds > 0
  )
  if (usable.length < MIN_SAMPLES) return null

  const count = usable.length
  const sumX = usable.reduce((total, sample) => total + sample.characters, 0)
  const sumY = usable.reduce((total, sample) => total + sample.seconds, 0)
  const sumXX = usable.reduce((total, sample) => total + sample.characters ** 2, 0)
  const sumXY = usable.reduce((total, sample) => total + sample.characters * sample.seconds, 0)

  const denominator = count * sumXX - sumX * sumX
  // Mọi mẫu cùng độ dài ký tự thì không suy ra được tốc độ đọc.
  if (denominator === 0) return null

  const secondsPerCharacter = (count * sumXY - sumX * sumY) / denominator
  const interceptSeconds = (sumY - secondsPerCharacter * sumX) / count

  // Dốc âm nghĩa là câu dài hơn lại đọc nhanh hơn — dữ liệu nhiễu, không dùng.
  if (secondsPerCharacter <= 0) return null

  return {
    // Khoảng lặng âm là vô nghĩa; kẹp về 0 thay vì trả một mô hình sai hẳn.
    interceptSeconds: Math.max(0, interceptSeconds),
    secondsPerCharacter,
    sampleCount: count
  }
}

/** Ước lượng độ dài đọc của một câu, tính bằng giây. */
export function estimateSpeechSeconds(
  text: string,
  calibration: SpeechCalibration = DEFAULT_SPEECH_CALIBRATION
): number {
  const characters = text.trim().length
  if (characters === 0) return 0

  return calibration.interceptSeconds + calibration.secondsPerCharacter * characters
}

/**
 * Số ký tự tối đa còn nằm trong khoảng thời gian cho phép.
 *
 * Dùng cho lời gợi ý khi câu quá dài: nói "rút còn ~28 ký tự" cụ thể hơn hẳn
 * "câu này dài quá".
 */
export function maxCharactersWithin(
  seconds: number,
  calibration: SpeechCalibration = DEFAULT_SPEECH_CALIBRATION
): number {
  const available = seconds - calibration.interceptSeconds
  if (available <= 0 || calibration.secondsPerCharacter <= 0) return 0

  return Math.floor(available / calibration.secondsPerCharacter)
}
