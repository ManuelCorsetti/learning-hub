import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.PORT ?? '8787'

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
})
