import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Tải model ggml cho whisper.cpp.
 *
 * Có mặt vì nếu không, người dùng phải tự tìm URL trên Hugging Face và tải một
 * file 1,5 GB bằng tay trước khi phiên âm được lần đầu — rào cản đủ lớn để tính
 * năng "chạy local" trở thành vô dụng trên thực tế.
 *
 * Model nằm ở thư mục dữ liệu ứng dụng, KHÔNG nằm trong project: nó là tài
 * nguyên của MÁY, dùng chung cho mọi dự án, và nặng hơn cả một project.
 */

const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export interface WhisperModelInfo {
  id: string
  fileName: string
  /** Kích thước xấp xỉ, tính bằng byte — để hiển thị trước khi tải. */
  approximateBytes: number
  labelVi: string
  labelEn: string
  /** Khuyến nghị cho tiếng Việt, dựa trên đo đạc thực tế. */
  vietnameseQuality: 'kém' | 'khá' | 'tốt'
}

/**
 * Danh sách model, kèm đánh giá tiếng Việt ĐO ĐƯỢC chứ không phỏng đoán.
 *
 * Cách đo: tổng hợp một câu tiếng Việt có đủ dấu thanh, dấu mũ và dấu móc, cho
 * từng model phiên âm rồi đếm số chữ sai dấu. `small` sai 5 chỗ trong một câu,
 * `medium` sai 3 — nên `small` bị đánh dấu là kém cho tiếng Việt.
 */
export const WHISPER_MODELS: WhisperModelInfo[] = [
  {
    id: 'base',
    fileName: 'ggml-base.bin',
    approximateBytes: 148_000_000,
    labelVi: 'Base — nhanh nhất, tiếng Việt kém',
    labelEn: 'Base — fastest, poor Vietnamese',
    vietnameseQuality: 'kém'
  },
  {
    id: 'small',
    fileName: 'ggml-small.bin',
    approximateBytes: 488_000_000,
    labelVi: 'Small — nhanh, còn sai nhiều dấu',
    labelEn: 'Small — fast, still misses many diacritics',
    vietnameseQuality: 'kém'
  },
  {
    id: 'medium',
    fileName: 'ggml-medium.bin',
    approximateBytes: 1_534_000_000,
    labelVi: 'Medium — khuyến nghị cho tiếng Việt',
    labelEn: 'Medium — recommended for Vietnamese',
    vietnameseQuality: 'khá'
  },
  {
    id: 'large-v3',
    fileName: 'ggml-large-v3.bin',
    approximateBytes: 3_100_000_000,
    labelVi: 'Large v3 — chính xác nhất, chậm và nặng',
    labelEn: 'Large v3 — most accurate, slow and heavy',
    vietnameseQuality: 'tốt'
  }
]

export function whisperModelsDir(): string {
  return join(app.getPath('userData'), 'whisper-models')
}

export function whisperModelPath(model: WhisperModelInfo): string {
  return join(whisperModelsDir(), model.fileName)
}

export interface DownloadedModel {
  id: string
  path: string
  sizeBytes: number
}

/** Model đã tải xong, để giao diện khỏi mời tải lại. */
export async function listDownloadedModels(): Promise<DownloadedModel[]> {
  const found: DownloadedModel[] = []
  for (const model of WHISPER_MODELS) {
    try {
      const path = whisperModelPath(model)
      const stats = await stat(path)
      // File tải dở dang sẽ nhỏ hơn nhiều so với kích thước công bố; bỏ qua để
      // người dùng không trỏ model hỏng vào adapter.
      if (stats.size > model.approximateBytes * 0.9) {
        found.push({ id: model.id, path, sizeBytes: stats.size })
      }
    } catch {
      // Chưa tải — bỏ qua.
    }
  }
  return found
}

export interface DownloadProgress {
  receivedBytes: number
  /** Tổng byte theo header Content-Length; vắng khi máy chủ không báo. */
  totalBytes?: number
  ratio?: number
}

export interface DownloadHandle {
  cancel(): void
  done: Promise<string>
}

export function downloadWhisperModel(
  modelId: string,
  onProgress: (progress: DownloadProgress) => void
): DownloadHandle {
  const model = WHISPER_MODELS.find((item) => item.id === modelId)
  if (!model) {
    return {
      cancel: () => undefined,
      done: Promise.reject(new Error(`Không biết model "${modelId}".`))
    }
  }

  const controller = new AbortController()
  const target = whisperModelPath(model)
  // Tải vào file tạm rồi mới đổi tên: tải dở bị ngắt sẽ không để lại một file
  // mang đúng tên model nhưng nội dung thiếu, thứ mà whisper.cpp sẽ nhận rồi lỗi.
  const temporary = `${target}.part`

  const done = (async (): Promise<string> => {
    await mkdir(whisperModelsDir(), { recursive: true })

    let response: Response
    try {
      response = await fetch(`${MODEL_BASE_URL}/${model.fileName}`, {
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Đã huỷ tải model')
      throw new Error(`Không tải được model: ${error instanceof Error ? error.message : error}`)
    }

    if (!response.ok || !response.body) {
      throw new Error(`Không tải được model: máy chủ trả HTTP ${response.status}`)
    }

    const header = response.headers.get('content-length')
    const totalBytes = header ? Number(header) : undefined
    let receivedBytes = 0

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length
      onProgress({
        receivedBytes,
        totalBytes,
        // Chỉ tính phần trăm khi máy chủ báo tổng; không có thì để trống thay vì
        // đoán theo kích thước công bố.
        ratio: totalBytes ? Math.min(1, receivedBytes / totalBytes) : undefined
      })
    })

    try {
      await pipeline(source, createWriteStream(temporary))
    } catch (error) {
      await rm(temporary, { force: true })
      if (controller.signal.aborted) throw new Error('Đã huỷ tải model')
      throw error
    }

    await rename(temporary, target)
    return target
  })()

  return { cancel: () => controller.abort(), done }
}

export async function deleteWhisperModel(modelId: string): Promise<void> {
  const model = WHISPER_MODELS.find((item) => item.id === modelId)
  if (!model) return
  await rm(whisperModelPath(model), { force: true })
}
