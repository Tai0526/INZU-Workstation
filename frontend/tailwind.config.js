/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── INZU / Ventura brand palette (spec §3.1) ──
        navy: {
          DEFAULT: '#0F1B33', // primary: sidebar, headings, primary buttons, table headers
          secondary: '#1B2A4A', // section headers, active nav highlight, links
        },
        // Brand accent — orange taken from the INZU logo (#D16B21)
        brand: {
          DEFAULT: '#D16B21', // active nav, callouts, badges, KPI highlights, buttons
          tint: '#F8E7D7', // callout/chip backgrounds
        },
        // ── Status colour language (spec §3.2) — semantic, kept distinct from brand ──
        status: {
          good: '#2E7D4F', // compliant / good
          warning: '#C9A227', // warning / due soon (amber)
          critical: '#B3261E', // critical / overdue
          neutral: '#6B7280', // neutral / not started
        },
        // neutral surfaces
        surface: '#FFFFFF',
        canvas: '#F2F2F2',
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
