import { create } from 'zustand'
import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import { projectDurationUs } from '../../../shared/domain/project-document-types'
import type { EditorCommand } from '../../../shared/commands/editor-command-types'
import type { TextBlockRef } from '../../../shared/domain/text-block-drag'
import {
  canRedo,
  canUndo,
  createSessionState,
  redo,
  runCommands,
  undo,
  undoLabel,
  redoLabel,
  type ProjectSessionState
} from '../../../shared/commands/command-history'

/**
 * Trạng thái của trình soạn thảo.
 *
 * Document là NGUỒN SỰ THẬT DUY NHẤT — preview, timeline và export đều đọc từ đây,
 * không ai giữ bản sao timeline riêng (DESCRIPTION §4 "Không tạo hai nguồn trạng
 * thái timeline độc lập").
 *
 * Những thứ KHÔNG thuộc document (playhead, vùng chọn, mức zoom) nằm ngoài
 * `session` vì chúng không cần lưu vào file và không nên tạo bước undo.
 */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface Selection {
  clipIds: string[]
  trackId?: string
  /**
   * Khối chữ đang chọn, nếu người dùng bấm vào một câu phụ đề hay một dòng chữ
   * đè hình trên timeline.
   *
   * Loại trừ nhau với `clipIds`: panel thuộc tính chỉ hiện được MỘT thứ, và hiện
   * clip trong khi người dùng vừa bấm vào một câu phụ đề là nói dối về việc họ
   * đang chỉnh cái gì. Mọi hàm đặt vùng chọn ở dưới đều dựng lại object mới nên
   * trường này rụng đi theo đúng ý đó.
   */
  text?: TextBlockRef
}

/**
 * Chế độ công cụ của timeline: quyết định kéo/bấm lên clip làm gì.
 *
 * - select: chọn, kéo để dời, kéo mép để cắt (mặc định)
 * - trim: kéo mép là ripple trim — clip phía sau dịch theo, không để hở
 * - slip: kéo clip để đổi đoạn nguồn, giữ vị trí và độ dài
 * - rate-stretch: kéo mép để đổi độ dài bằng cách đổi tốc độ
 * - blade: bấm lên clip là cắt đôi tại chỗ bấm
 */
export type TimelineTool = 'select' | 'trim' | 'slip' | 'rate-stretch' | 'blade'

export interface EditorState {
  session: ProjectSessionState | null
  selection: Selection
  playheadUs: number
  /**
   * Thời điểm dưới con trỏ chuột khi rê trên timeline, hoặc `null` khi chuột ở ngoài.
   * Khác đầu phát: chỉ để khung xem trước nhỏ "lướt" tới, không tua preview lớn.
   */
  hoverUs: number | null
  isPlaying: boolean
  /** Mức zoom timeline, tính bằng pixel cho mỗi giây. */
  pixelsPerSecond: number
  snapEnabled: boolean
  timelineTool: TimelineTool
  saveState: SaveState
  lastError: string | null

  openProject(document: ProjectDocument): void
  closeProject(): void
  /** Chạy một nhóm lệnh như một bước undo duy nhất. */
  run(commands: EditorCommand[], label: string): boolean
  undo(): void
  redo(): void
  setPlayhead(us: number): void
  setHoverUs(us: number | null): void
  setPlaying(playing: boolean): void
  setSelection(selection: Selection): void
  /** Chọn một khối chữ trên timeline; bỏ chọn clip đang có. */
  selectTextBlock(text: TextBlockRef): void
  toggleClipSelection(clipId: string, trackId: string, additive: boolean): void
  clearSelection(): void
  setPixelsPerSecond(value: number): void
  toggleSnap(): void
  setTimelineTool(tool: TimelineTool): void
  setSaveState(state: SaveState): void
  setError(message: string | null): void
}

export const MIN_PIXELS_PER_SECOND = 4
export const MAX_PIXELS_PER_SECOND = 600
const DEFAULT_PIXELS_PER_SECOND = 60

export const useEditorStore = create<EditorState>()((set, get) => ({
  session: null,
  selection: { clipIds: [] },
  playheadUs: 0,
  hoverUs: null,
  isPlaying: false,
  pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
  snapEnabled: true,
  timelineTool: 'select',
  saveState: 'idle',
  lastError: null,

  openProject: (document) =>
    set({
      session: createSessionState(document),
      selection: { clipIds: [] },
      playheadUs: 0,
      isPlaying: false,
      saveState: 'saved',
      lastError: null
    }),

  closeProject: () =>
    set({
      session: null,
      selection: { clipIds: [] },
      playheadUs: 0,
      hoverUs: null,
      isPlaying: false
    }),

  run: (commands, label) => {
    const { session } = get()
    if (!session) return false

    const outcome = runCommands(session, commands, label)
    if (!outcome.ok) {
      set({ lastError: outcome.error })
      return false
    }
    if (!outcome.changed) return true

    set({ session: outcome.state, saveState: 'dirty', lastError: null })
    return true
  },

  undo: () => {
    const { session } = get()
    if (!session || !canUndo(session)) return
    set({ session: undo(session), saveState: 'dirty' })
  },

  redo: () => {
    const { session } = get()
    if (!session || !canRedo(session)) return
    set({ session: redo(session), saveState: 'dirty' })
  },

  setHoverUs: (us) => {
    // Chỉ ghi khi đổi thật: rê chuột bắn hàng trăm sự kiện, cùng một khung thì bỏ qua.
    if (get().hoverUs !== us) set({ hoverUs: us })
  },

  setPlayhead: (us) => {
    const { session } = get()
    const max = session ? projectDurationUs(session.document) : 0
    set({ playheadUs: Math.max(0, Math.min(Math.round(us), Math.max(max, 0))) })
  },

  setPlaying: (playing) => set({ isPlaying: playing }),

  setSelection: (selection) => set({ selection }),

  selectTextBlock: (text) => set({ selection: { clipIds: [], text } }),

  toggleClipSelection: (clipId, trackId, additive) => {
    const { selection } = get()
    if (!additive) {
      set({ selection: { clipIds: [clipId], trackId } })
      return
    }
    const already = selection.clipIds.includes(clipId)
    set({
      selection: {
        trackId,
        clipIds: already
          ? selection.clipIds.filter((id) => id !== clipId)
          : [...selection.clipIds, clipId]
      }
    })
  },

  clearSelection: () => set({ selection: { clipIds: [] } }),

  setPixelsPerSecond: (value) =>
    set({
      pixelsPerSecond: Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, value))
    }),

  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),

  setTimelineTool: (timelineTool) => set({ timelineTool }),

  setSaveState: (saveState) => set({ saveState }),

  setError: (lastError) => set({ lastError })
}))

/* ── Selector tiện dụng ────────────────────────────────────────── */

export const selectDocument = (state: EditorState): ProjectDocument | null =>
  state.session?.document ?? null

export const selectCanUndo = (state: EditorState): boolean =>
  state.session ? canUndo(state.session) : false

export const selectCanRedo = (state: EditorState): boolean =>
  state.session ? canRedo(state.session) : false

export const selectUndoLabel = (state: EditorState): string | undefined =>
  state.session ? undoLabel(state.session) : undefined

export const selectRedoLabel = (state: EditorState): string | undefined =>
  state.session ? redoLabel(state.session) : undefined

export const selectDurationUs = (state: EditorState): number =>
  state.session ? projectDurationUs(state.session.document) : 0
