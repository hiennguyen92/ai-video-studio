import type { AiTaskKind } from '../../../../shared/ai/ai-capability-types'

/** Tab con của Cấu hình AI. Bốn tab đầu ứng với một loại việc AI; MCP là kết nối agent ngoài. */
export type AiSettingsSection = 'voice' | 'transcribe' | 'translate' | 'music' | 'mcp'

export const AI_SETTINGS_SECTIONS: AiSettingsSection[] = [
  'voice',
  'transcribe',
  'translate',
  'music',
  'mcp'
]

/** Provider nào hiện ở tab nào: theo loại việc provider khai báo làm được. */
export const AI_SETTINGS_SECTION_TASK: Record<Exclude<AiSettingsSection, 'mcp'>, AiTaskKind> = {
  voice: 'tts',
  transcribe: 'stt',
  translate: 'translate',
  music: 'music'
}
