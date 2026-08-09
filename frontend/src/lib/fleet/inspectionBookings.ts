import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { getActor } from '@/lib/audit/actor'
import type { CellTone } from './licensingStatus'

/**
 * Inspection bookings — when we intend to present a vehicle for a document to
 * be renewed or inspected (chiefly the FQM inspection, but any category works).
 *
 * This is OUR side of the arrangement: the date we propose, whether the other
 * party has confirmed it, and any note. It is deliberately separate from the
 * document record itself — a booking is a plan, the document is the evidence.
 * Once the renewed document is uploaded, its new expiry naturally moves past
 * the booking, and `bookingState` reports the booking as done.
 *
 * Stored migration-free in app_config as `${vehicleId}:${categoryKey}`.
 */

export type BookingStatus = 'proposed' | 'confirmed'

export interface Booking {
  date: string // yyyy-mm-dd — when we intend to present the vehicle
  status: BookingStatus
  note: string
  by: string
  at: string
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  proposed: 'Proposed', confirmed: 'Confirmed',
}

const cfg = createSyncConfig<Record<string, Booking>>({
  key: 'inspection_bookings', lsKey: 'inzu_inspection_bookings', default: {},
})

export const bookingKey = (vehicleId: string, cat: string) => `${vehicleId}:${cat}`

export const bookingsStore = {
  get: (): Record<string, Booking> => cfg.get(),
  subscribe: cfg.subscribe,
  /** Book (or re-book) a vehicle for a category. Empty date clears the booking. */
  set(vehicleId: string, cat: string, patch: { date: string; status?: BookingStatus; note?: string }) {
    const all = { ...cfg.get() }
    const k = bookingKey(vehicleId, cat)
    if (!patch.date) { delete all[k]; cfg.set(all); return }
    const prev = all[k]
    all[k] = {
      date: patch.date,
      status: patch.status ?? prev?.status ?? 'proposed',
      note: patch.note ?? prev?.note ?? '',
      by: getActor().name,
      at: new Date().toISOString(),
    }
    cfg.set(all)
  },
  clear(vehicleId: string, cat: string) {
    const all = { ...cfg.get() }
    delete all[bookingKey(vehicleId, cat)]
    cfg.set(all)
  },
  /** Save several at once — one write, so a bulk booking can't half-apply. */
  setMany(entries: { vehicleId: string; cat: string; date: string; status?: BookingStatus; note?: string }[]) {
    const all = { ...cfg.get() }
    const now = new Date().toISOString()
    const who = getActor().name
    for (const e of entries) {
      const k = bookingKey(e.vehicleId, e.cat)
      if (!e.date) { delete all[k]; continue }
      const prev = all[k]
      all[k] = { date: e.date, status: e.status ?? prev?.status ?? 'proposed', note: e.note ?? prev?.note ?? '', by: who, at: now }
    }
    cfg.set(all)
  },
}

export function useBookings(): Record<string, Booking> {
  return useSyncExternalStore(cfg.subscribe, cfg.get, cfg.get)
}

// ── Auto-scheduling ─────────────────────────────────────────────────────────

/**
 * Order in which vehicles claim inspection slots.
 *
 * Expiring-soon come FIRST — they still hold a valid document and a deadline we
 * can beat, so they get first refusal on the days before they lapse. Expired and
 * missing have no deadline left to protect (the damage is done), so they fill
 * the earliest free days instead — which in practice means they get seen soonest.
 * Everything still valid comes last.
 */
export function bookingPriority(tone: CellTone): number {
  if (tone === 'expiring' || tone === 'today') return 0
  if (tone === 'expired') return 1
  if (tone === 'missing') return 2
  return 3
}

export interface ScheduleItem {
  id: string
  expiry: string // '' when there is no document
  tone: CellTone
  days: number | null
}

const dayShiftIso = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

/**
 * Assign an inspection date to each vehicle: the working day BEFORE it expires
 * where possible (the last chance to renew in time), walking earlier if that day
 * is already full, and falling back to the earliest free day for anything with
 * no deadline left. `perDay` caps how many vehicles a day can take.
 *
 * Pure and deterministic — unit-tested.
 */
export function autoSchedule(items: ScheduleItem[], opts: { start: string; perDay: number; skipWeekends?: boolean }): Record<string, string> {
  const perDay = Math.max(1, Math.floor(opts.perDay) || 1)
  const skipWeekends = opts.skipWeekends !== false
  const load = new Map<string, number>()
  const out: Record<string, string> = {}

  const ordered = [...items].sort((a, b) =>
    bookingPriority(a.tone) - bookingPriority(b.tone)
    || (a.days ?? 99_999) - (b.days ?? 99_999)
    || a.id.localeCompare(b.id, undefined, { numeric: true }))

  const workday = (iso: string) => {
    if (!skipWeekends) return true
    const d = new Date(`${iso}T00:00:00Z`).getUTCDay()
    return d !== 0 && d !== 6
  }
  const free = (iso: string) => (load.get(iso) ?? 0) < perDay

  for (const it of ordered) {
    // The day before it lapses — book it and the document never goes out of date.
    const ideal = it.expiry ? dayShiftIso(it.expiry, -1) : opts.start
    let slot: string | null = null
    if (ideal >= opts.start) {
      for (let d = ideal; d >= opts.start; d = dayShiftIso(d, -1)) {
        if (workday(d) && free(d)) { slot = d; break }
      }
    }
    // Already lapsed, or every day before the deadline is full: earliest free day.
    for (let d = opts.start; !slot; d = dayShiftIso(d, 1)) {
      if (workday(d) && free(d)) slot = d
    }
    load.set(slot, (load.get(slot) ?? 0) + 1)
    out[it.id] = slot
  }
  return out
}

export type BookingState = 'none' | 'proposed' | 'confirmed' | 'overdue' | 'done'

/**
 * What a booking means right now, given the document it covers.
 *  done     — the document now expires after the booking date; it was renewed.
 *  overdue  — the booked day has passed and the document still needs work.
 *  proposed / confirmed — still ahead of us.
 */
export function bookingState(booking: Booking | undefined, docExpiry: string | undefined, today: string): BookingState {
  if (!booking) return 'none'
  if (docExpiry && docExpiry > booking.date) return 'done'
  if (booking.date < today) return 'overdue'
  return booking.status
}
