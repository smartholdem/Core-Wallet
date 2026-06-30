import { defineStore } from "pinia";
import axios from "axios";
import CryptoJS from "crypto-js";

export const DEFAULT_NODES = [
  "node0.smartholdem.io",
  "node1.smartholdem.io",
  "node2.smartholdem.io",
  "node3.smartholdem.io",
  "node4.smartholdem.io",
  "node5.smartholdem.io"
];

interface NodeStatus {
  node: string;
  status: any;
  latency: number;
  synced: boolean;
}

export const useSettingsStore = defineStore("appSettings", {
  state: () => ({
    darkMode: true,
    currency: "USDT",
    /**
     * Auto-lock idle timeout in seconds. `0` (or `autoLockEnabled === false`)
     * disables auto-lock entirely. Default = 5 min.
     */
    lockTimeoutSec: 300,
    autoLockEnabled: true,
    theme: "rust" as "rust" | "cyan" | "light",
    locale: "en" as "en" | "ru" | "zh" | "es",
    pinHash: "" as string, // SHA-384(pin)
    nodes: [...DEFAULT_NODES],
    activeNode: "node0.smartholdem.io",
    nodesStatus: [] as NodeStatus[],
    activeNodeStatus: null as any,
  }),
  getters: {
    apiBase(state) {
      return `https://${state.activeNode}/api`;
    },
  },
  actions: {
    savePinHash(pin: string) {
      this.pinHash = CryptoJS.SHA384(pin).toString();
    },
    validatePin(pin: string) {
      return CryptoJS.SHA384(pin).toString() === this.pinHash;
    },
    setActiveNode(node: string) {
      if (this.nodes.includes(node)) this.activeNode = node;
    },
    setTheme(theme: "rust" | "cyan" | "light") {
      this.theme = theme;
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", theme);
        document.body.setAttribute("data-theme", theme);
      }
    },
    applyTheme() {
      this.setTheme(this.theme);
    },
    setLocale(locale: "en" | "ru" | "zh" | "es") {
      this.locale = locale;
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("lang", locale);
      }
    },
    /** Auto-lock configuration. `seconds` = 0 disables timer. */
    setAutoLock(enabled: boolean, seconds?: number) {
      this.autoLockEnabled = enabled;
      if (typeof seconds === "number" && seconds > 0) {
        this.lockTimeoutSec = seconds;
      }
    },
    async updateNodes() {
      const probes = this.nodes.map(async (node) => {
        const t0 = Date.now();
        try {
          const res = await axios.get(`https://${node}/api/node/status`, {
            timeout: 5000,
          });
          const latency = Date.now() - t0;
          const synced = !!res.data?.data?.synced;
          return { node, status: res.data?.data ?? null, latency, synced };
        } catch {
          return { node, status: null, latency: Infinity, synced: false };
        }
      });
      const results = await Promise.allSettled(probes);
      const statuses: NodeStatus[] = results.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : { node: this.nodes[i], status: null, latency: Infinity, synced: false }
      );
      statuses.sort((a, b) => a.latency - b.latency);
      this.nodesStatus = statuses;
      const best = statuses.find((s) => s.synced);
      if (best) {
        this.activeNode = best.node;
        this.activeNodeStatus = best.status;
        return best;
      }
      this.activeNodeStatus = null;
      return null;
    },
  },
  persist: { key: "sth.settings", storage: localStorage },
});
