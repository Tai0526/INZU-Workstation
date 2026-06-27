import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, Bus, ArrowRight, ChevronRight, ShieldCheck, CalendarClock, Users, CheckCircle2, ClipboardList, AlertTriangle, CircleDot, Package } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import { useVehicles } from '@/lib/fleet/store'
import { useEmployees } from '@/lib/hr/store'
import { useJobCards, useTyres, useSpares, usePm, pmStore } from '@/lib/workshop/store'
import { JOB_STATUS_META, SEVERITY_META, JOB_CATEGORY_LABEL, type JobCategory, pmStatus, PM_META, spareLow } from '@/lib/workshop/types'

const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString('en', { day: '2-digit', month: 'short' }) } catch { return '—' } }

function Rank({ items, color, empty }: { items: { label: string; sub?: string; n: number }[]; color: string; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.n))
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-status-neutral">{empty}</p>
  return (
    <div className="divide-y divide-black/5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3 px-5 py-2">
          <span className="w-28 shrink-0 truncate text-sm text-navy" title={it.label}>{it.label}{it.sub && <span className="block text-[10px] text-status-neutral">{it.sub}</span>}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full" style={{ width: `${(it.n / max) * 100}%`, background: color }} /></div>
          <span className="w-6 text-right text-sm font-semibold text-navy">{it.n}</span>
        </div>
      ))}
    </div>
  )
}

export default function WorkshopOverview() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const mechanics = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'Mechanic')
  const jobs = useJobCards().filter((j) => j.branch === branch)
  const tyres = useTyres().filter((t) => t.branch === branch)
  const spares = useSpares().filter((s) => s.branch === branch)
  usePm()
  const today = new Date().toISOString().slice(0, 10)

  const open = useMemo(() => jobs.filter((j) => j.status === 'open').sort((a, b) => b.reported_at.localeCompare(a.reported_at)), [jobs])
  const awaiting = useMemo(() => jobs.filter((j) => j.status === 'awaiting_approval').sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')), [jobs])
  const grounded = vehicles.filter((v) => v.status === 'grounded').length
  const sparesLow = spares.filter(spareLow).length

  // ── Insights to help prepare ──
  const serviceDue = useMemo(() => vehicles
    .map((v) => ({ v, ...pmStatus(pmStore.for(v.fleet_no), today) }))
    .filter((r) => r.state === 'overdue' || r.state === 'soon')
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, today, pmStore.get()])

  const topMechs = useMemo(() => {
    const m = new Map<string, number>()
    for (const j of jobs) for (const name of j.mechanics) m.set(name, (m.get(name) ?? 0) + 1)
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 6)
  }, [jobs])

  const topVehicles = useMemo(() => {
    const m = new Map<string, number>()
    for (const j of jobs) m.set(j.fleet_no, (m.get(j.fleet_no) ?? 0) + 1)
    return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).filter((x) => x.n >= 2).slice(0, 6)
  }, [jobs])

  const topFaults = useMemo(() => {
    const m = new Map<JobCategory, number>()
    for (const j of jobs) { const c = (j.category || 'mechanical') as JobCategory; m.set(c, (m.get(c) ?? 0) + 1) }
    return [...m.entries()].map(([c, n]) => ({ label: JOB_CATEGORY_LABEL[c], n })).sort((a, b) => b.n - a.n)
  }, [jobs])

  const tyresThisMonth = tyres.filter((t) => (t.fitted_date || '').slice(0, 7) === today.slice(0, 7)).length

  return (
    <div className="page space-y-6">
      <p className="text-sm text-status-neutral">
        Faults, repairs, servicing and insight for <span className="font-medium text-navy">{branchLabel}</span> — live from job cards, checklists, the vehicle register and HR.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="In workshop" value={open.length} tone={open.length ? 'warning' : 'good'} sub="open job cards" />
        <KpiCard label="Awaiting sign-off" value={awaiting.length} tone={awaiting.length ? 'warning' : 'good'} sub="Asst Ops to approve" />
        <KpiCard label="Grounded" value={grounded} tone={grounded ? 'critical' : 'good'} sub="out of service" />
        <KpiCard label="Service due" value={serviceDue.length} tone={serviceDue.some((r) => r.state === 'overdue') ? 'critical' : serviceDue.length ? 'warning' : 'good'} sub="overdue / soon" />
        <KpiCard label="Spares low" value={sparesLow} tone={sparesLow ? 'critical' : 'good'} sub="below minimum" />
        <KpiCard label="Mechanics" value={mechanics.length} sub="on the team" />
      </div>

      {/* Approval + workshop queues */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <ShieldCheck size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Awaiting sign-off</h3>
            {awaiting.length > 0 && <span className="ml-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-xs font-medium text-[#8a6d10]">{awaiting.length}</span>}
            <Link to="/workshop/jobcards" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">Job cards <ChevronRight size={13} /></Link>
          </div>
          {awaiting.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral"><CheckCircle2 size={24} className="text-status-good" /><p className="text-sm">Nothing waiting for sign-off.</p></div> : (
            <div className="max-h-72 divide-y divide-black/5 overflow-y-auto">
              {awaiting.map((j) => (
                <Link to="/workshop/jobcards" key={j.id} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-navy"><Bus size={13} className="mr-1 inline text-status-neutral" />{j.fleet_no} <span className="text-status-neutral">· {j.fault}</span></div><div className="text-xs text-status-neutral">Repaired {fmt(j.completed_at)}{j.completed_by ? ` by ${j.completed_by}` : ''}</div></div>
                  <StatusBadge tone={JOB_STATUS_META[j.status].tone}>{JOB_STATUS_META[j.status].label}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <Wrench size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">In the workshop now</h3>
            {open.length > 0 && <span className="ml-1 rounded-full bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{open.length}</span>}
            <Link to="/workshop/jobcards" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">Job cards <ChevronRight size={13} /></Link>
          </div>
          {open.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral"><CheckCircle2 size={24} className="text-status-good" /><p className="text-sm">No buses in the workshop.</p></div> : (
            <div className="max-h-72 divide-y divide-black/5 overflow-y-auto">
              {open.map((j) => (
                <Link to="/workshop/jobcards" key={j.id} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-navy"><Bus size={13} className="mr-1 inline text-status-neutral" />{j.fleet_no} <span className="text-status-neutral">· {j.fault}</span></div><div className="text-xs text-status-neutral">Since {fmt(j.reported_at)}{j.mechanics.length ? ` · ${j.mechanics.join(', ')}` : ' · no mechanic'}</div></div>
                  <StatusBadge tone={SEVERITY_META[j.severity].tone}>{SEVERITY_META[j.severity].label.replace(' — grounds the bus', '')}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Insight: who's working, which buses keep breaking, what kind of faults */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><Users size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Busiest mechanics</h3><span className="ml-auto text-[11px] text-status-neutral">job cards worked</span></div>
          <Rank items={topMechs} color="#2E7D4F" empty="No jobs assigned yet." />
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><AlertTriangle size={16} className="text-status-critical" /><h3 className="font-display text-sm font-bold text-navy">Buses to watch</h3><span className="ml-auto text-[11px] text-status-neutral">2+ job cards — repeat faults</span></div>
          <Rank items={topVehicles} color="#B3261E" empty="No bus has repeat faults yet." />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Service due */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><CalendarClock size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Service due</h3>{serviceDue.length > 0 && <span className="ml-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-xs font-medium text-[#8a6d10]">{serviceDue.length}</span>}<Link to="/workshop/pm" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">PM <ChevronRight size={13} /></Link></div>
          {serviceDue.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral"><CheckCircle2 size={24} className="text-status-good" /><p className="text-sm">Every scheduled bus is on time.</p></div> : (
            <div className="max-h-72 divide-y divide-black/5 overflow-y-auto">
              {serviceDue.map(({ v, state, dueDate, daysLeft }) => (
                <Link to="/workshop/pm" key={v.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-navy"><Bus size={13} className="mr-1 inline text-status-neutral" />{v.fleet_no}</div><div className="text-xs text-status-neutral">Due {fmt(dueDate)} {daysLeft != null && (daysLeft < 0 ? `· ${-daysLeft}d overdue` : `· in ${daysLeft}d`)}</div></div>
                  <StatusBadge tone={PM_META[state].tone}>{PM_META[state].label}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Common fault types */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5"><ClipboardList size={16} className="text-brand" /><h3 className="font-display text-sm font-bold text-navy">Faults by type</h3><span className="ml-auto text-[11px] text-status-neutral">all job cards</span></div>
          <Rank items={topFaults} color="#D16B21" empty="No job cards yet." />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/workshop/checklists" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas"><ClipboardList size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Daily Checklists</span><ArrowRight size={15} className="ml-auto text-status-neutral" /></Link>
        <Link to="/workshop/jobcards" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas"><Wrench size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Job Cards</span><ArrowRight size={15} className="ml-auto text-status-neutral" /></Link>
        <Link to="/workshop/tyres" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas"><CircleDot size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Tyres <span className="text-[11px] font-normal text-status-neutral">· {tyresThisMonth} this month</span></span><ArrowRight size={15} className="ml-auto text-status-neutral" /></Link>
        <Link to="/workshop/spares" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas"><Package size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Critical Spares</span><ArrowRight size={15} className="ml-auto text-status-neutral" /></Link>
      </div>

      <p className="inline-flex items-center gap-1.5 text-xs text-status-neutral"><Users size={13} /> Mechanics are pulled from HR → Employees. Showing {branchLabel}.</p>
    </div>
  )
}
