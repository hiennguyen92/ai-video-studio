import { planRippleDeleteClips } from '../../../shared/commands/clip-ripple-delete'
import { expandToLinkGroups } from '../../../shared/domain/clip-link-groups'
import { createId } from '../../../shared/domain/project-document-factory'
import { snapMicrosToFrame } from '../../../shared/domain/time-units'
import {
  adjacentMarker,
  chapterListText,
  type TimelineMarker
} from '../../../shared/domain/timeline-marker-types'
import { useEditorStore } from './editor-store'

/**
 * Marker và ripple delete — dùng chung cho nút trên thanh công cụ và phím tắt,
 * để hai lối vào không lệch nhau. Đọc store lúc gọi chứ không theo dõi.
 */

/** Đặt marker tại đầu phát. Đã có marker ở đúng khung đó thì thôi — hai lá cờ chồng khít nhau không bấm riêng được. */
export function addMarkerAtPlayhead(label: string): TimelineMarker | null {
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document) return null
  const atUs = snapMicrosToFrame(store.playheadUs, document.settings.frameRate)
  if (document.markers.some((marker) => marker.atUs === atUs)) return null

  const marker: TimelineMarker = { id: createId('marker'), atUs, label: '', color: 'blue' }
  return store.run([{ type: 'marker/add', marker }], label) ? marker : null
}

/** Nhảy đầu phát tới marker kế tiếp (1) hoặc liền trước (-1). */
export function jumpToMarker(direction: 1 | -1): boolean {
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document) return false
  const target = adjacentMarker(document.markers, store.playheadUs, direction)
  if (!target) return false
  store.setPlaying(false)
  store.setPlayhead(target.atUs)
  return true
}

/** Ripple delete các clip đang chọn, kèm cả nhóm của chúng. */
export function rippleDeleteSelection(label: string): boolean {
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document || store.selection.clipIds.length === 0) return false
  const plan = planRippleDeleteClips(
    document,
    expandToLinkGroups(document, store.selection.clipIds)
  )
  if (!plan) return false
  if ('error' in plan) {
    store.setError(plan.error)
    return false
  }
  if (!store.run(plan.commands, label)) return false
  store.clearSelection()
  return true
}

/** Danh sách chương dạng YouTube từ marker hiện có; `null` khi chưa có marker nào. */
export function currentChapterList(
  introLabel: string,
  untitled: (index: number) => string
): string | null {
  const document = useEditorStore.getState().session?.document
  if (!document || document.markers.length === 0) return null
  return chapterListText(document.markers, introLabel, untitled)
}
