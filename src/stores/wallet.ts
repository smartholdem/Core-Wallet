import { defineStore } from "pinia";
import axios from "axios";
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from "bip39";
import {
  Crypto,
  Identities,
  Managers,
  Transactions,
} from "@smartholdem/crypto";
import { HDKey } from "@scure/bip32";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore, type AccountMeta } from "@/stores/auth";

Managers.configManager.setFromPreset("mainnet");
Managers.configManager.setHeight(10000000);

export const STH_NETWORK = 63;
export const STH_FEE = 0.25;
// SmartHoldem BIP44 derivation. Note: official SLIP-44 lists 255 for STH but
// the SmartHoldem team's project spec uses coin_type=111 — honored verbatim.
const BIP44_COIN_TYPE = 111;

interface Tx {
  id: string;
  type: number;
  sender: string;
  recipient: string;
  amount: number;
  fee: number;
  vendorField?: string;
  timestamp: { epoch: number; unix: number; human: string };
  confirmations: number;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/** Derive STH keys/address for a given account index from a root mnemonic. */
function deriveAccount(mnemonic: string, index: number) {
  // Account #0 = passphrase-derived (matches wallet-pro v1 semantics).
  if (index === 0) {
    const keys = Identities.Keys.fromPassphrase(mnemonic);
    const address = Identities.Address.fromPublicKey(keys.publicKey, STH_NETWORK);
    return { keys, address, privateKey: keys.privateKey, publicKey: keys.publicKey };
  }
  // Account #N>0 = BIP44 HD derivation m/44'/111'/N'/0/0
  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(new Uint8Array(seed));
  const child = root.derive(`m/44'/${BIP44_COIN_TYPE}'/${index}'/0/0`);
  if (!child.privateKey) throw new Error("HD derivation failed");
  const pkHex = bytesToHex(child.privateKey);
  const keys = Identities.Keys.fromPrivateKey(pkHex);
  const address = Identities.Address.fromPublicKey(keys.publicKey, STH_NETWORK);
  return { keys, address, privateKey: keys.privateKey, publicKey: keys.publicKey };
}

export const useWalletStore = defineStore("walletStorage", {
  state: () => ({
    // Per-account on-chain state, keyed by address.
    balances: {} as Record<string, number>,
    nonces: {} as Record<string, string>,
    // Number of broadcast txs per address that the chain has not yet confirmed.
    // SmartHoldem block time is 8s — during that window the node still returns
    // the pre-broadcast nonce, so we have to track pending txs ourselves to
    // compute the correct next nonce for follow-up sends. Reset by the
    // background re-sync scheduled in sendTransfer().
    inflightTxs: {} as Record<string, number>,
    publicKeys: {} as Record<string, string>,
    // Per-address transaction history cache. Switching accounts is instant
    // because we hand back the cached list while a background fetch refreshes.
    historyCache: {} as Record<string, Tx[]>,
    // Per-tx status overlays (e.g. exchange bridge confirmation).
    txStatus: {} as Record<string, "broadcast" | "bridge_confirmed" | "failed">,
    loadingBalance: false,
    loadingTxs: false,
    lastSyncedAt: 0,
  }),
  getters: {
    apiBase() {
      return useSettingsStore().apiBase;
    },
    activeBalance(state): number {
      const auth = useAuthStore();
      return state.balances[auth.address] ?? 0;
    },
    activeNonce(state): string {
      const auth = useAuthStore();
      return state.nonces[auth.address] ?? "0";
    },
    /** History for the currently active account (instant, cached). */
    transactions(state): Tx[] {
      const auth = useAuthStore();
      return state.historyCache[auth.address] ?? [];
    },
  },
  actions: {
    /** Generate a brand-new BIP-39 mnemonic + the account #0 address. */
    createNew() {
      const mnemonic = generateMnemonic();
      const { address } = deriveAccount(mnemonic, 0);
      return { mnemonic, address };
    },

    /** Resolve account #0 address for an imported secret (mnemonic or private key). */
    addressFromSecret(secret: string) {
      const isBip39 = validateMnemonic(secret.trim());
      const { address } = deriveAccount(secret.trim(), 0);
      return { isBip39, address };
    },

    validateAddress(address: string): boolean {
      try {
        return Identities.Address.validate(address, STH_NETWORK);
      } catch {
        return false;
      }
    },

    /** Derive & persist a brand new HD account into auth.accounts. */
    addAccount(label?: string) {
      const auth = useAuthStore();
      const mnemonic = auth.decryptSecret();
      if (!mnemonic) throw new Error("Wallet is locked");
      // Pick the next free index.
      const used = new Set(auth.accounts.map((a) => a.index));
      let idx = 0;
      while (used.has(idx)) idx++;
      const { address } = deriveAccount(mnemonic, idx);
      const meta: AccountMeta = {
        index: idx,
        address,
        label: label || `Account ${idx + 1}`,
      };
      auth.addAccount(meta);
      auth.setActiveAccount(idx);
      // Refresh data for the new active account.
      this.fetchBalance(address);
      this.fetchTransactions(address);
      return meta;
    },

    setActiveAccount(index: number) {
      const auth = useAuthStore();
      auth.setActiveAccount(index);
      if (auth.address) {
        this.fetchBalance(auth.address);
        this.fetchTransactions(auth.address);
      }
    },

    async fetchBalance(address: string) {
      if (!address) return;
      this.loadingBalance = true;
      try {
        const res = await axios.get(`${this.apiBase}/wallets/${address}`, {
          timeout: 8000,
          validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
        });
        const d = res.status === 404 ? null : res.data?.data;
        if (d) {
          this.balances[address] = parseFloat(((d.balance ?? 0) / 1e8).toFixed(8));
          // Nonce handling: if we have in-flight (unconfirmed) broadcasts
          // the node still returns the pre-broadcast nonce. Add the
          // optimistic offset on top so the next send picks the right
          // nonce without forcing the user to mash the Refresh button.
          const chainNonce = d.nonce ?? "0";
          const inflight = this.inflightTxs[address] ?? 0;
          this.nonces[address] = (
            BigInt(chainNonce) + BigInt(inflight)
          ).toString();
          this.publicKeys[address] = d.publicKey ?? "";
        } else {
          this.balances[address] = 0;
          if ((this.inflightTxs[address] ?? 0) === 0) this.nonces[address] = "0";
        }
        this.lastSyncedAt = Date.now();
      } catch {
        this.balances[address] = this.balances[address] ?? 0;
        this.nonces[address] = this.nonces[address] ?? "0";
      } finally {
        this.loadingBalance = false;
      }
    },

    async fetchTransactions(address: string, limit = 20) {
      if (!address) return;
      this.loadingTxs = true;
      try {
        const res = await axios.get(
          `${this.apiBase}/wallets/${address}/transactions?page=1&limit=${limit}`,
          {
            timeout: 8000,
            validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
          }
        );
        const rows = res.status === 404 ? [] : res.data?.data ?? [];
        const mapped: Tx[] = rows.map((t: any) => ({
          id: t.id,
          type: t.type,
          sender: t.sender,
          recipient: t.recipient,
          amount: parseFloat(((t.amount ?? 0) / 1e8).toFixed(8)),
          fee: parseFloat(((t.fee ?? 0) / 1e8).toFixed(8)),
          vendorField: t.vendorField,
          timestamp: t.timestamp,
          confirmations: t.confirmations ?? 0,
        }));
        this.historyCache[address] = mapped;
      } catch {
        // Keep previous cache on transient failures.
      } finally {
        this.loadingTxs = false;
      }
    },

    /** Fetch balances for all accounts in parallel (used by switcher dropdown). */
    async fetchAllBalances() {
      const auth = useAuthStore();
      await Promise.allSettled(
        auth.accounts.map((a) => this.fetchBalance(a.address))
      );
    },

    /** Build, sign and broadcast a v2 transfer from the active account. */
    async sendTransfer(args: {
      recipient: string;
      amount: number;
      memo?: string;
      fee?: number;
    }) {
      const auth = useAuthStore();
      const mnemonic = auth.decryptSecret();
      if (!mnemonic) throw new Error("Wallet is locked");
      if (!auth.address) throw new Error("No active address");

      const { keys, address } = deriveAccount(mnemonic, auth.activeIndex);
      if (address !== auth.address) {
        throw new Error("Address derivation mismatch — vault may be corrupted");
      }

      await this.fetchBalance(address);
      const nextNonce = (BigInt(this.nonces[address] || "0") + 1n).toString();

      const fee = args.fee ?? STH_FEE;
      const builder = Transactions.BuilderFactory.transfer()
        .fee((fee * 1e8).toString())
        .version(2)
        .nonce(nextNonce)
        .recipientId(args.recipient)
        .amount((args.amount * 1e8).toFixed(0));

      if (args.memo && args.memo.length) {
        builder.vendorField(args.memo);
      }

      // For account 0 use the original passphrase path (well-trodden).
      // For HD accounts (index>0), sign via the derived private key by
      // setting the sender pubkey and calling the same `.sign()` path that
      // @smartholdem/crypto exposes — passing the private-key hex as the
      // "passphrase" arg works because that lib accepts either; we then
      // re-stamp the publicKey to be safe.
      let tx;
      if (auth.activeIndex === 0) {
        tx = builder.sign(mnemonic).build().toJson();
      } else {
        const data: any = (builder as any).data;
        data.senderPublicKey = keys.publicKey;
        const built = (builder as any).signWithKeyPair
          ? (builder as any).signWithKeyPair(keys).build()
          : builder.sign(keys.privateKey as any).build();
        tx = built.toJson();
      }

      const res = await axios.post(
        `${this.apiBase}/transactions`,
        { transactions: [tx] },
        { headers: { "Content-Type": "application/json" }, timeout: 12000 }
      );

      // Broadcast accepted by the relay — the node returns a tx id but the
      // tx is still in the mempool and won't be reflected by GET /wallets/<addr>
      // for ~one block (8s on SmartHoldem mainnet). Optimistically bump the
      // local nonce now so a follow-up send during that 8s window uses the
      // correct next nonce instead of re-sending the same one (which the node
      // would reject as a duplicate).
      this.inflightTxs[address] = (this.inflightTxs[address] ?? 0) + 1;
      this.nonces[address] = (BigInt(this.nonces[address] || "0") + 1n).toString();

      // Background re-sync: once the chain has had a full block to confirm
      // (8s) plus a small RPC-latency margin, reconcile our optimistic offset
      // with on-chain reality. Decrementing the inflight counter here lets
      // fetchBalance() trust the chain value again from this point on.
      // 9000ms = one block + 1s slack.
      setTimeout(() => {
        if ((this.inflightTxs[address] ?? 0) > 0) {
          this.inflightTxs[address] -= 1;
        }
        this.fetchBalance(address).catch(() => {});
        this.fetchTransactions(address, 8).catch(() => {});
      }, 9000);

      return { tx, response: res.data?.data ?? res.data };
    },

    /** Sign an arbitrary message with the active account's Schnorr key. */
    signMessage(message: string) {
      const auth = useAuthStore();
      const mnemonic = auth.decryptSecret();
      if (!mnemonic) throw new Error("Wallet is locked");
      const { keys, address } = deriveAccount(mnemonic, auth.activeIndex);
      const hash = Crypto.HashAlgorithms.sha256(message);
      const signature = Crypto.Hash.signSchnorr(hash, keys);
      return {
        address,
        message,
        hash: hash.toString("hex"),
        publicKey: keys.publicKey,
        signature,
      };
    },

    markBridgeConfirmed(txid: string) {
      this.txStatus[txid] = "bridge_confirmed";
    },

    /**
     * Sign a raw transaction payload requested by a dApp via
     * `window.smartholdem.signTransaction(...)`. Builds a v2 transfer with
     * the active account's keys and returns a serialisable JSON tx +
     * signature (no Buffer instances — safe to relay over chrome.runtime
     * sendResponse to the originating page).
     *
     * Failure mode this guards against:
     *   "Read over buffer boundary" — thrown deep inside @smartholdem/crypto
     *   when any mandatory binary field is empty, the wrong length, or
     *   contains invalid base58/hex. We validate every input up-front and
     *   wrap the builder call in a try/catch that surfaces the offending
     *   payload to the console so dApp authors can debug their call sites.
     */
    signRawTransaction(payload: {
      recipient: string;
      amount: number | string;
      vendorField?: string;
      fee?: number | string;
    }) {
      const auth = useAuthStore();
      const mnemonic = auth.decryptSecret();
      if (!mnemonic) throw new Error("Wallet is locked");

      // ── 1. Validate & normalise inputs ───────────────────────────────────
      const recipient = String(payload.recipient ?? "").trim();
      if (!recipient) {
        throw new Error(
          "signTransaction: missing `recipientId` (or `recipient`). " +
            "Did the dApp send it under a different key?",
        );
      }
      if (!this.validateAddress(recipient)) {
        throw new Error(
          `signTransaction: invalid STH address \`${recipient}\` ` +
            "(expected length 34, starts with 'S', base58 alphabet).",
        );
      }

      // BigInt-safe whole→smartoshi conversion. Multiplying floats by 1e8 can
      // produce sub-satoshi noise (e.g. `0.1 * 1e8 = 10000000.000000002`),
      // so we parse the decimal string by hand and pad to 8 fractional digits.
      // `smartoshi` is the official sub-unit of STH (1 STH = 100,000,000 smartoshi),
      // analogous to satoshi for BTC.
      const toSmartoshi = (v: number | string, label: string): string => {
        const s = String(v ?? "").trim();
        if (!/^\d+(\.\d+)?$/.test(s)) {
          throw new Error(`signTransaction: invalid ${label} \`${v}\``);
        }
        const [whole, frac = ""] = s.split(".");
        const padded = (frac + "00000000").slice(0, 8);
        return (BigInt(whole) * 100000000n + BigInt(padded || "0")).toString();
      };

      const amountSmartoshi = toSmartoshi(payload.amount ?? 0, "amount");
      const feeSmartoshi = toSmartoshi(payload.fee ?? STH_FEE, "fee");

      // ── 2. Derive signer & resolve nonce ────────────────────────────────
      const { keys, address } = deriveAccount(mnemonic, auth.activeIndex);
      const nextNonce = (BigInt(this.nonces[address] || "0") + 1n).toString();

      // ── 3. Build & sign (single try/catch around the binary path) ───────
      let tx: any;
      let serializedHex = "";
      let fullData: any = null;
      try {
        const builder = Transactions.BuilderFactory.transfer()
          .version(2)
          // Pin `network` (STH mainnet = 63) and `typeGroup` (Core = 1) into
          // the transaction *data* itself. Defaults work for our own
          // serialiser but the dApp may run a differently-configured copy
          // of @smartholdem/crypto whose `configManager` is not preset to
          // mainnet — in that case re-serialisation on its side writes
          // network=23 (ARK default), the chain rejects the bytes with
          // "Read over buffer boundary". Pinning both fields makes the
          // signed payload self-describing.
          .network(STH_NETWORK)
          .typeGroup(1)
          .nonce(nextNonce)
          .recipientId(recipient)
          .amount(amountSmartoshi)
          .fee(feeSmartoshi);

        if (payload.vendorField) {
          // Vendor field max len = 255 bytes (UTF-8) per SmartHoldem core.
          const bytes = new TextEncoder().encode(payload.vendorField);
          if (bytes.length > 255) {
            throw new Error(
              `signTransaction: vendorField exceeds 255 bytes (got ${bytes.length})`,
            );
          }
          builder.vendorField(payload.vendorField);
        }

        let built: any;
        if (auth.activeIndex === 0) {
          built = builder.sign(mnemonic).build();
        } else {
          const data: any = (builder as any).data;
          data.senderPublicKey = keys.publicKey;
          built = (builder as any).signWithKeyPair
            ? (builder as any).signWithKeyPair(keys).build()
            : builder.sign(keys.privateKey as any).build();
        }
        tx = built.toJson();
        // Pre-computed wire bytes — dApp can broadcast verbatim without
        // touching its own @smartholdem/crypto instance.
        const ser = built.serialized;
        if (ser && typeof ser === "object" && "toString" in ser) {
          serializedHex = ser.toString("hex");
        }
        // `built.data` retains the full data (including `network`,
        // `typeGroup`, `timestamp`) that `toJson()` strips. Expose it so
        // dApps that prefer JSON broadcast still have a self-describing payload.
        fullData = JSON.parse(JSON.stringify(built.data));
      } catch (e: any) {
        // Dump the exact input that tripped the binary serializer — invaluable
        // when a dApp author is trying to figure out which field is wrong.
        // eslint-disable-next-line no-console
        console.error(
          "[smartholdem.signTransaction] serialisation failure:",
          {
            error: e?.message || String(e),
            input: {
              recipient,
              amountSmartoshi,
              feeSmartoshi,
              nonce: nextNonce,
              version: 2,
              vendorField: payload.vendorField,
              senderAddress: address,
              accountIndex: auth.activeIndex,
            },
          },
        );
        throw new Error(
          `signTransaction failed: ${e?.message || "binary serialisation error"}`,
        );
      }

      // ── 4. Strip Buffer instances → wire-safe JSON ──────────────────────
      // toJson() should already produce a plain object, but defensively
      // round-trip through JSON to guarantee no Buffer/Uint8Array leaks
      // through chrome.runtime.sendResponse (which only serialises JSON-
      // compatible values; a Buffer becomes `{}` and silently corrupts the
      // signature on the dApp side).
      const cleanTx = JSON.parse(JSON.stringify(tx));

      // Reserve the nonce the same way sendTransfer() does — a dApp is
      // expected to broadcast the signed payload moments later, and the
      // chain will not reflect it for ~8s. Without this bump, a second
      // signTransaction() call in the same dApp session would hand back
      // the same nonce and the node would reject the second broadcast as
      // a duplicate. Background re-sync is identical to the broadcast path.
      this.inflightTxs[address] = (this.inflightTxs[address] ?? 0) + 1;
      this.nonces[address] = (BigInt(this.nonces[address] || "0") + 1n).toString();
      setTimeout(() => {
        if ((this.inflightTxs[address] ?? 0) > 0) {
          this.inflightTxs[address] -= 1;
        }
        this.fetchBalance(address).catch(() => {});
        this.fetchTransactions(address, 8).catch(() => {});
      }, 9000);

      return {
        tx: cleanTx,
        id: cleanTx.id,
        signature: cleanTx.signature,
        senderPublicKey: cleanTx.senderPublicKey,
        address,
        // Pre-computed serialised bytes (hex). Broadcast these verbatim to
        // any STH node's POST /api/transactions endpoint as
        // `{ transactions: [<this hex>] }` for max compatibility.
        serialized: serializedHex,
        // Full transaction data — includes `network`, `typeGroup`,
        // `timestamp` that toJson() drops. Self-describing payload.
        data: fullData,
      };
    },

    /** Replace the entire cache atomically (used by vault import). */
    hydrate(state: {
      balances?: Record<string, number>;
      historyCache?: Record<string, Tx[]>;
      txStatus?: Record<string, "broadcast" | "bridge_confirmed" | "failed">;
    }) {
      if (state.balances) this.balances = { ...state.balances };
      if (state.historyCache) this.historyCache = { ...state.historyCache };
      if (state.txStatus) this.txStatus = { ...state.txStatus };
    },
  },
});
