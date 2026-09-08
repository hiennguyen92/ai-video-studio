import { useEffect } from 'react'
import type { McpApplyResult, McpBridgeRequest } from '../../../shared/ipc/ipc-contract'
import { buildProjectContext } from '../../../shared/ai/chat-context-builder'
import { planChatToolCalls } from '../../../shared/ai/chat-tool-planner'
import { createId } from '../../../shared/domain/project-document-factory'
import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import { useEditorStore } from '../state/editor-store'

/**
 * Trả lời máy chủ MCP thay cho tiến trình main.
 *
 * Renderer làm việc này vì tài liệu project nằm ở đây, cùng với lịch sử hoàn tác.
 * Agent bên ngoài đi vào bằng **đúng một cửa** như AI Chat trong app: qua
 * `planChatToolCalls` rồi thành `EditorCommand`. Không có đường ghi riêng nào.
 *
 * Khác AI Chat một điểm, và là điểm được cân nhắc kỹ: **áp dụng ngay, không chờ
 * duyệt từng bước.** Một agent dựng phim phát ra hàng chục lời gọi; bắt bấm duyệt
 * từng cái là bỏ đi toàn bộ ý nghĩa của việc tự động. Lưới an toàn ở đây là hoàn
 * tác — mỗi lời gọi là một bước undo, và người dùng thấy chúng trong lịch sử.
 */

function formatTranscript(document: ProjectDocument, transcriptId?: string): string {
  const transcript = transcriptId
    ? document.transcripts.find((item) => item.id === transcriptId)
    : document.transcripts[0]

  if (!transcript) return 'Dự án chưa có bản phiên âm nào.'

  const asset = document.assets.find((item) => item.id === transcript.assetId)
  const header = [
    `transcript id=${transcript.id}`,
    `language=${transcript.language}`,
    `asset=${asset?.name ?? transcript.assetId}`,
    `segments=${transcript.segments.length}`
  ].join(' ')

  // Mốc thời gian ghi bằng GIÂY vì công cụ cũng nhận giây; để mô hình tự đổi
  // micro giây là mời nó nhầm ba chữ số.
  const lines = transcript.segments.map((segment) => {
    const from = (segment.startUs / 1_000_000).toFixed(2)
    const to = (segment.endUs / 1_000_000).toFixed(2)
    return `- id=${segment.id} ${from}s–${to}s: ${segment.text}`
  })

  return [header, '', ...lines].join('\n')
}

function formatMedia(document: ProjectDocument): string {
  if (document.assets.length === 0) return 'Thư viện media đang trống.'

  return document.assets
    .map((asset) => {
      const parts = [
        `- id=${asset.id}`,
        `kind=${asset.kind}`,
        `name="${asset.name}"`,
        `duration=${(asset.probe.durationUs / 1_000_000).toFixed(2)}s`,
        asset.probe.hasAudio ? 'hasAudio' : 'noAudio',
        asset.missing ? 'MISSING' : ''
      ].filter(Boolean)

      // Đưa đường dẫn ảnh ra ngoài: agent nào đọc được file (Claude Code) thì xem
      // được hình để chọn cảnh, thay vì dựng mù theo mỗi transcript.
      if (asset.derived.thumbnailPath) parts.push(`thumbnail=${asset.derived.thumbnailPath}`)
      if (asset.derived.filmstripPath) parts.push(`filmstrip=${asset.derived.filmstripPath}`)
      parts.push(`source=${asset.source.path}`)
      return parts.join(' ')
    })
    .join('\n')
}

export function useMcpBridge(): void {
  const assets = useEditorStore((state) => state.session?.document.assets)

  /**
   * Báo main biết media của dự án đang mở.
   *
   * Máy chủ media chỉ phục vụ đúng những id đã đăng ký — không nhận đường dẫn từ
   * URL — nên thiếu bước này thì Remotion không nạp được gì.
   */
  useEffect(() => {
    if (!assets) return
    window.api.mcp.registerMedia(assets.map((asset) => ({ id: asset.id, path: asset.source.path })))
  }, [assets])

  useEffect(() => {
    return window.api.mcp.onRequest((request: McpBridgeRequest) => {
      const respond = (ok: boolean, data?: unknown, error?: string): void =>
        window.api.mcp.respond({ requestId: request.requestId, ok, data, error })

      const state = useEditorStore.getState()
      const document = state.session?.document
      if (!document) {
        respond(false, undefined, 'Chưa mở dự án nào trong AI Video Studio.')
        return
      }

      try {
        switch (request.kind) {
          case 'project-overview':
            respond(
              true,
              buildProjectContext({
                document,
                selectedClipIds: state.selection.clipIds,
                playheadUs: state.playheadUs
              })
            )
            return

          case 'transcript': {
            const payload = request.payload as { transcriptId?: string }
            respond(true, formatTranscript(document, payload?.transcriptId))
            return
          }

          case 'media':
            respond(true, formatMedia(document))
            return

          case 'apply-tools': {
            const payload = request.payload as {
              calls: Array<{ name: string; arguments: unknown }>
            }
            const plan = planChatToolCalls(
              {
                document,
                selectedClipIds: state.selection.clipIds,
                playheadUs: state.playheadUs,
                makeId: () => createId('clip')
              },
              payload.calls ?? []
            )

            const commands = plan.steps.flatMap((step) => step.commands)
            const applied =
              commands.length > 0
                ? state.run(commands, `MCP: ${plan.steps.map((s) => s.description).join('; ')}`)
                : false

            const result: McpApplyResult = {
              applied,
              // Không báo là đã áp dụng khi reducer từ chối — agent sẽ dựng tiếp
              // trên một trạng thái tưởng tượng.
              steps: applied ? plan.steps.map((step) => step.description) : [],
              failures: applied
                ? plan.failures
                : [
                    ...plan.failures,
                    ...(commands.length > 0
                      ? [{ tool: 'apply', reason: 'Không áp dụng được lệnh nào' }]
                      : [])
                  ],
              revision: useEditorStore.getState().session?.document.revision ?? document.revision
            }
            respond(true, result)
            return
          }

          default:
            respond(false, undefined, `Yêu cầu không hiểu: ${String(request.kind)}`)
        }
      } catch (error) {
        respond(false, undefined, error instanceof Error ? error.message : String(error))
      }
    })
  }, [])
}
