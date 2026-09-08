import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Chỉ chạy test của ứng dụng. `.claude/` là công cụ trợ lý, không phải mã sản phẩm.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**', '.claude/**', 'external/**'],
    environment: 'node'
  }
})
