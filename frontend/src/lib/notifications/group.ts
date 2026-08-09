import type { AppNotification } from './store'

/**
 * Date-grouping for the notification panel: newest first, so the feed reads
 * top-down like "what just happened".
 *
 *   Upcoming  — future-dated deadlines (expiring licences, reviews, contracts),
 *               soonest first. Kept as ONE section at the top: they are the
 *               only forward-looking items and must not drown between old days.
 *   Today / Yesterday / older days — descending, urgent first within each day.
 *   Earlier   — anything without a usable date (defensive; rare).
 */

export type NotifGroup<T> = { key: string; label: string; sub?: string; items: T[] }

const SEV_RANK: Record<AppNotification['severity'], number> = { critical: 0, warning: 1, info: 2 }

function fmtDay(day: string, todayYear: string): string {
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
  if (day.slice(0, 4) !== todayYear) opts.year = 'numeric' // cross-year dates say which year
  return d.toLocaleDateString('en', opts)
}

export function groupNotifications<T extends AppNotification>(items: T[], today: string): NotifGroup<T>[] {
  // Date-only arithmetic in UTC end to end — parsing local ("T00:00:00") and
  // formatting UTC (toISOString) would shift the date on any UTC+ machine.
  const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
  const buckets = new Map<string, T[]>()
  for (const n of items) {
    const day = (n.date || '').slice(0, 10)
    const key = /^\d{4}-\d{2}-\d{2}$/.test(day) ? (day > today ? 'upcoming' : day) : 'earlier'
    const arr = buckets.get(key)
    if (arr) arr.push(n)
    else buckets.set(key, [n])
  }

  const urgentThenLatest = (a: T, b: T) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.date.localeCompare(a.date)
  const groups: NotifGroup<T>[] = []
  const todayYear = today.slice(0, 4)

  const up = buckets.get('upcoming')
  if (up) {
    up.sort((a, b) => a.date.localeCompare(b.date) || SEV_RANK[a.severity] - SEV_RANK[b.severity]) // soonest deadline first
    groups.push({ key: 'upcoming', label: 'Upcoming', sub: 'deadlines ahead', items: up })
  }

  const days = [...buckets.keys()].filter((k) => k !== 'upcoming' && k !== 'earlier').sort().reverse()
  for (const k of days) {
    const arr = buckets.get(k)!
    arr.sort(urgentThenLatest)
    groups.push({
      key: k,
      label: k === today ? 'Today' : k === yesterday ? 'Yesterday' : fmtDay(k, todayYear),
      sub: k === today || k === yesterday ? fmtDay(k, todayYear) : undefined,
      items: arr,
    })
  }

  const earlier = buckets.get('earlier')
  if (earlier) {
    earlier.sort(urgentThenLatest)
    groups.push({ key: 'earlier', label: 'Earlier', items: earlier })
  }
  return groups
}
