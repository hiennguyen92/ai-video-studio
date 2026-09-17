import { applySttSegmentation, type SttSegmentationMode } from '../../shared/ai/stt-segmentation'
import { spawn } from 'node:child_process'
import { access, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  AdapterContext,
  SttAdapter,
  SttRequest,
  SttResult
} from '../../shared/ai/ai-provider-contracts'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type {
  ConnectionTestResult,
  ProviderDescriptor,
  ProviderModel
} from '../../shared/ai/ai-capability-types'
import { parseProgressLine, parseWhisperJson } from './whisper-cpp-output-parser'

/**
 * Adapter phiên âm chạy LOCAL bằng whisper.cpp.
 *
 * Khác mọi adapter khác: không gọi HTTP mà chạy một tiến trình con. Vì vậy không
 * cần khoá API, không tốn phí, và audio không bao giờ rời khỏi máy — đúng định
 * hướng "ưu tiên chạy local" của đề bài.
 *
 * Mọi cờ dòng lệnh và hình dạng JSON ở đây được xác minh bằng cách CHẠY THẬT
 * whisper-cli 1.9.2 trên máy, không lấy từ tài liệu: dự án này từng đổi tên
 * binary (`main` -> `whisper-cli`) nên thông tin cũ trôi nổi rất nhiều.
 */

const PROVIDER_ID = 'whisper-cpp'

/** Nơi Homebrew đặt binary; dùng làm mặc định để người dùng đỡ phải điền. */
const DEFAULT_BINARY_CANDIDATES = [
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
  'whisper-cli'
]

/**
 * Độ dài tối đa mỗi đoạn, tính bằng ký tự.
 *
 * Không đặt thì whisper gộp cả đoạn dài bảy giây vào MỘT segment — dùng làm phụ
 * đề thì chữ tràn kín màn hình. Con số này cho ra đoạn vừa một tới hai dòng.
 */
const MAX_SEGMENT_CHARACTERS = 60

/**
 * Tên preset `--dtw` của whisper.cpp suy từ tên file model, ví dụ `ggml-medium.bin` →
 * `medium`, `ggml-large-v3-q5_0.bin` → `large.v3`. Không nhận ra thì `undefined`:
 * DTW sai loại model cho mốc thời gian vô nghĩa.
 */
export function whisperDtwPreset(modelPath: string): string | undefined {
  const match =
    /^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?(?:[-.].*)?\.bin$/i.exec(
      basename(modelPath)
    )
  if (!match) return undefined
  return `${match[1].toLowerCase().replace(/-/g, '.')}${match[2] ?? ''}`
}

export const whisperCppDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'whisper.cpp (chạy trong máy)',
  tasks: ['stt'],
  voiceCatalog: 'manual',
  credentialRequired: false,
  credentialLabel: 'Không cần khoá',
  credentialHelpUrl: 'https://github.com/ggml-org/whisper.cpp',
  noteVi:
    'Phiên âm chạy hoàn toàn trong máy, không tốn phí và audio không gửi đi đâu. Cần binary whisper-cli và một file model ggml.',
  noteEn:
    'Runs entirely on your machine — no cost, audio never leaves the device. Needs the whisper-cli binary and a ggml model file.',
  configFields: [
    {
      key: 'binaryPath',
      labelVi: 'Đường dẫn whisper-cli',
      labelEn: 'whisper-cli path',
      placeholder: '/opt/homebrew/bin/whisper-cli',
      hintVi: 'Cài bằng: brew install whisper-cpp. Để trống để tự dò.',
      hintEn: 'Install with: brew install whisper-cpp. Leave empty to auto-detect.',
      required: false
    },
    {
      key: 'modelPath',
      labelVi: 'File model ggml',
      labelEn: 'ggml model file',
      placeholder: '~/models/ggml-medium.bin',
      hintVi:
        'Model càng lớn càng đúng dấu tiếng Việt. Khuyến nghị medium trở lên; small sai dấu khá nhiều.',
      hintEn: 'Larger models handle Vietnamese diacritics better. Prefer medium or larger.',
      required: true
    },
    {
      key: 'threads',
      labelVi: 'Số luồng',
      labelEn: 'Threads',
      placeholder: '4',
      required: false
    }
  ]
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** Tìm binary: ưu tiên đường dẫn người dùng điền, sau đó tới các vị trí quen thuộc. */
export async function resolveWhisperBinary(configured?: string): Promise<string> {
  const candidates = configured?.trim() ? [configured.trim()] : DEFAULT_BINARY_CANDIDATES

  for (const candidate of candidates) {
    // Mục cuối là tên trần, để hệ thống tự tra PATH.
    if (!candidate.includes('/')) return candidate
    if (await fileExists(candidate)) return candidate
  }

  throw new ProviderError({
    kind: 'bad-request',
    providerId: PROVIDER_ID,
    message:
      'Không tìm thấy whisper-cli. Cài bằng "brew install whisper-cpp", hoặc điền đường dẫn trong Cấu hình AI.',
    retryable: false
  })
}

interface RunOptions {
  binaryPath: string
  modelPath: string
  audioPath: string
  language?: string
  threads?: number
  segmentation: SttSegmentationMode
  /** Preset `--dtw` cho mốc từng từ chính xác hơn; bỏ trống thì không dùng. */
  dtwPreset?: string
  signal: AbortSignal
  onProgress?(ratio: number): void
}

/** Chạy whisper-cli và trả về nội dung file JSON nó sinh ra. */
async function runWhisper(options: RunOptions): Promise<string> {
  // `-of` nhận đường dẫn KHÔNG có đuôi; whisper tự thêm ".json".
  const outputBase = join(dirname(options.audioPath), `${basename(options.audioPath)}-transcript`)
  const jsonPath = `${outputBase}.json`

  const args = [
    '-m',
    options.modelPath,
    '-f',
    options.audioPath,
    '-l',
    options.language?.trim() || 'auto',
    // -ojf thay vì -oj: chỉ bản "full" mới kèm token, và token là nguồn duy nhất
    // để dựng timestamp mức từ.
    '-ojf',
    '-of',
    outputBase,
    // In tiến trình thật để job hiển thị đúng phần trăm.
    '-pp',
    '-np'
  ]
  // Cụm ngắn: để whisper tự cắt ~60 ký tự ở ranh giới TỪ. Theo câu / theo từ: để
  // nguyên đoạn tự nhiên của whisper rồi gom lại theo mốc từng từ ở bước sau — cắt
  // theo độ dài trước thì mất ranh giới câu.
  if (options.segmentation === 'phrase') args.push('-ml', String(MAX_SEGMENT_CHARACTERS), '-sow')
  // DTW chỉ thật sự tính mốc khi TẮT flash attention: đo trên whisper-cli 1.9.2, để
  // flash attention bật (mặc định) thì mọi `t_dtw` đều là -1.
  if (options.dtwPreset) args.push('-dtw', options.dtwPreset, '-nfa')
  if (options.threads && options.threads > 0) args.push('-t', String(options.threads))

  const child = spawn(options.binaryPath, args)

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderr += text
    if (stderr.length > 32_000) stderr = stderr.slice(-16_000)

    if (options.onProgress) {
      for (const line of text.split('\n')) {
        const ratio = parseProgressLine(line)
        if (ratio !== null) options.onProgress(ratio)
      }
    }
  })

  const onAbort = (): void => {
    child.kill('SIGTERM')
  }
  options.signal.addEventListener('abort', onAbort)

  try {
    await new Promise<void>((resolve, reject) => {
      child.on('error', (error) =>
        reject(
          new ProviderError({
            kind: 'bad-request',
            providerId: PROVIDER_ID,
            message: `Không chạy được whisper-cli: ${error.message}`,
            retryable: false
          })
        )
      )
      child.on('close', (code, signal) => {
        if (options.signal.aborted || signal === 'SIGTERM') {
          reject(
            new ProviderError({
              kind: 'cancelled',
              providerId: PROVIDER_ID,
              message: 'Đã huỷ phiên âm',
              retryable: false
            })
          )
          return
        }
        if (code === 0) {
          resolve()
          return
        }
        // Dòng cuối của stderr thường là nguyên nhân thật.
        const lastLine =
          stderr
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1) ?? `mã thoát ${code}`
        reject(
          new ProviderError({
            kind: 'server-error',
            providerId: PROVIDER_ID,
            message: `whisper.cpp thất bại: ${lastLine}`
          })
        )
      })
    })

    return await readFile(jsonPath, 'utf8')
  } finally {
    options.signal.removeEventListener('abort', onAbort)
    // File JSON trung gian không cần giữ; transcript đã vào project document.
    await rm(jsonPath, { force: true })
  }
}

export const whisperCppSttAdapter: SttAdapter = {
  descriptor: whisperCppDescriptor,

  async listModels(context: AdapterContext): Promise<ProviderModel[]> {
    const modelPath = context.config?.modelPath?.trim()
    if (!modelPath) return []
    // "Model" ở đây là một file trên đĩa, không phải danh mục từ máy chủ.
    return [{ id: modelPath, label: basename(modelPath), languages: [] }]
  },

  async transcribe(context: AdapterContext, request: SttRequest): Promise<SttResult> {
    const modelPath = context.config?.modelPath?.trim()
    if (!modelPath) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: 'Chưa chọn file model ggml. Vào Cấu hình AI để điền đường dẫn.',
        retryable: false
      })
    }
    if (!(await fileExists(modelPath))) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Không đọc được file model "${modelPath}".`,
        retryable: false
      })
    }

    const binaryPath = await resolveWhisperBinary(context.config?.binaryPath)
    const threads = Number(context.config?.threads ?? '')

    const segmentation = request.segmentation ?? 'phrase'
    const run = (dtwPreset?: string): Promise<string> =>
      runWhisper({
        binaryPath,
        modelPath,
        audioPath: request.audioPath,
        language: request.language,
        threads: Number.isFinite(threads) && threads > 0 ? threads : undefined,
        segmentation,
        dtwPreset,
        signal: context.signal,
        onProgress: context.onProgress
      })

    // Theo từ cần mốc từng từ sát nhất: bật DTW nếu nhận ra loại model. DTW hỏng (bản
    // whisper-cli cũ, model lạ) thì chạy lại không có nó — mốc thô vẫn hơn không có gì.
    const dtwPreset = segmentation === 'word' ? whisperDtwPreset(modelPath) : undefined
    let json: string
    try {
      json = await run(dtwPreset)
    } catch (error) {
      const cancelled = error instanceof ProviderError && error.kind === 'cancelled'
      if (!dtwPreset || cancelled) throw error
      json = await run()
    }

    const parsed = parseWhisperJson(json)
    return {
      language: parsed.language,
      languageAutoDetected: !request.language,
      segments: applySttSegmentation(parsed.segments, segmentation)
    }
  },

  async testConnection(context: AdapterContext): Promise<ConnectionTestResult> {
    try {
      const binaryPath = await resolveWhisperBinary(context.config?.binaryPath)
      const modelPath = context.config?.modelPath?.trim()

      if (!modelPath) {
        return {
          ok: false,
          message: 'Đã tìm thấy whisper-cli nhưng chưa chọn file model ggml.'
        }
      }
      if (!(await fileExists(modelPath))) {
        return { ok: false, message: `Không đọc được file model "${modelPath}".` }
      }

      return {
        ok: true,
        message: 'Sẵn sàng phiên âm trong máy',
        details: `${binaryPath} · model ${basename(modelPath)}`
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
