import { useMemo, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine, ReferenceArea, Legend, CartesianGrid,
} from 'recharts'
import { TrendingDown, TrendingUp, Minus, Download, ShieldCheck, AlertTriangle, Trophy, Activity, ShieldAlert, FileText } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import Button from '@/components/ui/Button'
import { useSpeedEvents } from '@/lib/speed/store'
import { useSpeedGeo } from '@/lib/speed/geo'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { computeSpeedAnalytics } from '@/lib/speed/analytics'
import SpeedHotspotMap from '@/components/speed/SpeedHotspotMap'
import { exportSpeedPdf, svgToPng } from '@/lib/speed/pdf'
import { overBy, offenceNumberInBand, penaltyFor, countsAgainstDriver, isGlitch, ZONE_META, monthKey, monthLabel } from '@/lib/speed/types'
import { exportEvents } from '@/lib/speed/excel'

const NAVY = '#0F1B33', BRAND = '#D16B21', GRID = 'rgba(15,27,51,0.06)'
const tip = { borderRadius: 10, border: '1px solid #eee', fontSize: 12 }

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
      {subtitle && <p className="mb-3 text-[11px] text-status-neutral">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
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

  // Month selector — months that have data for this branch, latest first. The
  // current calendar month is offered too, but the default lands on the newest
  // month that actually HAS data, so on the 1st the overview doesn't open empty.
  const dataMonths = useMemo(
    () => [...new Set(allEvents.filter((e) => e.branch === branch).map((e) => monthKey(e.event_datetime)))].sort().reverse(),
    [allEvents, branch],
  )
  const monthOptions = useMemo(() => {
    const now = new Date()
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return [...new Set([cur, ...dataMonths])].sort().reverse()
  }, [dataMonths])
  // Two-month comparison. "Compare" = month under review (defaults to the newest
  // with data), "vs" = baseline (defaults to the month before it).
  const [cmpKey, setCmpKey] = useState('')
  const [baseKey, setBaseKey] = useState('')
  const effCmp = monthOptions.includes(cmpKey) ? cmpKey : (dataMonths[0] ?? monthOptions[0])
  // monthOptions is latest-first, so the month right after effCmp in the list
  // is the chronologically previous one — the natural baseline.
  const effBase = monthOptions.includes(baseKey)
    ? baseKey
    : (monthOptions[monthOptions.indexOf(effCmp) + 1] ?? monthOptions.find((k) => k !== effCmp) ?? effCmp)

  const a = useMemo(() => computeSpeedAnalytics(allEvents, vehicles, branch, effCmp, effBase, new Date()), [allEvents, vehicles, branch, effCmp, effBase])

  // Driver-accountability extras (valid, branch events)
  const valid = useMemo(() => allEvents.filter((e) => e.branch === branch && countsAgainstDriver(e)), [allEvents, branch])
  const offence = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>()
    for (const e of valid) { const k = e.driver_id || e.driver_name; const c = m.get(k) ?? { name: e.driver_name, count: 0 }; c.count++; m.set(k, c) }
    return [...m.values()].sort((x, y) => y.count - x.count)
  }, [valid])
  const repeatOffenders = offence.filter((d) => d.count >= 2)
  const offenderKeys = new Set(allEvents.filter((e) => e.branch === branch).map((e) => e.driver_id || e.driver_name))
  const clean = drivers.filter((d) => !offenderKeys.has(d.id) && !offenderKeys.has(d.full_name))
  const finesThisMonth = allEvents
    .filter((e) => e.branch === branch && !isGlitch(e) && monthKey(e.event_datetime) === a.thisKey && e.status === 'confirmed')
    .reduce((s, e) => s + (penaltyFor(overBy(e), offenceNumberInBand(allEvents.filter((x) => x.branch === branch), e))?.fine ?? 0), 0)
  const atDismissal = new Set(
    allEvents.filter((e) => e.branch === branch && penaltyFor(overBy(e), offenceNumberInBand(allEvents.filter((x) => x.branch === branch), e))?.dismissal).map((e) => e.driver_id || e.driver_name),
  ).size

  // ── Coordinate hotspots (from Geotab detail) for the month under review ──
  const geo = useSpeedGeo()
  const geoPts = useMemo(
    () => allEvents
      .filter((e) => e.branch === branch && !isGlitch(e) && monthKey(e.event_datetime) === effCmp)
      .map((e) => ({ e, g: geo[e.id] }))
      .filter((x): x is { e: typeof x.e; g: NonNullable<typeof x.g> } => !!x.g && (x.g.lat !== 0 || x.g.lng !== 0)),
    [allEvents, branch, effCmp, geo],
  )
  const [geoBus, setGeoBus] = useState('all')
  const geoBuses = useMemo(() => [...new Set(geoPts.map((p) => p.e.vehicle_label))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), [geoPts])
  const fgeoPts = useMemo(() => (geoBus === 'all' ? geoPts : geoPts.filter((p) => p.e.vehicle_label === geoBus)), [geoPts, geoBus])
  const heatPoints = useMemo(
    () => fgeoPts.map(({ e, g }) => ({ lat: g.lat, lng: g.lng, weight: Math.min(1, overBy(e) / 30), label: `${e.vehicle_label} · ${e.event_datetime.slice(0, 16).replace('T', ' ')} · +${overBy(e)} km/h · ${e.route || ''}` })),
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

  // ── Stakeholder PDF (verdict + KPIs + charts + hotspots + offenders) ──
  const [exporting, setExporting] = useState(false)
  async function exportPdf() {
    setExporting(true)
    try {
      const specs: [string, string][] = [
        ['spd-chart-trend', 'Events per month'],
        ['spd-chart-rate', 'Speeding per bus, per day'],
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
      const verdict = a.same
        ? `Speeding held steady in ${a.thisLabel}: ${a.rateThis.toFixed(2)} events per bus per day, unchanged from ${a.lastLabel}.`
        : a.improving
          ? `Speeding improved ${Math.abs(a.ratePct)}% in ${a.thisLabel}: ${a.rateThis.toFixed(2)} events per bus per day, down from ${a.rateLast.toFixed(2)} in ${a.lastLabel}.`
          : `Speeding deteriorated ${a.ratePct}% in ${a.thisLabel}: ${a.rateThis.toFixed(2)} events per bus per day, up from ${a.rateLast.toFixed(2)} in ${a.lastLabel}.`
      const suggestions: string[] = []
      if (hotspots[0]) suggestions.push(`${hotspots[0].name} is the worst location (${hotspots[0].count} events) — prioritise signage and enforcement there.`)
      if (peakHour.count > 0) suggestions.push(`Most breaches cluster around ${String(peakHour.hour).padStart(2, '0')}:00 — brief crews before that window.`)
      if (topGeoBus) suggestions.push(`${topGeoBus.fleet} triggered the most events (${topGeoBus.count}) — focus coaching and review its route.`)
      if (repeatOffenders.length) suggestions.push(`${repeatOffenders.length} repeat offender${repeatOffenders.length === 1 ? '' : 's'} — hold counselling sessions and apply the penalty ladder consistently.`)
      exportSpeedPdf({
        branchLabel,
        periodLabel: `${a.thisLabel} vs ${a.lastLabel}`,
        generated: new Date().toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }),
        verdict,
        kpis: [
          { label: 'Speeding / bus / day', value: a.rateThis.toFixed(2), sub: `vs ${a.rateLast.toFixed(2)} last` },
          { label: 'Valid events', value: String(a.countThis), sub: a.thisLabel },
          { label: 'Avg over limit', value: `${a.avgSevThis.toFixed(1)} km/h`, sub: 'severity' },
          { label: 'Repeat offenders', value: String(repeatOffenders.length), sub: '2+ events' },
          { label: 'Buses speeding more', value: `${a.busesWorse}/${a.activeBuses}`, sub: `${a.busesImproved} improved` },
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

  const TrendIcon = a.same ? Minus : a.improving ? TrendingDown : TrendingUp
  const trendColor = a.same ? 'text-status-neutral' : a.improving ? 'text-status-good' : 'text-status-critical'
  const rateFmt = (r: number) => r.toFixed(2)

  return (
    <div className="page space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-status-neutral">
          {branchLabel} speeding performance — {a.lastLabel} → {a.thisLabel}, normalized per active bus per day.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-status-neutral">
            Compare
            <select
              value={effCmp}
              onChange={(e) => setCmpKey(e.target.value)}
              className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand"
            >
              {monthOptions.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
            </select>
          </label>
          <span className="text-xs text-status-neutral">vs</span>
          <select
            value={effBase}
            onChange={(e) => setBaseKey(e.target.value)}
            className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-navy outline-none focus:border-brand"
          >
            {monthOptions.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
          </select>
          <Button variant="secondary" onClick={exportPdf} disabled={exporting}><FileText size={15} /> {exporting ? 'Preparing…' : 'PDF report'}</Button>
          <Button variant="secondary" onClick={() => exportEvents(allEvents.filter((e) => e.branch === branch), branchLabel)}><Download size={15} /> Export</Button>
        </div>
      </div>

      {/* Headline */}
      <div className="card flex flex-wrap items-center gap-5 p-5">
        <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${a.improving ? 'bg-status-good/10' : a.same ? 'bg-canvas' : 'bg-status-critical/10'}`}>
          <TrendIcon size={30} className={trendColor} />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-lg font-bold text-navy">
            {a.same ? 'Speeding held steady this month' : a.improving ? `Speeding improved ${Math.abs(a.ratePct)}% this month` : `Speeding deteriorated ${a.ratePct}% this month`}
          </h2>
          <p className="text-sm text-status-neutral">
            On average each bus triggered <span className="font-medium text-navy">{rateFmt(a.rateThis)}</span> speeding events per day in {a.thisLabel}, vs {rateFmt(a.rateLast)} in {a.lastLabel}.
            We divide by the number of buses on the road ({a.activeBuses}) so months with bigger fleets don't look worse automatically.
            Severity stayed around {a.avgSevThis.toFixed(1)} km/h over the limit. {a.improving ? 'Keep it up.' : a.same ? '' : 'See what changed below.'}
          </p>
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Speeding / bus / day"
          info="Average speeding events per active bus each day. We normalise by fleet size so months with more buses on the road still compare fairly."
          value={rateFmt(a.rateThis)}
          tone={a.improving || a.same ? 'good' : 'critical'}
          trend={a.same ? undefined : { dir: a.improving ? 'down' : 'up', text: `${Math.abs(a.ratePct)}%`, good: a.improving }}
          sub={`vs ${rateFmt(a.rateLast)} in ${a.lastLabel}`}
        />
        <KpiCard label="Fines this month" value={`K${finesThisMonth.toLocaleString()}`} tone={finesThisMonth ? 'warning' : 'good'} sub="from confirmed charges" info="Total fines from charges confirmed this month, per the penalty policy." />
        <KpiCard label="Valid events" value={a.countThis} sub={a.thisLabel} info="Genuine speeding events this month, after removing GPS glitches." />
        <KpiCard label="Repeat offenders" value={repeatOffenders.length} tone={repeatOffenders.length ? 'critical' : 'good'} sub="drivers with 2+ events" />
        <KpiCard label="Buses speeding more" value={`${a.busesWorse} / ${a.activeBuses}`} tone={a.busesWorse ? 'critical' : 'good'} sub={`${a.busesImproved} improved`} info="Buses with more speeding events than last month, out of the active fleet." />
        <KpiCard label="At dismissal" value={atDismissal} tone={atDismissal ? 'critical' : 'good'} sub="drivers at the threshold" info="Drivers whose offence history has reached the dismissal step in the penalty policy." />
      </div>

      {/* Trend + normalized rate */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card title="Events per month" subtitle={`Raw valid events — ${a.thisLabel} (navy) and ${a.lastLabel} (orange) highlighted`}>
          <div id="spd-chart-trend" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.trend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(209,107,33,0.06)' }} formatter={(v: number) => [`${v} events`, 'Events']} contentStyle={tip} />
                <Bar dataKey="events" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {a.trend.map((t, i) => <Cell key={i} fill={t.key === a.thisKey ? NAVY : t.key === a.lastKey ? BRAND : 'rgba(15,27,51,0.18)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Speeding per bus, per day" subtitle="The fair month-to-month number — adjusts for how many buses ran, so a bigger fleet isn't penalised.">
          <div id="spd-chart-rate" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: a.lastLabel, rate: +a.rateLast.toFixed(2) }, { name: a.thisLabel, rate: +a.rateThis.toFixed(2) }]} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [`${v} / bus / day`, 'Rate']} contentStyle={tip} />
                <Bar dataKey="rate" radius={[6, 6, 0, 0]} maxBarSize={64}>
                  <Cell fill={BRAND} /><Cell fill={a.improving ? '#2E7D4F' : '#B3261E'} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Daily + hourly */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Daily trend — ${a.thisLabel}`} subtitle={`Dashed line = ${a.lastLabel} daily average (${a.lastDailyAvg.toFixed(1)})`}>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={a.daily} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [`${v} events`, 'Events']} labelFormatter={(d) => `Day ${d}`} contentStyle={tip} />
                <ReferenceLine y={a.lastDailyAvg} stroke={NAVY} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="events" stroke={BRAND} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Hourly pattern" subtitle="Shaded = shift-change windows (05–07, 17–19) — the usual hotspots">
          <div id="spd-chart-hourly" className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={a.hourly} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <ReferenceArea x1="05" x2="07" fill="rgba(201,162,39,0.12)" />
                <ReferenceArea x1="17" x2="19" fill="rgba(201,162,39,0.12)" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number, n: string) => [`${v} events`, n]} labelFormatter={(h) => `${h}:00`} contentStyle={tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="lastM" name={a.lastLabel} stroke={NAVY} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="thisM" name={a.thisLabel} stroke={BRAND} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* By model + zone mix */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By bus model" subtitle={`Events ${a.lastLabel} vs ${a.thisLabel}`}>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.byModel} margin={{ top: 8, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="model" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="lastM" name={a.lastLabel} fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="thisM" name={a.thisLabel} fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Where it happens — by speed zone" subtitle="Open-road breaches (>80) carry more risk than slow site-zone ones">
          <div id="spd-chart-zone" className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.zoneMix} layout="vertical" margin={{ top: 8, right: 10, bottom: 0, left: 6 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="month" width={48} tick={{ fontSize: 12, fill: '#0F1B33' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="open" stackId="z" name={ZONE_META.open.label} fill={ZONE_META.open.fill} />
                <Bar dataKey="site" stackId="z" name={ZONE_META.site.label} fill={ZONE_META.site.fill} />
                <Bar dataKey="ring" stackId="z" name={ZONE_META.ring.label} fill={ZONE_META.ring.fill} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Per-bus winners & concerns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PerBusTable title="Watch list — largest deterioration" icon={<AlertTriangle size={16} className="text-status-critical" />} rows={a.watch} positive />
        <PerBusTable title="Improved — largest reduction" icon={<Trophy size={16} className="text-status-good" />} rows={a.improved} positive={false} />
      </div>
      {a.concentrationBuses.length > 0 && (
        <div className="rounded-xl border border-status-critical/20 bg-status-critical/5 px-4 py-3 text-sm text-navy">
          <span className="font-semibold text-status-critical">Concentration risk:</span> {a.concentrationBuses.join(', ')} account for{' '}
          <span className="font-semibold">{a.concentrationShare}%</span> of this month's increase — focus coaching here rather than a blanket fleet memo.
        </div>
      )}

      {/* Driver accountability */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <ShieldAlert size={16} className="text-status-critical" />
            <h3 className="font-display text-sm font-bold text-navy">Repeat-offender leaderboard</h3>
          </div>
          {offence.length === 0 ? <p className="px-5 py-8 text-center text-sm text-status-neutral">No offences recorded.</p> : (
            <div className="max-h-96 divide-y divide-black/5 overflow-y-auto">
              {offence.slice(0, 8).map((d, i) => (
                <div key={d.name} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-5 text-sm font-bold text-status-neutral">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-navy">{d.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${d.count >= 3 ? 'bg-status-critical/10 text-status-critical' : d.count === 2 ? 'bg-status-warning/10 text-[#8a6d10]' : 'bg-navy/5 text-navy'}`}>{d.count} events</span>
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
            <div className="flex flex-wrap gap-1.5 p-4">
              {clean.slice(0, 18).map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-status-good/8 px-2.5 py-1 text-xs text-navy"><ShieldCheck size={12} className="text-status-good" /> {d.full_name}</span>
              ))}
              {clean.length > 18 && <span className="px-2 py-1 text-xs text-status-neutral">+{clean.length - 18} more</span>}
            </div>
          )}
        </div>
      </div>

      {/* Where it's happening — coordinate hotspot map */}
      {geoPts.length > 0 && (
        <Card title="Where it's happening — hotspot map" subtitle={`${fgeoPts.length} located speeding event${fgeoPts.length === 1 ? '' : 's'}${geoBus === 'all' ? '' : ` for ${geoBus}`} in ${a.thisLabel}. Warmer areas = more speeding.`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-status-neutral">Filter by bus</span>
            <select value={geoBus} onChange={(e) => setGeoBus(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm font-medium text-navy outline-none focus:border-brand">
              <option value="all">All buses ({geoPts.length})</option>
              {geoBuses.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            {geoBus !== 'all' && <button onClick={() => setGeoBus('all')} className="text-xs text-brand hover:underline">clear</button>}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <SpeedHotspotMap points={heatPoints} />
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Top hotspots</div>
              <div className="max-h-64 space-y-1 overflow-auto pr-1">
                {hotspots.slice(0, 8).map((h) => (
                  <div key={h.name} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate text-navy" title={h.name}>{h.name}</span>
                    <span className="text-[11px] text-status-neutral">{h.buses} bus{h.buses === 1 ? '' : 'es'} · +{h.avgOver}</span>
                    <span className="rounded-full bg-status-critical/10 px-2 py-0.5 text-xs font-bold text-status-critical">{h.count}</span>
                  </div>
                ))}
                {hotspots.length === 0 && <p className="py-6 text-center text-sm text-status-neutral">No located events for this bus.</p>}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-brand/25 bg-brand-tint/25 px-4 py-3">
            <div className="mb-1 text-sm font-semibold text-navy">Suggestions to curb it</div>
            <ul className="ml-4 list-disc space-y-0.5 text-[13px] text-status-neutral">
              {hotspots[0] && <li><span className="text-navy">{hotspots[0].name}</span> is the worst spot ({hotspots[0].count} events) — signage / a rumble strip and spot-checks there would bite hardest.</li>}
              {peakHour.count > 0 && <li>Most breaches cluster around <span className="text-navy">{String(peakHour.hour).padStart(2, '0')}:00</span> — brief crews before that window.</li>}
              {topGeoBus && <li><span className="text-navy">{topGeoBus.fleet}</span> triggered the most ({topGeoBus.count}) — coach that crew and review its route.</li>}
            </ul>
          </div>
        </Card>
      )}

      {/* Data quality */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <Activity size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">Data quality — tracker glitches excluded</h3>
        </div>
        {a.glitches.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-status-neutral">No implausible readings in this period.</p>
        ) : (
          <>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-canvas text-status-neutral"><tr>
                  <th className="px-5 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 font-medium">Reported speed</th><th className="px-4 py-2 font-medium">Location</th>
                </tr></thead>
                <tbody>
                  {a.glitches.map((e) => (
                    <tr key={e.id} className="border-t border-black/5">
                      <td className="px-5 py-2 text-navy">{e.event_datetime.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-navy">{e.vehicle_label}</td>
                      <td className="px-4 py-2 font-medium text-status-critical">{e.recorded_speed} km/h</td>
                      <td className="px-4 py-2 text-status-neutral">{e.route}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[11px] leading-relaxed text-status-neutral">
              A governed Tata bus cannot plausibly exceed ~100 km/h. Readings above {`>=`}105 km/h (often geo-tagged at the workshop) are GPS faults and are excluded from every figure above so they don't distort the trend.
            </p>
          </>
        )}
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — comparative branch toggling here is a senior-management tool.</p>}
    </div>
  )
}

function PerBusTable({ title, icon, rows, positive }: { title: string; icon: React.ReactNode; rows: { fleet: string; last: number; this: number; change: number }[]; positive: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">{icon}<h3 className="font-display text-sm font-bold text-navy">{title}</h3></div>
      {rows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-status-neutral">Nothing to show.</p> : (
        <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-canvas text-status-neutral"><tr>
            <th className="px-5 py-2 font-medium">Vehicle</th><th className="px-4 py-2 text-right font-medium">Last</th>
            <th className="px-4 py-2 text-right font-medium">This</th><th className="px-4 py-2 text-right font-medium">Change</th>
          </tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.fleet} className="border-t border-black/5">
                <td className="px-5 py-2 font-medium text-navy">{b.fleet}</td>
                <td className="px-4 py-2 text-right text-status-neutral">{b.last}</td>
                <td className="px-4 py-2 text-right text-status-neutral">{b.this}</td>
                <td className={`px-4 py-2 text-right font-bold ${positive ? 'text-status-critical' : 'text-status-good'}`}>{b.change > 0 ? `+${b.change}` : b.change}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}
