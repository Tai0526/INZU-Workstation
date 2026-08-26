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
 *
 * `audiences` targets a category at its OWN people (safety things to Safety,
 * fuel to the fuel supervisor…): a category with an entry here goes ONLY to
 * that list; without one it goes to the default list. Categories of the same
 * nature still share one email when their recipients end up identical — a
 * differently-targeted category simply becomes its own email to its own people.
 */

export interface ReminderAudience { user_ids: string[]; recipients: string[] }

export interface ReminderConfig {
  enabled: boolean
  user_ids: string[] // default list: Workstation users — resolved to their account email at send time
  recipients: string[] // default list: extra addresses for people without an account
  categories: Record<string, boolean>
  audiences: Record<string, ReminderAudience> // per-category recipients; missing key = default list
  site_url: string // where "log in for details" points; stamped from the deployed site on save
}

export const DEFAULT_REMINDERS: ReminderConfig = { enabled: true, user_ids: [], recipients: [], categories: {}, audiences: {}, site_url: '' }

/** Is a category on? Missing from the map = on. */
export const categoryOn = (rc: ReminderConfig, key: string): boolean => rc.categories[key] !== false

// The deployed site records its own address whenever the config is saved there,
// so the emails can link back without anyone typing a URL. Dev servers don't count.
function currentSiteUrl(fallback: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return /^https:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin) ? origin : fallback
}

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
    title: 'Safety',
    cats: [
      { key: 'open_incidents', label: 'Open incidents', hint: 'Incidents still under review — how long each has waited to be closed' },
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

const cleanEmails = (list: string[] | undefined) =>
  [...new Set((list ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean))]

const cfg = createSyncConfig<ReminderConfig>({
  key: 'reminder_config', lsKey: 'inzu_reminder_config', default: DEFAULT_REMINDERS,
  merge: (saved) => ({
    ...DEFAULT_REMINDERS, ...saved,
    user_ids: saved?.user_ids ?? [], categories: saved?.categories ?? {},
    audiences: saved?.audiences ?? {}, site_url: saved?.site_url ?? '',
  }),
})

export const reminderConfigStore = {
  get: (): ReminderConfig => cfg.get(),
  subscribe: cfg.subscribe,
  set(next: ReminderConfig) {
    // Audience entries with nobody in them mean "back to the default list".
    const audiences: Record<string, ReminderAudience> = {}
    for (const [k, a] of Object.entries(next.audiences ?? {})) {
      const user_ids = [...new Set((a?.user_ids ?? []).filter(Boolean))]
      const recipients = cleanEmails(a?.recipients)
      if (user_ids.length || recipients.length) audiences[k] = { user_ids, recipients }
    }
    cfg.set({
      enabled: !!next.enabled,
      user_ids: [...new Set((next.user_ids ?? []).filter(Boolean))],
      recipients: cleanEmails(next.recipients),
      // keep only the OFF entries — on is the default and stays implicit
      categories: Object.fromEntries(Object.entries(next.categories ?? {}).filter(([, v]) => v === false)),
      audiences,
      site_url: currentSiteUrl(next.site_url ?? ''),
    })
  },
  setCategory(key: string, on: boolean) {
    const cur = cfg.get()
    this.set({ ...cur, categories: { ...cur.categories, [key]: on } })
  },
  /** Give a category its own recipients; null returns it to the default list. */
  setAudience(key: string, audience: ReminderAudience | null) {
    const cur = cfg.get()
    const audiences = { ...cur.audiences }
    if (audience) audiences[key] = audience
    else delete audiences[key]
    this.set({ ...cur, audiences })
  },
}

export function useReminderConfig(): ReminderConfig {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
