import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPEECH_CALIBRATION,
  calibrateFromSamples,
  estimateSpeechSeconds,
  maxCharactersWithin
} from './speech-duration-estimate'

/**
 * Ước lượng độ dài đọc.
 *
 * Điều cần chứng minh không phải "công thức tính đúng", mà là **con số hiện ra
 * bám theo số đo thật của dự án**: mỗi giọng và mỗi tốc độ đọc một nhịp khác
 * nhau, nên hiệu chỉnh từ audio đã sinh phải thắng mức mặc định. Và khi dữ liệu
 * không đủ tin thì phải trả `null` để giao diện nói rõ đang dùng mức mặc định,
 * chứ không lặng lẽ đưa ra một đường hồi quy dựng trên hai điểm.
 */

/** Chín câu đọc thật bằng Edge TTS, giọng HoaiMy, tốc độ +10%. */
const MEASURED = [
  { characters: 39, seconds: 3.05 },
  { characters: 37, seconds: 3.05 },
  { characters: 29, seconds: 2.44 },
  { characters: 24, seconds: 2.31 },
  { characters: 24, seconds: 2.52 },
  { characters: 38, seconds: 3.14 },
  { characters: 31, seconds: 2.43 },
  { characters: 41, seconds: 3.76 },
  { characters: 35, seconds: 2.72 }
]

describe('estimateSpeechSeconds', () => {
  it('câu rỗng thì không mất giây nào', () => {
    expect(estimateSpeechSeconds('')).toBe(0)
    expect(estimateSpeechSeconds('   ')).toBe(0)
  })

  it('câu dài hơn thì lâu hơn', () => {
    const short = estimateSpeechSeconds('Gió mạnh')
    const long = estimateSpeechSeconds('Gió mạnh mà chạy rất êm, mát cả mặt lẫn cổ')

    expect(long).toBeGreaterThan(short)
  })

  it('bám sát số đo thật trong khoảng sai số quan sát được', () => {
    for (const sample of MEASURED) {
      const estimated = estimateSpeechSeconds('x'.repeat(sample.characters))
      // ±0,45s: chính bộ mẫu đã có hai câu cùng 24 ký tự lệch nhau 0,21s, nên
      // đòi sát hơn thế là đòi thứ dữ liệu không có.
      expect(Math.abs(estimated - sample.seconds)).toBeLessThan(0.45)
    }
  })

  it('giữ phần khoảng lặng cố định kể cả với câu rất ngắn', () => {
    // Một chữ vẫn tốn khoảng lặng hai đầu; bỏ nó đi thì ước lượng câu ngắn hụt
    // hẳn, mà câu ngắn chính là thứ video ngắn dùng nhiều nhất.
    expect(estimateSpeechSeconds('Ừ')).toBeGreaterThan(DEFAULT_SPEECH_CALIBRATION.interceptSeconds)
  })
})

describe('calibrateFromSamples', () => {
  it('dựng lại được nhịp đọc từ audio đã sinh', () => {
    const calibration = calibrateFromSamples(MEASURED)

    expect(calibration).not.toBeNull()
    expect(calibration?.sampleCount).toBe(MEASURED.length)
    expect(calibration?.secondsPerCharacter).toBeGreaterThan(0)

    // Hiệu chỉnh từ chính bộ mẫu phải khớp bộ mẫu ít nhất bằng mức mặc định.
    for (const sample of MEASURED) {
      const text = 'x'.repeat(sample.characters)
      const fitted = Math.abs(estimateSpeechSeconds(text, calibration!) - sample.seconds)
      expect(fitted).toBeLessThan(0.45)
    }
  })

  it('giọng đọc chậm hơn cho ra hiệu chỉnh chậm hơn hẳn mặc định', () => {
    // Đây là lý do tồn tại của việc hiệu chỉnh: một giọng đọc chậm gấp đôi mà vẫn
    // hiện con số của giọng nhanh thì cảnh báo "quá dài" sẽ sai hàng loạt.
    const slow = calibrateFromSamples(
      MEASURED.map((sample) => ({ ...sample, seconds: sample.seconds * 2 }))
    )

    expect(slow).not.toBeNull()
    expect(slow!.secondsPerCharacter).toBeGreaterThan(
      DEFAULT_SPEECH_CALIBRATION.secondsPerCharacter * 1.5
    )
    expect(estimateSpeechSeconds('x'.repeat(30), slow!)).toBeGreaterThan(
      estimateSpeechSeconds('x'.repeat(30)) * 1.5
    )
  })

  it('quá ít mẫu thì không hiệu chỉnh', () => {
    expect(calibrateFromSamples([])).toBeNull()
    expect(calibrateFromSamples(MEASURED.slice(0, 2))).toBeNull()
  })

  it('mọi mẫu cùng độ dài thì không suy ra được tốc độ', () => {
    expect(
      calibrateFromSamples([
        { characters: 30, seconds: 2.5 },
        { characters: 30, seconds: 2.6 },
        { characters: 30, seconds: 2.4 }
      ])
    ).toBeNull()
  })

  it('bỏ qua mẫu vô nghĩa thay vì để chúng kéo lệch đường hồi quy', () => {
    const withJunk = calibrateFromSamples([
      ...MEASURED,
      { characters: 0, seconds: 0 },
      { characters: 20, seconds: 0 },
      { characters: Number.NaN, seconds: 2 }
    ])

    expect(withJunk?.sampleCount).toBe(MEASURED.length)
  })

  it('dữ liệu ngược đời — câu dài lại đọc nhanh hơn — thì từ chối', () => {
    expect(
      calibrateFromSamples([
        { characters: 10, seconds: 5 },
        { characters: 20, seconds: 3 },
        { characters: 30, seconds: 1 }
      ])
    ).toBeNull()
  })
})

describe('maxCharactersWithin', () => {
  it('nói được câu nên rút còn bao nhiêu ký tự', () => {
    expect(maxCharactersWithin(3)).toBeGreaterThan(maxCharactersWithin(2))
    // Con số phải khớp với chính hàm ước lượng, nếu không thì gợi ý rút gọn xong
    // vẫn báo quá dài.
    const limit = maxCharactersWithin(3)
    expect(estimateSpeechSeconds('x'.repeat(limit))).toBeLessThanOrEqual(3)
  })

  it('khoảng thời gian ngắn hơn cả phần lặng thì không chứa nổi chữ nào', () => {
    expect(maxCharactersWithin(0.5)).toBe(0)
    expect(maxCharactersWithin(0)).toBe(0)
  })
})
