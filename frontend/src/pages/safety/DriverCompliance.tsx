import { useMemo, useRef, useState } from 'react'
import {
  Search, CheckCircle2, Circle, Lock, AlertTriangle, Clock, X, UploadCloud, FileText, ExternalLink, Settings2, Trash2, Plus,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import { useDrivers } from '@/lib/drivers/store'
import {
  useCompliance, complianceStore, useComplianceClasses, classesStore, classMap,
  cellState, prereqsMet, isCompliantCell, type Credential, type CellState, type ComplianceClass, type SafetyFile,
} from '@/lib/safety/registers'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const today = () => new Date().toISOString().slice(0, 10)
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '—'

function CellIcon({ state }: { state: CellState }) {
  switch (state) {
    case 'current': return <CheckCircle2 size={20} className="text-status-good" />
    case 'expiring': return <Clock size={20} className="text-[#C9A227]" />
    case 'expired': return <AlertTriangle size={20} className="text-status-critical" />
    case 'locked': return <Lock size={15} className="text-status-neutral/50" />
    default: return <Circle size={14} className="fill-black/10 text-black/10" />
  }
}

export default function DriverCompliance() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const editable = canEdit(role, 'safety')

  const allDrivers = useDrivers()
  const allCreds = useCompliance()
  const classes = useComplianceClasses()
  const byKey = useMemo(() => classMap(classes), [classes])
  const prereqKeys = useMemo(() => classes.filter((c) => c.prerequisite).map((c) => c.key), [classes])
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [editCell, setEditCell] = useState<{ driverId: string; driverName: string; classKey: string } | null>(null)
  const [manageOpen, setManageOpen] = useState(false)

  // Cell editor form
  const [dateDone, setDateDone] = useState('')
  const [expiry, setExpiry] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [certFile, setCertFile] = useState<SafetyFile | null>(null)
  const [editErr, setEditErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const creds = useMemo(() => allCreds.filter((c) => c.branch === branch), [allCreds, branch])
  const credsByDriver = useMemo(() => {
    const m = new Map<string, Credential[]>()
    for (const c of creds) { const a = m.get(c.driver_id) ?? []; a.push(c); m.set(c.driver_id, a) }
    return m
  }, [creds])
  const credFor = (driverId: string, classKey: string) => credsByDriver.get(driverId)?.find((c) => c.category === classKey)

  const drivers = useMemo(() => {
    const term = q.trim().toLowerCase()
    return allDrivers
      .filter((d) => d.branch === branch)
      .filter((d) => !activeOnly || d.status === 'active')
      .filter((d) => !term || d.full_name.toLowerCase().includes(term) || d.employee_no.toLowerCase().includes(term))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [allDrivers, branch, q, activeOnly])

  const stateFor = (driverId: string, cls: ComplianceClass): CellState =>
    cellState(credFor(driverId, cls.key), cls.prerequisite, prereqsMet(credsByDriver.get(driverId) ?? [], prereqKeys))
  const scoreFor = (driverId: string) => {
    const done = classes.filter((cls) => isCompliantCell(stateFor(driverId, cls))).length
    return { done, total: classes.length }
  }

  function openCell(driverId: string, driverName: string, cls: ComplianceClass) {
    if (!editable) { setPanelId(driverId); return }
    if (stateFor(driverId, cls) === 'locked') {
      window.alert(`${driverName} must have a current Medical and Silicosis before "${cls.label}" can be recorded.`)
      return
    }
    const ex = credFor(driverId, cls.key)
    setDateDone(ex?.issued || today())
    setExpiry(ex?.expiry || '')
    setLocation(ex?.location || '')
    setNotes(ex?.notes || '')
    setCertFile(ex?.cert_file || null)
    setEditErr('')
    setEditCell({ driverId, driverName, classKey: cls.key })
  }

  async function uploadProof(file: File) {
    const id = `cmp_${editCell!.driverId}_${editCell!.classKey}_${Date.now()}`.replace(/\s/g, '')
    await putFile(id, file)
    setCertFile({ file_id: id, file_name: file.name })
  }

  function saveCell() {
    if (!editCell) return
    const cls = byKey[editCell.classKey]
    if (!dateDone) return setEditErr('Enter the date it was done.')
    // Proof is required for medical/silicosis but the certificate often arrives
    // later — so we allow saving and flag it as "proof pending" until uploaded.
    const ex = credFor(editCell.driverId, editCell.classKey)
    const driver = allDrivers.find((d) => d.id === editCell.driverId)
    const payload = { issued: dateDone, expiry: cls.has_expiry ? expiry : '', location, notes, cert_file: certFile }
    if (ex) complianceStore.update(ex.id, payload)
    else complianceStore.add({ branch, driver_id: editCell.driverId, driver_name: driver?.full_name ?? editCell.driverName, category: editCell.classKey, ...payload })
    setEditCell(null)
  }
  function clearCell() {
    if (!editCell) return
    const ex = credFor(editCell.driverId, editCell.classKey)
    if (ex && window.confirm('Mark this class as not done? The record will be removed.')) {
      complianceStore.remove(ex.id)
      setEditCell(null)
    }
  }

  const panelDriver = panelId ? allDrivers.find((d) => d.id === panelId) : null

  return (
    <div className="page space-y-5">
      <p className="text-sm text-status-neutral">
        FQM mine-access classes each driver must hold to be compliant. {editable && 'Click a cell to tick / update · click a driver to view full history.'}
      </p>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-status-neutral">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={15} className="text-status-good" /> Done / current</span>
        <span className="inline-flex items-center gap-1.5"><Clock size={15} className="text-[#C9A227]" /> Expiring within 30 days</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle size={15} className="text-status-critical" /> Expired</span>
        <span className="inline-flex items-center gap-1.5"><Circle size={12} className="fill-black/10 text-black/10" /> Not done</span>
        <span className="inline-flex items-center gap-1.5"><Lock size={13} className="text-status-neutral/50" /> Locked — medicals + silicosis required first</span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver name or employee no…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={activeOnly ? 'active' : 'all'} onChange={(e) => setActiveOnly(e.target.value === 'active')} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="active">Active only</option>
          <option value="all">All drivers</option>
        </select>
        <span className="text-sm text-status-neutral">{drivers.length} driver{drivers.length === 1 ? '' : 's'}</span>
        {editable && <Button variant="secondary" className="ml-auto" onClick={() => setManageOpen(true)}><Settings2 size={15} /> Manage classes</Button>}
      </div>

      {/* Matrix */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-canvas/60 text-[11px] uppercase tracking-wide text-status-neutral">
                <th className="sticky left-0 z-10 bg-canvas/60 px-4 py-3 font-medium">Driver</th>
                <th className="px-3 py-3 text-center font-medium">Score</th>
                {classes.map((cls) => (
                  <th key={cls.key} className="px-3 py-2 text-center font-medium">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        {cls.prerequisite && <span className="h-1.5 w-1.5 rounded-full bg-brand" title="Prerequisite" />}
                        {cls.short}
                      </span>
                      {cls.has_expiry && <span className="text-[9px] lowercase text-status-neutral/70">exp</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => {
                const score = scoreFor(d.id)
                const pct = Math.round((score.done / score.total) * 100)
                const scoreTone = pct === 100 ? 'bg-status-good/10 text-status-good' : pct >= 60 ? 'bg-status-warning/10 text-[#8a6d10]' : 'bg-status-critical/10 text-status-critical'
                return (
                  <tr key={d.id} className="border-b border-black/5 hover:bg-canvas/40">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                      <button onClick={() => setPanelId(d.id)} className="flex items-center gap-2.5 text-left">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-xs font-bold text-brand">{initials(d.full_name)}</span>
                        <span>
                          <span className="block font-medium text-navy hover:text-brand">{d.full_name}</span>
                          <span className="block text-xs text-status-neutral">{d.employee_no}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${scoreTone}`}>{score.done}/{score.total}</span>
                    </td>
                    {classes.map((cls) => {
                      const st = stateFor(d.id, cls)
                      return (
                        <td key={cls.key} className="px-3 py-2.5 text-center">
                          <button
                            onClick={() => openCell(d.id, d.full_name, cls)}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${editable && st !== 'locked' ? 'hover:bg-canvas' : ''}`}
                            title={`${cls.label} — ${st.replace('_', ' ')}`}
                          >
                            <CellIcon state={st} />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {drivers.length === 0 && (
                <tr><td colSpan={classes.length + 2} className="px-4 py-12 text-center text-sm text-status-neutral">No drivers match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      {/* Driver detail drawer */}
      {panelDriver && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setPanelId(null)} />
          <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[440px] flex-col border-l border-black/10 bg-canvas shadow-xl">
            <div className="flex items-center gap-3 border-b border-black/10 bg-white px-5 py-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-sm font-bold text-white">{initials(panelDriver.full_name)}</span>
              <div className="flex-1">
                <div className="font-display text-lg font-bold text-navy">{panelDriver.full_name}</div>
                <div className="text-xs text-status-neutral">{panelDriver.employee_no}</div>
              </div>
              <button onClick={() => setPanelId(null)} className="rounded-lg p-1.5 text-status-neutral hover:bg-canvas"><X size={18} /></button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {(() => {
                const score = scoreFor(panelDriver.id)
                const pct = Math.round((score.done / score.total) * 100)
                const met = prereqsMet(credsByDriver.get(panelDriver.id) ?? [], prereqKeys)
                return (
                  <>
                    <div className="flex items-center gap-4 rounded-2xl bg-brand-tint/60 px-5 py-4">
                      <span className="font-display text-4xl font-extrabold text-brand">{pct}%</span>
                      <div>
                        <div className="text-sm font-bold text-navy">Compliance score</div>
                        <div className="text-xs text-status-neutral">{score.done} of {score.total} items completed</div>
                      </div>
                    </div>

                    <Section title="Prerequisites">
                      {prereqKeys.map((k) => (
                        <PanelCard key={k} cls={byKey[k]} cred={credFor(panelDriver.id, k)} editable={editable} onEdit={() => openCell(panelDriver.id, panelDriver.full_name, byKey[k])} onView={viewFile} />
                      ))}
                    </Section>

                    <Section title="Trainings — requires medicals + silicosis" note={!met ? 'Locked until both prerequisites are current.' : undefined}>
                      {classes.filter((c) => !c.prerequisite).map((cls) => (
                        <PanelCard key={cls.key} cls={cls} cred={credFor(panelDriver.id, cls.key)} locked={!met} editable={editable} onEdit={() => openCell(panelDriver.id, panelDriver.full_name, cls)} onView={viewFile} />
                      ))}
                    </Section>
                  </>
                )
              })()}
            </div>
          </aside>
        </>
      )}

      {/* Cell editor */}
      {editCell && (
        <Modal
          open
          onClose={() => setEditCell(null)}
          title={`${editCell.driverName} — ${byKey[editCell.classKey].label}`}
          subtitle={byKey[editCell.classKey].prerequisite ? 'Prerequisite class' : 'FQM training class'}
          footer={
            <div className="flex w-full items-center justify-between">
              {credFor(editCell.driverId, editCell.classKey) ? <Button variant="danger" onClick={clearCell}>Mark not done</Button> : <span />}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditCell(null)}>Cancel</Button>
                <Button onClick={saveCell}>Save</Button>
              </div>
            </div>
          }
        >
          {editErr && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{editErr}</div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Date done *</span>
              <input type="date" className={inputCls} value={dateDone} onChange={(e) => setDateDone(e.target.value)} />
            </label>
            {byKey[editCell.classKey].has_expiry && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Expires</span>
                <input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </label>
            )}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-navy">Where it was done</span>
              <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. FQM Trident, Mary Begg Kalumbila…" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-navy">Notes</span>
              <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-navy">
                Proof attachment {byKey[editCell.classKey].requires_attachment && <span className="text-status-critical">*</span>}
              </span>
              {certFile ? (
                <div className="flex items-center gap-3">
                  <button onClick={() => viewFile(certFile.file_id, certFile.file_name)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> {certFile.file_name} <ExternalLink size={11} /></button>
                  <button onClick={() => setCertFile(null)} className="text-xs text-status-neutral hover:text-status-critical">Remove</button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs text-status-neutral hover:border-brand hover:text-brand"><UploadCloud size={14} /> Upload proof</button>
              )}
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
              {byKey[editCell.classKey].requires_attachment && !certFile && <p className="mt-1 text-[11px] text-[#8a6d10]">Required as proof — you can add the certificate when it arrives.</p>}
            </div>
          </div>
        </Modal>
      )}

      {manageOpen && <ManageClassesModal classes={classes} onClose={() => setManageOpen(false)} />}
    </div>
  )
}

function ManageClassesModal({ classes, onClose }: { classes: ComplianceClass[]; onClose: () => void }) {
  const [label, setLabel] = useState('')
  const [short, setShort] = useState('')
  const [prerequisite, setPrerequisite] = useState(false)
  const [hasExpiry, setHasExpiry] = useState(true)
  const [requiresAttachment, setRequiresAttachment] = useState(false)
  const [err, setErr] = useState('')

  function add() {
    if (!label.trim()) return setErr('Enter a class name.')
    classesStore.add({ label: label.trim(), short: short.trim() || label.trim(), prerequisite, has_expiry: hasExpiry, requires_attachment: requiresAttachment })
    setLabel(''); setShort(''); setPrerequisite(false); setHasExpiry(true); setRequiresAttachment(false); setErr('')
  }
  function remove(c: ComplianceClass) {
    if (window.confirm(`Remove "${c.label}" from the matrix? Existing records for it are kept but hidden until it's added back.`)) classesStore.remove(c.key)
  }

  return (
    <Modal open onClose={onClose} title="Manage compliance classes" subtitle="Add or remove the FQM classes shown as columns" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Current classes — tick what applies</div>
        {classes.map((c) => (
          <div key={c.key} className="rounded-lg border border-black/10 bg-white px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-navy">{c.label}</span>
              <button onClick={() => remove(c)} className="rounded-lg p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove class"><Trash2 size={15} /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex items-center gap-1.5 text-xs text-navy">
                <input type="checkbox" checked={c.prerequisite} onChange={(e) => classesStore.update(c.key, { prerequisite: e.target.checked })} /> Prerequisite
              </label>
              <label className="flex items-center gap-1.5 text-xs text-navy">
                <input type="checkbox" checked={c.has_expiry} onChange={(e) => classesStore.update(c.key, { has_expiry: e.target.checked })} /> Has expiry
              </label>
              <label className="flex items-center gap-1.5 text-xs text-navy">
                <input type="checkbox" checked={c.requires_attachment} onChange={(e) => classesStore.update(c.key, { requires_attachment: e.target.checked })} /> Requires proof
              </label>
            </div>
          </div>
        ))}
        {classes.length === 0 && <p className="text-sm text-status-neutral">No classes — add one below.</p>}
      </div>

      <div className="mt-5 rounded-xl border border-black/10 bg-canvas/50 p-4">
        <div className="mb-2 text-sm font-bold text-navy">Add a class</div>
        {err && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{err}</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Class name *</span>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Working at Heights" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Short header</span>
            <input className={inputCls} value={short} onChange={(e) => setShort(e.target.value)} placeholder="e.g. Heights" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-navy"><input type="checkbox" checked={prerequisite} onChange={(e) => setPrerequisite(e.target.checked)} /> Prerequisite (gates trainings)</label>
          <label className="flex items-center gap-2 text-sm text-navy"><input type="checkbox" checked={hasExpiry} onChange={(e) => setHasExpiry(e.target.checked)} /> Has expiry</label>
          <label className="flex items-center gap-2 text-sm text-navy"><input type="checkbox" checked={requiresAttachment} onChange={(e) => setRequiresAttachment(e.target.checked)} /> Requires proof</label>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={add}><Plus size={14} /> Add class</Button></div>
      </div>
    </Modal>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">{title}</div>
      {note && <div className="mb-2 rounded-lg bg-status-warning/10 px-3 py-1.5 text-[11px] text-[#8a6d10]">{note}</div>}
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function PanelCard({
  cls, cred, locked, editable, onEdit, onView,
}: {
  cls: ComplianceClass
  cred: Credential | undefined
  locked?: boolean
  editable: boolean
  onEdit: () => void
  onView: (id: string, name: string) => void
}) {
  const st = cellState(cred, cls.prerequisite, true) // status purely from the record here
  const badge = cred
    ? st === 'expired' ? { t: 'Expired', c: 'bg-status-critical/10 text-status-critical' }
      : st === 'expiring' ? { t: 'Expiring', c: 'bg-status-warning/10 text-[#8a6d10]' }
        : { t: 'Done', c: 'bg-status-good/10 text-status-good' }
    : locked ? { t: 'Locked', c: 'bg-black/5 text-status-neutral' }
      : { t: 'Not done', c: 'bg-black/5 text-status-neutral' }
  return (
    <button
      onClick={() => editable && onEdit()}
      className={`block w-full rounded-xl border border-black/10 bg-white p-3 text-left ${editable ? 'hover:border-brand/40' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold text-navy">{cls.label}{cls.prerequisite && <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand">Prerequisite</span>}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.c}`}>{badge.t}</span>
      </div>
      {cred ? (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div><span className="text-status-neutral">Date done</span><div className="text-navy">{cred.issued || '—'}</div></div>
          {cls.has_expiry && <div><span className="text-status-neutral">Expires</span><div className="text-navy">{cred.expiry || '—'}</div></div>}
          {cred.location && <div className="col-span-2"><span className="text-status-neutral">Where</span><div className="text-navy">{cred.location}</div></div>}
          {cred.notes && <div className="col-span-2"><span className="text-status-neutral">Notes</span><div className="text-navy">{cred.notes}</div></div>}
          {cred.cert_file ? (
            <div className="col-span-2">
              <button onClick={(e) => { e.stopPropagation(); onView(cred.cert_file!.file_id, cred.cert_file!.file_name) }} className="inline-flex items-center gap-1 text-brand hover:underline"><FileText size={13} /> {cred.cert_file.file_name} <ExternalLink size={10} /></button>
            </div>
          ) : cls.requires_attachment && (
            <div className="col-span-2 text-[#8a6d10]">⚠ Proof / certificate pending upload</div>
          )}
        </div>
      ) : (
        <div className="mt-1 text-xs text-status-neutral">{locked ? 'Complete medicals + silicosis first.' : editable ? 'Tap to record.' : 'Not recorded.'}</div>
      )}
    </button>
  )
}
