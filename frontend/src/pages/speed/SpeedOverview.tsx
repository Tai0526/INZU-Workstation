import { useMemo, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine, ReferenceArea, Legend, CartesianGrid,
} from 'recharts'
import { TrendingDown, TrendingUp, Minus, Download, ShieldCheck, AlertTriangle, Trophy, Activity, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import Button from '@/components/ui/Button'
import { useSpeedEvents } from '@/lib/speed/store'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { computeSpeedAnalytics } from '@/lib/speed/analytics'
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

  // Month selector — months that have data for this branch, latest first.
  const monthOptions = useMemo(() => {
    const keys = new Set(allEvents.filter((e) => e.branch === branch).map((e) => monthKey(e.event_datetime)))
    const now = new Date()
    keys.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    return [...keys].sort().reverse()
  }, [allEvents, branch])
  // Two-month comparison. "Compare" = month under review (defaults to the
  // latest), "vs" = baseline (defaults to the month before it).
  const [cmpKey, setCmpKey] = useState('')
  const [baseKey, setBaseKey] = useState('')
  const effCmp = monthOptions.includes(cmpKey) ? cmpKey : monthOptions[0]
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
          <div className="h-56">
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
          <div className="h-56">
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
          <div className="h-52">
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
          <div className="h-52">
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
            <div className="divide-y divide-black/5">
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-canvas text-status-neutral"><tr>
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
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-status-neutral"><tr>
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
        </table>
      )}
    </div>
  )
}
