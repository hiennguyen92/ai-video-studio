import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Vitest không chạy trong runtime Electron. Mã ở tiến trình main import
      // `electron` để hỏi đường dẫn thư mục dữ liệu và để mã hoá bí mật; bản thay
      // thế này cung cấp đúng những thứ đó và vẫn ghi file thật ra thư mục tạm.
      electron: resolve(__dirname, 'src/test-support/electron-stub.ts')
    }
  },
  test: {
    // Chỉ chạy test của ứng dụng. `.claude/` là công cụ trợ lý, không phải mã sản phẩm.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**', '.claude/**', 'external/**'],
    environment: 'node'
  }
})
