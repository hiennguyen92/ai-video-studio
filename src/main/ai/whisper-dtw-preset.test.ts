import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { whisperDtwPreset } from './whisper-cpp-stt-adapter'

describe('preset DTW suy từ tên file model', () => {
  it('nhận ra các model chuẩn và bản lượng tử hoá', () => {
    expect(whisperDtwPreset('/m/ggml-medium.bin')).toBe('medium')
    expect(whisperDtwPreset('/m/ggml-base.en.bin')).toBe('base.en')
    expect(whisperDtwPreset('/m/ggml-large-v3.bin')).toBe('large.v3')
    expect(whisperDtwPreset('/m/ggml-large-v3-turbo.bin')).toBe('large.v3.turbo')
    expect(whisperDtwPreset('/m/ggml-small-q5_1.bin')).toBe('small')
  })

  it('model lạ thì không dùng DTW', () => {
    expect(whisperDtwPreset('/m/my-finetune.bin')).toBeUndefined()
    expect(whisperDtwPreset('/m/ggml-vi-custom.bin')).toBeUndefined()
  })
})
