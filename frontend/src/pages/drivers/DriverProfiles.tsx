import { useMemo, useState } from 'react'
import { Plus, Search, Download, Upload } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { SECTIONS } from '@/lib/org/sections'
import StatusBadge from '@/components/ui/StatusBadge'
import Button from '@/components/ui/Button'
import DriverAvatar from '@/components/drivers/DriverAvatar'
import DriverDetail from '@/components/drivers/DriverDetail'
import DriverFormModal from '@/components/drivers/DriverFormModal'
import DriverImportModal from '@/components/drivers/DriverImportModal'
import { useDrivers } from '@/lib/drivers/store'
import { exportDrivers } from '@/lib/drivers/excel'
import {
  type Driver, type Crew, SHIFT_STATE_META,
  driverShiftState, worstExpiry, EXPIRY_TONE,
} from '@/lib/drivers/types'
import { useScheduling, crewLabel, shiftForCrew } from '@/lib/drivers/scheduling'
import { scheduledShift, dutyLabel } from '@/lib/drivers/schedule'

export default function DriverProfiles() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const editable = canEdit(role, 'drivers')
  const canToggle = ROLES[role].canToggleBranch

  const all = useDrivers()
  const sched = useScheduling()
  const [q, setQ] = useState('')
  const [section, setSection] = useState('all')
  const [crew, setCrew] = useState<'all' | Crew>('all')
  const [detail, setDetail] = useState<Driver | null>(null)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const drivers = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all
      .filter((d) => d.branch === branch)
      .filter((d) => section === 'all' || d.section === section)
      .filter((d) => crew === 'all' || d.crew === crew)
      .filter((d) => !term || [d.full_name, d.employee_no, d.licence_no].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [all, branch, q, section, crew])

  function openAdd() { setEditing(null); setFormOpen(true) }
  function openEdit(d: Driver) { setDetail(null); setEditing(d); setFormOpen(true) }

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          The per-driver record — licence, PSV, crew and section, with links to speed, compliance and training. Medical &amp; site classes are managed in Safety → Driver Compliance.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => exportDrivers(all.filter((d) => d.branch === branch), branchLabel)}><Download size={15} /> Export</Button>
          {editable && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} /> Bulk upload</Button>}
          {editable && <Button onClick={openAdd}><Plus size={15} /> Add driver</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, employee no, licence…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={section} onChange={(e) => setSection(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All sections</option>
          {SECTIONS[branch].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={crew} onChange={(e) => setCrew(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All crews</option>
          {sched.crews.map((c) => {
            const s = shiftForCrew(sched, c.id)
            return <option key={c.id} value={c.id}>Crew {c.label}{s ? ` (${s.label})` : ''}</option>
          })}
        </select>
      </div>

      <div className="text-xs text-status-neutral"><b className="text-navy">{drivers.length}</b> driver(s)</div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {drivers.map((d) => {
          const state = driverShiftState(d)
          const worst = worstExpiry(d)
          return (
            <button key={d.id} onClick={() => setDetail(d)} className="card group p-4 text-left transition-shadow hover:shadow-cardhover">
              <div className="flex items-center gap-3">
                <DriverAvatar name={d.full_name} photoFileId={d.photo_file_id} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-navy">{d.full_name}</div>
                  <div className="text-xs text-status-neutral">{d.employee_no}</div>
                </div>
                <StatusBadge tone={SHIFT_STATE_META[state].tone}>{SHIFT_STATE_META[state].label}</StatusBadge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full bg-navy/5 px-2 py-0.5 text-navy">Crew {crewLabel(sched, d.crew)} · {dutyLabel(d, scheduledShift(d))}</span>
                <span className="rounded-full bg-navy/5 px-2 py-0.5 text-navy">{d.section}</span>
                {worst !== 'current' && worst !== 'none' && (
                  <span className={`rounded-full px-2 py-0.5 font-medium ${worst === 'expired' ? 'bg-status-critical/10 text-status-critical' : 'bg-status-warning/10 text-[#8a6d10]'}`}>
                    {worst === 'expired' ? 'Compliance expired' : 'Expiring soon'}
                  </span>
                )}
              </div>
            </button>
          )
        })}
        {drivers.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-black/15 px-6 py-12 text-center text-sm text-status-neutral">
            No drivers match. {editable && 'Add one to get started.'}
          </div>
        )}
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — your role is locked to this branch.</p>}

      <DriverDetail driver={detail} open={!!detail} onClose={() => setDetail(null)} canEdit={editable} onEdit={openEdit} />
      <DriverFormModal open={formOpen} onClose={() => setFormOpen(false)} editing={editing} lockedBranch={canToggle ? null : branch} activeBranch={branch} />
      <DriverImportModal open={importOpen} onClose={() => setImportOpen(false)} defaultBranch={branch} />
    </div>
  )
}
