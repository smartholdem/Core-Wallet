/**
 * MV3 background entry — runs as a service_worker in Chromium and as a
 * non-persistent background script in Firefox.
 *
 * Architecture: dApp ↔ background ↔ side-panel UI handshake
 * ─────────────────────────────────────────────────────────
 *   1. Page calls e.g. `window.smartholdem.getAccount()` → inject.js posts
 *      a `smartholdem-dapp` message to the page window.
 *   2. bridge.js (ISOLATED world) forwards it to us as a
 *      `smartholdem:request` runtime message, carrying `(id, method, params,
 *      origin)`. The `sendResponse` callback we receive is the dApp's
 *      Promise resolver — we MUST keep it alive until the user clicks
 *      Approve/Reject in the side panel.
 *   3. We register the `sendResponse` in `pendingRequests` and return `true`
 *      from the listener to signal to Chromium that the channel is async.
 *   4. We dispatch a `smartholdem:dispatch` message to the side panel UI,
 *      which renders the appropriate authorization modal
 *      (AuthorizeConnect / AuthorizeTx / Swap deep-link).
 *   5. When the user resolves the modal, the UI sends
 *      `UI_AUTHORIZE_COMPLETE { requestId, approved, payload?, error? }`
 *      back to us. We look up the pending request, invoke its sendResponse
 *      with the final result, and clean up.
 *
 * Whitelist fast-path for `getAccount`:
 *   Authorized origins are stored under `chrome.storage.local.authorizedOrigins`
 *   (string[]). The active wallet address is mirrored to
 *   `chrome.storage.local.sthActiveAddress` by the side panel whenever it
 *   changes. If the dApp's origin is whitelisted AND we have a cached
 *   address, we resolve `getAccount` instantly — no UI prompt.
 */

// Firefox exposes `browser` as a top-level global. `chrome` is the Chromium
// global and is also polyfilled in Firefox for parity (but a few APIs differ).
declare const browser: any;

const HOST: any =
  typeof browser !== "undefined" ? browser : (globalThis as any).chrome;

const IS_FIREFOX =
  typeof browser !== "undefined" && typeof browser.sidebarAction !== "undefined";

// ── Pending dApp request registry ─────────────────────────────────────────
// Map<requestId, { sendResponse, method, origin, timer }>
//   - `sendResponse` is the dApp's Promise resolver (alive while we returned
//     `true` from the listener).
//   - `timer` rejects the request if the user takes >120 s to act.
interface PendingRequest {
  sendResponse: (msg: any) => void;
  method: string;
  origin: string;
  timer: number;
}
const pendingRequests = new Map<string | number, PendingRequest>();

const REQUEST_TIMEOUT_MS = 120_000;

function clearPending(id: string | number) {
  const p = pendingRequests.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pendingRequests.delete(id);
}

function resolvePending(id: string | number, result: any) {
  const p = pendingRequests.get(id);
  if (!p) return;
  clearPending(id);
  try {
    p.sendResponse({ id, result });
  } catch {
    /* channel already closed by browser GC — dApp will see a timeout */
  }
}

function rejectPending(id: string | number, error: string) {
  const p = pendingRequests.get(id);
  if (!p) return;
  clearPending(id);
  try {
    p.sendResponse({ id, error });
  } catch {
    /* channel already closed */
  }
}

// ── First-install bootstrap ────────────────────────────────────────────────
HOST.runtime.onInstalled.addListener(() => {
  if (!IS_FIREFOX && HOST.sidePanel) {
    // Chrome only — toolbar icon auto-opens the side panel.
    HOST.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }
});

// ── Open the wallet surface ────────────────────────────────────────────────
// Chromium  → `chrome.sidePanel.open({ windowId })`           (side panel)
// Firefox   → no API needed; manifest `action.default_popup` makes Firefox
//             open the popup on every toolbar click automatically. The
//             programmatic-open path below tries `sidebarAction` first as a
//             courtesy for Firefox installs that still use the older sidebar
//             manifest, and gracefully no-ops on standard popup builds.
async function openWalletSurface(tab: any) {
  if (IS_FIREFOX && browser.sidebarAction?.open) {
    try {
      await browser.sidebarAction.open();
    } catch {
      /* popup-only build / no focused window — toolbar icon will still work */
    }
    return;
  }
  if (HOST.sidePanel?.open && tab?.windowId) {
    try {
      await HOST.sidePanel.open({ windowId: tab.windowId });
    } catch {
      /* not permitted from non-gesture context */
    }
  }
}

HOST.action?.onClicked?.addListener((tab: any) => openWalletSurface(tab));

// NOTE: `browser.browserAction.onClicked` is intentionally NOT registered.
// In Manifest V3 the API was removed by Mozilla (replaced by `browser.action`,
// already handled by the listener above which polls the `chrome.*` / `browser.*`
// namespace). Registering both raises AMO's "browserAction.onClicked has been
// removed in MV3" warning at submission time. For Firefox we rely on
// `action.default_popup` in the manifest, which makes the toolbar icon
// auto-open the popup without any JS listener needed.

async function openWalletForCurrent() {
  try {
    const [tab] = await HOST.tabs.query({ active: true, currentWindow: true });
    await openWalletSurface(tab);
  } catch {
    /* no active tab */
  }
}

// ── Whitelist & address-cache helpers ─────────────────────────────────────
async function getAuthorizedOrigins(): Promise<string[]> {
  return new Promise((resolve) => {
    HOST.storage.local.get("authorizedOrigins", (res: any) => {
      resolve(Array.isArray(res?.authorizedOrigins) ? res.authorizedOrigins : []);
    });
  });
}

async function getCachedAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    HOST.storage.local.get("sthActiveAddress", (res: any) => {
      resolve(typeof res?.sthActiveAddress === "string" ? res.sthActiveAddress : null);
    });
  });
}

// ── dApp → background → side-panel ─────────────────────────────────────────
HOST.runtime.onMessage.addListener(
  (msg: any, sender: any, sendResponse: (r: any) => void) => {
    // ── Resolution messages from the side-panel UI ─────────────────────────
    if (msg?.type === "UI_AUTHORIZE_COMPLETE") {
      const { requestId, approved, payload, error } = msg;
      if (approved) resolvePending(requestId, payload);
      else rejectPending(requestId, error || "User rejected the request.");
      return false; // synchronous ack
    }

    // ── Inbound dApp request from bridge.js ────────────────────────────────
    if (msg?.type !== "smartholdem:request") return false;

    const payload = msg.payload || {};
    const { id, method, params } = payload;
    // Prefer the explicit origin from inject.js (window.location.origin of
    // the dApp tab). `sender.origin` is undefined in Firefox MV3 content
    // scripts, so we always fall back to the payload-supplied value.
    const origin: string = payload.origin || sender?.origin || sender?.url || "";

    // Register the dApp's Promise resolver now — every code path below
    // resolves or rejects through `pendingRequests`.
    const timer = setTimeout(
      () => rejectPending(id, "smartholdem: request timeout"),
      REQUEST_TIMEOUT_MS,
    ) as unknown as number;
    pendingRequests.set(id, { sendResponse, method, origin, timer });

    // Whitelist fast-path: `getAccount` from a previously-authorized origin
    // resolves immediately without opening any UI.
    if (method === "getAccount") {
      (async () => {
        const [whitelist, addr] = await Promise.all([
          getAuthorizedOrigins(),
          getCachedAddress(),
        ]);
        if (origin && addr && whitelist.includes(origin)) {
          resolvePending(id, { address: addr });
          return;
        }
        // Not whitelisted — fall through to user prompt.
        await openWalletForCurrent();
        HOST.runtime.sendMessage({
          type: "smartholdem:dispatch",
          payload: { id, method, params, origin },
        });
      })();
      return true; // KEEP CHANNEL OPEN — async resolution.
    }

    // All other interactive methods (`signMessage`, `signTransaction`,
    // `requestSwap`) always require user confirmation.
    openWalletForCurrent();
    HOST.runtime.sendMessage({
      type: "smartholdem:dispatch",
      payload: { id, method, params, origin },
    });

    return true; // KEEP CHANNEL OPEN — async resolution.
  },
);

// ── Self-clean stale requests if the side panel closes mid-flight ─────────
// (Browsers GC the sendResponse callback after the originating message
//  port closes; the 120 s timeout above is the ultimate safety net.)
