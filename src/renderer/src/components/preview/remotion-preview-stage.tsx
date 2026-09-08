import { useEffect, useMemo, useRef, type JSX } from 'react'
import { Player, type CallbackListener, type PlayerRef } from '@remotion/player'
import { ProjectComposition } from '../../../../remotion/project-composition'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { buildRenderPlan } from '../../../../shared/domain/remotion-render-plan'
import {
  frameOfMicros,
  frameRateToNumber,
  microsOfFrame
} from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { useLocalMediaUrls } from '../../hooks/use-local-media-urls'

/**
 * Khung xem trước, vẽ bằng đúng composition mà lúc xuất file dùng.
 *
 * Trước đây preview tự xếp lớp các thẻ `<video>`, còn export tự dựng filter graph
 * ffmpeg — hai hiện thực phải giữ khớp nhau bằng tay. Giờ cả hai chạy chung
 * `ProjectComposition`, nên thứ nhìn thấy đúng là thứ sẽ xuất ra.
 *
 * Phần tinh tế nhất ở đây là ĐỒNG BỘ HAI CHIỀU đầu phát:
 *
 *   - người dùng bấm trên timeline → store đổi → phải tua Player
 *   - Player chạy khi phát → phải cập nhật store để timeline và timecode đi theo
 *
 * Nối thẳng hai chiều sẽ thành vòng lặp vô tận. `syncingFromPlayer` đánh dấu
 * chiều đang chạy để chiều kia đứng yên.
 */

export function RemotionPreviewStage({ document }: { document: ProjectDocument }): JSX.Element {
  const playerRef = useRef<PlayerRef>(null)
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const isPlaying = useEditorStore((state) => state.isPlaying)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  const mediaUrls = useLocalMediaUrls()
  const plan = useMemo(() => buildRenderPlan(document), [document])
  const fps = document.settings.frameRate

  /** Bật trong lúc đẩy trạng thái từ Player về store, để hiệu ứng tua không chạy ngược lại. */
  const syncingFromPlayer = useRef(false)

  // Player chạy → store đi theo.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const onFrame: CallbackListener<'frameupdate'> = (event) => {
      syncingFromPlayer.current = true
      setPlayhead(microsOfFrame(event.detail.frame, fps))
      syncingFromPlayer.current = false
    }
    const onPlay: CallbackListener<'play'> = () => setPlaying(true)
    const onPause: CallbackListener<'pause'> = () => setPlaying(false)
    // Hết bài thì trả nút về trạng thái dừng, nếu không giao diện kẹt ở "đang phát".
    const onEnded: CallbackListener<'ended'> = () => setPlaying(false)

    player.addEventListener('frameupdate', onFrame)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)
    player.addEventListener('ended', onEnded)

    return () => {
      player.removeEventListener('frameupdate', onFrame)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onPause)
      player.removeEventListener('ended', onEnded)
    }
  }, [fps, setPlayhead, setPlaying])

  // Store đổi từ chỗ khác (bấm timeline, nhấn đoạn transcript) → tua Player.
  useEffect(() => {
    if (syncingFromPlayer.current) return
    const player = playerRef.current
    if (!player) return

    const target = frameOfMicros(playheadUs, fps)
    // Chỉ tua khi lệch thật: gọi seekTo mỗi khung sẽ làm giật hình lúc phát.
    if (Math.abs(player.getCurrentFrame() - target) > 1) player.seekTo(target)
  }, [playheadUs, fps])

  // Nút phát/dừng trên thanh công cụ điều khiển Player.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    if (isPlaying && !player.isPlaying()) player.play()
    if (!isPlaying && player.isPlaying()) player.pause()
  }, [isPlaying])

  return (
    <Player
      ref={playerRef}
      component={ProjectComposition}
      inputProps={{ plan, mediaUrls }}
      durationInFrames={plan.durationInFrames}
      fps={frameRateToNumber(fps)}
      compositionWidth={plan.width}
      compositionHeight={plan.height}
      style={{ width: '100%', height: '100%' }}
      // Thanh điều khiển riêng của app đã có sẵn; hai bộ nút sẽ đá nhau.
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen
      acknowledgeRemotionLicense
    />
  )
}
