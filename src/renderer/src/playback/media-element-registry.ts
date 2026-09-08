/**
 * Sổ đăng ký các thẻ <video>/<audio> đang gắn trên DOM, tra theo clip id.
 *
 * Vòng lặp đồng bộ chạy 60 lần mỗi giây và cần chạm thẳng vào phần tử DOM.
 * Nếu đẩy việc này qua state của React thì mỗi frame lại render lại cả cây —
 * timeline giật ngay. Sổ đăng ký nằm ngoài React, chỉ React quyết định phần tử
 * nào tồn tại, còn vòng lặp thì điều khiển chúng.
 */
export class MediaElementRegistry {
  private elements = new Map<string, HTMLMediaElement>()

  set(clipId: string, element: HTMLMediaElement | null): void {
    if (element) this.elements.set(clipId, element)
    else this.elements.delete(clipId)
  }

  get(clipId: string): HTMLMediaElement | undefined {
    return this.elements.get(clipId)
  }

  /** Các clip id hiện có phần tử — dùng để tạm dừng những cái không còn hoạt động. */
  ids(): string[] {
    return [...this.elements.keys()]
  }

  clear(): void {
    this.elements.clear()
  }
}

/**
 * Ngưỡng lệch cho phép giữa đồng hồ timeline và đồng hồ của thẻ media.
 *
 * Dưới ngưỡng này thì để phần tử tự chạy: gán `currentTime` liên tục sẽ gây giật
 * hình và tiếng lục cục. Vượt ngưỡng mới seek cứng.
 */
export const PLAYBACK_DRIFT_TOLERANCE_SECONDS = 0.12

/** Lệch nhỏ hơn mức này thì bỏ qua hoàn toàn khi đang tạm dừng. */
export const SEEK_EPSILON_SECONDS = 0.004
