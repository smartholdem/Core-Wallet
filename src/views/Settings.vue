<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { useWalletStore } from "@/stores/wallet";
import { pushToast } from "@/lib/utils";
import {
  encryptJSON,
  decryptJSON,
  downloadVault,
  readVaultFile,
} from "@/lib/vault";
import BottomDock from "@/components/BottomDock.vue";
import PinPad from "@/components/PinPad.vue";
import { useT } from "@/locales";

const router = useRouter();
const settings = useSettingsStore();
const auth = useAuthStore();
const wallet = useWalletStore();
const t = useT();

const probing = ref(false);
const showWipe = ref(false);

/**
 * Auto-lock duration presets — keyed by short identifier used both in
 * `data-testid` and i18n lookup, plus `seconds` written to `lockTimeoutSec`.
 * Matches the 6 buttons shown in the Forge spec mockup.
 */
const AUTOLOCK_PRESETS = [
  { key: "30s", seconds: 30, labelKey: "set.autoLock.30s" },
  { key: "1m", seconds: 60, labelKey: "set.autoLock.1m" },
  { key: "2m", seconds: 120, labelKey: "set.autoLock.2m" },
  { key: "5m", seconds: 300, labelKey: "set.autoLock.5m" },
  { key: "10m", seconds: 600, labelKey: "set.autoLock.10m" },
  { key: "30m", seconds: 1800, labelKey: "set.autoLock.30m" },
] as const;

// === Vault export ===
const exporting = ref(false);
const exportPinOpen = ref(false);
const exportPin = ref("");
const exportPinError = ref(false);

// === Vault import ===
const importFileInputRef = ref<HTMLInputElement | null>(null);
const importEnvelope = ref<any | null>(null);
const importPinOpen = ref(false);
const importPin = ref("");
const importPinError = ref(false);
const importing = ref(false);
const dragging = ref(false);

async function rescan() {
  probing.value = true;
  try {
    await settings.updateNodes();
    pushToast("Node pool refreshed", "success");
  } finally {
    probing.value = false;
  }
}

function pickNode(node: string) {
  settings.setActiveNode(node);
  pushToast(`Switched to ${node}`, "success");
}

function pickTheme(t: "rust" | "cyan" | "light") {
  settings.setTheme(t);
  const label =
    t === "rust"
      ? "Rust Classic engaged"
      : t === "cyan"
      ? "Cyan Steel engaged"
      : "Industrial Light engaged";
  pushToast(label, "success");
}

// Language picker removed from this view — handled by TopBar's
// LanguageDropdown to avoid duplicating the control surface.

function wipe() {
  auth.wipe();
  pushToast("Storage wiped", "success");
  router.replace("/welcome");
}

function snapshot() {
  return {
    auth: {
      account: auth.account,
    },
    settings: {
      theme: settings.theme,
      activeNode: settings.activeNode,
      nodes: settings.nodes,
      currency: settings.currency,
      lockTimeoutSec: settings.lockTimeoutSec,
      pinHash: settings.pinHash,
    },
    wallet: {
      historyCache: wallet.historyCache,
      balances: wallet.balances,
      txStatus: wallet.txStatus,
    },
  };
}

function beginExport() {
  if (!auth.hasWallet) {
    pushToast("No vault to export", "error");
    return;
  }
  exportPin.value = "";
  exportPinError.value = false;
  exportPinOpen.value = true;
}

async function onExportPinComplete(v: string) {
  if (!auth.verify(v)) {
    exportPinError.value = true;
    setTimeout(() => {
      exportPin.value = "";
      exportPinError.value = false;
    }, 600);
    pushToast("Wrong PIN", "error");
    return;
  }
  exporting.value = true;
  try {
    const env = encryptJSON(snapshot(), v);
    downloadVault(env);
    pushToast("Vault exported", "success");
    exportPinOpen.value = false;
  } catch (e: any) {
    pushToast(e?.message || "Export failed", "error");
  } finally {
    exporting.value = false;
  }
}

function triggerImportPicker() {
  importFileInputRef.value?.click();
}

async function onImportFile(file: File) {
  try {
    const env = await readVaultFile(file);
    importEnvelope.value = env;
    importPin.value = "";
    importPinError.value = false;
    importPinOpen.value = true;
  } catch (e: any) {
    pushToast(e?.message || "Invalid vault file", "error");
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) onImportFile(file);
  input.value = "";
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) onImportFile(file);
}

async function onImportPinComplete(v: string) {
  if (!importEnvelope.value) return;
  importing.value = true;
  try {
    const payload: any = decryptJSON(importEnvelope.value, v);
    if (
      !payload ||
      typeof payload !== "object" ||
      !payload.auth ||
      !payload.auth.account ||
      !payload.settings
    ) {
      throw new Error("Vault schema invalid");
    }
    // Restore to stores. Lock immediately afterwards — the user must re-enter
    // the same PIN to unlock so the in-memory seed is never auto-decrypted.
    auth.$patch({ account: payload.auth.account, _pin: "" });
    settings.$patch({
      theme: payload.settings.theme ?? "rust",
      activeNode: payload.settings.activeNode ?? settings.activeNode,
      nodes: payload.settings.nodes ?? settings.nodes,
      currency: payload.settings.currency ?? settings.currency,
      lockTimeoutSec: payload.settings.lockTimeoutSec ?? settings.lockTimeoutSec,
      pinHash: payload.settings.pinHash ?? "",
    });
    if (payload.wallet) {
      wallet.hydrate(payload.wallet);
    }
    settings.applyTheme();
    pushToast("Vault Restored", "success");
    importEnvelope.value = null;
    importPinOpen.value = false;
    // Force re-lock → Gatekeeper.
    setTimeout(() => router.replace("/lock"), 500);
  } catch (e: any) {
    importPinError.value = true;
    setTimeout(() => {
      importPin.value = "";
      importPinError.value = false;
    }, 600);
    pushToast(e?.message || "Invalid PIN or corrupted vault", "error");
  } finally {
    importing.value = false;
  }
}

onMounted(() => {
  if (settings.nodesStatus.length === 0) rescan();
});
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0" data-testid="settings-view">
    <header
      class="flex items-center justify-between px-4 py-3 border-b border-gunmetal-400 bg-gunmetal-800"
    >
      <button
        @click="router.push('/dashboard')"
        class="text-[11px] uppercase tracking-[0.18em] text-fiat hover:text-bone"
        data-testid="back-btn"
      >
        ← Back
      </button>
      <span class="text-[10px] uppercase tracking-[0.3em] text-fiat font-semibold">
        Core · Settings
      </span>
      <span class="w-12" />
    </header>

    <div class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
      <!-- APPEARANCE / DESIGN SYSTEM (new) -->
      <section data-testid="appearance-card">
        <span class="forge-label">Appearance · Design System</span>
        <div class="forge-card p-3.5">
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-bone leading-tight">
                {{ settings.theme === "rust" ? "Rust &amp; Core" : "Cyan Steel" }}
              </p>
              <p class="text-[11px] text-fiatDim mt-1 leading-relaxed">
                {{
                  settings.theme === "rust"
                    ? "SmartHoldem native — burned amber on gunmetal."
                    : "Legacy forge — anodized indigo + volt cyan."
                }}
              </p>
            </div>
            <!-- preview swatch -->
            <div class="flex gap-1 flex-shrink-0 mt-1">
              <span
                class="w-4 h-4 rounded-sm border border-gunmetal-400"
                style="background: rgb(var(--accent))"
              />
              <span
                class="w-4 h-4 rounded-sm border border-gunmetal-400"
                style="background: rgb(var(--highlight))"
              />
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2" data-testid="theme-picker">
            <button
              type="button"
              @click="pickTheme('rust')"
              :data-testid="'theme-rust-btn'"
              class="relative h-12 rounded-md border-2 font-semibold text-[11px] uppercase tracking-[0.18em] transition-all"
              :class="
                settings.theme === 'rust'
                  ? 'border-[#E25822] bg-[#E25822]/15 text-[#FF7A3D] shadow-[0_0_0_1px_rgba(226,88,34,0.5),0_0_18px_-2px_rgba(226,88,34,0.55)]'
                  : 'border-gunmetal-400 bg-gunmetal-700 text-fiat hover:border-gunmetal-300'
              "
            >
              <span class="flex items-center justify-center gap-1.5">
                <span
                  class="inline-block w-2 h-2 rounded-full bg-[#E25822]"
                  :class="{ 'animate-pulse-glow': settings.theme === 'rust' }"
                />
                Rust
              </span>
            </button>
            <button
              type="button"
              @click="pickTheme('cyan')"
              :data-testid="'theme-cyan-btn'"
              class="relative h-12 rounded-md border-2 font-semibold text-[11px] uppercase tracking-[0.18em] transition-all"
              :class="
                settings.theme === 'cyan'
                  ? 'border-[#4F46E5] bg-[#4F46E5]/15 text-[#6366F1] shadow-[0_0_0_1px_rgba(79,70,229,0.5),0_0_18px_-2px_rgba(79,70,229,0.55)]'
                  : 'border-gunmetal-400 bg-gunmetal-700 text-fiat hover:border-gunmetal-300'
              "
            >
              <span class="flex items-center justify-center gap-1.5">
                <span
                  class="inline-block w-2 h-2 rounded-full bg-[#4F46E5]"
                  :class="{ 'animate-pulse-glow': settings.theme === 'cyan' }"
                />
                Cyan
              </span>
            </button>
            <button
              type="button"
              @click="pickTheme('light')"
              :data-testid="'theme-light-btn'"
              class="relative h-12 rounded-md border-2 font-semibold text-[11px] uppercase tracking-[0.18em] transition-all"
              :class="
                settings.theme === 'light'
                  ? 'border-[#B45309] bg-[#B45309]/15 text-[#D97706] shadow-[0_0_0_1px_rgba(180,83,9,0.5),0_0_18px_-2px_rgba(180,83,9,0.55)]'
                  : 'border-gunmetal-400 bg-gunmetal-700 text-fiat hover:border-gunmetal-300'
              "
            >
              <span class="flex items-center justify-center gap-1.5">
                <span
                  class="inline-block w-2 h-2 rounded-full bg-[#B45309]"
                  :class="{ 'animate-pulse-glow': settings.theme === 'light' }"
                />
                Light
              </span>
            </button>
          </div>
          <p
            class="text-[10px] text-fiatDim leading-relaxed mt-2"
            data-testid="theme-active-desc"
          >
            {{
              settings.theme === 'rust'
                ? t('set.themeRustDesc')
                : settings.theme === 'cyan'
                ? t('set.themeCyanDesc')
                : t('set.themeLightDesc')
            }}
          </p>
        </div>
      </section>

      <!-- Keys -->
      <section>
        <span class="forge-label">Security</span>
        <button
          @click="router.push('/settings/keys')"
          class="forge-card w-full p-3 text-left hover:border-cyan-volt/60 transition-colors flex items-center justify-between"
          data-testid="reveal-keys-btn"
        >
          <div>
            <p class="text-sm font-semibold text-bone">View Seed / Private Key</p>
            <p class="text-[11px] text-fiatDim mt-0.5">Requires PIN re-entry.</p>
          </div>
          <span class="text-cyan-voltGlow">→</span>
        </button>
      </section>

      <!-- AUTO-LOCK · idle-timer security -->
      <!--
        Persistent settings:
          autoLockEnabled: boolean
          lockTimeoutSec:  number (one of the 6 presets below)
        The actual idle-timer is enforced by App.vue's inactivity watcher
        which reads `settings.lockTimeoutSec` and calls `auth.lock()`
        after the configured period of no UI interaction.
      -->
      <section data-testid="autolock-card">
        <span class="forge-label">{{ t('set.autoLock') }}</span>
        <div class="forge-card p-3.5">
          <div class="flex items-center justify-between mb-3">
            <div>
              <div class="flex items-center gap-2">
                <p class="text-sm font-semibold text-bone uppercase tracking-[0.18em]">
                  {{ t('set.autoLock') }}
                </p>
                <span
                  class="text-[9px] uppercase tracking-[0.18em] font-bold px-1.5 py-0.5 rounded"
                  :class="settings.autoLockEnabled
                    ? 'bg-[#E25822] text-bone'
                    : 'bg-gunmetal-500 text-fiatDim'"
                  data-testid="autolock-status-badge"
                >
                  {{ settings.autoLockEnabled ? t('set.autoLockOn') : t('set.autoLockOff') }}
                </span>
              </div>
              <p class="text-[11px] text-fiatDim mt-0.5">
                {{ t('set.autoLockDesc') }}
              </p>
            </div>
            <!-- Toggle switch (Forge-themed) -->
            <button
              type="button"
              @click="settings.setAutoLock(!settings.autoLockEnabled)"
              data-testid="autolock-toggle"
              class="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
              :class="settings.autoLockEnabled ? 'bg-[#E25822]' : 'bg-gunmetal-500'"
              :aria-pressed="settings.autoLockEnabled"
            >
              <span
                class="absolute top-0.5 w-5 h-5 rounded-full bg-bone shadow transition-all"
                :class="settings.autoLockEnabled ? 'left-[26px]' : 'left-0.5'"
              />
            </button>
          </div>

          <!-- Duration presets -->
          <div
            class="grid grid-cols-3 gap-1.5"
            :class="{ 'opacity-40 pointer-events-none': !settings.autoLockEnabled }"
            data-testid="autolock-presets"
          >
            <button
              v-for="opt in AUTOLOCK_PRESETS"
              :key="opt.seconds"
              type="button"
              @click="settings.setAutoLock(true, opt.seconds)"
              :data-testid="`autolock-${opt.key}-btn`"
              class="h-10 rounded-md border-2 text-[11px] uppercase tracking-[0.18em] font-semibold transition-all"
              :class="
                settings.lockTimeoutSec === opt.seconds
                  ? 'border-[#E25822] text-[#FF7A3D] bg-[#E25822]/10 shadow-[0_0_0_1px_rgba(226,88,34,0.45)]'
                  : 'border-gunmetal-400 bg-gunmetal-700 text-fiat hover:border-gunmetal-300'
              "
            >
              {{ t(opt.labelKey) }}
            </button>
          </div>
        </div>
      </section>

      <!-- INTERNATIONALIZATION moved to TopBar dropdown only -->
      <!-- (Language card intentionally removed per UX request — it lives in
           TopBar's LanguageDropdown to avoid duplication.) -->

      <!-- Backup: encrypted .sth vault export/import -->
      <section data-testid="backup-card">
        <span class="forge-label">Backup · Encrypted Vault</span>
        <div class="forge-card p-3.5">
          <p class="text-[11px] text-fiatDim leading-relaxed mb-3">
            Export your full extension state (seed, labels, settings) as a
            PIN-encrypted <span class="mono text-fiat">.sth</span> file. Restore later on any device.
          </p>

          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              @click="beginExport"
              :disabled="!auth.hasWallet || exporting"
              class="forge-btn-primary h-11 text-[11px] uppercase tracking-[0.18em]"
              data-testid="vault-export-btn"
            >
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              Export .sth
            </button>
            <button
              type="button"
              @click="triggerImportPicker"
              class="forge-btn-cyan h-11 text-[11px] uppercase tracking-[0.18em]"
              data-testid="vault-import-btn"
            >
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 21V9" />
                <path d="M7 14l5-5 5 5" />
                <path d="M5 3h14" />
              </svg>
              Import .sth
            </button>
          </div>

          <!-- Drop zone -->
          <div
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop="onDrop"
            @click="triggerImportPicker"
            class="mt-2.5 p-3 rounded-md border border-dashed text-center text-[11px] cursor-pointer transition-colors"
            :class="
              dragging
                ? 'border-cyan-volt/70 bg-cyan-volt/5 text-cyan-voltGlow'
                : 'border-gunmetal-400 text-fiatDim hover:border-gunmetal-300'
            "
            data-testid="vault-dropzone"
          >
            <span class="uppercase tracking-[0.18em] font-semibold">
              {{ dragging ? "Release to load vault" : "or drop a .sth file here" }}
            </span>
          </div>

          <input
            ref="importFileInputRef"
            type="file"
            accept=".sth,.json,application/json"
            class="hidden"
            @change="onFileChange"
            data-testid="vault-file-input"
          />
        </div>
      </section>

      <!-- Export PIN modal -->
      <div
        v-if="exportPinOpen"
        class="fixed inset-0 z-50 bg-black/60 flex items-end px-3 py-3"
        @click.self="exportPinOpen = false"
        data-testid="export-pin-modal"
      >
        <div class="forge-card p-4 w-full">
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm font-semibold text-bone">Confirm PIN</p>
            <button
              @click="exportPinOpen = false"
              class="text-fiatDim hover:text-rust text-xs"
              data-testid="export-pin-cancel"
            >
              ✕
            </button>
          </div>
          <p class="text-[11px] text-fiatDim leading-relaxed mb-3">
            Encrypts the export with your current PIN.
          </p>
          <PinPad
            v-model="exportPin"
            :length="6"
            :error="exportPinError"
            :disabled="exporting"
            @complete="onExportPinComplete"
          />
        </div>
      </div>

      <!-- Import PIN modal -->
      <div
        v-if="importPinOpen"
        class="fixed inset-0 z-50 bg-black/60 flex items-end px-3 py-3"
        @click.self="importPinOpen = false; importEnvelope = null"
        data-testid="import-pin-modal"
      >
        <div class="forge-card p-4 w-full">
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm font-semibold text-bone">Decrypt vault</p>
            <button
              @click="importPinOpen = false; importEnvelope = null"
              class="text-fiatDim hover:text-rust text-xs"
              data-testid="import-pin-cancel"
            >
              ✕
            </button>
          </div>
          <p class="text-[11px] text-fiatDim leading-relaxed mb-3">
            Enter the PIN used when this vault was exported.
          </p>
          <PinPad
            v-model="importPin"
            :length="6"
            :error="importPinError"
            :disabled="importing"
            @complete="onImportPinComplete"
          />
        </div>
      </div>

      <!-- Node pool -->
      <section>
        <div class="flex items-center justify-between mb-1.5">
          <span class="forge-label !mb-0">Mainnet Node Pool</span>
          <button
            @click="rescan"
            class="text-[10px] uppercase tracking-[0.18em] text-cyan-voltGlow hover:text-cyan-volt"
            data-testid="rescan-nodes-btn"
          >
            {{ probing ? "probing…" : "↻ rescan" }}
          </button>
        </div>

        <div class="flex flex-col gap-1.5" data-testid="node-list">
          <button
            v-for="n in settings.nodesStatus.length ? settings.nodesStatus : settings.nodes.map(x => ({ node: x, latency: Infinity, synced: false, status: null }))"
            :key="n.node"
            @click="pickNode(n.node)"
            class="flex items-center justify-between p-2.5 rounded border text-left transition-colors"
            :class="
              n.node === settings.activeNode
                ? 'border-indigo-forge/60 bg-indigo-forge/10 shadow-glowIndigo'
                : 'border-gunmetal-400 bg-gunmetal-700 hover:border-gunmetal-300'
            "
            :data-testid="`node-${n.node}`"
          >
            <div class="flex items-center gap-2">
              <span
                class="inline-block w-1.5 h-1.5 rounded-full"
                :class="
                  n.synced
                    ? 'bg-indigo-forgeBright'
                    : isFinite(n.latency)
                    ? 'bg-rust'
                    : 'bg-gunmetal-300'
                "
              />
              <span class="mono text-xs text-fiat">{{ n.node }}</span>
            </div>
            <span class="mono text-[10px] text-fiatDim">
              {{ isFinite(n.latency) ? `${n.latency}ms` : "—" }}
            </span>
          </button>
        </div>
      </section>

      <!-- Wipe -->
      <section>
        <span class="forge-label">Danger Zone</span>
        <button
          v-if="!showWipe"
          @click="showWipe = true"
          class="forge-btn-rust w-full h-11"
          data-testid="wipe-btn"
        >
          Wipe Secure Storage
        </button>
        <div v-else class="forge-card p-3 border-rust/60">
          <p class="text-xs text-bone">This will erase your encrypted seed forever.</p>
          <p class="text-[11px] text-rust mt-1">Make sure you have your seed backed up.</p>
          <div class="flex gap-2 mt-3">
            <button
              @click="showWipe = false"
              class="forge-btn flex-1 h-10"
              data-testid="wipe-cancel-btn"
            >
              Cancel
            </button>
            <button
              @click="wipe"
              class="forge-btn-rust flex-1 h-10"
              data-testid="wipe-confirm-btn"
            >
              Erase
            </button>
          </div>
        </div>
      </section>

    </div>

    <BottomDock />
  </div>
</template>
