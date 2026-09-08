import { useCallback } from 'react'
import type { EditorCommand } from '../../../shared/commands/editor-command-types'
import type { TrackRole } from '../../../shared/domain/timeline-track-types'
import { findFreeSlot } from '../../../shared/commands/timeline-mutations'
import { createId } from '../../../shared/domain/project-document-factory'
import { useEditorStore } from '../state/editor-store'

/**
 * Chèn audio đã tạo vào timeline (DESCRIPTION §3.B: chèn tại playhead, trên track
 * mới, hoặc thay thế đoạn đang chọn).
 *
 * Chèn nhiều đoạn là MỘT giao dịch, nên một lần "chèn cả bài lồng tiếng" chỉ tốn
 * một lần hoàn tác chứ không phải mười lăm lần.
 */

export type InsertMode = 'playhead' | 'new-track' | 'replace-selected'

export interface InsertAudioOptions {
  /** Theo thứ tự cần đặt nối tiếp nhau trên timeline. */
  assetIds: string[]
  mode: InsertMode
  role: TrackRole
  /** Tên track khi tạo track mới. */
  newTrackName: string
}

export function useAudioInsertion(): {
  insertAudio(options: InsertAudioOptions): boolean
  canReplaceSelection: boolean
} {
  const run = useEditorStore((state) => state.run)
  const selection = useEditorStore((state) => state.selection)
  const session = useEditorStore((state) => state.session)

  const canReplaceSelection = Boolean(
    selection.clipIds.length === 1 &&
    session?.document.tracks.some(
      (track) =>
        track.kind === 'audio' && track.clips.some((clip) => clip.id === selection.clipIds[0])
    )
  )

  const insertAudio = useCallback(
    (options: InsertAudioOptions): boolean => {
      const state = useEditorStore.getState()
      const document = state.session?.document
      if (!document || options.assetIds.length === 0) return false

      const assets = options.assetIds
        .map((assetId) => document.assets.find((item) => item.id === assetId))
        .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      if (assets.length === 0) return false

      const commands: EditorCommand[] = []

      if (options.mode === 'replace-selected') {
        const clipId = state.selection.clipIds[0]
        const track = document.tracks.find((item) => item.clips.some((clip) => clip.id === clipId))
        const clip = track?.clips.find((item) => item.id === clipId)
        if (!track || !clip) return false

        // Xoá clip cũ rồi đặt clip mới đúng vào vị trí đó. Thời lượng lấy theo
        // audio MỚI chứ không ép bằng clip cũ — ép sẽ cắt mất lời nói.
        commands.push({ type: 'clip/remove', clipId })
        let cursor = clip.startUs
        for (const asset of assets) {
          commands.push({
            type: 'clip/insert',
            trackId: track.id,
            assetId: asset.id,
            startUs: cursor,
            durationUs: asset.probe.durationUs,
            sourceInUs: 0
          })
          cursor += asset.probe.durationUs
        }
        return run(commands, 'Thay clip bằng giọng đọc')
      }

      let trackId: string
      let startUs: number

      if (options.mode === 'new-track') {
        trackId = createId('track')
        commands.push({
          type: 'track/add',
          trackId,
          kind: 'audio',
          name: options.newTrackName,
          role: options.role
        })
        startUs = state.playheadUs
      } else {
        // Ưu tiên track đúng vai trò; không có thì lấy track audio đầu tiên còn mở khoá.
        const preferred =
          document.tracks.find(
            (track) => track.kind === 'audio' && track.role === options.role && !track.locked
          ) ?? document.tracks.find((track) => track.kind === 'audio' && !track.locked)

        if (!preferred) {
          trackId = createId('track')
          commands.push({
            type: 'track/add',
            trackId,
            kind: 'audio',
            name: options.newTrackName,
            role: options.role
          })
        } else {
          trackId = preferred.id
        }

        const totalUs = assets.reduce((sum, asset) => sum + asset.probe.durationUs, 0)
        const existingClips = document.tracks.find((track) => track.id === trackId)?.clips ?? []
        // Tìm chỗ trống từ playhead trở đi để không đè lên clip đang có.
        startUs = findFreeSlot(existingClips, state.playheadUs, totalUs)
      }

      let cursor = startUs
      for (const asset of assets) {
        commands.push({
          type: 'clip/insert',
          trackId,
          assetId: asset.id,
          startUs: cursor,
          durationUs: asset.probe.durationUs,
          sourceInUs: 0
        })
        cursor += asset.probe.durationUs
      }

      return run(commands, 'Chèn giọng đọc vào timeline')
    },
    [run]
  )

  return { insertAudio, canReplaceSelection }
}
