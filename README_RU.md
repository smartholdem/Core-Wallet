# SmartHoldem Wallet - Forge Edition

> **Промышленный криптокошелёк для SmartHoldem (STH)** на базе Chrome MV3 Side Panel.  
> Vite + Vue 3 + Pinia + Tailwind. Логика портирована из официального [wallet-pro](https://github.com/smartholdem/wallet-pro).

---

## 1. Возможности кошелька

### 1.1. Управление аккаунтами (Vault)
- **Создание кошелька** - генерация 12-словной BIP-39 мнемоники, экран сохранения seed с подтверждением осведомлённости, 6-значный PIN.
- **Восстановление из seed** - вставка мнемоники / приватного ключа, проверка через `Identities.Address.validate(addr, 63)`.
- **Импорт зашифрованного `.sth`-бэкапа** - прямо из экрана Welcome или Settings.
- **HD-мультиаккаунты** - путь BIP-44 `m/44'/111'/account'/0/0` через `@scure/bip32`. Account #0 совместим с passphrase-derivation wallet-pro.
- **Переключатель аккаунтов** (`AccountSwitcher`) с балансами в реальном времени, копированием адреса и inline-переименованием (например, «Account 2» → «Poker Bankroll»).
- **PIN-локбокс** (Gatekeeper) с подсветкой dots, анимацией Scan-line и брутальным numeric keypad.

### 1.2. Dashboard (Vault)
- Верхний бар: статус сети, копируемый адрес, ⚙ Settings, 🔒 Lock.
- Карточка балансa: STH (JetBrains Mono 34px), USDT-эквивалент через XBTS DEX прослойку, текущий курс.
- 4 быстрых действия: **Send · Receive · Swap · History**.
- Лента последних 3 транзакций - кликабельные ссылки на `explorer.smartholdem.io`.

### 1.3. Transfer (Cipher)
- Проверка получателя через base58check + version-byte 63 (network mainnet).
- Поле **MEMO / VendorField** до 64 символов.
- Фиксированная комиссия **0.25 STH**.
- Кнопка **Hold to Sign & Broadcast** - защита от случайных отправок.

### 1.4. Receive (Mint)
- QR-код адреса (cyan corner markers, JetBrains Mono).
- Tap-to-Copy с уведомлением «Address Secured».

### 1.5. Swap Hub (Exchange · Forge)
- Две вкладки **Buy STH / Sell STH** под точную копию `ExchangeModal.vue` из wallet-pro.
- **Buy STH**:
  - Пользователь указывает желаемое количество STH.
  - Расчёт «To pay» (USDT), «You will receive», «Min. guaranteed» (минус 5% slippage).
  - Уникальный депозитный адрес BSC/BEP20 для активного аккаунта (`getBscDepositAddress`), кэшируется per-address, обновляется при смене аккаунта.
  - Предупреждение «Minimum deposit: 5.00 USDT (BEP20)».
  - Кнопка **«I have paid»** (внешний перевод).
- **Sell STH**:
  - Валидация BEP20-адреса.
  - Проверка минимума 5 USDT перед исполнением.
  - **Hold to Sell** строит v2-транзакцию с BEP20-адресом в vendorField, подписывает Schnorr-ом и публикует.
  - Polling статуса ордера каждые 10 сек × 30 (5 мин), помечает транзакцию «Bridge Confirmed».

### 1.6. History (Ledger)
- Полный список транзакций активного аккаунта.
- Кэш per-address (`historyCache`), мгновенное переключение без re-fetch-флэшей.

### 1.7. Settings (Core)
- **Appearance**: два theme-toggle - `RUST CLASSIC` (по умолчанию, #E25822) и `CYAN STEEL` (#4F46E5 + #06B6D4). Реализовано через CSS-переменные `[data-theme="…"]`.
- **Security**: View Seed / Private Key с обязательным повторным вводом PIN.
- **Backup · Encrypted Vault**: экспорт состояния в `.sth`-файл (PBKDF2-SHA256 25k → AES-256-CBC PKCS7 + random IV) и drag-and-drop импорт.
- **Mainnet Node Pool**: 7 нод с измерением латентности, авто-выбор самой быстрой.
- **Wipe Secure Storage** - двухступенчатое подтверждение в Rust Orange.

### 1.8. Web3 Provider (для dApp-разработчиков)

Расширение инжектирует объект **`window.smartholdem`** в каждую страницу через `inject.js` (MAIN world content script). Все методы возвращают `Promise` и проходят через цепочку **page → bridge.js (ISOLATED) → background SW → side-panel UI**, где пользователь подтверждает или отклоняет запрос. Канал держится открытым до взаимодействия пользователя (асинхронный `sendResponse`, таймаут безопасности 120 с).

#### Базовые свойства

| Свойство | Значение | Описание |
|---|---|---|
| `window.smartholdem.isSmartHoldem` | `true` | Признак наличия SmartHoldem Wallet |
| `window.smartholdem.version` | `"1.3.0"` | Версия injected-провайдера |
| `window.smartholdem.network` | `"mainnet"` | Целевая сеть |

#### Событие готовности

```js
window.addEventListener("smartholdem#initialized", () => {
  console.log("SmartHoldem Wallet detected:", window.smartholdem.version);
});
// Или короткая проверка:
if (window.smartholdem?.isSmartHoldem) { /* ... */ }
```

---

#### 1.8.1. `getAccount()` - запрос активного адреса

Эквивалент `sth_requestAccounts`. При первом вызове откроется модал **Connection Request** в side-panel; если пользователь нажмёт **Connect** с галочкой *Trust this site*, origin запишется в `chrome.storage.local.authorizedOrigins` и последующие вызовы будут резолвиться **мгновенно без UI**.

**Параметры:** нет
**Резолв:** `{ address: string }`
**Ошибки:** `"User rejected the connection."` / `"smartholdem: request timeout"`

```js
// Подключение к кошельку
const { address } = await window.smartholdem.getAccount();
console.log("Active STH address:", address);
// → "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C"
```

Список доверенных сайтов пользователь видит и отзывает в кошельке: **TopBar Key icon → ACCESS · CONNECTED APPS**.

---

#### 1.8.2. `signMessage(message)` - Schnorr-подпись произвольного текста

**Параметры:** `message: string`
**Резолв:** `{ address, publicKey, hash, message, signature }`

```js
const res = await window.smartholdem.signMessage("Hello, SmartHoldem!");
console.log(res);
// {
//   address:   "SeZLuy...sVw51C",
//   publicKey: "02a1b2...",
//   hash:      "9b74c9...",   // sha256(message), hex
//   message:   "Hello, SmartHoldem!",
//   signature: "30440220..."  // Schnorr DER, hex
// }
```

Использование - авторизация в dApp без транзакции (login-with-wallet).

---

#### 1.8.3. `signTransaction(payload)` - подпись v2-перевода

Открывает оверлей **Authorize Transaction** с превью получателя/суммы/комиссии. Пользователь подтверждает PIN-ом.

**Параметры (объект):**

| Поле | Тип | Обязат. | Описание                                                                                                                       |
|---|---|---|--------------------------------------------------------------------------------------------------------------------------------|
| `recipientId` | `string` | ✅ | STH-адрес получателя (34 символа, начинается с `S`). Legacy alias `recipient` тоже принимается.                                |
| `amount` | `number \| string` | ✅ | Сумма в **целых STH** (например `1`, `"0.25"`, `"0.00000001"`). Конвертируется в smartoshi через BigInt - без потери точности. |
| `fee` | `number \| string` | - | Комиссия в STH. По умолчанию `0.25`.                                                                                           |
| `vendorField` | `string` | - | Memo. Максимум **255 UTF-8 байт**.                                                                                             |

**Резолв:** `{ id, signature, senderPublicKey, tx, serialized, data }`

| Поле | Описание |
|---|---|
| `id` | Хэш транзакции (txid), hex |
| `signature` | Подпись Schnorr, hex |
| `senderPublicKey` | Публичный ключ отправителя |
| `tx` | JSON формы `toJson()` - для совместимости |
| `serialized` | **Hex-строка готовых wire-байтов**. Используйте её для broadcast - никакой ре-сериализации, никаких рисков несоответствия `configManager`. |
| `data` | Полный data-объект с `network: 63`, `typeGroup: 1`, `nonce`, etc. (self-describing) |

```js
// Простейший перевод
const result = await window.smartholdem.signTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25
});

// 🟢 РЕКОМЕНДУЕМЫЙ способ broadcast - отправить готовые байты:
fetch("https://node.smartholdem.io/api/transactions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transactions: [result.serialized] })
});

// 🟡 Альтернатива - JSON-broadcast (требует совместимую ноду):
fetch("https://node.smartholdem.io/api/transactions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transactions: [result.data] })
});
```

С memo:
```js
await window.smartholdem.signTransaction({
  amount: "5.5",
  recipientId: "SeZL...",
  fee: 0.25,
  vendorField: "poker:room42:buyin"
});
```

---

#### 1.8.4. `sendTransaction(payload)` - sign + broadcast в один клик

**Главное преимущество**: пользователь вводит PIN **один раз**. Кошелёк подписывает транзакцию И сразу же отправляет её в сеть на активную mainnet-ноду. dApp получает обратно полный response сети.

**Параметры**: те же что у `signTransaction` (`recipientId`, `amount`, `fee?`, `vendorField?`).

**Резолв**: всё что возвращает `signTransaction`, **плюс** `broadcast` - ответ ноды:

```ts
{
  id: "fd9109...",
  signature: "30...",
  senderPublicKey: "02...",
  tx: { /* signed JSON */ },
  serialized: "ff023f01...",       // canonical wire bytes (hex)
  data: { /* full data w/ network=63, typeGroup=1 */ },
  broadcast: {                      // ← ответ ноды POST /api/transactions
    accept:    ["fd9109..."],       // tx-id'ы принятые в mempool
    broadcast: ["fd9109..."],       // tx-id'ы реально разосланные по peer'ам
    excess:    [],
    invalid:   [],
    errors:    {}                    // per-id error map (при отказе)
  }
}
```

UI отличается: модал теперь называется **AUTHORIZE · SIGN & BROADCAST**, есть строка `BROADCAST TO node4.smartholdem.io` (показывает целевую ноду), кнопка-CTA: **`Confirm, Sign & Broadcast`**. После ввода PIN появляется spinner `broadcasting to mainnet…`, затем Promise резолвится.

```js
// Один шаг, один PIN - транзакция уже в сети:
const r = await window.smartholdem.sendTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25,
  vendorField: "poker:room42:buyin"
});

console.log("Tx ID:",   r.id);
console.log("Accepted:", r.broadcast.accept);   // → [<tx-id>]
console.log("Errors:",   r.broadcast.errors);   // → {} при успехе
```

**Когда использовать `sendTransaction` vs `signTransaction`?**

| Метод | UX | Когда выбрать |
|---|---|---|
| `signTransaction` | возвращает подпись, dApp сам бродкастит | dApp хочет реле через свой бэкенд / нестандартный node / pre-flight симуляция |
| `sendTransaction` | один клик, broadcast встроен | большинство сценариев (платежи, in-game tx, переводы) |

**Edge cases** обрабатываются прозрачно:
- Sign падает (битый recipient) → Promise rejects, broadcast не выполняется
- Sign OK, но broadcast 4xx/5xx/timeout → Promise rejects, **но** в error-payload приходят `id/serialized/data` - dApp может ретраить broadcast самостоятельно **без повторного PIN**
- Sign OK, node вернул `invalid` → Promise resolves (транспорт принял), dApp инспектирует `broadcast.invalid` / `broadcast.errors`
- Пользователь нажал ✕ во время broadcast → кнопка disabled, нельзя прерывать in-flight POST

---

#### 1.8.5. `requestSwap({ amount, direction, destination })` - deep-link в Swap Hub

Открывает Swap Hub в кошельке с предзаполненными полями. Подтверждение свапа происходит обычной формой - отдельного callback'а нет (UX-flow, не транзакция).

**Параметры:**

| Поле | Тип | Описание |
|---|---|---|
| `amount` | `number \| string` | Сумма к обмену |
| `direction` | `"STH_TO_USDT" \| "USDT_TO_STH"` | Направление |
| `destination` | `string` | **Только для STH→USDT** - внешний BEP-20 USDT-адрес получателя. Для USDT→STH игнорируется. |

```js
// dApp хочет обменять USDT → STH
window.smartholdem.requestSwap({
  direction: "USDT_TO_STH",
  amount: 42
});

// dApp выводит STH в USDT на BSC
window.smartholdem.requestSwap({
  direction: "STH_TO_USDT",
  amount: 1000,
  destination: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
});
```

---

#### 1.8.6. Полный сценарий тестирования в DevTools Console

Открой любой сайт → DevTools → Console → выполни по очереди:

```js
// 1. Проверка наличия провайдера
console.log("Wallet detected:", !!window.smartholdem?.isSmartHoldem);
console.log("Version:", window.smartholdem.version);

// 2. Запрос аккаунта (откроется side-panel "Connection Request")
const acc = await window.smartholdem.getAccount();
console.log("Connected as:", acc.address);

// 3. Повторный запрос - резолвится мгновенно (whitelist fast-path)
console.time("re-connect");
await window.smartholdem.getAccount();
console.timeEnd("re-connect");   // обычно <5 ms

// 4. Подпись текстового сообщения (login-with-wallet)
const msg = await window.smartholdem.signMessage("auth-nonce-" + Date.now());
console.log("Signature:", msg.signature);
console.log("PublicKey:", msg.publicKey);

// 5a. signTransaction - подписать БЕЗ broadcast (dApp бродкастит сам)
const signed = await window.smartholdem.signTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25,
  vendorField: "signed-only from " + location.host
});
console.log("Signed tx id:", signed.id);
console.log("Serialized hex:", signed.serialized);

// 6a. Manual broadcast (если использовался signTransaction)
const manual = await fetch("https://node.smartholdem.io/api/transactions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transactions: [signed.tx] })
}).then(r => r.json());
console.log("Manual broadcast:", manual);

// 5b. sendTransaction - sign + broadcast в один клик (рекомендуется)
const sent = await window.smartholdem.sendTransaction({
  amount: 1,
  recipientId: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  fee: 0.25,
  vendorField: "one-shot from " + location.host
});
console.log("Tx id:",    sent.id);
console.log("Accepted:", sent.broadcast.accept);
console.log("Errors:",   sent.broadcast.errors);

// 7. Deep-link в Swap Hub
window.smartholdem.requestSwap({
  direction: "STH_TO_USDT",
  amount: 100,
  destination: "0x000000000000000000000000000000000000dEaD"
});
```

---

#### 1.8.7. Обработка ошибок

Каждый метод может reject'нуться. Стандартные причины:

| Сообщение | Когда |
|---|---|
| `User rejected the connection.` | Юзер нажал Reject в `getAccount` модале |
| `User rejected the transaction.` | Юзер нажал Reject / закрыл `signTransaction` |
| `smartholdem: request timeout` | Юзер не отреагировал за 120 с |
| `Wallet is locked` | Кошелёк залочен и PIN не введён |
| `signTransaction: invalid STH address \`...\`` | `recipientId` не прошёл валидацию (длина 34, prefix `S`) |
| `signTransaction: vendorField exceeds 255 bytes` | Memo слишком длинный |
| `signTransaction: missing \`recipientId\`` | Не передан адрес |

Образец:
```js
try {
  const tx = await window.smartholdem.signTransaction({
    amount: 1,
    recipientId: "SeZLuy...sVw51C",
    fee: 0.25
  });
} catch (e) {
  if (e.message.includes("User rejected")) {
    showToast("Подписание отменено");
  } else if (e.message.includes("timeout")) {
    showToast("Время ожидания истекло");
  } else {
    console.error("Sign failed:", e);
  }
}
```

---

#### 1.8.8. Управление доверенными dApp'ами (Connected Sites)

После того как пользователь нажимает **Connect** с галочкой *Trust this site* в модале AuthorizeConnect, origin записывается в `chrome.storage.local.authorizedOrigins[]`. Все последующие вызовы `getAccount()` от этого origin резолвятся **мгновенно без UI** (быстрая ветка в `background.ts` через `chrome.storage.local.sthActiveAddress` кеш).

**Пользовательский UI**: клик по key-иконке в TopBar (между LanguageDropdown и Settings gear) → `/connected-sites` → видишь список всех доверенных доменов с возможностью каждый отзывать кнопкой Disconnect.

**Программный доступ для dApp-разработчиков** (debug):
```js
// Просмотр текущего whitelist:
chrome.storage.local.get("authorizedOrigins", console.log);

// Сброс - пользователю придётся заново разрешать подключение:
chrome.storage.local.set({ authorizedOrigins: [] });

// Активный адрес (mirror, обновляется при unlock'е):
chrome.storage.local.get("sthActiveAddress", console.log);
```

---

#### 1.8.9. Архитектура provider-chain

Полный путь dApp-запроса:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  dApp page (MAIN world)                                                 │
│  await window.smartholdem.sendTransaction({...})                        │
│                                                                         │
│  ▼  postMessage({ source: "smartholdem-dapp", id, method, params })     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  bridge.js  (ISOLATED content-script world)                             │
│                                                                         │
│  chrome.runtime.sendMessage({ type: "smartholdem:request",              │
│                              payload: { id, method, params, origin } }, │
│                              callback)                                  │
│  ▼  callback ← остаётся живой, ждёт ответа                              │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  background.ts  (service worker / Firefox background.scripts)           │
│                                                                         │
│  pendingRequests.set(id, { sendResponse, ... })                         │
│  return true  // keep channel open - 120s safety timeout                │
│                                                                         │
│  ▼  whitelist fast-path для getAccount → resolve()                      │
│  ▼  иначе:                                                              │
│      runtime.sendMessage({ type: "smartholdem:dispatch", payload })     │
│      openWalletSurface()                                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Side panel / popup / sidebar UI  (Vue 3 app)                           │
│                                                                         │
│  main.ts → applyIntent() → intent.setSign/setConnect()                  │
│  ▼  AuthorizeTx / AuthorizeConnect / Swap.vue mounts                    │
│  ▼  Пользователь вводит PIN или Connect                                 │
│                                                                         │
│  chrome.runtime.sendMessage({                                           │
│    type: "UI_AUTHORIZE_COMPLETE",                                       │
│    requestId, approved, payload?, error?                                │
│  })                                                                     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  background.ts: resolvePending(id, payload)                             │
│  ▼  sendResponse({ id, result }) ← бывший callback'у bridge.js          │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  bridge.js: postMessage(window, { source: "smartholdem-wallet",         │
│                                   id, result, error })                  │
│  ▼                                                                      │
│  dApp's pending Promise resolves/rejects                                │
└─────────────────────────────────────────────────────────────────────────┘
```

Ключевые гарантии:
- Канал **остаётся открытым** до взаимодействия пользователя (асинхронный `sendResponse` через `return true`)
- 120-секундный safety-timeout - если пользователь не ответит, dApp получит `request timeout`
- Whitelist fast-path для `getAccount` работает даже если side-panel закрыт (читается из `chrome.storage.local`)
- Origin доходит до UI через `params.origin` - модал показывает `[domain.name] is requesting your signature.`

---

#### 1.8.10. Симуляторы для dev-preview (без установки расширения)

В режиме `yarn start` (localhost:3000) `window.smartholdem` **не** инжектирован (нет content_scripts). Вместо этого UI кошелька предоставляет:

```js
// Открыть AuthorizeConnect модал
window.__sthDevConnect({ origin: "https://poker.smartholdem.io" });

// Открыть AuthorizeTx модал в режиме SIGN ONLY
window.__sthDevSignTx({
  recipient: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  amount: 5,
  vendorField: "poker:room42",
  origin: "https://playpoker.pro"
});

// Открыть AuthorizeTx модал в режиме SIGN + BROADCAST
window.__sthDevSendTx({
  recipient: "SeZLuyhhYf2qxs4ArPJ71oEu3x8EsVw51C",
  amount: 5,
  vendorField: "poker:room42",
  origin: "https://playpoker.pro"
});

// Открыть Swap Hub с предзаполненными полями
window.__sthDevDeepLink({
  direction: "USDT_TO_STH",
  amount: 42,
  origin: "https://poker.smartholdem.io"
});
```

Эти хелперы доступны **только** в собранном dev-preview, не в продакшен `.crx`/`.zip`.

---

## 2. Техническая документация - сборка и локальный запуск

### 2.1. Требования
- Node.js 18+, Yarn 1.22+
- Chrome 117+ (для Side Panel API)

### 2.2. Локальный preview (dev-режим)
```bash
cd /app/frontend
yarn install
yarn start
# → открыть http://localhost:3000
```
UI рендерится внутри центрированной mockup-рамки 400×720 px, имитирующей Side Panel.

### 2.3. Сборка Chrome-расширения
```bash
cd /app/frontend
yarn build:extension
# Артефакты: apps/extension/dist/
```
Содержимое `apps/extension/dist/`:
- `manifest.json` (MV3)
- `popup.html` (точка входа Side Panel)
- `background.js` (service worker)
- `inject.js` (MAIN world content script, провайдер `window.smartholdem`)
- `bridge.js` (ISOLATED world content script, мост к background)
- `icons/*.png`
- `assets/*.js`, `assets/*.css`

### 2.4. Установка в Chrome
1. `chrome://extensions` → переключите «Developer mode» в правом верхнем углу.
2. **Load unpacked** → выбрать `/app/frontend/apps/extension/dist`.
3. Прикрепите иконку SmartHoldem в toolbar.
4. Клик по иконке → откроется Side Panel.

### 2.5. Локальное тестирование dApp-провайдера

См. секцию **1.8.7. Симуляторы для dev-preview** выше - там полный список `__sthDev*` хелперов с примерами.

Полноценное тестирование с реальным `window.smartholdem` возможно только после установки расширения в Chrome/Firefox (секция 2.4). После установки откройте любой сайт → DevTools → Console → выполните сценарий из **1.8.5**.

---

## 3. Безопасность

### 3.1. Локальное хранение
- Seed-фраза **никогда** не хранится в открытом виде.
- В `chrome.storage.local` (или `localStorage` в dev-preview) лежит только AES-зашифрованный cipher.
- Ключ AES = `PIN + SHA-384(PIN)` (совместимо с wallet-pro).
- Расшифрованная мнемоника живёт только в `auth._pin` в памяти; никогда не персистится.

### 3.2. PIN
- 6 цифр, SHA-384-хэш сохраняется в `settings.pinHash` для верификации без расшифровки.
- На каждый «холодный» старт расширения PIN сбрасывается → требуется разблокировка через Gatekeeper.

### 3.3. Содержимое `.sth`-бэкапа
- PBKDF2-SHA256 × 25 000 итераций, фиксированная соль `smartholdem-oxid-vault-v1-salt`.
- AES-256-CBC с PKCS7-паддингом и случайным 16-байтным IV.
- Bag-формат:
  ```json
  {
    "magic": "STH_OXID_VAULT",
    "version": 1,
    "createdAt": <ms>,
    "appVersion": "1.4.0",
    "v": 1, "iv": "<hex>", "ct": "<base64>"
  }
  ```

### 3.4. CSP / изоляция
- `manifest.json` запрещает inline-скрипты и ограничивает `connect-src` доменами `*.smartholdem.io`, `exchange.smartholdem.io`, `*.sth.cx`, `smartholder.xbts.io`.
- `bridge.js` работает в ISOLATED world и единственная точка обмена сообщениями между dApp-страницей и background SW.
- Любая операция подписи требует явного клика «Confirm with PIN» в оверлее **Authorize Transaction** - нет silent-signing.

### 3.5. Сеть
- Все REST-запросы используют axios `validateStatus: s < 500` чтобы не утечь ошибок в консоль и не светить адресами в network log.
- Failover-pool из 7 нод с активным мониторингом задержек (`updateNodes`).

---

## 4. Почему этот кошелёк - лучший в экосистеме SmartHoldem

1. **Индустриальный дизайн**. Никакого «AI-slop» - Gunmetal #121315, Rust Orange #E25822, Volt Cyan #06B6D4, JetBrains Mono для адресов и балансов. Две темы переключаются мгновенно через CSS-переменные.
2. **Side Panel-first**. В отличие от обычных popup-кошельков, Forge живёт в боковой панели и не сбрасывает state при переключении вкладок - критично для покер-комнат и dApp-сессий.
3. **Полная совместимость с wallet-pro**. Та же криптография, тот же formats, та же логика swap-гейтов - мигрируете с любого устройства без потери адресов.
4. **HD-мультиаккаунты + кастомные метки**. Один seed → бесконечно адресов; назовите их «Poker Bankroll», «Cold Storage», «Daily Spend» - метки сохраняются в зашифрованном бэкапе.
5. **Нативный SWAP внутри кошелька**. Не нужно открывать сторонний сайт - Buy/Sell с per-account BEP20-депозитом, slippage-расчётами, polling-ом подтверждения.
6. **Encrypted `.sth` vault**. Переносите весь кошелёк (seed + аккаунты + темы + ноды + PIN-hash) в один зашифрованный файл - Smart2FA-grade криптография.
7. **Web3 provider для всей экосистемы**. `window.smartholdem.signMessage / requestSwap / signTransaction` - стандартизированный API для покер-комнат, казино, DEX-ов и любых dApp на STH.

---

## 5. Планы по дальнейшему UX/UI улучшению

1. **Push-уведомления** через Chrome Notifications API при входящих переводах (требует `notifications` permission).
2. **Address Book** с поиском и тегами - особенно для частых получателей в покер-комнатах.
3. **«Hide balance»** жест (свайп по балансу) для приватности в публичных местах.
4. **Биометрическая разблокировка** через WebAuthn для устройств с TouchID/Windows Hello - оставляя PIN как fallback.
5. **Локализация**. Сейчас интерфейс EN/RU/ZH/ES-only; добавить остальные языки через `vue-i18n`.
6. **Per-account icon / color** - визуально различать «Bankroll» / «Cold» / «Faucet» в AccountSwitcher.
7. **Onboarding-tour** на 4 шага: приветствие → seed → PIN → первый Receive со скриншотом «отправь себе тест-STH» CTA.
8. **Estimated arrival** для bridge-свопов (вычислить median `trade.xbts.io` liquidity pools).
9. **Dashboard charts** - sparkline STH/USDT за 24h в верхней карточке.
10. **PWA-режим** для пользователей без Chrome (Safari) - переиспользовать ту же кодовую базу.

---

## Версии

- **v1.0.0** - MVP: onboarding + Dashboard + Send / Receive / History / Settings.
- **v1.1.0** - Multi-account (HD) + Theme engine (Rust/Cyan) + контраст fiat.
- **v1.2.0** - Swap Hub + inline rename + unified BottomDock.
- **v1.3.0** - dApp deep-link (`requestSwap`) + `.sth`-vault export/import + per-account tx cache + polling.
- **v1.4.0** - Buy/Sell BEP20 alignment с wallet-pro + `signTransaction` provider + AuthorizeTx overlay.

---

**Licence**: MIT - feel free to fork.  
**Авторы**: TechnoL0g & SmartHoldem Foundation.
