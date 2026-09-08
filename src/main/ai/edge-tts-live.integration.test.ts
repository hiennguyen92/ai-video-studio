import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdapterContext } from '../../shared/ai/ai-provider-contracts'
import { probeMediaFile } from '../media/media-probe'
import { edgeTtsAdapter } from './edge-tts-adapter'

/**
 * Kiểm thử GỌI THẬT dịch vụ đọc văn bản của Microsoft Edge.
 *
 * Chỉ chạy khi đặt `AVS_LIVE_EDGE_TTS=1`; không có thì cả nhóm bị bỏ qua, nên máy
 * không có mạng và CI vẫn chạy được toàn bộ test suite.
 *
 *   AVS_LIVE_EDGE_TTS=1 npx vitest run src/main/ai/edge-tts-live
 *
 * Đây là phép thử duy nhất chứng minh được thứ mà test thuần không chứng minh
 * nổi: giao thức không tài liệu này VẪN CÒN chạy. Endpoint là của nội bộ trình
 * duyệt Edge, Microsoft đổi lúc nào cũng được — và lúc đó nhóm test này là chỗ
 * báo động sớm nhất.
 */

const live = process.env.AVS_LIVE_EDGE_TTS === '1' ? describe : describe.skip

/** Câu ngắn nhưng đủ dấu thanh, dấu mũ và dấu móc của tiếng Việt. */
const VIETNAMESE_PHRASE = 'Xin chào, đây là bản thử giọng đọc tiếng Việt.'
const MP3_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

let workDir: string

function context(): AdapterContext {
  return { apiKey: '', signal: new AbortController().signal }
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'avs-edge-tts-'))
})

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

live('Edge TTS gọi thật', () => {
  it('liệt kê được giọng, trong đó có giọng tiếng Việt', async () => {
    const voices = await edgeTtsAdapter.listVoices(context(), { language: 'vi' })

    expect(voices.length).toBeGreaterThan(100)

    const vietnamese = voices.filter((voice) => voice.verifiedForLanguage)
    expect(vietnamese.length).toBeGreaterThanOrEqual(2)
    // Giọng tiếng Việt phải đứng ĐẦU danh sách, nếu không người dùng phải cuộn
    // qua hơn ba trăm giọng mới thấy thứ mình cần.
    expect(voices[0].verifiedForLanguage).toBe(true)
    expect(vietnamese.map((voice) => voice.id)).toContain('vi-VN-HoaiMyNeural')
  }, 60_000)

  it('không cần khoá vẫn kết nối được', async () => {
    const result = await edgeTtsAdapter.testConnection(context())

    expect(result.ok).toBe(true)
    expect(result.details).toContain('tiếng Việt')
  }, 60_000)

  it('đọc tiếng Việt ra file MP3 phát được, có tiếng thật', async () => {
    const result = await edgeTtsAdapter.synthesize(context(), {
      model: 'edge-neural',
      voiceId: 'vi-VN-HoaiMyNeural',
      text: VIETNAMESE_PHRASE,
      parameters: { rate: 0, pitch: 0, volume: 0 },
      outputFormat: MP3_FORMAT
    })

    expect(result.fileExtension).toBe('mp3')
    expect(result.audio.byteLength).toBeGreaterThan(5_000)

    // Kiểm bằng ffprobe chứ không chỉ đếm byte: một chuỗi byte bất kỳ cũng "lớn
    // hơn 5.000" mà không phải audio.
    const audioPath = join(workDir, 'giong-doc.mp3')
    await writeFile(audioPath, result.audio)
    const { probe } = await probeMediaFile(audioPath)

    expect(probe.hasAudio).toBe(true)
    expect(probe.durationUs).toBeGreaterThan(1_500_000)
  }, 120_000)

  it('tăng tốc độ đọc làm audio NGẮN LẠI', async () => {
    const durations: number[] = []

    for (const rate of [0, 50]) {
      const result = await edgeTtsAdapter.synthesize(context(), {
        model: 'edge-neural',
        voiceId: 'vi-VN-HoaiMyNeural',
        text: VIETNAMESE_PHRASE,
        parameters: { rate, pitch: 0, volume: 0 },
        outputFormat: MP3_FORMAT
      })

      const audioPath = join(workDir, `rate-${rate}.mp3`)
      await writeFile(audioPath, result.audio)
      durations.push((await probeMediaFile(audioPath)).probe.durationUs)
    }

    // Nếu tham số tốc độ không tới được máy chủ thì hai lần đọc dài bằng nhau, và
    // ô chỉnh tốc độ trên giao diện chỉ là đồ trang trí.
    expect(durations[1]).toBeLessThan(durations[0] * 0.85)
  }, 180_000)

  it('nhiều lần gọi liên tiếp đều ra file giải mã được, không có file cụt', async () => {
    // Dịch vụ này thỉnh thoảng cắt luồng giữa chừng. Quan sát thật khi đọc chín
    // câu liên tiếp: một câu ra file MP3 mà ffprobe không mở nổi. Adapter phải
    // thấy thiếu `turn.end` rồi đọc lại, nên phép thử là gọi liên tiếp và bắt
    // buộc MỌI file đều giải mã được.
    const lines = [
      'Gấp lại nhỏ như cây bút, bỏ túi quần luôn.',
      'Kiêm cả sạc dự phòng, cổng USB và Type C.',
      'Gập chân đế xuống là để bàn, rảnh cả hai tay.',
      'Giỏ hàng màu cam ngay bên dưới nhé.',
      'Mở ra hai giây là thành quạt.'
    ]

    for (const [index, text] of lines.entries()) {
      const result = await edgeTtsAdapter.synthesize(context(), {
        model: 'edge-neural',
        voiceId: 'vi-VN-HoaiMyNeural',
        text,
        parameters: { rate: 0, pitch: 0, volume: 0 },
        outputFormat: MP3_FORMAT
      })

      const audioPath = join(workDir, `lien-tiep-${index}.mp3`)
      await writeFile(audioPath, result.audio)
      const { probe } = await probeMediaFile(audioPath)

      expect(probe.hasAudio).toBe(true)
      // Câu ngắn nhất trong danh sách cũng phải hơn 1,5 giây; file cụt sẽ ngắn hơn
      // hẳn hoặc không đọc được thời lượng.
      expect(probe.durationUs).toBeGreaterThan(1_500_000)
    }
  }, 300_000)

  it('từ chối định dạng ngoài danh sách đã kiểm chứng, ngay tại chỗ', async () => {
    await expect(
      edgeTtsAdapter.synthesize(context(), {
        model: 'edge-neural',
        voiceId: 'vi-VN-HoaiMyNeural',
        text: 'thử',
        parameters: {},
        // Định dạng này có trong tài liệu không chính thức nhưng đo thật luôn ra
        // 0 byte, nên adapter phải chặn trước khi mở kết nối.
        outputFormat: 'riff-24khz-16bit-mono-pcm'
      })
    ).rejects.toThrow(/không nằm trong danh sách/)
  }, 30_000)
})
