<script setup lang="ts">
/**
 * AuthorizeMessage — modal shown when a dApp invokes
 * `window.smartholdem.signMessage(message)`.
 *
 * Layout mirrors AuthorizeConnect / AuthorizeTx so the visual language
 * stays consistent.
 *
 * Approve flow:
 *   1. Requires an unlocked vault (the Schnorr key is derived from the
 *      in-memory decrypted mnemonic). If locked, the user is prompted to
 *      unlock via Gatekeeper first — the request stays pending.
 *   2. Calls `wallet.signMessage(message)` which resolves with
 *      `{ address, publicKey, hash, message, signature }` and forwards it
 *      to background.ts through `UI_AUTHORIZE_COMPLETE`. background.ts
 *      looks the request up by `requestId` and pipes the payload into the
 *      still-open sendResponse channel → the dApp's Promise resolves.
 *
 * Reject flow:
 *   `UI_AUTHORIZE_COMPLETE { approved: false, error }` — the dApp's
 *   Promise rejects with `Error("User rejected the signature request.")`.
 */
import { computed } from "vue";
import { useIntentStore } from "@/stores/intent";
import { useAuthStore } from "@/stores/auth";
import { useWalletStore } from "@/stores/wallet";
import { pushToast, shortAddress } from "@/lib/utils";

const intent = useIntentStore();
const auth = useAuthStore();
const wallet = useWalletStore();

const req = computed(() => intent.pendingMessage);

const originHost = computed(() => {
  if (!req.value?.origin) return "unknown dApp";
  try {
    return new URL(req.value.origin).host;
  } catch {
    return req.value.origin;
  }
});

function sendUiComplete(approved: boolean, payload: any, error?: string) {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({
    type: "UI_AUTHORIZE_COMPLETE",
    requestId: req.value?.id,
    approved,
    payload,
    error,
  });
}

function approve() {
  if (!req.value) return;
  if (auth.isLocked) {
    pushToast("Unlock wallet first, then press Sign again", "error");
    return;
  }
  try {
    const result = wallet.signMessage(req.value.message);
    sendUiComplete(true, result);
    pushToast("Message signed", "success");
    intent.clearSignMessage();
  } catch (e: any) {
    pushToast(e?.message || "Signing failed", "error");
  }
}

function reject() {
  sendUiComplete(false, null, "User rejected the signature request.");
  pushToast("Signature denied", "info");
  intent.clearSignMessage();
}
</script>

<template>
  <div
    v-if="req"
    class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end p-3"
    data-testid="authorize-message-modal"
  >
    <div class="forge-card w-full p-4 border-cyan-volt/40">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span
            class="inline-block w-1.5 h-1.5 rounded-full bg-cyan-voltGlow animate-pulse-glow"
          />
          <span
            class="text-[10px] uppercase tracking-[0.18em] text-cyan-voltGlow font-semibold"
          >
            Signature Request
          </span>
        </div>
        <button
          @click="reject"
          class="text-fiatDim hover:text-rust text-xs"
          data-testid="authorize-message-close"
        >
          ✕
        </button>
      </div>

      <p class="text-[11px] text-fiatDim mb-3">
        <span class="mono text-fiat">{{ originHost }}</span>
        is requesting your Schnorr signature. This is an off-chain
        signature — no transaction is created and no fee is paid.
      </p>

      <div
        class="forge-card p-2.5 flex flex-col gap-1.5 text-[12px]"
        data-testid="authorize-message-summary"
      >
        <div class="flex items-center justify-between">
          <span
            class="text-fiatDim uppercase tracking-[0.18em] text-[10px]"
          >Account</span>
          <span
            class="mono text-fiat text-[11px]"
            data-testid="authorize-message-address"
          >
            {{ shortAddress(auth.address || "", 8, 8) }}
          </span>
        </div>
        <div class="flex flex-col gap-1">
          <span
            class="text-fiatDim uppercase tracking-[0.18em] text-[10px]"
          >Message</span>
          <div
            class="mono text-fiat text-[10.5px] break-all max-h-24 overflow-y-auto bg-black/30 rounded p-2"
            data-testid="authorize-message-text"
          >
            {{ req.message }}
          </div>
        </div>
      </div>

      <div class="flex gap-2 mt-3">
        <button
          @click="reject"
          class="forge-btn flex-1 h-11"
          data-testid="authorize-message-reject-btn"
        >
          Reject
        </button>
        <button
          @click="approve"
          class="forge-btn-cyan flex-1 h-11"
          data-testid="authorize-message-approve-btn"
        >
          Sign
        </button>
      </div>
    </div>
  </div>
</template>
