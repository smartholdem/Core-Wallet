import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import rollupNodePolyFill from "rollup-plugin-polyfill-node";
import { VitePWA } from "vite-plugin-pwa";

// Dev/preview build (port 3000 via supervisor `yarn start`) AND production
// PWA target (`yarn build:pwa`). The same config drives both because the
// PWA build is essentially "dev preview but minified + service worker".
//
// Build modes:
//   `yarn start`          → dev server, no PWA service worker
//   `yarn build`          → static SPA, PWA plugin disabled by default
//   `yarn build:pwa`      → static SPA + service worker registration + manifest
//                            (mode === "pwa" enables VitePWA below)
//
// Chrome/Firefox extension targets use the *separate* vite.config.extension.ts.
export default defineConfig(({ mode }) => {
  const IS_PWA = mode === "pwa";
  // Динамически переключаем папку вывода: для PWA используем dist-pwa
  const outDir = IS_PWA ? "apps/dist-pwa" : "dist";

  return {
  plugins: [
    vue(),
    // VitePWA only injects its service-worker + manifest pipeline when we're
    // explicitly building the PWA target. Otherwise we'd ship a SW into the
    // dev preview (and into any unrelated `yarn build`) that would intercept
    // fetches and confuse `yarn build:extension` packagers.
    ...(IS_PWA
      ? [
          VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            // Use the hand-written manifest.json we ship in /public so we
            // can control all 12 fields (categories, scope, orientation…).
            // VitePWA would otherwise generate a minimal one from this block.
            manifest: false,
            includeAssets: [
              "favicon.svg",
              "manifest.json",
              "icons/icon-192.png",
              "icons/icon-512.png",
              "icons/icon-128.png",
              "icons/icon-48.png",
              "icons/icon-32.png",
              "icons/icon-16.png",
            ],
            workbox: {
              // 5 MB cap — covers our crypto-vendor chunk (~3.3 MB).
              maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
              globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
              navigateFallback: "/index.html",
              // Don't cache external API calls. Wallet always needs the
              // freshest balance / tx / exchange rate data.
              navigateFallbackDenylist: [
                /^\/api\//,
                /^https?:\/\/(node|exchange|explorer)\.smartholdem\.io/,
              ],
              runtimeCaching: [
                {
                  // Google Fonts CSS — stale-while-revalidate for fast paint.
                  urlPattern: /^https:\/\/fonts\.googleapis\.com/,
                  handler: "StaleWhileRevalidate",
                  options: { cacheName: "anvil-fonts-css" },
                },
                {
                  // Google Fonts files (woff2) — long-cache them, they're
                  // hash-revisioned by Google.
                  urlPattern: /^https:\/\/fonts\.gstatic\.com/,
                  handler: "CacheFirst",
                  options: {
                    cacheName: "anvil-fonts-bin",
                    expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
                  },
                },
              ],
            },
            devOptions: { enabled: false },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      buffer: "buffer",
      process: "process/browser",
      stream: "stream-browserify",
      events: "events",
      util: "util",
      // CSP-safe shims — replace AJV's `new Function` schema compiler
      // (forbidden under MV3 `script-src 'self'`) with eval-free stubs.
      // Applied to dev preview too so both surfaces share the same code path.
      ajv: path.resolve(__dirname, "src/lib/ajv-shim.js"),
      "ajv-keywords": path.resolve(__dirname, "src/lib/ajv-keywords-shim.js"),
    },
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      clientPort: 443,
      protocol: "wss",
    },
  },
  optimizeDeps: {
    // Bumping this string is the simplest way to invalidate the dep cache
    // when the AJV / ajv-keywords shims change. Vite hashes the optimizeDeps
    // config into the on-disk `node_modules/.vite/deps/_metadata.json` hash;
    // changing any field forces a clean re-bundle on next `yarn dev`.
    // Shim revision: 2026-02-28-r2 (added `.get(name).definition.CONSTRUCTORS`)
    include: [
      "vue",
      "vue-router",
      "pinia",
      "pinia-plugin-persistedstate",
      "axios",
      "crypto-js",
      "qrcode",
      "bip39",
      "@smartholdem/crypto",
      "buffer",
      "process",
      "util",
      "stream-browserify",
      "events",
    ],
    esbuildOptions: {
      define: { global: "globalThis" },
      plugins: [
        NodeGlobalsPolyfillPlugin({ buffer: true, process: true }),
      ],
    },
  },
  build: {
    outDir: outDir,
    rollupOptions: {
      plugins: [rollupNodePolyFill()],
    },
  },
};
});
