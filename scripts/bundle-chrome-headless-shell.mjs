// Đóng gói sẵn Chrome Headless Shell lúc BUILD, không tải lúc chạy.
//
// Remotion cần Chrome Headless Shell để dựng khung hình. Nếu thiếu, nó tự tải về
// một thư mục cache mà nó suy ra bằng cách TRÈO NGƯỢC từ thư mục làm việc để tìm
// `package.json`. Mở app từ Finder thì thư mục làm việc là `/`, không có
// `package.json` nào ở trên, nên nó rơi về `/.remotion` — thư mục gốc chỉ đọc,
// và lần xuất đầu tiên chết với "mkdir '/.remotion'".
//
// Chép sẵn vào gói cài thì xuất video chạy được ngay, không cần mạng, và luôn
// đúng bản Chrome mà Remotion ghim — bản khác cho kết quả dựng khác.
import { ensureBrowser } from '@remotion/renderer'
import { cp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const execFileAsync = promisify(execFile)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(projectRoot, 'node_modules', '.remotion', 'chrome-headless-shell')
const outDir = join(projectRoot, 'out', 'chrome-headless-shell')

// Để chính Remotion tải: bản ghim nằm trong mã của nó, tự dựng URL tải là mời
// lệch bản ở lần nâng cấp tiếp theo.
await ensureBrowser({ logLevel: 'info' })

await rm(outDir, { recursive: true, force: true })
await cp(cacheDir, outDir, { recursive: true })

/** Dò file nhị phân thay vì suy ra tên thư mục theo nền tảng. */
async function findBinary(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findBinary(path)
      if (found) return found
      continue
    }
    if (entry.name === 'chrome-headless-shell' || entry.name === 'chrome-headless-shell.exe') {
      return path
    }
  }
  return null
}

const binary = await findBinary(outDir)
if (!binary) {
  throw new Error(`Không tìm thấy file nhị phân Chrome trong "${outDir}". Bản Remotion đổi bố cục?`)
}

// Ghi lại đường dẫn tương đối để lúc chạy khỏi phải đoán tên thư mục theo nền
// tảng — đoán sai thì lỗi chỉ lộ ra ở lần xuất đầu tiên trên máy người dùng.
await writeFile(
  join(outDir, 'binary-path.json'),
  JSON.stringify({ binary: relative(outDir, binary) })
)

// Chạy thử: chép thiếu quyền thực thi hay thiếu thư viện đi kèm thì hỏng ngay ở
// đây, chứ không phải ở máy người dùng.
const { stdout } = await execFileAsync(binary, ['--version'])
const { size } = await stat(binary)
console.log(
  `chrome headless shell: ${stdout.trim()} (${(size / 1024 / 1024).toFixed(0)} MB) → ${outDir}`
)
