import type { Micros } from './time-units'

/**
 * Keyframe: một thuộc tính ĐỔI GIÁ TRỊ theo thời gian, thay vì một hằng số cho
 * cả clip.
 *
 * Mốc thời gian là OFFSET TỪ MÉP ĐẦU của chủ thể (clip hoặc khối chữ), không
 * phải giờ tuyệt đối trên timeline. Kéo clip sang chỗ khác thì chuyển động đi
 * theo mà không phải sửa một con số nào — còn lưu giờ tuyệt đối thì mỗi lệnh
 * dời clip phải nhớ dịch lại cả mảng, và quên một chỗ là chuyển động trượt khỏi
 * hình.
 *
 * Giá trị luôn là SỐ. Màu và ô chọn (select) không nội suy được theo cách có
 * nghĩa, nên chúng nằm ngoài hệ này thay vì được đỡ nửa vời.
 */

/**
 * Kiểu nội suy, đặt trên TỪNG keyframe.
 *
 * `hold` là thứ bắt buộc phải có chứ không phải cho đủ bộ: bật/tắt một vùng che
 * hay một effect cần đổi DỨT KHOÁT tại đúng một khung, mà linear thì luôn kéo
 * giá trị qua cả đoạn.
 */
export type KeyframeEasing = 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out'

export interface Keyframe {
  /** Offset từ mép đầu chủ thể. */
  atUs: Micros
  /** Giá trị tại mốc đó. */
  v: number
  /**
   * Kiểu nội suy của ĐOẠN ĐI TỪ keyframe này TỚI keyframe kế.
   *
   * Vắng mặt nghĩa là `linear`. Phần lớn keyframe là linear, ghi khoá cho từng
   * cái chỉ làm file dự án phình mà không thêm thông tin.
   */
  e?: KeyframeEasing
}

/**
 * Một đường keyframe của MỘT thuộc tính.
 *
 * BẤT BIẾN: sắp tăng dần theo `atUs`, và mỗi `atUs` chỉ xuất hiện một lần. Mọi
 * đường đi vào tài liệu đều phải qua `normalizeKeyframeTrack` — phần đánh giá
 * chạy mỗi khung hình nên nó tin vào bất biến này thay vì tự sắp lại.
 */
export type KeyframeTrack = Keyframe[]

/**
 * Các đường keyframe của một chủ thể, tra theo ĐƯỜNG DẪN THUỘC TÍNH.
 *
 * Khoá là chuỗi phẳng: `transform.opacity`, `effect.<effectId>.params.<key>`,
 * `style.position.xPct`. Dạng chuỗi để cắm thêm một nhóm thuộc tính chỉ tốn một
 * dòng ở danh mục và một dòng ở chỗ đọc, và để JSON chỉ chứa đúng những thuộc
 * tính THẬT SỰ có chuyển động.
 *
 * Effect tra theo `effectId` chứ không theo chỉ số mảng: lệnh `clip/set-effects`
 * thay CẢ mảng effect, nên chỉ số đổi chỗ là keyframe nhảy sang effect khác —
 * hỏng lặng lẽ và không truy ngược ra được.
 */
export type KeyframeTracks = Record<string, KeyframeTrack>

/** Một keyframe đã quy về KHUNG HÌNH, dùng cho vòng vẽ. */
export interface ResolvedKeyframe {
  /** Số khung, tính theo cùng trục với `useCurrentFrame()` của chủ thể. */
  f: number
  v: number
  e: KeyframeEasing
}

export type ResolvedKeyframeTrack = ResolvedKeyframe[]

/** Bảng keyframe đã quy về khung hình, tra theo cùng đường dẫn như lúc lưu. */
export type ResolvedKeyframeTracks = Record<string, ResolvedKeyframeTrack>

/**
 * Đưa một đường keyframe về dạng bất biến: sắp tăng dần, mỗi mốc một keyframe,
 * giá trị nằm trong khoảng hợp lệ.
 *
 * Kẹp `v` về `[min, max]` là hàng rào chống dữ liệu do agent sinh hoặc do sửa
 * tay file dự án: một `opacity: 40` lọt vào là cả clip trắng xoá, còn `NaN` lọt
 * vào CSS thì clip biến mất mà không có lỗi nào — cùng vai trò với
 * `normalizeEffectParams` trong `clip-effect-types.ts`.
 *
 * Bỏ trống `min`/`max` khi giá trị đã hợp lệ sẵn — ví dụ lúc tách đôi một đường
 * đã nằm trong tài liệu.
 *
 * Trùng `atUs` thì bản SAU thắng: đặt lại keyframe ngay tại đầu phát là thao tác
 * thường xuyên, và người dùng hiểu nó là "ghi đè", không phải "thêm cái thứ hai
 * vào cùng một chỗ".
 */
export function normalizeKeyframeTrack(
  track: readonly Keyframe[],
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
): KeyframeTrack {
  const sorted = [...track]
    .filter((frame) => Number.isFinite(frame.atUs) && Number.isFinite(frame.v))
    // Sắp ỔN ĐỊNH theo `atUs` để luật "bản sau thắng" dựa được vào thứ tự đưa
    // vào: `Array.prototype.sort` của V8 ổn định từ ES2019.
    .sort((left, right) => left.atUs - right.atUs)

  const result: KeyframeTrack = []
  for (const frame of sorted) {
    const atUs = Math.max(0, Math.round(frame.atUs))
    const value = Math.min(max, Math.max(min, frame.v))
    // Bỏ hẳn khoá khi là linear — mặc định đã là linear, ghi ra chỉ tốn chỗ.
    const next: Keyframe =
      frame.e && frame.e !== 'linear' ? { atUs, v: value, e: frame.e } : { atUs, v: value }

    if (result.length > 0 && result[result.length - 1].atUs === atUs) {
      result[result.length - 1] = next
    } else {
      result.push(next)
    }
  }
  return result
}
