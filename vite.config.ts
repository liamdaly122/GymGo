import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app must work in a gym basement with no signal, so everything the
      // shell needs — including the seeded exercise database chunk — is
      // precached at install time rather than fetched on demand.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      workbox: {
        // webp matters: the exercise photos live in public/exercise-images and
        // would otherwise be fetched from the network on first view, which is
        // exactly what this app is not allowed to need.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // The seed chunk is ~360KB; the default 2MB cap would silently skip
        // anything larger and leave first-run seeding broken offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'GymGo',
        short_name: 'GymGo',
        description: 'Offline-first workout tracker',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['health', 'fitness'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        // Off in development: a service worker caching a dev build makes every
        // change look like it did not apply.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // scripts/ holds the boundary tests, which read the source from disk and
    // therefore need Node APIs the app project deliberately does not expose.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
