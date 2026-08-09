import { useSyncExternalStore } from 'react'
import { createSyncConfig } from '@/lib/supabase/syncTable'
import { getActor } from '@/lib/audit/actor'

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
