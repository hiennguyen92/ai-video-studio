import type { ChatToolName } from '../ai/chat-tool-catalog'
import type { AspectRatio } from './project-document-types'

/**
 * Kiểu dựng: một cách dựng cả timeline, đóng gói thành một thẻ bấm được.
 *
 * Đây là DỮ LIỆU THUẦN, không phải mã chạy được. Mỗi bước trỏ tới một công cụ đã
 * có trong `chat-tool-catalog`, và lúc áp thì đi qua đúng bộ lập kế hoạch mà agent
 * dùng (`planChatToolCalls`). Không có động cơ thực thi thứ hai — nút bấm và agent
 * cho ra cùng một kết quả, và mọi luật đã có ở đó tự áp cho cả hai.
 *
 * Cùng khuôn với `export-presets.ts`: id là union kiểu chứ không phải chuỗi tự do,
 * nên thêm một kiểu dựng mà quên nhãn là TypeScript báo ngay.
 */

/**
 * Bước này áp cho cái gì.
 *
 * Công cụ nhận id clip lẻ, còn kiểu dựng nói về cả timeline — nên phải có chỗ
 * ghi "cho từng clip" hay "cho từng chỗ nối". Việc giãn ra thành id cụ thể làm ở
 * `expandEditStyle`, và làm trên tài liệu THẬT chứ không đoán trước.
 */
export type EditStyleTarget =
  /** Một lời gọi duy nhất cho cả dự án. */
  | 'project'
  /** Một lời gọi cho mỗi clip trên track hình. */
  | 'each-visual-clip'
  /** Một lời gọi cho mỗi chỗ nối giữa hai clip liền nhau. */
  | 'each-junction'

export interface EditStyleStep {
  tool: ChatToolName
  target: EditStyleTarget
  /** Tham số cố định. Phần id do `expandEditStyle` điền theo `target`. */
  args: Record<string, unknown>
  /**
   * Biến thể xoay vòng, đắp lên `args` theo thứ tự từng mục.
   *
   * Cùng một chuyển động cho mọi clip là thứ tố cáo ngay rằng video do máy dựng:
   * mười clip cùng đẩy vào một kiểu thì mắt bắt được nhịp lặp và thôi tin. Người
   * dựng thật đổi chiều liên tục — đẩy vào, lia trái, kéo ra, lia phải.
   *
   * `null` là BỎ QUA mục đó — không phát lời gọi nào. Dùng cho thứ chỉ nên xuất
   * hiện lác đác: loé sáng lọt ống kính mà cảnh nào cũng có thì nó thành bộ lọc,
   * không còn là tai nạn của ống kính. Đặt cường độ 0 KHÔNG thay được: effect vẫn
   * bị thêm vào clip, vẫn tốn một lớp vẽ, và vẫn nằm đó trong Inspector.
   *
   * Chỉ có nghĩa với `target` chạy trên nhiều mục.
   */
  cycle?: Array<Record<string, unknown> | null>
}

export interface EditStyle {
  id:
    | 'vertical-short'
    | 'cinematic'
    | 'tutorial'
    | 'repurpose-vertical'
    | 'travel-vlog'
    | 'trailer'
    | 'retro-film'
    | 'photo-slideshow'
  /** Khung hình kiểu dựng này nhắm tới — hiện trên thẻ để người dùng biết trước. */
  aspect: AspectRatio
  steps: EditStyleStep[]
}

export const EDIT_STYLES: EditStyle[] = [
  {
    // Nhịp nhanh, tương phản cao: thứ giữ được người xem ở mấy giây đầu.
    id: 'vertical-short',
    aspect: '9:16',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '9:16' } },
      {
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: { kind: 'whip-left', durationSeconds: 0.25 }
      },
      {
        tool: 'set_clip_zoom',
        target: 'each-visual-clip',
        args: { kind: 'punch-in', intensity: 0.6 }
      },
      {
        tool: 'set_clip_filter',
        target: 'each-visual-clip',
        args: { filterId: 'street-contrast', intensity: 0.5 }
      }
    ]
  },
  {
    // Nhịp chậm, màu ấm-lạnh tách bạch, tối góc nhẹ.
    id: 'cinematic',
    aspect: '16:9',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '16:9' } },
      {
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: { kind: 'fade', durationSeconds: 0.6 }
      },
      {
        // Đẩy vào RẤT chậm: cú đẩy thấy được là thành quảng cáo, không còn là phim.
        tool: 'set_clip_zoom',
        target: 'each-visual-clip',
        args: { kind: 'zoom-in', intensity: 0.25 }
      },
      {
        tool: 'set_clip_filter',
        target: 'each-visual-clip',
        args: { filterId: 'teal-orange', intensity: 0.7 }
      },
      {
        tool: 'set_clip_adjust',
        target: 'each-visual-clip',
        args: { contrast: 1.08, saturation: 0.95, vignette: 0.25 }
      }
    ]
  },
  {
    // Kiểu này hay ở chỗ nó KIỀM CHẾ.
    //
    // Quay màn hình và người nói thì chữ phải đọc được và tay phải theo kịp:
    // zoom làm chóng mặt, đổi màu làm chữ mờ đi. Nên ở đây cố ý không có cả hai —
    // một kiểu dựng tốt cũng là một danh sách những thứ KHÔNG làm.
    id: 'tutorial',
    aspect: '16:9',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '16:9' } },
      {
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: { kind: 'fade', durationSeconds: 0.2 }
      },
      {
        tool: 'set_clip_adjust',
        target: 'each-visual-clip',
        args: { contrast: 1.05, brightness: 1.02 }
      }
    ]
  },
  {
    // Đưa footage NGANG sang khung dọc mà không cắt mất đầu người.
    //
    // Cách dùng nhiều nhất ngoài đời: quay 16:9 rồi cần bản cho Shorts/Reels.
    // Cắt cúp là mất hai bên; nền mờ giữ trọn khung hình và lấp phần trên dưới
    // bằng chính hình đó, nhoè và tối đi.
    id: 'repurpose-vertical',
    aspect: '9:16',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '9:16' } },
      // `all` áp cho mọi clip lane hình trong MỘT lời gọi — công cụ đã làm sẵn
      // việc này, không cần giãn ra từng clip.
      {
        tool: 'set_background_fill',
        target: 'project',
        args: { all: true, kind: 'blur', amount: 0.6 }
      },
      {
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: { kind: 'fade', durationSeconds: 0.3 }
      }
    ]
  },
  {
    // Nắng vàng, chuyển động đổi chiều liên tục, mép gạt mềm.
    id: 'travel-vlog',
    aspect: '16:9',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '16:9' } },
      {
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: { durationSeconds: 0.4 },
        cycle: [{ kind: 'soft-wipe-left' }, { kind: 'fade' }, { kind: 'soft-wipe-right' }]
      },
      {
        tool: 'set_clip_zoom',
        target: 'each-visual-clip',
        args: { intensity: 0.4 },
        cycle: [
          { kind: 'zoom-in' },
          { kind: 'pan-left' },
          { kind: 'zoom-out' },
          { kind: 'pan-right' }
        ]
      },
      {
        tool: 'set_clip_filter',
        target: 'each-visual-clip',
        args: { filterId: 'golden-hour', intensity: 0.6 }
      }
    ]
  },
  {
    // Chìm vào đen giữa các cảnh, cú đấm ở chỗ nối, màu bạc tương phản cao.
    id: 'trailer',
    aspect: '16:9',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '16:9' } },
      {
        // Xen kẽ chìm-đen với cú đấm: toàn chìm đen thì lê thê, toàn cú đấm thì
        // mệt. Trailer sống bằng chỗ nghỉ giữa hai cú.
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: {},
        cycle: [
          { kind: 'dip-to-black', durationSeconds: 0.5 },
          { kind: 'impact', durationSeconds: 0.3 }
        ]
      },
      {
        tool: 'set_clip_zoom',
        target: 'each-visual-clip',
        args: { kind: 'punch-in', intensity: 0.45 }
      },
      {
        tool: 'set_clip_filter',
        target: 'each-visual-clip',
        args: { filterId: 'silver-bleach', intensity: 0.65 }
      },
      {
        tool: 'set_clip_adjust',
        target: 'each-visual-clip',
        args: { contrast: 1.2, saturation: 0.8, vignette: 0.4 }
      }
    ]
  },
  {
    // Phim nhựa cũ: màu ngả vàng, hạt phim, loé sáng lọt ống kính.
    //
    // Kiểu duy nhất dùng tới effect CHỒNG lên clip — hạt phim và loé sáng không
    // phải là màu, nên look màu không làm được.
    id: 'retro-film',
    aspect: '16:9',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '16:9' } },
      {
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: { durationSeconds: 0.35 },
        cycle: [{ kind: 'flash' }, { kind: 'fade' }]
      },
      {
        tool: 'set_clip_filter',
        target: 'each-visual-clip',
        args: { filterId: 'warm-vintage', intensity: 0.7 }
      },
      {
        tool: 'add_clip_effect',
        target: 'each-visual-clip',
        args: { kind: 'film-grain', intensity: 0.35 }
      },
      {
        // Loé sáng chỉ trên một phần clip, không phải tất cả: loé đều mọi cảnh
        // thì nó thành bộ lọc chứ không còn là tai nạn của ống kính.
        tool: 'add_clip_effect',
        target: 'each-visual-clip',
        args: { kind: 'light-leak', intensity: 0.3 },
        cycle: [{ intensity: 0.3 }, null, { intensity: 0.22 }, null]
      }
    ]
  },
  {
    // Ảnh tĩnh thành video: Ken Burns đổi chiều từng tấm.
    //
    // Ảnh không có chuyển động nào của chính nó, nên chuyển động PHẢI do dựng
    // sinh ra — đứng yên là thành trình chiếu slide, không phải video.
    id: 'photo-slideshow',
    aspect: '16:9',
    steps: [
      { tool: 'set_canvas', target: 'project', args: { aspect: '16:9' } },
      {
        tool: 'set_cut_transition',
        target: 'each-junction',
        args: { durationSeconds: 0.5 },
        cycle: [{ kind: 'circle-open' }, { kind: 'soft-wipe-left' }, { kind: 'fade' }]
      },
      {
        tool: 'set_clip_zoom',
        target: 'each-visual-clip',
        args: { intensity: 0.55 },
        cycle: [
          { kind: 'zoom-in' },
          { kind: 'pan-right' },
          { kind: 'zoom-out' },
          { kind: 'pan-left' },
          { kind: 'pan-up' }
        ]
      },
      // Nền mờ vì ảnh hiếm khi đúng tỉ lệ khung: không có nó là hai dải đen.
      {
        tool: 'set_background_fill',
        target: 'project',
        args: { all: true, kind: 'blur', amount: 0.5 }
      }
    ]
  }
]

export function findEditStyle(id: string): EditStyle | undefined {
  return EDIT_STYLES.find((style) => style.id === id)
}
