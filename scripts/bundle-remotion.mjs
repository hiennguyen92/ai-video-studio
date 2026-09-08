// Dựng sẵn bundle Remotion lúc BUILD, không dựng lúc chạy.
//
// Bản đóng gói không dựng lúc chạy được: mã nguồn `src/` bị loại khỏi gói, và
// các gói phụ thuộc nằm trong `app.asar` mà bộ đóng gói của Remotion không đọc
// được file bên trong asar. Dựng sẵn còn bỏ luôn quãng chờ đóng gói ở lần xuất
// video đầu tiên.
import { bundle } from '@remotion/bundler'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(projectRoot, 'out', 'remotion-bundle')

await rm(outDir, { recursive: true, force: true })

const result = await bundle({
  entryPoint: join(projectRoot, 'src', 'remotion', 'root.tsx'),
  outDir,
  onProgress: () => undefined
})

console.log(`bundle Remotion: ${result}`)
