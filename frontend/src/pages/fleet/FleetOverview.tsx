import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Truck, ShieldCheck, ChevronRight, Handshake, CalendarCheck, Archive, AlertOctagon } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import { useAllVehicles } from '@/lib/fleet/store'
import { useDispositions, DISPOSITION_META } from '@/lib/fleet/disposition'
import { STATUS_META, type VehicleStatus } from '@/lib/fleet/types'
import { useOperatedVehicles, OPERATED_STATUS_LABEL } from '@/lib/fleet/operated'
import { useDocuments } from '@/lib/documents/store'
import { useLicensingCats } from '@/lib/documents/licensingConfig'
import { buildLicensingRows, rowFlags, daysChip, EXPIRING_WINDOW_DAYS } from '@/lib/fleet/licensingStatus'
import { useBookings, bookingKey, bookingState } from '@/lib/fleet/inspectionBookings'

/**
 * Fleet Overview — one card per page in the section, each answering the
 * question that page exists to answer: what have we got and is it on the road
 * (Register), is the paperwork in order (Licensing), and what are we running
 * for someone else (Operated). Every number here is computed with the same
 * helpers the page itself uses, so the two can never disagree.
 */

const todayIso = () => new Date().toISOString().slice(0, 10)
const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

const STATUS_BAR: Record<VehicleStatus, string> = {
  active: 'bg-status-good', under_repair: 'bg-status-warning', grounded: 'bg-status-critical',
}

export default function FleetOverview() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const today = todayIso()

  const allVehicles = useAllVehicles()
  const disp = useDispositions()
  const docs = useDocuments()
  const cats = useLicensingCats()
  const bookings = useBookings()
  const operated = useOperatedVehicles().filter((v) => v.branch === branch)

  // The working fleet excludes retired vehicles, exactly as every other page does.
  const fleet = useMemo(() => allVehicles.filter((v) => v.branch === branch && !disp[v.id]), [allVehicles, branch, disp])
  const retired = useMemo(() => allVehicles.filter((v) => v.branch === branch && disp[v.id]), [allVehicles, branch, disp])

  // ── Vehicle Register ──
  const register = useMemo(() => {
    const by = (s: VehicleStatus) => fleet.filter((v) => v.status === s).length
    const active = by('active')
    const seats = fleet.filter((v) => v.status === 'active').reduce((s, v) => s + (v.capacity ?? 0), 0)
    const capacityMix = [...fleet.filter((v) => v.status === 'active').reduce((m, v) => {
      const cap = v.capacity ?? 0
      if (cap > 0) m.set(cap, (m.get(cap) ?? 0) + 1)
      return m
    }, new Map<number, number>()).entries()].sort((a, b) => b[0] - a[0])
    return {
      total: fleet.length, active, repair: by('under_repair'), grounded: by('grounded'), seats, capacityMix,
      availability: fleet.length ? Math.round((active / fleet.length) * 100) : 0,
    }
  }, [fleet])

  // ── Licensing — same helpers as the Licensing page, so the figures match ──
  const licensing = useMemo(() => {
    const rows = buildLicensingRows(fleet, docs, cats)
    const byFleet = new Map(fleet.map((v) => [v.fleet_no, v]))
    let expired = 0, expiring = 0, missing = 0, requiredSlots = 0, ok = 0
    const attention: { fleet: string; cat: string; expiry: string; days: number | null; tone: 'expired' | 'expiring' }[] = []
    for (const r of rows) {
      r.cells.forEach((c, i) => {
        const cat = cats[i]
        if (cat?.required) requiredSlots++
        if (c.tone === 'expired') { expired++; attention.push({ fleet: r.fleet, cat: cat.short, expiry: c.expiry, days: c.days, tone: 'expired' }); return }
        if (c.tone === 'missing') { missing++; return }
        if (c.tone === 'expiring' || c.tone === 'today') { expiring++; attention.push({ fleet: r.fleet, cat: cat.short, expiry: c.expiry, days: c.days, tone: 'expiring' }) }
        if (cat?.required) ok++
      })
    }
    const compliantVehicles = rows.filter((r) => rowFlags(r.cells).compliant).length
    // Expired first, then soonest to lapse.
    attention.sort((a, b) => (a.tone === b.tone ? (a.days ?? 0) - (b.days ?? 0) : a.tone === 'expired' ? -1 : 1))

    // Inspections still ahead of us (proposed or confirmed, not yet done).
    const upcoming: { fleet: string; date: string; confirmed: boolean }[] = []
    for (const r of rows) {
      const v = byFleet.get(r.fleet)
      if (!v) continue
      cats.forEach((cat, i) => {
        const b = bookings[bookingKey(v.id, cat.key)]
        const st = bookingState(b, r.cells[i]?.expiry || undefined, today)
        if (st === 'proposed' || st === 'confirmed') upcoming.push({ fleet: r.fleet, date: b!.date, confirmed: st === 'confirmed' })
      })
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date))
    return {
      expired, expiring, missing, attention, upcoming, compliantVehicles,
      score: requiredSlots > 0 ? Math.round((ok / requiredSlots) * 100) : 100,
    }
  }, [fleet, docs, cats, bookings, today])

  // ── Operated (contract) vehicles ──
  const operatedStats = useMemo(() => {
    const bySection = [...operated.reduce((m, v) => m.set(v.section || 'Unassigned', (m.get(v.section || 'Unassigned') ?? 0) + 1), new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
    return {
      total: operated.length,
      active: operated.filter((v) => v.status === 'active').length,
      down: operated.filter((v) => v.status !== 'active').length,
      owners: new Set(operated.map((v) => v.owner).filter(Boolean)).size,
      bySection,
    }
  }, [operated])

  const scoreTone = licensing.score >= 95 ? 'good' : licensing.score >= 80 ? 'warning' : 'critical'
  const urgent = licensing.expired + register.grounded

  return (
    <div className="page space-y-5">
      <p className="text-sm text-status-neutral">
        What {branchLabel} is running, whether it is on the road, and whether its paperwork is in order.
      </p>

      {/* One line for anything that needs acting on today */}
      {urgent > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-status-critical/30 bg-status-critical/5 px-4 py-3 text-sm">
          <AlertOctagon size={16} className="shrink-0 text-status-critical" />
          {licensing.expired > 0 && (
            <Link to="/fleet/licensing?filter=expired" className="text-navy hover:underline">
              <b className="text-status-critical">{licensing.expired}</b> document{licensing.expired === 1 ? '' : 's'} expired
            </Link>
          )}
          {register.grounded > 0 && (
            <Link to="/fleet/vehicles?status=grounded" className="text-navy hover:underline">
              <b className="text-status-critical">{register.grounded}</b> vehicle{register.grounded === 1 ? '' : 's'} grounded
            </Link>
          )}
          <span className="text-[11px] text-status-neutral">needs action today</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Vehicle Register ── */}
        <SectionCard icon={Truck} title="Vehicle Register" to="/fleet/vehicles" linkLabel="Open register">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-display text-3xl font-bold leading-none text-navy">{register.availability}%</div>
              <div className="mt-1 text-[11px] text-status-neutral">on the road — {register.active} of {register.total} vehicles</div>
            </div>
            <div className="text-right">
              <div className="font-display text-xl font-bold leading-none text-navy">{register.seats.toLocaleString()}</div>
              <div className="mt-1 text-[11px] text-status-neutral">seats available</div>
            </div>
          </div>

          {/* Status split — the register's whole story in one bar */}
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-black/5">
            {(['active', 'under_repair', 'grounded'] as VehicleStatus[]).map((s) => {
              const n = s === 'active' ? register.active : s === 'under_repair' ? register.repair : register.grounded
              return n > 0 ? <div key={s} className={clsx('h-full', STATUS_BAR[s])} style={{ width: `${(n / Math.max(1, register.total)) * 100}%` }} title={`${STATUS_META[s].label}: ${n}`} /> : null
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {(['active', 'under_repair', 'grounded'] as VehicleStatus[]).map((s) => {
              const n = s === 'active' ? register.active : s === 'under_repair' ? register.repair : register.grounded
              return (
                <span key={s} className="inline-flex items-center gap-1.5 text-status-neutral">
                  <span className={clsx('h-2 w-2 rounded-full', STATUS_BAR[s])} />
                  {STATUS_META[s].label} <b className="text-navy">{n}</b>
                </span>
              )
            })}
            {retired.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-status-neutral" title={retired.map((v) => `${v.fleet_no} — ${DISPOSITION_META[disp[v.id].kind].label}`).join('\n')}>
                <Archive size={11} /> Retired <b className="text-navy">{retired.length}</b>
              </span>
            )}
          </div>

          {register.capacityMix.length > 0 && (
            <div className="mt-4 border-t border-black/5 pt-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Active fleet by size</div>
              <div className="space-y-1.5">
                {register.capacityMix.map(([cap, n]) => (
                  <div key={cap} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 text-navy">{cap}-seat</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${(n / Math.max(1, register.active)) * 100}%` }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-status-neutral">{n} bus{n === 1 ? '' : 'es'} · {(cap * n).toLocaleString()} seats</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── Licensing & Documents ── */}
        <SectionCard icon={ShieldCheck} title="Licensing & Documents" to="/fleet/licensing" linkLabel="Open licensing">
          <div className="flex items-end justify-between">
            <div>
              <div className={clsx('font-display text-3xl font-bold leading-none', scoreTone === 'good' ? 'text-status-good' : scoreTone === 'warning' ? 'text-[#8a6d10]' : 'text-status-critical')}>
                {licensing.score}%
              </div>
              <div className="mt-1 text-[11px] text-status-neutral">of required documents valid</div>
            </div>
            <div className="text-right">
              <div className="font-display text-xl font-bold leading-none text-navy">{licensing.compliantVehicles}</div>
              <div className="mt-1 text-[11px] text-status-neutral">vehicles fully in order</div>
            </div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-black/5">
            <div className={clsx('h-full rounded-full transition-[width] duration-500', scoreTone === 'good' ? 'bg-status-good' : scoreTone === 'warning' ? 'bg-status-warning' : 'bg-status-critical')}
              style={{ width: `${licensing.score}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-status-neutral">
            <span>Expired <b className={licensing.expired ? 'text-status-critical' : 'text-navy'}>{licensing.expired}</b></span>
            <span>Due in {EXPIRING_WINDOW_DAYS} days <b className={licensing.expiring ? 'text-[#8a6d10]' : 'text-navy'}>{licensing.expiring}</b></span>
            <span>Not on file <b className={licensing.missing ? 'text-[#7f1d1d]' : 'text-navy'}>{licensing.missing}</b></span>
          </div>

          <div className="mt-4 border-t border-black/5 pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Renew next</div>
            {licensing.attention.length === 0 ? (
              <p className="py-3 text-center text-xs text-status-neutral">Nothing expired or expiring — all current.</p>
            ) : (
              <div className="space-y-1">
                {licensing.attention.slice(0, 5).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 font-medium text-navy">{a.fleet}</span>
                    <span className="min-w-0 flex-1 truncate text-status-neutral">{a.cat}</span>
                    <span className="text-[10px] text-status-neutral">{a.expiry ? shortDate(a.expiry) : ''}</span>
                    <span className={clsx('w-12 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold',
                      a.tone === 'expired' ? 'bg-status-critical/15 text-status-critical' : 'bg-status-warning/20 text-[#8a6d10]')}>
                      {daysChip({ expiry: a.expiry, days: a.days, status: '', tone: a.tone })}
                    </span>
                  </div>
                ))}
                {licensing.attention.length > 5 && (
                  <Link to="/fleet/licensing?filter=expired" className="block pt-1 text-[11px] text-brand hover:underline">
                    +{licensing.attention.length - 5} more to renew
                  </Link>
                )}
              </div>
            )}
          </div>

          {licensing.upcoming.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-tint/40 px-3 py-2 text-[11px] text-navy">
              <CalendarCheck size={13} className="text-brand" />
              <b>{licensing.upcoming.length}</b> inspection{licensing.upcoming.length === 1 ? '' : 's'} booked
              <span className="text-status-neutral">next {shortDate(licensing.upcoming[0].date)} · {licensing.upcoming[0].fleet}</span>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Operated (contract) vehicles ── */}
      <SectionCard icon={Handshake} title="Operated Vehicles" to="/fleet/operated" linkLabel="Open operated vehicles"
        note="Vehicles we crew but do not own — no documents required from us.">
        {operatedStats.total === 0 ? (
          <p className="py-3 text-sm text-status-neutral">No contract vehicles recorded for {branchLabel}.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="font-display text-2xl font-bold leading-none text-navy">{operatedStats.total}</div>
              <div className="mt-1 text-[11px] text-status-neutral">under our crews · {operatedStats.owners} owner{operatedStats.owners === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="font-display text-2xl font-bold leading-none text-status-good">{operatedStats.active}</div>
              <div className="mt-1 text-[11px] text-status-neutral">{OPERATED_STATUS_LABEL.active.toLowerCase()}</div>
            </div>
            {operatedStats.down > 0 && (
              <div>
                <div className="font-display text-2xl font-bold leading-none text-[#8a6d10]">{operatedStats.down}</div>
                <div className="mt-1 text-[11px] text-status-neutral">not available</div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {operatedStats.bySection.map(([section, n]) => (
                <span key={section} className="rounded-full bg-navy/5 px-2.5 py-1 text-[11px] text-navy">{section} <b>{n}</b></span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

/** A card that summarises one page of the section and links straight to it. */
function SectionCard({ icon: Icon, title, to, linkLabel, note, children }: {
  icon: typeof Truck; title: string; to: string; linkLabel: string; note?: string; children: React.ReactNode
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-brand" />
        <h2 className="font-display text-sm font-bold text-navy">{title}</h2>
        <Link to={to} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          {linkLabel} <ChevronRight size={13} />
        </Link>
      </div>
      {note && <p className="-mt-1.5 mb-3 text-[11px] text-status-neutral">{note}</p>}
      {children}
    </section>
  )
}
