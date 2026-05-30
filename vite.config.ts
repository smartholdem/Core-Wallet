import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import rollupNodePolyFill from "rollup-plugin-polyfill-node";

// Dev/preview build (served on port 3000 via supervisor `yarn start`)
// Renders the extension UI inside a centered side-panel mockup frame.
export default defineConfig({
  plugins: [vue()],
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
    outDir: "dist",
    rollupOptions: {
      plugins: [rollupNodePolyFill()],
    },
  },
});
