import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { VitePWA } from 'vite-plugin-pwa';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}


// Production (`vite preview`) cache rules: the HTML shell, service worker and
// manifest must never be cached — every visit gets the newest build without a
// hard refresh — while hashed /assets/ files are immutable and cache forever.
const cacheHeaders = () => ({
  name: "build-cache-headers",
  configurePreviewServer(server: import("vite").PreviewServer) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      if (url.includes("/assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        // index.html, sw.js, manifest, icons, and any route path.
        res.setHeader("Cache-Control", "no-store");
      }
      next();
    });
  },
});

export default defineConfig({
  base: basePath,
  plugins: [
    cacheHeaders(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    VitePWA({
      // 'prompt' lets the app detect a freshly published build while open and
      // show an "Update available — Refresh" toast instead of silently waiting
      // for the next launch (see src/components/UpdatePrompt.tsx).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'HALO Client Dashboard',
        short_name: 'HALO Board',
        description:
          'Your live property board — jobs, crews, invoices and photos from Archangel Contractors.',
        theme_color: '#F4F3EF',
        background_color: '#F4F3EF',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Bust every previous version: take control immediately and drop
        // caches from older service-worker builds so devices stop serving
        // stale bundles after a publish.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
          // The dev-banner plugin injects its script with a root-relative
          // src ("/@replit/..."), which escapes this app's base path and is
          // routed to the root artifact by the workspace proxy — 502ing on
          // every page load whenever that service isn't running. Rewrite the
          // injected src to stay under our base path so our own dev server
          // serves it.
          {
            name: 'rebase-dev-banner-script',
            transformIndexHtml: {
              order: 'post' as const,
              handler(html: string) {
                return html.replace(
                  'src="/@replit/vite-plugin-dev-banner/banner-script.js"',
                  `src="${basePath.replace(/\/?$/, '/')}@replit/vite-plugin-dev-banner/banner-script.js"`,
                );
              },
            },
            configureServer(server: import('vite').ViteDevServer) {
              const rebasedPath = `${basePath.replace(/\/?$/, '/')}@replit/vite-plugin-dev-banner/banner-script.js`;
              server.middlewares.use(async (req, res, next) => {
                if (req.url === rebasedPath) {
                  try {
                    const { createRequire } = await import('node:module');
                    const require = createRequire(import.meta.url);
                    const scriptPath = path.join(
                      path.dirname(
                        require.resolve('@replit/vite-plugin-dev-banner'),
                      ),
                      'banner-script.js',
                    );
                    const fs = await import('node:fs/promises');
                    const script = await fs.readFile(scriptPath, 'utf-8');
                    res.setHeader('Content-Type', 'application/javascript');
                    res.end(script);
                    return;
                  } catch {
                    res.statusCode = 404;
                    res.end();
                    return;
                  }
                }
                next();
              });
            },
          },
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
