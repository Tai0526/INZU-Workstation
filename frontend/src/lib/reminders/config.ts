import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Daily email reminders — the settings half.
 *
 * The digests themselves are sent by the `daily-reminders` Edge Function on a
 * morning schedule (see supabase/migrations/0008_daily_reminders.sql). It reads
 * THIS app_config row for who to send to, whether it is on, and WHICH
 * categories to include — so the Admin page and the sender can never disagree.
 *
 * `categories` stores only the switched-OFF keys (missing = on), so a category
 * added later is on by default without touching anyone's saved config.
 */

export interface ReminderConfig {
  enabled: boolean
  user_ids: string[] // Workstation users on the list — resolved to their account email at send time
  recipients: string[] // extra addresses for people without an account
  categories: Record<string, boolean>
  site_url: string // where "log in for details" points; stamped from the deployed site on save
}

export const DEFAULT_REMINDERS: ReminderConfig = { enabled: true, user_ids: [], recipients: [], categories: {}, site_url: '' }

// The deployed site records its own address whenever the config is saved there,
// so the emails can link back without anyone typing a URL. Dev servers don't count.
function currentSiteUrl(fallback: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return /^https:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin) ? origin : fallback
}

/** Is a category on? Missing from the map = on. */
export const categoryOn = (rc: ReminderConfig, key: string): boolean => rc.categories[key] !== false

// The selectable categories, grouped the way they are grouped into EMAILS —
// everything of the same nature goes out at once, never one email per item.
// Keys must match supabase/functions/daily-reminders/index.ts exactly.
export interface ReminderCategory { key: string; label: string; hint: string }
export interface ReminderGroup { title: string; cats: ReminderCategory[] }
export const REMINDER_GROUPS: ReminderGroup[] = [
  {
    title: 'Vehicles & workshop',
    cats: [
      { key: 'vehicle_licensing', label: 'Vehicle licensing', hint: 'Fitness, road tax, insurance, FQM inspection… expired & expiring' },
      { key: 'vehicle_inspections', label: 'Monthly inspections', hint: 'Buses overdue or not yet scheduled this month' },
      { key: 'vehicle_service', label: 'Services (PM)', hint: 'Due or overdue by date or km' },
      { key: 'workshop_spares', label: 'Critical spares', hint: 'Stock at or below its minimum' },
    ],
  },
  {
    title: 'Driver credentials',
    cats: [
      { key: 'driver_licences', label: 'Driving licences & PSV', hint: 'Expired & expiring' },
      { key: 'safety_certs', label: 'Safety compliance & training', hint: 'Certificates expired & expiring' },
    ],
  },
  {
    title: 'Contracts & documents',
    cats: [
      { key: 'employee_contracts', label: 'Employment contracts', hint: 'From the HR employee files' },
      { key: 'company_documents', label: 'Company & library documents', hint: 'Any library document with an expiry' },
    ],
  },
  {
    title: 'Operations snapshot',
    cats: [
      { key: 'fuel_summary', label: 'Fuel stock — days left', hint: 'Daily depot summary: days of fuel, burn rate, deliveries' },
    ],
  },
]

const cfg = createSyncConfig<ReminderConfig>({
  key: 'reminder_config', lsKey: 'inzu_reminder_config', default: DEFAULT_REMINDERS,
  merge: (saved) => ({ ...DEFAULT_REMINDERS, ...saved, user_ids: saved?.user_ids ?? [], categories: saved?.categories ?? {}, site_url: saved?.site_url ?? '' }),
})

export const reminderConfigStore = {
  get: (): ReminderConfig => cfg.get(),
  subscribe: cfg.subscribe,
  set(next: ReminderConfig) {
    cfg.set({
      enabled: !!next.enabled,
      user_ids: [...new Set((next.user_ids ?? []).filter(Boolean))],
      recipients: [...new Set(next.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))],
      // keep only the OFF entries — on is the default and stays implicit
      categories: Object.fromEntries(Object.entries(next.categories ?? {}).filter(([, v]) => v === false)),
      site_url: currentSiteUrl(next.site_url ?? ''),
    })
  },
  setCategory(key: string, on: boolean) {
    const cur = cfg.get()
    this.set({ ...cur, categories: { ...cur.categories, [key]: on } })
  },
  toggleUser(id: string, on: boolean) {
    const cur = cfg.get()
    this.set({ ...cur, user_ids: on ? [...cur.user_ids, id] : cur.user_ids.filter((x) => x !== id) })
  },
}

export function useReminderConfig(): ReminderConfig {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
