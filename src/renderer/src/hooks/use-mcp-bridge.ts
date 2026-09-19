import { useEffect } from 'react'
import { resolveCleanedVoices, resolveSilences } from './resolve-audio-tool-inputs'
import type { McpApplyResult, McpBridgeRequest } from '../../../shared/ipc/ipc-contract'
import { prepareMediaImport } from './use-media-import'
import { buildProjectContext } from '../../../shared/ai/chat-context-builder'
import { planChatToolCalls, type ImportedMediaOutcome } from '../../../shared/ai/chat-tool-planner'
import { createId } from '../../../shared/domain/project-document-factory'
import type { MediaAsset } from '../../../shared/domain/media-asset-types'
import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import { useEditorStore } from '../state/editor-store'
import { formatTranscript, formatTranslation } from './mcp-bridge-speech-text-formatters'
import { redoLabel, undoLabel } from '../../../shared/commands/command-history'

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
/**
 * Danh sách phông của máy, cho agent đọc.
 *
 * Phải đọc thật: agent không có cách nào biết máy này có phông gì, và đoán bừa
 * một cái tên thì chữ lặng lẽ rơi về phông mặc định ở cả preview lẫn bản xuất.
 */
async function listLocalFonts(family?: string): Promise<string> {
  const query = window.queryLocalFonts
  if (!query) return 'Máy này không cho đọc danh sách phông.'

  const fonts = await query()
  const grouped = new Map<string, Array<{ style: string; postScriptName: string }>>()
  for (const font of fonts) {
    if (family && font.family !== family) continue
    const faces = grouped.get(font.family) ?? []
    faces.push({ style: font.style, postScriptName: font.postscriptName })
    grouped.set(font.family, faces)
  }

  if (grouped.size === 0) {
    return family ? `Máy này không có phông "${family}".` : 'Không đọc được phông nào.'
  }

  // Không nêu họ thì chỉ liệt kê TÊN HỌ: hơn sáu trăm dòng kiểu chữ sẽ nuốt sạch
  // ngữ cảnh của agent mà phần lớn không dùng tới.
  if (!family) {
    return [`${grouped.size} họ phông trên máy này:`, '', ...[...grouped.keys()].sort()].join('\n')
  }

  const lines: string[] = []
  for (const [name, faces] of grouped) {
    lines.push(`họ "${name}":`)
    for (const face of faces) lines.push(`- ${face.style} → ${face.postScriptName}`)
  }
  return lines.join('\n')
}

/**
 * Dựng sẵn asset hiệu ứng âm thanh cho những lời gọi cần tới.
 *
 * Cùng lý do như phông chữ: planner là hàm thuần, không probe được thời lượng
 * thật hay hash nội dung của file. Không dựng trước thì clip đặt ra dài không
 * khớp tiếng, và đuôi âm thanh bị cắt.
 */
async function resolveSoundEffects(
  calls: Array<{ name: string; arguments: unknown }>
): Promise<Record<string, MediaAsset>> {
  const wanted = new Set<string>()
  for (const call of calls) {
    if (call.name !== 'add_sound_effect') continue
    const args = call.arguments as { soundEffectId?: string }
    if (typeof args?.soundEffectId === 'string' && args.soundEffectId) {
      wanted.add(args.soundEffectId)
    }
  }
  if (wanted.size === 0) return {}

  const resolved: Record<string, MediaAsset> = {}
  for (const id of wanted) {
    const built = await window.api.soundEffects.buildAsset(id)
    if (built.ok) resolved[id] = built.data
  }
  return resolved
}

/**
 * Nhập sẵn media cho những lời gọi `import_media`.
 *
 * Cùng lý do như hiệu ứng âm thanh: planner là hàm thuần, không probe được file
 * và không dựng được thumbnail. Ở đây chỉ DỰNG asset chứ không ghi vào document
 * — lệnh `asset/add` do planner phát ra, ghi ở cả hai nơi thì một lần nhập thành
 * hai bước hoàn tác.
 */
async function resolveImportedMedia(
  calls: Array<{ name: string; arguments: unknown }>
): Promise<Record<string, ImportedMediaOutcome>> {
  const wanted = new Set<string>()
  for (const call of calls) {
    if (call.name !== 'import_media') continue
    const args = call.arguments as { filePaths?: string[] }
    for (const path of args?.filePaths ?? []) {
      // Bỏ qua đường dẫn tương đối ở đây; planner mới là nơi báo lỗi cho agent.
      if (typeof path === 'string' && path.startsWith('/')) wanted.add(path)
    }
  }
  if (wanted.size === 0) return {}

  const resolved: Record<string, ImportedMediaOutcome> = {}
  try {
    const data = await prepareMediaImport([...wanted])
    if (!data) return {}
    for (const asset of data.assets) resolved[asset.source.path] = { asset }
    for (const item of data.duplicates) resolved[item.path] = { duplicateOf: item.existingAssetId }
    for (const item of data.failures) resolved[item.path] = { error: item.error }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const path of wanted) resolved[path] = { error: message }
  }
  return resolved
}

/**
 * Chép sẵn file phông cho những lời gọi đổi phông.
 *
 * Planner là hàm thuần nên không đọc được byte phông; nó chỉ nhận đường dẫn đã
 * có. Không chép thì bản NUNG phụ đề lặng lẽ dùng phông khác preview.
 */
async function resolveFontFiles(
  calls: Array<{ name: string; arguments: unknown }>
): Promise<Record<string, string>> {
  const wanted = new Set<string>()
  for (const call of calls) {
    if (call.name !== 'set_text_font') continue
    const args = call.arguments as { fontFamily?: string; fontPostScriptName?: string }
    const key = args?.fontPostScriptName ?? args?.fontFamily
    if (typeof key === 'string' && key) wanted.add(key)
  }
  if (wanted.size === 0) return {}

  const query = window.queryLocalFonts
  if (!query) return {}

  const fonts = await query()
  const resolved: Record<string, string> = {}
  for (const key of wanted) {
    const face =
      fonts.find((font) => font.postscriptName === key) ?? fonts.find((font) => font.family === key)
    if (!face) continue
    const bytes = new Uint8Array(await (await face.blob()).arrayBuffer())
    const stored = await window.api.fonts.store(key, bytes)
    if (stored.ok) resolved[key] = stored.data.path
  }
  return resolved
}

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

          // Bản chụp để main xuất video: cùng thứ hộp thoại Xuất gửi đi, nên hai
          // lối xuất dựng ra đúng một kết quả.
          case 'document-snapshot':
            respond(true, document)
            return

          case 'translation': {
            const payload = request.payload as { translationId?: string }
            respond(true, formatTranslation(document, payload?.translationId))
            return
          }

          case 'undo':
          case 'redo': {
            // Có `document` tức là có phiên; kiểm lại chỉ để trình biên dịch thấy.
            const history = state.session
            const label = !history
              ? undefined
              : request.kind === 'undo'
                ? undoLabel(history)
                : redoLabel(history)
            if (label === undefined) {
              respond(
                true,
                request.kind === 'undo'
                  ? 'Không còn bước nào để hoàn tác.'
                  : 'Không còn bước nào để làm lại.'
              )
              return
            }
            if (request.kind === 'undo') state.undo()
            else state.redo()
            const revision = useEditorStore.getState().session?.document.revision
            respond(
              true,
              `${request.kind === 'undo' ? 'Đã hoàn tác' : 'Đã làm lại'}: ${label}\nrevision=${revision}`
            )
            return
          }

          case 'media':
            respond(true, formatMedia(document))
            return

          case 'fonts': {
            const payload = request.payload as { family?: string }
            void listLocalFonts(payload?.family)
              .then((text) => respond(true, text))
              .catch((error: unknown) =>
                respond(false, undefined, error instanceof Error ? error.message : String(error))
              )
            return
          }

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
            const calls = payload.calls ?? []

            // Chép file phông TRƯỚC khi lập kế hoạch: planner là hàm thuần, chỉ
            // nhận đường dẫn có sẵn chứ không tự đọc byte phông được.
            const selected = useEditorStore.getState().selection.clipIds
            void Promise.all([
              resolveFontFiles(calls),
              resolveSoundEffects(calls),
              resolveImportedMedia(calls),
              resolveSilences(calls, document, selected),
              resolveCleanedVoices(calls, document, selected)
            ]).then(([fontFiles, soundEffects, importedMedia, silences, cleanedVoices]) => {
              // Đọc lại trạng thái SAU khi chờ: phông, hiệu ứng âm thanh và nhập media
              // tốn thời gian, và một lời gọi khác (undo chẳng hạn) có thể đã đổi
              // dự án. Lập kế hoạch trên bản chụp cũ sẽ ghi đè thay đổi đó.
              const latest = useEditorStore.getState()
              const latestDocument = latest.session?.document
              if (!latestDocument) {
                respond(false, undefined, 'Dự án đã bị đóng trong lúc xử lý.')
                return
              }
              const plan = planChatToolCalls(
                {
                  document: latestDocument,
                  selectedClipIds: latest.selection.clipIds,
                  playheadUs: latest.playheadUs,
                  makeId: (prefix) => createId(prefix ?? 'clip'),
                  shots: Object.fromEntries(shotCache),
                  fontFiles,
                  soundEffects,
                  importedMedia,
                  silences,
                  cleanedVoices
                },
                calls
              )

              const commands = plan.steps.flatMap((step) => step.commands)
              // Không sinh lệnh nào KHÔNG có nghĩa là hỏng: một bước hợp lệ vẫn có
              // thể chẳng phải sửa gì — nhập một file đã có sẵn chẳng hạn. Coi đó
              // là thất bại thì mô tả của bước ấy bị nuốt, agent nhận một câu trả
              // lời rỗng rồi gọi lại mãi.
              const applied =
                commands.length > 0
                  ? latest.run(commands, `MCP: ${plan.steps.map((s) => s.description).join('; ')}`)
                  : plan.steps.length > 0

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
                revision:
                  useEditorStore.getState().session?.document.revision ?? latestDocument.revision
              }
              respond(true, result)
            })
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
