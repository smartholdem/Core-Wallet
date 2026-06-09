<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useWalletStore, STH_FEE } from "@/stores/wallet";
import {
  useExchangeStore,
  SWAP_FEE_PCT,
  SWAP_SLIPPAGE_PCT,
  MIN_SWAP_USDT,
} from "@/stores/exchange";
import { useIntentStore } from "@/stores/intent";
import {
  pushToast,
  formatSth,
  formatUsdt,
  shortAddress,
  copyToClipboard,
} from "@/lib/utils";
import { useT } from "@/locales";
import HoldButton from "@/components/HoldButton.vue";
import BottomDock from "@/components/BottomDock.vue";
import AccountSwitcher from "@/components/AccountSwitcher.vue";

const router = useRouter();
const auth = useAuthStore();
const wallet = useWalletStore();
const exchange = useExchangeStore();
const intent = useIntentStore();
const t = useT();

type Tab = "BUY" | "SELL";
const tab = ref<Tab>("BUY");

const stiAmount = ref("");           // STH amount user types (both tabs)
const bep20Dest = ref("");           // 0x… USDT BEP20 destination (Sell only)
const dappOrigin = ref<string | null>(null);
const sending = ref(false);
const lastTxId = ref<string | null>(null);
const pollTimer = ref<number | null>(null);
const pollAttempts = ref(0);
const refreshing = ref(false);

const dappOriginHost = computed(() => {
  if (!dappOrigin.value) return "";
  try { return new URL(dappOrigin.value).host; } catch { return dappOrigin.value; }
});

async function refreshAll() {
  refreshing.value = true;
  try {
    await Promise.allSettled([
      exchange.refreshDashboardPrice(),
      exchange.checkExchangeBalance(),
      exchange.getSthAddressHot(),
      exchange.getSellGateAddress(),
      auth.address ? wallet.fetchBalance(auth.address) : Promise.resolve(),
      auth.address ? exchange.getBscDepositAddress(auth.address) : Promise.resolve(),
    ]);
  } finally { refreshing.value = false; }
}

function applyIntent() {
  const p = intent.consumeSwap();
  if (!p) return;
  tab.value = p.direction === "USDT_TO_STH" ? "BUY" : "SELL";
  if (p.amount !== undefined && p.amount !== "") stiAmount.value = String(p.amount);
  if (p.destination) bep20Dest.value = p.destination;
  dappOrigin.value = p.origin ?? null;
  let host = "";
  try { if (p.origin) host = new URL(p.origin).host; } catch {}
  pushToast(host ? `Swap requested by ${host}` : "Swap pre-filled by dApp", "info");
}

onMounted(async () => { applyIntent(); await refreshAll(); });
onBeforeUnmount(() => stopPolling());
watch(() => intent.pendingSwap, (v) => { if (v) applyIntent(); });
// Refetch deposit address + balance whenever active account changes.
watch(() => auth.activeIndex, async () => {
  if (!auth.address) return;
  await Promise.allSettled([
    wallet.fetchBalance(auth.address),
    exchange.getBscDepositAddress(auth.address, true),
  ]);
});

// === Economics ===
const stiNum = computed(() => parseFloat(stiAmount.value || "0") || 0);
const rate = computed(() => exchange.sthUsdtPrice || 0);
const exchangeReady = computed(() => exchange.isExchangeAvailable && rate.value > 0);
const sthBalance = computed(() => wallet.activeBalance);

// BUY tab math (user picks STH amount they want to receive)
const buyToPayUsdt = computed(() => stiNum.value * rate.value);                // before fees
const buyReceiveSth = computed(() => stiNum.value * (1 - SWAP_FEE_PCT / 100));
const buyMinGuaranteed = computed(() => buyReceiveSth.value * (1 - SWAP_SLIPPAGE_PCT / 100));
const buyBep20Address = computed(
  () => exchange.bscDepositCache[auth.address]?.address ?? ""
);
const buyMeetsMin = computed(() => buyToPayUsdt.value >= MIN_SWAP_USDT);

// SELL tab math (user picks STH amount to sell)
const sellReceiveUsdt = computed(() => stiNum.value * rate.value * (1 - SWAP_FEE_PCT / 100));
const sellMinGuaranteed = computed(() => sellReceiveUsdt.value * (1 - SWAP_SLIPPAGE_PCT / 100));
const sellOverdraft = computed(() => stiNum.value + STH_FEE > sthBalance.value);
const bep20Valid = computed(() => /^0x[a-fA-F0-9]{40}$/.test(bep20Dest.value.trim()));
const sellMeetsMin = computed(() => sellReceiveUsdt.value >= MIN_SWAP_USDT);
const sellCanSubmit = computed(
  () =>
    exchangeReady.value &&
    !sending.value &&
    stiNum.value > 0 &&
    !sellOverdraft.value &&
    bep20Valid.value &&
    sellMeetsMin.value &&
    !!exchange.sthAddressHot?.address
);

function setMaxSell() {
  stiAmount.value = Math.max(0, sthBalance.value - STH_FEE).toFixed(4);
}

function stopPolling() {
  if (pollTimer.value != null) { window.clearInterval(pollTimer.value); pollTimer.value = null; }
  pollAttempts.value = 0;
}
function startPolling(txid: string) {
  stopPolling();
  pollTimer.value = window.setInterval(async () => {
    pollAttempts.value += 1;
    const state = await exchange.fetchOrderStatus(txid);
    if (state === "settled") {
      wallet.markBridgeConfirmed(txid);
      pushToast("Bridge Confirmed", "success");
      stopPolling();
      return;
    }
    if (pollAttempts.value >= 3) stopPolling();
  }, 10_000);
}

/**
 * BUY flow `I have paid` handler.
 *
 * After the user marks their off-chain USDT deposit as paid:
 *   1. Show a 5-second info toast explaining the wait state.
 *   2. Redirect to the Dashboard immediately — the user's expectation is
 *      "I'm done with this screen", not "stare at the form some more".
 *      Background polling (when we add a confirmation poll for incoming
 *      STH) continues to run on the wallet side independently of which
 *      view is mounted.
 */
function onBuyPaidConfirm() {
  pushToast(
    "Once the transaction is received, you will get your STH coins.",
    "info",
    5000,
  );
  router.push("/dashboard");
}

async function executeSell() {
  if (!sellCanSubmit.value) {
    if (!exchangeReady.value) pushToast("Exchange unavailable", "error");
    else if (sellOverdraft.value) pushToast("Insufficient STH balance", "error");
    else if (!bep20Valid.value) pushToast("Invalid BEP20 USDT address", "error");
    else if (!sellMeetsMin.value)
      pushToast(`Minimum exchange amount is ${MIN_SWAP_USDT.toFixed(0)} USDT`, "error");
    else pushToast("Cannot execute swap", "error");
    return;
  }
  sending.value = true;
  try {
    const r = await wallet.sendTransfer({
      recipient: exchange.gateAddressSth!.address,
      amount: stiNum.value,
      memo: "bsc:" + bep20Dest.value.trim(),
    });
    lastTxId.value = r.tx?.id ?? null;
    pushToast("Liquidity Dispatched", "success");
    stiAmount.value = "";
    bep20Dest.value = "";
    await wallet.fetchBalance(auth.address);
    if (lastTxId.value) startPolling(lastTxId.value);
  } catch (e: any) {
    pushToast(e?.message || "Swap broadcast failed", "error");
  } finally { sending.value = false; }
}

function refreshBuyAddress() {
  if (auth.address) exchange.getBscDepositAddress(auth.address, true);
}
</script>

<template>
  <div class="flex-1 flex flex-col min-h-0" data-testid="swap-view">
    <header class="flex items-center justify-between px-4 py-3 border-b border-gunmetal-400 bg-gunmetal-800">
      <!-- Back arrow — matches Connected Apps / Ledger layout convention. -->
      <button
        @click="router.push('/dashboard')"
        class="text-[11px] uppercase tracking-[0.18em] text-fiat hover:text-bone"
        data-testid="swap-back-btn"
      >
        ← {{ t('top.back') }}
      </button>
      <span class="text-[10px] uppercase tracking-[0.3em] text-fiat font-semibold">
        Exchange STH / USDT
      </span>
      <button @click="refreshAll" class="text-[10px] mono text-fiat hover:text-cyan-voltGlow" data-testid="swap-refresh-btn">
        {{ refreshing ? "…" : "↻" }}
      </button>
    </header>

    <div class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
      <AccountSwitcher />

      <!-- dApp banner -->
      <div v-if="dappOrigin" class="forge-card p-2.5 flex items-center gap-2 border-cyan-volt/40" data-testid="swap-dapp-banner">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-cyan-voltGlow animate-pulse-glow" />
        <span class="text-[10px] uppercase tracking-[0.18em] text-cyan-voltGlow font-semibold">dApp request</span>
        <span class="mono text-[11px] text-fiat truncate flex-1">{{ dappOriginHost }}</span>
        <button @click="dappOrigin = null" class="text-fiatDim hover:text-rust text-[10px]">✕</button>
      </div>

      <!-- BUY / SELL tabs -->
      <div class="flex border-b border-gunmetal-400" data-testid="swap-tabs">
        <button
          @click="tab = 'BUY'"
          :data-testid="'tab-buy'"
          class="px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] relative transition-colors"
          :class="tab === 'BUY' ? 'text-indigo-forgeBright' : 'text-fiatDim hover:text-fiat'"
        >
          Buy STH
          <span v-if="tab === 'BUY'" class="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-indigo-forge" />
        </button>
        <button
          @click="tab = 'SELL'"
          :data-testid="'tab-sell'"
          class="px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] relative transition-colors"
          :class="tab === 'SELL' ? 'text-indigo-forgeBright' : 'text-fiatDim hover:text-fiat'"
        >
          Sell STH
          <span v-if="tab === 'SELL'" class="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-indigo-forge" />
        </button>
        <div class="flex-1 border-b border-gunmetal-400" />
      </div>

      <!-- Live rate strip -->
      <div class="flex items-center justify-between text-[11px]" data-testid="swap-rate-strip">
        <span class="text-fiatDim uppercase tracking-[0.18em] font-semibold">Live rate</span>
        <span class="mono text-fiat font-semibold">
          1 STH = ${{ rate ? rate.toFixed(6) : "—" }}
        </span>
      </div>

      <!-- =================== BUY STH (USDT → STH) =================== -->
      <template v-if="tab === 'BUY'">
        <label class="forge-label">STH amount to buy</label>
        <input
          v-model="stiAmount"
          type="number" inputmode="decimal" step="1" min="0"
          class="forge-input mono text-lg"
          placeholder="10000"
          data-testid="buy-amount-input"
        />

        <div class="forge-card p-3 flex flex-col gap-1.5 text-[12px]" data-testid="buy-summary">
          <div class="flex items-center justify-between">
            <span class="text-fiatDim uppercase tracking-[0.18em] text-[10px] font-semibold">To pay</span>
            <span class="mono text-cyan-voltGlow font-semibold">
              {{ formatUsdt(buyToPayUsdt) }} USDT
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-fiatDim uppercase tracking-[0.18em] text-[10px] font-semibold">You will receive</span>
            <span class="mono text-indigo-forgeBright font-semibold">
              {{ formatSth(buyReceiveSth, 4) }} STH
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-fiatDim uppercase tracking-[0.18em] text-[10px] font-semibold">Min. guaranteed</span>
            <span class="mono text-fiat">
              {{ formatSth(buyMinGuaranteed, 8) }} STH
            </span>
          </div>
        </div>

        <!-- Min deposit warning -->
        <div
          v-if="!buyMeetsMin && stiNum > 0"
          class="forge-card p-2.5 border-rust/60 text-[11px] text-rust leading-relaxed"
          data-testid="buy-min-warning"
        >
          ⚠ Minimum deposit:
          <span class="mono">{{ MIN_SWAP_USDT.toFixed(2) }} USDT (BEP20)</span>.
          Deposits below this amount will not be processed by the bridge.
        </div>

        <!-- BEP20 deposit address card -->
        <div data-testid="buy-bep20-card">
          <span class="forge-label flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" class="w-3 h-3 text-rust" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
            Send USDT to the address in the BSC network (BEP20)
          </span>
          <div class="forge-card p-3 flex items-center gap-2 border-cyan-volt/40">
            <span class="mono text-[12px] text-rust break-all flex-1 leading-relaxed" data-testid="buy-bep20-address">
              {{
                buyBep20Address ||
                (exchange.loadingBscDeposit ? "fetching deposit address…" : "address unavailable — tap retry")
              }}
            </span>
            <button
              v-if="buyBep20Address"
              type="button"
              @click="copyToClipboard(buyBep20Address, 'BEP20 address copied')"
              class="w-8 h-8 grid place-items-center rounded border border-cyan-volt/60 text-cyan-voltGlow hover:bg-cyan-volt/15 transition-colors"
              data-testid="buy-bep20-copy"
              title="Copy"
            >
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="11" height="11" rx="1.5" />
                <path d="M5 15V5a1 1 0 0 1 1-1h10" />
              </svg>
            </button>
            <button
              v-else
              @click="refreshBuyAddress"
              class="forge-btn-cyan h-8 text-[10px] px-2"
              data-testid="buy-bep20-retry"
            >
              Retry
            </button>
          </div>
          <p class="text-[10px] text-fiatDim mt-1.5 uppercase tracking-[0.18em] font-semibold flex items-center gap-1.5">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-rust" />
            BSC Network · BEP20
          </p>
        </div>

        <div class="flex-1" />

        <button
          @click="onBuyPaidConfirm"
          class="forge-btn-primary h-12 text-[11px] uppercase tracking-[0.18em] font-semibold"
          :disabled="!buyBep20Address"
          data-testid="buy-paid-btn"
        >
          I have paid
        </button>
      </template>

      <!-- =================== SELL STH (STH → USDT) =================== -->
      <template v-else>
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-fiatDim uppercase tracking-[0.18em] font-semibold">Your balance</span>
          <button @click="setMaxSell" class="mono text-cyan-voltGlow hover:text-cyan-volt font-semibold" data-testid="sell-max-btn">
            {{ formatSth(sthBalance, 8) }} STH
          </button>
        </div>

        <label class="forge-label">STH amount to sell</label>
        <input
          v-model="stiAmount"
          type="number" inputmode="decimal" step="0.0001" min="0"
          class="forge-input mono text-lg"
          :class="{ 'border-rust shadow-glowRust': sellOverdraft }"
          placeholder="5000"
          data-testid="sell-amount-input"
        />

        <div>
          <label class="forge-label flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" class="w-3 h-3 text-rust" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
            Your USDT address BEP20 (BSC)
          </label>
          <div class="relative">
            <input
              v-model="bep20Dest"
              spellcheck="false" autocomplete="off"
              class="forge-input mono pr-9"
              :class="{
                'border-rust shadow-glowRust': bep20Dest.length > 0 && !bep20Valid,
                'border-cyan-volt shadow-glowCyan': bep20Valid,
              }"
              placeholder="0x…"
              data-testid="sell-bep20-input"
            />
            <span
              v-if="bep20Valid"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-cyan-voltGlow text-base"
            >✓</span>
          </div>
          <p
            v-if="bep20Dest.length > 0 && !bep20Valid"
            class="text-[11px] text-rust mt-1"
            data-testid="sell-bep20-error"
          >
            Address must be a valid 0x… 42-char BEP20 address.
          </p>
        </div>

        <div class="forge-card p-3 flex flex-col gap-1.5 text-[12px]" data-testid="sell-summary">
          <div class="flex items-center justify-between">
            <span class="text-fiatDim uppercase tracking-[0.18em] text-[10px] font-semibold">You will receive</span>
            <span class="mono text-cyan-voltGlow font-semibold">
              {{ formatUsdt(sellReceiveUsdt) }} USDT
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-fiatDim uppercase tracking-[0.18em] text-[10px] font-semibold">Min. guaranteed</span>
            <span class="mono text-fiat">
              {{ formatUsdt(sellMinGuaranteed) }} USDT
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-fiatDim uppercase tracking-[0.18em] text-[10px] font-semibold">Network fee</span>
            <span class="mono text-rust font-semibold">{{ STH_FEE.toFixed(2) }} STH</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-fiatDim uppercase tracking-[0.18em] text-[10px] font-semibold">Gateway</span>
            <button
              v-if="exchange.gateAddressSth?.address"
              type="button"
              @click="copyToClipboard(exchange.gateAddressSth.address, 'Gateway copied')"
              class="mono text-fiat hover:text-cyan-voltGlow"
              data-testid="sell-gateway"
            >
              {{ shortAddress(exchange.gateAddressSth.address, 6, 6) }}
            </button>
            <span v-else class="mono text-fiatDim">resolving…</span>
          </div>
        </div>

        <div
          v-if="stiNum > 0 && !sellMeetsMin"
          class="forge-card p-2.5 border-rust/60 text-[11px] text-rust"
          data-testid="sell-min-warning"
        >
          ⚠ Minimum exchange amount is {{ MIN_SWAP_USDT.toFixed(0) }} USDT.
        </div>

        <div class="flex-1" />

        <HoldButton
          label="Hold to Sell"
          variant="indigo"
          :disabled="!sellCanSubmit"
          testid="sell-hold-btn"
          @fired="executeSell"
        />

        <div
          v-if="pollTimer"
          class="text-[10px] uppercase tracking-[0.18em] text-cyan-voltGlow text-center font-semibold"
          data-testid="bridge-polling"
        >
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-cyan-voltGlow animate-pulse-glow mr-1.5" />
          Awaiting bridge confirmation · {{ pollAttempts }}/3
        </div>
      </template>
    </div>

    <BottomDock />
  </div>
</template>
