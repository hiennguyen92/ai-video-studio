import { useEffect, useRef, useState, type JSX } from 'react'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useAiChat } from '../../hooks/use-ai-chat'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconSparkle, IconTrash } from '../ui/icons'
import './ai-chat-panel.css'

/**
 * AI Chat (DESCRIPTION §5).
 *
 * Điểm cốt lõi của giao diện này: câu trả lời của AI KHÔNG tự sửa dự án. Thay
 * đổi hiện ra dưới dạng danh sách bước đọc được, người dùng bấm "Áp dụng" mới
 * chạy, và chạy thành đúng một bước hoàn tác.
 *
 * Bước bị từ chối cũng được hiện kèm lý do, thay vì im lặng bỏ qua — im lặng sẽ
 * khiến người dùng tưởng AI đã làm điều nó vừa hứa.
 */

export function AiChatPanel(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const { state, send, applyProposal, discardProposal, clearHistory } = useAiChat()
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Luôn cuộn xuống lượt mới nhất; hội thoại dài thì lượt mới nằm ngoài tầm nhìn.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [state.messages, state.proposal])

  if (!document) {
    return (
      <div className="ai-chat">
        <EmptyState title={t.chat.noProject} hint={t.chat.emptyHint} />
      </div>
    )
  }

  const submit = (): void => {
    if (!draft.trim() || state.sending) return
    const message = draft
    setDraft('')
    void send(message)
  }

  return (
    <div className="ai-chat">
      <div className="ai-chat__messages" ref={listRef}>
        {state.messages.length === 0 ? (
          <EmptyState title={t.chat.empty} hint={t.chat.emptyHint} />
        ) : (
          state.messages.map((message) => (
            <article key={message.id} className={`chat-message chat-message--${message.role}`}>
              <p className="chat-message__text">{message.content}</p>
              {message.steps && message.steps.length > 0 && (
                <ul className="chat-message__steps">
                  {message.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ul>
              )}
            </article>
          ))
        )}
      </div>

      {state.proposal && (
        <section className="chat-proposal">
          <p className="chat-proposal__title">
            {interpolate(t.chat.proposalTitle, { count: state.proposal.steps.length })}
          </p>
          <p className="chat-proposal__hint">{t.chat.proposalHint}</p>

          <ol className="chat-proposal__steps">
            {state.proposal.steps.map((step, index) => (
              <li key={index}>{step.description}</li>
            ))}
          </ol>

          {/* Bước bị chặn phải nói rõ lý do, không giấu đi. */}
          {state.proposal.failures.length > 0 && (
            <ul className="chat-proposal__failures">
              {state.proposal.failures.map((failure, index) => (
                <li key={index}>
                  <code>{failure.tool}</code> — {failure.reason}
                </li>
              ))}
            </ul>
          )}

          {state.stale && <div className="notice">{t.chat.staleWarning}</div>}

          <div className="chat-proposal__actions">
            <ToolButton
              label={t.chat.apply}
              variant="primary"
              disabled={state.proposal.steps.length === 0 || state.stale}
              onClick={applyProposal}
            />
            <ToolButton label={t.chat.discard} onClick={discardProposal} />
          </div>
        </section>
      )}

      {state.error && <div className="notice">{state.error}</div>}

      <div className="ai-chat__composer">
        <textarea
          value={draft}
          rows={2}
          placeholder={t.chat.placeholder}
          aria-label={t.chat.title}
          disabled={state.sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter gửi, Shift+Enter xuống dòng — thói quen của mọi ô chat.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="ai-chat__composer-actions">
          <ToolButton
            label={state.sending ? t.chat.sending : t.chat.send}
            icon={<IconSparkle />}
            variant="primary"
            disabled={state.sending || draft.trim().length === 0}
            onClick={submit}
          />
          <ToolButton
            label={t.chat.clearHistory}
            icon={<IconTrash />}
            iconOnly
            variant="danger"
            disabled={state.messages.length === 0}
            onClick={() => void clearHistory()}
          />
        </div>
      </div>
    </div>
  )
}
