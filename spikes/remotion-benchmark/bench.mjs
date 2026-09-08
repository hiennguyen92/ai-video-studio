import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { availableParallelism, totalmem } from 'node:os'
import { join } from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Đo tốc độ render Remotion cho đúng loại video định làm, và so với đường xuất
 * ffmpeg hiện có.
 *
 * Con số tuyệt đối gần như vô nghĩa nếu không có mốc so sánh: điều cần biết là
 * "chậm hơn thứ đang có bao nhiêu lần", vì đó mới là cái người dùng cảm nhận khi
 * sửa tới lui một video.
 *
 * Cấu hình render lấy theo đúng cách OpenChatCut tinh chỉnh (đọc từ
 * `external/OpenChatCut/remotion/performance.mjs`) để không đo một Remotion chưa
 * chỉnh — đo vậy sẽ ra con số bi quan và không công bằng.
 */

const execFileAsync = promisify(execFile)
const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920
const DURATION_SECONDS = 25
const SHOT_COUNT = 8
const TRANSITION_FRAMES = 15

const GIB = 1024 ** 3
const MAX_RENDER_CONCURRENCY = 24

/** Copy nguyên quy tắc của OpenChatCut để so cùng điều kiện. */
function resolveRenderConcurrency(cores = availableParallelism(), memoryBytes = totalmem()) {
  if (cores <= 2) return 1
  const cpuTarget = Math.round(cores * 0.8)
  const memoryTarget = Math.max(1, Math.floor((memoryBytes / GIB) * 0.5 / 1.25))
  return Math.max(1, Math.min(MAX_RENDER_CONCURRENCY, cpuTarget, memoryTarget))
}

function resolveOffthreadVideoThreads(cores = availableParallelism()) {
  if (cores <= 2) return 1
  return Math.max(2, Math.min(4, Math.ceil(cores / 4)))
}

const seconds = (ms) => (ms / 1000).toFixed(1)

async function makeSourceFootage(dir) {
  // Footage dọc, bitrate cao, nhiễu nhẹ để không nén quá dễ — footage điện thoại
  // thật nặng hơn testsrc trơn khá nhiều, và giải mã là phần tốn nhất ở đây.
  // Phải nằm trong publicDir: Remotion chỉ nạp asset từ đó hoặc qua http.
  const path = join(dir, 'public', 'nguon.mp4')
  await mkdir(join(dir, 'public'), { recursive: true })
  await execFileAsync(String(ffmpegStatic), [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=40`,
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=40:sample_rate=48000',
    '-vf', 'noise=alls=12:allf=t+u',
    '-c:v', 'libx264', '-preset', 'medium', '-b:v', '12M', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    path
  ])
  return path
}

function buildShots() {
  const framesPerShot = Math.round((DURATION_SECONDS * FPS) / SHOT_COUNT) + TRANSITION_FRAMES
  return Array.from({ length: SHOT_COUNT }, (_, index) => ({
    src: 'nguon.mp4',
    fromSeconds: index * 3,
    durationInFrames: framesPerShot,
    caption: [
      'Cái này mình dùng mỗi ngày',
      'Giá rẻ hơn bạn nghĩ nhiều',
      'Chốt đơn ngay hôm nay'
    ][index % 3]
  }))
}

async function benchRemotion(dir) {
  const concurrency = resolveRenderConcurrency()
  const offthreadVideoThreads = resolveOffthreadVideoThreads()
  console.log(`\n[remotion] concurrency=${concurrency} offthreadVideoThreads=${offthreadVideoThreads}`)

  const bundleStart = Date.now()
  const serveUrl = await bundle({
    entryPoint: join(import.meta.dirname, 'root.tsx'),
    publicDir: join(dir, 'public'),
    onProgress: () => undefined
  })
  const bundleMs = Date.now() - bundleStart
  console.log(`[remotion] bundle: ${seconds(bundleMs)}s (chỉ tốn một lần, không tính vào render)`)

  const inputProps = { shots: buildShots(), transitionFrames: TRANSITION_FRAMES }
  const composition = await selectComposition({
    serveUrl,
    id: 'affiliate-short',
    inputProps
  })

  // Bốn kịch bản, mỗi cái trả lời một câu hỏi khác nhau:
  //  - hardware/software : tăng tốc phần cứng có đáng không
  //  - no-transition     : crossfade (giải mã hai video cùng lúc) tốn bao nhiêu
  //  - overlay-only      : lớp đồ hoạ riêng, không video — phương án lai
  const scenarios = [
    { key: 'hardware', showVideo: true, transitionFrames: TRANSITION_FRAMES, hw: true },
    { key: 'software', showVideo: true, transitionFrames: TRANSITION_FRAMES, hw: false },
    { key: 'no-transition', showVideo: true, transitionFrames: 0, hw: true },
    { key: 'overlay-only', showVideo: false, transitionFrames: TRANSITION_FRAMES, hw: false }
  ]

  const results = {}
  for (const scenario of scenarios) {
    const alpha = scenario.key === 'overlay-only'
    const outputLocation = join(dir, `remotion-${scenario.key}.${alpha ? 'mov' : 'mp4'}`)
    const props = {
      shots: buildShots(),
      transitionFrames: scenario.transitionFrames,
      showVideo: scenario.showVideo
    }
    const start = Date.now()

    await renderMedia({
      composition,
      serveUrl,
      // Nền trong suốt cần codec giữ được kênh alpha.
      codec: alpha ? 'prores' : 'h264',
      ...(alpha ? { proResProfile: '4444' } : {}),
      outputLocation,
      inputProps: props,
      concurrency,
      offthreadVideoThreads,
      chromiumOptions: { gl: 'angle' },
      hardwareAcceleration: scenario.hw ? 'required' : 'disable',
      ...(scenario.hw ? { videoBitrate: '10000k' } : {}),
      onProgress: () => undefined
    })

    const ms = Date.now() - start
    const { size } = await stat(outputLocation)
    results[scenario.key] = { ms, sizeMb: size / 1e6 }
    console.log(`[remotion:${scenario.key}] ${seconds(ms)}s, ${(size / 1e6).toFixed(1)} MB`)
  }

  return { bundleMs, ...results }
}

/**
 * Mốc so sánh: đường xuất hiện tại của app — cắt, ghép, nung phụ đề ASS, mã hoá
 * phần cứng. Không có chuyển cảnh và chữ động, vì ffmpeg filter graph hiện chưa
 * làm được — đó chính là lý do cân nhắc Remotion.
 */
async function benchFfmpeg(dir, src) {
  const assPath = join(dir, 'phu-de.ass')
  const dialogues = Array.from({ length: SHOT_COUNT }, (_, index) => {
    const from = new Date(index * 3 * 1000).toISOString().substr(11, 11)
    const to = new Date((index * 3 + 3) * 1000).toISOString().substr(11, 11)
    return `Dialogue: 0,${from},${to},Default,,0,0,0,,Câu phụ đề số ${index + 1}`
  }).join('\n')

  await writeFile(
    assPath,
    `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Outline, Alignment, MarginV
Style: Default,Helvetica,68,&H00FFFFFF,&H00000000,1,3,2,320

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogues}
`,
    'utf8'
  )

  const outputLocation = join(dir, 'ffmpeg.mp4')
  const start = Date.now()
  await execFileAsync(String(ffmpegStatic), [
    '-v', 'error', '-y',
    '-ss', '0', '-t', String(DURATION_SECONDS), '-i', src,
    '-vf', `subtitles=${assPath}`,
    '-c:v', 'h264_videotoolbox', '-b:v', '10M',
    '-fps_mode', 'cfr', '-r', String(FPS),
    '-c:a', 'aac',
    outputLocation
  ])
  const ms = Date.now() - start
  const { size } = await stat(outputLocation)
  console.log(`[ffmpeg] ${seconds(ms)}s, ${(size / 1e6).toFixed(1)} MB`)
  return { ms, sizeMb: size / 1e6 }
}

const dir = await mkdtemp(join(tmpdir(), 'remotion-bench-'))
try {
  console.log(`Máy: ${availableParallelism()} lõi, ${(totalmem() / GIB).toFixed(0)} GiB RAM`)
  console.log(`Bản dựng: ${WIDTH}×${HEIGHT} @ ${FPS}fps, ${DURATION_SECONDS}s, ${SHOT_COUNT} cảnh, crossfade + phụ đề nảy chữ`)

  console.log('\nĐang tạo footage nguồn…')
  const src = await makeSourceFootage(dir)

  const ffmpeg = await benchFfmpeg(dir, src)
  const remotion = await benchRemotion(dir)

  const realtime = (ms) => (ms / 1000 / DURATION_SECONDS).toFixed(2)
  const row = (label, ms) =>
    `${label.padEnd(28)}: ${seconds(ms).padStart(6)}s  = ${realtime(ms)}× thời lượng video`

  console.log('\n════════ KẾT QUẢ ════════')
  console.log(row('ffmpeg (đường hiện tại)', ffmpeg.ms))
  console.log(row('remotion phần cứng', remotion.hardware.ms))
  console.log(row('remotion phần mềm', remotion.software.ms))
  console.log(row('remotion không chuyển cảnh', remotion['no-transition'].ms))
  console.log(row('remotion chỉ lớp đồ hoạ', remotion['overlay-only'].ms))
  console.log('')
  console.log(`Remotion chậm hơn ffmpeg     : ${(remotion.hardware.ms / ffmpeg.ms).toFixed(1)}× lần`)
  console.log(`Giá của crossfade            : ${(remotion.hardware.ms / remotion['no-transition'].ms).toFixed(2)}× lần`)
  console.log(`Tăng tốc phần cứng giúp      : ${(((remotion.software.ms - remotion.hardware.ms) / remotion.software.ms) * 100).toFixed(0)}%`)
  console.log(`Bundle (một lần)             : ${seconds(remotion.bundleMs)}s`)
} finally {
  await rm(dir, { recursive: true, force: true })
}
