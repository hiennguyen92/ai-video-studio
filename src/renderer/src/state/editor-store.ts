import { create } from 'zustand'
import { expandToLinkGroups } from '../../../shared/domain/clip-link-groups'
import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import { projectDurationUs } from '../../../shared/domain/project-document-types'
import type { EditorCommand } from '../../../shared/commands/editor-command-types'
import type { TextBlockRef } from '../../../shared/domain/text-block-drag'
import type { Clip } from '../../../shared/domain/timeline-track-types'
import {
  copyKeyframes,
  pasteKeyframes,
  type KeyframeClipboard
} from '../../../shared/domain/keyframe-clipboard'
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
   * Cụm keyframe vừa chép, chờ dán.
   *
   * Nằm ngoài tài liệu như vùng chọn và mức zoom: nó không thuộc về bản dựng,
   * không lưu vào file, và không được tạo bước hoàn tác.
   */
  keyframeClipboard: KeyframeClipboard | null
  /**
   * Clip vừa chép, chờ dán. Giữ CẢ clip chứ không giữ mỗi id: chép rồi xoá rồi
   * dán chỗ khác là lối làm việc bình thường, và giữ id thì lúc đó không còn
   * gì để dán.
   */
  clipClipboard: Clip | null
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
  /** Chép clip đang chọn vào bảng tạm. Trả `false` khi không có clip nào đang chọn. */
  copyClip(): boolean
  /** Dán clip đã chép vào track đang chọn, tại đầu phát. Trả `false` khi không dán được. */
  pasteClip(label: string): boolean
  /** Chép cụm keyframe của thứ đang chọn vào bảng tạm. Trả `false` khi không có gì để chép. */
  copyKeyframes(): boolean
  /** Dán bảng tạm vào MỌI clip đang chọn. Trả số chủ thể đã nhận, và số đường phải bỏ. */
  pasteKeyframes(label: string): { pasted: number; dropped: number }
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
  keyframeClipboard: null,
  clipClipboard: null,
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
      keyframeClipboard: null,
      clipClipboard: null,
      isPlaying: false,
      saveState: 'saved',
      lastError: null
    }),

  closeProject: () =>
    set({
      session: null,
      selection: { clipIds: [] },
      playheadUs: 0,
      keyframeClipboard: null,
      clipClipboard: null,
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
    const { selection, session } = get()
    // Bấm vào một clip là chọn CẢ NHÓM của nó: chọn lẻ một thành viên rồi kéo là
    // tách hình khỏi tiếng.
    const group = session ? expandToLinkGroups(session.document, [clipId]) : [clipId]
    if (!additive) {
      set({ selection: { clipIds: group, trackId } })
      return
    }
    const already = selection.clipIds.includes(clipId)
    set({
      selection: {
        trackId,
        clipIds: already
          ? selection.clipIds.filter((id) => !group.includes(id))
          : [...selection.clipIds, ...group.filter((id) => !selection.clipIds.includes(id))]
      }
    })
  },

  clearSelection: () => set({ selection: { clipIds: [] } }),

  copyClip: () => {
    const { session, selection } = get()
    const document = session?.document
    const clip = document ? findSelectedClip(document, selection.clipIds[0]) : undefined
    if (!clip) return false
    set({ clipClipboard: structuredClone(clip) })
    return true
  },

  pasteClip: (label) => {
    const { session, selection, clipClipboard, playheadUs } = get()
    const document = session?.document
    if (!document || !clipClipboard) return false

    // Track đích: track đang chọn, hoặc track của chính clip đã chép nếu chưa
    // chọn gì. Không đoán xa hơn — dán nhầm lane là thứ khó nhận ra.
    const targetTrackId =
      selection.trackId ??
      document.tracks.find((track) => track.clips.some((clip) => clip.id === clipClipboard.id))?.id
    if (!targetTrackId) return false

    return get().run(
      [
        {
          type: 'clip/paste',
          trackId: targetTrackId,
          startUs: playheadUs,
          clip: clipClipboard
        }
      ],
      label
    )
  },

  copyKeyframes: () => {
    const { session, selection } = get()
    const document = session?.document
    if (!document) return false

    const overlayRef = selection.text?.kind === 'overlay' ? selection.text : null
    if (overlayRef) {
      const overlay = document.textOverlays.find((item) => item.id === overlayRef.overlayId)
      const clipboard = copyKeyframes(overlay?.keyframes, undefined, 'text')
      if (!clipboard) return false
      set({ keyframeClipboard: clipboard })
      return true
    }

    // Chép từ clip ĐẦU TIÊN đang chọn: chép từ nhiều nguồn một lúc không có
    // nghĩa nào rõ ràng, còn dán thì nhận được nhiều đích.
    const clip = findSelectedClip(document, selection.clipIds[0])
    const clipboard = copyKeyframes(clip?.keyframes, clip?.effects, 'clip')
    if (!clipboard) return false
    set({ keyframeClipboard: clipboard })
    return true
  },

  pasteKeyframes: (label) => {
    const { session, selection, keyframeClipboard } = get()
    const document = session?.document
    if (!document || !keyframeClipboard) return { pasted: 0, dropped: 0 }

    const commands: EditorCommand[] = []
    let dropped = 0

    const overlayRef = selection.text?.kind === 'overlay' ? selection.text : null
    if (keyframeClipboard.from === 'text' && overlayRef) {
      const result = pasteKeyframes(keyframeClipboard, { kind: 'text' })
      dropped += result.dropped
      if (Object.keys(result.tracks).length > 0) {
        commands.push({
          type: 'keyframe/set-tracks',
          target: { kind: 'text', overlayId: overlayRef.overlayId },
          tracks: result.tracks
        })
      }
    }

    for (const clipId of selection.clipIds) {
      const clip = findSelectedClip(document, clipId)
      if (!clip) continue
      const result = pasteKeyframes(keyframeClipboard, { kind: 'clip', effects: clip.effects })
      dropped += result.dropped
      if (Object.keys(result.tracks).length === 0) continue
      commands.push({
        type: 'keyframe/set-tracks',
        target: { kind: 'clip', clipId },
        tracks: result.tracks
      })
    }

    // Cả cụm trong MỘT lần chạy: dán cho ba clip là một thao tác của người dùng,
    // nên phải là một bước hoàn tác.
    if (commands.length === 0) return { pasted: 0, dropped }
    return get().run(commands, label)
      ? { pasted: commands.length, dropped }
      : { pasted: 0, dropped }
  },

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

/** Clip theo id, tìm khắp mọi track. */
function findSelectedClip(document: ProjectDocument, clipId: string | undefined): Clip | undefined {
  if (!clipId) return undefined
  for (const track of document.tracks) {
    const clip = track.clips.find((item) => item.id === clipId)
    if (clip) return clip
  }
  return undefined
}

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
