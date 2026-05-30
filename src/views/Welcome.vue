<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useWalletStore } from "@/stores/wallet";
import { decryptJSON, readVaultFile, type VaultEnvelope } from "@/lib/vault";
import { pushToast } from "@/lib/utils";
import PinPad from "@/components/PinPad.vue";
import { useT } from "@/locales";

const router = useRouter();
const auth = useAuthStore();
const settings = useSettingsStore();
const wallet = useWalletStore();
const t = useT();

const importFileInputRef = ref<HTMLInputElement | null>(null);
const envelope = ref<VaultEnvelope | null>(null);
const pinOpen = ref(false);
const pin = ref("");
const pinError = ref(false);
const importing = ref(false);

function pick() {
  importFileInputRef.value?.click();
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    envelope.value = await readVaultFile(file);
    pin.value = "";
    pinError.value = false;
    pinOpen.value = true;
  } catch (err: any) {
    pushToast(err?.message || "Invalid vault file", "error");
  }
}

async function onPinComplete(v: string) {
  if (!envelope.value) return;
  importing.value = true;
  try {
    const payload: any = decryptJSON(envelope.value, v);
    if (
      !payload ||
      typeof payload !== "object" ||
      !payload.auth?.account ||
      !payload.settings
    ) {
      throw new Error("Vault schema invalid");
    }
    auth.$patch({ account: payload.auth.account, _pin: "" });
    settings.$patch({
      theme: payload.settings.theme ?? "rust",
      activeNode: payload.settings.activeNode ?? settings.activeNode,
      nodes: payload.settings.nodes ?? settings.nodes,
      currency: payload.settings.currency ?? settings.currency,
      lockTimeoutSec: payload.settings.lockTimeoutSec ?? settings.lockTimeoutSec,
      pinHash: payload.settings.pinHash ?? "",
    });
    if (payload.wallet) wallet.hydrate(payload.wallet);
    settings.applyTheme();
    pushToast("Vault Restored", "success");
    pinOpen.value = false;
    envelope.value = null;
    setTimeout(() => router.replace("/lock"), 400);
  } catch (e: any) {
    pinError.value = true;
    setTimeout(() => {
      pin.value = "";
      pinError.value = false;
    }, 600);
    pushToast(e?.message || "Invalid PIN or corrupted vault", "error");
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col px-6 py-7 relative overflow-hidden" data-testid="welcome-view">
    <!-- background grid -->
    <div
      class="absolute inset-0 pointer-events-none opacity-[0.18]"
      :style="{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }"
    />

    <div class="relative flex flex-col items-start gap-2 mb-8">
      <div class="flex items-center gap-2.5">
        <div
          class="w-9 h-9 rounded-md border border-indigo-forge/60 bg-gunmetal-600 grid place-items-center shadow-glowIndigo"
        >
          <span class="mono text-indigo-forgeBright font-bold text-base">S</span>
        </div>
        <div class="flex flex-col leading-none">
          <span class="text-[10px] uppercase tracking-[0.3em] text-fiatDim">
            SmartHoldem
          </span>
          <span class="text-sm font-semibold text-bone mt-1">Anvil · Edition</span>
        </div>
      </div>
    </div>

    <div class="relative flex-1 flex flex-col justify-center">
      <h1 class="text-3xl leading-[1.05] font-semibold text-bone tracking-tight">
        Cold steel
        <br />
        <span class="text-indigo-forgeBright">for hot</span>
        <br />
        <span class="mono text-cyan-voltGlow">crypto.</span>
      </h1>
      <p class="mt-4 text-sm text-fiat leading-relaxed max-w-[290px]">
        A SmartHoldem [STH] wallet for games, payments, and pure on-chain sovereignty.
        Every signature is saved locally — your keys never leave the lockbox.
      </p>

      <div class="mt-8 flex flex-wrap gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border border-gunmetal-400 text-fiatDim">
          MV3 · Side Panel
        </span>
        <span class="text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border border-indigo-forge/40 text-indigo-forgeBright">
          AES-256
        </span>
        <span class="text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border border-cyan-volt/40 text-cyan-voltGlow">
          BIP-39
        </span>
      </div>
    </div>

    <div class="relative flex flex-col gap-2.5">
      <button
        @click="router.push('/create')"
        class="forge-btn-primary h-12"
        data-testid="create-wallet-btn"
      >
        <span class="mono text-base">+</span>
        Create a new wallet
      </button>
      <button
        @click="router.push('/import')"
        class="forge-btn h-11"
        data-testid="import-wallet-btn"
      >
        Restore from seed
      </button>
      <button
        @click="pick"
        class="forge-btn-cyan h-10 text-[11px]"
        data-testid="import-vault-btn"
      >
        <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 21V9" />
          <path d="M7 14l5-5 5 5" />
          <path d="M5 3h14" />
        </svg>
        Import encrypted .sth vault
      </button>
      <input
        ref="importFileInputRef"
        type="file"
        accept=".sth,.json,application/json"
        class="hidden"
        @change="onFileChange"
        data-testid="welcome-vault-file-input"
      />
      <p class="text-[10px] uppercase tracking-[0.18em] text-fiatDim text-center mt-2 text-green-800">
        {{ t('welcome.version') }}
      </p>
    </div>

    <!-- PIN modal -->
    <div
      v-if="pinOpen"
      class="fixed inset-0 z-50 bg-black/60 flex items-end px-3 py-3"
      @click.self="pinOpen = false; envelope = null"
      data-testid="welcome-import-pin-modal"
    >
      <div class="forge-card p-4 w-full">
        <div class="flex items-center justify-between mb-2">
          <p class="text-sm font-semibold text-bone">Decrypt vault</p>
          <button
            @click="pinOpen = false; envelope = null"
            class="text-fiatDim hover:text-rust text-xs"
            data-testid="welcome-import-pin-cancel"
          >
            ✕
          </button>
        </div>
        <p class="text-[11px] text-fiatDim leading-relaxed mb-3">
          Enter the PIN used when this vault was exported.
        </p>
        <PinPad
          v-model="pin"
          :length="6"
          :error="pinError"
          :disabled="importing"
          @complete="onPinComplete"
        />
      </div>
    </div>
  </div>
</template>
