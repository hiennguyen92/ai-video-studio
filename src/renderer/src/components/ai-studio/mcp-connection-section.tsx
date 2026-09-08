import { useEffect, useState, type JSX } from 'react'
import type { McpServerStatus } from '../../../../shared/ipc/ipc-contract'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Thông tin kết nối cho agent bên ngoài.
 *
 * Không có phần này thì tính năng MCP coi như không tồn tại với người dùng: máy
 * chủ chạy nhưng không ai biết địa chỉ và khoá để nối vào.
 *
 * Khoá được sinh mới mỗi lần mở app và chỉ nghe trên 127.0.0.1 — nó cho phép sửa
 * dự án nên phải nói rõ điều đó ngay tại chỗ, không giấu trong tài liệu.
 */

function configSnippet(status: McpServerStatus): string {
  return JSON.stringify(
    {
      mcpServers: {
        'ai-video-studio': {
          type: 'http',
          url: status.url,
          headers: { 'x-avs-token': status.token }
        }
      }
    },
    null,
    2
  )
}

export function McpConnectionSection(): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<McpServerStatus | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api.mcp.status()
      if (!cancelled && result.ok) setStatus(result.data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="mcp-section">
      <p className="field-group__title">{t.mcp.section}</p>
      <p className="mcp-section__hint">{t.mcp.hint}</p>

      <div className="field-row">
        <span className="field-row__label">{t.mcp.address}</span>
        <span
          className={`provider-card__badge ${status?.running ? 'provider-card__badge--ok' : ''}`}
        >
          {status?.running ? t.mcp.running : t.mcp.stopped}
        </span>
      </div>

      {status?.error && <div className="notice">{status.error}</div>}

      {status?.running && (
        <>
          <div className="field-row">
            <span className="field-row__label">{t.mcp.address}</span>
            <input type="text" readOnly value={status.url ?? ''} aria-label={t.mcp.address} />
          </div>

          <div className="field-row">
            <span className="field-row__label">{t.mcp.token}</span>
            <input type="text" readOnly value={status.token ?? ''} aria-label={t.mcp.token} />
          </div>

          <div className="mcp-section__actions">
            <ToolButton
              label={copied ? t.mcp.copied : t.mcp.copyConfig}
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(configSnippet(status))
                setCopied(true)
              }}
            />
          </div>

          <p className="mcp-section__hint">{t.mcp.configHint}</p>
          <pre className="mcp-section__config">{configSnippet(status)}</pre>
        </>
      )}

      <p className="mcp-section__hint">{t.mcp.security}</p>
    </section>
  )
}
