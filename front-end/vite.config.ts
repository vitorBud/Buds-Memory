import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'

const BACKEND_URL = 'http://127.0.0.1:5050'
const backendProxyAgent = new http.Agent({
  keepAlive: false,
  maxSockets: 32,
})

function isLoopbackHost(hostHeader: string | undefined): boolean {
  const host = (hostHeader || '').trim().toLowerCase()
  return (
    host === 'localhost'
    || host.startsWith('localhost:')
    || host === '127.0.0.1'
    || host.startsWith('127.0.0.1:')
    || host === '[::1]'
    || host.startsWith('[::1]:')
  )
}

function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  const address = (remoteAddress || '').trim().toLowerCase().split('%', 1)[0]
  return (
    address === '::1'
    || address === '127.0.0.1'
    || address === '::ffff:127.0.0.1'
  )
}

function lanApiGuard(): Plugin {
  let lastRemoteCheck = 0
  let remoteModeEnabled = false

  return {
    name: 'aether-lan-api-guard',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
        if (!pathname.startsWith('/api/')) {
          next()
          return
        }

        if (pathname === '/api/auth/device-token') {
          if (
            isLoopbackHost(request.headers.host)
            && isLoopbackAddress(request.socket.remoteAddress)
          ) {
            next()
            return
          }
          response.statusCode = 403
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify({
            error: 'O token só pode ser exibido no computador principal.',
          }))
          return
        }

        if (isLoopbackHost(request.headers.host)) {
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
          error: 'O acesso pela rede local exige o backend em modo remoto autenticado.',
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
    lanApiGuard(),
  ],
  server: {
    // O Vite anuncia automaticamente a URL LAN. APIs acessadas pela rede
    // continuam protegidas pelo token obrigatório do backend.
    host: '0.0.0.0',
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
