import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/astronomy-engine')) return 'astronomy';
          return undefined;
        },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Cosmos · Real-Scale Solar System',
        short_name: 'Cosmos',
        description: 'Fly a starship through a real-scale Solar System with warp drive.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['games', 'education'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // app shell + the always-needed data; planet maps are cached on first use
        globPatterns: ['**/*.{js,css,html,svg,ico}', 'icons/*.png', 'data/stars.bin', 'models/*', 'textures/sky/milkyway_2048.webp'],
        globIgnores: ['**/textures/**/!(milkyway_2048).webp'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/textures/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'cosmos-textures',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 120 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'cosmos-fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
});
