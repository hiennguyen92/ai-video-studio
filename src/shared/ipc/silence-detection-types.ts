import type { Micros } from '../domain/time-units'

/** Dò khoảng lặng trên đoạn `[startUs, endUs)` của file NGUỒN. */
export interface SilenceDetectionRequest {
  sourcePath: string
  startUs: Micros
  endUs: Micros
  /**
   * Dưới mức ĐỈNH này (dBFS) là im. Bỏ trống thì tự đo nền nhiễu của chính đoạn
   * này rồi đặt ngưỡng — một con số cố định đúng với phòng này thì sai với phòng kia.
   */
  noiseDb?: number
  /** Im ngắn hơn chừng này thì không tính — nhịp thở giữa hai chữ không phải khoảng lặng. */
  minSilenceUs: Micros
}

/** Kết quả dò: khoảng lặng, và ngưỡng đã DÙNG (tự đo hay do người gọi đặt). */
export interface SilenceDetectionResult {
  intervals: SilenceInterval[]
  thresholdDb: number
  /** Ngưỡng do máy tự đo — hiển thị cho người dùng biết mà chỉnh nếu cần. */
  automatic: boolean
}

/** Một khoảng lặng, mốc trên trục thời gian của FILE NGUỒN. */
export interface SilenceInterval {
  startUs: Micros
  endUs: Micros
}
