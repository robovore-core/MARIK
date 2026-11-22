import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['fabil.local', '.ngrok-free.app', '.ngrok.app', '.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
})
