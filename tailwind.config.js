/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./popup.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gunmetal: {
          900: "#0B0C0E",
          800: "#121315",
          700: "#16181B",
          600: "#1A1C20",
          500: "#22252B",
          400: "#2D3139",
          300: "#3A3F49",
        },
        // === Theme-bound semantic colors (driven by CSS variables on <body data-theme=...>) ===
        // `indigo-forge` / `cyan-volt` are kept as historical aliases so the entire
        // component tree doesn't need to be rewritten — they now adapt per theme.
        indigo: {
          forge: "rgb(var(--accent) / <alpha-value>)",
          forgeBright: "rgb(var(--accent-bright) / <alpha-value>)",
        },
        cyan: {
          volt: "rgb(var(--highlight) / <alpha-value>)",
          voltGlow: "rgb(var(--highlight-bright) / <alpha-value>)",
        },
        // Brand alarm/danger color — stays static across themes.
        rust: {
          DEFAULT: "#E25822",
          dark: "#B83F12",
          bright: "#FF7A3D",
        },
        // High-contrast fiat/balance text — much brighter than gunmetal-300.
        fiat: "rgb(var(--fiat) / <alpha-value>)",
        fiatDim: "rgb(var(--fiat-dim) / <alpha-value>)",
        bone: "#E6E7EA",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        forge:
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.45)",
        glowIndigo:
          "0 0 0 1px rgb(var(--accent) / 0.55), 0 0 24px -2px rgb(var(--accent) / 0.55)",
        glowCyan:
          "0 0 0 1px rgb(var(--highlight) / 0.55), 0 0 24px -2px rgb(var(--highlight) / 0.55)",
        glowRust:
          "0 0 0 1px rgba(226,88,34,0.5), 0 0 18px -2px rgba(226,88,34,0.5)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2.4s ease-in-out infinite",
        "slide-up": "slide-up 220ms ease-out",
        scan: "scan 2.5s linear infinite",
      },
    },
  },
  plugins: [],
};
