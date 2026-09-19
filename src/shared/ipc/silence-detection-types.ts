import type { Micros } from '../domain/time-units'

/** Dò khoảng lặng trên đoạn `[startUs, endUs)` của file NGUỒN. */
export interface SilenceDetectionRequest {
  sourcePath: string
  startUs: Micros
  endUs: Micros
  /** Dưới mức này (dBFS) là im. -35 dB hợp với giọng nói thu gần. */
  noiseDb: number
  /** Im ngắn hơn chừng này thì không tính — nhịp thở giữa hai chữ không phải khoảng lặng. */
  minSilenceUs: Micros
}

/** Một khoảng lặng, mốc trên trục thời gian của FILE NGUỒN. */
export interface SilenceInterval {
  startUs: Micros
  endUs: Micros
}
