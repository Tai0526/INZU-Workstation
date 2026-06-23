import { useSyncExternalStore } from 'react'
import { registerCrossTabSync } from '@/lib/storage/sync'

/**
 * Reusable email recipient list (persisted) for sending reports — e.g. the daily
 * bus allocation. Stored locally so the same distribution list is there next time.
 */
export interface Recipient {
  id: string
  name: string
  email: string
}

const KEY = 'inzu_report_recipients'
let cache: Recipient[] | null = null
const listeners = new Set<() => void>()

function load(): Recipient[] {
  if (cache) return cache
  try { const raw = localStorage.getItem(KEY); cache = raw ? (JSON.parse(raw) as Recipient[]) : [] } catch { cache = [] }
  return cache!
}
function commit(next: Recipient[]) { cache = next; localStorage.setItem(KEY, JSON.stringify(next)); listeners.forEach((l) => l()) }
registerCrossTabSync(KEY, () => { cache = null; load(); listeners.forEach((l) => l()) })
function newId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rcpt_${Date.now()}_${Math.round(Math.random() * 1e6)}` }

export const recipientsStore = {
  list: (): Recipient[] => load(),
  add(name: string, email: string): Recipient {
    const r: Recipient = { id: newId(), name: name.trim(), email: email.trim() }
    commit([...load(), r])
    return r
  },
  remove(id: string) { commit(load().filter((r) => r.id !== id)) },
}

export function useRecipients(): Recipient[] {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, load, load)
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())
