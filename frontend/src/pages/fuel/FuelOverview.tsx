import { useMemo, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts'
import { Lock, Fuel as FuelIcon, Zap, Users, TrendingUp, TrendingDown } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import { useIssuances, useGenFuel, useFuelRate, getFuelRate } from '@/lib/fuel/store'
import { type Currency, DRAW_LABEL, isApprovedDraw, isOpen, kmMoved, pricePerLitre, money } from '@/lib/fuel/types'
import { useMileageTrips } from '@/lib/mileage/store'
import { PROJECTS_BY_BRANCH, type MileageTrip } from '@/lib/mileage/types'
import { busProjectKm, projectShares, busSectionLabel } from '@/lib/mileage/profit'

/**
 * Fuel Overview — WHO the fuel goes to, month by month: each section's buses
 * (Enterprise / Sentinel, attributed via their mileage project), the workshop
 * generator and authorised visitor vehicles. Litres, cost at the month's
 * price, economy, and how each group moved vs last month.
 *
 * Deliberately no revenue here — profitability lives in Mileage → Overview.
 */

const NAVY = '#0F1B33', BRAND = '#D16B21', GOOD = '#2E7D4F', AMBER = '#C9A227', NEUTRAL = '#6B7280', GRID = 'rgba(15,27,51,0.06)'
const GROUP_COLORS = [NAVY, BRAND, GOOD, AMBER, '#7C3AED', NEUTRAL]
const tip = { borderRadius: 10, border: '1px solid #eee', fontSize: 12 }
const monthKey = (d: string) => d.slice(0, 7)
const monthLabel = (k: string) => { if (!k) return '—'; const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: 'numeric' }) }
const prevMonth = (k: string) => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) }
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

interface Group {
  key: string
  label: string
  kind: 'section' | 'generator' | 'visitor'
  litres: number
  cost: number
  buses: Set<string>
  km: number
  litresClosed: number
  split: boolean // part of this group's fuel is a km-share estimate from split buses
}

function newGroup(key: string, label: string, kind: Group['kind']): Group {
  return { key, label, kind, litres: 0, cost: 0, buses: new Set(), km: 0, litresClosed: 0, split: false }
}

/**
 * Litres per group for one month (pure aggregation, reused for the delta).
 * A bus that drove for more than one project that month has its fuel, km and
 * litres DISTRIBUTED across those projects in proportion to the km it ran for
 * each (same rule as Mileage → Overview). Buses with no trips that month fall
 * back to their most recent attribution, whole.
 */
function aggregate(
  month: string,
  issuances: ReturnType<typeof useIssuances>,
  draws: ReturnType<typeof useGenFuel>,
  trips: MileageTrip[],
  fallbackOf: (fleet: string) => string,
  sections: string[],
  price: number,
): Map<string, Group> {
  const groups = new Map<string, Group>()
  for (const s of sections) groups.set(s, newGroup(s, `${s} buses`, 'section'))
  groups.set('__unassigned', newGroup('__unassigned', 'Other buses', 'section'))
  groups.set('__generator', newGroup('__generator', 'Workshop generator', 'generator'))
  groups.set('__visitor', newGroup('__visitor', 'Authorised vehicles', 'visitor'))

  const weights = busProjectKm(trips.filter((t) => monthKey(t.date) === month))

  for (const i of issuances) {
    if (monthKey(i.date) !== month) continue
    const shares = projectShares(weights, i.fleet_no)
      ?? [{ project: fallbackOf(i.fleet_no), share: 1 }]
    for (const { project, share } of shares) {
      const g = groups.get(project) ?? groups.get('__unassigned')!
      g.litres += i.liters_given * share
      g.cost += i.liters_given * share * price
      g.buses.add(i.fleet_no)
      if (!isOpen(i)) { g.km += kmMoved(i) * share; g.litresClosed += i.liters_given * share }
      if (shares.length > 1) g.split = true
    }
  }
  for (const d of draws) {
    if (monthKey(d.date) !== month || !isApprovedDraw(d)) continue
    const g = groups.get(d.kind === 'generator' ? '__generator' : '__visitor')!
    g.litres += d.litres
    g.cost += d.litres * price
    g.buses.add(d.recipient)
  }
  return groups
}

export default function FuelOverview() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const issuances = useIssuances().filter((i) => i.branch === branch)
  const draws = useGenFuel().filter((g) => g.branch === branch)
  const trips = useMileageTrips().filter((t) => t.branch === branch)
  const sections = PROJECTS_BY_BRANCH[branch]

  const curMonth = new Date().toISOString().slice(0, 7)
  const dataMonths = useMemo(
    () => [...new Set([...issuances.map((i) => monthKey(i.date)), ...draws.map((d) => monthKey(d.date))])].sort().reverse(),
    [issuances, draws],
  )
  const months = useMemo(() => [...new Set([curMonth, ...dataMonths])].sort().reverse(), [curMonth, dataMonths])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : (dataMonths[0] ?? curMonth)
  const [cur, setCur] = useState<Currency>('USD')

  const rate = useFuelRate(branch, effMonth)
  const price = pricePerLitre(rate, cur)

  // Fallback for a bus with NO trips in the viewed month: its most recent
  // attribution, whole — so a bus that fuelled without logging mileage still
  // lands in its usual section. (Buses WITH trips are distributed by km share.)
  const fallbackOf = useMemo(() => {
    const latest = new Map<string, { date: string; project: string }>()
    for (const t of trips) {
      const curBest = latest.get(t.fleet_no)
      if (!curBest || t.date > curBest.date) latest.set(t.fleet_no, { date: t.date, project: t.project })
    }
    return (fleet: string) => latest.get(fleet)?.project ?? '__unassigned'
  }, [trips])

  const groups = useMemo(
    () => aggregate(effMonth, issuances, draws, trips, fallbackOf, sections, price),
    [effMonth, issuances, draws, trips, fallbackOf, sections, price],
  )
  // Last month at the SAME price — the delta isolates consumption, not price moves.
  const prevGroups = useMemo(
    () => aggregate(prevMonth(effMonth), issuances, draws, trips, fallbackOf, sections, price),
    [effMonth, issuances, draws, trips, fallbackOf, sections, price],
  )

  const shown = useMemo(() => [...groups.values()].filter((g) => g.litres > 0 || (g.kind === 'section' && g.key !== '__unassigned')), [groups])
  const totalLitres = shown.reduce((s, g) => s + g.litres, 0)
  const totalCost = shown.reduce((s, g) => s + g.cost, 0)
  const prevTotal = [...prevGroups.values()].reduce((s, g) => s + g.litres, 0)
  const totalDelta = prevTotal > 0 ? (totalLitres - prevTotal) / prevTotal : null

  // Daily consumption: vehicle litres + draw litres per day of the month.
  const daily = useMemo(() => {
    const map = new Map<string, { day: string; vehicles: number; draws: number }>()
    const get = (d: string) => { let r = map.get(d); if (!r) { r = { day: d.slice(8), vehicles: 0, draws: 0 }; map.set(d, r) } return r }
    for (const i of issuances) if (monthKey(i.date) === effMonth) get(i.date).vehicles += i.liters_given
    for (const d of draws) if (monthKey(d.date) === effMonth && isApprovedDraw(d)) get(d.date).draws += d.litres
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)
  }, [issuances, draws, effMonth])

  const splitChart = useMemo(
    () => shown.filter((g) => g.litres > 0).sort((a, b) => b.litres - a.litres)
      .map((g, i) => ({ name: g.label, litres: Math.round(g.litres), fill: GROUP_COLORS[i % GROUP_COLORS.length] })),
    [shown],
  )

  // Top consumers with their section(s) — where the big litres actually go.
  const topBuses = useMemo(() => {
    const weights = busProjectKm(trips.filter((t) => monthKey(t.date) === effMonth))
    const labelOf = (fleet: string) => {
      const l = busSectionLabel(weights, fleet)
      if (l !== 'Other') return l
      const fb = fallbackOf(fleet)
      return fb === '__unassigned' ? 'Other' : fb
    }
    const per = new Map<string, { bus: string; section: string; litres: number; km: number; litresClosed: number }>()
    for (const i of issuances) {
      if (monthKey(i.date) !== effMonth) continue
      let r = per.get(i.fleet_no)
      if (!r) { r = { bus: i.fleet_no, section: labelOf(i.fleet_no), litres: 0, km: 0, litresClosed: 0 }; per.set(i.fleet_no, r) }
      r.litres += i.liters_given
      if (!isOpen(i)) { r.km += kmMoved(i); r.litresClosed += i.liters_given }
    }
    return [...per.values()].sort((a, b) => b.litres - a.litres).slice(0, 8)
  }, [issuances, trips, effMonth, fallbackOf])

  const visitorRows = useMemo(
    () => draws.filter((d) => monthKey(d.date) === effMonth && isApprovedDraw(d) && d.kind === 'visitor').sort((a, b) => b.date.localeCompare(a.date)),
    [draws, effMonth],
  )

  // ── Month by month: every month's consumption, comparable at a glance ──
  // Each month is costed at ITS OWN diesel price, and split-bus fuel uses that
  // month's own trip weights — so months compare honestly.
  const history = useMemo(() => {
    const asc = [...dataMonths].sort()
    let prev: number | null = null
    return asc.map((m) => {
      const g = aggregate(m, issuances, draws, trips, fallbackOf, sections, pricePerLitre(getFuelRate(branch, m), cur))
      const all = [...g.values()]
      const litres = all.reduce((s, x) => s + x.litres, 0)
      const cost = all.reduce((s, x) => s + x.cost, 0)
      const km = all.reduce((s, x) => s + x.km, 0)
      const litresClosed = all.reduce((s, x) => s + x.litresClosed, 0)
      const row = {
        month: m, label: monthLabel(m), litres, cost, km,
        econ: litresClosed > 0 ? km / litresClosed : null,
        delta: prev != null && prev > 0 ? (litres - prev) / prev : null,
        perSection: Object.fromEntries(sections.map((s) => [s, Math.round(g.get(s)?.litres ?? 0)])) as Record<string, number>,
        other: Math.round(g.get('__unassigned')?.litres ?? 0),
        drawsL: Math.round((g.get('__generator')?.litres ?? 0) + (g.get('__visitor')?.litres ?? 0)),
      }
      prev = litres
      return row
    })
  }, [dataMonths, issuances, draws, trips, fallbackOf, sections, branch, cur])

  if (role === 'route_supervisor') {
    return (
      <div className="page">
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center text-status-neutral">
          <Lock size={26} /><p className="text-sm">Fuel summaries aren't part of the Route Supervisor view.</p>
        </div>
      </div>
    )
  }

  const delta = (g: Group) => {
    const prev = prevGroups.get(g.key)?.litres ?? 0
    if (prev <= 0) return null
    return (g.litres - prev) / prev
  }

  return (
    <div className="page space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Where {branchLabel}'s fuel actually goes each month — each section's buses, the workshop generator and authorised
          vehicles — costed at the month's diesel price. Profitability (fuel vs revenue) lives in <b className="text-navy">Mileage → Overview</b>.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
            {(['USD', 'ZMW'] as Currency[]).map((c) => (
              <button key={c} onClick={() => setCur(c)} className={clsx('px-2.5 py-1.5 text-xs font-medium', cur === c ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>{c === 'USD' ? '$' : 'K'}</button>
            ))}
          </div>
          <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* Headline: the month in five numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Total fuel issued" value={`${Math.round(totalLitres).toLocaleString()} L`} highlight
          sub={totalDelta == null ? monthLabel(effMonth) : `${totalDelta >= 0 ? '+' : ''}${Math.round(totalDelta * 100)}% vs ${monthLabel(prevMonth(effMonth))}`} />
        <KpiCard label="Total fuel cost" value={money(totalCost, cur)} info={`Litres × the ${monthLabel(effMonth)} diesel price (${money(price, cur)}/L, ERB).`} sub={`at ${money(price, cur)}/L`} />
        {sections.map((s) => {
          const g = groups.get(s)!
          return <KpiCard key={s} label={`${s} buses`} value={`${Math.round(g.litres).toLocaleString()} L`} sub={money(g.cost, cur)} />
        })}
        <KpiCard label="Generator + authorised" value={`${Math.round((groups.get('__generator')!.litres + groups.get('__visitor')!.litres)).toLocaleString()} L`}
          sub={money(groups.get('__generator')!.cost + groups.get('__visitor')!.cost, cur)} info="Fuel that leaves the depot without moving a bus — the workshop genset plus Ops-authorised visitor vehicles." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Who gets the fuel */}
        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Who the fuel goes to</h3>
          <p className="mb-3 text-[11px] text-status-neutral">Litres issued in {monthLabel(effMonth)}, by recipient group.</p>
          <div style={{ height: Math.max(180, splitChart.length * 44 + 20) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={splitChart} margin={{ top: 4, right: 16, bottom: 4, left: 6 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={compact} />
                <YAxis type="category" dataKey="name" width={124} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} formatter={(v: number) => [`${v.toLocaleString()} L`, 'Litres']} />
                <Bar dataKey="litres" maxBarSize={20} radius={[0, 3, 3, 0]}>
                  {splitChart.map((d) => <Cell key={d.name} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily burn */}
        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Daily consumption</h3>
          <p className="mb-3 text-[11px] text-status-neutral">Bus refuels plus generator/authorised draws, day by day.</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={compact} />
                <Tooltip contentStyle={tip} formatter={(v: number, n) => [`${Math.round(v).toLocaleString()} L`, n]} />
                <Area dataKey="vehicles" name="Buses" stackId="l" stroke={NAVY} fill={NAVY} fillOpacity={0.75} />
                <Area dataKey="draws" name="Generator + authorised" stackId="l" stroke={BRAND} fill={BRAND} fillOpacity={0.75} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* The analysis table: every group, costed, with movement vs last month */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <FuelIcon size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">Consumption by group — {monthLabel(effMonth)}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-navy text-white"><tr>
              <th className="px-5 py-2.5 text-left font-medium">Group</th>
              <th className="px-4 py-2.5 font-medium">Litres</th>
              <th className="px-4 py-2.5 font-medium">Share</th>
              <th className="px-4 py-2.5 font-medium">Cost</th>
              <th className="px-4 py-2.5 font-medium">Buses</th>
              <th className="px-4 py-2.5 font-medium">km (odometer)</th>
              <th className="px-4 py-2.5 font-medium">km/L</th>
              <th className="px-4 py-2.5 font-medium">vs last month</th>
            </tr></thead>
            <tbody>
              {shown.map((g) => {
                const d = delta(g)
                const econ = g.litresClosed > 0 ? g.km / g.litresClosed : null
                return (
                  <tr key={g.key} className="border-t border-black/5">
                    <td className="px-5 py-2 text-left font-medium text-navy">
                      {g.kind === 'generator' && <Zap size={13} className="mr-1 inline text-brand" />}
                      {g.kind === 'visitor' && <Users size={13} className="mr-1 inline text-brand" />}
                      {g.label}
                    </td>
                    <td className="px-4 py-2 text-navy" title={g.split ? 'Includes km-share estimates from buses that ran for more than one section this month.' : undefined}>{g.split ? '≈ ' : ''}{Math.round(g.litres).toLocaleString()}</td>
                    <td className="px-4 py-2 text-status-neutral">{totalLitres > 0 ? `${Math.round((g.litres / totalLitres) * 100)}%` : '—'}</td>
                    <td className="px-4 py-2 text-navy">{money(g.cost, cur)}</td>
                    <td className="px-4 py-2 text-status-neutral">{g.kind === 'section' ? g.buses.size : '—'}</td>
                    <td className="px-4 py-2 text-status-neutral">{g.kind === 'section' ? Math.round(g.km).toLocaleString() : '—'}</td>
                    <td className="px-4 py-2 text-status-neutral">{econ != null ? econ.toFixed(1) : '—'}</td>
                    <td className="px-4 py-2">
                      {d == null ? <span className="text-status-neutral">—</span> : (
                        <span className={clsx('inline-flex items-center gap-0.5 font-medium', d > 0.05 ? 'text-status-critical' : d < -0.05 ? 'text-status-good' : 'text-status-neutral')}>
                          {d > 0.05 ? <TrendingUp size={13} /> : d < -0.05 ? <TrendingDown size={13} /> : null}
                          {d >= 0 ? '+' : ''}{Math.round(d * 100)}%
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {totalLitres === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-status-neutral">No fuel issued in {monthLabel(effMonth)}.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-black/5 px-5 py-2.5 text-[11px] text-status-neutral">
          A bus's section comes from its Mileage project ({sections.join(' / ')}); a bus that ran for more than one section has its fuel split by km share (≈).
          Rising litres with flat km is the number to chase — it shows up here before it shows up in cost.
        </p>
      </div>

      {/* Month by month — compare consumption across every month on record */}
      {history.length > 1 && (
        <div className="card overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3.5">
            <h3 className="font-display text-sm font-bold text-navy">Month by month</h3>
            <p className="mt-0.5 text-[11px] text-status-neutral">Every month's consumption, stacked by who received it — each month costed at its own diesel price.</p>
          </div>
          <div className="px-5 pt-4">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={18}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={compact} />
                  <Tooltip contentStyle={tip} formatter={(v: number, n) => [`${Math.round(v).toLocaleString()} L`, n]} />
                  {sections.map((s, i) => <Bar key={s} dataKey={`perSection.${s}`} name={s} stackId="m" fill={GROUP_COLORS[i % GROUP_COLORS.length]} maxBarSize={44} />)}
                  <Bar dataKey="other" name="Other buses" stackId="m" fill={NEUTRAL} maxBarSize={44} />
                  <Bar dataKey="drawsL" name="Generator + authorised" stackId="m" fill={AMBER} maxBarSize={44} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-canvas text-status-neutral"><tr>
                <th className="px-5 py-2 text-left font-medium">Month</th>
                {sections.map((s) => <th key={s} className="px-3 py-2 font-medium">{s} (L)</th>)}
                <th className="px-3 py-2 font-medium">Gen + auth (L)</th>
                <th className="px-3 py-2 font-medium">Total (L)</th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">km</th>
                <th className="px-3 py-2 font-medium">km/L</th>
                <th className="px-4 py-2 font-medium">vs prior</th>
              </tr></thead>
              <tbody>
                {[...history].reverse().map((h) => (
                  <tr key={h.month} className={clsx('border-t border-black/5', h.month === effMonth && 'bg-brand-tint/25')}>
                    <td className="px-5 py-2 text-left font-medium text-navy">
                      <button onClick={() => setMonth(h.month)} className="hover:underline" title="View this month">{h.label}</button>
                    </td>
                    {sections.map((s) => <td key={s} className="px-3 py-2 text-status-neutral">{h.perSection[s].toLocaleString()}</td>)}
                    <td className="px-3 py-2 text-status-neutral">{h.drawsL.toLocaleString()}</td>
                    <td className="px-3 py-2 font-medium text-navy">{Math.round(h.litres).toLocaleString()}</td>
                    <td className="px-3 py-2 text-status-neutral">{money(h.cost, cur)}</td>
                    <td className="px-3 py-2 text-status-neutral">{Math.round(h.km).toLocaleString()}</td>
                    <td className="px-3 py-2 text-status-neutral">{h.econ != null ? h.econ.toFixed(1) : '—'}</td>
                    <td className="px-4 py-2">
                      {h.delta == null ? <span className="text-status-neutral">—</span> : (
                        <span className={clsx('inline-flex items-center gap-0.5 font-medium', h.delta > 0.05 ? 'text-status-critical' : h.delta < -0.05 ? 'text-status-good' : 'text-status-neutral')}>
                          {h.delta > 0.05 ? <TrendingUp size={13} /> : h.delta < -0.05 ? <TrendingDown size={13} /> : null}
                          {h.delta >= 0 ? '+' : ''}{Math.round(h.delta * 100)}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-black/5 px-5 py-2.5 text-[11px] text-status-neutral">Click a month to open it above. Litres falling while km holds is efficiency improving; both climbing together is just more work done.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top consumers */}
        <div className="card overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Top consumers</h3></div>
          <table className="w-full text-right text-sm">
            <thead className="bg-canvas text-status-neutral"><tr>
              <th className="px-5 py-2 text-left font-medium">Bus</th><th className="px-4 py-2 text-left font-medium">Section</th>
              <th className="px-4 py-2 font-medium">Litres</th><th className="px-4 py-2 font-medium">km/L</th>
            </tr></thead>
            <tbody>
              {topBuses.map((b) => (
                <tr key={b.bus} className="border-t border-black/5">
                  <td className="px-5 py-2 text-left font-medium text-navy">{b.bus}</td>
                  <td className="px-4 py-2 text-left"><span className="rounded-full bg-navy/5 px-2 py-0.5 text-[11px] font-medium text-navy">{b.section === '__unassigned' ? 'Other' : b.section}</span></td>
                  <td className="px-4 py-2 text-navy">{Math.round(b.litres).toLocaleString()}</td>
                  <td className="px-4 py-2 text-status-neutral">{b.litresClosed > 0 ? (b.km / b.litresClosed).toFixed(1) : '—'}</td>
                </tr>
              ))}
              {topBuses.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-status-neutral">No bus refuels this month.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Authorised vehicle detail — who took fuel and who signed it off */}
        <div className="card overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Authorised vehicles — {monthLabel(effMonth)}</h3></div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-canvas text-status-neutral"><tr>
                <th className="px-5 py-2 text-left font-medium">Date</th><th className="px-4 py-2 text-left font-medium">Recipient</th>
                <th className="px-4 py-2 font-medium">Litres</th><th className="px-4 py-2 text-left font-medium">Authorised by</th>
              </tr></thead>
              <tbody>
                {visitorRows.map((d) => (
                  <tr key={d.id} className="border-t border-black/5">
                    <td className="px-5 py-2 text-left text-status-neutral">{d.date}</td>
                    <td className="px-4 py-2 text-left font-medium text-navy">{d.recipient}{d.vehicle_reg ? ` · ${d.vehicle_reg}` : ''}</td>
                    <td className="px-4 py-2 text-navy">{d.litres.toLocaleString()}</td>
                    <td className="px-4 py-2 text-left text-status-neutral">{d.authorized_by || DRAW_LABEL[d.kind]}</td>
                  </tr>
                ))}
                {visitorRows.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-status-neutral">No authorised-vehicle fuel this month.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
