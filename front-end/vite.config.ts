import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'

const backendProxyAgent = new http.Agent({
  keepAlive: false,
  maxSockets: 32,
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      // Proxy all /api calls to the Flask backend
      '/api': {
        target: 'http://127.0.0.1:5050',
        changeOrigin: true,
        secure: false,
        agent: backendProxyAgent,
        timeout: 180_000,
        proxyTimeout: 180_000,
        headers: {
          connection: 'close',
        },
      },
    },
  },
})
