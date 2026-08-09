import { useMemo, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Line } from 'recharts'
import { Lock, AlertTriangle, Bus, Route as RouteIcon, Clock } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import { TRIP_LABEL } from '@/lib/operations/types'
import { useAllocations } from '@/lib/operations/store'
import { useVehicles } from '@/lib/fleet/store'

/**
 * Operations Overview — bussing insight from what is being entered (Bus
 * Allocation actuals): which weekdays carry the most runs, how hard each bus
 * works, and the pressure days where more bussing was needed — so next
 * month's plan starts from evidence, not memory.
 *
 * Money and billing live in Mileage → Overview; fuel in Fuel → Overview.
 */

const NAVY = '#0F1B33', BRAND = '#D16B21', GOOD = '#2E7D4F', AMBER = '#C9A227', GRID = 'rgba(15,27,51,0.06)'
const tip = { borderRadius: 10, border: '1px solid #eee', fontSize: 12 }
const monthKey = (d: string) => d.slice(0, 7)
const monthLabel = (k: string) => { if (!k) return '—'; const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: 'numeric' }) }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const weekdayOf = (iso: string) => (new Date(iso + 'T00:00:00').getDay() + 6) % 7 // Mon=0

export default function OperationsOverview() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const allocations = useAllocations().filter((a) => a.branch === branch)
  const activeBuses = useVehicles().filter((v) => v.branch === branch && v.status === 'active').length

  const curMonth = new Date().toISOString().slice(0, 7)
  const dataMonths = useMemo(() => [...new Set(allocations.map((a) => monthKey(a.date)))].sort().reverse(), [allocations])
  const months = useMemo(() => [...new Set([curMonth, ...dataMonths])].sort().reverse(), [curMonth, dataMonths])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : (dataMonths[0] ?? curMonth)

  const mAlloc = useMemo(() => allocations.filter((a) => monthKey(a.date) === effMonth), [allocations, effMonth])

  // ── Per-day picture: runs, buses used, passengers ──
  const days = useMemo(() => {
    const map = new Map<string, { date: string; runs: number; buses: Set<string>; pax: number; pickups: number; knockoffs: number }>()
    for (const a of mAlloc) {
      let d = map.get(a.date)
      if (!d) { d = { date: a.date, runs: 0, buses: new Set(), pax: 0, pickups: 0, knockoffs: 0 }; map.set(a.date, d) }
      d.runs++
      if (a.fleet_no) d.buses.add(a.fleet_no)
      d.pax += a.passengers ?? 0
      if (a.trip_type === 'pickup') d.pickups++; else d.knockoffs++
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [mAlloc])

  const totals = useMemo(() => {
    const runs = mAlloc.length
    const pax = mAlloc.reduce((s, a) => s + (a.passengers ?? 0), 0)
    const buses = new Set(mAlloc.map((a) => a.fleet_no).filter(Boolean)).size
    const avgRunsPerDay = days.length ? runs / days.length : 0
    const avgBusesPerDay = days.length ? days.reduce((s, d) => s + d.buses.size, 0) / days.length : 0
    const peak = days.reduce<(typeof days)[number] | null>((best, d) => (best == null || d.runs > best.runs ? d : best), null)
    return {
      runs, pax, buses, avgRunsPerDay, avgBusesPerDay, peak,
      pickups: mAlloc.filter((a) => a.trip_type === 'pickup').length,
      knockoffs: mAlloc.filter((a) => a.trip_type === 'knockoff').length,
      utilisation: activeBuses > 0 ? avgBusesPerDay / activeBuses : null,
    }
  }, [mAlloc, days, activeBuses])

  // ── Weekday pressure profile: which days of the week need more bussing ──
  const weekdayProfile = useMemo(() => {
    const acc = WEEKDAYS.map((w) => ({ day: w, runs: 0, days: 0, pax: 0 }))
    for (const d of days) {
      const w = acc[weekdayOf(d.date)]
      w.runs += d.runs
      w.pax += d.pax
      w.days++
    }
    const rows = acc.map((w) => ({ day: w.day, avg: w.days ? w.runs / w.days : 0, pax: w.days ? Math.round(w.pax / w.days) : 0 }))
    const max = Math.max(...rows.map((r) => r.avg), 0)
    return rows.map((r) => ({ ...r, avg: Math.round(r.avg * 10) / 10, heavy: max > 0 && r.avg >= max * 0.9 }))
  }, [days])
  const heavyDays = weekdayProfile.filter((w) => w.heavy && w.avg > 0).map((w) => w.day)

  // ── Pressure days: runs-per-bus well above the month's norm ──
  const pressure = useMemo(() => {
    const withLoad = days.map((d) => ({ ...d, load: d.buses.size > 0 ? d.runs / d.buses.size : 0 }))
    const loads = withLoad.map((d) => d.load).filter((l) => l > 0).sort((a, b) => a - b)
    if (loads.length < 4) return { threshold: null as number | null, days: [] as typeof withLoad }
    const median = loads[Math.floor(loads.length / 2)]
    const threshold = median * 1.25 // a day 25%+ over the typical runs-per-bus was under pressure
    return { threshold, days: withLoad.filter((d) => d.load >= threshold).sort((a, b) => b.load - a.load).slice(0, 8) }
  }, [days])

  // ── Route demand: where the runs actually go ──
  const routes = useMemo(() => {
    const map = new Map<string, { name: string; runs: number; pax: number }>()
    for (const a of mAlloc) {
      const name = a.location || 'Unspecified'
      let r = map.get(name)
      if (!r) { r = { name, runs: 0, pax: 0 }; map.set(name, r) }
      r.runs++
      r.pax += a.passengers ?? 0
    }
    return [...map.values()].sort((a, b) => b.runs - a.runs).slice(0, 8)
  }, [mAlloc])

  const dailyChart = useMemo(() => days.map((d) => ({ day: d.date.slice(8), runs: d.runs, buses: d.buses.size })), [days])

  // ── The clock: what a typical day looks like, hour by hour ──
  const hourOf = (t: string) => { const h = parseInt(t.slice(0, 2), 10); return Number.isFinite(h) && h >= 0 && h <= 23 ? h : null }
  const hourly = useMemo(() => {
    const acc = new Map<number, { pickups: number; knockoffs: number }>()
    for (const a of mAlloc) {
      const h = hourOf(a.departure_time)
      if (h == null) continue
      let r = acc.get(h)
      if (!r) { r = { pickups: 0, knockoffs: 0 }; acc.set(h, r) }
      if (a.trip_type === 'pickup') r.pickups++; else r.knockoffs++
    }
    const nDays = Math.max(1, days.length)
    const hours = [...acc.keys()].sort((a, b) => a - b)
    if (hours.length === 0) return { rows: [], peakPickup: null as string | null, peakKnockoff: null as string | null }
    const span: { hour: string; pickups: number; knockoffs: number }[] = []
    for (let h = hours[0]; h <= hours[hours.length - 1]; h++) {
      const r = acc.get(h)
      span.push({
        hour: `${String(h).padStart(2, '0')}:00`,
        pickups: r ? Math.round((r.pickups / nDays) * 10) / 10 : 0,
        knockoffs: r ? Math.round((r.knockoffs / nDays) * 10) / 10 : 0,
      })
    }
    const top = (k: 'pickups' | 'knockoffs') => {
      const best = [...acc.entries()].sort((a, b) => b[1][k] - a[1][k])[0]
      return best && best[1][k] > 0 ? `${String(best[0]).padStart(2, '0')}:00–${String(best[0] + 1).padStart(2, '0')}:00` : null
    }
    return { rows: span, peakPickup: top('pickups'), peakKnockoff: top('knockoffs') }
  }, [mAlloc, days])

  // ── The average schedule: weekday × hour, filterable by trip type ──
  const [heatType, setHeatType] = useState<'all' | 'pickup' | 'knockoff'>('all')
  const heat = useMemo(() => {
    // How many of each weekday actually have logged data — the divisor for "typical".
    const weekdayDates = new Map<number, Set<string>>()
    for (const d of days) {
      const w = weekdayOf(d.date)
      let set = weekdayDates.get(w)
      if (!set) { set = new Set(); weekdayDates.set(w, set) }
      set.add(d.date)
    }
    const cell = new Map<string, number>() // `${weekday}:${hour}` -> total runs
    let minH = 24, maxH = -1
    for (const a of mAlloc) {
      if (heatType !== 'all' && a.trip_type !== heatType) continue
      const h = hourOf(a.departure_time)
      if (h == null) continue
      const w = weekdayOf(a.date)
      cell.set(`${w}:${h}`, (cell.get(`${w}:${h}`) ?? 0) + 1)
      minH = Math.min(minH, h); maxH = Math.max(maxH, h)
    }
    if (maxH < 0) return { hours: [] as number[], rows: [] as { w: number; day: string; nDays: number; cells: number[] }[], max: 0 }
    const hoursSpan: number[] = []
    for (let h = minH; h <= maxH; h++) hoursSpan.push(h)
    let max = 0
    const rows = WEEKDAYS.map((day, w) => {
      const nDays = weekdayDates.get(w)?.size ?? 0
      const cells = hoursSpan.map((h) => {
        const avg = nDays > 0 ? (cell.get(`${w}:${h}`) ?? 0) / nDays : 0
        max = Math.max(max, avg)
        return Math.round(avg * 10) / 10
      })
      return { w, day, nDays, cells }
    }).filter((r) => r.nDays > 0)
    return { hours: hoursSpan, rows, max }
  }, [mAlloc, days, heatType])

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
          How the bussing actually ran — from what Bus Allocation records. Which weekdays are heaviest, how hard each
          bus works, and the days that needed more buses than usual — so the next plan improves on this one.
        </p>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-status-neutral">Month
          <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand">
            {months.length === 0 && <option value="">—</option>}
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Runs" value={totals.runs.toLocaleString()} highlight sub={`${totals.pickups} ${TRIP_LABEL.pickup.toLowerCase()}s · ${totals.knockoffs} ${TRIP_LABEL.knockoff.toLowerCase()}s`} />
        <KpiCard label="Runs per day" value={totals.avgRunsPerDay ? totals.avgRunsPerDay.toFixed(1) : '—'} sub={`${days.length} day${days.length === 1 ? '' : 's'} logged`} />
        <KpiCard label="Peak day" value={totals.peak ? String(totals.peak.runs) : '—'} tone={totals.peak && totals.avgRunsPerDay && totals.peak.runs > totals.avgRunsPerDay * 1.3 ? 'warning' : 'neutral'} info="The single busiest day's run count — how far above normal the worst day sits." sub={totals.peak ? totals.peak.date : 'no data'} />
        <KpiCard label="Passengers" value={totals.pax.toLocaleString()} sub={totals.runs ? `${Math.round(totals.pax / totals.runs)} per run` : '—'} />
        <KpiCard label="Buses used" value={totals.buses ? String(totals.buses) : '—'} sub={`avg ${totals.avgBusesPerDay.toFixed(1)}/day`} />
        <KpiCard label="Fleet utilisation" value={totals.utilisation != null ? `${Math.round(totals.utilisation * 100)}%` : '—'} tone={totals.utilisation == null ? 'neutral' : totals.utilisation > 0.9 ? 'warning' : 'good'} info={`Average buses used per day ÷ ${activeBuses} active buses. Consistently above ~90% means no slack for breakdowns.`} sub={`${activeBuses} active buses`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Weekday profile */}
        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Which weekdays need the most bussing</h3>
          <p className="mb-3 text-[11px] text-status-neutral">Average runs per weekday in {monthLabel(effMonth)} — the highlighted bars are where extra buses earn their keep.</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdayProfile} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} formatter={(v: number, n) => [n === 'avg' ? `${v} runs` : v, n === 'avg' ? 'Avg runs' : 'Avg passengers']} />
                <Bar dataKey="avg" name="avg" maxBarSize={40} radius={[3, 3, 0, 0]}>
                  {weekdayProfile.map((w) => <Cell key={w.day} fill={w.heavy ? BRAND : NAVY} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {heavyDays.length > 0 && (
            <p className="mt-2 rounded-lg bg-brand-tint/40 px-3 py-2 text-xs text-navy">
              <b>{heavyDays.join(' & ')}</b> {heavyDays.length === 1 ? 'is' : 'are'} the heaviest — plan standby buses there first.
            </p>
          )}
        </div>

        {/* Daily trend */}
        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Runs and buses, day by day</h3>
          <p className="mb-3 text-[11px] text-status-neutral">Bars are runs; the line is how many buses did them. Bars growing while the line stays flat = each bus is being pushed harder.</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyChart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="runs" name="Runs" fill={NAVY} maxBarSize={14} radius={[2, 2, 0, 0]} />
                <Line dataKey="buses" name="Buses" stroke={BRAND} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* The clock: hourly rhythm + the average schedule per weekday */}
      {hourly.rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h3 className="font-display text-sm font-bold text-navy">When trips happen</h3>
            <p className="mb-2 text-[11px] text-status-neutral">Average runs per hour on a logged day — where the pickup and knock-off waves actually fall.</p>
            <div className="mb-2 flex gap-4 text-[11px] text-status-neutral">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: NAVY }} />Pickups</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BRAND }} />Knock-offs</span>
            </div>
            <div className="h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly.rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tip} formatter={(v: number, n) => [`${v} avg runs`, n]} />
                  <Bar dataKey="pickups" name="Pickups" stackId="h" fill={NAVY} maxBarSize={22} />
                  <Bar dataKey="knockoffs" name="Knock-offs" stackId="h" fill={BRAND} maxBarSize={22} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {(hourly.peakPickup || hourly.peakKnockoff) && (
              <p className="mt-2 rounded-lg bg-brand-tint/40 px-3 py-2 text-xs text-navy">
                <Clock size={12} className="mr-1 inline" />
                {hourly.peakPickup && <>Peak pickups <b>{hourly.peakPickup}</b></>}
                {hourly.peakPickup && hourly.peakKnockoff && ' · '}
                {hourly.peakKnockoff && <>peak knock-offs <b>{hourly.peakKnockoff}</b></>}
                — have every bus and driver ready before these windows.
              </p>
            )}
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm font-bold text-navy">The average schedule</h3>
              <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-black/15 text-[11px] font-medium">
                {([['all', 'All'], ['pickup', 'Pickups'], ['knockoff', 'Knock-offs']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setHeatType(k)} className={clsx('px-2.5 py-1', heatType === k ? 'bg-navy text-white' : 'bg-white text-status-neutral hover:text-navy')}>{label}</button>
                ))}
              </div>
            </div>
            <p className="mb-3 mt-0.5 text-[11px] text-status-neutral">Read a row left to right: that weekday's typical day, hour by hour (average runs). Darker = busier.</p>
            <div className="overflow-x-auto">
              <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
                <thead><tr>
                  <th className="pr-2 text-left text-[10px] font-medium text-status-neutral" />
                  {heat.hours.map((h) => <th key={h} className="min-w-[30px] text-center text-[10px] font-medium text-status-neutral">{String(h).padStart(2, '0')}</th>)}
                </tr></thead>
                <tbody>
                  {heat.rows.map((r) => (
                    <tr key={r.w}>
                      <td className="pr-2 text-[11px] font-medium text-navy">{r.day}<span className="ml-1 text-[9px] text-status-neutral">×{r.nDays}</span></td>
                      {r.cells.map((v, i) => {
                        const alpha = heat.max > 0 ? 0.06 + (v / heat.max) * 0.8 : 0
                        return (
                          <td key={i} className="h-7 min-w-[30px] rounded text-center text-[10px] font-medium"
                            style={{ background: v > 0 ? `rgb(var(--brand-rgb) / ${alpha.toFixed(2)})` : 'rgb(var(--black-rgb) / 0.04)', color: v / (heat.max || 1) > 0.55 ? '#fff' : undefined }}
                            title={`${r.day} ${String(heat.hours[i]).padStart(2, '0')}:00 — avg ${v} run${v === 1 ? '' : 's'} across ${r.nDays} ${r.day}${r.nDays === 1 ? '' : 's'}`}>
                            {v > 0 ? v : ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-status-neutral">Build each weekday's plan from its row — the buses needed at each hour are already in the data.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pressure days */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <AlertTriangle size={16} className="text-[#8a6d10]" /><h3 className="font-display text-sm font-bold text-navy">Days that needed more bussing</h3>
            {pressure.threshold != null && <span className="text-xs text-status-neutral">runs-per-bus ≥ {pressure.threshold.toFixed(1)} (25% over the month's norm)</span>}
          </div>
          {pressure.days.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-status-neutral">{days.length < 4 ? 'Not enough logged days yet to spot pressure.' : 'No day ran meaningfully over the norm — the plan held.'}</p>
          ) : (
            <div className="divide-y divide-black/5">
              {pressure.days.map((d) => (
                <div key={d.date} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                  <span className="w-28 text-sm font-medium text-navy">{d.date}</span>
                  <span className="text-xs text-status-neutral">{WEEKDAYS[weekdayOf(d.date)]}</span>
                  <span className="ml-auto text-xs text-status-neutral">{d.runs} runs on {d.buses.size} bus{d.buses.size === 1 ? '' : 'es'}</span>
                  <span className="rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">{d.load.toFixed(1)} runs/bus</span>
                </div>
              ))}
              <p className="px-5 py-2.5 text-[11px] text-status-neutral">These days squeezed the most runs out of each bus — the first candidates for an extra bus in next month's plan.</p>
            </div>
          )}
        </div>

        {/* Route demand */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><RouteIcon size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Where the runs go</h3></div>
          <table className="w-full text-right text-sm">
            <thead className="bg-canvas text-status-neutral"><tr>
              <th className="px-5 py-2 text-left font-medium">Route / destination</th>
              <th className="px-4 py-2 font-medium">Runs</th><th className="px-4 py-2 font-medium">Passengers</th><th className="px-4 py-2 font-medium">Avg / run</th>
            </tr></thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.name} className="border-t border-black/5">
                  <td className="max-w-[220px] truncate px-5 py-2 text-left font-medium text-navy">{r.name}</td>
                  <td className="px-4 py-2 text-navy">{r.runs}</td>
                  <td className="px-4 py-2 text-status-neutral">{r.pax.toLocaleString()}</td>
                  <td className={clsx('px-4 py-2', r.runs && r.pax / r.runs < 10 ? 'text-[#8a6d10]' : 'text-status-neutral')}>{r.runs ? Math.round(r.pax / r.runs) : '—'}</td>
                </tr>
              ))}
              {routes.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-status-neutral">No runs logged for {monthLabel(effMonth)}.</td></tr>}
            </tbody>
          </table>
          {routes.some((r) => r.runs && r.pax / r.runs > 0 && r.pax / r.runs < 10) && (
            <p className="border-t border-black/5 px-5 py-2.5 text-[11px] text-status-neutral">Amber averages are lightly-loaded runs — candidates to merge or re-time.</p>
          )}
        </div>
      </div>

      <p className="inline-flex items-center gap-1.5 text-xs text-status-neutral">
        <Bus size={13} className="text-brand" /> Billing &amp; profitability moved to <b className="text-navy">Mileage → Overview</b>; fuel analysis to <b className="text-navy">Fuel → Overview</b>.
        {!ROLES[role].canToggleBranch && ` Showing ${branchLabel} only.`}
      </p>
    </div>
  )
}
