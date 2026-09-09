import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      // Bản sao OpenChatCut chỉ để tham khảo, không phải mã của dự án này.
      'external/**',
      // Công cụ trợ lý và kết quả kiểm thử, không phải mã sản phẩm.
      '.claude/**',
      'test-results/**',
      // Spike đo đạc, không phải mã sản phẩm.
      'spikes/**',
      'playwright-report/**'
    ]
  },
  tseslint.configs.recommended,
  {
    // Script build là JavaScript thuần: không viết được kiểu trả về, mà quy tắc
    // này lại là quy tắc của TypeScript. Áp nó cho `.mjs` chỉ ép người viết bỏ
    // hàm đi và viết một khối mã dài dằng dặc ở cấp cao nhất.
    files: ['**/*.mjs', '**/*.cjs'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  },
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  eslintConfigPrettier
)
