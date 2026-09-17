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
  const isPlaying = useEditorStore((state) => state.isPlaying)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  const mediaUrls = useLocalMediaUrls()
  const plan = useMemo(() => buildRenderPlan(document), [document])
  // Giữ nguyên tham chiếu giữa các lần vẽ: object mới mỗi lần là Player dựng lại
  // cả composition dù không có gì đổi.
  const inputProps = useMemo(() => ({ plan, mediaUrls }), [plan, mediaUrls])
  const fps = document.settings.frameRate

  /**
   * Khung hình mà chính Player vừa báo lên store.
   *
   * Đây là chốt chặn vòng lặp: Player báo khung → store đổi → hiệu ứng bên dưới
   * chạy → nếu nó lại gọi `seekTo` thì Player báo tiếp, và cứ thế.
   *
   * Chốt cũ là một cờ bật/tắt quanh `setPlayhead`. Nó KHÔNG bao giờ có tác dụng:
   * cờ được tắt ngay trong cùng một lượt đồng bộ, còn hiệu ứng thì chạy sau khi
   * React vẽ xong — lúc đó cờ đã tắt từ lâu. So SỐ KHUNG thì không phụ thuộc thứ
   * tự thời gian nữa.
   *
   * Hậu quả của chốt hỏng, đo được: kéo chuột trên thước vài lượt là React ngã
   * với lỗi #185 (vượt số lần cập nhật tối đa) và tự gỡ toàn bộ cây — cả cửa sổ
   * trắng trơn.
   */
  const framePushedByPlayer = useRef<number | null>(null)

  // Player chạy → store đi theo.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const onFrame: CallbackListener<'frameupdate'> = (event) => {
      framePushedByPlayer.current = event.detail.frame

      // CHỈ nghe khi đang phát.
      //
      // Lúc dừng, store là nguồn sự thật duy nhất và Player chỉ việc đi theo. Mọi
      // `frameupdate` lúc đó là tiếng vọng của chính lệnh tua ta vừa gửi — đẩy nó
      // ngược vào store là tự tạo một vòng cập nhật.
      //
      // Đo thật: kéo thước trên dự án chín cảnh, đường vọng này làm React ngã với
      // lỗi #185 rồi gỡ sạch cây giao diện. Chốt bằng cách so số khung không đủ,
      // vì đây không phải vòng lặp vô tận mà là một trận dồn cập nhật.
      if (!useEditorStore.getState().isPlaying) return

      setPlayhead(microsOfFrame(event.detail.frame, fps))
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
  //
  // ĐĂNG KÝ thẳng với store chứ không theo dõi bằng hook: theo dõi thì component
  // này — và cả Player bên trong — vẽ lại mỗi khung khi đang phát. Đo được: luồng
  // chính bận tới mức Player tụt khung (≈24 thay vì 30 khung/giây), hình chạy
  // chậm hơn tiếng, và Remotion kéo tiếng lùi ~0,7 giây cho khớp — nghe như lặp.
  //
  // Hàm đăng ký chạy ĐỒNG BỘ ngay trong `setPlayhead`, nên lúc so với khung Player
  // vừa báo thì chưa có khung nào chen vào giữa.
  useEffect(() => {
    const seekToPlayhead = (playheadUs: number): void => {
      const player = playerRef.current
      if (!player) return

      const target = frameOfMicros(playheadUs, fps)

      // Chính Player vừa báo khung này lên store — tua lại là tự nói với chính mình.
      if (framePushedByPlayer.current === target) return

      // Chỉ tua khi lệch thật: gọi seekTo mỗi khung sẽ làm giật hình lúc phát.
      if (Math.abs(player.getCurrentFrame() - target) > 1) player.seekTo(target)
    }

    // Đồng bộ một lần lúc gắn (mở dự án, đổi fps), rồi theo mỗi lần đầu phát đổi.
    seekToPlayhead(useEditorStore.getState().playheadUs)
    return useEditorStore.subscribe((state, previous) => {
      if (state.playheadUs !== previous.playheadUs) seekToPlayhead(state.playheadUs)
    })
  }, [fps])

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
      inputProps={inputProps}
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
