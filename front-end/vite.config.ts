import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'

const BACKEND_URL = 'http://127.0.0.1:5050'
const mobileDev = process.env.AETHER_MOBILE_DEV === 'true'
const backendProxyAgent = new http.Agent({
  keepAlive: false,
  maxSockets: 32,
})

function mobileApiGuard(): Plugin {
  let lastRemoteCheck = 0
  let remoteModeEnabled = false

  return {
    name: 'aether-mobile-api-guard',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
        if (!mobileDev || !pathname.startsWith('/api/')) {
          next()
          return
        }

        const publicPaths = new Set([
          '/api/health',
          '/api/auth/status',
          '/api/auth/login',
        ])
        if (publicPaths.has(pathname)) {
          next()
          return
        }

        try {
          const now = Date.now()
          if (now - lastRemoteCheck > 2_000) {
            const statusResponse = await fetch(`${BACKEND_URL}/api/auth/status`)
            const status = statusResponse.ok
              ? await statusResponse.json() as { remote_mode?: boolean; auth_required?: boolean }
              : {}
            remoteModeEnabled = Boolean(status.remote_mode && status.auth_required)
            lastRemoteCheck = now
          }

          if (remoteModeEnabled) {
            next()
            return
          }
        } catch {
          remoteModeEnabled = false
        }

        response.statusCode = 503
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({
          error: 'O modo mobile exige o backend com NEXUS_REMOTE_MODE=true.',
          auth_required: true,
        }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    mobileApiGuard(),
  ],
  server: {
    host: mobileDev ? '0.0.0.0' : '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      // Proxy all /api calls to the Flask backend
      '/api': {
        target: BACKEND_URL,
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
