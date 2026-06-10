import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import https from 'node:https'

// Vite + Vitest config. Sim/engine tests run in the node environment (no DOM).
// The kooker gateway URL is kept OUT of this public repo — set KOOKER_GATEWAY in .env.local
// (see .env.example). Browser -> Vite proxy -> kooker APISIX gateway (avoids CORS).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const kookerGateway = env.KOOKER_GATEWAY || 'http://localhost:8081'
  // Pin the dev proxy to IPv4. api.kooker.co.za (AWS) publishes both A and AAAA records; on a host
  // without working IPv6 egress, node connects to the IPv6 address first and hangs (ETIMEDOUT), so
  // the proxy returns a silent 502 even though the gateway is healthy and curl (Happy Eyeballs ->
  // IPv4) works. family:4 makes node behave like curl. See the reboot-IPv6 incident, 2026-06-01.
  const ipv4Agent = kookerGateway.startsWith('https')
    ? new https.Agent({ family: 4 })
    : new http.Agent({ family: 4 })
  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        // Multipage: the colony game plus the spec-077 House Builder (town.html is the legacy v1 page).
        input: { index: 'index.html', builder: 'builder.html', town: 'town.html' },
      },
    },
    server: {
      port: 5188,
      host: true,
      proxy: {
        '/kooker': {
          target: kookerGateway,
          changeOrigin: true,
          secure: true,
          agent: ipv4Agent,
          headers: { 'ngrok-skip-browser-warning': 'true' },
          rewrite: (p) => p.replace(/^\/kooker/, ''),
          // Make upstream failures visible in the vite terminal instead of a silent 502.
          configure: (proxy) => {
            proxy.on('error', (err) => {
              // eslint-disable-next-line no-console
              console.error('[kooker proxy] upstream error:', (err as NodeJS.ErrnoException).code || err.message, '->', kookerGateway)
            })
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    },
  }
})
