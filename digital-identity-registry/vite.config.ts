/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Продакшен-сборка живёт под жёстким CSP из index.html: connect-src 'none',
 * script-src 'self'. Dev-серверу Vite нужны два послабления, которых нет и
 * не будет в сборке: WebSocket для HMR и inline-скрипт React Fast Refresh.
 * Подменяем директивы только в режиме serve — `npm run build` отдаёт
 * index.html с CSP без изменений.
 */
function devOnlyCsp(): Plugin {
  return {
    name: 'dev-only-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("connect-src 'none'", "connect-src 'self' ws: wss:")
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devOnlyCsp()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
