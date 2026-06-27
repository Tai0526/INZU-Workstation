import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Plus, Bus, Check, X, Wrench, Trash2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import SearchableSelect, { SearchableMultiSelect } from '@/components/ui/SearchableSelect'
import { useVehicles } from '@/lib/fleet/store'
import { useDrivers } from '@/lib/drivers/store'
import { useEmployees } from '@/lib/hr/store'
import { useChecklists, useJobCards, checklistsStore, raiseJobFromChecklist } from '@/lib/workshop/store'
import {
  type Checklist, type ChecklistInput, type ChecklistItem, type JobSeverity,
  CHECK_POINTS, checklistFaults, hasTyreFault, JOB_STATUS_META, SEVERITY_META,
} from '@/lib/workshop/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { weekday: 'short', day: '2-digit', month: 'short' }) } catch { return iso } }

export default function DailyChecklists() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canLog = canEdit(role, 'workshop') || canEdit(role, 'operations')
  const canRaise = canEdit(role, 'workshop')

  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const drivers = useDrivers().filter((d) => d.branch === branch && d.status === 'active')
  const mechanics = useEmployees().filter((e) => e.branch === branch && e.status === 'active' && e.job_role === 'Mechanic')
  const checklists = useChecklists().filter((c) => c.branch === branch)
  const jobs = useJobCards()

  const [newOpen, setNewOpen] = useState(false)
  const [raiseFor, setRaiseFor] = useState<Checklist | null>(null)

  const rows = useMemo(() => [...checklists].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)), [checklists])
  const today = new Date().toISOString().slice(0, 10)
  const counts = {
    today: checklists.filter((c) => c.date === today).length,
    faults: checklists.filter((c) => checklistFaults(c).length > 0).length,
    unactioned: checklists.filter((c) => checklistFaults(c).length > 0 && c.job_ids.length === 0).length,
  }
  const jobStatus = (id: string) => jobs.find((j) => j.id === id)?.status

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Each driver's pre-trip inspection for <span className="font-medium text-navy">{branchLabel}</span>. Any failed item is a fault — raise a
        <span className="font-medium text-navy"> job card</span> from it so it's worked on (tyre faults flow to Tyre Management).
      </p>

      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{counts.today}</div><div className="mt-0.5 text-[11px] text-status-neutral">Done today</div></div>
        <div className={`rounded-xl border px-3 py-2 ${counts.faults ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.faults ? 'text-[#8a6d10]' : 'text-navy'}`}>{counts.faults}</div><div className="mt-0.5 text-[11px] text-status-neutral">With faults</div></div>
        <div className={`rounded-xl border px-3 py-2 ${counts.unactioned ? 'border-status-critical/40 bg-status-critical/5' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${counts.unactioned ? 'text-status-critical' : 'text-navy'}`}>{counts.unactioned}</div><div className="mt-0.5 text-[11px] text-status-neutral">Not yet actioned</div></div>
      </div>

      {canLog && <Button onClick={() => setNewOpen(true)}><Plus size={15} /> New checklist</Button>}

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center text-sm text-status-neutral">
          <ClipboardList size={26} className="text-status-neutral/60" />
          No checklists yet. {canLog && 'Record a driver’s pre-trip inspection.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const faults = checklistFaults(c)
            return (
              <div key={c.id} className={clsx('rounded-xl border p-3', faults.length ? 'border-status-warning/40 bg-status-warning/[0.04]' : 'border-status-good/30 bg-status-good/[0.04]')}>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 font-semibold text-navy"><Bus size={14} className="text-status-neutral" /> {c.fleet_no}</span>
                  <span className="text-xs text-status-neutral">{fmt(c.date)}</span>
                  <span className="ml-auto">{faults.length ? <StatusBadge tone="warning">{faults.length} fault{faults.length === 1 ? '' : 's'}</StatusBadge> : <StatusBadge tone="good">All OK</StatusBadge>}</span>
                </div>
                <div className="mt-1 text-xs text-status-neutral">{c.driver_name || 'No driver'}</div>

                {faults.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t border-black/5 pt-2 text-xs">
                    {faults.map((it) => (
                      <li key={it.key} className="flex gap-1.5 text-navy"><X size={12} className="mt-0.5 shrink-0 text-status-critical" /><span>{it.label}{it.note ? <span className="text-status-neutral"> — {it.note}</span> : ''}{it.tyre ? <span className="ml-1 rounded bg-brand-tint px-1 text-[10px] text-[#8a4513]">tyre</span> : ''}</span></li>
                    ))}
                  </ul>
                )}

                <div className="mt-2 flex items-center gap-2 border-t border-black/5 pt-2">
                  {c.job_ids.length > 0 ? (
                    <Link to="/workshop/jobcards" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                      <Wrench size={12} /> Job card {c.job_ids.map((id) => jobStatus(id)).filter(Boolean).map((s) => JOB_STATUS_META[s as keyof typeof JOB_STATUS_META].label).join(', ') || 'raised'} <ArrowRight size={11} />
                    </Link>
                  ) : faults.length > 0 ? (
                    canRaise ? <button onClick={() => setRaiseFor(c)} className="inline-flex items-center gap-1 rounded-lg bg-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-secondary"><Wrench size={12} /> Raise job card</button>
                      : <span className="text-[11px] text-status-neutral">awaiting workshop</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-status-good"><CheckCircle2 size={13} /> No action needed</span>
                  )}
                  {canLog && <button onClick={() => confirm('Remove this checklist?') && checklistsStore.remove(c.id)} className="ml-auto rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <NewChecklistModal open={newOpen} onClose={() => setNewOpen(false)} branch={branch} vehicles={vehicles} drivers={drivers} />
      <RaiseFromChecklistModal checklist={raiseFor} onClose={() => setRaiseFor(null)} mechanics={mechanics} />
    </div>
  )
}

function NewChecklistModal({ open, onClose, branch, vehicles, drivers }: { open: boolean; onClose: () => void; branch: BranchCode; vehicles: any[]; drivers: any[] }) {
  const freshItems = (): ChecklistItem[] => CHECK_POINTS.map((p) => ({ key: p.key, label: p.label, ok: true, note: '', tyre: p.tyre }))
  const blank = (): ChecklistInput => ({ branch, date: new Date().toISOString().slice(0, 10), fleet_no: '', reg_no: '', driver_name: '', items: freshItems(), job_ids: [], notes: '' })
  const [f, setF] = useState<ChecklistInput>(blank)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setF(blank()) }
  if (!open && wasOpen) setWasOpen(false)

  function onVehicle(fleet: string) { const v = vehicles.find((x) => x.fleet_no === fleet); setF((p) => ({ ...p, fleet_no: fleet, reg_no: v ? v.reg_plate : '' })) }
  function setItem(key: string, patch: Partial<ChecklistItem>) { setF((p) => ({ ...p, items: p.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) })) }
  const faults = f.items.filter((i) => !i.ok).length
  const ready = !!f.fleet_no.trim()
  function save() { if (!ready) return; checklistsStore.add(f); onClose() }

  return (
    <Modal open={open} onClose={onClose} size="lg" title="New daily checklist" subtitle="Driver pre-trip inspection — mark any failed item and add a note."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>Save checklist{faults ? ` · ${faults} fault${faults === 1 ? '' : 's'}` : ''}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Bus</span>
          <SearchableSelect className={inputCls} value={f.fleet_no} onChange={onVehicle} placeholder="Search bus…" options={vehicles.map((v) => ({ value: v.fleet_no, label: v.fleet_no, sub: v.reg_plate }))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Driver</span>
          <SearchableSelect className={inputCls} value={f.driver_name} onChange={(v) => setF((p) => ({ ...p, driver_name: v }))} placeholder="Search driver…" options={drivers.map((d) => ({ value: d.full_name, label: d.full_name, sub: d.section }))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} /></label>
      </div>

      <div className="mt-3 divide-y divide-black/5 rounded-lg border border-black/10">
        {f.items.map((it) => (
          <div key={it.key} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm text-navy">{it.label}{it.tyre && <span className="ml-1 rounded bg-brand-tint px-1 text-[10px] text-[#8a4513]">tyre</span>}</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-black/15">
                <button type="button" onClick={() => setItem(it.key, { ok: true })} className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium', it.ok ? 'bg-status-good text-white' : 'bg-white text-status-neutral')}><Check size={12} /> OK</button>
                <button type="button" onClick={() => setItem(it.key, { ok: false })} className={clsx('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium', !it.ok ? 'bg-status-critical text-white' : 'bg-white text-status-neutral')}><X size={12} /> Fault</button>
              </div>
            </div>
            {!it.ok && <input className={`${inputCls} mt-1.5`} placeholder="What's wrong?" value={it.note} onChange={(e) => setItem(it.key, { note: e.target.value })} />}
          </div>
        ))}
      </div>
      {faults > 0 && <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[#8a6d10]"><AlertTriangle size={12} /> {faults} fault{faults === 1 ? '' : 's'} — you can raise a job card from this checklist after saving.</p>}
    </Modal>
  )
}

function RaiseFromChecklistModal({ checklist, onClose, mechanics }: { checklist: Checklist | null; onClose: () => void; mechanics: any[] }) {
  const [severity, setSeverity] = useState<JobSeverity>('major')
  const [mechs, setMechs] = useState<string[]>([])
  const [key, setKey] = useState('')
  if (checklist && key !== checklist.id) { setKey(checklist.id); setSeverity(hasTyreFault(checklist) ? 'major' : 'major'); setMechs([]) }
  if (!checklist) return null
  const faults = checklistFaults(checklist)
  function save() { raiseJobFromChecklist(checklist!, { severity, mechanics: mechs }); onClose() }
  return (
    <Modal open={!!checklist} onClose={onClose} title={`Raise job card — ${checklist.fleet_no}`} subtitle="Turns the checklist faults into a job card and pulls the bus into the workshop."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}><Wrench size={15} /> Raise &amp; pull from service</Button></>}>
      <div className="rounded-lg bg-canvas px-3 py-2 text-xs text-navy">{faults.map((it) => it.label).join(', ')}{hasTyreFault(checklist) && <span className="ml-1 rounded bg-brand-tint px-1 text-[10px] text-[#8a4513]">tyre → Tyre Management</span>}</div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Severity</span>
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value as JobSeverity)}>{(['minor', 'major', 'critical'] as JobSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Assign mechanic(s)</span>
          <SearchableMultiSelect className={inputCls} placeholder="Search mechanic(s)…" values={mechs} onChange={setMechs} options={mechanics.map((m) => ({ value: m.full_name, label: m.full_name }))} emptyText="No mechanics in HR" /></label>
      </div>
    </Modal>
  )
}
