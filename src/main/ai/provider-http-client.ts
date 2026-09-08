import { ProviderError, type ProviderErrorKind } from '../../shared/ai/ai-provider-contracts'

/**
 * Lớp gọi HTTP dùng chung cho mọi adapter provider.
 *
 * Tồn tại để phân loại lỗi ở MỘT chỗ. Nếu để mỗi adapter tự bắt lỗi, giao diện
 * sẽ nhận về đủ kiểu thông báo thô khác nhau và không thể quyết định có nên hiện
 * nút "Thử lại" hay không.
 *
 * Quy tắc: thông báo lỗi KHÔNG bao giờ được chứa khoá API. Ở đây chỉ ghi mã
 * trạng thái và phần thân phản hồi do provider trả về.
 */

export interface HttpRequestOptions {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
  providerId: string
  /** Bỏ cuộc sau bấy nhiêu mili giây. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Phát hiện lỗi "khoá đúng nhưng thiếu quyền".
 *
 * ElevenLabs trả 401 kèm `status: "missing_permissions"` cho trường hợp này, y
 * như khi khoá sai. Phân biệt được hai ca này rất quan trọng: quan sát thực tế
 * cho thấy một khoá chỉ có quyền text_to_speech vẫn sinh giọng đọc bình thường
 * nhưng không liệt kê được giọng — báo "khoá bị từ chối" ở đó là sai và khiến
 * người dùng đi thay khoá một cách vô ích.
 */
export function looksLikeMissingPermission(bodyText: string): boolean {
  return (
    bodyText.includes('missing_permissions') ||
    /missing the permission/i.test(bodyText) ||
    /insufficient_permissions/i.test(bodyText)
  )
}

/** Ánh xạ mã trạng thái HTTP sang phân loại lỗi mà giao diện hiểu được. */
export function classifyHttpStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'invalid-credential'
  if (status === 429) return 'rate-limited'
  // 402 Payment Required và 413 Payload Too Large đều là "yêu cầu này sẽ không
  // bao giờ chạy được nếu không đổi gì", nên không đáng thử lại.
  if (status === 402) return 'quota-exceeded'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'server-error'
  if (status >= 400) return 'bad-request'
  return 'unknown'
}

/**
 * Rút thông báo dễ hiểu từ thân phản hồi lỗi.
 *
 * Mỗi provider có hình dạng lỗi riêng và tài liệu thường không mô tả đầy đủ, nên
 * ở đây thử vài hình dạng phổ biến rồi mới lùi về chuỗi thô đã cắt ngắn.
 */
export function extractErrorMessage(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>

      // { "error": { "message": "..." } } — dạng của OpenAI.
      const error = record.error
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message
        if (typeof message === 'string') return message
      }
      if (typeof error === 'string') return error

      // { "detail": ... } — dạng của FastAPI, ElevenLabs dùng.
      const detail = record.detail
      if (typeof detail === 'string') return detail
      if (detail && typeof detail === 'object') {
        const message = (detail as Record<string, unknown>).message
        if (typeof message === 'string') return message
        const status = (detail as Record<string, unknown>).status
        if (typeof status === 'string') return status
      }

      if (typeof record.message === 'string') return record.message
    }
  } catch {
    // Không phải JSON — dùng nguyên văn bản.
  }

  return bodyText.slice(0, 300) || 'Provider không trả về nội dung lỗi'
}

async function performRequest(options: HttpRequestOptions): Promise<Response> {
  const timeoutController = new AbortController()
  const timeout = setTimeout(
    () => timeoutController.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )

  // Gộp hai nguồn huỷ: người dùng bấm huỷ, và quá hạn chờ.
  const onAbort = (): void => timeoutController.abort()
  options.signal.addEventListener('abort', onAbort)

  try {
    return await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: timeoutController.signal
    })
  } catch (error) {
    if (options.signal.aborted) {
      throw new ProviderError({
        kind: 'cancelled',
        providerId: options.providerId,
        message: 'Đã huỷ theo yêu cầu',
        retryable: false
      })
    }
    if (timeoutController.signal.aborted) {
      throw new ProviderError({
        kind: 'timeout',
        providerId: options.providerId,
        message: 'Provider không phản hồi kịp thời hạn'
      })
    }
    throw new ProviderError({
      kind: 'network',
      providerId: options.providerId,
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    clearTimeout(timeout)
    options.signal.removeEventListener('abort', onAbort)
  }
}

async function throwIfNotOk(response: Response, providerId: string): Promise<void> {
  if (response.ok) return

  const bodyText = await response.text().catch(() => '')
  const statusKind = classifyHttpStatus(response.status)
  const kind: ProviderErrorKind =
    statusKind === 'invalid-credential' && looksLikeMissingPermission(bodyText)
      ? 'insufficient-permission'
      : statusKind
  const detail = extractErrorMessage(bodyText)

  const message =
    kind === 'insufficient-permission'
      ? `Khoá API hợp lệ nhưng thiếu quyền cho thao tác này. ${detail}`
      : kind === 'invalid-credential'
        ? `Khoá API bị từ chối (HTTP ${response.status}). ${detail}`
        : kind === 'rate-limited'
          ? `Provider đang giới hạn tần suất (HTTP 429). ${detail}`
          : `Provider trả lỗi HTTP ${response.status}. ${detail}`

  throw new ProviderError({ kind, providerId, message, status: response.status })
}

export async function requestJson<T>(options: HttpRequestOptions): Promise<T> {
  const response = await performRequest(options)
  await throwIfNotOk(response, options.providerId)

  try {
    return (await response.json()) as T
  } catch {
    throw new ProviderError({
      kind: 'server-error',
      providerId: options.providerId,
      message: 'Provider trả về nội dung không phải JSON hợp lệ'
    })
  }
}

export interface BinaryResponse {
  bytes: Uint8Array
  contentType: string
}

export async function requestBinary(options: HttpRequestOptions): Promise<BinaryResponse> {
  const response = await performRequest(options)
  await throwIfNotOk(response, options.providerId)

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new ProviderError({
      kind: 'server-error',
      providerId: options.providerId,
      message: 'Provider trả về audio rỗng'
    })
  }

  return {
    bytes: new Uint8Array(buffer),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream'
  }
}
