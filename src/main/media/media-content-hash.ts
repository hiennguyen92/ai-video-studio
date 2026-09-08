import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

/**
 * Vân tay nội dung file, dùng để chống import trùng và để liên kết lại media bị mất.
 *
 * Cố tình KHÔNG băm toàn bộ file: một video 4K dài 30 phút nặng vài GB, băm hết
 * sẽ treo thao tác import hàng chục giây. Thay vào đó băm kích thước + đoạn đầu +
 * đoạn giữa + đoạn cuối. Với mục đích "đây có phải file tôi từng import không"
 * thì như vậy là đủ, và nó nhanh ở mọi kích thước file.
 */

const SAMPLE_BYTES = 1024 * 1024 // 1 MiB mỗi vị trí

export async function computeMediaContentHash(filePath: string): Promise<string> {
  const stats = await stat(filePath)
  const hash = createHash('sha256')
  hash.update(String(stats.size))

  const handle = await open(filePath, 'r')
  try {
    const sampleSize = Math.min(SAMPLE_BYTES, stats.size)
    const buffer = Buffer.allocUnsafe(sampleSize)

    const offsets =
      stats.size <= SAMPLE_BYTES * 3
        ? [0]
        : [0, Math.floor(stats.size / 2) - sampleSize / 2, stats.size - sampleSize]

    for (const offset of offsets) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        sampleSize,
        Math.max(0, Math.floor(offset))
      )
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }

  return hash.digest('hex')
}
