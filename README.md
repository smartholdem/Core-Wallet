# SmartHoldem Wallet Core Edition

> **An industrial-grade crypto wallet for SmartHoldem (STH)** powered by Mozilla/Chrome MV3 Side Panel.
> Vite + Vue 3 + Pinia + Tailwind. Core logic is strictly ported from the official [wallet-pro](https://github.com/smartholdem/wallet-pro).

---

<img width="1852" height="901" alt="image" src="https://github.com/user-attachments/assets/9a2215a0-73c6-480c-8052-71506b8ea0a6" />

## 1. Features

### 1.1. Account Management (Vault)

* **Wallet Creation** – Generates a 12-word BIP-39 mnemonic phrase, features a seed-saving screen with mandatory awareness checkboxes, and secures access with a 6-digit PIN.
* **Seed Restoration** – Allows pasting mnemonics or raw private keys, fully validated via `Identities.Address.validate(addr, 63)`.
* **Encrypted `.sth` Backup Import** – Directly executable from both the Welcome and Settings screens.
* **HD Multi-Accounts** – BIP-44 pathing `m/44'/111'/account'/0/0` via `@scure/bip32`. Account #0 provides perfect compatibility with wallet-pro's passphrase-derivation model.
* **Account Switcher** (`AccountSwitcher`) – Displays real-time balances, includes rapid address copying, and supports inline renaming (e.g., "Account 2" → "Poker Bankroll").
* **PIN Lockbox** (Gatekeeper) – Styled with custom dot indicators, a Scan-line animation grid, and a brutalist numeric keypad overlay.

### 1.2. Dashboard (Vault)

* **Top Bar:** Network status monitor, click-to-copy address, ⚙ Settings toggle, and 🔒 Lock action.
* **Balance Card:** Displays STH using JetBrains Mono (34px), live USDT-equivalent pricing pulled via the XBTS DEX aggregation layer, and current market exchange rates.
* **4 Quick Actions:** **Send · Receive · Swap · History**.
* **Recent Activity:** Lists the latest 3 transactions with clickable direct links to `explorer.smartholdem.io`.

### 1.3. Transfer (Cipher)

* Strict destination address validation via base58check + version-byte 63 (Mainnet network).
* **MEMO / VendorField** input supporting up to 64 characters.
* Fixed mainnet network fee of **0.25 STH**.
* **Hold to Sign & Broadcast** CTA button – Built-in mechanism preventing accidental clicks or double-spend inputs.

### 1.4. Receive (Mint)

* High-contrast QR-code generator styled with signature cyan corner markers and JetBrains Mono address strings.
* Tap-to-Copy interaction with an instant "Address Secured" toast alert.

### 1.5. Swap Hub (Exchange)

* Dual-tabbed layout (**Buy STH / Sell STH**) matching the production `ExchangeModal.vue` logic from wallet-pro.
* **Buy STH:**
* The user enters the target STH amount.
* Computes exact calculations for "To pay" (USDT), "You will receive", and "Min. guaranteed" (factoring in a tight 5% slippage safety buffer).
* Generates a unique BSC/BEP20 deposit address linked directly to the active wallet account (`getBscDepositAddress`), cached per-address and auto-refreshed upon account rotation.
* Hardcoded alert: "Minimum deposit: 5.00 USDT (BEP20)".
* Action button: **“I have paid”** (triggers order state change).


* **Sell STH:**
* Strict input validation for external BEP20 destination addresses.
* Hardcoded minimum threshold verification of 5 USDT before execution.
* **Hold to Sell** compiles a valid v2 on-chain transaction embedding the destination BEP20 address inside the transaction's vendorField, signs it via Schnorr cryptography, and publishes it.
* Background status polling runs every 10 seconds × 30 intervals (5-minute lifecycle), flagging the record as "Bridge Confirmed" upon success.



### 1.6. History (Ledger)

* Comprehensive historical breakdown of transactions bound to the active address.
* Per-address background caching state (`historyCache`), ensuring instantaneous layout toggling without annoying re-fetch network flashes.

### 1.7. Settings (Core)

* **Appearance:** A three-way theme selector: `RUST CLASSIC` (Default, #E25822), `CYAN STEEL` (#4F46E5 + #06B6D4), and `INDUSTRIAL LIGHT` (Machined aluminum #EAECEF background + blueprint grid layout + deep burned amber accents). Driven globally via `[data-theme="…"]` CSS attributes.
* **Security:** In-app seed phrase and private key viewing, guarded behind mandatory PIN re-authentication.
* **Backup & Encrypted Vault:** Exports complete wallet configurations into an external `.sth` file (PBKDF2-SHA256 25k iterations → AES-256-CBC PKCS7 + random IV) with seamless drag-and-drop file importing.
* **Mainnet Node Pool:** Integrates a built-in pool of 7 mainnet nodes with continuous latency monitoring, automatically auto-routing traffic to the fastest peer.
* **Wipe Secure Storage:** A secure, two-stage nuclear-wipe confirmation action styled in high-visibility Rust Orange.

### 1.8. Web3 Provider (For dApp Developers)

The extension injects a standalone **`window.smartholdem`** proxy object into every loaded webpage via `inject.js` (running inside the MAIN world content script context). All exposed methods return a standard `Promise` and route execution through an asynchronous message-passing pipeline: **page → bridge.js (ISOLATED) → background SW → extension UI (Side Panel/Popup)**, where the user can inspect, approve, or reject the context. The communication channel remains alive awaiting manual interaction (utilizing asynchronous `sendResponse` handling with a 120-second safety timeout closure).

#### Base Properties

| Property | Type | Value | Description |
| --- | --- | --- | --- |
| `window.smartholdem.isSmartHoldem` | boolean | `true` | Main indicator of the SmartHoldem Wallet provider |
| `window.smartholdem.version` | string | `"1.4.6"` | Injected provider build version |
| `window.smartholdem.network` | string | `"mainnet"` | Active target network environment |

#### Initialization Lifecycle Hook

```js
window.addEventListener("smartholdem#initialized", () => {
  console.log("SmartHoldem Wallet detected:", window.smartholdem.version);
});

// Or quick inline structural check:
if (window.smartholdem?.isSmartHoldem) { /* ... */ }

```

---

#### 1.8.1. `getAccount()` – Request Active Address Access

Equivalent to standard `sth_requestAccounts`. Executing this for the first time opens a **Connection Request** view in the extension UI layout. If the user clicks **Connect** with the *Trust this site* checkbox enabled, the source domain origin is stored inside `chrome.storage.local.authorizedOrigins`, enabling all future requests to resolve **instantly with zero UI interruptions**.

**Parameters:** None

**Resolves with:** `{ address: string }`

**Throws:** `"User rejected the connection."` / `"smartholdem: request timeout"`

```js
// Establish connection to the wallet wrapper
const { address } = await window.smartholdem.getAccount();
console.log("Active STH address:", address);
// → "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C"

```

Users can easily view, audit, or revoke trusted origins inside the wallet via: **TopBar Key icon → ACCESS · CONNECTED APPS**.

---

#### 1.8.2. `signMessage(message)` – Arbitrary Text Cryptographic Signing

**Parameters:** `message: string`

**Resolves with:** `{ address, publicKey, hash, message, signature }`

```js
const res = await window.smartholdem.signMessage("Hello, SmartHoldem!");
console.log(res);
// {
//   address:   "SeZLuy...sVw51C",
//   publicKey: "02a1b2...",
//   hash:      "9b74c9...",   // sha256(message) in hex format
//   message:   "Hello, SmartHoldem!",
//   signature: "30440220..."  // Schnorr DER format in hex
// }

```

**Common use case:** Decentralized dApp authentication layer without on-chain interaction costs (Login-with-Wallet flow).

---

#### 1.8.3. `signTransaction(payload)` – Cryptographic v2 Transfer Signing

Triggers the **Authorize Transaction** interface overlay displaying the recipient layout, transaction amount, and fee values. The user authorizes execution using their PIN.

**Parameters (Object layout):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `recipientId` | `string` | ✅ | Target STH destination address (34 chars, starts with `S`). Legacy `recipient` alias is supported as a fallback. |
| `amount` | `number | string` | ✅ | Transfer value in **whole STH** (e.g., `1`, `"0.25"`, `"0.00000001"`). Transformed into smartoshi precision values via BigInt (eliminating floating-point precision loss). |
| `fee` | `number | string` | - | Network transaction fee in STH. Standard value defaults to `0.25`. |
| `vendorField` | `string` | - | Message/Memo payload field. Hard limit capped at **255 UTF-8 bytes**. |

**Resolves with:** `{ id, signature, senderPublicKey, tx, serialized, data }`

| Property | Description |
| --- | --- |
| `id` | Computed transaction hash identity (txid) in hex string format |
| `signature` | Cryptographic Schnorr signature string, hex encoded |
| `senderPublicKey` | Public key hex of the source transaction account |
| `tx` | Native JSON schema layout representing `toJson()` output structures |
| `serialized` | **Canonical raw wire bytes in hex format**. Ideal payload format for independent node broadcasting without re-serialization overhead or `configManager` structural mismatch risks. |
| `data` | Complete transaction model dictionary containing explicit `network: 63`, `typeGroup: 1`, and `nonce` parameters. |

```js
// Base transfer request
const result = await window.smartholdem.signTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25
});

// 🟢 RECOMMENDED broadcast strategy (Transmit pre-serialized raw wire bytes):
fetch("https://node.smartholdem.io/api/transactions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transactions: [result.serialized] })
});

// 🟡 Alternative method - Structured JSON broadcast (Requires fully compatible node endpoint):
fetch("https://node.smartholdem.io/api/transactions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transactions: [result.data] })
});

```

Transfer containing custom memo string data:

```js
await window.smartholdem.signTransaction({
  amount: "5.5",
  recipientId: "SeZL...",
  fee: 0.25,
  vendorField: "poker:room42:buyin"
});

```

---

#### 1.8.4. `sendTransaction(payload)` – Atomic One-Click Sign & Broadcast Flow

**Primary Advantage:** The user enters their securing authorization PIN **exactly once**. The extension automatically builds, signs using Schnorr crypto, and instantly pushes the compiled wire bytes directly to the active mainnet node pool. The calling dApp intercepts the raw on-chain network feedback response object directly.

**Parameters:** Identical payload definitions as `signTransaction` (`recipientId`, `amount`, `fee?`, `vendorField?`).

**Resolves with:** Returns all data attributes from `signTransaction` **augmented** with a nested `broadcast` node response dictionary object:

```ts
{
  id: "fd9109...",
  signature: "30...",
  senderPublicKey: "02...",
  tx: { /* signed JSON */ },
  serialized: "ff023f01...",       // canonical wire bytes (hex)
  data: { /* full data w/ network=63, typeGroup=1 */ },
  broadcast: {                      // ← Node POST /api/transactions response
    accept:    ["fd9109..."],       // Array of Transaction IDs accepted into mempool
    broadcast: ["fd9109..."],       // Array of Transaction IDs successfully announced to network peers
    excess:    [],
    invalid:   [],
    errors:    {}                    // Dictionary mapping error reasons per failure ID context
  }
}

```

**UI Differences:** The system overlay screen maps to **AUTHORIZE · SIGN & BROADCAST**, displaying an explicit tracking string `BROADCAST TO node4.smartholdem.io` highlighting the target node, alongside a dedicated **`Confirm, Sign & Broadcast`** CTA execution button. Entering a valid PIN fires up an active loading spinner: `broadcasting to mainnet…` until the returned promise completes.

```js
// Single step execution context - transaction is automatically dispatched onto mainnet:
const r = await window.smartholdem.sendTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25,
  vendorField: "poker:room42:buyin"
});

console.log("Tx ID:",   r.id);
console.log("Accepted:", r.broadcast.accept);   // → [<tx-id>]
console.log("Errors:",   r.broadcast.errors);   // → {} on success states

```

**Strategic Decision Matrix: `sendTransaction` vs `signTransaction**`

| Method Interface | UX Pattern | Ideal Architectural Match Case |
| --- | --- | --- |
| `signTransaction` | Extracts raw signature data; dApp manages network transport layers independently. | dApp routes execution through custom backend proxy nodes, custom relay configurations, or isolated pre-flight simulations. |
| `sendTransaction` | Native one-click flow; automated on-chain broadcast transport pipeline. | The standard matching template for basic game purchases, chip buy-ins, automated e-commerce, and common peer transfers. |

**Edge Case Resolution Parameters:**

* Signing phase failure states (e.g., corrupt recipient formatting): The promise rejects instantly; network broadcast procedures are blocked.
* Success state signature phase paired with network-level exceptions (4xx/5xx/network timeouts): The promise rejects, **however** the rejection payload exposes raw `id/serialized/data` values allowing the calling dApp to manually retry transmission actions independently **without forcing an additional PIN entry**.
* Successful transmission returning an internal node error state (`invalid` structural rejects): The promise resolves normally (transport layer succeeded), allowing the dApp to inspect the internal `broadcast.invalid` / `broadcast.errors` data objects.
* User interface close events (clicking ✕ during active broadcasting): Interactivity controls are disabled; in-flight network POST requests are protected from client interruption.

---

#### 1.8.5. `requestSwap({ amount, direction, destination })` – Deep-Linking to Swap Hub

Directly opens the internal wallet Swap Hub view pre-populating fields automatically. The order is fulfilled using standard step forms inside the application layer. This operates as a UX directional route without exposing return payload callbacks.

**Parameters:**

| Field | Type | Description |
| --- | --- | --- |
| `amount` | `number | string` | Total numeric swap trade volume |
| `direction` | `"STH_TO_USDT" | "USDT_TO_STH"` | Target route currency direction parameter |
| `destination` | `string` | **Mandatory for STH→USDT routes only** – Defines the target destination BEP-20 USDT payout address. Omitted on inbound USDT→STH trades. |

```js
// Requesting inbound conversion pipeline: USDT → STH
window.smartholdem.requestSwap({
  direction: "USDT_TO_STH",
  amount: 42
});

// Outbound sweep conversion configuration: STH → USDT over BSC
window.smartholdem.requestSwap({
  direction: "STH_TO_USDT",
  amount: 1000,
  destination: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
});

```

---

#### 1.8.6. Full Integration Test Script (DevTools Console Execution)

Navigate to any destination target domain → Open DevTools → Console → Execute sequentially:

```js
// 1. Audit active environment injection parameters
console.log("Wallet detected:", !!window.smartholdem?.isSmartHoldem);
console.log("Version:", window.smartholdem.version);

// 2. Fire Account request authorization overlay (Launches "Connection Request")
const acc = await window.smartholdem.getAccount();
console.log("Connected as:", acc.address);

// 3. Re-execute request check - resolves instantly via whitelist logic path
console.time("re-connect");
await window.smartholdem.getAccount();
console.timeEnd("re-connect");   // Typical benchmark output is <5 ms

// 4. Fire cryptographic identity signing request (Login-with-wallet validation)
const msg = await window.smartholdem.signMessage("auth-nonce-" + Date.now());
console.log("Signature:", msg.signature);
console.log("PublicKey:", msg.publicKey);

// 5a. signTransaction workflow - signs the transaction structure without network broadcasting
const signed = await window.smartholdem.signTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25,
  vendorField: "signed-only from " + location.host
});
console.log("Signed tx id:", signed.id);
console.log("Serialized hex:", signed.serialized);

// 6a. Execute external manual broadcast processing 
const manual = await fetch("https://node.smartholdem.io/api/transactions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transactions: [signed.serialized] })
}).then(r => r.json());
console.log("Manual broadcast:", manual);

// 5b. sendTransaction workflow - atomic one-click authorization and publication
const sent = await window.smartholdem.sendTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25,
  vendorField: "one-shot from " + location.host
});
console.log("Tx id:",    sent.id);
console.log("Accepted:", sent.broadcast.accept);
console.log("Errors:",   sent.broadcast.errors);

// 7. Fire Deep-link initialization routing directly into Swap Hub view
window.smartholdem.requestSwap({
  direction: "STH_TO_USDT",
  amount: 100,
  destination: "0x000000000000000000000000000000000000dEaD"
});

```

---

#### 1.8.7. Exception Handling Dictionary

Injected asynchronous execution wrappers reject explicitly under exception constraints. Standard runtime rejection definitions:

| Error Message Value | Triggering Condition |
| --- | --- |
| `User rejected the connection.` | User triggers a Reject action inside the `getAccount` authorization view. |
| `User rejected the transaction.` | User triggers a Reject action or exits the `signTransaction` interface. |
| `smartholdem: request timeout` | Client session fails to react within the 120-second threshold closure. |
| `Wallet is locked` | Application layer is locked; requires a valid unlocking PIN signature entry. |
| `signTransaction: invalid STH address \`...`` | Destination `recipientId` data parameter fails length or base58 check validation. |
| `signTransaction: vendorField exceeds 255 bytes` | Embedded Memo length constraints scale past maximum limits. |
| `signTransaction: missing \`recipientId`` | Mandatory destination parameters are omitted from call payload. |

Implementation Example:

```js
try {
  const tx = await window.smartholdem.signTransaction({
    amount: 1,
    recipientId: "SeZLuy...sVw51C",
    fee: 0.25
  });
} catch (e) {
  if (e.message.includes("User rejected")) {
    showToast("Signing authorization cancelled by user.");
  } else if (e.message.includes("timeout")) {
    showToast("Request processing threshold timed out.");
  } else {
    console.error("Signature processing failure:", e);
  }
}

```

---

#### 1.8.8. Whitelist Management (Connected Sites)

When a client clicks **Connect** enabling the *Trust this site* toggle option within the connection prompt layout, the request origin domain is added to `chrome.storage.local.authorizedOrigins[]`. Subsequent `getAccount()` calls coming from this origin pass directly through the background service worker fast-track logical routing loop, resolving **instantly with zero UI rendering overhead** via the `chrome.storage.local.sthActiveAddress` cache.

**User Experience Controls:** Clicking the dedicated Key status icon located inside the TopBar (positioned natively between the LanguageDropdown and Settings configuration gear elements) routes the interface directly onto `/connected-sites`. This panel lists all whitelist domains, allowing users to instantly strip application permissions via the Disconnect interaction button.

**Developer Programmatic Auditing** (Debug Environment):

```js
// Audit current authorized whitelist state keys:
chrome.storage.local.get("authorizedOrigins", console.log);

// Nuclear reset - forces the system to re-request explicit permissions:
chrome.storage.local.set({ authorizedOrigins: [] });

// Access current tracking active address context:
chrome.storage.local.get("sthActiveAddress", console.log);

```

---

#### 1.8.9. Provider Chain Architecture Pipeline

Complete end-to-end dApp request transmission flow:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  dApp page (MAIN world context)                                         │
│  await window.smartholdem.sendTransaction({...})                        │
│                                                                         │
│  ▼  postMessage({ source: "smartholdem-dapp", id, method, params })     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  bridge.js  (ISOLATED content-script world context)                     │
│                                                                         │
│  chrome.runtime.sendMessage({ type: "smartholdem:request",              │
│                              payload: { id, method, params, origin } }, │
│                              callback)                                  │
│  ▼  Active callback hook holds channel open, waiting for resolution     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  background.ts  (Service Worker / Firefox Background Script Context)    │
│                                                                         │
│  pendingRequests.set(id, { sendResponse, ... })                         │
│  return true  // Keeps async channel open - 120s safety timeout triggers │
│                                                                         │
│  ▼  Whitelist fast-path triggered for getAccount → resolve()            │
│  ▼  Else (Standard UI Fallback):                                        │
│      runtime.sendMessage({ type: "smartholdem:dispatch", payload })     │
│      openWalletSurface() // Mounts interface wrapper                    │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Extension UI Layer (Vue 3 App - Side Panel / Popup Context)            │
│                                                                         │
│  main.ts → applyIntent() → intent.setSign/setConnect()                  │
│  ▼  AuthorizeTx / AuthorizeConnect / Swap.vue modules mount             │
│  ▼  User submits confirming PIN or Connect transaction validation        │
│                                                                         │
│  chrome.runtime.sendMessage({                                           │
│    type: "UI_AUTHORIZE_COMPLETE",                                       │
│    requestId, approved, payload?, error?                                │
│  })                                                                     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  background.ts: resolvePending(id, payload)                             │
│  ▼  sendResponse({ id, result }) ← Resolves original bridge.js callback  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  bridge.js: postMessage(window, { source: "smartholdem-wallet",         │
│                                   id, result, error })                  │
│  ▼                                                                      │
│  dApp's pending Promise completes (resolves/rejects)                    │
└─────────────────────────────────────────────────────────────────────────┘

```

Core Architectural Invariants:

* The async transport channel **explicitly stays alive** using an asynchronous `sendResponse` pattern invoked via a `return true` declaration in the listener block.
* A 120-second hardware safety-timeout terminates zombie processes, returning a strict `request timeout` rejection to the host dApp.
* Whitelist fast-path resolutions for `getAccount` execute even when the physical extension side-panel interface is completely closed (verifying authorization directly against `chrome.storage.local`).
* Trusted request origins are securely tunneled to the UI presentation engine using explicit `params.origin` payloads, rendering localized interface alerts like `[domain.name] is requesting your signature.`

---

#### 1.8.10. Production Dev-Preview Environment Simulators (Standalone Testing)

When running the application suite under local development configurations (`yarn start` binding onto localhost:3000), `window.smartholdem` extension injections are omitted due to missing content scripts. The mocking engine exposes alternative framework testing injection hooks:

```js
// Instantly mount the AuthorizeConnect interface view mockup
window.__sthDevConnect({ origin: "https://playpoker.pro" });

// Instantly mount the AuthorizeTx interface layout under SIGN ONLY settings
window.__sthDevSignTx({
  recipient: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  amount: 5,
  vendorField: "poker:room42",
  origin: "https://playpoker.pro"
});

// Instantly mount the AuthorizeTx interface layout under SIGN + BROADCAST settings
window.__sthDevSendTx({
  recipient: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  amount: 5,
  vendorField: "poker:room42",
  origin: "https://playpoker.pro"
});

// Deep-link directly into the Swap Hub panel featuring fully pre-populated inputs
window.__sthDevDeepLink({
  direction: "USDT_TO_STH",
  amount: 42,
  origin: "https://playpoker.pro"
});

```

*Note: These debugging tools are bound exclusively to development preview configurations and are automatically stripped out from production `.crx`/`.zip` build distributions.*

---

## 2. Technical Documentation – Build & Deployment Specifications

### 2.1. Environment Pre-requisites

* Node.js version 18+ paired with Yarn 1.22+ deployment tooling.
* Chrome Browser 117+ (Mandatory for native Side Panel MV3 API compatibility layer execution).

### 2.2. Running Local Dev-Preview

```bash
cd /app/frontend
yarn install
yarn start
# → Local server launches at: http://localhost:3000

```

The interface rendering pipeline wraps the UI layers inside a centered mock viewport boundary template (400×720 px), simulating active Side Panel screen space footprints.

### 2.3. Compiling Production Chrome Extensions

```bash
cd /app/frontend
yarn build:extension
# Compiled build assets drop into: apps/extension/dist/

```

Output manifest composition inside `apps/extension/dist/`:

* `manifest.json` (Strict MV3 execution configurations).
* `popup.html` (The primary entry point interface module mapping to the Chrome Side Panel view).
* `background.js` (Core isolated Service Worker backend execution layer).
* `inject.js` (MAIN world content script injecting the `window.smartholdem` provider api).
* `bridge.js` (ISOLATED world content script serving as secure transport bridge to background processes).
* `icons/*.png` (Application graphics pack asset bundle).
* `assets/*.js`, `assets/*.css` (Minimized deployment runtime bundles).

### 2.4. Production Installation (Chrome Deployment)

1. Point your browser URL interface to: `chrome://extensions`
2. Toggle the **Developer mode** control switch position located inside the upper-right dashboard region.
3. Select the **Load unpacked** action button -> target your local file directory directly onto `/app/frontend/apps/extension/dist`.
4. Pin the newly initialized SmartHoldem tool icon explicitly onto your browser taskbar.
5. Triggering a click interaction onto the taskbar button automatically spawns the Chrome Side Panel interface.

### 2.5. Comprehensive Ecosystem Provider Auditing

Review the operational specifications mapped inside the **1.8.10. Production Dev-Preview Environment Simulators** section listed above to explore the full matrix of `window.__sthDev*` helper hooks.

End-to-end integration verification with a fully active, real-world native injection context requires loading the raw extension unpack directory inside a valid browser instance (Following the exact steps outlined in Section 2.4). Once complete, connect to any target testing host domain web asset -> Open your browser DevTools console workspace -> Execute the standard verification scenario script documented in section **1.8.6**.

---

## 3. Cryptographic Security Standards

### 3.1. Local Storage Encryption Model

* Seed phrases and private key mnemonics are **never** stored in plaintext format.
* `chrome.storage.local` write targets (And standard `localStorage` definitions inside development previews) are restricted to securely encrypted AES cipher text streams.
* The underlying AES encryption key is dynamically derived using a custom cryptographic combination formula: `PIN + SHA-384(PIN)` (Retaining 100% processing compatibility with wallet-pro).
* Decrypted cleartext seed strings survive exclusively within memory variables bounded to the volatile `auth._pin` storage state, explicitly protected against local disk persistence routines.

### 3.2. PIN Access Control Restrictions

* Protected using a 6-digit access numeric scheme; an independent SHA-384 verification hash is generated and verified inside `settings.pinHash` to validate inputs without exposing decryption pipelines.
* Cold startup cycles flush session memory, forcing the application state into locked positions that require a complete unlock via the Gatekeeper module.

### 3.3. Backup Archive Encoding Strategy (`.sth` Vault Composition)

* Driven via a PBKDF2-SHA256 derivation engine executing exactly 25,000 computation passes, bound against a static hardware salt string value: `smartholdem-oxid-vault-v1-salt`.
* Symmetric cipher encryption maps to AES-256-CBC architecture with embedded PKCS7 padding constraints paired with random 16-byte initialization vector parameters.
* Vault serialization signature metadata schema layout:
```json
{
  "magic": "STH_OXID_VAULT",
  "version": 1,
  "createdAt": <timestamp_ms>,
  "appVersion": "1.4.6",
  "v": 1, 
  "iv": "<hex_string_initialization_vector>", 
  "ct": "<base64_encoded_cipher_text>"
}

```



### 3.4. Content Security Policy & Context Isolation

* The production `manifest.json` completely drops permission options for raw inline script executions while strictly limiting data request actions (`connect-src`) to authorized server nodes: `*.smartholdem.io`, `exchange.smartholdem.io`, `*.sth.cx`, `smartholder.xbts.io`.
* The `bridge.js` worker isolation strategy executes operations exclusively within the isolated browser script context space, providing a single guarded gateway channel bridging dApp interfaces and background service workers.
* Cryptographic code execution requests require human authorization via an explicit click interaction targeting the "Confirm with PIN" control overlay present inside the **Authorize Transaction** component layout - completely preventing dark/silent transaction signing vectors.

### 3.5. Resilient Network Communications Transport

* Outbound REST endpoint requests execute via specialized axios configurations using explicit status filtering metrics: `validateStatus: s < 500`. This structure drops default console error stack tracing loops, explicitly protecting user addresses and identities from leaking into public system crash network logs.
* Features a failover-pool deployment monitoring 7 independent network nodes, automatically re-routing node pools on-the-fly based on real-time ping metrics (`updateNodes`).

---

## 4. Architectural Invariants: Why Core Leads the SmartHoldem Ecosystem

1. **Industrial-Grade Brutalist Design Aesthetics:** Rejects generic interface templates. Custom layout engineering built completely around specialized color variables: Gunmetal #121315, Rust Orange #E25822, Volt Cyan #06B6D4, and JetBrains Mono fonts optimizing tabular numeric data arrays and address string presentations. Real-time layout skinning updates instantly via clean root CSS variable injection schemes.
2. **Side Panel Native Architecture Strategy:** Unlike typical browser popups that flush internal states and drop sessions when losing target focus or changing browser tabs, Core Wallet lives inside a native persistent sidebar container. This structure preserves transactional context across intense web-poker tournaments and complex dApp sessions.
3. **Perfect Operational parity with wallet-pro:** Integrates identical cryptographic functions, matching transmission payload formats, and shared swap gate logic profiles. Move profiles across runtime applications with zero address mismatch risks.
4. **Hierarchical Deterministic (HD) Multi-Accounts & Custom Tagging:** Derive infinite distinct address keys from a single master backup seed. Organize allocations using distinct local aliases like "Poker Bankroll", "Cold Storage", or "Daily Spend" - fully preserved inside your encrypted backup archives.
5. **Native Embedded Bridge Swap Functionality:** Avoid shifting between separate browser portals to handle exchange transactions. Execute automated Buy/Sell operations directly using unique per-account BEP20 deposit endpoints, automated slippage protections, and automated verification confirmation polling hooks.
6. **Encrypted Security Backups via `.sth` Vault Files:** Extract your entire configuration footprint (Master seed strings, account index trees, application settings, node latency metrics, and verification PIN signatures) into a highly compressed, encrypted deployment module backed by Smart2FA standard security protocols.
7. **Unified Web3 Engine Matrix for the SmartHoldem Space:** Exposes clean standardized interfaces: `window.smartholdem.signMessage`, `requestSwap`, and `signTransaction`. This design offers developer-ready integration paths for cardrooms, digital casinos, decentralized exchanges, and custom on-chain projects across the SmartHoldem grid.

---

## 5. Engineering Roadmap & UX/UI Enhancements

1. **Automated Incoming Transaction Notifications:** Interfacing with the native Chrome Notifications API to trigger background desktop alerts upon capturing incoming ledger credits (Requires structural addition of the `notifications` permission manifest flag).
2. **Local Address Book and Tagging Engine:** Introducing an address dictionary module featuring instant key searching and custom classification tags - optimized to manage frequent cardroom transfer endpoints.
3. **Privacy Masking UI Layer:** Implementing a touch/swipe gesture shortcut over the primary balance view module to instantly mask currency balances while accessing public environments.
4. **Biometric Security Integration:** Accessing device-level authentication modules via WebAuthn API wrappers to provide immediate TouchID or Windows Hello biometric unlock options, keeping secure PIN signatures as a structural fallback layer.
5. **Ecosystem Language Extension Packs:** Expanding the multi-language localization framework (`src/locales/index.ts`) beyond core EN, RU, ZH, and ES dictionaries to include comprehensive global translation modules via automated `vue-i18n` configurations.
6. **Visual Identity Badging per Account View:** Adding unique color indicators and personalized emblem indicators to individual records inside the `AccountSwitcher` components to visually separate "Bankroll", "Cold Storage", and "Faucet" setups.
7. **Four-Step Guided Onboarding Flow:** Constructing a smooth introduction sequence for first-time deployments: Welcome Dashboard Overview → Mnemonic Generation Audit → Security PIN Signature Lock → Primary Receive Verification displaying an actionable "Fund Your Wallet with a Test-STH" invitation.
8. **Bridge Exchange Arrival Metric Calculators:** Integrating diagnostic metric routines to track median liquidity pool settlement times on `trade.xbts.io`, calculating live estimated arrival metrics for cross-chain swaps.
9. **Dashboard Analytic Data Visualization Sparklines:** Injecting minimal 24-hour historical market trend line charts for STH/USDT inside the main top balance presentation panel.
 

---

## Version History Log

* **v1.0.0** – Minimal Viable Product: Core onboarding architecture initialization, basic Dashboard assembly, paired with standard Send / Receive / History ledger displays and Settings panels.
* **v1.1.0** – HD Multi-Account tree integration, multi-skin theme color engine implementation (Rust/Cyan), and background fiat market valuation translation modules.
* **v1.2.0** – Native Swap Hub launch, inline account alias renaming features, and unified workspace layout docking configurations via BottomDock.
* **v1.3.0** – dApp external deep-linking pipeline launch (`requestSwap`), encrypted `.sth`-vault export/import capabilities, optimized per-address historical caching, and automated status polling loops.
* **v1.4.0** – Full alignment of Buy/Sell BEP20 logic routes with wallet-pro, deployment of the programmatic `signTransaction` web3 provider layer, and the rollout of the fully managed AuthorizeTx overlay layout.
* **v1.4.6** – Standalone **smartoshi** subunit injection across all code layers, full integration of the Chinese (`zh`) and Spanish (`es`) translation files, launch of the **Industrial Light** CSS design system layout, and cross-platform Node.js `archiver` pipeline implementation for automated Firefox MV3 Popup fallback `.zip` compiling.
* **v1.4.7** – **Progressive Web Application (PWA) Deployment Package:** Compiling the underlying Vue application architecture into an optimized, platform-agnostic PWA wrapper to provide compatibility layers for systems missing Chrome engine capabilities (e.g., Safari on iOS).

---

### Build Architecture:
- Framework: Vue 3
- Bundler: Vite / Rollup
- Environment: Node.js (v22/v24+)
- Commandline: PowerShell or Linux terminal

### Step-by-Step Instructions to Reproduce the Build:
1. Clone the repository https://github.com/smartholdem/Core-Wallet or extract the provided source code archive.
2. Ensure you are using Node.js (LTS version recommended).
3. Run `yarn install` to install the exact vendor dependencies, including core cryptographic modules (secp256k1, bip39).
4. Run the production build command: `yarn build:firefox`.
5. The compiled extension assets and production manifest file will be generated locally in the output directory (`/dist` and`/app`).

### Troubleshooting & Build:
If you encounter a Vite caching or HTML proxy compilation error during the build process (such as `[vite:html-inline-proxy] No matching HTML proxy module found`), please apply the following standard Vite resolution steps:
1. Completely clear the local dependency and optimizer cache by running: `rm -rf node_modules/.vite` (or delete the `.vite` folder inside `node_modules`).
2. Clean any residual build artifacts: `rm -rf dist build`
3. Re-run the clean installation and build cycle: `yarn install && yarn build` (or `npm install && npm run build`).
   This resolves any stale dependency cache conflicts between environment setups.

---

## 📄 Licenses & Third-Party Notices

**Licence**: MIT - feel free to fork.

**Authors**: TechnoL0g & SmartHoldem Foundation.

SmartHoldem Wallet is open-source software. This project includes and bundles the following open-source fonts embedded locally for offline execution, performance, and user privacy:

* **Inter Font Family**
    * **Author:** Rasmus Andersson Suite
    * **License:** [SIL Open Font License, Version 1.1](https://openfontlicense.org)
    * **Usage:** Embedded locally in `src/assets/fonts/` for primary interface typography.

* **JetBrains Mono**
    * **Author:** JetBrains s.r.o.
    * **License:** [SIL Open Font License, Version 1.1](https://openfontlicense.org)
    * **Usage:** Embedded locally in `src/assets/fonts/` for cryptographic data, addresses, and monospace console elements.
    
