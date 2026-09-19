import {
  ASPECT_RATIO_DIMENSIONS,
  CURRENT_PROJECT_SCHEMA_VERSION,
  type AspectRatio,
  type ProjectDocument,
  type ProjectSettings
} from './project-document-types'
import { FRAME_RATE_PRESETS } from './time-units'
import {
  DEFAULT_TRACK_HEIGHT,
  type Track,
  type TrackKind,
  type TrackRole
} from './timeline-track-types'
import { createDefaultAiSettings } from './ai-settings-types'

/** Sinh id ngắn, đủ duy nhất trong phạm vi một project. */
export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  const stamp = Date.now().toString(36)
  return `${prefix}_${stamp}${random}`
}

export function createDefaultProjectSettings(aspectRatio: AspectRatio = '16:9'): ProjectSettings {
  const { width, height } = ASPECT_RATIO_DIMENSIONS[aspectRatio]
  return {
    width,
    height,
    frameRate: FRAME_RATE_PRESETS['30'],
    aspectRatio,
    sampleRate: 48000,
    backgroundColor: '#000000'
  }
}

interface CreateTrackOptions {
  kind: TrackKind
  name: string
  role?: TrackRole
  subtitleTrackId?: string
}

export function createTrack(options: CreateTrackOptions): Track {
  return {
    id: createId('track'),
    kind: options.kind,
    role: options.role,
    name: options.name,
    hidden: false,
    muted: false,
    solo: false,
    locked: false,
    volume: 1,
    height: DEFAULT_TRACK_HEIGHT,
    subtitleTrackId: options.subtitleTrackId,
    clips: []
  }
}

/**
 * Bộ track mặc định phản ánh đúng bố cục timeline mà DESCRIPTION §2 mô tả:
 * video, phụ đề, lồng tiếng, nhạc/SFX.
 *
 * Thứ tự trong mảng = thứ tự xếp lớp: phần tử SAU nằm TRÊN khi ghép hình.
 */
export function createDefaultTracks(): Track[] {
  return [
    createTrack({ kind: 'video', name: 'Video 1' }),
    createTrack({ kind: 'audio', name: 'Lồng tiếng 1', role: 'voiceover' }),
    createTrack({ kind: 'audio', name: 'Nhạc nền 1', role: 'music' })
  ]
}

export interface CreateProjectOptions {
  name: string
  aspectRatio?: AspectRatio
}

export function createEmptyProject(options: CreateProjectOptions): ProjectDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: createId('proj'),
    name: options.name,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    settings: createDefaultProjectSettings(options.aspectRatio ?? '16:9'),
    assets: [],
    tracks: createDefaultTracks(),
    transcripts: [],
    translations: [],
    dubbingSessions: [],
    subtitleTracks: [],
    textOverlays: [],
    markers: [],
    aiSettings: createDefaultAiSettings()
  }
}
