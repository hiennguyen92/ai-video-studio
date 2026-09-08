import { ipcMain, type WebContents } from 'electron'
import type {
  AiSettingsSnapshot,
  AttachGeneratedAudioRequest,
  GenerateSpeechIpcRequest,
  IpcResult,
  ListVoicesRequest
} from '../../shared/ipc/ipc-contract'
import { IPC, IPC_EVENT } from '../../shared/ipc/ipc-contract'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import {
  deleteCredential,
  encryptionStatus,
  getCredential,
  hasCredential,
  setCredential
} from '../secrets/credential-store'
import { bridgeJobEvents, jobQueue } from '../jobs/job-queue'
import { getTtsAdapter, listProviderDescriptors } from '../ai/provider-registry'
import { attachGeneratedAudioAsset, enqueueSpeechGeneration } from '../ai/tts-generation-service'

/**
 * Handler IPC cho phần AI và hàng đợi tác vụ.
 *
 * Ranh giới quan trọng nhất của file này: KHÔNG có handler nào trả khoá API về
 * renderer. Renderer chỉ hỏi được "provider này đã có khoá chưa" (`hasCredential`).
 * Khoá được giải mã ngay tại đây, ngay trước khi gọi provider, rồi biến mất.
 */

function toErrorMessage(error: unknown): string {
  if (error instanceof ProviderError) return error.message
  return error instanceof Error ? error.message : String(error)
}

async function guard<T>(work: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await work() }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

/** Dựng ngữ cảnh gọi provider, kèm khoá đã giải mã. */
async function adapterContextFor(
  providerId: string
): Promise<{ apiKey: string; signal: AbortSignal }> {
  const apiKey = await getCredential(providerId)
  if (!apiKey) {
    throw new ProviderError({
      kind: 'missing-credential',
      providerId,
      message: 'Chưa có khoá API cho provider này.',
      retryable: false
    })
  }
  // Các lời gọi tra cứu đều ngắn; thời hạn chờ trong lớp HTTP đã đủ bảo vệ.
  return { apiKey, signal: new AbortController().signal }
}

export function registerAiIpcHandlers(): void {
  ipcMain.handle(IPC.aiProviders, () =>
    guard(async () => {
      const descriptors = listProviderDescriptors()
      const providers = await Promise.all(
        descriptors.map(async (descriptor) => ({
          descriptor,
          hasCredential: await hasCredential(descriptor.id)
        }))
      )
      const snapshot: AiSettingsSnapshot = { providers, encryption: encryptionStatus() }
      return snapshot
    })
  )

  ipcMain.handle(IPC.aiSetCredential, (_event, providerId: string, apiKey: string) =>
    guard(() => setCredential(providerId, apiKey))
  )

  ipcMain.handle(IPC.aiDeleteCredential, (_event, providerId: string) =>
    guard(() => deleteCredential(providerId))
  )

  ipcMain.handle(IPC.aiTestConnection, (_event, providerId: string) =>
    guard(async () => {
      const adapter = getTtsAdapter(providerId)
      if (!adapter) throw new Error(`Không có adapter cho provider "${providerId}"`)
      const context = await adapterContextFor(providerId)
      return adapter.testConnection(context)
    })
  )

  ipcMain.handle(IPC.aiListModels, (_event, providerId: string) =>
    guard(async () => {
      const adapter = getTtsAdapter(providerId)
      if (!adapter) throw new Error(`Không có adapter cho provider "${providerId}"`)
      // Danh sách model của cả hai provider là hằng số trong tài liệu, nên không
      // đòi khoá API ở đây — người dùng xem được model trước khi nhập khoá.
      return adapter.listModels({ apiKey: '', signal: new AbortController().signal })
    })
  )

  ipcMain.handle(IPC.aiListVoices, (_event, request: ListVoicesRequest) =>
    guard(async () => {
      const adapter = getTtsAdapter(request.providerId)
      if (!adapter) throw new Error(`Không có adapter cho provider "${request.providerId}"`)

      // Danh mục giọng cố định thì không cần khoá; danh mục lấy từ tài khoản thì cần.
      // Hỏi năng lực theo một model có thật, vì khai báo năng lực phụ thuộc model.
      const emptyContext = { apiKey: '', signal: new AbortController().signal }
      const referenceModel = (await adapter.listModels(emptyContext))[0]?.id ?? ''
      if (adapter.capabilities(referenceModel).voiceCatalog === 'static') {
        return adapter.listVoices(emptyContext, { language: request.language })
      }

      const context = await adapterContextFor(request.providerId)
      return adapter.listVoices(context, { language: request.language })
    })
  )

  ipcMain.handle(IPC.aiCapabilities, (_event, providerId: string, model: string) =>
    guard(async () => {
      const adapter = getTtsAdapter(providerId)
      if (!adapter) throw new Error(`Không có adapter cho provider "${providerId}"`)
      return adapter.capabilities(model)
    })
  )

  ipcMain.handle(IPC.aiGenerateSpeech, (_event, request: GenerateSpeechIpcRequest) =>
    guard(() => enqueueSpeechGeneration(request))
  )

  ipcMain.handle(IPC.aiAttachGeneratedAudio, (_event, request: AttachGeneratedAudioRequest) =>
    guard(() => attachGeneratedAudioAsset(request))
  )

  ipcMain.handle(IPC.jobList, (_event, projectId: string) =>
    guard(async () => jobQueue.list(projectId))
  )

  ipcMain.handle(IPC.jobCancel, (_event, jobId: string) =>
    guard(async () => {
      jobQueue.cancel(jobId)
    })
  )

  ipcMain.handle(IPC.jobClearFinished, (_event, projectId: string) =>
    guard(async () => {
      jobQueue.clearFinished(projectId)
    })
  )
}

/** Nối luồng sự kiện job tới một cửa sổ. */
export function attachJobEventBridge(sender: WebContents): () => void {
  return bridgeJobEvents(sender, IPC_EVENT.jobChanged)
}
