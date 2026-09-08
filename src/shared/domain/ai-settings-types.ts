import type { GlossaryEntry } from './transcript-types'

/**
 * Thiết lập AI lưu TRONG project.
 *
 * Tuyệt đối không chứa bí mật: API key chỉ nằm trong keychain của hệ điều hành,
 * không vào project JSON, không vào bundle frontend, không vào log (DESCRIPTION §6).
 * Ở đây chỉ lưu "dùng provider nào, model nào, giọng nào".
 *
 * Thứ tự phân giải khi chạy: override của project -> mặc định toàn ứng dụng ->
 * mặc định của provider.
 */

/** Bốn nhóm tác vụ AI, mỗi nhóm một interface riêng (DESCRIPTION §6). */
export type AiTaskKind = 'stt' | 'translate' | 'tts' | 'music'

export interface TaskBinding {
  providerId: string
  model: string
}

export interface VoicePreset {
  id: string
  name: string
  providerId: string
  model: string
  voiceId: string
  language: string
  /**
   * Chỉ chứa tham số mà provider THỰC SỰ hỗ trợ.
   * UI không được hiển thị tham số provider không có (DESCRIPTION §3.B).
   */
  settings: Record<string, number | string | boolean>
}

export interface Glossary {
  id: string
  name: string
  sourceLanguage: string
  targetLanguage: string
  entries: GlossaryEntry[]
}

/** Cấu hình tự giảm nhạc nền khi có lời nói (DESCRIPTION §3.C). */
export interface DuckingSettings {
  enabled: boolean
  /** Vai trò của track bị giảm âm — thường là nhạc nền. */
  targetRole: 'music' | 'sfx'
  /** Vai trò của track kích hoạt việc giảm âm — thường là lời nói. */
  triggerRoles: Array<'dialogue' | 'voiceover'>
  /** Mức giảm, tính bằng dB (số dương nghĩa là giảm bấy nhiêu dB). */
  reductionDb: number
  attackMs: number
  releaseMs: number
  /** Đệm trước/sau mỗi đoạn có lời nói. */
  holdMs: number
}

export const DEFAULT_DUCKING_SETTINGS: DuckingSettings = {
  enabled: false,
  targetRole: 'music',
  triggerRoles: ['dialogue', 'voiceover'],
  reductionDb: 12,
  attackMs: 120,
  releaseMs: 400,
  holdMs: 200
}

export interface ProjectAiSettings {
  /** null nghĩa là dùng mặc định toàn ứng dụng. */
  taskBindings: Partial<Record<AiTaskKind, TaskBinding | null>>
  defaultVoicePresetId?: string
  voicePresets: VoicePreset[]
  sourceLanguage?: string
  targetLanguage?: string
  glossaries: Glossary[]
  ducking: DuckingSettings
}

export function createDefaultAiSettings(): ProjectAiSettings {
  return {
    taskBindings: {},
    voicePresets: [],
    sourceLanguage: 'vi',
    targetLanguage: 'en',
    glossaries: [],
    ducking: { ...DEFAULT_DUCKING_SETTINGS }
  }
}

/** dB -> hệ số gain tuyến tính. reductionDb = 12 cho ra ~0.251. */
export function decibelsToGain(db: number): number {
  return Math.pow(10, -Math.abs(db) / 20)
}

export function gainToDecibels(gain: number): number {
  if (gain <= 0) return -Infinity
  return 20 * Math.log10(gain)
}
