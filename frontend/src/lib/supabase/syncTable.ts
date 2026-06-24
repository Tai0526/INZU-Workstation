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
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  async function hydrate() {
    hydrating = true
    const { data, error } = await db.from(table).select('*')
    hydrating = false
    if (!error && data) { cache = data as T[]; emit() }
    else if (error) console.error(`[sync:${table}] load failed:`, error.message)
  }

  function applyRealtime(payload: { eventType: string; new: Partial<T>; old: Partial<T> }) {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id
      if (id != null) { cache = cache.filter((r) => r.id !== id); emit() }
      return
    }
    const row = payload.new as T
    if (!row || row.id == null) return
    cache = cache.some((r) => r.id === row.id) ? cache.map((r) => (r.id === row.id ? row : r)) : [...cache, row]
    emit()
  }

  function start() {
    if (started) return
    started = true
    // Re-load whenever we have an authenticated session; clear on sign-out.
    db.auth.onAuthStateChange((_e, session) => {
      if (session) void hydrate()
      else { cache = []; emit() }
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
    try {
      if (toUpsert.length) { const { error } = await db.from(table).upsert(toUpsert as any); if (error) throw error }
      if (toDelete.length) { const { error } = await db.from(table).delete().in('id', toDelete); if (error) throw error }
    } catch (e) {
      console.error(`[sync:${table}] save failed, resyncing:`, (e as Error).message)
      void hydrate() // revert optimistic state to server truth
    }
  }

  return {
    load: () => { start(); return cache },
    commit: (next) => { const prev = cache; cache = next; emit(); void persist(prev, next) },
    subscribe: (cb) => { start(); if (!hydrating) void hydrate(); listeners.add(cb); return () => listeners.delete(cb) },
  }
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
