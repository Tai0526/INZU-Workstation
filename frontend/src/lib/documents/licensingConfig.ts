import { useMemo, useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { CATEGORY_META, LICENSING_CATEGORIES, EXTRA_CATEGORY_LABELS } from '@/lib/documents/types'

/**
 * Which vehicle documents the fleet must carry — configurable, per company.
 *
 * The four built-ins (Road Tax, Fitness, Insurance, FQM Inspection) can each be
 * marked required or optional, and new categories (e.g. a mine permit) can be
 * added. Only REQUIRED categories count toward compliance and trigger the
 * "missing documents" alerts; optional ones still appear for upload and their
 * expiry is still tracked once a document exists.
 *
 * Stored migration-free in app_config. Custom categories save onto document
 * rows as their key string (the documents table's category column is text).
 */

export interface CustomCat { key: string; label: string; short: string }
export interface LicensingConfig { required: string[]; custom: CustomCat[] }

export const DEFAULT_LICENSING: LicensingConfig = { required: [...LICENSING_CATEGORIES], custom: [] }

const cfg = createSyncConfig<LicensingConfig>({
  key: 'licensing_config', lsKey: 'inzu_licensing_config', default: DEFAULT_LICENSING,
})

/** One column of the licensing grid — built-in or custom. */
export interface LicCat { key: string; label: string; short: string; required: boolean; builtin: boolean }

function coerce(c: LicensingConfig): LicensingConfig {
  return {
    required: Array.isArray(c.required) ? c.required : DEFAULT_LICENSING.required,
    custom: Array.isArray(c.custom) ? c.custom.filter((x) => x && x.key && x.label) : [],
  }
}

export function licCatsOf(c: LicensingConfig): LicCat[] {
  const { required, custom } = coerce(c)
  const req = new Set(required)
  return [
    ...LICENSING_CATEGORIES.map((k) => ({ key: k as string, label: CATEGORY_META[k].label, short: CATEGORY_META[k].short, required: req.has(k), builtin: true })),
    ...custom.map((x) => ({ key: x.key, label: x.label, short: x.short || x.label, required: req.has(x.key), builtin: false })),
  ]
}

export function useLicensingCats(): LicCat[] {
  const c = useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
  // Stable per config snapshot, so it can sit in useMemo dependency lists.
  return useMemo(() => licCatsOf(c), [c])
}

export const licensingConfigStore = {
  // NOTE: returns the raw store snapshot (stable reference) — coerce() makes a
  // fresh object and would infinite-loop useSyncExternalStore (React #185).
  // Consumers go through licCatsOf(), which coerces internally.
  get: (): LicensingConfig => cfg.get(),
  subscribe: cfg.subscribe,
  setRequired(key: string, required: boolean) {
    const c = coerce(cfg.get())
    const req = new Set(c.required)
    required ? req.add(key) : req.delete(key)
    cfg.set({ ...c, required: [...req] })
  },
  addCustom(label: string, short: string) {
    const c = coerce(cfg.get())
    const clean = label.trim()
    if (!clean) return
    const key = 'cust_' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    if (!key || c.custom.some((x) => x.key === key) || (LICENSING_CATEGORIES as string[]).includes(key)) return
    cfg.set({ required: [...c.required, key], custom: [...c.custom, { key, label: clean, short: short.trim() || clean }] })
  },
  removeCustom(key: string) {
    const c = coerce(cfg.get())
    cfg.set({ required: c.required.filter((k) => k !== key), custom: c.custom.filter((x) => x.key !== key) })
  },
}

// Keep the app-wide label registry warm so custom-category documents show
// their real name everywhere (documents library, notifications) — not "Document".
function syncRegistry() {
  for (const k of Object.keys(EXTRA_CATEGORY_LABELS)) delete EXTRA_CATEGORY_LABELS[k]
  for (const x of coerce(cfg.get()).custom) EXTRA_CATEGORY_LABELS[x.key] = { label: x.label, short: x.short || x.label }
}
cfg.subscribe(syncRegistry)
syncRegistry()
