import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import { DEFAULT_SUBTITLE_STYLE } from '../domain/subtitle-types'
import { planChatToolCalls } from './chat-tool-planner'

let counter = 0
const makeId = (prefix = 'id'): string => `${prefix}_${(counter += 1)}`

function project(): ReturnType<typeof createEmptyProject> {
  const document = createEmptyProject({ name: 'Thử' })
  document.subtitleTracks.push({
    id: 'sub',
    name: 'Phụ đề',
    language: 'vi',
    source: { kind: 'manual' },
    style: { ...DEFAULT_SUBTITLE_STYLE },
    cues: [{ id: 'c', startUs: 0, endUs: 4_000_000, text: 'một hai ba bốn năm sáu', edited: false }]
  })
  return document
}

describe('set_subtitle_word_highlight', () => {
  it('bật tô chữ và chia cụm trong MỘT bước', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: [], playheadUs: 0, makeId }, [
      {
        name: 'set_subtitle_word_highlight',
        arguments: { subtitleTrackId: 'sub', mode: 'word', wordsPerChunk: 3 }
      }
    ])
    expect(plan.failures).toEqual([])
    expect(plan.steps).toHaveLength(1)
    for (const command of plan.steps[0].commands) {
      const result = applyEditorCommand(document, command)
      if (!result.ok) throw new Error(result.error)
    }
    const track = document.subtitleTracks[0]
    expect(track.style.wordHighlight).toEqual({ mode: 'word', color: '#FFE45C' })
    expect(track.cues.map((cue) => cue.text)).toEqual(['một hai ba', 'bốn năm sáu'])
  })

  it('chỉ nêu màu khi đang tắt: bật kiểu chữ đang nói với màu đó', () => {
    const plan = planChatToolCalls(
      { document: project(), selectedClipIds: [], playheadUs: 0, makeId },
      [
        {
          name: 'set_subtitle_word_highlight',
          arguments: { subtitleTrackId: 'sub', color: '#00FF00' }
        }
      ]
    )
    const command = plan.steps[0].commands[0]
    expect(command.type === 'subtitle/set-style' && command.style.wordHighlight).toEqual({
      mode: 'word',
      color: '#00FF00'
    })
  })

  it('không nêu gì: từ chối thay vì báo "đã xong"', () => {
    const plan = planChatToolCalls(
      { document: project(), selectedClipIds: [], playheadUs: 0, makeId },
      [{ name: 'set_subtitle_word_highlight', arguments: { subtitleTrackId: 'sub' } }]
    )
    expect(plan.failures).toHaveLength(1)
  })
})
