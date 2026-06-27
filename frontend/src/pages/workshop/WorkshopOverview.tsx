import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, Bus, ArrowRight, ChevronRight, ShieldCheck, CalendarClock, Users, CheckCircle2, ClipboardList } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import { useVehicles } from '@/lib/fleet/store'
import { useEmployees } from '@/lib/hr/store'
import { useJobCards } from '@/lib/workshop/store'
import { JOB_STATUS_META, SEVERITY_META } from '@/lib/workshop/types'

const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString('en', { day: '2-digit', month: 'short' }) } catch { return '—' } }

export default function WorkshopOverview() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const mechanics = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'Mechanic')
  const jobs = useJobCards().filter((j) => j.branch === branch)

  const open = useMemo(() => jobs.filter((j) => j.status === 'open').sort((a, b) => b.reported_at.localeCompare(a.reported_at)), [jobs])
  const awaiting = useMemo(() => jobs.filter((j) => j.status === 'awaiting_approval').sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')), [jobs])

  const grounded = vehicles.filter((v) => v.status === 'grounded').length
  const available = vehicles.filter((v) => v.status === 'active').length

  return (
    <div className="page space-y-6">
      <p className="text-sm text-status-neutral">
        Faults, repairs and sign-offs for <span className="font-medium text-navy">{branchLabel}</span> — live from the job cards, the vehicle register and HR.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="In workshop" value={open.length} tone={open.length ? 'warning' : 'good'} sub="open job cards" />
        <KpiCard label="Awaiting sign-off" value={awaiting.length} tone={awaiting.length ? 'warning' : 'good'} sub="Asst Ops to approve" />
        <KpiCard label="Grounded" value={grounded} tone={grounded ? 'critical' : 'good'} sub="out of service" />
        <KpiCard label="Available buses" value={available} tone="good" sub="on the road" />
        <KpiCard label="Mechanics" value={mechanics.length} sub="on the team" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Awaiting sign-off — the approval queue */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <ShieldCheck size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Awaiting sign-off</h3>
            {awaiting.length > 0 && <span className="ml-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-xs font-medium text-[#8a6d10]">{awaiting.length}</span>}
            <Link to="/workshop/jobcards" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">Job cards <ChevronRight size={13} /></Link>
          </div>
          {awaiting.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral">
              <CheckCircle2 size={24} className="text-status-good" /><p className="text-sm">Nothing waiting for sign-off.</p>
            </div>
          ) : (
            <div className="max-h-80 divide-y divide-black/5 overflow-y-auto">
              {awaiting.map((j) => (
                <Link to="/workshop/jobcards" key={j.id} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-navy"><Bus size={13} className="mr-1 inline text-status-neutral" />{j.fleet_no} <span className="text-status-neutral">· {j.fault}</span></div>
                    <div className="text-xs text-status-neutral">Repaired {fmt(j.completed_at)}{j.completed_by ? ` by ${j.completed_by}` : ''}{j.work_done ? ` — ${j.work_done}` : ''}</div>
                  </div>
                  <StatusBadge tone={JOB_STATUS_META[j.status].tone}>{JOB_STATUS_META[j.status].label}</StatusBadge>
                  <ArrowRight size={15} className="text-status-neutral" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* In the workshop now */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <Wrench size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">In the workshop now</h3>
            {open.length > 0 && <span className="ml-1 rounded-full bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{open.length}</span>}
            <Link to="/workshop/jobcards" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">Job cards <ChevronRight size={13} /></Link>
          </div>
          {open.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral">
              <CheckCircle2 size={24} className="text-status-good" /><p className="text-sm">No buses in the workshop.</p>
            </div>
          ) : (
            <div className="max-h-80 divide-y divide-black/5 overflow-y-auto">
              {open.map((j) => (
                <Link to="/workshop/jobcards" key={j.id} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-navy"><Bus size={13} className="mr-1 inline text-status-neutral" />{j.fleet_no} <span className="text-status-neutral">· {j.fault}</span></div>
                    <div className="text-xs text-status-neutral">Since {fmt(j.reported_at)}{j.mechanics.length ? ` · ${j.mechanics.join(', ')}` : ' · no mechanic assigned'}</div>
                  </div>
                  <StatusBadge tone={SEVERITY_META[j.severity].tone}>{SEVERITY_META[j.severity].label.replace(' — grounds the bus', '')}</StatusBadge>
                  <ArrowRight size={15} className="text-status-neutral" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/workshop/jobcards" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas">
          <ClipboardList size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Job Cards</span><ArrowRight size={15} className="ml-auto text-status-neutral" />
        </Link>
        <Link to="/workshop/mechanics" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas">
          <CalendarClock size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Mechanics Schedule</span><ArrowRight size={15} className="ml-auto text-status-neutral" />
        </Link>
        <Link to="/fleet/vehicles" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas">
          <Bus size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Vehicle Register</span><ArrowRight size={15} className="ml-auto text-status-neutral" />
        </Link>
      </div>

      <p className="inline-flex items-center gap-1.5 text-xs text-status-neutral"><Users size={13} /> Mechanics are pulled from HR → Employees (job role “Mechanic”). Showing {branchLabel}.</p>
    </div>
  )
}
