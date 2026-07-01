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
function supabaseTable<T extends { id: string }>({ table }: { table: string; lsKey: string; seed: T[] }): SyncTable<T> {
  const db = supabase!
  let cache: T[] = []
  let hydrating = false
  let started = false
  let lastHydrateAt = 0
  // Un-acknowledged local changes: rows written but not yet confirmed by the
  // server, and ids deleted locally but not yet confirmed. These are what stop a
  // freshly-entered row from *disappearing*: a full-table hydrate() that lands
  // while a save is still in flight must not overwrite work the server hasn't
  // stored yet. (Root cause of the mileage "I have to re-enter it" data loss.)
  const pending = new Map<string, T>()
  const tombstoned = new Set<string>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  // Merge server rows with any un-acknowledged local writes/deletes, so a reload
  // never drops data that simply hasn't finished saving.
  function reconcile(serverRows: T[]): T[] {
    if (pending.size === 0 && tombstoned.size === 0) return serverRows
    const byId = new Map(serverRows.map((r) => [r.id, r]))
    for (const [id, row] of pending) byId.set(id, row) // local write wins until the server echoes it back
    for (const id of tombstoned) byId.delete(id)        // keep local deletes until confirmed
    return [...byId.values()]
  }

  async function hydrate() {
    hydrating = true
    const { data, error } = await db.from(table).select('*')
    hydrating = false
    lastHydrateAt = Date.now()
    if (!error && data) { cache = reconcile(data as T[]); emit() }
    else if (error) console.error(`[sync:${table}] load failed:`, error.message)
  }

  function applyRealtime(payload: { eventType: string; new: Partial<T>; old: Partial<T> }) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id
      if (id != null) { tombstoned.delete(id); cache = cache.filter((r) => r.id !== id); emit() }
      return
    }
    const row = payload.new as T
    if (!row || row.id == null) return
    pending.delete(row.id) // the server just echoed this row — our optimistic write is confirmed
    cache = cache.some((r) => r.id === row.id) ? cache.map((r) => (r.id === row.id ? row : r)) : [...cache, row]
    emit()
  }

  function start() {
    if (started) return
    started = true
    // Re-load whenever we have an authenticated session; clear on sign-out.
    db.auth.onAuthStateChange((_e, session) => {
      if (session) void hydrate()
      else { cache = []; pending.clear(); tombstoned.clear(); emit() }
    })
    // Live updates from other users / devices.
    db.channel(`rt-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (p) => applyRealtime(p as any))
      .subscribe()
  }

  async function persist(prev: T[], next: T[]) {
    const nextIds = new Set(next.map((r) => r.id))
    const prevById = new Map(prev.map((r) => [r.id, r]))
    const toUpsert = next.filter((r) => prevById.get(r.id) !== r) // new or changed (reference differs)
    const toDelete = prev.filter((r) => !nextIds.has(r.id)).map((r) => r.id)
    // Register the optimistic change so a hydrate racing this save can't undo it.
    for (const r of toUpsert) pending.set(r.id, r)
    for (const id of toDelete) { tombstoned.add(id); pending.delete(id) }
    try {
      if (toUpsert.length) { const { error } = await db.from(table).upsert(toUpsert as any); if (error) throw error }
      if (toDelete.length) { const { error } = await db.from(table).delete().in('id', toDelete); if (error) throw error }
      // Saved — release the optimistic bookkeeping (unless a newer edit replaced it).
      for (const r of toUpsert) if (pending.get(r.id) === r) pending.delete(r.id)
      for (const id of toDelete) tombstoned.delete(id)
    } catch (e) {
      console.error(`[sync:${table}] save failed, resyncing:`, (e as Error).message)
      // Genuine failure (e.g. a column the live DB doesn't have): drop the optimistic
      // bookkeeping and fall back to server truth so bad data doesn't linger.
      for (const r of toUpsert) if (pending.get(r.id) === r) pending.delete(r.id)
      for (const id of toDelete) tombstoned.delete(id)
      void hydrate()
    }
  }

  return {
    load: () => { start(); return cache },
    commit: (next) => { const prev = cache; cache = next; emit(); void persist(prev, next) },
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
