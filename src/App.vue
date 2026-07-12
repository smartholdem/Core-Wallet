<script setup lang="ts">
import { RouterView } from "vue-router";
import ToastHost from "@/components/ToastHost.vue";
import AuthorizeTx from "@/components/AuthorizeTx.vue";
import AuthorizeConnect from "@/components/AuthorizeConnect.vue";
import AuthorizeMessage from "@/components/AuthorizeMessage.vue";
import { onMounted, onBeforeUnmount, watch, watchEffect } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";

const auth = useAuthStore();
const settings = useSettingsStore();

onMounted(() => {
  auth.bootstrap();
  settings.applyTheme();
  settings.updateNodes().catch(() => {});
});

// Reactively keep the body/html data-theme in sync with the store.
watchEffect(() => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", settings.theme);
    document.body.setAttribute("data-theme", settings.theme);
  }
});

/* ─────────────────────────── Auto-Lock idle watcher ──────────────────────── */
// Triggers `auth.lock()` after `settings.lockTimeoutSec` seconds of zero UI
// activity. Reset on pointer/key/touch events. Respects
// `settings.autoLockEnabled` — disabled flag stops the timer entirely.
//
// Note: this is intentionally local-only (no chrome.alarms): when the popup
// closes, JS unloads and the timer effectively resets — desired behaviour
// for "lock when the surface is unused", aligns with how MetaMask / Phantom
// implement their inactivity locks.
let idleTimer: number | undefined;
function resetIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!settings.autoLockEnabled || settings.lockTimeoutSec <= 0) return;
  if (auth.isLocked) return; // no point re-locking an already-locked vault
  idleTimer = window.setTimeout(() => {
    auth.lock();
  }, settings.lockTimeoutSec * 1000);
}

const IDLE_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "wheel"] as const;
function attachIdle() {
  for (const ev of IDLE_EVENTS) window.addEventListener(ev, resetIdle, { passive: true });
  resetIdle();
}
function detachIdle() {
  for (const ev of IDLE_EVENTS) window.removeEventListener(ev, resetIdle);
  if (idleTimer) clearTimeout(idleTimer);
}

onMounted(attachIdle);
onBeforeUnmount(detachIdle);

// React to user changing the timeout / toggling the feature — restart timer
// without requiring a page reload.
watch(
  () => [settings.autoLockEnabled, settings.lockTimeoutSec, auth.isLocked],
  resetIdle,
);
</script>

<template>
  <div class="w-full h-full bg-gunmetal-800 text-bone flex flex-col">
    <RouterView v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </RouterView>
    <ToastHost />
    <AuthorizeTx />
    <AuthorizeConnect />
    <AuthorizeMessage />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
