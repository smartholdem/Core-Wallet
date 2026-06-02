<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { pushToast } from "@/lib/utils";
import PinPad from "@/components/PinPad.vue";
import LanguageDropdown from "@/components/LanguageDropdown.vue";
import { useT } from "@/locales";

const router = useRouter();
const auth = useAuthStore();
const t = useT();

const pin = ref("");
const error = ref(false);
const attempts = ref(0);

function tryUnlock(v: string) {
  if (auth.unlock(v)) {
    pushToast(t.value("lock.opened"), "success");
    router.replace("/dashboard");
    return;
  }
  error.value = true;
  attempts.value++;
  setTimeout(() => { error.value = false; pin.value = ""; }, 600);
  pushToast(t.value("lock.wrong"), "error");
}

const bullets = [
  "lock.security.b1",
  "lock.security.b2",
  "lock.security.b3",
  "lock.security.b4",
];
</script>

<template>
  <div
    class="flex-1 flex flex-col px-5 py-5 relative overflow-y-auto"
    data-testid="gatekeeper-view"
  >
    <!-- scan line -->
    <div
      class="absolute inset-x-0 h-px bg-cyan-volt/40 animate-scan pointer-events-none"
      style="top: 0"
    />

    <!-- Header strip: lock badge + language picker -->
    <div class="relative flex items-start justify-between gap-2">
      <div class="flex items-center gap-2.5">
        <div
          class="w-9 h-9 rounded-md border border-cyan-volt/60 bg-gunmetal-700 grid place-items-center shadow-glowCyan"
        >
          <svg viewBox="0 0 24 24" class="w-4 h-4 text-cyan-voltGlow" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="11" width="16" height="9" rx="1.5" />
            <path d="M8 11V7a4 4 0 1 1 8 0v4" />
          </svg>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-[0.3em] text-fiatDim">
            {{ t("lock.title") }}
          </p>
          <p class="text-sm font-semibold text-bone mt-0.5">
            {{ t("lock.subtitle") }}
          </p>
        </div>
      </div>
      <LanguageDropdown />
    </div>

    <p class="relative text-xs text-fiat mt-20 leading-relaxed">
      {{ t("lock.intro") }}
    </p>

    <!-- Security info card — fills the empty mid-region per UX spec -->
    <div class="relative forge-card mt-4 p-3.5" data-testid="lock-security-card">
      <div class="flex items-center gap-2 mb-2.5">
        <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 text-indigo-forgeBright" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span class="text-[10px] uppercase tracking-[0.18em] text-indigo-forgeBright font-semibold">
          {{ t("lock.security.h1") }}
        </span>
      </div>
      <ul class="flex flex-col gap-1.5 text-[11px] text-fiat leading-relaxed">
        <li
          v-for="b in bullets"
          :key="b"
          class="flex items-start gap-2"
          :data-testid="`lock-bullet-${b}`"
        >
          <span class="text-cyan-voltGlow mt-0.5">▸</span>
          <span>{{ t(b) }}</span>
        </li>
      </ul>
    </div>

    <div class="flex-1" />

    <div class="relative">
      <PinPad v-model="pin" :length="6" :error="error" @complete="tryUnlock" />
      <p
        v-if="attempts > 2"
        class="text-[11px] text-rust text-center mt-3"
        data-testid="forgot-hint"
      >
        {{ t("lock.forgot") }}
      </p>
    </div>
  </div>
</template>
