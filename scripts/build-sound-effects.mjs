import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Dựng thư viện hiệu ứng âm thanh bằng ffmpeg, lúc build.
 *
 * Không có file âm thanh nào trong git: mỗi hiệu ứng là một filter graph ở dưới,
 * và `npm run build` sinh lại chúng. Nhờ vậy không có blob nhị phân nào để xét
 * giấy phép, và sửa một hiệu ứng là sửa một dòng chứ không phải đi tìm file mới.
 *
 * Mọi hiệu ứng đều được chuẩn hoá độ to MỘT LẦN ở đây. Chuẩn hoá lúc chạy thì
 * mỗi lần phát lại tính lại, còn không chuẩn hoá thì mỗi hiệu ứng một mức to nhỏ
 * và người dùng phải chỉnh âm lượng từng cái.
 */

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const outputDir = join(here, '..', 'out', 'sound-effects')
const catalogPath = join(here, '..', 'src', 'shared', 'domain', 'sound-effect-catalog.ts')

/**
 * Đọc danh mục từ chính file TypeScript.
 *
 * Node không nạp thẳng `.ts` được và dự án không có bộ chạy TS nào, nên script
 * này bóc `id` và `durationUs` bằng biểu thức chính quy. Chép danh mục ra thành
 * bản thứ hai thì đúng thứ mà phép kiểm dưới đây sinh ra để chống: hai bản lệch
 * nhau. Bóc hụt thì ném lỗi ngay, không âm thầm kiểm số rỗng.
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

/** Độ to đích, theo thang EBU R128. −18 LUFS đủ nổi mà không lấn lời thoại. */
const TARGET_LUFS = -18

/**
 * Công thức từng hiệu ứng.
 *
 * `source` là đầu vào lavfi, `chain` là chuỗi lọc. Mỗi công thức phải tự tắt dần
 * ở cuối (`afade=out`) — không tắt thì file kết thúc bằng một cú cắt nghe rõ mồn
 * một.
 */
const RECIPES = {
  'whoosh-fast': {
    seconds: 0.4,
    source: 'anoisesrc=color=brown:amplitude=0.8:duration=0.4',
    chain:
      'highpass=f=300,lowpass=f=6000,volume=0.9,afade=t=in:st=0:d=0.05,afade=t=out:st=0.2:d=0.2'
  },
  'whoosh-soft': {
    seconds: 0.7,
    source: 'anoisesrc=color=pink:amplitude=0.6:duration=0.7',
    chain: 'lowpass=f=2500,afade=t=in:st=0:d=0.25,afade=t=out:st=0.3:d=0.4'
  },
  'swipe-up': {
    seconds: 0.3,
    // Nhiễu lọc cao, ngắn và sáng. Bản trước dùng mẹo `asetrate` trên sine 220Hz
    // và ĐO RA trầm (-9,7 dB dải thấp so với -40,7 dải cao) — nghe không ra
    // "lướt lên", mà tên gọi thì hứa như vậy.
    source: 'anoisesrc=color=white:amplitude=0.7:duration=0.3',
    chain: 'highpass=f=1500,volume=1.2,afade=t=in:st=0:d=0.03,afade=t=out:st=0.12:d=0.18'
  },
  riser: {
    seconds: 1.5,
    source: 'anoisesrc=color=white:amplitude=0.5:duration=1.5',
    chain: 'highpass=f=800,volume=1.4,afade=t=in:st=0:d=1.3,afade=t=out:st=1.35:d=0.15'
  },
  pop: {
    seconds: 0.15,
    source: 'sine=frequency=900:duration=0.15',
    chain: 'afade=t=in:st=0:d=0.005,afade=t=out:st=0.02:d=0.13'
  },
  ding: {
    seconds: 0.8,
    // Hai tần số chồng lên nhau nghe ra chuông; một tần số nghe ra tiếng bíp.
    source: 'sine=frequency=1320:duration=0.8',
    chain: 'aecho=0.8:0.6:40:0.4,highpass=f=400,afade=t=in:st=0:d=0.005,afade=t=out:st=0.15:d=0.65'
  },
  sparkle: {
    seconds: 0.6,
    source: 'anoisesrc=color=white:amplitude=0.4:duration=0.6',
    chain:
      'highpass=f=5000,aecho=0.8:0.5:20|35|55:0.5|0.4|0.3,afade=t=in:st=0:d=0.02,afade=t=out:st=0.2:d=0.4'
  },
  success: {
    seconds: 0.7,
    source: 'sine=frequency=660:duration=0.7',
    chain:
      'asetrate=44100*1.4,aresample=44100,atempo=0.7,aecho=0.8:0.5:60:0.4,afade=t=in:st=0:d=0.01,afade=t=out:st=0.35:d=0.35'
  },
  impact: {
    seconds: 0.8,
    source: 'sine=frequency=55:duration=0.8',
    chain: 'lowpass=f=300,volume=2.0,afade=t=in:st=0:d=0.005,afade=t=out:st=0.1:d=0.7'
  },
  notify: {
    seconds: 0.5,
    source: 'sine=frequency=880:duration=0.5',
    chain:
      'asetrate=44100*1.25,aresample=44100,atempo=0.8,afade=t=in:st=0:d=0.01,afade=t=out:st=0.2:d=0.3'
  },
  tick: {
    seconds: 0.09,
    source: 'anoisesrc=color=white:amplitude=0.9:duration=0.09',
    chain: 'highpass=f=2000,afade=t=in:st=0:d=0.002,afade=t=out:st=0.01:d=0.08'
  },
  error: {
    seconds: 0.4,
    source: 'sine=frequency=300:duration=0.4',
    chain:
      'asetrate=44100*0.7,aresample=44100,atempo=1.4,lowpass=f=1200,afade=t=in:st=0:d=0.01,afade=t=out:st=0.2:d=0.2'
  }
}

/** @returns {Promise<string>} */
async function buildOne(id, recipe) {
  const target = join(outputDir, `${id}.mp3`)
  await execFileAsync(String(ffmpegStatic), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    recipe.source,
    '-filter:a',
    // Chuẩn hoá độ to đứng CUỐI chuỗi, sau khi hiệu ứng đã thành hình.
    `${recipe.chain},loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`,
    '-t',
    String(recipe.seconds),
    '-ac',
    '1',
    '-ar',
    '44100',
    '-b:a',
    '128k',
    target
  ])
  return target
}

/**
 * Đo file vừa dựng.
 *
 * Một công thức sai cho ra file IM LẶNG mà ffmpeg vẫn báo thành công — đúng kiểu
 * hỏng không có gì kêu. Đo mức đỉnh để bắt nó ngay tại đây, chứ không để người
 * dùng phát hiện bằng cách kéo lên timeline rồi không nghe thấy gì.
 */
/** @returns {Promise<number>} */
async function measurePeakDb(path) {
  const { stderr } = await execFileAsync(String(ffmpegStatic), [
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

/** Thời lượng thật của file, đọc bằng ffmpeg. */
/** @returns {Promise<number>} */
async function measureSeconds(path) {
  const { stderr } = await execFileAsync(String(ffmpegStatic), ['-hide_banner', '-i', path]).catch(
    (error) => ({ stderr: String(error.stderr ?? '') })
  )
  const match = /Duration: 00:00:0?([\d.]+)/.exec(stderr)
  return match ? Number(match[1]) : 0
}

/** @returns {Promise<void>} */
async function main() {
  const catalog = await readCatalog()
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })

  const silent = []
  const drifted = []
  const missingFromCatalog = []
  let totalBytes = 0

  for (const [id, recipe] of Object.entries(RECIPES)) {
    const path = await buildOne(id, recipe)
    const peak = await measurePeakDb(path)
    const seconds = await measureSeconds(path)
    const { size } = await stat(path)
    totalBytes += size

    if (peak < -40) silent.push(`${id} (đỉnh ${peak} dB)`)

    // Danh mục nói thời lượng bao nhiêu thì file phải đúng bấy nhiêu. Giao diện
    // và agent đọc con số trong danh mục, không probe file — lệch nhau là clip
    // dài một đằng, tiếng dài một nẻo.
    const declared = catalog.find((effect) => effect.id === id)
    if (!declared) {
      missingFromCatalog.push(id)
    } else if (Math.abs(declared.durationMs / 1000 - seconds) > 0.05) {
      drifted.push(`${id}: danh mục ${declared.durationMs}ms, file ${Math.round(seconds * 1000)}ms`)
    }
  }

  const catalogOnly = catalog.filter((effect) => !(effect.id in RECIPES)).map((e) => e.id)

  if (silent.length > 0) throw new Error(`Hiệu ứng gần như im lặng: ${silent.join(', ')}`)
  if (missingFromCatalog.length > 0) {
    throw new Error(`Có công thức nhưng thiếu trong danh mục: ${missingFromCatalog.join(', ')}`)
  }
  if (catalogOnly.length > 0) {
    throw new Error(`Có trong danh mục nhưng thiếu công thức: ${catalogOnly.join(', ')}`)
  }
  if (drifted.length > 0) throw new Error(`Thời lượng lệch danh mục:\n  ${drifted.join('\n  ')}`)

  console.log(
    `sound effects: ${Object.keys(RECIPES).length} file, ${Math.round(totalBytes / 1024)} KB → ${outputDir}`
  )
}

await main()
