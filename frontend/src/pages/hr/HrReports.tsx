import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { downloadTablePdf } from '@/lib/reports/pdfDoc'
import { useHrPeople, type HrPerson } from '@/lib/hr/directory'
import { useDriverLeave } from '@/lib/drivers/leave'
import { useEmployeeLeave } from '@/lib/hr/leave'

const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return iso } }
const daysInclusive = (a: string, b: string) => Math.max(1, Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000) + 1)

export default function HrReports() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const people = useHrPeople(branch)
  const driverLeave = useDriverLeave()
  const empLeave = useEmployeeLeave()
  const today = new Date().toISOString().slice(0, 10)

  const byDept = useMemo(() => {
    const m = new Map<string, { total: number; active: number }>()
    for (const p of people) { const r = m.get(p.department) ?? { total: 0, active: 0 }; r.total++; if (p.status === 'active') r.active++; m.set(p.department, r) }
    return [...m.entries()].map(([dept, v]) => ({ dept, ...v })).sort((a, b) => b.total - a.total)
  }, [people])

  const leaveRows = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p] as [string, HrPerson]))
    const out: { name: string; role: string; from: string; to: string; days: number; status: string; by: string }[] = []
    const add = (id: string, lp: { start: string; end: string; by?: string }, src: 'driver' | 'emp') => {
      const p = byId.get(id); if (!p || (src === 'driver' && p.source !== 'driver')) return
      const status = lp.start <= today && today <= lp.end ? 'On leave' : lp.start > today ? 'Upcoming' : 'Ended'
      out.push({ name: p.full_name, role: p.role, from: lp.start, to: lp.end, days: daysInclusive(lp.start, lp.end), status, by: lp.by || '—' })
    }
    for (const [id, lp] of Object.entries(driverLeave)) add(id, lp, 'driver')
    for (const [id, lp] of Object.entries(empLeave)) add(id, lp, 'emp')
    return out.sort((a, b) => b.from.localeCompare(a.from))
  }, [people, driverLeave, empLeave, today])

  function exportPdf() {
    downloadTablePdf({
      title: `HR Report — ${branchLabel}`,
      subtitle: `${people.length} people · ${leaveRows.filter((r) => r.status === 'On leave').length} on leave · ${new Date().toLocaleDateString()}`,
      tables: [
        { heading: 'Headcount by department', head: ['Department', 'Total', 'Active'], rows: byDept.map((d) => [d.dept, d.total, d.active]) },
        { heading: 'Leave register', head: ['Name', 'Role', 'From', 'To', 'Days', 'Status', 'Approved by'], rows: leaveRows.map((r) => [r.name, r.role, fmt(r.from), fmt(r.to), r.days, r.status, r.by]) },
      ],
      filename: `HR Report - ${branchLabel}`,
    })
  }

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="max-w-2xl text-sm text-status-neutral">Headcount and leave for <span className="font-medium text-navy">{branchLabel}</span>, rolled up live.</p>
        <Button variant="secondary" className="ml-auto" onClick={exportPdf}><FileText size={15} /> PDF</Button>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Headcount by department</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-status-neutral"><tr>
              <th className="px-5 py-2 font-medium">Department</th><th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-right font-medium">Active</th>
            </tr></thead>
            <tbody>
              {byDept.map((d) => (
                <tr key={d.dept} className="border-t border-black/5">
                  <td className="px-5 py-2 font-medium text-navy">{d.dept}</td>
                  <td className="px-4 py-2 text-right text-navy">{d.total}</td>
                  <td className="px-4 py-2 text-right text-status-neutral">{d.active}</td>
                </tr>
              ))}
              {byDept.length > 0 && (
                <tr className="border-t-2 border-navy/20 bg-canvas font-medium text-navy">
                  <td className="px-5 py-2">Total</td><td className="px-4 py-2 text-right">{people.length}</td>
                  <td className="px-4 py-2 text-right">{people.filter((p) => p.status === 'active').length}</td>
                </tr>
              )}
              {byDept.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-status-neutral">No people on record.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3.5"><h3 className="font-display text-sm font-bold text-navy">Leave register</h3></div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white"><tr>
              <th className="px-5 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">From</th><th className="px-4 py-2.5 font-medium">To</th>
              <th className="px-4 py-2.5 font-medium">Days</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Approved by</th>
            </tr></thead>
            <tbody>
              {leaveRows.map((r, i) => (
                <tr key={`${r.name}-${r.from}-${i}`} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-5 py-2 font-medium text-navy">{r.name}</td>
                  <td className="px-4 py-2 text-status-neutral">{r.role}</td>
                  <td className="px-4 py-2 text-status-neutral">{fmt(r.from)}</td>
                  <td className="px-4 py-2 text-status-neutral">{fmt(r.to)}</td>
                  <td className="px-4 py-2 text-status-neutral">{r.days}</td>
                  <td className="px-4 py-2"><StatusBadge tone={r.status === 'On leave' ? 'warning' : r.status === 'Upcoming' ? 'neutral' : 'good'}>{r.status}</StatusBadge></td>
                  <td className="px-4 py-2 text-[11px] text-status-neutral">{r.by}</td>
                </tr>
              ))}
              {leaveRows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-status-neutral">No leave on record.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
