import { supabase, isSupabaseConfigured } from './client'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Drop-in backing for the app's data stores. Every store is written as
 * `commit(load().map(...))` against a synchronous in-memory cache; this helper
 * provides exactly that `load` / `commit` / `subscribe` trio, but persists to
 * Supabase (optimistic write-through + realtime sync across devices) when
 * configured, and to localStorage (with cross-tab sync) otherwise.
 *
 * Requirement: the record's TypeScript fields must match the table's columns
 * 1:1 (snake_case), so a row round-trips with no mapping. Arrays → text[]/jsonb,
 * nested objects → jsonb.
 */

export interface SyncTable<T extends { id: string }> {
  load: () => T[]
  /** Replace the whole list (the store computes `next`); persistence is derived by diff. */
  commit: (next: T[]) => void
  subscribe: (cb: () => void) => () => void
}

export function createSyncTable<T extends { id: string }>(opts: { table: string; lsKey: string; seed: T[] }): SyncTable<T> {
  return isSupabaseConfigured && supabase ? supabaseTable(opts) : localTable(opts)
}

// ── Supabase-backed ─────────────────────────────────────────────────────────
/** Notify the app (a toast/banner listener) that a save could not be completed. */
function reportSyncError(table: string, message: string) {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('inzu:sync-error', { detail: { table, message } })) } catch { /* noop */ }
}

/**
 * Tell a *permanent* rejection (a retry can never succeed — missing column/table,
 * forbidden by RLS, bad data shape) from a *transient* one (offline, 5xx, timeout,
 * expired token). Permanent → revert to server truth; transient → keep and retry.
 */
function isPermanentError(err: any): boolean {
  const code = String(err?.code ?? '')
  const status = Number(err?.status ?? err?.statusCode ?? 0)
  if (['42703', '42P01', 'PGRST204', 'PGRST205', '42501', '23502', '23503', '23514', '22P02'].includes(code)) return true
  if ([400, 403, 404, 409, 422].includes(status)) return true
  return false // network error, 401 (token refresh may fix), 408, 429, 5xx → transient
}

function supabaseTable<T extends { id: string }>({ table, lsKey }: { table: string; lsKey: string; seed: T[] }): SyncTable<T> {
  const db = supabase!
  const OUTBOX = `${lsKey}:outbox` // durable copy of un-acknowledged writes/deletes
  let cache: T[] = []
  let hydrating = false
  let started = false
  let lastHydrateAt = 0
  let flushing = false
  let flushAgain = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  // Un-acknowledged local changes: rows written but not yet confirmed by the
  // server, and ids deleted locally but not yet confirmed. These are what stop a
  // freshly-entered row from *disappearing*: a full-table hydrate() that lands
  // while a save is still in flight must not overwrite work the server hasn't
  // stored yet. (Root cause of the mileage "I have to re-enter it" data loss.)
  const pending = new Map<string, T>()
  const tombstoned = new Set<string>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  // ── durable outbox: mirror un-confirmed changes to localStorage so a refresh,
  //    a closed tab, or a dropped connection can't lose them — they're retried. ──
  function saveOutbox() {
    try {
      if (pending.size === 0 && tombstoned.size === 0) localStorage.removeItem(OUTBOX)
      else localStorage.setItem(OUTBOX, JSON.stringify({ pending: [...pending.values()], tombstoned: [...tombstoned] }))
    } catch { /* storage full / unavailable — best effort */ }
  }
  function loadOutbox() {
    try {
      const raw = localStorage.getItem(OUTBOX); if (!raw) return
      const o = JSON.parse(raw) as { pending?: T[]; tombstoned?: string[] }
      for (const r of o.pending ?? []) if (r && (r as any).id != null) pending.set((r as any).id, r)
      for (const id of o.tombstoned ?? []) tombstoned.add(id)
    } catch { /* ignore a corrupt outbox */ }
  }

  // Merge server rows with any un-acknowledged local writes/deletes, so a reload
  // never drops data that simply hasn't finished saving.
  function reconcile(serverRows: T[]): T[] {
    if (pending.size === 0 && tombstoned.size === 0) return serverRows
    const byId = new Map(serverRows.map((r) => [r.id, r]))
    for (const [id, row] of pending) byId.set(id, row) // local write wins until the server echoes it back
    for (const id of tombstoned) byId.delete(id)        // keep local deletes until confirmed
    return [...byId.values()]
  }

  // Fetch every row, paging past PostgREST's 1000-row response cap. mileage_trips
  // alone runs to several thousand rows a month (per bus × day × shift), so a plain
  // select('*') silently returned only the first 1000 — some vehicles' movements
  // were in the database but never reached the app, and monthly totals undercounted.
  async function fetchAll(): Promise<{ rows: T[] | null; error: { message: string } | null }> {
    const PAGE = 1000
    const all: T[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select('*').order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (error) return { rows: null, error }
      const batch = (data ?? []) as T[]
      all.push(...batch)
      if (batch.length < PAGE) break // last page
    }
    return { rows: all, error: null }
  }

  async function hydrate() {
    hydrating = true
    const { rows, error } = await fetchAll()
    hydrating = false
    lastHydrateAt = Date.now()
    if (!error && rows) { cache = reconcile(rows); emit(); void flush() }
    else if (error) console.error(`[sync:${table}] load failed:`, error.message)
  }

  // Push everything currently un-acknowledged to the server. Coalesces concurrent
  // calls, and on a transient failure keeps the outbox and schedules a retry.
  async function flush() {
    if (flushing) { flushAgain = true; return }
    if (pending.size === 0 && tombstoned.size === 0) return
    flushing = true
    const ups = [...pending.values()]
    const dels = [...tombstoned]
    try {
      if (ups.length) { const { error } = await db.from(table).upsert(ups as any); if (error) throw error }
      if (dels.length) { const { error } = await db.from(table).delete().in('id', dels); if (error) throw error }
      for (const r of ups) if (pending.get(r.id) === r) pending.delete(r.id) // keep any newer edit
      for (const id of dels) tombstoned.delete(id)
      saveOutbox()
    } catch (e: any) {
      if (isPermanentError(e)) {
        console.error(`[sync:${table}] save rejected, reverting:`, e?.message ?? e)
        for (const r of ups) if (pending.get(r.id) === r) pending.delete(r.id)
        for (const id of dels) tombstoned.delete(id)
        saveOutbox()
        reportSyncError(table, e?.message ?? 'save rejected')
        void hydrate() // fall back to server truth so bad data doesn't linger
      } else {
        console.warn(`[sync:${table}] save deferred, will retry:`, e?.message ?? e)
        reportSyncError(table, `Couldn't reach the server — your entry is saved locally and will sync automatically.`)
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(() => void flush(), 5000) // retry while idle/offline
      }
    } finally {
      flushing = false
      if (flushAgain) { flushAgain = false; void flush() }
    }
  }

  function applyRealtime(payload: { eventType: string; new: Partial<T>; old: Partial<T> }) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id
      if (id != null) { tombstoned.delete(id); saveOutbox(); cache = cache.filter((r) => r.id !== id); emit() }
      return
    }
    const row = payload.new as T
    if (!row || row.id == null) return
    if (pending.delete(row.id)) saveOutbox() // the server just echoed this row — our write is confirmed
    cache = cache.some((r) => r.id === row.id) ? cache.map((r) => (r.id === row.id ? row : r)) : [...cache, row]
    emit()
  }

  function start() {
    if (started) return
    started = true
    loadOutbox()
    if (pending.size || tombstoned.size) cache = reconcile(cache) // show un-synced work immediately
    // Re-load whenever we have an authenticated session; clear the *view* on sign-out
    // (but keep the outbox so an unsynced entry survives a re-login).
    db.auth.onAuthStateChange((_e, session) => {
      if (session) void hydrate()
      else { cache = []; emit() }
    })
    // Live updates from other users / devices.
    db.channel(`rt-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (p) => applyRealtime(p as any))
      .subscribe()
  }

  return {
    load: () => { start(); return cache },
    commit: (next) => {
      const prev = cache; cache = next; emit()
      const nextIds = new Set(next.map((r) => r.id))
      const prevById = new Map(prev.map((r) => [r.id, r]))
      for (const r of next) if (prevById.get(r.id) !== r) pending.set(r.id, r)          // new or changed
      for (const r of prev) if (!nextIds.has(r.id)) { pending.delete(r.id); tombstoned.add(r.id) } // removed
      saveOutbox()
      void flush()
    },
    // Refresh on mount, but at most once every few seconds. Many components
    // subscribing at once shouldn't each fire a full-table reload — that only
    // widens the save/refresh race. Realtime keeps the cache live between refreshes.
    subscribe: (cb) => {
      start()
      if (!hydrating && Date.now() - lastHydrateAt > 4000) void hydrate()
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Config (settings) sync — for stores that hold a single object/map rather than
// a list of {id} records (role permissions, branding, rates, messaging, …).
// Backed by a single jsonb row in the `app_config` table, keyed by `key`.
// ════════════════════════════════════════════════════════════════════════════
const CONFIG_TABLE = 'app_config'

export interface SyncConfig<T> {
  get: () => T
  set: (value: T) => void
  subscribe: (cb: () => void) => () => void
}

export function createSyncConfig<T>(opts: { key: string; lsKey: string; default: T; merge?: (saved: T) => T }): SyncConfig<T> {
  return isSupabaseConfigured && supabase ? supabaseConfig(opts) : localConfig(opts)
}

function supabaseConfig<T>({ key, default: def, merge }: { key: string; lsKey: string; default: T; merge?: (saved: T) => T }): SyncConfig<T> {
  const db = supabase!
  let cache: T = def
  let started = false
  let hydrating = false
  let lastHydrateAt = 0
  let saving = 0 // in-flight set() saves; while > 0 a hydrate must not clobber the local value
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const apply = (saved: T | null | undefined) => { cache = saved == null ? def : (merge ? merge(saved) : saved); emit() }

  async function hydrate() {
    hydrating = true
    const { data, error } = await db.from(CONFIG_TABLE).select('value').eq('key', key).maybeSingle()
    hydrating = false
    lastHydrateAt = Date.now()
    if (saving > 0) return // an unsaved local change is in flight — don't overwrite it with stale server state
    if (!error) apply((data?.value as T) ?? null)
    else console.error(`[config:${key}] load failed:`, error.message)
  }
  function start() {
    if (started) return
    started = true
    db.auth.onAuthStateChange((_e, session) => { if (session) void hydrate(); else { cache = def; emit() } })
    db.channel(`rt-config-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: CONFIG_TABLE, filter: `key=eq.${key}` }, (p: any) => apply(p.new?.value ?? null))
      .subscribe()
  }
  return {
    get: () => { start(); return cache },
    set: (value) => {
      cache = value; emit()
      saving++
      void db.from(CONFIG_TABLE).upsert({ key, value }).then(({ error }: { error: unknown }) => {
        saving = Math.max(0, saving - 1)
        if (error) { console.error(`[config:${key}] save failed`); if (saving === 0) void hydrate() }
      })
    },
    subscribe: (cb) => {
      start()
      if (!hydrating && Date.now() - lastHydrateAt > 4000) void hydrate()
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

function localConfig<T>({ lsKey, default: def, merge }: { key: string; lsKey: string; default: T; merge?: (saved: T) => T }): SyncConfig<T> {
  let cache: T | null = null
  const listeners = new Set<() => void>()
  function get(): T {
    if (cache !== null) return cache
    try {
      const raw = localStorage.getItem(lsKey)
      cache = raw ? (merge ? merge(JSON.parse(raw) as T) : (JSON.parse(raw) as T)) : def
    } catch { cache = def }
    return cache as T
  }
  function set(value: T) { cache = value; localStorage.setItem(lsKey, JSON.stringify(value)); listeners.forEach((l) => l()) }
  registerCrossTabSync(lsKey, () => { cache = null; get(); listeners.forEach((l) => l()) })
  return { get, set, subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) } }
}

// ── localStorage-backed (fallback / no Supabase) ─────────────────────────────
function localTable<T extends { id: string }>({ lsKey, seed }: { table: string; lsKey: string; seed: T[] }): SyncTable<T> {
  let cache: T[] | null = null
  const listeners = new Set<() => void>()

  function load(): T[] {
    if (cache) return cache
    try {
      const raw = localStorage.getItem(lsKey)
      cache = raw ? (JSON.parse(raw) as T[]) : seed
    } catch {
      cache = seed
    }
    if (!localStorage.getItem(lsKey)) localStorage.setItem(lsKey, JSON.stringify(cache))
    return cache!
  }
  function commit(next: T[]) {
    cache = next
    localStorage.setItem(lsKey, JSON.stringify(next))
    listeners.forEach((l) => l())
  }
  registerCrossTabSync(lsKey, () => { cache = null; load(); listeners.forEach((l) => l()) })

  return {
    load,
    commit,
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
  }
}
