import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Dựng thư viện hiệu ứng âm thanh từ file thu sẵn, lúc build.
 *
 * Nguồn: `resources/sound-effects/<id>.mp3`. Đích: `out/sound-effects/<id>.mp3`,
 * thứ được đóng gói vào bản cài.
 *
 * Mọi hiệu ứng đều được chuẩn hoá độ to MỘT LẦN ở đây. File tải về mỗi cái một
 * mức (đo được từ −5 tới −45 LUFS), không chuẩn hoá thì người dùng phải chỉnh
 * âm lượng từng cái.
 *
 * Chỉ tăng/giảm tuyến tính (`volume`), KHÔNG dùng `loudnorm` để xử lý: bộ nén
 * động của nó làm bẹt đầu tiếng đập, tiếng bốp — đúng phần làm nên hiệu ứng.
 */

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const sourceDir = join(here, '..', 'resources', 'sound-effects')
const outputDir = join(here, '..', 'out', 'sound-effects')
const catalogPath = join(here, '..', 'src', 'shared', 'domain', 'sound-effect-catalog.ts')
const ffmpeg = String(ffmpegStatic)

/** Độ to đích, theo thang EBU R128. −18 LUFS đủ nổi mà không lấn lời thoại. */
const TARGET_LUFS = -18
/** Tiếng quá ngắn (dưới ~400ms) không đo được LUFS, thì canh theo đỉnh. */
const TARGET_PEAK_DB = -3
/** Trần đỉnh thật sau khi tăng, để không vỡ tiếng. */
const MAX_TRUE_PEAK_DB = -1.5

/**
 * Đọc danh mục từ chính file TypeScript.
 *
 * Node không nạp thẳng `.ts` được và dự án không có bộ chạy TS nào, nên script
 * này bóc `id` và `durationUs` bằng biểu thức chính quy. Bóc hụt thì ném lỗi
 * ngay, không âm thầm kiểm số rỗng.
 */
/** @returns {Promise<Array<{id: string, durationMs: number}>>} */
async function readCatalog() {
  const source = await readFile(catalogPath, 'utf8')
  const entries = [...source.matchAll(/id:\s*'([^']+)'[\s\S]*?durationUs:\s*ms\((\d+)\)/g)].map(
    (match) => ({ id: match[1], durationMs: Number(match[2]) })
  )
  if (entries.length === 0) {
    throw new Error(`Không bóc được mục nào từ ${catalogPath} — định dạng danh mục đã đổi?`)
  }
  return entries
}

/** Đo độ to tích hợp và đỉnh thật. LUFS là `null` khi tiếng quá ngắn để đo. */
/** @returns {Promise<{lufs: number | null, truePeakDb: number}>} */
async function measureLoudness(path) {
  const { stderr } = await execFileAsync(ffmpeg, [
    '-hide_banner',
    '-i',
    path,
    '-filter:a',
    'loudnorm=print_format=json',
    '-f',
    'null',
    '-'
  ])
  const json = JSON.parse(stderr.slice(stderr.lastIndexOf('{')))
  const lufs = Number(json.input_i)
  return {
    lufs: Number.isFinite(lufs) && lufs > -70 ? lufs : null,
    truePeakDb: Number(json.input_tp)
  }
}

/** Mức tăng (dB) đưa file về độ to đích mà không vượt trần đỉnh. */
function gainFor({ lufs, truePeakDb }) {
  const wanted = lufs === null ? TARGET_PEAK_DB - truePeakDb : TARGET_LUFS - lufs
  return Math.min(wanted, MAX_TRUE_PEAK_DB - truePeakDb)
}

/** @returns {Promise<void>} */
async function buildOne(source, target, gainDb) {
  await execFileAsync(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    source,
    '-map_metadata',
    '-1',
    '-filter:a',
    `volume=${gainDb.toFixed(2)}dB`,
    '-ar',
    '48000',
    '-b:a',
    '192k',
    target
  ])
}

/**
 * Đo mức đỉnh file vừa dựng.
 *
 * Một lỗi xử lý cho ra file IM LẶNG mà ffmpeg vẫn báo thành công — đúng kiểu
 * hỏng không có gì kêu. Bắt ngay tại đây, chứ không để người dùng phát hiện bằng
 * cách kéo lên timeline rồi không nghe thấy gì.
 */
/** @returns {Promise<number>} */
async function measurePeakDb(path) {
  const { stderr } = await execFileAsync(ffmpeg, [
    '-hide_banner',
    '-i',
    path,
    '-filter:a',
    'volumedetect',
    '-f',
    'null',
    '-'
  ])
  const match = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr)
  return match ? Number(match[1]) : Number.NEGATIVE_INFINITY
}

/** Thời lượng thật của file (giây), đọc từ dòng `Duration: HH:MM:SS.xx` của ffmpeg. */
/** @returns {Promise<number>} */
async function measureSeconds(path) {
  const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-i', path]).catch((error) => ({
    stderr: String(error.stderr ?? '')
  }))
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0
}

/** @returns {Promise<void>} */
async function main() {
  const catalog = await readCatalog()
  const sourceIds = (await readdir(sourceDir))
    .filter((name) => name.endsWith('.mp3'))
    .map((name) => name.slice(0, -'.mp3'.length))

  const catalogIds = new Set(catalog.map((effect) => effect.id))
  const fileOnly = sourceIds.filter((id) => !catalogIds.has(id))
  const catalogOnly = catalog.filter((effect) => !sourceIds.includes(effect.id)).map((e) => e.id)
  if (fileOnly.length > 0) {
    throw new Error(`Có file nhưng thiếu trong danh mục: ${fileOnly.join(', ')}`)
  }
  if (catalogOnly.length > 0) {
    throw new Error(`Có trong danh mục nhưng thiếu file nguồn: ${catalogOnly.join(', ')}`)
  }

  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })

  const silent = []
  const drifted = []
  let totalBytes = 0

  // Song song: bốn chục file nối tiếp nhau làm `npm run dev` chờ lâu vô ích.
  await Promise.all(
    catalog.map(async ({ id, durationMs }) => {
      const source = join(sourceDir, `${id}.mp3`)
      const target = join(outputDir, `${id}.mp3`)
      await buildOne(source, target, gainFor(await measureLoudness(source)))

      const [peak, seconds, { size }] = await Promise.all([
        measurePeakDb(target),
        measureSeconds(target),
        stat(target)
      ])
      totalBytes += size
      if (peak < -40) silent.push(`${id} (đỉnh ${peak} dB)`)

      // Danh mục nói thời lượng bao nhiêu thì file phải đúng bấy nhiêu. Giao diện
      // và agent đọc con số trong danh mục, không probe file.
      if (Math.abs(durationMs / 1000 - seconds) > 0.05) {
        drifted.push(`${id}: danh mục ${durationMs}ms, file ${Math.round(seconds * 1000)}ms`)
      }
    })
  )

  if (silent.length > 0) throw new Error(`Hiệu ứng gần như im lặng: ${silent.join(', ')}`)
  if (drifted.length > 0) throw new Error(`Thời lượng lệch danh mục:\n  ${drifted.join('\n  ')}`)

  console.log(
    `sound effects: ${catalog.length} file, ${Math.round(totalBytes / 1024)} KB → ${outputDir}`
  )
}

await main()
