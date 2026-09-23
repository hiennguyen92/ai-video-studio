import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from 'immer'
import type { ProjectDocument } from '../domain/project-document-types'
import { applyEditorCommand } from './editor-command-reducer'
import type { EditorCommand } from './editor-command-types'

enablePatches()

/**
 * Lịch sử undo/redo dựa trên patch của immer.
 *
 * Lưu patch thay vì lưu bản sao cả document: một project có hàng trăm clip và
 * hàng nghìn segment transcript, sao chép nguyên document sau mỗi thao tác kéo
 * chuột sẽ ngốn bộ nhớ rất nhanh.
 *
 * Một GIAO DỊCH gồm nhiều command chỉ tạo ĐÚNG MỘT bước undo. Nhờ vậy một thay
 * đổi nhiều bước do AI thực hiện được hoàn tác trong một lần (DESCRIPTION §5).
 * Giao dịch có tính nguyên tử: một command lỗi thì cả nhóm bị huỷ.
 */

export interface HistoryEntry {
  label: string
  patches: Patch[]
  inversePatches: Patch[]
  /** revision của document TRƯỚC khi áp giao dịch này. */
  revisionBefore: number
  at: string
}

export interface ProjectSessionState {
  document: ProjectDocument
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const MAX_HISTORY_ENTRIES = 200

export type RunCommandsOutcome =
  | { ok: true; state: ProjectSessionState; changed: boolean }
  | { ok: false; error: string; failedIndex: number }

export function createSessionState(document: ProjectDocument): ProjectSessionState {
  return { document, past: [], future: [] }
}

/**
 * Chạy một nhóm command như MỘT giao dịch.
 * Thành công thì đẩy một bước undo duy nhất; thất bại thì không đổi gì cả.
 */
export function runCommands(
  state: ProjectSessionState,
  commands: EditorCommand[],
  label: string
): RunCommandsOutcome {
  if (commands.length === 0) return { ok: true, state, changed: false }

  // Dùng mảng thay vì biến đơn: phép gán bên trong closure của immer không được
  // TypeScript theo dõi, nên biến đơn sẽ bị thu hẹp kiểu về `null` sau lời gọi.
  const failures: Array<{ error: string; index: number }> = []

  const [nextDocument, patches, inversePatches] = produceWithPatches(state.document, (draft) => {
    for (let index = 0; index < commands.length; index += 1) {
      const result = applyEditorCommand(draft, commands[index])
      if (!result.ok) {
        failures.push({ error: result.error, index })
        return
      }
    }
    draft.revision += 1
    draft.updatedAt = new Date().toISOString()
  })

  const failure = failures[0]
  if (failure) {
    // Bỏ toàn bộ draft — document giữ nguyên như trước giao dịch.
    return { ok: false, error: failure.error, failedIndex: failure.index }
  }

  if (patches.length === 0) {
    return { ok: true, state, changed: false }
  }

  const entry: HistoryEntry = {
    label,
    patches,
    inversePatches,
    revisionBefore: state.document.revision,
    at: new Date().toISOString()
  }

  const past = [...state.past, entry]
  if (past.length > MAX_HISTORY_ENTRIES) past.shift()

  return {
    ok: true,
    changed: true,
    state: { document: nextDocument, past, future: [] }
  }
}

/**
 * Áp lệnh mà KHÔNG ghi vào lịch sử hoàn tác.
 *
 * Dành cho dữ liệu phái sinh tới muộn — filmstrip và waveform dựng ở nền sau khi
 * nhập media xong. Nếu đi đường thường thì hai chuyện hỏng cùng lúc: người dùng
 * bấm hoàn tác một lần và mất cái filmstrip thay vì hoàn tác thao tác của mình,
 * và `runCommands` XOÁ SẠCH `future` nên stack làm-lại của họ biến mất chỉ vì
 * một tiến trình nền vừa chạy xong.
 *
 * Giữ nguyên `past` và `future`. Patch của các mục lịch sử cũ vẫn dùng được, vì
 * lệnh này chỉ SỬA trường phái sinh của một asset có sẵn — không thêm bớt phần
 * tử nào nên không có chỉ số mảng nào xê dịch.
 */
export function runCommandsSilently(
  state: ProjectSessionState,
  commands: EditorCommand[]
): RunCommandsOutcome {
  if (commands.length === 0) return { ok: true, state, changed: false }

  const failures: Array<{ error: string; index: number }> = []
  const nextDocument = produce(state.document, (draft) => {
    for (let index = 0; index < commands.length; index += 1) {
      const result = applyEditorCommand(draft, commands[index])
      if (!result.ok) {
        failures.push({ error: result.error, index })
        return
      }
    }
    draft.revision += 1
    draft.updatedAt = new Date().toISOString()
  })

  const failure = failures[0]
  if (failure) return { ok: false, error: failure.error, failedIndex: failure.index }
  if (nextDocument === state.document) return { ok: true, state, changed: false }

  return { ok: true, changed: true, state: { ...state, document: nextDocument } }
}

export function canUndo(state: ProjectSessionState): boolean {
  return state.past.length > 0
}

export function canRedo(state: ProjectSessionState): boolean {
  return state.future.length > 0
}

export function undo(state: ProjectSessionState): ProjectSessionState {
  const entry = state.past.at(-1)
  if (!entry) return state
  return {
    document: applyPatches(state.document, entry.inversePatches),
    past: state.past.slice(0, -1),
    future: [entry, ...state.future]
  }
}

export function redo(state: ProjectSessionState): ProjectSessionState {
  const [entry, ...rest] = state.future
  if (!entry) return state
  return {
    document: applyPatches(state.document, entry.patches),
    past: [...state.past, entry],
    future: rest
  }
}

/** Nhãn của bước sẽ được hoàn tác — dùng cho tooltip "Hoàn tác: cắt clip". */
export function undoLabel(state: ProjectSessionState): string | undefined {
  return state.past.at(-1)?.label
}

export function redoLabel(state: ProjectSessionState): string | undefined {
  return state.future[0]?.label
}
