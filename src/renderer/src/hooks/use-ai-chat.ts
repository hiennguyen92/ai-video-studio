import { useCallback, useEffect, useRef, useState } from 'react'
import {
  resolveCleanedVoices,
  resolveFreezeFrames,
  resolveSilences
} from './resolve-audio-tool-inputs'
import type { ChatMessageRecord } from '../../../shared/ipc/ipc-contract'
import { buildChatSystemPrompt, buildProjectContext } from '../../../shared/ai/chat-context-builder'
import {
  planChatToolCalls,
  type PlannedToolCall,
  type ToolPlanFailure
} from '../../../shared/ai/chat-tool-planner'
import { createId } from '../../../shared/domain/project-document-factory'
import { useEditorStore } from '../state/editor-store'

/**
 * AI Chat: hỏi mô hình, kiểm tra đề xuất, rồi áp dụng bằng đúng tập lệnh sửa.
 *
 * Hai điều bắt buộc của DESCRIPTION §5 nằm ở đây:
 *
 *   - Thay đổi nhiều bước phải thành BẢN ĐỀ XUẤT xem trước được rồi mới áp dụng;
 *     chat không bao giờ tự sửa dự án ngay khi trả lời.
 *   - Phải phát hiện dự án đã đổi trong lúc AI xử lý. Bản đề xuất ghi lại
 *     `revision` lúc gửi câu hỏi; nếu lúc bấm áp dụng revision đã khác thì từ
 *     chối, vì các id trong đề xuất có thể đã trỏ vào clip không còn tồn tại.
 */

export interface ChatProposal {
  steps: PlannedToolCall[]
  failures: ToolPlanFailure[]
  /** Revision của dự án lúc dựng đề xuất. */
  baseRevision: number
}

export interface AiChatState {
  messages: ChatMessageRecord[]
  proposal: ChatProposal | null
  sending: boolean
  error: string | null
  /** Bật khi dự án đã đổi kể từ lúc dựng đề xuất. */
  stale: boolean
}

export function useAiChat(): {
  state: AiChatState
  send(message: string): Promise<void>
  applyProposal(): void
  discardProposal(): void
  clearHistory(): Promise<void>
} {
  const document = useEditorStore((state) => state.session?.document ?? null)
  const selection = useEditorStore((state) => state.selection)
  const run = useEditorStore((state) => state.run)

  const [messages, setMessages] = useState<ChatMessageRecord[]>([])
  const [proposal, setProposal] = useState<ChatProposal | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const projectId = document?.id ?? null
  const loadedFor = useRef<string | null>(null)

  // Lịch sử theo project: đổi dự án là phải nạp lại đúng cuộc hội thoại của nó.
  useEffect(() => {
    if (!projectId || loadedFor.current === projectId) return
    loadedFor.current = projectId

    let cancelled = false
    void (async () => {
      const result = await window.api.chat.readHistory(projectId)
      if (!cancelled && result.ok) setMessages(result.data)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const persist = useCallback(
    (next: ChatMessageRecord[]) => {
      setMessages(next)
      if (projectId) void window.api.chat.writeHistory(projectId, next)
    },
    [projectId]
  )

  const send = useCallback(
    async (message: string) => {
      const text = message.trim()
      const current = useEditorStore.getState().session?.document
      if (!text || !current) return

      setSending(true)
      setError(null)
      setProposal(null)

      const userMessage: ChatMessageRecord = {
        id: createId('msg'),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString()
      }
      const withUser = [...messages, userMessage]
      persist(withUser)

      // Chụp revision NGAY lúc gửi: đây là mốc để phát hiện dự án đổi giữa chừng.
      const baseRevision = current.revision

      const result = await window.api.chat.send({
        systemPrompt: buildChatSystemPrompt(),
        projectContext: buildProjectContext({
          document: current,
          selectedClipIds: selection.clipIds,
          // Đầu phát lúc GỬI. Đọc thẳng từ store thay vì theo dõi: theo dõi thì
          // cả panel chat vẽ lại mỗi khung khi đang phát.
          playheadUs: useEditorStore.getState().playheadUs
        }),
        history: messages.map((item) => ({ role: item.role, content: item.content })),
        userMessage: text
      })

      setSending(false)

      if (!result.ok) {
        setError(result.error)
        return
      }

      // Kiểm tra đề xuất trên tài liệu MỚI NHẤT, không phải bản đã chụp: người
      // dùng có thể vừa sửa gì đó trong lúc chờ mô hình trả lời.
      // Công cụ cần ffmpeg (dò khoảng lặng, làm sạch giọng) chạy phần nặng TRƯỚC,
      // rồi mới lập kế hoạch trên tài liệu mới nhất.
      const beforeResolve = useEditorStore.getState().session?.document ?? current
      // Đầu phát đọc MỘT lần cho cả phần dựng khung đứng hình lẫn phần lập kế hoạch.
      const playheadAtReply = useEditorStore.getState().playheadUs
      const [silences, cleanedVoices, freezeFrames] = await Promise.all([
        resolveSilences(result.data.toolCalls, beforeResolve, selection.clipIds),
        resolveCleanedVoices(result.data.toolCalls, beforeResolve, selection.clipIds),
        resolveFreezeFrames(
          result.data.toolCalls,
          beforeResolve,
          selection.clipIds,
          playheadAtReply
        )
      ])
      const latest = useEditorStore.getState().session?.document ?? current
      const plan = planChatToolCalls(
        {
          document: latest,
          selectedClipIds: selection.clipIds,
          playheadUs: playheadAtReply,
          makeId: (prefix) => createId(prefix ?? 'clip'),
          silences,
          cleanedVoices,
          freezeFrames
        },
        result.data.toolCalls
      )

      const assistantMessage: ChatMessageRecord = {
        id: createId('msg'),
        role: 'assistant',
        content: result.data.reply,
        createdAt: new Date().toISOString(),
        steps: plan.steps.map((step) => step.description)
      }
      persist([...withUser, assistantMessage])

      if (plan.steps.length > 0 || plan.failures.length > 0) {
        setProposal({ ...plan, baseRevision })
      }
    },
    [messages, persist, selection.clipIds]
  )

  const applyProposal = useCallback(() => {
    if (!proposal) return
    const current = useEditorStore.getState().session?.document
    if (!current) return

    if (current.revision !== proposal.baseRevision) {
      // Dự án đã đổi kể từ lúc dựng đề xuất — các id bên trong có thể đã cũ.
      setError('Dự án đã thay đổi kể từ lúc AI đọc. Hãy hỏi lại để AI đọc trạng thái mới nhất.')
      setProposal(null)
      return
    }

    // Gom mọi bước vào MỘT giao dịch: một lần hoàn tác trả về đúng trạng thái
    // trước khi AI động vào.
    const commands = proposal.steps.flatMap((step) => step.commands)
    if (commands.length === 0) {
      setProposal(null)
      return
    }

    const applied = run(commands, 'Áp dụng đề xuất của AI')
    if (!applied) setError('Không áp dụng được đề xuất')
    setProposal(null)
  }, [proposal, run])

  const discardProposal = useCallback(() => setProposal(null), [])

  const clearHistory = useCallback(async () => {
    setMessages([])
    setProposal(null)
    if (projectId) await window.api.chat.clearHistory(projectId)
  }, [projectId])

  const stale = Boolean(proposal && document && document.revision !== proposal.baseRevision)

  return {
    state: { messages, proposal, sending, error, stale },
    send,
    applyProposal,
    discardProposal,
    clearHistory
  }
}
