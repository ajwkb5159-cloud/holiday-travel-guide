import { defineConfig } from 'vite'
import vue2 from '@vitejs/plugin-vue2'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue2()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5099', changeOrigin: true }
    }
  },
  build: {
    outDir: '../HolidayGuideBackend/wwwroot',
    emptyOutDir: true
  }
})
