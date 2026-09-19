import { planChatToolCalls } from '../../../shared/ai/chat-tool-planner'
import { createId } from '../../../shared/domain/project-document-factory'
import type { DetectedShotDto } from '../../../shared/ipc/ipc-contract'
import { useEditorStore } from './editor-store'

/**
 * Dựng bản cut từ giao diện: theo lời (đoạn phiên âm giữ lại) hoặc theo hình
 * (cú máy đã chọn).
 *
 * Đi qua ĐÚNG bộ lập kế hoạch mà agent dùng, không viết lại: agent và nút bấm
 * dựng ra cùng một kết quả, và mọi luật đã có ở đó (giữ thứ tự lời nói, từ chối
 * lane khoá, dọn lane trước khi xếp) tự áp cho cả hai.
 */

type BuildCall =
  | {
      name: 'build_cut_from_transcript'
      arguments: { transcriptId: string; keepSegmentIds: string[]; trackId?: string }
    }
  | {
      name: 'build_cut_from_shots'
      arguments: {
        assetId: string
        shotIndexes: number[]
        maxShotSeconds?: number
        trackId?: string
      }
    }

function applyBuildCut(
  call: BuildCall,
  label: string,
  shots?: Record<string, DetectedShotDto[]>
): { ok: true } | { ok: false; error: string } {
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document) return { ok: false, error: 'Chưa mở dự án nào' }
  const plan = planChatToolCalls(
    {
      document,
      selectedClipIds: [],
      playheadUs: store.playheadUs,
      makeId: (prefix) => createId(prefix ?? 'clip'),
      shots
    },
    [call]
  )
  if (plan.failures.length > 0) return { ok: false, error: plan.failures[0].reason }
  const commands = plan.steps.flatMap((step) => step.commands)
  return store.run(commands, label)
    ? { ok: true }
    : { ok: false, error: 'Không áp dụng được lên timeline' }
}

export function buildCutFromTranscript(
  transcriptId: string,
  keepSegmentIds: string[],
  trackId: string | undefined,
  label: string
): { ok: true } | { ok: false; error: string } {
  return applyBuildCut(
    { name: 'build_cut_from_transcript', arguments: { transcriptId, keepSegmentIds, trackId } },
    label
  )
}

export function buildCutFromShots(
  assetId: string,
  shots: DetectedShotDto[],
  shotIndexes: number[],
  maxShotSeconds: number | undefined,
  label: string
): { ok: true } | { ok: false; error: string } {
  return applyBuildCut(
    { name: 'build_cut_from_shots', arguments: { assetId, shotIndexes, maxShotSeconds } },
    label,
    { [assetId]: shots }
  )
}
