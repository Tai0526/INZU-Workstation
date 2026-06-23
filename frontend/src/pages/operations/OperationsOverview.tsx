import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Lock, Gauge, CalendarClock } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import { TRIP_LABEL } from '@/lib/operations/types'
import { useAllocations } from '@/lib/operations/store'
import { useIssuances, useFuelRate } from '@/lib/fuel/store'
import { kmMoved, isOpen, pricePerLitre } from '@/lib/fuel/types'
import { useMileageTrips, useMileageRates } from '@/lib/mileage/store'
import { tripKm, rateFor } from '@/lib/mileage/types'

const NAVY = '#0F1B33', GOOD = '#2E7D4F', AMBER = '#C9A227', CRIT = '#B3261E', GRID = 'rgba(15,27,51,0.06)'
const tip = { borderRadius: 10, border: '1px solid #eee', fontSize: 12 }
const monthKey = (d: string) => d.slice(0, 7)
const monthLabel = (k: string) => { if (!k) return '—'; const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: 'numeric' }) }
const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`
// Compact tick labels so axes stay readable at fleet scale (e.g. 15k, 1.2M).
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

interface BusRow {
  bus: string; reg: string
  paidKm: number; drivenKm: number; unpaidKm: number; paidRatio: number | null
  litres: number; economy: number | null
  fuelCost: number; revenue: number; margin: number; fuelShare: number | null
}

function ratioTone(r: number | null): 'good' | 'warning' | 'critical' | 'neutral' {
  if (r == null) return 'neutral'
  if (r >= 0.9) return 'good'
  if (r >= 0.75) return 'warning'
  return 'critical'
}

/** Sticky chart legend (kept outside the scroll area so it stays visible on tall fleets). */
function ChartKey({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-2 flex gap-4 text-[11px] text-status-neutral">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
      ))}
    </div>
  )
}

export default function OperationsOverview() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const trips = useMileageTrips().filter((t) => t.branch === branch)
  const issuances = useIssuances().filter((i) => i.branch === branch)
  const allocations = useAllocations().filter((a) => a.branch === branch)
  const rates = useMileageRates(branch)

  const curMonth = new Date().toISOString().slice(0, 7)
  const months = useMemo(() => {
    const s = new Set<string>([curMonth, ...trips.map((t) => monthKey(t.date)), ...issuances.map((i) => monthKey(i.date))])
    return [...s].filter(Boolean).sort().reverse()
  }, [trips, issuances])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : curMonth

  const fuelRate = useFuelRate(branch, effMonth)
  const priceUSD = pricePerLitre(fuelRate, 'USD')

  const perBus = useMemo<BusRow[]>(() => {
    const mTrips = trips.filter((t) => monthKey(t.date) === effMonth)
    const mIss = issuances.filter((i) => monthKey(i.date) === effMonth)
    const map = new Map<string, BusRow & { litresClosed: number }>()
    const get = (bus: string, reg: string) => {
      let r = map.get(bus)
      if (!r) { r = { bus, reg, paidKm: 0, drivenKm: 0, unpaidKm: 0, paidRatio: null, litres: 0, litresClosed: 0, economy: null, fuelCost: 0, revenue: 0, margin: 0, fuelShare: null }; map.set(bus, r) }
      if (reg && !r.reg) r.reg = reg
      return r
    }
    // Mileage = the billable (paid) kilometres + revenue
    for (const t of mTrips) {
      const r = get(t.fleet_no, t.vehicle_reg)
      const km = tripKm(t)
      r.paidKm += km
      r.revenue += km * rateFor(rates, t.seat_class)
    }
    // Fuel = the real distance driven (odometer between refuels) + fuel spend
    for (const i of mIss) {
      const r = get(i.fleet_no, i.vehicle_reg)
      r.litres += i.liters_given
      r.fuelCost += i.liters_given * priceUSD
      if (!isOpen(i)) { r.drivenKm += kmMoved(i); r.litresClosed += i.liters_given }
    }
    return [...map.values()].map((r) => ({
      ...r,
      unpaidKm: Math.max(0, r.drivenKm - r.paidKm),
      paidRatio: r.drivenKm > 0 ? r.paidKm / r.drivenKm : null,
      economy: r.litresClosed > 0 ? r.drivenKm / r.litresClosed : null,
      margin: r.revenue - r.fuelCost,
      fuelShare: r.revenue > 0 ? r.fuelCost / r.revenue : null,
    }))
  }, [trips, issuances, rates, priceUSD, effMonth])

  const totals = useMemo(() => {
    const paidKm = perBus.reduce((s, b) => s + b.paidKm, 0)
    const drivenKm = perBus.reduce((s, b) => s + b.drivenKm, 0)
    const litres = perBus.reduce((s, b) => s + b.litres, 0)
    const fuelCost = perBus.reduce((s, b) => s + b.fuelCost, 0)
    const revenue = perBus.reduce((s, b) => s + b.revenue, 0)
    const economies = perBus.map((b) => b.economy).filter((e): e is number => e != null)
    return {
      paidKm, drivenKm, litres, fuelCost, revenue,
      unpaidKm: Math.max(0, drivenKm - paidKm),
      paidRatio: drivenKm > 0 ? paidKm / drivenKm : null,
      avgEconomy: economies.length ? economies.reduce((s, e) => s + e, 0) / economies.length : null,
      fuelShare: revenue > 0 ? fuelCost / revenue : null,
    }
  }, [perBus])

  // Planning snapshot (Bus Allocation) — how buses moved & when
  const planning = useMemo(() => {
    const mAlloc = allocations.filter((a) => monthKey(a.date) === effMonth)
    const times = mAlloc.map((a) => a.departure_time).filter(Boolean).sort()
    return {
      runs: mAlloc.length,
      pickups: mAlloc.filter((a) => a.trip_type === 'pickup').length,
      knockoffs: mAlloc.filter((a) => a.trip_type === 'knockoff').length,
      pax: mAlloc.reduce((s, a) => s + (a.passengers ?? 0), 0),
      plannedKm: mAlloc.reduce((s, a) => s + a.planned_km, 0),
      first: times[0] ?? '—', last: times[times.length - 1] ?? '—',
    }
  }, [allocations, effMonth])

  const tableRows = useMemo(() => [...perBus].sort((a, b) => (a.paidRatio ?? 2) - (b.paidRatio ?? 2)), [perBus])
  // Horizontal bars, largest first — readable whether there are 4 buses or 50.
  const chartPaid = useMemo(() => [...perBus].sort((a, b) => (b.paidKm + b.unpaidKm) - (a.paidKm + a.unpaidKm)).map((b) => ({ bus: b.bus, paid: b.paidKm, unpaid: b.unpaidKm })), [perBus])
  const chartMoney = useMemo(() => [...perBus].sort((a, b) => b.revenue - a.revenue).map((b) => ({ bus: b.bus, revenue: Math.round(b.revenue), fuel: Math.round(b.fuelCost) })), [perBus])
  const worst = tableRows.filter((b) => b.paidRatio != null && b.paidRatio < 0.85)
  const paidChartH = Math.max(200, chartPaid.length * 30 + 12)
  const moneyChartH = Math.max(200, chartMoney.length * 40 + 12)

  // Route Supervisors cannot see operational summaries (spec §4.3.3) — guard AFTER hooks.
  if (role === 'route_supervisor') {
    return (
      <div className="page">
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center text-status-neutral">
          <Lock size={26} /><p className="text-sm">Operational summaries aren't part of the Route Supervisor view.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Three independent figures, reconciled: the <b className="text-navy">plan</b> (how buses moved), the <b className="text-navy">paid</b> kilometres FQM is billed (Mileage), and the <b className="text-navy">driven</b> kilometres the fuel odometer proves. The gap between driven and paid — plus what fuel costs to cover it — is where efficiency lives.
        </p>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-status-neutral">Month
          <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand">
            {months.length === 0 && <option value="">—</option>}
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Paid km" value={totals.paidKm.toLocaleString()} highlight info="Billable kilometres entered in Mileage — only paid distance is logged there." sub="billed to FQM" />
        <KpiCard label="Driven km" value={totals.drivenKm.toLocaleString()} info="Real distance from the fuel odometer (between refuels)." sub="odometer (fuel)" />
        <KpiCard label="Unpaid km" value={totals.unpaidKm.toLocaleString()} tone={totals.unpaidKm > 0 ? 'warning' : 'good'} info="Driven − paid: distance covered that nobody is billed for." sub={totals.drivenKm ? `${Math.round((totals.unpaidKm / totals.drivenKm) * 100)}% of driven` : '—'} />
        <KpiCard label="Paid ratio" value={totals.paidRatio != null ? `${Math.round(totals.paidRatio * 100)}%` : '—'} tone={ratioTone(totals.paidRatio)} info="Paid ÷ driven. Higher = less unbilled running." sub="paid ÷ driven" />
        <KpiCard label="Avg economy" value={totals.avgEconomy != null ? `${totals.avgEconomy.toFixed(1)} km/L` : '—'} info="Driven km per litre, averaged across buses." sub={`${Math.round(totals.litres).toLocaleString()} L used`} />
        <KpiCard label="Fuel vs revenue" value={totals.fuelShare != null ? `${Math.round(totals.fuelShare * 100)}%` : '—'} tone={totals.fuelShare == null ? 'neutral' : totals.fuelShare > 0.5 ? 'critical' : totals.fuelShare > 0.35 ? 'warning' : 'good'} info="Fuel cost as a share of mileage revenue. Lower is healthier." sub={`${usd0(totals.fuelCost)} fuel · ${usd0(totals.revenue)} billed`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Paid vs unpaid distance by bus</h3>
          <p className="mb-2 text-[11px] text-status-neutral">Green is billed; amber is driven but not billed. A long amber bar is a bus running km no one pays for.</p>
          <ChartKey items={[[GOOD, 'Paid'], [AMBER, 'Unpaid']]} />
          <div className="max-h-[360px] overflow-y-auto pr-1">
            <div style={{ height: paidChartH }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={chartPaid} margin={{ top: 4, right: 12, bottom: 4, left: 6 }} barCategoryGap={6}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={compact} />
                  <YAxis type="category" dataKey="bus" width={62} interval={0} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tip} formatter={(v: number, n) => [`${v.toLocaleString()} km`, n]} />
                  <Bar dataKey="paid" name="Paid" stackId="km" fill={GOOD} maxBarSize={18} />
                  <Bar dataKey="unpaid" name="Unpaid" stackId="km" fill={AMBER} maxBarSize={18} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Fuel cost vs mileage revenue by bus</h3>
          <p className="mb-2 text-[11px] text-status-neutral">What each bus earns (billed) against what its fuel costs — the contribution after fuel.</p>
          <ChartKey items={[[GOOD, 'Revenue'], [CRIT, 'Fuel cost']]} />
          <div className="max-h-[360px] overflow-y-auto pr-1">
            <div style={{ height: moneyChartH }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={chartMoney} margin={{ top: 4, right: 12, bottom: 4, left: 6 }} barCategoryGap={6}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${compact(v)}`} />
                  <YAxis type="category" dataKey="bus" width={62} interval={0} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tip} formatter={(v: number, n) => [usd0(v), n]} />
                  <Bar dataKey="revenue" name="Revenue" fill={GOOD} maxBarSize={9} radius={[0, 2, 2, 0]} />
                  <Bar dataKey="fuel" name="Fuel cost" fill={CRIT} maxBarSize={9} radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Per-bus efficiency table — worst paid ratio first */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Gauge size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Efficiency by bus — {monthLabel(effMonth)}</h3><span className="text-xs text-status-neutral">worst paid-ratio first</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Bus</th>
                <th className="px-4 py-2.5 font-medium">Paid km</th><th className="px-4 py-2.5 font-medium">Driven km</th>
                <th className="px-4 py-2.5 font-medium">Unpaid</th><th className="px-4 py-2.5 font-medium">Paid %</th>
                <th className="px-4 py-2.5 font-medium">km/L</th><th className="px-4 py-2.5 font-medium">Fuel cost</th>
                <th className="px-4 py-2.5 font-medium">Revenue</th><th className="px-4 py-2.5 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((b, i) => (
                <tr key={b.bus} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-4 py-2 text-left font-medium text-navy">{b.bus}<span className="ml-1 text-[11px] text-status-neutral">{b.reg}</span></td>
                  <td className="px-4 py-2 text-status-neutral">{b.paidKm.toLocaleString()}</td>
                  <td className="px-4 py-2 text-status-neutral">{b.drivenKm.toLocaleString()}</td>
                  <td className={clsx('px-4 py-2', b.unpaidKm > 0 ? 'text-[#8a6d10]' : 'text-status-neutral')}>{b.unpaidKm.toLocaleString()}</td>
                  <td className="px-4 py-2">{b.paidRatio != null ? <StatusBadge tone={ratioTone(b.paidRatio)}>{Math.round(b.paidRatio * 100)}%</StatusBadge> : <span className="text-status-neutral">—</span>}</td>
                  <td className="px-4 py-2 text-status-neutral">{b.economy != null ? b.economy.toFixed(1) : '—'}</td>
                  <td className="px-4 py-2 text-status-neutral">{usd0(b.fuelCost)}</td>
                  <td className="px-4 py-2 text-status-neutral">{usd0(b.revenue)}</td>
                  <td className={clsx('px-4 py-2 font-medium', b.margin >= 0 ? 'text-status-good' : 'text-status-critical')}>{usd0(b.margin)}</td>
                </tr>
              ))}
              {tableRows.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-status-neutral">No mileage or fuel data for {monthLabel(effMonth)}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Buses to steer */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Gauge size={16} className="text-status-critical" /><h3 className="font-display text-sm font-bold text-navy">Buses to steer</h3></div>
          {worst.length === 0 ? <p className="px-5 py-8 text-center text-sm text-status-neutral">Every bus is billing most of what it drives. Nothing to flag.</p> : (
            <div className="divide-y divide-black/5">
              {worst.map((b) => (
                <div key={b.bus} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                  <span className="flex-1 text-sm font-medium text-navy">{b.bus}</span>
                  <StatusBadge tone={ratioTone(b.paidRatio)}>{Math.round((b.paidRatio ?? 0) * 100)}% paid</StatusBadge>
                  <span className="text-[11px] text-status-neutral">{b.unpaidKm.toLocaleString()} km unbilled · {b.economy != null ? `${b.economy.toFixed(1)} km/L` : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Planning activity */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><CalendarClock size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Planning activity</h3><span className="text-xs text-status-neutral">from Bus Allocation</span></div>
          <div className="grid grid-cols-2 gap-px bg-black/5 sm:grid-cols-3">
            {[
              ['Runs', planning.runs.toLocaleString()],
              ['Pickups', planning.pickups.toLocaleString()],
              ['Knock-offs', planning.knockoffs.toLocaleString()],
              ['Passengers', planning.pax.toLocaleString()],
              ['Planned km', planning.plannedKm.toLocaleString()],
              ['Departure window', `${planning.first}–${planning.last}`],
            ].map(([label, val]) => (
              <div key={label} className="bg-surface px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-status-neutral">{label}</div>
                <div className="mt-0.5 text-lg font-bold text-navy">{val}</div>
              </div>
            ))}
          </div>
          <p className="px-5 py-3 text-[11px] text-status-neutral">{TRIP_LABEL.pickup}s and {TRIP_LABEL.knockoff.toLowerCase()}s logged for the month — how the fleet moved and when.</p>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only — comparative branch toggling here is a senior-management tool.</p>}
    </div>
  )
}
