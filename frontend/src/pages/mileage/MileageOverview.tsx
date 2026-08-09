import { useMemo, useState } from 'react'
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Lock, Scale, TrendingUp, TrendingDown } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import { useIssuances, useFuelRate, useFuelRates, resolveFuelRate } from '@/lib/fuel/store'
import { kmMoved, isOpen, pricePerLitre } from '@/lib/fuel/types'
import { useMileageTrips, useMileageRatesFor, useMileageRateMaps, resolveRates } from '@/lib/mileage/store'
import { tripKm, rateFor, PROJECTS_BY_BRANCH } from '@/lib/mileage/types'
import { sectionBreakdown, busProjectKm, busSectionLabel } from '@/lib/mileage/profit'

/**
 * Mileage Overview — what is profitable and what isn't. Revenue (billable km ×
 * the month's contract rates) against fuel cost, per SECTION (Enterprise /
 * Sentinel) and per bus, plus the paid-vs-driven reconciliation: the driven
 * kilometres the fuel odometer proves that nobody is billed for.
 */

const NAVY = '#0F1B33', GOOD = '#2E7D4F', AMBER = '#C9A227', CRIT = '#B3261E', GRID = 'rgba(15,27,51,0.06)'
const tip = { borderRadius: 10, border: '1px solid #eee', fontSize: 12 }
const monthKey = (d: string) => d.slice(0, 7)
const monthLabel = (k: string) => { if (!k) return '—'; const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: 'numeric' }) }
const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`
const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

interface BusRow {
  bus: string; reg: string; section: string
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

function ChartKey({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-2 flex gap-4 text-[11px] text-status-neutral">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
      ))}
    </div>
  )
}

export default function MileageOverview() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const sections = PROJECTS_BY_BRANCH[branch]

  const trips = useMileageTrips().filter((t) => t.branch === branch)
  const issuances = useIssuances().filter((i) => i.branch === branch)

  const curMonth = new Date().toISOString().slice(0, 7)
  const dataMonths = useMemo(
    () => [...new Set([...trips.map((t) => monthKey(t.date)), ...issuances.map((i) => monthKey(i.date))].filter(Boolean))].sort().reverse(),
    [trips, issuances],
  )
  const months = useMemo(() => [...new Set([curMonth, ...dataMonths])].sort().reverse(), [curMonth, dataMonths])
  const [month, setMonth] = useState('')
  const effMonth = months.includes(month) ? month : (dataMonths[0] ?? curMonth)

  // The month's own contract rates (Rates & Setup, tracked per month).
  const rates = useMileageRatesFor(branch, effMonth)
  const fuelRate = useFuelRate(branch, effMonth)
  const priceUSD = pricePerLitre(fuelRate, 'USD')

  const mTrips = useMemo(() => trips.filter((t) => monthKey(t.date) === effMonth), [trips, effMonth])
  // Which projects each bus drove for this month (km per project) — split buses
  // exist, so this drives both the section labels and the fuel distribution.
  const weights = useMemo(() => busProjectKm(mTrips), [mTrips])

  const perBus = useMemo<BusRow[]>(() => {
    const mIss = issuances.filter((i) => monthKey(i.date) === effMonth)
    const map = new Map<string, BusRow & { litresClosed: number }>()
    const get = (bus: string, reg: string) => {
      let r = map.get(bus)
      if (!r) { r = { bus, reg, section: '', paidKm: 0, drivenKm: 0, unpaidKm: 0, paidRatio: null, litres: 0, litresClosed: 0, economy: null, fuelCost: 0, revenue: 0, margin: 0, fuelShare: null }; map.set(bus, r) }
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
      // A split bus is labelled with every project it served, biggest first.
      section: busSectionLabel(weights, r.bus),
      unpaidKm: Math.max(0, r.drivenKm - r.paidKm),
      paidRatio: r.drivenKm > 0 ? r.paidKm / r.drivenKm : null,
      economy: r.litresClosed > 0 ? r.drivenKm / r.litresClosed : null,
      margin: r.revenue - r.fuelCost,
      fuelShare: r.revenue > 0 ? r.fuelCost / r.revenue : null,
    }))
  }, [mTrips, issuances, weights, rates, priceUSD, effMonth])

  // ── The headline: profitability per section ──
  // Revenue/km come straight from trips grouped by project — the SAME numbers
  // as the Billing Summary. Split buses' fuel is distributed by km share.
  const bySection = useMemo(
    () => sectionBreakdown({
      trips: mTrips,
      fuelByBus: perBus.map((b) => ({ fleet_no: b.bus, litres: b.litres })).filter((f) => f.litres > 0),
      rates, priceUSD, sections,
    }),
    [mTrips, perBus, rates, priceUSD, sections],
  )
  const anySplitFuel = bySection.some((s) => s.split)

  const totals = useMemo(() => {
    const paidKm = perBus.reduce((s, b) => s + b.paidKm, 0)
    const drivenKm = perBus.reduce((s, b) => s + b.drivenKm, 0)
    const litres = perBus.reduce((s, b) => s + b.litres, 0)
    const fuelCost = perBus.reduce((s, b) => s + b.fuelCost, 0)
    const revenue = perBus.reduce((s, b) => s + b.revenue, 0)
    const economies = perBus.map((b) => b.economy).filter((e): e is number => e != null)
    return {
      paidKm, drivenKm, litres, fuelCost, revenue,
      net: revenue - fuelCost,
      unpaidKm: Math.max(0, drivenKm - paidKm),
      paidRatio: drivenKm > 0 ? paidKm / drivenKm : null,
      avgEconomy: economies.length ? economies.reduce((s, e) => s + e, 0) / economies.length : null,
      fuelShare: revenue > 0 ? fuelCost / revenue : null,
    }
  }, [perBus])

  const sectionChart = useMemo(
    () => bySection.filter((s) => s.revenue > 0 || s.fuelCost > 0).map((s) => ({ name: s.section, revenue: Math.round(s.revenue), fuel: Math.round(s.fuelCost), net: Math.round(s.net) })),
    [bySection],
  )
  const tableRows = useMemo(() => [...perBus].sort((a, b) => (a.paidRatio ?? 2) - (b.paidRatio ?? 2)), [perBus])
  const chartPaid = useMemo(() => [...perBus].sort((a, b) => (b.paidKm + b.unpaidKm) - (a.paidKm + a.unpaidKm)).map((b) => ({ bus: b.bus, paid: b.paidKm, unpaid: b.unpaidKm })), [perBus])
  const paidChartH = Math.max(200, chartPaid.length * 30 + 12)

  // ── Month by month: every month costed at ITS OWN contract rates and diesel
  // price, so the trend is honest and a rate change is visible beside its effect.
  const rateMaps = useMileageRateMaps()
  const fuelRates = useFuelRates()
  const history = useMemo(() => {
    let prevNet: number | null = null
    let prevRates: ReturnType<typeof resolveRates> | null = null
    let prevDiesel: number | null = null
    let prevFx: number | null = null
    return [...dataMonths].sort().map((m) => {
      const r = resolveRates(rateMaps.monthly, rateMaps.legacy, branch, m)
      const fr = resolveFuelRate(fuelRates, branch, m)
      const price = pricePerLitre(fr, 'USD')
      let paidKm = 0, revenue = 0, litres = 0
      for (const t of trips) {
        if (monthKey(t.date) !== m) continue
        const km = tripKm(t)
        paidKm += km
        revenue += km * rateFor(r, t.seat_class)
      }
      for (const i of issuances) if (monthKey(i.date) === m) litres += i.liters_given
      const fuelCost = litres * price
      const net = revenue - fuelCost
      const row = {
        month: m, label: monthLabel(m), paidKm, revenue, litres, fuelCost, net,
        netDelta: prevNet != null && prevNet !== 0 ? (net - prevNet) / Math.abs(prevNet) : null,
        rates: r, dieselZmw: fr.diesel_zmw, fx: fr.fx_zmw_per_usd,
        // Flag a rate that moved from the previous month — it usually explains the swing.
        rateChanged: prevRates != null && (prevRates.rate60 !== r.rate60 || prevRates.rate40 !== r.rate40 || prevRates.rate28 !== r.rate28),
        fuelPriceChanged: prevDiesel != null && prevDiesel !== fr.diesel_zmw,
        fxChanged: prevFx != null && prevFx !== fr.fx_zmw_per_usd,
      }
      prevNet = net; prevRates = r; prevDiesel = fr.diesel_zmw; prevFx = fr.fx_zmw_per_usd
      return row
    })
  }, [dataMonths, trips, issuances, rateMaps, fuelRates, branch])

  if (role === 'route_supervisor') {
    return (
      <div className="page">
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center text-status-neutral">
          <Lock size={26} /><p className="text-sm">Mileage summaries aren't part of the Route Supervisor view.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          What each section <b className="text-navy">earns</b> (billable km × the month's rates) against what its buses'
          <b className="text-navy"> fuel costs</b> — then the same per bus, with the driven-but-unbilled kilometres the fuel odometer exposes.
        </p>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-status-neutral">Month
          <select value={effMonth} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand">
            {months.length === 0 && <option value="">—</option>}
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      {/* Profit per section — the reason this page exists. km/revenue equal the
          Billing Summary exactly; split buses' fuel is a km-share estimate. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bySection.map((s) => (
          <div key={s.section} className={clsx('card border-l-4 p-4', s.net >= 0 ? 'border-status-good' : 'border-status-critical')}>
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-sm font-bold text-navy">{s.section}</h3>
              <span className="text-[11px] text-status-neutral">{s.buses} bus{s.buses === 1 ? '' : 'es'} · {s.paidKm.toLocaleString()} km billed</span>
            </div>
            <div className={clsx('mt-2 text-2xl font-bold', s.net >= 0 ? 'text-status-good' : 'text-status-critical')}>{usd0(s.net)}</div>
            <div className="text-[11px] text-status-neutral">after fuel · {monthLabel(effMonth)}{s.split ? ' · fuel partly estimated' : ''}</div>
            <div className="mt-2.5 flex justify-between text-xs">
              <span className="text-status-neutral">Revenue <b className="text-navy">{usd0(s.revenue)}</b></span>
              <span className="text-status-neutral">Fuel <b className="text-navy">{usd0(s.fuelCost)}</b>{s.split ? <span title="Some buses ran for more than one section this month — their fuel is split in proportion to the km driven for each."> ≈</span> : ''}</span>
              <span className="text-status-neutral">Fuel share {s.fuelShare != null ? <b className={clsx(s.fuelShare > 0.5 ? 'text-status-critical' : s.fuelShare > 0.35 ? 'text-[#8a6d10]' : 'text-status-good')}>{Math.round(s.fuelShare * 100)}%</b> : '—'}</span>
            </div>
          </div>
        ))}
      </div>
      {anySplitFuel && (
        <p className="-mt-3 text-[11px] text-status-neutral">
          ≈ Some buses ran for more than one section this month; their fuel is split across sections in proportion to the kilometres driven for each. Billed km and revenue are exact — they match the Billing Summary.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Revenue" value={usd0(totals.revenue)} highlight info="Billable kilometres × the month's contract rates (Rates & Setup)." sub={`${totals.paidKm.toLocaleString()} paid km`} />
        <KpiCard label="Fuel cost" value={usd0(totals.fuelCost)} info={`Litres issued × the month's diesel price.`} sub={`${Math.round(totals.litres).toLocaleString()} L`} />
        <KpiCard label="Net after fuel" value={usd0(totals.net)} tone={totals.net >= 0 ? 'good' : 'critical'} sub="revenue − fuel" />
        <KpiCard label="Fuel vs revenue" value={totals.fuelShare != null ? `${Math.round(totals.fuelShare * 100)}%` : '—'} tone={totals.fuelShare == null ? 'neutral' : totals.fuelShare > 0.5 ? 'critical' : totals.fuelShare > 0.35 ? 'warning' : 'good'} info="Fuel cost as a share of revenue. Lower is healthier." sub="lower is better" />
        <KpiCard label="Unpaid km" value={totals.unpaidKm.toLocaleString()} tone={totals.unpaidKm > 0 ? 'warning' : 'good'} info="Driven (odometer) minus paid (billed): distance nobody pays for." sub={totals.drivenKm ? `${Math.round((totals.unpaidKm / totals.drivenKm) * 100)}% of driven` : '—'} />
        <KpiCard label="Avg economy" value={totals.avgEconomy != null ? `${totals.avgEconomy.toFixed(1)} km/L` : '—'} sub="driven km per litre" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Revenue vs fuel — by section</h3>
          <p className="mb-2 text-[11px] text-status-neutral">The profitability question in one picture: does each section earn well clear of its fuel?</p>
          <ChartKey items={[[GOOD, 'Revenue'], [CRIT, 'Fuel cost'], [NAVY, 'Net after fuel']]} />
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectionChart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={24}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${compact(v)}`} />
                <Tooltip contentStyle={tip} formatter={(v: number, n) => [usd0(v), n]} />
                <Bar dataKey="revenue" name="Revenue" fill={GOOD} maxBarSize={34} radius={[3, 3, 0, 0]} />
                <Bar dataKey="fuel" name="Fuel cost" fill={CRIT} maxBarSize={34} radius={[3, 3, 0, 0]} />
                <Bar dataKey="net" name="Net after fuel" fill={NAVY} maxBarSize={34} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-display text-sm font-bold text-navy">Paid vs unpaid distance by bus</h3>
          <p className="mb-2 text-[11px] text-status-neutral">Green is billed; amber is driven but not billed. A long amber bar is a bus running km no one pays for.</p>
          <ChartKey items={[[GOOD, 'Paid'], [AMBER, 'Unpaid']]} />
          <div className="max-h-[300px] overflow-y-auto pr-1">
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
      </div>

      {/* Per-bus profitability — worst paid ratio first */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Scale size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Profitability by bus — {monthLabel(effMonth)}</h3><span className="text-xs text-status-neutral">worst paid-ratio first · scrolls</span></div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-right text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Bus</th>
                <th className="px-4 py-2.5 text-left font-medium">Section</th>
                <th className="px-4 py-2.5 font-medium">Paid km</th><th className="px-4 py-2.5 font-medium">Driven km</th>
                <th className="px-4 py-2.5 font-medium">Unpaid</th><th className="px-4 py-2.5 font-medium">Paid %</th>
                <th className="px-4 py-2.5 font-medium">km/L</th><th className="px-4 py-2.5 font-medium">Fuel cost</th>
                <th className="px-4 py-2.5 font-medium">Revenue</th><th className="px-4 py-2.5 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((b, i) => (
                <tr key={b.bus} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-4 py-2 text-left font-medium text-navy">{b.bus}<span className="ml-1 text-[11px] text-status-neutral">{b.reg}</span></td>
                  <td className="px-4 py-2 text-left"><span className="rounded-full bg-navy/5 px-2 py-0.5 text-[11px] font-medium text-navy">{b.section}</span></td>
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
              {tableRows.length === 0 && <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-status-neutral">No mileage or fuel data for {monthLabel(effMonth)}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Month by month — the tracking view: how each month performed, and the
          rates it performed under (a rate change explains a lot of movement). */}
      {history.length > 1 && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <TrendingUp size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Month by month</h3>
            <span className="text-xs text-status-neutral">performance and the rates in force — click a month to open it</span>
          </div>
          <div className="px-5 pt-4">
            <div className="h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={20}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${compact(v)}`} />
                  <Tooltip contentStyle={tip} formatter={(v: number, n) => [usd0(v), n]} />
                  <Bar dataKey="revenue" name="Revenue" fill={GOOD} maxBarSize={30} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="fuelCost" name="Fuel cost" fill={CRIT} maxBarSize={30} radius={[3, 3, 0, 0]} />
                  <Line dataKey="net" name="Net after fuel" stroke={NAVY} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-navy/[0.04] text-[10px] uppercase tracking-wide text-status-neutral">
                  <th className="px-5 py-1.5 text-left font-semibold">Month</th>
                  <th className="border-l border-black/5 px-3 py-1.5 text-center font-semibold" colSpan={6}>Performance</th>
                  <th className="border-l border-black/5 px-3 py-1.5 text-center font-semibold" colSpan={6}>Rates in force that month</th>
                </tr>
                <tr className="bg-canvas text-status-neutral">
                  <th className="px-5 py-2 text-left font-medium" />
                  <th className="border-l border-black/5 px-3 py-2 font-medium">Billed km</th>
                  <th className="px-3 py-2 font-medium">Revenue</th>
                  <th className="px-3 py-2 font-medium">Litres</th>
                  <th className="px-3 py-2 font-medium">Fuel cost</th>
                  <th className="px-3 py-2 font-medium">Net</th>
                  <th className="px-3 py-2 font-medium">vs prior</th>
                  <th className="border-l border-black/5 px-3 py-2 font-medium" title="60-seater contract rate">60</th>
                  <th className="px-3 py-2 font-medium" title="40-seater contract rate">40</th>
                  <th className="px-3 py-2 font-medium" title="15–28-seater contract rate">15–28</th>
                  <th className="px-3 py-2 font-medium">VAT</th>
                  <th className="px-3 py-2 font-medium" title="ERB diesel pump price">Diesel K/L</th>
                  <th className="px-4 py-2 font-medium" title="Bank of Zambia mid rate">K/$</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((h) => (
                  <tr key={h.month} className={clsx('border-t border-black/5', h.month === effMonth && 'bg-brand-tint/25')}>
                    <td className="px-5 py-2 text-left font-medium text-navy">
                      <button onClick={() => setMonth(h.month)} className="hover:underline" title="View this month above">{h.label}</button>
                    </td>
                    <td className="border-l border-black/5 px-3 py-2 text-status-neutral">{Math.round(h.paidKm).toLocaleString()}</td>
                    <td className="px-3 py-2 text-status-neutral">{usd0(h.revenue)}</td>
                    <td className="px-3 py-2 text-status-neutral">{Math.round(h.litres).toLocaleString()}</td>
                    <td className="px-3 py-2 text-status-neutral">{usd0(h.fuelCost)}</td>
                    <td className={clsx('px-3 py-2 font-medium', h.net >= 0 ? 'text-status-good' : 'text-status-critical')}>{usd0(h.net)}</td>
                    <td className="px-3 py-2">
                      {h.netDelta == null ? <span className="text-status-neutral">—</span> : (
                        <span className={clsx('inline-flex items-center gap-0.5 font-medium', h.netDelta > 0.02 ? 'text-status-good' : h.netDelta < -0.02 ? 'text-status-critical' : 'text-status-neutral')}>
                          {h.netDelta > 0.02 ? <TrendingUp size={12} /> : h.netDelta < -0.02 ? <TrendingDown size={12} /> : null}
                          {h.netDelta >= 0 ? '+' : ''}{Math.round(h.netDelta * 100)}%
                        </span>
                      )}
                    </td>
                    <td className={clsx('border-l border-black/5 px-3 py-2', h.rateChanged ? 'font-semibold text-brand' : 'text-status-neutral')}>${h.rates.rate60.toFixed(2)}</td>
                    <td className={clsx('px-3 py-2', h.rateChanged ? 'font-semibold text-brand' : 'text-status-neutral')}>${h.rates.rate40.toFixed(2)}</td>
                    <td className={clsx('px-3 py-2', h.rateChanged ? 'font-semibold text-brand' : 'text-status-neutral')}>${h.rates.rate28.toFixed(2)}</td>
                    <td className="px-3 py-2 text-status-neutral">{h.rates.vat_pct}%</td>
                    <td className={clsx('px-3 py-2', h.fuelPriceChanged ? 'font-semibold text-brand' : 'text-status-neutral')}>K{h.dieselZmw.toFixed(2)}</td>
                    <td className={clsx('px-4 py-2', h.fxChanged ? 'font-semibold text-brand' : 'text-status-neutral')}>{h.fx.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-black/5 px-5 py-2.5 text-[11px] text-status-neutral">
            Each month is billed at its own contract rates and costed at its own diesel price — <span className="font-semibold text-brand">highlighted</span> where a rate changed from the month before, so a jump in the numbers can be read against the rate that caused it.
          </p>
        </div>
      )}

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
    </div>
  )
}
