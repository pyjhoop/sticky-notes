import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Tauri가 띄우는 개발 서버 포트. 고정해야 tauri.conf.json의 devUrl과 맞는다.
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri CLI가 출력하는 rust 에러를 가리지 않도록
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  // 데스크톱 앱이므로 최신 크로미움만 타깃으로 한다 (WebView2)
  build: {
    target: 'chrome105',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
