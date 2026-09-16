import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    plugins: [
      react(),
      // PWA app-shell caching (offline UI). Punch reliability is owned by the
      // offline outboxes (src/services/punchOutbox.ts + the mobile shell);
      // this only lets the UI itself load without a network. The SSE stream
      // (/api/events) is EXCLUDED from runtime caching — service-worker
      // buffering would break realtime updates. Registration is injected
      // automatically (injectRegister: 'auto'), so main.tsx stays untouched.
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: {
          name: 'TimeTrack',
          short_name: 'TimeTrack',
          description: 'TimeTrack — multi-tenant time tracking, scheduling and payroll platform',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/TimeTrack Icon.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              // Same artwork registered as maskable so Android adaptive-icon
              // launchers render without the transparent-corner artifact.
              src: '/TimeTrack Icon.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // Read-only API GETs: fresh when possible, cached fallback when
              // offline. SSE (/api/events) must stream and is excluded; only
              // 200s are cacheable so auth failures never persist.
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && url.pathname.startsWith('/api/') && url.pathname !== '/api/events',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ request }) =>
                request.destination === 'image' || request.destination === 'font',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-cache',
                expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    esbuild: {
      drop: isProd ? ['console', 'debugger'] : [],
    },
    build: {
      target: 'es2022',
      sourcemap: !isProd,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            lucide: ['lucide-react'],
          },
        },
      },
    },
  };
});
