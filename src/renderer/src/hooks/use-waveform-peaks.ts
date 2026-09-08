import { useEffect, useState } from 'react'

/**
 * Nạp dữ liệu peak waveform THẬT cho một asset audio.
 *
 * Peak được ffmpeg giải mã lúc import và ghi ra file nhị phân. Ở đây chỉ đọc lên
 * và nhớ tạm. Khi chưa nạp xong, timeline không vẽ gì cả — cố tình KHÔNG vẽ một
 * đường sóng giả cho đẹp, vì dạng sóng là thứ người dùng dựa vào để cắt đúng chỗ,
 * hình giả sẽ khiến họ cắt sai.
 */

export interface WaveformPeaks {
  bucketsPerSecond: number
  /** Cặp (min, max) cho mỗi bucket, giá trị trong khoảng -1..1. */
  peaks: number[]
}

/** Nhớ tạm ở mức module: nhiều clip cùng dùng một asset chỉ đọc file một lần. */
const cache = new Map<string, WaveformPeaks>()
const pending = new Map<string, Promise<WaveformPeaks | null>>()

async function loadPeaks(waveformPath: string): Promise<WaveformPeaks | null> {
  const cached = cache.get(waveformPath)
  if (cached) return cached

  const inFlight = pending.get(waveformPath)
  if (inFlight) return inFlight

  const request = window.api.media
    .readWaveform(waveformPath)
    .then((result) => {
      if (!result.ok) return null
      cache.set(waveformPath, result.data)
      return result.data
    })
    .catch(() => null)
    .finally(() => pending.delete(waveformPath))

  pending.set(waveformPath, request)
  return request
}

export function useWaveformPeaks(waveformPath: string | undefined): WaveformPeaks | null {
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(() =>
    waveformPath ? (cache.get(waveformPath) ?? null) : null
  )

  useEffect(() => {
    // Không có đường dẫn thì không cần đụng vào state: hàm trả về null ở cuối
    // dựa thẳng vào `waveformPath`, nên gọi setPeaks(null) ở đây chỉ tạo thêm
    // một vòng render thừa.
    if (!waveformPath) return

    let cancelled = false
    // Đi qua promise kể cả khi đã có sẵn trong cache: gọi setState thẳng trong
    // thân effect sẽ kích hoạt thêm một vòng render nữa ngay lập tức.
    void loadPeaks(waveformPath).then((loaded) => {
      if (!cancelled) setPeaks(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [waveformPath])

  // Đường dẫn biến mất (ví dụ clip đổi asset) thì coi như chưa có dữ liệu, thay
  // vì trả về peak cũ của asset trước đó.
  return waveformPath ? peaks : null
}

/**
 * Rút gọn peak về đúng số cột cần vẽ, chỉ lấy phần nằm trong khoảng [fromUs, toUs)
 * của asset. Mỗi cột giữ biên độ lớn nhất trong vùng nó đại diện, nên đỉnh tín
 * hiệu không bị mất khi thu nhỏ.
 */
export function reducePeaksToColumns(
  data: WaveformPeaks,
  fromUs: number,
  toUs: number,
  columnCount: number
): number[] {
  if (columnCount <= 0) return []

  const bucketDurationUs = 1_000_000 / data.bucketsPerSecond
  const firstBucket = Math.max(0, Math.floor(fromUs / bucketDurationUs))
  const lastBucket = Math.min(data.peaks.length / 2, Math.ceil(toUs / bucketDurationUs))
  const bucketSpan = lastBucket - firstBucket
  if (bucketSpan <= 0) return []

  const columns = new Array<number>(columnCount).fill(0)
  for (let column = 0; column < columnCount; column += 1) {
    const start = firstBucket + Math.floor((column / columnCount) * bucketSpan)
    const end = Math.max(
      start + 1,
      firstBucket + Math.floor(((column + 1) / columnCount) * bucketSpan)
    )

    let amplitude = 0
    for (let bucket = start; bucket < end; bucket += 1) {
      const minValue = data.peaks[bucket * 2] ?? 0
      const maxValue = data.peaks[bucket * 2 + 1] ?? 0
      amplitude = Math.max(amplitude, Math.abs(minValue), Math.abs(maxValue))
    }
    columns[column] = amplitude
  }
  return columns
}
