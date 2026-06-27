import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ArrowRight, CheckCircle2, UserRound } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useHrPeople, type HrPerson } from '@/lib/hr/directory'
import { useDriverLeave, leaveStore } from '@/lib/drivers/leave'
import { useEmployeeLeave, empLeaveStore } from '@/lib/hr/leave'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const todayISO = () => new Date().toISOString().slice(0, 10)
const addDaysISO = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const daysInclusive = (a: string, b: string) => Math.max(1, Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000) + 1)
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short' }) } catch { return iso } }

interface Row { person: HrPerson; start: string; end: string; by?: string; reason?: string; kind: 'driver' | 'emp' }
const phase = (r: Row, t: string) => (r.start <= t && t <= r.end ? 0 : r.start > t ? 1 : 2)

export default function HrLeave() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'hr')

  const people = useHrPeople(branch)
  const driverLeave = useDriverLeave()
  const empLeave = useEmployeeLeave()
  const [addOpen, setAddOpen] = useState(false)

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const today = todayISO()

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const [id, lp] of Object.entries(driverLeave)) {
      const p = byId.get(id); if (p && p.source === 'driver') out.push({ person: p, start: lp.start, end: lp.end, by: lp.by, kind: 'driver' })
    }
    for (const [id, lp] of Object.entries(empLeave)) {
      const p = byId.get(id); if (p) out.push({ person: p, start: lp.start, end: lp.end, by: lp.by, reason: lp.reason, kind: 'emp' })
    }
    return out.sort((a, b) => phase(a, today) - phase(b, today) || a.start.localeCompare(b.start))
  }, [driverLeave, empLeave, byId, today])

  const onLeaveNow = rows.filter((r) => phase(r, today) === 0).length
  const upcoming = rows.filter((r) => phase(r, today) === 1).length

  function endLeave(r: Row) {
    if (!confirm(`End ${r.person.full_name}'s leave?`)) return
    if (r.kind === 'driver') leaveStore.clear(r.person.id); else empLeaveStore.clear(r.person.id)
  }

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Who’s on leave in <span className="font-medium text-navy">{branchLabel}</span>, the dates, and who approved it.
        Driver leave is set from <Link to="/drivers/profiles" className="font-medium text-brand hover:underline">Drivers → Profiles</Link> (rotation-aware); employee leave is set here.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        <div className={`rounded-xl border px-3 py-2 ${onLeaveNow ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}>
          <div className={`text-lg font-bold leading-none ${onLeaveNow ? 'text-[#8a6d10]' : 'text-navy'}`}>{onLeaveNow}</div>
          <div className="mt-0.5 text-[11px] text-status-neutral">On leave now</div>
        </div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{upcoming}</div><div className="mt-0.5 text-[11px] text-status-neutral">Upcoming</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{rows.length}</div><div className="mt-0.5 text-[11px] text-status-neutral">On record</div></div>
      </div>

      {canManage && <Button onClick={() => setAddOpen(true)}><Plus size={15} /> Set employee leave</Button>}

      <div className="card overflow-hidden">
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">From</th><th className="px-4 py-2.5 font-medium">To</th>
                <th className="px-4 py-2.5 font-medium">Days</th><th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Approved by</th><th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ph = phase(r, today)
                return (
                  <tr key={r.person.key} className={i % 2 ? 'bg-canvas/40' : ''}>
                    <td className="px-4 py-2 font-medium text-navy">{r.person.full_name}</td>
                    <td className="px-4 py-2 text-status-neutral">{r.person.role}{r.reason ? <span className="block text-[11px]">{r.reason}</span> : null}</td>
                    <td className="px-4 py-2 text-status-neutral">{fmt(r.start)}</td>
                    <td className="px-4 py-2 text-status-neutral">{fmt(r.end)}</td>
                    <td className="px-4 py-2 text-status-neutral">{daysInclusive(r.start, r.end)}</td>
                    <td className="px-4 py-2"><StatusBadge tone={ph === 0 ? 'warning' : ph === 1 ? 'neutral' : 'good'}>{ph === 0 ? 'On leave' : ph === 1 ? 'Upcoming' : 'Ended'}</StatusBadge></td>
                    <td className="px-4 py-2 text-[11px] text-status-neutral">{r.by || '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        {canManage && ph !== 2 && <button onClick={() => endLeave(r)} className="text-xs font-medium text-status-critical hover:underline">End</button>}
                        {r.kind === 'driver' && <Link to="/drivers/profiles" className="inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline">Profile <ArrowRight size={12} /></Link>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <CheckCircle2 size={22} className="mx-auto mb-2 text-status-good" />
                  Nobody is on leave in {branchLabel}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <SetLeaveModal open={addOpen} onClose={() => setAddOpen(false)} people={people.filter((p) => p.source !== 'driver')} />
    </div>
  )
}

function SetLeaveModal({ open, onClose, people }: { open: boolean; onClose: () => void; people: HrPerson[] }) {
  const [empId, setEmpId] = useState('')
  const [start, setStart] = useState(todayISO())
  const [days, setDays] = useState(7)
  const [reason, setReason] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setEmpId(''); setStart(todayISO()); setDays(7); setReason('') }
  if (!open && wasOpen) setWasOpen(false)

  const n = Math.max(1, Number(days) || 1)
  const ready = !!empId && !!start
  function save() {
    if (!ready) return
    empLeaveStore.set(empId, start, addDaysISO(start, n - 1), reason)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Set employee leave" subtitle="For non-driver staff. Driver leave is set from the driver profile (it respects the rotation)."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>Save leave</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Employee</span>
          <SearchableSelect className={inputCls} value={empId} onChange={setEmpId} placeholder="Search employee…"
            options={people.map((p) => ({ value: p.id, label: p.full_name, sub: `${p.role} · ${p.department}` }))}
            emptyText="No employees — register them in HR → Employees" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Start date</span><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days</span><input type="number" min={1} className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <div className="sm:col-span-2 flex flex-wrap gap-1.5">
          {[3, 5, 7, 14, 30].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${n === d ? 'border-brand bg-brand-tint text-[#8a4513]' : 'border-black/15 text-status-neutral hover:border-brand'}`}>{d} days</button>
          ))}
        </div>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Reason (optional)</span><input className={inputCls} placeholder="e.g. Annual leave / sick" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      {ready && <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-canvas px-3 py-2 text-[11px] text-status-neutral"><UserRound size={12} /> {start} → {addDaysISO(start, n - 1)} ({n} day{n === 1 ? '' : 's'}). Recorded as approved by you.</p>}
    </Modal>
  )
}
