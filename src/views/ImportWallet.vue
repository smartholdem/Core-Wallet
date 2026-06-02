<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useWalletStore } from "@/stores/wallet";
import { useAuthStore } from "@/stores/auth";
import { pushToast } from "@/lib/utils";
import PinPad from "@/components/PinPad.vue";

const router = useRouter();
const wallet = useWalletStore();
const auth = useAuthStore();

const step = ref<1 | 2 | 3>(1);
const secret = ref("");
const address = ref("");
const pin = ref("");
const pinConfirm = ref("");
const pinError = ref(false);

function next() {
  const trimmed = secret.value.trim();
  if (!trimmed) {
    pushToast("Enter a seed or private key", "error");
    return;
  }
  try {
    const r = wallet.addressFromSecret(trimmed);
    address.value = r.address;
    step.value = 2;
  } catch (e: any) {
    pushToast("Invalid seed phrase", "error");
  }
}

function onPinComplete(v: string) {
  if (step.value === 2) {
    step.value = 3;
    pinConfirm.value = "";
    return;
  }
  if (step.value === 3) {
    if (v !== pin.value) {
      pinError.value = true;
      setTimeout(() => {
        pinError.value = false;
        pinConfirm.value = "";
      }, 700);
      pushToast("PINs don't match", "error");
      return;
    }
    auth.saveWallet(address.value, secret.value.trim(), pin.value);
    pushToast("Wallet imported", "success");
    router.replace("/dashboard");
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col px-5 py-5 overflow-y-auto" data-testid="import-wallet-view">
    <div class="flex items-center justify-between mb-5">
      <button
        @click="router.back()"
        class="text-[11px] uppercase tracking-[0.18em] text-gunmetal-300 hover:text-bone"
        data-testid="back-btn"
      >
        ← Back
      </button>
      <span class="text-[10px] uppercase tracking-[0.3em] text-gunmetal-300">
        Import · Step {{ step }} / 3
      </span>
    </div>

    <template v-if="step === 1">
      <h2 class="text-xl font-semibold text-bone leading-tight">Restore wallet</h2>
      <p class="text-xs text-indigo-forgeBright mt-1.5">
        Paste your 12/24-word seed phrase or a SmartHoldem private key.
      </p>

      <label class="forge-label mt-5">Secret phrase</label>
      <textarea
        v-model="secret"
        rows="4"
        spellcheck="false"
        autocomplete="off"
        class="forge-input resize-none"
        placeholder="quick brown fox jumps over the…"
        data-testid="seed-input"
      />

      <div class="mt-auto pt-5">
        <button
          @click="next"
          class="forge-btn-primary w-full h-12"
          data-testid="import-continue-btn"
        >
          Validate &amp; continue
        </button>
      </div>
    </template>

    <template v-else-if="step === 2">
      <h2 class="text-xl font-semibold text-bone leading-tight">Set a PIN for</h2>
      <p class="text-xs text-indigo-forgeBright mt-1.5 mono break-all">{{ address }}</p>
      <div class="flex-1">
      </div>
      <div class="mt-1">
        <div class="content-center">
          <svg viewBox="0 0 24 24" class="text-indigo-forgeBright" fill="none" stroke="currentColor" stroke-width="1.5" style="width:128px; height:128px;">
            <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <PinPad v-model="pin" :length="6" @complete="onPinComplete" />
      </div>
    </template>

    <template v-else-if="step === 3">
      <h2 class="text-xl font-semibold text-bone leading-tight">Confirm PIN</h2>
      <p class="text-xs text-indigo-forgeBright mt-1.5 mono break-all">{{ address }}</p>
      <div class="flex-1">
      </div>
      <div class="mt-1">
        <div class="content-center">
          <svg viewBox="0 0 24 24" class="text-indigo-forgeBright" fill="none" stroke="currentColor" stroke-width="1.5" style="width:128px; height:128px;">
            <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <PinPad v-model="pinConfirm" :length="6" :error="pinError" @complete="onPinComplete" />
      </div>
    </template>
  </div>
</template>

<style>
  .content-center {
    display: flex; /* Включаем Flexbox */
    justify-content: center; /* Центрируем по горизонтали */
    align-items: center; /* Центрируем по вертикали (если нужно) */
    height: 25vh; /* Высота контейнера (для примера) */
  }
</style>
