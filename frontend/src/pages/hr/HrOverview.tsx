import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Users, UserCog, CalendarOff, ArrowRight, ChevronRight, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import { useHrPeople } from '@/lib/hr/directory'
import { useDriverLeave, isOnLeave } from '@/lib/drivers/leave'
import { useEmployeeLeave, empOnLeave } from '@/lib/hr/leave'

export default function HrOverview() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const people = useHrPeople(branch)
  useDriverLeave(); useEmployeeLeave()
  const today = new Date().toISOString().slice(0, 10)
  const onLeave = (id: string, source: string) => (source === 'driver' ? isOnLeave(id, today) : empOnLeave(id, today))

  const onLeaveList = useMemo(() => people.filter((p) => onLeave(p.id, p.source)), [people, today])
  const byDept = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of people) m.set(p.department, (m.get(p.department) ?? 0) + 1)
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
  }, [people])

  const drivers = people.filter((p) => p.source === 'driver').length
  const active = people.filter((p) => p.status === 'active').length

  return (
    <div className="page space-y-6">
      <p className="text-sm text-status-neutral">
        Headcount and leave for <span className="font-medium text-navy">{branchLabel}</span> — drivers, employees and system accounts, live.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Headcount" value={people.length} highlight sub="everyone on the books" />
        <KpiCard label="Active" value={active} tone="good" />
        <KpiCard label="On leave now" value={onLeaveList.length} tone={onLeaveList.length ? 'warning' : 'good'} />
        <KpiCard label="Drivers" value={drivers} sub="from the roster" />
        <KpiCard label="Departments" value={byDept.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-navy">Headcount by department</h3>
            <span className="text-xs text-status-neutral">{people.length} total</span>
          </div>
          {byDept.length === 0 ? (
            <p className="py-8 text-center text-sm text-status-neutral">No people on record yet.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDept} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: '#0F1B33' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(209,107,33,0.06)' }} formatter={(v: number) => [`${v} people`, 'Headcount']} contentStyle={{ borderRadius: 10, border: '1px solid #eee', fontSize: 12 }} />
                  <Bar dataKey="n" radius={[0, 5, 5, 0]} maxBarSize={22}>
                    {byDept.map((_, i) => <Cell key={i} fill="#D16B21" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <CalendarOff size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">On leave now</h3>
            {onLeaveList.length > 0 && <span className="ml-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-xs font-medium text-[#8a6d10]">{onLeaveList.length}</span>}
            <Link to="/hr/leave" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">Leave <ChevronRight size={13} /></Link>
          </div>
          {onLeaveList.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral">
              <CheckCircle2 size={24} className="text-status-good" /><p className="text-sm">Everyone is in.</p>
            </div>
          ) : (
            <div className="max-h-72 divide-y divide-black/5 overflow-y-auto">
              {onLeaveList.map((p) => (
                <Link to="/hr/leave" key={p.key} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-navy">{p.full_name}</div>
                    <div className="text-xs text-status-neutral">{p.role} · {p.department}</div>
                  </div>
                  <StatusBadge tone="warning">On leave</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/hr/employees" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas">
          <Users size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Employees</span><ArrowRight size={15} className="ml-auto text-status-neutral" />
        </Link>
        <Link to="/hr/leave" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas">
          <CalendarOff size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Leave</span><ArrowRight size={15} className="ml-auto text-status-neutral" />
        </Link>
        <Link to="/hr/reports" className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 hover:bg-canvas">
          <UserCog size={16} className="text-brand" /><span className="text-sm font-medium text-navy">Reports</span><ArrowRight size={15} className="ml-auto text-status-neutral" />
        </Link>
      </div>
    </div>
  )
}
