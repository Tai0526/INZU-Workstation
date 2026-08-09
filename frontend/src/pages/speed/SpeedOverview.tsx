import { useMemo, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine, ReferenceArea, Legend, CartesianGrid,
} from 'recharts'
import {
  TrendingDown, TrendingUp, Minus, Download, ShieldCheck, AlertTriangle, Trophy, Activity, ShieldAlert,
  FileText, MapPin, Lightbulb, Clock, Gavel, FileCheck, ChevronRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import Button from '@/components/ui/Button'
import { useSpeedEvents } from '@/lib/speed/store'
import { useCases, DECISION_LABEL, type Decision } from '@/lib/safety/cases'
import { useSpeedGeo } from '@/lib/speed/geo'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useMileageTrips } from '@/lib/mileage/store'
import { computeSpeedAnalytics } from '@/lib/speed/analytics'
import SpeedHotspotMap from '@/components/speed/SpeedHotspotMap'
import { exportSpeedPdf, svgToPng } from '@/lib/speed/pdf'
import {
  overBy, offenceNumberInBand, penaltyFor, countsAgainstDriver, isGlitch, zoneOf,
  ZONE_META, monthKey, monthLabel, lastMonths,
} from '@/lib/speed/types'
import { exportEvents } from '@/lib/speed/excel'

const NAVY = '#0F1B33', BRAND = '#D16B21', CRIT = '#B3261E', GRID = 'rgba(15,27,51,0.06)'
const tip = { borderRadius: 10, border: '1px solid #eee', fontSize: 12 }

// ── Dates people can read at a glance ───────────────────────────────────────
/** "August 2026" — for headings, where the month is the subject. */
const monthFull = (k: string) => {
  const [y, m] = k.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
/** "Sun 09 Aug 2026" — never a bare ISO string in front of a user. */
const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
/** "09 Aug" — compact, for chart labels and map pins. */
const fmtDayMonth = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const fmtTime = (iso: string) => iso.slice(11, 16)

/**
 * No scaled rates, no normalised units. The headline is the plain count of
 * speeding events in the month and how that compares with the month before —
 * a number anybody can repeat without being taught what it means. Fleet size
 * only gets mentioned when it actually moved enough to explain part of the
 * change (see fleetNote below).
 */
const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : now > 0 ? 100 : 0)

const currentMonthKey = (today = new Date()) => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

function Card({ title, subtitle, right, id, children }: {
  title: string; subtitle?: string; right?: React.ReactNode; id?: string; children: React.ReactNode
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] leading-relaxed text-status-neutral">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div id={id}>{children}</div>
    </div>
  )
}

export default function SpeedOverview() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[user!.role].canToggleBranch

  const allEvents = useSpeedEvents()
  const vehicles = useVehicles()
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const cases = useCases()

  const dataMonths = useMemo(
    () => [...new Set(allEvents.filter((e) => e.branch === branch).map((e) => monthKey(e.event_datetime)))].sort().reverse(),
    [allEvents, branch],
  )
  const monthOptions = useMemo(() => {
    const now = new Date()
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return [...new Set([cur, ...dataMonths])].sort().reverse()
  }, [dataMonths])

  const [cmpKey, setCmpKey] = useState('')
  const [baseKey, setBaseKey] = useState('')
  const effCmp = monthOptions.includes(cmpKey) ? cmpKey : (dataMonths[0] ?? monthOptions[0])
  const NONE = 'none'
  // Default the baseline to the previous month WITH data — this page exists to
  // show whether speeding is being curbed, and that needs something to compare
  // against. "None" stays available for reviewing a month on its own.
  const autoBase = useMemo(() => dataMonths.find((k) => k < effCmp) ?? NONE, [dataMonths, effCmp])
  const effBase = baseKey === NONE ? NONE
    : baseKey && baseKey !== effCmp && monthOptions.includes(baseKey) ? baseKey
      : autoBase
  const single = effBase === NONE
  const effBaseForCalc = single ? effCmp : effBase

  const mileageTrips = useMileageTrips()
  const busesOnRoad = useMemo(() => {
    const byMonth = new Map<string, Set<string>>()
    for (const t of mileageTrips) {
      if (t.branch !== branch) continue
      const mk = monthKey(t.date)
      if (!byMonth.has(mk)) byMonth.set(mk, new Set())
      byMonth.get(mk)!.add(t.fleet_no)
    }
    return (mk: string) => byMonth.get(mk)?.size ?? 0
  }, [mileageTrips, branch])

  const a = useMemo(
    () => computeSpeedAnalytics(allEvents, vehicles, branch, effCmp, effBaseForCalc, new Date(), busesOnRoad),
    [allEvents, vehicles, branch, effCmp, effBaseForCalc, busesOnRoad],
  )

  const valid = useMemo(() => allEvents.filter((e) => e.branch === branch && countsAgainstDriver(e)), [allEvents, branch])
  const validAll = useMemo(() => allEvents.filter((e) => e.branch === branch && !isGlitch(e)), [allEvents, branch])

  // ── The curbing story: 12 months of the fair, per-bus-per-day rate ──
  // Uses the SAME divisor rule as computeSpeedAnalytics (buses that logged
  // mileage, falling back to the branch fleet), so the table can never
  // contradict the headline figure for the same month.
  const branchFleetCount = useMemo(() => vehicles.filter((v) => v.branch === branch).length, [vehicles, branch])
  const thisCalendarMonth = currentMonthKey()
  const history = useMemo(() => {
    const [y, m] = effCmp.split('-').map(Number)
    const keys = lastMonths(12, new Date(y, m - 1, 1))
    let prev: number | null = null
    return keys.map((k) => {
      const evs = validAll.filter((e) => monthKey(e.event_datetime) === k)
      const busesLogged = busesOnRoad(k)
      // How many DIFFERENT buses sped — the honest answer to "is this the whole
      // fleet or a handful of buses?", and far easier to grasp than any rate.
      const busesSped = new Set(evs.map((e) => e.vehicle_label)).size
      const row = {
        key: k, label: monthLabel(k), full: monthFull(k),
        events: evs.length, busesLogged, busesSped,
        avgOver: evs.length ? Math.round(evs.reduce((s, e) => s + overBy(e), 0) / evs.length) : 0,
        open: evs.filter((e) => zoneOf(e) === 'open').length,
        delta: prev != null && prev > 0 ? (evs.length - prev) / prev : null,
        hasData: evs.length > 0 || busesLogged > 0,
        // A month still running isn't finished — say so rather than let a part
        // month look like an improvement.
        inProgress: k === thisCalendarMonth,
      }
      prev = evs.length
      return row
    })
  }, [validAll, busesOnRoad, effCmp, thisCalendarMonth])
  const withData = useMemo(() => history.filter((h) => h.hasData), [history])

  // Headline = the plain count and its change. Nothing to explain.
  const cmpRow = history.find((h) => h.key === effCmp)
  const baseRow = single ? undefined : history.find((h) => h.key === effBase)
  const eventsThis = cmpRow?.events ?? 0
  const eventsLast = baseRow?.events ?? 0
  const ratePct = baseRow ? pctChange(eventsThis, eventsLast) : 0
  const improving = !!baseRow && eventsThis < eventsLast
  const sameRate = !!baseRow && eventsThis === eventsLast
  const busesSpedThis = cmpRow?.busesSped ?? 0
  const busesRunThis = cmpRow?.busesLogged || branchFleetCount || 0
  /**
   * Only worth mentioning fleet size when it genuinely moved — otherwise it is
   * noise. Above ~10% difference, part of the change is simply more buses.
   */
  const fleetNote = useMemo(() => {
    if (!baseRow) return null
    const now = cmpRow?.busesLogged ?? 0
    const before = baseRow.busesLogged ?? 0
    if (!now || !before) return null
    const diff = pctChange(now, before)
    return Math.abs(diff) >= 10 ? { now, before, diff } : null
  }, [cmpRow, baseRow])

  // ── Accountability scope ──
  const [offPeriod, setOffPeriod] = useState<'month' | 'ytd' | 'all'>('month')
  const offYear = effCmp.slice(0, 4)
  const cutMonth = effCmp.slice(5, 7)
  const periodEvents = useMemo(() => valid.filter((e) => {
    if (offPeriod === 'all') return true
    const mk = monthKey(e.event_datetime)
    if (offPeriod === 'month') return mk === effCmp
    return mk.slice(0, 4) === offYear && mk.slice(5, 7) <= cutMonth
  }), [valid, offPeriod, effCmp, offYear, cutMonth])
  const offPeriodLabel = offPeriod === 'month' ? monthFull(effCmp) : offPeriod === 'ytd' ? `${offYear} to date` : 'all time'

  const offence = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>()
    for (const e of periodEvents) { const k = e.driver_id || e.driver_name; const c = m.get(k) ?? { name: e.driver_name, count: 0 }; c.count++; m.set(k, c) }
    return [...m.values()].sort((x, y) => y.count - x.count)
  }, [periodEvents])
  const repeatOffenders = offence.filter((d) => d.count >= 2)

  const ytdCompare = useMemo(() => {
    if (offPeriod !== 'ytd') return null
    const prevYear = String(Number(offYear) - 1)
    const thisYtd = periodEvents.length
    const lastYtd = valid.filter((e) => { const mk = monthKey(e.event_datetime); return mk.slice(0, 4) === prevYear && mk.slice(5, 7) <= cutMonth }).length
    const pct = lastYtd ? Math.round(((thisYtd - lastYtd) / lastYtd) * 100) : (thisYtd ? 100 : 0)
    return { thisYtd, lastYtd, prevYear, pct, improving: thisYtd < lastYtd, hasPrev: lastYtd > 0 }
  }, [offPeriod, periodEvents, valid, offYear, cutMonth])

  const byYear = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of valid) { const y = e.event_datetime.slice(0, 4); m.set(y, (m.get(y) || 0) + 1) }
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([year, count]) => ({ year, count }))
  }, [valid])

  const offenderKeys = new Set(allEvents.filter((e) => e.branch === branch).map((e) => e.driver_id || e.driver_name))
  const clean = drivers.filter((d) => !offenderKeys.has(d.id) && !offenderKeys.has(d.full_name))
  const finesThisMonth = allEvents
    .filter((e) => e.branch === branch && !isGlitch(e) && monthKey(e.event_datetime) === a.thisKey && e.status === 'confirmed')
    .reduce((s, e) => s + (penaltyFor(overBy(e), offenceNumberInBand(allEvents.filter((x) => x.branch === branch), e))?.fine ?? 0), 0)
  const atDismissal = new Set(
    allEvents.filter((e) => e.branch === branch && penaltyFor(overBy(e), offenceNumberInBand(allEvents.filter((x) => x.branch === branch), e))?.dismissal).map((e) => e.driver_id || e.driver_name),
  ).size

  // ── Map: located events for the selected month ──
  const geo = useSpeedGeo()
  const geoPts = useMemo(
    () => allEvents
      .filter((e) => e.branch === branch && !isGlitch(e) && monthKey(e.event_datetime) === effCmp)
      .map((e) => ({ e, g: geo[e.id] }))
      .filter((x): x is { e: typeof x.e; g: NonNullable<typeof x.g> } => !!x.g && (x.g.lat !== 0 || x.g.lng !== 0)),
    [allEvents, branch, effCmp, geo],
  )
  const [geoBus, setGeoBus] = useState('all')
  const [geoDriver, setGeoDriver] = useState('all')
  const geoBuses = useMemo(
    () => [...new Set(geoPts.filter((p) => geoDriver === 'all' || p.e.driver_name === geoDriver).map((p) => p.e.vehicle_label))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
    [geoPts, geoDriver],
  )
  const geoDrivers = useMemo(
    () => [...new Set(geoPts.filter((p) => geoBus === 'all' || p.e.vehicle_label === geoBus).map((p) => p.e.driver_name).filter(Boolean))].sort(),
    [geoPts, geoBus],
  )
  const fgeoPts = useMemo(
    () => geoPts.filter((p) => (geoBus === 'all' || p.e.vehicle_label === geoBus) && (geoDriver === 'all' || p.e.driver_name === geoDriver)),
    [geoPts, geoBus, geoDriver],
  )
  function pickBus(v: string) {
    setGeoBus(v)
    if (v !== 'all' && geoDriver !== 'all' && !geoPts.some((p) => p.e.vehicle_label === v && p.e.driver_name === geoDriver)) setGeoDriver('all')
  }
  function pickDriver(v: string) {
    setGeoDriver(v)
    if (v !== 'all' && geoBus !== 'all' && !geoPts.some((p) => p.e.vehicle_label === geoBus && p.e.driver_name === v)) setGeoBus('all')
  }
  const heatPoints = useMemo(
    () => fgeoPts.map(({ e, g }) => ({
      lat: g.lat, lng: g.lng, weight: Math.min(1, overBy(e) / 30),
      label: `${e.vehicle_label}${e.driver_name ? ` · ${e.driver_name}` : ''} — ${fmtDayMonth(e.event_datetime)} at ${fmtTime(e.event_datetime)} · +${overBy(e)} km/h over${e.route ? ` · ${e.route}` : ''}`,
    })),
    [fgeoPts],
  )
  const hotspots = useMemo(() => {
    const m = new Map<string, { name: string; count: number; overSum: number; buses: Set<string> }>()
    for (const { e } of fgeoPts) {
      const key = e.route || 'Unknown location'
      const c = m.get(key) ?? { name: key, count: 0, overSum: 0, buses: new Set<string>() }
      c.count++; c.overSum += overBy(e); c.buses.add(e.vehicle_label)
      m.set(key, c)
    }
    return [...m.values()].map((h) => ({ name: h.name, count: h.count, avgOver: Math.round(h.overSum / h.count), buses: h.buses.size })).sort((x, y) => y.count - x.count)
  }, [fgeoPts])
  const peakHour = useMemo(() => {
    const h = new Array(24).fill(0)
    for (const { e } of fgeoPts) h[Number(e.event_datetime.slice(11, 13))]++
    let best = 0
    for (let i = 1; i < 24; i++) if (h[i] > h[best]) best = i
    return { hour: best, count: h[best] }
  }, [fgeoPts])
  const topGeoBus = useMemo(() => {
    const m = new Map<string, number>()
    for (const { e } of geoPts) m.set(e.vehicle_label, (m.get(e.vehicle_label) || 0) + 1)
    const arr = [...m.entries()].sort((a2, b2) => b2[1] - a2[1])
    return arr[0] ? { fleet: arr[0][0], count: arr[0][1] } : null
  }, [geoPts])

  // ── Action taken: what actually happened to the drivers who sped ──
  // Proof that a breach leads somewhere: the case, the Ops decision, the fine,
  // the memo. Scoped to the events of the month under review, so the chain
  // reads breach → case → decision for the same period as everything above.
  const enforcement = useMemo(() => {
    const monthCases = cases.filter((c) => c.branch === branch && monthKey(c.event_datetime) === effCmp)
    const closed = monthCases.filter((c) => c.stage === 'closed' && c.verdict?.outcome === 'approved')
    const charged = closed.filter((c) => (c.verdict!.decisions ?? []).some((d) => d !== 'cleared'))
    const cleared = closed.filter((c) => !(c.verdict!.decisions ?? []).some((d) => d !== 'cleared'))
    const rejected = monthCases.filter((c) => c.stage === 'closed' && c.verdict?.outcome === 'rejected')
    const open = monthCases.filter((c) => c.stage !== 'closed')
    const has = (c: typeof charged[number], d: Decision) => (c.verdict!.decisions ?? []).includes(d)
    const fines = charged.filter((c) => (c.verdict!.fine_amount ?? 0) > 0)
    const byDecision = (['counselling', 'verbal_warning', 'written_warning', 'final_written_warning', 'fine', 'dismissal'] as Decision[])
      .map((d) => ({ d, label: DECISION_LABEL[d], n: charged.filter((c) => has(c, d)).length }))
      .filter((x) => x.n > 0)
    return {
      monthCases, charged, cleared, rejected, open, byDecision,
      fineTotal: fines.reduce((s, c) => s + (c.verdict!.fine_amount ?? 0), 0),
      fineCount: fines.length,
      toPayroll: fines.filter((c) => c.verdict!.to_payroll).length,
      withProof: charged.filter((c) => !!c.verdict!.fine_file || !!c.memo || !!c.charge_statement).length,
      rows: [...charged].sort((x, y) => (y.verdict!.decided_at || '').localeCompare(x.verdict!.decided_at || '')),
    }
  }, [cases, branch, effCmp])

  // ── Insights ──
  const peakHourOverall = useMemo(() => {
    const h = new Array(24).fill(0)
    for (const e of periodEvents) h[Number(e.event_datetime.slice(11, 13))]++
    let best = 0
    for (let i = 1; i < 24; i++) if (h[i] > h[best]) best = i
    return { hour: best, count: h[best] }
  }, [periodEvents])
  const worstBusOverall = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of periodEvents) m.set(e.vehicle_label, (m.get(e.vehicle_label) || 0) + 1)
    const arr = [...m.entries()].sort((x, y) => y[1] - x[1])
    return arr[0] ? { fleet: arr[0][0], count: arr[0][1] } : null
  }, [periodEvents])
  const recommendations = useMemo(() => {
    const recs: string[] = []
    const pad = (n: number) => String(n).padStart(2, '0')
    if (offPeriod === 'ytd' && ytdCompare?.hasPrev) {
      recs.push(ytdCompare.improving
        ? `Year-to-date speeding is down ${Math.abs(ytdCompare.pct)}% vs ${ytdCompare.prevYear} (${ytdCompare.thisYtd} vs ${ytdCompare.lastYtd}) — the current measures are working; keep them up.`
        : `Year-to-date speeding is up ${ytdCompare.pct}% vs ${ytdCompare.prevYear} (${ytdCompare.thisYtd} vs ${ytdCompare.lastYtd}) — step up enforcement and review what changed.`)
    } else if (offPeriod === 'all' && byYear.length >= 2) {
      const last = byYear[byYear.length - 1], prev = byYear[byYear.length - 2]
      recs.push(last.count <= prev.count
        ? `Speeding is trending down year-on-year (${prev.year}: ${prev.count} → ${last.year}: ${last.count}) — the programme is paying off.`
        : `Speeding rose ${prev.year} → ${last.year} (${prev.count} → ${last.count}) — revisit what changed between the years.`)
    } else if (offPeriod === 'month' && !single && !sameRate) {
      recs.push(improving ? `Speeding improved ${Math.abs(ratePct)}% vs ${monthFull(a.lastKey)} — sustain the current coaching.` : `Speeding rose ${ratePct}% vs ${monthFull(a.lastKey)} — act before it becomes a habit.`)
    }
    if (repeatOffenders.length) {
      const names = repeatOffenders.slice(0, 3).map((d) => d.name).join(', ')
      recs.push(`Target the ${repeatOffenders.length} repeat offender${repeatOffenders.length === 1 ? '' : 's'} (${names}${repeatOffenders.length > 3 ? '…' : ''}) with one-on-one counselling rather than a blanket fleet memo.`)
    }
    if (peakHourOverall.count > 0) recs.push(`Speeding clusters around ${pad(peakHourOverall.hour)}:00 — brief crews and add spot-checks just before that window (often shift-change).`)
    if (hotspots[0]) recs.push(`${hotspots[0].name} is the worst location — signage, a rumble strip or an enforcement point there would bite hardest.`)
    if (worstBusOverall && worstBusOverall.count >= 3) recs.push(`${worstBusOverall.fleet} triggers the most events (${worstBusOverall.count}) — check its route, speed governor and whether one crew is involved.`)
    if (atDismissal > 0) recs.push(`${atDismissal} driver${atDismissal === 1 ? ' has' : 's have'} reached the dismissal step — apply the policy consistently so it stays a real deterrent.`)
    if (recs.length === 0) recs.push('No counted speeding for this period — keep up the current checks and briefings.')
    return recs
  }, [offPeriod, ytdCompare, byYear, single, a, repeatOffenders, peakHourOverall, hotspots, worstBusOverall, atDismissal])

  // ── PDF ──
  const [exporting, setExporting] = useState(false)
  async function exportPdf() {
    setExporting(true)
    try {
      const specs: [string, string][] = [
        ['spd-chart-trend', 'Speeding rate by month'],
        ['spd-chart-hourly', 'Hourly pattern'],
        ['spd-chart-zone', 'Where it happens — by speed zone'],
      ]
      const charts: { title: string; dataUrl: string; w: number; h: number }[] = []
      for (const [id, title] of specs) {
        const svg = document.getElementById(id)?.querySelector('svg') as SVGSVGElement | null
        if (!svg) continue
        const png = await svgToPng(svg)
        if (png) charts.push({ title, ...png })
      }
      const verdict = single
        ? `${monthFull(a.thisKey)}: ${a.countThis} speeding event${a.countThis === 1 ? '' : 's'} from ${busesSpedThis} of ${busesRunThis} buses on the road, averaging ${a.avgSevThis.toFixed(1)} km/h over the limit.`
        : sameRate
          ? `Speeding held steady in ${monthFull(a.thisKey)}: ${a.countThis} events, the same as ${monthFull(a.lastKey)}.`
          : improving
            ? `Speeding fell ${Math.abs(ratePct)}% in ${monthFull(a.thisKey)}: ${a.countThis} events, down from ${a.countLast} in ${monthFull(a.lastKey)}.`
            : `Speeding rose ${ratePct}% in ${monthFull(a.thisKey)}: ${a.countThis} events, up from ${a.countLast} in ${monthFull(a.lastKey)}.`
      const suggestions: string[] = []
      if (hotspots[0]) suggestions.push(`${hotspots[0].name} is the worst location (${hotspots[0].count} events) — prioritise signage and enforcement there.`)
      if (peakHour.count > 0) suggestions.push(`Most breaches cluster around ${String(peakHour.hour).padStart(2, '0')}:00 — brief crews before that window.`)
      if (topGeoBus) suggestions.push(`${topGeoBus.fleet} triggered the most events (${topGeoBus.count}) — focus coaching and review its route.`)
      if (repeatOffenders.length) suggestions.push(`${repeatOffenders.length} repeat offender${repeatOffenders.length === 1 ? '' : 's'} — hold counselling sessions and apply the penalty ladder consistently.`)
      exportSpeedPdf({
        branchLabel,
        periodLabel: single ? monthFull(a.thisKey) : `${monthFull(a.thisKey)} vs ${monthFull(a.lastKey)}`,
        generated: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        verdict,
        kpis: [
          { label: 'Speeding events', value: String(a.countThis), sub: single ? monthLabel(a.thisKey) : `vs ${a.countLast} in ${monthLabel(a.lastKey)}` },
          { label: 'Valid events', value: String(a.countThis), sub: monthLabel(a.thisKey) },
          { label: 'Avg over limit', value: `${a.avgSevThis.toFixed(1)} km/h`, sub: 'severity' },
          { label: 'Repeat offenders', value: String(repeatOffenders.length), sub: `2+ events · ${offPeriodLabel}` },
          single
            ? { label: 'Buses on the road', value: String(a.activeBuses), sub: `ran in ${monthLabel(a.thisKey)}` }
            : { label: 'Buses speeding more', value: `${a.busesWorse}/${a.activeBuses}`, sub: `${a.busesImproved} improved` },
          { label: 'Fines this month', value: `K${finesThisMonth.toLocaleString()}`, sub: 'confirmed' },
        ],
        charts,
        hotspots: hotspots.slice(0, 8),
        offenders: offence.slice(0, 8),
        suggestions,
        filename: `INZU_Speeding_Report_${branchLabel}_${a.thisKey}.pdf`,
      })
    } finally { setExporting(false) }
  }

  const TrendIcon = single ? Activity : sameRate ? Minus : improving ? TrendingDown : TrendingUp
  const trendTone = single ? 'neutral' : sameRate ? 'neutral' : improving ? 'good' : 'critical'
  const selCls = 'rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand'

  return (
    <div className="page space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-status-neutral">
          Is speeding being curbed at {branchLabel}? Straight counts, month against month — no adjusted figures to decode.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-status-neutral">
            Month
            <select value={effCmp} onChange={(e) => setCmpKey(e.target.value)} className={selCls}>
              {monthOptions.map((k) => <option key={k} value={k}>{monthFull(k)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-status-neutral">
            vs
            <select value={effBase} onChange={(e) => setBaseKey(e.target.value)} className={selCls}>
              <option value={NONE}>— this month alone —</option>
              {monthOptions.filter((k) => k !== effCmp).map((k) => <option key={k} value={k}>{monthFull(k)}</option>)}
            </select>
          </label>
          <Button variant="secondary" onClick={exportPdf} disabled={exporting}><FileText size={15} /> {exporting ? 'Preparing…' : 'PDF report'}</Button>
          <Button variant="secondary" onClick={() => exportEvents(allEvents.filter((e) => e.branch === branch), branchLabel)}><Download size={15} /> Export</Button>
        </div>
      </div>

      {/* ── The verdict: are we curbing it? ── */}
      <div className="card overflow-hidden">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.15fr]">
          <div className="flex gap-4">
            <div className={clsx('flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl',
              trendTone === 'good' ? 'bg-status-good/10' : trendTone === 'critical' ? 'bg-status-critical/10' : 'bg-canvas')}>
              <TrendIcon size={30} className={clsx(trendTone === 'good' ? 'text-status-good' : trendTone === 'critical' ? 'text-status-critical' : 'text-brand')} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold leading-tight text-navy">
                {single ? `${monthFull(effCmp)}` : sameRate ? 'Speeding held steady' : improving ? `Speeding down ${Math.abs(ratePct)}%` : `Speeding up ${ratePct}%`}
              </h2>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className={clsx('font-display text-4xl font-bold leading-none',
                  trendTone === 'good' ? 'text-status-good' : trendTone === 'critical' ? 'text-status-critical' : 'text-navy')}>
                  {eventsThis}
                </span>
                <span className="text-xs text-status-neutral">speeding event{eventsThis === 1 ? '' : 's'}<br />in the month</span>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-status-neutral">
                From <b className="text-navy">{busesSpedThis}</b> of {busesRunThis} bus{busesRunThis === 1 ? '' : 'es'} on the road, averaging {a.avgSevThis.toFixed(1)} km/h over the limit.
                {single
                  ? ' Pick an earlier month in the “vs” box to see the direction of travel.'
                  : <> Against <b className="text-navy">{eventsLast}</b> in {monthFull(a.lastKey)}. {improving ? 'The measures are working — keep them up.' : sameRate ? '' : 'Act before it becomes a habit.'}</>}
              </p>
              {/* The one caveat worth making: part of a change can just be more buses. */}
              {fleetNote && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#8a6d10]">
                  Note: {fleetNote.now} buses ran in {monthFull(effCmp)} against {fleetNote.before} in {monthFull(a.lastKey)} ({fleetNote.diff > 0 ? '+' : ''}{fleetNote.diff}%), so part of the change is simply fleet size.
                </p>
              )}
            </div>
          </div>

          {/* 12-month trajectory — the whole point of the page, in one picture */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Direction of travel</span>
              <span className="text-[11px] text-status-neutral">speeding events a month · last 12</span>
            </div>
            <div className="h-[132px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 6, right: 4, bottom: 0, left: -28 }}>
                  <defs>
                    <linearGradient id="spdGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip contentStyle={tip} labelFormatter={(l: any, p: any) => (p?.[0]?.payload?.full ?? l)}
                    formatter={(v: number, _n: any, p: any) => [`${v} event${v === 1 ? '' : 's'} · ${p.payload.busesSped} bus${p.payload.busesSped === 1 ? '' : 'es'} involved`, 'Speeding']} />
                  {!single && <ReferenceLine y={eventsLast} stroke={NAVY} strokeDasharray="4 4" />}
                  <Area type="monotone" dataKey="events" stroke={BRAND} strokeWidth={2.5} fill="url(#spdGrad)" dot={{ r: 2 }} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {!single && <p className="mt-1 text-[10px] text-status-neutral">Dashed line = {monthFull(a.lastKey)}'s total ({eventsLast}), for reference.</p>}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Speeding events"
          info="Genuine speeding events this month, after GPS glitches are removed."
          value={eventsThis}
          tone={single ? 'neutral' : improving || sameRate ? 'good' : 'critical'}
          trend={single || sameRate ? undefined : { dir: improving ? 'down' : 'up', text: `${Math.abs(ratePct)}%`, good: improving }}
          sub={single ? monthFull(a.thisKey) : `vs ${eventsLast} in ${monthLabel(a.lastKey)}`}
        />
        <KpiCard label="Buses involved" value={`${busesSpedThis} of ${busesRunThis}`} tone={busesSpedThis === 0 ? 'good' : busesSpedThis > busesRunThis / 2 ? 'critical' : 'warning'} sub={busesRunThis ? `${Math.round((busesSpedThis / busesRunThis) * 100)}% of buses on the road` : 'no mileage logged'} info="How many different buses were involved. A few repeat offenders is a coaching problem; half the fleet is a systemic one." />
        <KpiCard label="Avg over limit" value={`${a.avgSevThis.toFixed(1)} km/h`} tone={a.avgSevThis >= 15 ? 'critical' : a.avgSevThis >= 10 ? 'warning' : 'good'} sub="severity" info="How far over the limit the average breach was — severity matters as much as frequency." />
        <KpiCard label="Repeat offenders" value={repeatOffenders.length} tone={repeatOffenders.length ? 'critical' : 'good'} sub={`2+ events · ${offPeriodLabel}`} info="Drivers with 2+ counted events in the accountability period — change it (month / YTD / all time) under the leaderboard." />
        {single
          ? <KpiCard label="Buses on the road" value={a.activeBuses} sub={`ran in ${monthLabel(a.thisKey)}`} info="Distinct buses that logged mileage this month (no duplicates) — used to normalise the per-bus rate." />
          : <KpiCard label="Buses speeding more" value={`${a.busesWorse} / ${a.activeBuses}`} tone={a.busesWorse ? 'critical' : 'good'} sub={`${a.busesImproved} improved`} info="Buses with more speeding events than the comparison month, out of the buses on the road." />}
        <KpiCard label="Fines this month" value={`K${finesThisMonth.toLocaleString()}`} tone={finesThisMonth ? 'warning' : 'good'} sub="from confirmed charges" info="Total fines from charges confirmed this month, per the penalty policy." />
      </div>

      {/* ── Month by month ── */}
      <Card
        title="Month by month"
        subtitle="How many events, how many buses were involved, and how hard each breach was — click a month to review it."
        id="spd-chart-trend"
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={withData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} width={34} />
              <Tooltip contentStyle={tip} labelFormatter={(l: any, p: any) => (p?.[0]?.payload?.full ?? l)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="events" name="Events" radius={[5, 5, 0, 0]} maxBarSize={40}>
                {withData.map((h) => <Cell key={h.key} fill={h.key === a.thisKey ? NAVY : h.key === a.lastKey && !single ? BRAND : 'rgba(15,27,51,0.18)'} />)}
              </Bar>
              <Line yAxisId="r" dataKey="busesSped" name="Buses involved" stroke={CRIT} strokeWidth={2.5} dot={{ r: 2.5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-canvas text-status-neutral">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Month</th>
                <th className="px-3 py-2 font-medium">Events</th>
                <th className="px-3 py-2 font-medium" title="How many different buses were involved — a handful of repeat offenders looks very different from a fleet-wide problem.">Buses involved</th>
                <th className="px-3 py-2 font-medium">Avg over</th>
                <th className="px-3 py-2 font-medium">Open road</th>
                <th className="px-4 py-2 font-medium">vs prior</th>
              </tr>
            </thead>
            <tbody>
              {[...withData].reverse().map((h) => (
                <tr key={h.key} className={clsx('border-t border-black/5', h.key === a.thisKey && 'bg-brand-tint/25', h.key === a.lastKey && !single && 'bg-navy/[0.03]')}>
                  <td className="px-4 py-2 text-left font-medium text-navy">
                    <button onClick={() => setCmpKey(h.key)} className="hover:underline" title={`Review ${h.full}`}>{h.full}</button>
                  </td>
                  <td className="px-3 py-2 text-navy">{h.events}</td>
                  <td className="px-3 py-2 font-medium text-navy">{h.busesSped || '—'}{h.busesLogged ? <span className="text-[10px] font-normal text-status-neutral"> of {h.busesLogged}</span> : null}</td>
                  <td className={clsx('px-3 py-2', h.avgOver >= 15 ? 'text-status-critical' : 'text-status-neutral')}>{h.events ? `+${h.avgOver} km/h` : '—'}</td>
                  <td className="px-3 py-2 text-status-neutral">{h.events ? `${Math.round((h.open / h.events) * 100)}%` : '—'}</td>
                  <td className="px-4 py-2">
                    {h.delta == null ? <span className="text-status-neutral">—</span> : (
                      <span className={clsx('inline-flex items-center gap-0.5 font-medium',
                        h.delta < -0.02 ? 'text-status-good' : h.delta > 0.02 ? 'text-status-critical' : 'text-status-neutral')}>
                        {h.delta < -0.02 ? <TrendingDown size={12} /> : h.delta > 0.02 ? <TrendingUp size={12} /> : null}
                        {h.delta === 0 ? 'same' : `${h.delta > 0 ? '+' : ''}${Math.round(h.delta * 100)}%`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {withData.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-status-neutral">No speed events recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-status-neutral">
          <b className="text-navy">Open road</b> is the share of breaches above 80 km/h — the ones that carry the most risk. A month where events fall but severity climbs is not really an improvement.
        </p>
      </Card>

      {/* ── When it happens ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Day by day — ${monthFull(a.thisKey)}`}
          subtitle={single ? `Dashed line = this month's daily average (${a.lastDailyAvg.toFixed(1)})` : `Dashed line = ${monthFull(a.lastKey)}'s daily average (${a.lastDailyAvg.toFixed(1)})`}>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={a.daily} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [`${v} events`, 'Events']}
                  labelFormatter={(d) => fmtDate(`${a.thisKey}-${String(d).padStart(2, '0')}`)} contentStyle={tip} />
                <ReferenceLine y={a.lastDailyAvg} stroke={NAVY} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="events" stroke={BRAND} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Hour of the day" subtitle="Shaded bands are the shift-change windows (05–07, 17–19) — where breaches usually cluster." id="spd-chart-hourly">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={a.hourly} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <ReferenceArea x1="05" x2="07" fill="rgba(201,162,39,0.12)" />
                <ReferenceArea x1="17" x2="19" fill="rgba(201,162,39,0.12)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number, n: string) => [`${v} events`, n]} labelFormatter={(h) => `${h}:00 – ${String(Number(h) + 1).padStart(2, '0')}:00`} contentStyle={tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {!single && <Line type="monotone" dataKey="lastM" name={monthLabel(a.lastKey)} stroke={NAVY} strokeWidth={2} dot={false} />}
                <Line type="monotone" dataKey="thisM" name={monthLabel(a.thisKey)} stroke={BRAND} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ── Where, and on which buses ── */}
      <div className={clsx('grid gap-4', !single && 'lg:grid-cols-2')}>
        <Card title="By speed zone" subtitle="Open-road breaches (above 80 km/h) carry far more risk than slow site-zone ones." id="spd-chart-zone">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={single ? a.zoneMix.slice(1) : a.zoneMix} layout="vertical" margin={{ top: 8, right: 10, bottom: 0, left: 6 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="month" width={52} tick={{ fontSize: 12, fill: '#0F1B33' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="open" stackId="z" name={ZONE_META.open.label} fill={ZONE_META.open.fill} />
                <Bar dataKey="site" stackId="z" name={ZONE_META.site.label} fill={ZONE_META.site.fill} />
                <Bar dataKey="ring" stackId="z" name={ZONE_META.ring.label} fill={ZONE_META.ring.fill} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {!single && (
          <Card title="By bus model" subtitle={`${monthFull(a.lastKey)} against ${monthFull(a.thisKey)} — is one model over-represented?`}>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.byModel} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="model" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="lastM" name={monthLabel(a.lastKey)} fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="thisM" name={monthLabel(a.thisKey)} fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      {!single && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <PerBusTable title="Getting worse — biggest rise" icon={<AlertTriangle size={16} className="text-status-critical" />} rows={a.watch} positive
              lastLabel={monthLabel(a.lastKey)} thisLabel={monthLabel(a.thisKey)} />
            <PerBusTable title="Improving — biggest drop" icon={<Trophy size={16} className="text-status-good" />} rows={a.improved} positive={false}
              lastLabel={monthLabel(a.lastKey)} thisLabel={monthLabel(a.thisKey)} />
          </div>
          {a.concentrationBuses.length > 0 && (
            <div className="rounded-xl border border-status-critical/20 bg-status-critical/5 px-4 py-3 text-sm text-navy">
              <span className="font-semibold text-status-critical">Concentration risk:</span> {a.concentrationBuses.join(', ')} account for{' '}
              <span className="font-semibold">{a.concentrationShare}%</span> of this month's increase — focus coaching there rather than a blanket fleet memo.
            </div>
          )}
        </>
      )}

      {/* ── Who ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-display text-sm font-bold text-navy">Driver accountability</h3>
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15 text-xs">
          {(['month', 'ytd', 'all'] as const).map((p) => (
            <button key={p} onClick={() => setOffPeriod(p)}
              className={clsx('px-2.5 py-1.5 font-medium', offPeriod === p ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas')}>
              {p === 'month' ? monthLabel(effCmp) : p === 'ytd' ? `${offYear} to date` : 'All time'}
            </button>
          ))}
        </div>
        <span className="text-xs text-status-neutral">
          {repeatOffenders.length} repeat · {offence.length} driver{offence.length === 1 ? '' : 's'} with events · {offPeriodLabel}
          {offPeriod === 'ytd' && ytdCompare?.hasPrev && (
            <span className={clsx('ml-1 font-semibold', ytdCompare.improving ? 'text-status-good' : 'text-status-critical')}>
              {ytdCompare.improving ? `down ${Math.abs(ytdCompare.pct)}%` : `up ${ytdCompare.pct}%`} vs {ytdCompare.prevYear}
            </span>
          )}
        </span>
        {offPeriod === 'all' && byYear.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {byYear.map((y) => <span key={y.year} className="rounded-full bg-navy/5 px-2 py-0.5 text-xs text-navy">{y.year}: <b>{y.count}</b></span>)}
          </div>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <ShieldAlert size={16} className="text-status-critical" />
            <h3 className="font-display text-sm font-bold text-navy">Repeat-offender leaderboard</h3>
            <span className="ml-auto text-[11px] text-status-neutral">{offPeriodLabel}</span>
          </div>
          {offence.length === 0 ? <p className="px-5 py-8 text-center text-sm text-status-neutral">No counted offences in {offPeriodLabel}.</p> : (
            <div className="max-h-60 divide-y divide-black/5 overflow-y-auto">
              {offence.map((d, i) => (
                <div key={d.name} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-5 text-sm font-bold text-status-neutral">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-navy">{d.name}</span>
                  <span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold',
                    d.count >= 3 ? 'bg-status-critical/10 text-status-critical' : d.count === 2 ? 'bg-status-warning/15 text-[#8a6d10]' : 'bg-navy/5 text-navy')}>
                    {d.count} event{d.count === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <Trophy size={16} className="text-status-good" />
            <h3 className="font-display text-sm font-bold text-navy">Clean-record scoreboard</h3>
            <span className="ml-auto rounded-full bg-status-good/10 px-2 py-0.5 text-xs font-medium text-status-good">{clean.length} drivers</span>
          </div>
          {clean.length === 0 ? <p className="px-5 py-8 text-center text-sm text-status-neutral">No spotless records yet.</p> : (
            <div className="max-h-60 overflow-auto p-4">
              <div className="flex flex-wrap gap-1.5">
                {clean.map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-status-good/10 px-2.5 py-1 text-xs text-navy"><ShieldCheck size={12} className="text-status-good" /> {d.full_name}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Action taken: the proof that a breach leads somewhere ── */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 border-l-4 border-l-status-good px-5 py-3.5">
          <Gavel size={16} className="text-status-good" />
          <h3 className="font-display text-sm font-bold text-navy">Action taken — {monthFull(effCmp)}</h3>
          <span className="text-[11px] text-status-neutral">what happened to the drivers who sped</span>
          <Link to="/safety/incidents" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            Open incidents <ChevronRight size={13} />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-px bg-black/5 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'Escalated to a case', value: enforcement.monthCases.length, sub: `of ${a.countThis} event${a.countThis === 1 ? '' : 's'}`, tone: '' },
            { label: 'Charged', value: enforcement.charged.length, sub: 'sanction approved by Ops', tone: enforcement.charged.length ? 'text-status-good' : '' },
            { label: 'Fines issued', value: `K${enforcement.fineTotal.toLocaleString()}`, sub: `${enforcement.fineCount} fine${enforcement.fineCount === 1 ? '' : 's'}${enforcement.toPayroll ? ` · ${enforcement.toPayroll} to payroll` : ''}`, tone: enforcement.fineTotal ? 'text-navy' : '' },
            { label: 'Cleared', value: enforcement.cleared.length, sub: 'no case to answer', tone: '' },
            { label: 'Still open', value: enforcement.open.length, sub: 'with Safety or Ops', tone: enforcement.open.length ? 'text-[#8a6d10]' : '' },
          ].map((s) => (
            <div key={s.label} className="bg-surface px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-status-neutral">{s.label}</div>
              <div className={clsx('mt-1 font-display text-xl font-bold leading-none', s.tone || 'text-navy')}>{s.value}</div>
              <div className="mt-0.5 text-[10px] text-status-neutral">{s.sub}</div>
            </div>
          ))}
        </div>

        {enforcement.byDecision.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-black/5 px-5 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Sanctions</span>
            {enforcement.byDecision.map((x) => (
              <span key={x.d} className={clsx('rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                x.d === 'dismissal' ? 'bg-status-critical/10 text-status-critical'
                  : x.d === 'fine' ? 'bg-status-warning/15 text-[#8a6d10]' : 'bg-navy/5 text-navy')}>
                {x.label} <b>{x.n}</b>
              </span>
            ))}
          </div>
        )}

        {enforcement.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-status-neutral">
            {enforcement.monthCases.length === 0
              ? `No speeding event in ${monthFull(effCmp)} was escalated to a disciplinary case.`
              : `${enforcement.monthCases.length} case${enforcement.monthCases.length === 1 ? '' : 's'} raised, but none has an approved sanction yet — ${enforcement.open.length} still with Safety or Ops.`}
          </p>
        ) : (
          <>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-canvas text-status-neutral"><tr>
                  <th className="px-5 py-2 font-medium">Driver</th>
                  <th className="px-4 py-2 font-medium">Bus</th>
                  <th className="px-4 py-2 font-medium">Offence</th>
                  <th className="px-4 py-2 font-medium">Decision</th>
                  <th className="px-4 py-2 text-right font-medium">Fine</th>
                  <th className="px-4 py-2 font-medium">Evidence</th>
                  <th className="px-4 py-2 font-medium">Decided</th>
                </tr></thead>
                <tbody>
                  {enforcement.rows.map((c) => (
                    <tr key={c.id} className="border-t border-black/5">
                      <td className="px-5 py-2 font-medium text-navy">{c.driver_name || '—'}</td>
                      <td className="px-4 py-2 text-status-neutral">{c.vehicle_label}</td>
                      <td className="px-4 py-2 text-status-neutral">
                        {c.over_by ? `+${c.over_by} km/h` : '—'}
                        <span className="ml-1 text-[10px]">{fmtDayMonth(c.event_datetime)}</span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(c.verdict!.decisions ?? []).filter((d) => d !== 'cleared').map((d) => (
                            <span key={d} className={clsx('rounded-full px-2 py-0.5 text-[10px] font-medium',
                              d === 'dismissal' ? 'bg-status-critical/10 text-status-critical' : 'bg-navy/5 text-navy')}>
                              {DECISION_LABEL[d]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className={clsx('px-4 py-2 text-right font-medium', c.verdict!.fine_amount ? 'text-navy' : 'text-status-neutral')}>
                        {c.verdict!.fine_amount ? `K${c.verdict!.fine_amount.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {c.verdict!.fine_file && <span className="inline-flex items-center gap-0.5 rounded-full bg-status-good/10 px-1.5 py-0.5 text-status-good"><FileCheck size={10} /> fine doc</span>}
                          {c.memo && <span className="inline-flex items-center gap-0.5 rounded-full bg-status-good/10 px-1.5 py-0.5 text-status-good"><FileCheck size={10} /> memo</span>}
                          {c.charge_statement && <span className="inline-flex items-center gap-0.5 rounded-full bg-status-good/10 px-1.5 py-0.5 text-status-good"><FileCheck size={10} /> charge</span>}
                          {c.verdict!.to_payroll && c.verdict!.fine_amount > 0 && <span className="rounded-full bg-brand-tint/60 px-1.5 py-0.5 text-[#8a4513]">to payroll</span>}
                          {!c.verdict!.fine_file && !c.memo && !c.charge_statement && <span className="text-status-neutral">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-[11px] text-status-neutral">
                        {c.verdict!.decided_at ? <>{fmtDayMonth(c.verdict!.decided_at)}<br />{c.verdict!.decided_by}</> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-black/5 px-5 py-2.5 text-[11px] leading-relaxed text-status-neutral">
              Only sanctions <b className="text-navy">approved by Operations</b> are counted here — a proposal sitting with Safety is not a charge.
              {enforcement.withProof > 0 && <> {enforcement.withProof} of {enforcement.charged.length} carry a signed document on file.</>}
              {enforcement.rejected.length > 0 && <> {enforcement.rejected.length} proposed verdict{enforcement.rejected.length === 1 ? ' was' : 's were'} rejected by Ops.</>}
            </p>
          </>
        )}
      </div>

      {/* ── Where on the ground ── */}
      {geoPts.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <MapPin size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Where it happens — {monthFull(effCmp)}</h3>
            <span className="text-[11px] text-status-neutral">{fgeoPts.length} of {geoPts.length} located event{geoPts.length === 1 ? '' : 's'}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select value={geoBus} onChange={(e) => pickBus(e.target.value)} className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-xs font-medium text-navy outline-none focus:border-brand">
                <option value="all">All buses</option>
                {geoBuses.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={geoDriver} onChange={(e) => pickDriver(e.target.value)} className="rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-xs font-medium text-navy outline-none focus:border-brand">
                <option value="all">All drivers</option>
                {geoDrivers.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              {(geoBus !== 'all' || geoDriver !== 'all') && (
                <button onClick={() => { setGeoBus('all'); setGeoDriver('all') }} className="text-xs font-medium text-brand hover:underline">Clear</button>
              )}
            </div>
          </div>
          <div className="grid gap-0 lg:grid-cols-[1.7fr_1fr]">
            <div className="p-4">
              <SpeedHotspotMap points={heatPoints} />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-status-neutral">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'rgba(46,125,79,0.7)' }} /> Just over the limit</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'rgba(201,162,39,0.85)' }} /> Moderate</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: 'rgba(179,38,30,0.85)' }} /> Well over — 30 km/h+</span>
                <span className="ml-auto">Hover a point for the bus, driver, date and how far over.</span>
              </div>
            </div>
            <div className="border-t border-black/5 p-4 lg:border-l lg:border-t-0">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Worst locations</div>
              {hotspots.length === 0 ? <p className="py-6 text-center text-sm text-status-neutral">No located events for this filter.</p> : (
                <div className="max-h-[300px] space-y-1.5 overflow-auto pr-1">
                  {hotspots.slice(0, 10).map((h, i) => (
                    <div key={h.name} className="flex items-center gap-2 text-sm">
                      <span className="w-4 shrink-0 text-[11px] font-bold text-status-neutral">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-navy" title={h.name}>{h.name}</div>
                        <div className="text-[10px] text-status-neutral">{h.buses} bus{h.buses === 1 ? '' : 'es'} · avg +{h.avgOver} km/h over</div>
                      </div>
                      <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
                        i === 0 ? 'bg-status-critical/10 text-status-critical' : 'bg-navy/5 text-navy')}>{h.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── What to do about it ── */}
      <div className="card p-5">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <Lightbulb size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">What to do about it</h3>
          <span className="text-[11px] text-status-neutral">based on {offPeriodLabel}{hotspots.length === 0 ? ' · import Geotab coordinates for location insights' : ''}</span>
        </div>
        <ul className="space-y-1.5">
          {recommendations.map((r, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-navy">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />{r}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Data quality: what was left out of the figures above ── */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <Clock size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">
            Tracker glitches excluded — {single ? monthFull(a.thisKey) : `${monthFull(a.lastKey)} & ${monthFull(a.thisKey)}`}
          </h3>
          {a.glitches.length > 0 && <span className="rounded-full bg-status-warning/15 px-2 py-0.5 text-xs font-medium text-[#8a6d10]">{a.glitches.length}</span>}
        </div>
        {a.glitches.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-status-neutral">No implausible readings in {single ? monthFull(a.thisKey) : 'these months'} — every event above was genuine.</p>
        ) : (
          <>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-canvas text-status-neutral"><tr>
                  <th className="px-5 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 text-right font-medium">Reported speed</th><th className="px-4 py-2 font-medium">Location</th>
                </tr></thead>
                <tbody>
                  {a.glitches.map((e) => (
                    <tr key={e.id} className="border-t border-black/5">
                      <td className="px-5 py-2 text-navy">{fmtDate(e.event_datetime)} <span className="text-status-neutral">{fmtTime(e.event_datetime)}</span></td>
                      <td className="px-4 py-2 text-navy">{e.vehicle_label}</td>
                      <td className="px-4 py-2 text-right font-medium text-status-critical">{e.recorded_speed} km/h</td>
                      <td className="px-4 py-2 text-status-neutral">{e.route || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[11px] leading-relaxed text-status-neutral">
              A governed Tata bus cannot plausibly exceed ~100 km/h, so readings at or above 105 km/h (often geo-tagged at the workshop) are GPS faults. They are excluded from every figure above so they cannot flatter or distort the trend.
            </p>
          </>
        )}
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — comparative branch toggling here is a senior-management tool.</p>}
    </div>
  )
}

function PerBusTable({ title, icon, rows, positive, lastLabel, thisLabel }: {
  title: string; icon: React.ReactNode; rows: { fleet: string; last: number; this: number; change: number }[]
  positive: boolean; lastLabel: string; thisLabel: string
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">{icon}<h3 className="font-display text-sm font-bold text-navy">{title}</h3></div>
      {rows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-status-neutral">Nothing to show.</p> : (
        <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-canvas text-status-neutral"><tr>
            <th className="px-5 py-2 font-medium">Vehicle</th><th className="px-4 py-2 text-right font-medium">{lastLabel}</th>
            <th className="px-4 py-2 text-right font-medium">{thisLabel}</th><th className="px-4 py-2 text-right font-medium">Change</th>
          </tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.fleet} className="border-t border-black/5">
                <td className="px-5 py-2 font-medium text-navy">{b.fleet}</td>
                <td className="px-4 py-2 text-right text-status-neutral">{b.last}</td>
                <td className="px-4 py-2 text-right text-status-neutral">{b.this}</td>
                <td className={clsx('px-4 py-2 text-right font-bold', positive ? 'text-status-critical' : 'text-status-good')}>{b.change > 0 ? `+${b.change}` : b.change}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}
