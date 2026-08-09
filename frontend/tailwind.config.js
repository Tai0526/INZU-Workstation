/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── INZU / Ventura palette (spec §3.1), routed through CSS variables ──
      // The actual values live in src/index.css (:root = light, .dark = dark).
      // `rgb(var(...) / <alpha-value>)` keeps every opacity step working
      // (border-black/10, bg-status-critical/5, …) in BOTH themes, and lets the
      // per-user accent colour swap --accent-rgb without touching components.
      colors: {
        navy: {
          DEFAULT: 'rgb(var(--navy-rgb) / <alpha-value>)', // headings/body text; solid navy surfaces are pinned dark in index.css
          secondary: 'rgb(var(--navy2-rgb) / <alpha-value>)',
        },
        // Brand accent — user-selectable, defaults to INZU logo orange (#D16B21)
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          tint: 'rgb(var(--brand-tint-rgb) / <alpha-value>)', // callout/chip backgrounds
        },
        // ── Status colour language (spec §3.2) — semantic, kept distinct from brand ──
        status: {
          good: 'rgb(var(--good-rgb) / <alpha-value>)',
          warning: 'rgb(var(--warn-rgb) / <alpha-value>)',
          critical: 'rgb(var(--crit-rgb) / <alpha-value>)',
          neutral: 'rgb(var(--neutral-rgb) / <alpha-value>)',
        },
        // neutral surfaces
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        canvas: 'rgb(var(--canvas-rgb) / <alpha-value>)',
        // "black" here means borders/dividers/hover tints — flips to white-ish
        // in dark mode so border-black/10 etc. stay visible. `white` stays
        // literal white: it is TEXT on navy surfaces, which remain dark.
        black: 'rgb(var(--black-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Syne"', '"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,27,51,0.06), 0 1px 3px rgba(15,27,51,0.04)',
        cardhover: '0 4px 12px rgba(15,27,51,0.10)',
      },
    },
  },
  plugins: [],
}
