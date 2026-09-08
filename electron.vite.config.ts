import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: {
          /**
           * Preload PHẢI là CommonJS.
           *
           * Cửa sổ chạy với `sandbox: true`, và preload trong sandbox của Electron
           * không nạp được module ESM. Vì package.json khai báo `type: module`,
           * file phải mang đuôi `.cjs` thì Node mới coi nó là CommonJS.
           *
           * Nếu để mặc định (`.mjs`), preload im lặng không nạp: `window.api`
           * không tồn tại và mọi lời gọi IPC ném lỗi ngay trong renderer.
           */
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
