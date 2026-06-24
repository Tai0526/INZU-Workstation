import { useSyncExternalStore } from 'react'
import { createSyncTable } from '@/lib/supabase/syncTable'

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
const { load, commit, subscribe } = createSyncTable<Recipient>({ table: 'report_recipients', lsKey: KEY, seed: [] })
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
  return useSyncExternalStore(subscribe, load, load)
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())
