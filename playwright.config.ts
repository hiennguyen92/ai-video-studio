import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Kiểm thử đầu-cuối khởi chạy Electron thật nên chậm hơn hẳn unit test.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Chạy tuần tự: mỗi bản Electron chiếm một hồ sơ dữ liệu và cửa sổ riêng.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})
