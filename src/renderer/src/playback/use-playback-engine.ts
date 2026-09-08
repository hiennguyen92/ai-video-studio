import { useEffect, useMemo, useRef } from 'react'
import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import { projectDurationUs } from '../../../shared/domain/project-document-types'
import { resolveCompositionAt } from '../../../shared/domain/composition-resolver'
import { microsToSeconds } from '../../../shared/domain/time-units'
import { useEditorStore } from '../state/editor-store'
import {
  MediaElementRegistry,
  PLAYBACK_DRIFT_TOLERANCE_SECONDS,
  SEEK_EPSILON_SECONDS
} from './media-element-registry'

/**
 * Bộ máy phát: một vòng lặp requestAnimationFrame duy nhất điều khiển playhead và
 * kéo mọi thẻ media về đúng vị trí.
 *
 * Đồng hồ chủ là thời gian thực (performance.now), KHÔNG phải `currentTime` của
 * thẻ video. Vì có nhiều clip trên nhiều track cùng phát, lấy một thẻ bất kỳ làm
 * đồng hồ sẽ khiến các track trôi khỏi nhau mỗi khi thẻ đó ngập băng thông hoặc
 * đang seek.
 */

export function usePlaybackEngine(document: ProjectDocument | null): MediaElementRegistry {
  const registry = useMemo(() => new MediaElementRegistry(), [])
  const frameRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)

  // Đọc qua ref để vòng lặp không phải khởi động lại mỗi lần playhead đổi.
  // Gán trong effect chứ không gán lúc render: sửa ref khi đang render là tác dụng
  // phụ, và React có thể render lại mà không commit, khiến ref lệch với UI.
  const documentRef = useRef(document)
  useEffect(() => {
    documentRef.current = document
  }, [document])

  const isPlaying = useEditorStore((state) => state.isPlaying)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  useEffect(() => {
    const syncElements = (playheadUs: number, playing: boolean): void => {
      const doc = documentRef.current
      if (!doc) return

      const frame = resolveCompositionAt(doc, playheadUs)
      const activeIds = new Set<string>()

      for (const layer of [...frame.video, ...frame.audio]) {
        const element = registry.get(layer.clip.id)
        if (!element) continue
        activeIds.add(layer.clip.id)

        const targetSeconds = microsToSeconds(layer.sourceTimeUs)
        const drift = Math.abs(element.currentTime - targetSeconds)

        if (playing) {
          if (drift > PLAYBACK_DRIFT_TOLERANCE_SECONDS) element.currentTime = targetSeconds
          if (element.playbackRate !== layer.clip.speed) element.playbackRate = layer.clip.speed
          if (element.paused) void element.play().catch(() => undefined)
        } else {
          if (!element.paused) element.pause()
          if (drift > SEEK_EPSILON_SECONDS) element.currentTime = targetSeconds
        }

        // Gain chỉ có ở lớp audio; lớp video luôn im vì tiếng đi theo track audio riêng.
        element.volume = 'gain' in layer ? Math.max(0, Math.min(1, layer.gain)) : 0
      }

      // Clip vừa rời khỏi playhead phải dừng lại, nếu không nó cứ phát tiếp trong nền.
      for (const clipId of registry.ids()) {
        if (activeIds.has(clipId)) continue
        const element = registry.get(clipId)
        if (element && !element.paused) element.pause()
      }
    }

    if (!isPlaying) {
      syncElements(useEditorStore.getState().playheadUs, false)
      return
    }

    lastTickRef.current = performance.now()

    const tick = (now: number): void => {
      const deltaUs = Math.round((now - lastTickRef.current) * 1000)
      lastTickRef.current = now

      const store = useEditorStore.getState()
      const doc = documentRef.current
      const endUs = doc ? projectDurationUs(doc) : 0
      const nextUs = store.playheadUs + deltaUs

      if (endUs > 0 && nextUs >= endUs) {
        store.setPlayhead(endUs)
        setPlaying(false)
        syncElements(endUs, false)
        return
      }

      store.setPlayhead(nextUs)
      syncElements(nextUs, true)
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [isPlaying, registry, setPlaying])

  // Khi tạm dừng, kéo phần tử về đúng frame mỗi lần người dùng dời playhead.
  const playheadUs = useEditorStore((state) => state.playheadUs)
  useEffect(() => {
    if (isPlaying) return
    const doc = documentRef.current
    if (!doc) return

    const frame = resolveCompositionAt(doc, playheadUs)
    for (const layer of [...frame.video, ...frame.audio]) {
      const element = registry.get(layer.clip.id)
      if (!element) continue
      const targetSeconds = microsToSeconds(layer.sourceTimeUs)
      if (Math.abs(element.currentTime - targetSeconds) > SEEK_EPSILON_SECONDS) {
        element.currentTime = targetSeconds
      }
      element.volume = 'gain' in layer ? Math.max(0, Math.min(1, layer.gain)) : 0
    }
  }, [playheadUs, isPlaying, registry])

  return registry
}
