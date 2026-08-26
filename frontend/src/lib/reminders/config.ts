import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'

/**
 * Daily email reminders — the settings half.
 *
 * The digests themselves are sent by the `daily-reminders` Edge Function on a
 * morning schedule (see supabase/migrations/0008_daily_reminders.sql). It reads
 * THIS app_config row for who to send to and whether it is on — so the Admin
 * page and the sender can never disagree.
 */

export interface ReminderConfig {
  enabled: boolean
  recipients: string[]
}

export const DEFAULT_REMINDERS: ReminderConfig = { enabled: true, recipients: [] }

const cfg = createSyncConfig<ReminderConfig>({
  key: 'reminder_config', lsKey: 'inzu_reminder_config', default: DEFAULT_REMINDERS,
})

export const reminderConfigStore = {
  get: (): ReminderConfig => cfg.get(),
  subscribe: cfg.subscribe,
  set(next: ReminderConfig) {
    cfg.set({
      enabled: !!next.enabled,
      recipients: [...new Set(next.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))],
    })
  },
}

export function useReminderConfig(): ReminderConfig {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}
