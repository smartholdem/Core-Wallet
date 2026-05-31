#!/usr/bin/env node
/**
 * build-firefox.mjs — Mozilla Add-ons (AMO) build pipeline for SmartHoldem
 * Wallet, kept completely separate from the Chromium / CRX pipeline.
 *
 * Steps (in order):
 *   1. Run Vite with `BUILD_TARGET=firefox` so output goes to
 *      `apps/extension/dist-firefox/` (configured in vite.config.extension.ts).
 *      All shared safety nets — alias shims, vite-csp-strip plugin — apply
 *      identically to both targets.
 *   2. Run the CSP regression guard against `dist-firefox/` before any
 *      manifest mutation, guaranteeing 0 dynamic-code-generation primitives.
 *   3. Transform `dist-firefox/manifest.json`:
 *        - Remove `side_panel` + `sidePanel` permission (Chrome-only).
 *        - Inject `sidebar_action.default_panel = "popup.html"`.
 *        - Add `browser_specific_settings.gecko.{id, strict_min_version}`.
 *   4. Zip `dist-firefox/` contents (no parent folder) into
 *      `apps/extension/prime-wallet-firefox-<version>.zip`.
 *   5. Print final artefact path, size, sha256, and version.
 *
 * The Chromium `apps/extension/dist/` and `.crx` artefacts are NEVER touched
 * by this script — `yarn build:extension` remains the canonical CWS flow.
 */
import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  createWriteStream,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ZipArchive } from "archiver";

// Surface ANY uncaught error in this script verbatim — never silently exit.
// (The default Node behaviour for top-level await rejections is a useless
// stack-less "exit code 1" which makes the Vite-pipeline diagnose hopeless.)
process.on("uncaughtException", (err) => {
  console.error("\u001b[31m✗ build-firefox.mjs uncaughtException:\u001b[0m");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("\u001b[31m✗ build-firefox.mjs unhandledRejection:\u001b[0m");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version || "0.0.0";

const OUT_DIR = resolve(ROOT, "apps/extension/dist-firefox");
const SRC_MANIFEST = resolve(ROOT, "manifest.json");
const ZIP_PATH = resolve(
  ROOT,
  `apps/extension/prime-wallet-firefox-${VERSION}.zip`,
);

// ── 1. Vite build into dist-firefox ────────────────────────────────────────
const banner = (msg) =>
  console.log(`\n\u001b[1m\u001b[35m▶ ${msg}\u001b[0m`);

banner(`Vite build → ${OUT_DIR}`);

/**
 * Why `shell: true` and not direct `node_modules/.bin/vite` ?
 *
 * On Windows the `.bin/vite` entry is a `.cmd` shim, not a real executable.
 * `child_process.spawnSync` refuses to launch `.cmd` files without a shell,
 * silently exits with status 1 and an empty stdio buffer — which hides the
 * *actual* Vite compilation error and makes the failure look mysterious.
 *
 * Running through `shell: true` lets Windows resolve the shim via cmd.exe
 * and Linux/macOS resolve via /bin/sh — same command works on both.
 *
 * We also explicitly merge & print stderr so we never lose a Vite error
 * message even if the shim invocation itself misbehaves.
 */
let viteResult;
try {
  viteResult = spawnSync(
    "vite build -c vite.config.extension.ts",
    {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, BUILD_TARGET: "firefox" },
    },
  );
} catch (err) {
  console.error("\u001b[31m✗ spawn(vite) threw before launch:\u001b[0m");
  console.error(err);
  process.exit(1);
}

if (viteResult.error) {
  console.error(
    "\u001b[31m✗ spawn(vite) returned an error object:\u001b[0m",
    viteResult.error.message || viteResult.error,
  );
  if (viteResult.error.stack) console.error(viteResult.error.stack);
}
if (viteResult.stderr && viteResult.stderr.length) {
  // Only populated when stdio is NOT 'inherit' — kept as defensive log.
  process.stderr.write(viteResult.stderr);
}
if (viteResult.status !== 0) {
  console.error(
    `\u001b[31m✗ Vite build failed\u001b[0m  (exit code ${viteResult.status})`,
  );
  console.error(
    "  Hint: re-run with `yarn build:firefox` after deleting `node_modules/.vite`\n" +
      "        — stale optimised-deps cache is the most common cause.",
  );
  process.exit(viteResult.status || 1);
}

// ── 2. CSP regression guard on dist-firefox/ ───────────────────────────────
banner("CSP audit (dist-firefox)");
let cspResult;
try {
  cspResult = spawnSync(
    `node "${resolve(__dirname, "check-csp.mjs")}" dist-firefox`,
    { cwd: ROOT, stdio: "inherit", shell: true },
  );
} catch (err) {
  console.error("\u001b[31m✗ spawn(check-csp) threw before launch:\u001b[0m");
  console.error(err);
  process.exit(1);
}
if (cspResult.error) {
  console.error(
    "\u001b[31m✗ spawn(check-csp) returned an error:\u001b[0m",
    cspResult.error.message || cspResult.error,
  );
}
if (cspResult.status !== 0) {
  console.error("✗ CSP audit failed — aborting Firefox packaging.");
  process.exit(cspResult.status || 1);
}

// ── 3. Manifest rewrite for Gecko ──────────────────────────────────────────
banner("Rewriting manifest.json for Gecko");
const manifest = JSON.parse(readFileSync(SRC_MANIFEST, "utf8"));

// (a) Drop Chromium-only side_panel API & its permission.
//     Firefox does not implement `chrome.sidePanel`; presence of the
//     permission would cause `about:debugging` to reject the install.
delete manifest.side_panel;
manifest.permissions = (manifest.permissions || []).filter(
  (p) => p !== "sidePanel",
);

// (b) Firefox dual-surface strategy: ship BOTH `action.default_popup`
//     AND `sidebar_action`. They coexist on Gecko per the MV3 spec —
//     the toolbar-icon click opens the **popup** (discoverable default,
//     fixed 400×600 sized in popup.html), and the user can additionally
//     pin the wallet as a left/right **sidebar** via
//       Firefox menu  →  View  →  Sidebar  →  SmartHoldem Wallet
//     This gives the dual UX the user asked for without needing an
//     in-app `sidebar=true/false` toggle (impossible at runtime —
//     manifest surfaces are decided at install time).
manifest.action = {
  default_title: "SmartHoldem Wallet",
  default_popup: "popup.html",
  default_icon: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
  },
};
manifest.sidebar_action = {
  default_title: "SmartHoldem Wallet",
  default_panel: "popup.html",
  default_icon: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
  },
  // Don't auto-open on install — let users opt in via the View menu.
  open_at_install: false,
};

// (c) Mozilla-mandated identity block. The `id` doubles as the AMO
//     listing key, so it must remain stable across releases.
manifest.browser_specific_settings = {
  gecko: {
    id: "wallet-forge@smartholdem.io",
    strict_min_version: "109.0",
  },
};

// (d) Firefox MV3 supports `background.scripts` but not `service_worker`.
//     Rewrite to a non-persistent background script reference for Gecko.
//     The compiled `background.js` is already an ES module at the root
//     of dist-firefox/, so wrap it as a single-script background.
if (manifest.background && manifest.background.service_worker) {
  manifest.background = {
    scripts: [manifest.background.service_worker],
  };
}

// (e) Firefox MV3 requires `content_scripts[].world` to be one of
//     "ISOLATED" | "MAIN" (same as Chrome >=111) — leave untouched.

const OUT_MANIFEST = join(OUT_DIR, "manifest.json");
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`  ✓ ${OUT_MANIFEST}`);

// ── 4. Zip the directory contents (no parent folder) ───────────────────────
banner("Packing AMO-ready ZIP");
if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH);

// Cross-platform ZIP via `archiver` (already transitively installed by `crx`).
// Avoids the previous `execSync("zip ...")` dependency on a system `zip`
// binary — which doesn't exist on stock Windows installs and silently
// failed there even when Vite succeeded. Entries are root-relative because
// `archive.directory(OUT_DIR, false)` strips the parent folder name, which
// AMO mandates (it rejects archives whose entries are nested in a subdir).
await new Promise((resolveZip, rejectZip) => {
  const output = createWriteStream(ZIP_PATH);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on("close", resolveZip);
  archive.on("warning", (e) => {
    if (e.code !== "ENOENT") rejectZip(e);
  });
  archive.on("error", rejectZip);
  archive.pipe(output);
  archive.directory(OUT_DIR, false);
  archive.finalize();
});

const zipBuf = readFileSync(ZIP_PATH);
const sha256 = createHash("sha256").update(zipBuf).digest("hex");
const stat = statSync(ZIP_PATH);

console.log("");
console.log("\u001b[32m✓ Packed Firefox extension\u001b[0m");
console.log(`  out:     ${ZIP_PATH}`);
console.log(`  size:    ${(stat.size / 1024).toFixed(1)} kB`);
console.log(`  sha256:  ${sha256}`);
console.log(`  version: ${VERSION}`);
console.log("");
console.log(
  "Upload to https://addons.mozilla.org/developers/addon/submit/, or test\n" +
    "locally via about:debugging → This Firefox → Load Temporary Add-on…\n" +
    "(select dist-firefox/manifest.json directly).",
);
