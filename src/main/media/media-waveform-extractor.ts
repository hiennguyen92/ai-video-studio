import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'

/**
 * Trích peak waveform để vẽ dạng sóng trên timeline.
 *
 * Cách làm: bảo ffmpeg giải mã ra PCM mono 16-bit ở tần số thấp rồi đẩy qua stdout,
 * Node gom thành từng bucket và giữ lại min/max. Không ghi file WAV trung gian —
 * với video dài, file trung gian vừa chậm vừa tốn đĩa.
 *
 * Định dạng file peaks: Int16LE, hai giá trị (min, max) cho mỗi bucket.
 */

/** Số bucket cho mỗi giây timeline. 100 là đủ mịn ở mức zoom cao nhất. */
export const WAVEFORM_BUCKETS_PER_SECOND = 100

const DECODE_SAMPLE_RATE = 8000

export interface WaveformResult {
  bucketsPerSecond: number
  bucketCount: number
}

export async function extractWaveformPeaks(
  inputPath: string,
  outputPath: string
): Promise<WaveformResult> {
  const { ffmpegPath } = resolveFfmpegBinaries()
  const samplesPerBucket = Math.max(1, Math.round(DECODE_SAMPLE_RATE / WAVEFORM_BUCKETS_PER_SECOND))

  const child = spawn(ffmpegPath, [
    '-v',
    'error',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(DECODE_SAMPLE_RATE),
    '-f',
    's16le',
    '-acodec',
    'pcm_s16le',
    'pipe:1'
  ])

  const peaks: number[] = []
  let bucketMin = 0
  let bucketMax = 0
  let samplesInBucket = 0
  /** Byte lẻ còn sót lại giữa hai chunk — một sample là 2 byte. */
  let carry: Buffer | null = null

  const flushBucket = (): void => {
    peaks.push(bucketMin, bucketMax)
    bucketMin = 0
    bucketMax = 0
    samplesInBucket = 0
  }

  child.stdout.on('data', (chunk: Buffer) => {
    let data = chunk
    if (carry) {
      data = Buffer.concat([carry, chunk])
      carry = null
    }
    const usableLength = data.length - (data.length % 2)
    if (usableLength < data.length) {
      carry = Buffer.from(data.subarray(usableLength))
    }

    for (let offset = 0; offset < usableLength; offset += 2) {
      const sample = data.readInt16LE(offset)
      if (sample < bucketMin) bucketMin = sample
      if (sample > bucketMax) bucketMax = sample
      samplesInBucket += 1
      if (samplesInBucket >= samplesPerBucket) flushBucket()
    }
  })

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg thoát với mã ${code}: ${stderr.trim()}`))
    })
  })

  if (samplesInBucket > 0) flushBucket()

  const buffer = Buffer.allocUnsafe(peaks.length * 2)
  peaks.forEach((value, index) => {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, value)), index * 2)
  })
  await writeFile(outputPath, buffer)

  return { bucketsPerSecond: WAVEFORM_BUCKETS_PER_SECOND, bucketCount: peaks.length / 2 }
}
