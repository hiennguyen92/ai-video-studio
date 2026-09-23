import { planChatToolCalls } from '../../../shared/ai/chat-tool-planner'
import { findEditStyle } from '../../../shared/domain/edit-style-catalog'
import { expandEditStyle } from '../../../shared/domain/edit-style-expand'
import { createId } from '../../../shared/domain/project-document-factory'
import { useEditorStore } from './editor-store'

/**
 * Áp một kiểu dựng lên timeline.
 *
 * Đi qua ĐÚNG bộ lập kế hoạch mà agent dùng, không viết lại — cùng lý do như
 * `build-cut-actions`: thẻ bấm và agent cho ra cùng một kết quả, và mọi luật đã
 * có ở đó (từ chối lane khoá, kẹp thời lượng chuyển cảnh) tự áp cho cả hai.
 */

export interface EditStylePlan {
  /** Mô tả tiếng Việt từng việc sẽ làm — do bộ lập kế hoạch sinh ra, không viết tay. */
  steps: string[]
  /** Bước không lập được, kèm lý do. Hiện ra chứ không giấu. */
  failures: Array<{ tool: string; reason: string }>
  /** Số lệnh sẽ áp. 0 nghĩa là bấm cũng không có gì đổi. */
  commandCount: number
}

function planFor(styleId: string): EditStylePlan | { error: string } {
  const style = findEditStyle(styleId)
  if (!style) return { error: 'Không có kiểu dựng này' }
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document) return { error: 'Chưa mở dự án nào' }

  const plan = planChatToolCalls(
    {
      document,
      selectedClipIds: [],
      playheadUs: store.playheadUs,
      makeId: (prefix) => createId(prefix ?? 'clip')
    },
    expandEditStyle(style, document)
  )
  return {
    steps: groupRepeats(plan.steps.map((step) => step.description)),
    failures: plan.failures,
    commandCount: plan.steps.reduce((total, step) => total + step.commands.length, 0)
  }
}

/**
 * Gộp các dòng giống hệt nhau liền kề thành một dòng có số lần.
 *
 * Một kiểu dựng áp lên mười clip sinh ra mười dòng y hệt. Đọc "Đặt zoom punch-in
 * cho clip" mười lần thì không biết thêm gì so với đọc một lần kèm con số, mà
 * phần xem trước lại dài tới mức không ai đọc nữa — tức là mất luôn tác dụng.
 */
function groupRepeats(descriptions: string[]): string[] {
  const grouped: Array<{ text: string; count: number }> = []
  for (const raw of descriptions) {
    // Bỏ id sinh tự động khỏi dòng xem trước. Id là thứ người đọc không dùng
    // được, mà nó lại KHÁC nhau ở từng clip nên chặn luôn việc gộp dòng: bốn clip
    // thành bốn dòng gần y hệt, chỉ lệch một chuỗi vô nghĩa.
    const text = raw.replace(/\s*\(id=[^)]*\)/g, '')
    const last = grouped[grouped.length - 1]
    if (last && last.text === text) last.count += 1
    else grouped.push({ text, count: 1 })
  }
  return grouped.map((row) => (row.count > 1 ? `${row.text} ×${row.count}` : row.text))
}

/**
 * Xem trước: kiểu dựng này sẽ làm gì trên tài liệu ĐANG mở.
 *
 * Bấm một cái mà timeline bị viết lại không báo trước là thứ đáng sợ, kể cả khi
 * hoàn tác được. Lập kế hoạch là hàm thuần nên xem trước không tốn gì ngoài một
 * lần tính.
 */
export function previewEditStyle(styleId: string): EditStylePlan | { error: string } {
  return planFor(styleId)
}

/**
 * Áp kiểu dựng, gộp thành MỘT bước hoàn tác.
 *
 * Bắn mấy chục lệnh thành mấy chục mục lịch sử là phá sạch lịch sử của người dùng:
 * muốn quay lại trước khi áp thì phải bấm hoàn tác mấy chục lần.
 *
 * Lập lại kế hoạch từ đầu chứ không dùng lại bản xem trước — giữa lúc xem và lúc
 * bấm, người dùng có thể đã sửa timeline.
 */
export function applyEditStyle(
  styleId: string,
  label: string
): { ok: true; commandCount: number } | { ok: false; error: string } {
  const style = findEditStyle(styleId)
  if (!style) return { ok: false, error: 'Không có kiểu dựng này' }
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document) return { ok: false, error: 'Chưa mở dự án nào' }

  const plan = planChatToolCalls(
    {
      document,
      selectedClipIds: [],
      playheadUs: store.playheadUs,
      makeId: (prefix) => createId(prefix ?? 'clip')
    },
    expandEditStyle(style, document)
  )
  const commands = plan.steps.flatMap((step) => step.commands)
  if (commands.length === 0) {
    return { ok: false, error: plan.failures[0]?.reason ?? 'Không có gì để áp lên timeline' }
  }
  return store.run(commands, label)
    ? { ok: true, commandCount: commands.length }
    : { ok: false, error: 'Không áp dụng được lên timeline' }
}
