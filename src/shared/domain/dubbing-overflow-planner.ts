import type { DubbingSegment, DubbingOverflowStrategy } from './transcript-types'
import type { Micros } from './time-units'

/**
 * Xử lý chuyện lồng tiếng dài hơn khoảng thời gian gốc.
 *
 * Đây là quy tắc cứng của đề bài: KHÔNG BAO GIỜ tự cắt bớt lời nói để ép cho vừa
 * thời gian. Cắt audio là cách dễ nhất và cũng là cách tệ nhất — người xem nghe
 * câu bị đứt giữa chừng mà không hiểu vì sao.
 *
 * Vì vậy module này không bao giờ trả về "cắt". Nó chỉ tính ra ba lối thoát và
 * nói rõ lối nào còn dùng được:
 *
 *   - tăng tốc đọc, nhưng chỉ trong giới hạn còn nghe được (mặc định 1,3x)
 *   - rút ngắn lời thoại rồi đọc lại (người dùng tự viết lại)
 *   - kéo dài timeline, đẩy mọi thứ phía sau lùi lại
 *
 * Mọi con số ở đây dựa trên thời lượng ĐO ĐƯỢC của audio đã tạo, không phải ước
 * lượng theo số ký tự: tốc độ đọc thay đổi rất nhiều theo giọng và theo ngôn ngữ.
 */

export interface SegmentOverflowPlan {
  segmentId: string
  targetSpanUs: Micros
  measuredDurationUs?: Micros
  /** Chưa tạo audio thì chưa kết luận được gì. */
  measured: boolean
  overflowUs: Micros
  /** Hệ số cần thiết để vừa khít khoảng gốc. <= 1 nghĩa là đã vừa. */
  requiredSpeed: number
  /** Tăng tốc có đủ giải quyết mà vẫn nằm trong giới hạn không. */
  canSpeedUp: boolean
  /** Các lối thoát còn dùng được, theo thứ tự nên thử. */
  availableStrategies: DubbingOverflowStrategy[]
}

export function planSegmentOverflow(
  segment: DubbingSegment,
  maxSpeedUp: number
): SegmentOverflowPlan {
  const targetSpanUs = Math.max(0, segment.targetEndUs - segment.targetStartUs)
  const measured = segment.generatedDurationUs !== undefined

  if (!measured || targetSpanUs === 0) {
    return {
      segmentId: segment.id,
      targetSpanUs,
      measuredDurationUs: segment.generatedDurationUs,
      measured,
      overflowUs: 0,
      requiredSpeed: 1,
      canSpeedUp: false,
      availableStrategies: []
    }
  }

  const measuredDurationUs = segment.generatedDurationUs as number
  const overflowUs = Math.max(0, measuredDurationUs - targetSpanUs)
  const requiredSpeed = measuredDurationUs / targetSpanUs

  if (overflowUs === 0) {
    return {
      segmentId: segment.id,
      targetSpanUs,
      measuredDurationUs,
      measured: true,
      overflowUs: 0,
      requiredSpeed,
      canSpeedUp: true,
      availableStrategies: []
    }
  }

  const canSpeedUp = requiredSpeed <= maxSpeedUp
  // Rút ngắn lời và kéo dài timeline luôn khả dụng; tăng tốc thì chỉ khi còn
  // trong ngưỡng nghe được. Xếp tăng tốc lên đầu vì nó ít ảnh hưởng nhất.
  const availableStrategies: DubbingOverflowStrategy[] = canSpeedUp
    ? ['speed-up', 'shorten-text', 'extend-timeline']
    : ['shorten-text', 'extend-timeline']

  return {
    segmentId: segment.id,
    targetSpanUs,
    measuredDurationUs,
    measured: true,
    overflowUs,
    requiredSpeed,
    canSpeedUp,
    availableStrategies
  }
}

export interface PlacedDubbingSegment {
  segmentId: string
  /** Vị trí cuối cùng trên timeline sau khi tính mọi lần đẩy phía trước. */
  startUs: Micros
  endUs: Micros
  /** Tốc độ phát cần đặt cho clip. 1 nghĩa là giữ nguyên. */
  speed: number
  /** Đoạn này có bị đẩy lùi vì đoạn trước kéo dài timeline không. */
  shiftedByUs: Micros
  /** Vẫn còn tràn sau khi áp dụng hướng đã chọn — người dùng phải xử lý tiếp. */
  stillOverflowing: boolean
}

/**
 * Tính vị trí cuối cùng của mọi đoạn lồng tiếng sau khi áp dụng hướng đã chọn.
 *
 * Phải tính dồn theo thứ tự: một đoạn chọn "kéo dài timeline" sẽ đẩy TẤT CẢ các
 * đoạn sau nó lùi lại đúng bằng phần dôi ra. Tính riêng lẻ từng đoạn sẽ cho ra
 * lịch chồng chéo nhau.
 */
export function planDubbingPlacement(
  segments: DubbingSegment[],
  maxSpeedUp: number
): PlacedDubbingSegment[] {
  const ordered = [...segments].sort((left, right) => left.targetStartUs - right.targetStartUs)
  const placed: PlacedDubbingSegment[] = []
  let accumulatedShiftUs = 0

  for (const segment of ordered) {
    const plan = planSegmentOverflow(segment, maxSpeedUp)
    const startUs = segment.targetStartUs + accumulatedShiftUs

    // Chưa tạo audio: giữ đúng khoảng gốc, chưa có gì để tính.
    if (!plan.measured) {
      placed.push({
        segmentId: segment.id,
        startUs,
        endUs: startUs + plan.targetSpanUs,
        speed: 1,
        shiftedByUs: accumulatedShiftUs,
        stillOverflowing: false
      })
      continue
    }

    const measured = plan.measuredDurationUs as number

    if (plan.overflowUs === 0) {
      placed.push({
        segmentId: segment.id,
        startUs,
        endUs: startUs + measured,
        speed: 1,
        shiftedByUs: accumulatedShiftUs,
        stillOverflowing: false
      })
      continue
    }

    const strategy = segment.overflowStrategy

    if (strategy === 'speed-up' && plan.canSpeedUp) {
      // Tăng tốc vừa đủ để khít, không tăng quá mức cần thiết.
      placed.push({
        segmentId: segment.id,
        startUs,
        endUs: startUs + plan.targetSpanUs,
        speed: plan.requiredSpeed,
        shiftedByUs: accumulatedShiftUs,
        stillOverflowing: false
      })
      continue
    }

    if (strategy === 'extend-timeline') {
      // Giữ nguyên audio, đẩy phần còn lại của timeline lùi đúng phần dôi ra.
      placed.push({
        segmentId: segment.id,
        startUs,
        endUs: startUs + measured,
        speed: 1,
        shiftedByUs: accumulatedShiftUs,
        stillOverflowing: false
      })
      accumulatedShiftUs += plan.overflowUs
      continue
    }

    // Chưa chọn hướng, hoặc chọn "rút ngắn lời" mà chưa viết lại: giữ NGUYÊN
    // audio đầy đủ và đánh dấu còn tràn. Tuyệt đối không cắt cho vừa.
    placed.push({
      segmentId: segment.id,
      startUs,
      endUs: startUs + measured,
      speed: 1,
      shiftedByUs: accumulatedShiftUs,
      stillOverflowing: true
    })
  }

  return placed
}

/** Tổng thời lượng timeline bị kéo dài thêm sau khi áp dụng mọi hướng đã chọn. */
export function totalTimelineExtensionUs(segments: DubbingSegment[], maxSpeedUp: number): Micros {
  return segments
    .filter((segment) => segment.overflowStrategy === 'extend-timeline')
    .reduce((total, segment) => total + planSegmentOverflow(segment, maxSpeedUp).overflowUs, 0)
}
