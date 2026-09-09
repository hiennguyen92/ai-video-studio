import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import {
  SOUND_EFFECTS,
  findSoundEffect,
  soundEffectFileName,
  type SoundEffectLibraryStatus
} from '../../shared/domain/sound-effect-catalog'
import { createId } from '../../shared/domain/project-document-factory'
import { computeMediaContentHash } from './media-content-hash'
import { probeMediaFile } from './media-probe'

/**
 * Thư viện hiệu ứng âm thanh dựng sẵn, giải theo ID.
 *
 * Dự án lưu `builtinId`, KHÔNG lưu đường dẫn. Lý do: import media thường trỏ
 * thẳng vào chỗ file nằm và không chép gì cả — hợp lý với file của người dùng,
 * nhưng với file nằm trong gói cài thì đường dẫn đó chết ngay khi gỡ app, khi mở
 * dự án trên máy khác, hoặc khi bản cài đổi chỗ. Giải theo id thì mở ở đâu cũng
 * trỏ đúng bản cài đang chạy.
 *
 * Đường dẫn phân giải theo đúng lối đã chạy được của bundle Remotion: bản đóng
 * gói lấy từ `process.resourcesPath`, bản dev lấy từ `out/`.
 */

/** Thư mục chứa file hiệu ứng của bản cài đang chạy. */
export function soundEffectsDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'sound-effects')
  // Bản chưa đóng gói: hỏi Electron gốc ứng dụng ở đâu, không suy từ vị trí của
  // file mã nguồn. Mã main đã qua bundle nên `import.meta.url` trỏ vào
  // `out/main/index.js` — và tuỳ định dạng bundle, nó có thể không tồn tại.
  return join(app.getAppPath(), 'out', 'sound-effects')
}

export function soundEffectPath(id: string): string | null {
  if (!findSoundEffect(id)) return null
  const path = join(soundEffectsDir(), soundEffectFileName(id))
  return existsSync(path) ? path : null
}

export function soundEffectLibraryStatus(): SoundEffectLibraryStatus {
  const effects: Array<{ id: string; path: string }> = []
  for (const effect of SOUND_EFFECTS) {
    const path = soundEffectPath(effect.id)
    if (path) effects.push({ id: effect.id, path })
  }
  return { effects, packaged: app.isPackaged }
}

/**
 * Dựng `MediaAsset` cho một hiệu ứng.
 *
 * Thời lượng lấy từ PROBE file thật, không lấy con số khai trong danh mục: bộ mã
 * hoá MP3 chèn thêm vài chục mili giây đệm, và clip ngắn hơn tiếng thì đuôi âm
 * thanh bị cắt. Con số trong danh mục chỉ để hiển thị và để agent ước lượng.
 */
export async function buildSoundEffectAsset(id: string): Promise<MediaAsset> {
  const definition = findSoundEffect(id)
  if (!definition) throw new Error(`Không có hiệu ứng âm thanh "${id}"`)

  const path = soundEffectPath(id)
  if (!path) {
    throw new Error(
      `Bản cài thiếu file hiệu ứng "${id}" tại "${soundEffectsDir()}". Bản build này đóng gói sai.`
    )
  }

  const [stats, hash, { probe }] = await Promise.all([
    stat(path),
    computeMediaContentHash(path),
    probeMediaFile(path)
  ])

  return {
    id: createId('asset'),
    kind: 'audio',
    name: definition.nameVi,
    source: {
      path,
      contentHash: hash,
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
      builtinId: id
    },
    probe,
    derived: {},
    origin: 'builtin',
    // Không có `generated`: hiệu ứng dựng sẵn không do job nào sinh ra, nên
    // không có jobId lẫn vân tay yêu cầu để mà điền. Bịa hai trường đó ra là nói
    // dối về xuất xứ của asset.
    tags: definition.tags,
    createdAt: new Date().toISOString(),
    missing: false
  }
}

/**
 * Trỏ lại đường dẫn cho mọi hiệu ứng dựng sẵn trong một dự án.
 *
 * Chạy TRƯỚC bước dò media thiếu lúc mở dự án. Không có bước này thì mở dự án cũ
 * trên bản cài mới sẽ báo "thiếu media" cho những thứ đang nằm ngay trong app.
 *
 * Trả về số asset đã sửa, để nơi gọi biết có phải ghi lại dự án hay không.
 */
export function repairBuiltinAssetPaths(
  assets: MediaAsset[],
  /** Bộ phân giải. Nhận vào để kiểm được mà không cần dựng cả Electron. */
  resolve: (id: string) => string | null = soundEffectPath
): number {
  let repaired = 0
  for (const asset of assets) {
    const id = asset.source.builtinId
    if (!id) continue
    const path = resolve(id)
    // Không phân giải được thì ĐỂ NGUYÊN đường dẫn cũ. Xoá đi hay ghi rỗng vào
    // chỉ làm mất luôn manh mối cuối cùng, và lớp dò media thiếu sẽ báo bằng một
    // đường dẫn trống rỗng chẳng nói lên điều gì.
    if (!path || path === asset.source.path) continue
    asset.source.path = path
    repaired += 1
  }
  return repaired
}
