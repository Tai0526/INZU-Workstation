import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Users, ArrowRight, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { SECTIONS } from '@/lib/org/sections'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import DriverDetail from '@/components/drivers/DriverDetail'
import DriverFormModal from '@/components/drivers/DriverFormModal'
import { useDrivers } from '@/lib/drivers/store'
import {
  type Driver, driverShiftState, complianceItems, worstExpiry, EXPIRY_TONE,
} from '@/lib/drivers/types'
import { useScheduling, crewShiftLabel } from '@/lib/drivers/scheduling'

const SHIFT_COLORS: Record<string, string> = {
  on_shift: '#2E7D4F', overtime: '#C9A227', off: '#6B7280', leave: '#1B2A4A', suspended: '#B3261E',
}

export default function DriversOverview() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const editable = canEdit(role, 'drivers')
  const canToggle = ROLES[role].canToggleBranch

  const all = useDrivers()
  const sched = useScheduling()
  const drivers = useMemo(() => all.filter((d) => d.branch === branch), [all, branch])

  const [detail, setDetail] = useState<Driver | null>(null)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const stats = useMemo(() => {
    const by = { on_shift: 0, overtime: 0, off: 0, leave: 0, suspended: 0 }
    for (const d of drivers) by[driverShiftState(d)]++
    const active = drivers.filter((d) => d.status === 'active').length
    const crewCounts = sched.crews.map((c) => ({ id: c.id, label: c.label, n: drivers.filter((d) => d.crew === c.id).length }))
    return { ...by, active, crewCounts, total: drivers.length }
  }, [drivers, sched])

  const attention = useMemo(() => {
    return drivers
      .map((d) => ({ d, items: complianceItems(d).filter((c) => c.status === 'expired' || c.status === 'expiring'), worst: worstExpiry(d) }))
      .filter((x) => x.items.length > 0)
      .sort((a, b) => (a.worst === 'expired' ? 0 : 1) - (b.worst === 'expired' ? 0 : 1))
  }, [drivers])

  const expired = attention.filter((a) => a.worst === 'expired').length
  const expiring = attention.length - expired

  const shiftPie = (['on_shift', 'overtime', 'off', 'leave', 'suspended'] as const)
    .map((k) => ({ name: k.replace('_', ' '), value: stats[k], fill: SHIFT_COLORS[k] }))
    .filter((s) => s.value > 0)

  const sectionData = SECTIONS[branch].map((s) => ({ name: s, drivers: drivers.filter((d) => d.section === s).length }))

  function openDetail(d: Driver) { setDetail(d) }
  function openEdit(d: Driver) { setDetail(null); setEditing(d); setFormOpen(true) }

  return (
    <div className="page space-y-6">
      <p className="text-sm text-status-neutral">
        Who’s driving today and whose paperwork needs attention — live for <span className="font-medium text-navy">{branchLabel}</span>.
      </p>

      {/* Priority KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="On shift now" value={stats.on_shift} tone="good" sub="live, across crews" />
        <KpiCard label="On overtime" value={stats.overtime} tone={stats.overtime ? 'warning' : 'good'} sub="outside shift window" />
        <KpiCard label="On leave" value={stats.leave} tone="neutral" />
        <KpiCard label="Compliance issues" value={attention.length} tone={expired ? 'critical' : expiring ? 'warning' : 'good'} sub={`${expired} expired, ${expiring} expiring`} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total drivers" value={stats.total} />
        <KpiCard label="Active" value={stats.active} tone="good" />
        {stats.crewCounts.map((c) => (
          <KpiCard key={c.id} label={`Crew ${c.label}`} value={c.n} sub={crewShiftLabel(sched, c.id) || undefined} />
        ))}
      </div>

      {/* Visuals */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-status-neutral">Driver status now</div>
          <div className="relative h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={shiftPie} dataKey="value" innerRadius={48} outerRadius={68} paddingAngle={2} stroke="none">
                  {shiftPie.map((s, i) => <Cell key={i} fill={s.fill} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${v} drivers`, n]} contentStyle={{ borderRadius: 10, border: '1px solid #eee', fontSize: 12, textTransform: 'capitalize' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none text-navy">{stats.on_shift}</span>
              <span className="text-[10px] text-status-neutral">on shift</span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] capitalize">
            {shiftPie.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 text-status-neutral">
                <span className="h-2 w-2 rounded-full" style={{ background: s.fill }} />{s.name} <b className="text-navy">{s.value}</b>
              </span>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-status-neutral">Drivers by section</div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectionData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: '#0F1B33' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(209,107,33,0.06)' }} formatter={(v: number) => [`${v} drivers`, 'Assigned']} contentStyle={{ borderRadius: 10, border: '1px solid #eee', fontSize: 12 }} />
                <Bar dataKey="drivers" fill="#D16B21" radius={[0, 5, 5, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Compliance attention */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <ShieldAlert size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">Compliance — needs attention</h3>
          {attention.length > 0 && <span className="ml-2 rounded-full bg-status-critical/10 px-2 py-0.5 text-xs font-medium text-status-critical">{attention.length}</span>}
        </div>
        {attention.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral">
            <Users size={24} className="text-status-good" />
            <p className="text-sm">Every driver’s licence and PSV are current.</p>
          </div>
        ) : (
          <div className="divide-y divide-black/5">
            {attention.map(({ d, items }) => (
              <button key={d.id} onClick={() => openDetail(d)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-canvas">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-navy">{d.full_name} <span className="text-status-neutral">· {d.employee_no}</span></div>
                  <div className="text-xs text-status-neutral">{items.map((c) => c.label).join(', ')} · {d.section}</div>
                </div>
                {items.slice(0, 1).map((c) => <StatusBadge key={c.label} tone={EXPIRY_TONE[c.status]}>{c.status}</StatusBadge>)}
                <ArrowRight size={15} className="text-status-neutral" />
              </button>
            ))}
          </div>
        )}
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — your role is locked to this branch.</p>}

      <DriverDetail driver={detail} open={!!detail} onClose={() => setDetail(null)} canEdit={editable} onEdit={openEdit} />
      <DriverFormModal open={formOpen} onClose={() => setFormOpen(false)} editing={editing} lockedBranch={canToggle ? null : branch} activeBranch={branch} />
    </div>
  )
}
