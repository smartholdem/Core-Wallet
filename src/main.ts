import "./lib/polyfills";
import { createApp, watchEffect } from "vue";
import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import { router } from "./router";
import { useIntentStore } from "@/stores/intent";
import { useAuthStore } from "@/stores/auth";
import { isExtension, isStandalonePWA, surfaceLabel } from "@/lib/runtime";
import "./style.css";

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

const app = createApp(App);
app.use(pinia);
app.use(router);
app.mount("#app");

/**
 * Dismiss the inline Core Wallet boot splash (defined in index.html / popup.html).
 *
 * Why `requestAnimationFrame` instead of dismissing immediately after
 * `mount()`: Vue's `mount()` synchronously creates the component tree but
 * the browser hasn't painted yet — yanking the splash on the same tick
 * produces a ~30 ms gap of empty `<div id="app">` before Vue's first
 * paint, which defeats the whole point of the splash. Waiting for the
 * next animation frame guarantees Vue has rendered to the framebuffer.
 */
function dismissBootSplash() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("prime-boot-container");
  if (!el) return;
  el.style.transition = "opacity 0.2s ease-out";
  el.style.opacity = "0";
  setTimeout(() => el.remove(), 220);
}
requestAnimationFrame(dismissBootSplash);

/**
 * Cross-context bridge wiring:
 *   - In the extension side panel: receive `smartholdem:dispatch` from the
 *     background service worker and translate it into a pending intent
 *     (connect / sign / sign-message / swap deep-link).
 *   - Mirror the active wallet address to `chrome.storage.local` so the
 *     background SW can serve the `getAccount` whitelist fast-path without
 *     blocking on the UI being open.
 *   - In the dev preview: expose `window.__sthDev*()` console helpers.
 */
const intent = useIntentStore();
const auth = useAuthStore();

function applyIntent(method: string, params: any) {
  if (method === "requestSwap") {
    intent.setSwap({
      direction: params?.direction ?? "STH_TO_USDT",
      amount: params?.amount,
      destination: params?.destination,
      origin: params?.origin,
    });
    if (router.currentRoute.value.path !== "/swap") {
      router.push("/swap");
    }
  } else if (method === "signTransaction" || method === "sendTransaction") {
    // Same UI flow — AuthorizeTx modal renders either flavour based on the
    // `broadcast` flag (see PendingSignRequest in stores/intent.ts).
    //
    // `sendTransaction` is the one-shot convenience: sign + broadcast in
    // a single PIN entry. Resolves the dApp Promise with the node's
    // broadcast response augmented with `{ id, serialized, data }`.
    intent.setSign({
      id: params?.__id ?? Date.now(),
      payload: {
        recipient: params?.recipientId ?? params?.recipient,
        amount: params?.amount,
        vendorField: params?.vendorField,
        fee: params?.fee,
      },
      broadcast: method === "sendTransaction",
      origin: params?.origin,
    });
  } else if (method === "signMessage") {
    // Off-chain Schnorr signature over an arbitrary string — the
    // Login-with-Wallet flow (README §1.8.2). Opens AuthorizeMessage modal;
    // resolves with { address, publicKey, hash, message, signature }.
    intent.setSignMessage({
      id: params?.__id ?? Date.now(),
      message: typeof params?.message === "string" ? params.message : "",
      origin: params?.origin,
    });
  } else if (method === "getAccount") {
    intent.setConnect({
      id: params?.__id ?? Date.now(),
      origin: params?.origin ?? "",
    });
  }
}

// Background-driven intents (only meaningful inside the extension surface).
// PWA / web tab contexts have no `chrome.runtime` — we skip the listener
// entirely instead of relying on the dApp bridge.
if (isExtension() && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "smartholdem:dispatch") return;
    const { id, method, params, origin } = msg.payload || {};
    // Forward the request id and origin so the modal can resolve through
    // UI_AUTHORIZE_COMPLETE with the correct key.
    applyIntent(method, { ...(params || {}), __id: id, origin });
  });
}

// Whitelist fast-path enabler — only relevant inside an extension where
// chrome.storage.local actually exists and the background SW reads it.
if (isExtension() && chrome.storage?.local) {
  watchEffect(() => {
    const addr = auth.address;
    if (typeof addr === "string" && addr.length > 0) {
      chrome.storage.local.set({ sthActiveAddress: addr });
    }
  });
}

// Standalone PWA detection — log the surface once so dApp authors and
// support staff can confirm which runtime is active in console.
if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.log(
    `[SmartHoldem Wallet] surface=${surfaceLabel()}`,
    isStandalonePWA() ? "(installed as PWA)" : "",
  );
  document.documentElement.setAttribute("data-surface", surfaceLabel());
}

// Dev-mode simulators — trigger from the browser console.
(window as any).__sthDevDeepLink = (params: any) =>
  applyIntent("requestSwap", params || {});

(window as any).__sthDevSignTx = (params: any) =>
  applyIntent("signTransaction", { __id: Date.now(), ...(params || {}) });

(window as any).__sthDevSendTx = (params: any) =>
  applyIntent("sendTransaction", { __id: Date.now(), ...(params || {}) });

(window as any).__sthDevConnect = (params: any) =>
  applyIntent("getAccount", {
    __id: Date.now(),
    origin: params?.origin ?? "https://smartholdem.io",
  });

(window as any).__sthDevSignMessage = (params: any) =>
  applyIntent("signMessage", {
    __id: Date.now(),
    message: params?.message ?? "SmartHoldem DAPP · Login · dev-nonce",
    origin: params?.origin ?? "https://smartholdem.io",
  });
