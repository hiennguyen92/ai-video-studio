import type { RendererApi } from '../shared/ipc/ipc-contract'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
