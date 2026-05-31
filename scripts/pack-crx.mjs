#!/usr/bin/env node
/**
 * Post-build packager: turns `apps/extension/dist/` into a signed `.crx`.
 *
 * - Generates a stable RSA private key at `apps/extension/key.pem` on first run.
 *   The same key is reused on subsequent builds so the extension ID stays
 *   consistent across releases (critical for chrome.runtime ID identity).
 * - Writes the archive to `apps/extension/prime-wallet-<version>.crx` and prints
 *   the SHA-256 of both the crx and the embedded ZIP for auditability.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ChromeExtension from "crx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version || "1.0.0";

const EXT_DIR = resolve(ROOT, "apps/extension/dist");
const KEY_PATH = resolve(ROOT, "apps/extension/key.pem");
const OUT_PATH = resolve(ROOT, `apps/extension/prime-wallet-${VERSION}.crx`);

if (!existsSync(EXT_DIR)) {
  console.error(`✗ ${EXT_DIR} not found. Run \`yarn build:extension\` first.`);
  process.exit(1);
}

if (!existsSync(KEY_PATH)) {
  console.log("→ Generating RSA private key (keeps extension ID stable across builds)");
  execSync(`openssl genrsa -out "${KEY_PATH}" 2048`, { stdio: "ignore" });
}

const crx = new ChromeExtension({
  codebase: "https://smartholdem.io/prime-wallet.crx",
  privateKey: readFileSync(KEY_PATH),
});

await crx.load(EXT_DIR);
const crxBuffer = await crx.pack();
writeFileSync(OUT_PATH, crxBuffer);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const stat = statSync(OUT_PATH);

console.log("");
console.log("✓ Packed Chrome extension");
console.log(`  out:     ${OUT_PATH}`);
console.log(`  size:    ${(stat.size / 1024).toFixed(1)} kB`);
console.log(`  sha256:  ${sha256(crxBuffer)}`);
console.log(`  version: ${VERSION}`);
console.log("");
console.log("Drop the .crx onto chrome://extensions (Developer Mode) to install.");
