import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import rollupNodePolyFill from "rollup-plugin-polyfill-node";
// @ts-expect-error — plain .mjs plugin, no type defs needed
import vitePluginCspStrip from "./scripts/vite-csp-strip.mjs";

// Build target — switch between the Chromium pipeline (default) and the
// Firefox/Gecko pipeline driven by `scripts/build-firefox.mjs`.
//   BUILD_TARGET=chrome   → apps/extension/dist        (default, CRX flow)
//   BUILD_TARGET=firefox  → apps/extension/dist-firefox (zipped, AMO flow)
// The only build difference is the output directory: post-build steps
// (manifest rewrite, packaging) live in their respective scripts to keep
// this file simple and target-agnostic.
const TARGET = (process.env.BUILD_TARGET || "chrome").toLowerCase();
const OUT_DIR =
  TARGET === "firefox" ? "apps/extension/dist-firefox" : "apps/extension/dist";

// Chrome / Firefox MV3 extension build.
// Outputs to apps/extension/dist[-firefox] - load this folder as an unpacked extension.
export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "public/icons/*", dest: "icons" },
        { src: "src/inject/inject.js", dest: "." },
        // ISOLATED-world content script used by `inject.js` (MAIN world)
        // to relay `window.smartholdem.*` calls to the SW via chrome.runtime.
        // Without this file Chrome will silently drop the second content_script
        // entry in manifest.json, breaking dApp signing.
        { src: "src/inject/bridge.js", dest: "." },
      ],
    }),
  ],
  resolve: {
    // Note: we deliberately retain Vite's default `mainFields` order
    // (`browser, module, jsnext:main, jsnext`). Forcing `module` first
    // breaks axios (its ESM build imports node `stream` in a way the
    // browser-polyfill plugin cannot resolve). Instead, AJV's
    // `new Function` is intercepted by the dedicated alias below, and
    // any survivor is stripped by `vitePluginCspStrip` at renderChunk
    // time (see scripts/vite-csp-strip.mjs).
    alias: {
      "@": path.resolve(__dirname, "src"),
      buffer: "buffer",
      process: "process/browser",
      // CSP-safe shims — replace AJV's `new Function` schema compiler
      // (forbidden under MV3 `script-src 'self'`) with eval-free stubs.
      ajv: path.resolve(__dirname, "src/lib/ajv-shim.js"),
      "ajv-keywords": path.resolve(__dirname, "src/lib/ajv-keywords-shim.js"),
    },
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        sidebar: path.resolve(__dirname, "popup.html"),
        background: path.resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
        manualChunks(id) {
          // Isolate heavy crypto stack so the Welcome screen never
          // blocks on its parse/execute. The chunk is loaded lazily
          // by the routes that actually need wallet derivation.
          if (
            id.includes("/@smartholdem/crypto/") ||
            id.includes("/bip39/") ||
            id.includes("/bcrypto/") ||
            id.includes("/@scure/bip32/") ||
            id.includes("/@scure/base/") ||
            id.includes("/secp256k1/") ||
            id.includes("/bs58/") ||
            id.includes("/bs58check/")
          ) {
            return "crypto-vendor";
          }
          if (
            id.includes("/crypto-js/") ||
            id.includes("/buffer/") ||
            id.includes("/qrcode/")
          ) {
            return "vendor";
          }
        },
      },
      plugins: [
        rollupNodePolyFill(),
        // Belt-and-braces: physically strip any `new Function` / `eval(`
        // / `Function("...")` survivors from the final chunk text. Logs a
        // build warning so the audit trail is preserved.
        vitePluginCspStrip(),
      ],
    },
  },
});
