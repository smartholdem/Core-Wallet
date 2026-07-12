import { defineStore } from "pinia";

/**
 * Transient cross-screen intents handed in by a dApp (via inject.js → background
 * → side panel). Four categories of pending action:
 *
 *   - `pendingSwap`    : deep-link into the Swap Hub with pre-filled inputs.
 *                        Approval is implicit (the user submits the swap form).
 *   - `pendingSign`    : `signTransaction` — opens AuthorizeTx modal.
 *   - `pendingConnect` : `getAccount` (a.k.a. sth_requestAccounts) — opens
 *                        AuthorizeConnect modal. Approving optionally adds the
 *                        origin to `chrome.storage.local.authorizedOrigins`
 *                        so subsequent calls are silent.
 *   - `pendingMessage` : `signMessage` — opens AuthorizeMessage modal.
 *                        Off-chain Schnorr signature over an arbitrary string
 *                        (Login-with-Wallet flow). No transaction, no fee.
 */
export interface SwapIntent {
  direction: "STH_TO_USDT" | "USDT_TO_STH";
  amount?: number | string;
  destination?: string;
  origin?: string;
  createdAt: number;
}

export interface PendingSignRequest {
  id: number | string;
  payload: {
    recipient?: string;
    amount?: number | string;
    vendorField?: string;
    fee?: number | string;
  };
  /**
   * When `true`, the AuthorizeTx modal performs sign + broadcast in one
   * step (driven by `window.smartholdem.sendTransaction`). The primary CTA
   * label switches to "Confirm, Sign & Broadcast" and the dApp Promise
   * resolves with the node's broadcast response. When `false`/absent, the
   * modal only signs and returns the signed payload (classic
   * `signTransaction`).
   */
  broadcast?: boolean;
  origin?: string;
  createdAt: number;
}

export interface PendingConnectRequest {
  id: number | string;
  origin: string;
  createdAt: number;
}

export interface PendingMessageRequest {
  id: number | string;
  message: string;
  origin?: string;
  createdAt: number;
}

export const useIntentStore = defineStore("intent", {
  state: () => ({
    pendingSwap: null as SwapIntent | null,
    pendingSign: null as PendingSignRequest | null,
    pendingConnect: null as PendingConnectRequest | null,
    pendingMessage: null as PendingMessageRequest | null,
  }),
  actions: {
    setSwap(intent: Omit<SwapIntent, "createdAt">) {
      this.pendingSwap = { ...intent, createdAt: Date.now() };
    },
    consumeSwap(): SwapIntent | null {
      const v = this.pendingSwap;
      this.pendingSwap = null;
      return v;
    },
    setSign(req: Omit<PendingSignRequest, "createdAt">) {
      this.pendingSign = { ...req, createdAt: Date.now() };
    },
    clearSign() {
      this.pendingSign = null;
    },
    setConnect(req: Omit<PendingConnectRequest, "createdAt">) {
      this.pendingConnect = { ...req, createdAt: Date.now() };
    },
    clearConnect() {
      this.pendingConnect = null;
    },
    setSignMessage(req: Omit<PendingMessageRequest, "createdAt">) {
      this.pendingMessage = { ...req, createdAt: Date.now() };
    },
    clearSignMessage() {
      this.pendingMessage = null;
    },
  },
});
