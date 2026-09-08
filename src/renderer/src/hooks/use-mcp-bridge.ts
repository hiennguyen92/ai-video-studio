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

/** Cú máy đã dò, giữ trong bộ nhớ phiên làm việc để công cụ dựng dùng lại. */
const shotCache = new Map<string, Array<{ startUs: number; endUs: number; framePath?: string }>>()

/**
 * Liệt kê cú máy kèm đường dẫn ảnh đại diện.
 *
 * Đường dẫn ảnh là phần quan trọng nhất: agent nào đọc được file — Claude Code
 * chẳng hạn — sẽ XEM được từng cú mà chọn, thay vì đoán mò theo mốc thời gian.
 * Đây là đường duy nhất dựng được video từ footage không có tiếng.
 */
function formatShots(
  assetId: string,
  assetName: string,
  shots: Array<{
    index: number
    startUs: number
    endUs: number
    framePath?: string
    synthetic?: boolean
  }>
): string {
  if (shots.length === 0) return 'Không dò được cú máy nào.'

  const header = `asset id=${assetId} name="${assetName}" shots=${shots.length}`
  const lines = shots.map((shot) => {
    const from = (shot.startUs / 1_000_000).toFixed(2)
    const to = (shot.endUs / 1_000_000).toFixed(2)
    const duration = ((shot.endUs - shot.startUs) / 1_000_000).toFixed(2)
    // Nói rõ lát nào là chia đều: cắt ở đó rơi vào giữa động tác chứ không phải
    // vào một chỗ chuyển cảnh, và agent cần biết để chừa lề khi chọn đoạn.
    const kind = shot.synthetic ? ' [chia đều, không phải chuyển cảnh]' : ''
    return `- shot ${shot.index}: ${from}s–${to}s (${duration}s)${kind}${shot.framePath ? ` frame=${shot.framePath}` : ''}`
  })

  const note = shots.every((shot) => shot.synthetic)
    ? '\nLưu ý: video là MỘT cú máy liên tục, ffmpeg không tìm được chỗ chuyển cảnh nào. Mọi mốc dưới đây là chia đều theo thời gian.'
    : ''

  return [header + note, '', ...lines].join('\n')
}

export function useMcpBridge(): void {
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

          case 'shots': {
            const payload = request.payload as { assetId?: string }
            const asset = payload?.assetId
              ? document.assets.find((item) => item.id === payload.assetId)
              : document.assets.find((item) => item.kind === 'video')
            if (!asset) {
              respond(false, undefined, 'Không tìm thấy media video nào trong dự án.')
              return
            }

            // Dò cú máy tốn thời gian nên chạy bất đồng bộ; kết quả giữ lại để
            // công cụ dựng dùng mà không phải quét lại.
            void window.api.media
              .detectShots({
                projectId: document.id,
                assetId: asset.id,
                sourcePath: asset.source.path
              })
              .then((result) => {
                if (!result.ok) {
                  respond(false, undefined, result.error)
                  return
                }
                shotCache.set(asset.id, result.data)
                respond(true, formatShots(asset.id, asset.name, result.data))
              })
            return
          }

          case 'apply-tools': {
            const payload = request.payload as {
              calls: Array<{ name: string; arguments: unknown }>
            }
            const plan = planChatToolCalls(
              {
                document,
                selectedClipIds: state.selection.clipIds,
                playheadUs: state.playheadUs,
                makeId: () => createId('clip'),
                shots: Object.fromEntries(shotCache)
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
