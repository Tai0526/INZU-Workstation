import { useEffect, useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Per-user appearance preferences (theme + accent colour).
 *
 * Saved in app_config as a map keyed by user id, so a person's choice follows
 * their ACCOUNT to any device — while every other account keeps its own look.
 * A localStorage mirror of the signed-in user's choice is applied before React
 * mounts (bootAppearance in main.tsx), so there is no flash of the wrong theme
 * on reload; once the account's synced value hydrates, it wins.
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type AccentKey = 'inzu' | 'blue' | 'teal' | 'emerald' | 'purple' | 'magenta'
export type ThemeKey = 'navy' | 'ocean' | 'teal' | 'forest' | 'plum' | 'pink'
export interface Appearance { mode: ThemeMode; accent: AccentKey; theme: ThemeKey }

export const DEFAULT_APPEARANCE: Appearance = { mode: 'light', accent: 'inzu', theme: 'navy' }

/**
 * Colour themes recolour the app's CHROME — sidebar, table headers, primary
 * buttons — while the canvas stays light (or dark, per the mode). The CSS
 * lives in index.css as `.theme-<key>` overrides of the solid navy surfaces,
 * the same technique dark mode uses. Each theme suggests a matching accent
 * (applied on pick; the user can still change the accent afterwards).
 */
export const THEMES: { key: ThemeKey; label: string; chrome: string; chrome2: string; accent: AccentKey }[] = [
  { key: 'navy', label: 'INZU Navy', chrome: '#0F1B33', chrome2: '#1B2A4A', accent: 'inzu' },
  { key: 'ocean', label: 'Ocean & White', chrome: '#1E3A8A', chrome2: '#1E40AF', accent: 'blue' },
  { key: 'teal', label: 'Teal & White', chrome: '#134E4A', chrome2: '#115E59', accent: 'teal' },
  { key: 'forest', label: 'Forest & White', chrome: '#14532D', chrome2: '#166534', accent: 'emerald' },
  { key: 'plum', label: 'Plum & White', chrome: '#4C1D95', chrome2: '#5B21B6', accent: 'purple' },
  { key: 'pink', label: 'Pink & White', chrome: '#831843', chrome2: '#9D174D', accent: 'magenta' },
]

/** Curated accents — each needs a light chip tint and a deep dark-mode tint. */
export const ACCENTS: { key: AccentKey; label: string; hex: string; rgb: string; tintLight: string; tintDark: string }[] = [
  { key: 'inzu', label: 'INZU Orange', hex: '#D16B21', rgb: '209 107 33', tintLight: '248 231 215', tintDark: '74 46 22' },
  { key: 'blue', label: 'Ocean Blue', hex: '#2563EB', rgb: '37 99 235', tintLight: '219 231 254', tintDark: '23 42 82' },
  { key: 'teal', label: 'Teal', hex: '#0D9488', rgb: '13 148 136', tintLight: '209 240 236', tintDark: '16 59 55' },
  { key: 'emerald', label: 'Emerald', hex: '#059669', rgb: '5 150 105', tintLight: '209 242 227', tintDark: '13 59 42' },
  { key: 'purple', label: 'Royal Purple', hex: '#7C3AED', rgb: '124 58 237', tintLight: '234 226 252', tintDark: '46 33 82' },
  { key: 'magenta', label: 'Magenta', hex: '#DB2777', rgb: '219 39 119', tintLight: '251 220 235', tintDark: '74 24 48' },
]

const MODES: ThemeMode[] = ['light', 'dark', 'system']
const MIRROR_KEY = 'inzu_appearance'

/** Anything read from storage/sync gets coerced back to known values. */
function sane(a: Partial<Appearance> | null | undefined): Appearance {
  return {
    mode: MODES.includes(a?.mode as ThemeMode) ? (a!.mode as ThemeMode) : DEFAULT_APPEARANCE.mode,
    accent: ACCENTS.some((x) => x.key === a?.accent) ? (a!.accent as AccentKey) : DEFAULT_APPEARANCE.accent,
    theme: THEMES.some((x) => x.key === a?.theme) ? (a!.theme as ThemeKey) : DEFAULT_APPEARANCE.theme,
  }
}

// ── Synced per-user map ──────────────────────────────────────────────────────
const cfg = createSyncConfig<Record<string, Appearance>>({
  key: 'user_prefs', lsKey: 'inzu_user_prefs', default: {},
})

export function useAppearance(userId: string): Appearance {
  const map = useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
  return sane(map[userId])
}

export function setAppearance(userId: string, patch: Partial<Appearance>) {
  const map = cfg.get()
  // Picking a theme brings its matching accent along (still changeable after).
  if (patch.theme && patch.accent === undefined) {
    const t = THEMES.find((x) => x.key === patch.theme)
    if (t) patch = { ...patch, accent: t.accent }
  }
  const next = sane({ ...sane(map[userId]), ...patch })
  cfg.set({ ...map, [userId]: next })
  applyAppearance(next) // instant — don't wait for the sync round-trip
}

// ── Applying to the document ─────────────────────────────────────────────────
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
let current: Appearance = DEFAULT_APPEARANCE

export function applyAppearance(a: Appearance) {
  current = sane(a)
  const root = document.documentElement
  const dark = current.mode === 'dark' || (current.mode === 'system' && !!media?.matches)
  root.classList.toggle('dark', dark)
  for (const t of THEMES) root.classList.toggle(`theme-${t.key}`, t.key !== 'navy' && t.key === current.theme)
  const acc = ACCENTS.find((x) => x.key === current.accent) ?? ACCENTS[0]
  root.style.setProperty('--accent-rgb', acc.rgb)
  root.style.setProperty('--accent-tint-light-rgb', acc.tintLight)
  root.style.setProperty('--accent-tint-dark-rgb', acc.tintDark)
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(current)) } catch { /* ignore */ }
}

// In "system" mode, follow the OS the moment it switches.
media?.addEventListener?.('change', () => { if (current.mode === 'system') applyAppearance(current) })

/** Called from main.tsx BEFORE render: apply the last-known choice instantly. */
export function bootAppearance() {
  let a: Appearance = DEFAULT_APPEARANCE
  try {
    const raw = localStorage.getItem(MIRROR_KEY)
    if (raw) a = sane(JSON.parse(raw))
  } catch { /* ignore */ }
  applyAppearance(a)
}

/**
 * Keep the document in step with the signed-in user's saved preference —
 * including when it first hydrates from Supabase, changes on another device,
 * or a different person signs in on this machine (their look, not the last
 * user's). Mounted once in Layout.
 */
export function useAppearanceSync(userId: string | undefined) {
  const a = useAppearance(userId ?? '')
  // Only while actually signed in — a signed-out frame must not reset the
  // login page to defaults (the mirror keeps the last user's look there).
  useEffect(() => { if (userId) applyAppearance(a) }, [userId, a.mode, a.accent, a.theme])
}
