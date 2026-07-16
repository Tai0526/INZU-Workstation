import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Save, FileText, Trash2, Plus, Paperclip, ShieldAlert, CalendarDays, Coins, User, Briefcase, Phone, DoorOpen, AlertTriangle } from 'lucide-react'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { type HrPerson } from '@/lib/hr/directory'
import { putFile, viewFile, deleteFile } from '@/lib/storage/fileStore'
import {
  employeeFileStore, useEmployeeFiles, blankFile, fileCompleteness,
  DOC_CATEGORIES, DOC_CATEGORY_LABEL, type EmployeeFile, type Contact, type DocCategory,
} from '@/lib/hr/employeeFile'
import { useLeaveLedger, leaveBalance, LEAVE_TYPE_LABEL, type LeaveEntry } from '@/lib/hr/leaveLedger'
import { assessRisk, RISK_META } from '@/lib/hr/analytics'
import { useCases, DECISION_LABEL, INCIDENT_TYPE_META } from '@/lib/safety/cases'
import { useDeductions } from '@/lib/payroll/deductions'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' } catch { return iso } }
type Tab = 'details' | 'contacts' | 'documents' | 'leave' | 'conduct' | 'exit'
const TABS: { k: Tab; label: string }[] = [
  { k: 'details', label: 'Details' }, { k: 'contacts', label: 'Contacts' }, { k: 'documents', label: 'Documents' },
  { k: 'leave', label: 'Leave' }, { k: 'conduct', label: 'Conduct' }, { k: 'exit', label: 'Exit' },
]

export default function EmployeeFileDrawer({ person, canManage, onClose }: { person: HrPerson; canManage: boolean; onClose: () => void }) {
  useEmployeeFiles() // reactivity
  const stored = employeeFileStore.for(person.id)
  const ledger = useLeaveLedger()
  const cases = useCases()
  const deductions = useDeductions()
  const year = new Date().getFullYear()
  const today = new Date().toISOString().slice(0, 10)

  const [tab, setTab] = useState<Tab>('details')
  const [f, setF] = useState<EmployeeFile>(stored)
  const [key, setKey] = useState('')
  if (key !== person.id) { setKey(person.id); setF(employeeFileStore.for(person.id)) }
  const set = <K extends keyof EmployeeFile>(k: K, v: EmployeeFile[K]) => setF((p) => ({ ...p, [k]: v }))
  const setNok = (patch: Partial<Contact>) => setF((p) => ({ ...p, next_of_kin: { ...p.next_of_kin, ...patch } }))

  function save() { employeeFileStore.set(person.id, f) ; onClose() }
  const dirty = JSON.stringify(f) !== JSON.stringify(stored)

  const bal = useMemo(() => leaveBalance(ledger, person.id, year, today), [ledger, person.id, year, today])
  const myLeave = useMemo(() => ledger.filter((e) => e.person_id === person.id && e.kind === 'leave').sort((a, b) => b.start.localeCompare(a.start)), [ledger, person.id])
  const risk = useMemo(() => assessRisk({ personId: person.id, personName: person.full_name, ledger, cases, deductions, year }), [ledger, cases, deductions, person, year])
  const myCases = useMemo(() => cases.filter((c) => (c.driver_id ? c.driver_id === person.id : c.driver_name === person.full_name)).sort((a, b) => b.event_datetime.localeCompare(a.event_datetime)), [cases, person])
  const myFines = useMemo(() => deductions.filter((d) => (d.driver_id ? d.driver_id === person.id : d.driver_name === person.full_name)).sort((a, b) => b.date.localeCompare(a.date)), [deductions, person])
  const finesTotal = myFines.reduce((s, d) => s + (d.status !== 'cancelled' ? d.amount : 0), 0)
  const completeness = fileCompleteness(f)

  async function uploadDoc(category: DocCategory, file: File, name: string) {
    const id = `emp_${person.id}_${Date.now()}`.replace(/\s/g, '')
    try { await putFile(id, file); employeeFileStore.addDoc(person.id, { category, name, file_id: id, file_name: file.name }) } catch { /* upload failed */ }
  }
  async function uploadExit(file: File) {
    const id = `exit_${person.id}_${Date.now()}`.replace(/\s/g, '')
    try { await putFile(id, file); setF((p) => ({ ...p, exit: { ...(p.exit ?? { date: '', reason: '', note: '', file_id: '', file_name: '' }), file_id: id, file_name: file.name } })) } catch { /* */ }
  }

  const field = (k: keyof EmployeeFile, label: string, type = 'text') => (
    <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">{label}</span>
      <input type={type} disabled={!canManage} className={`${inputCls} disabled:bg-canvas disabled:text-status-neutral`} value={(f[k] as string) || ''} onChange={(e) => set(k, e.target.value as any)} /></label>
  )

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/25" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[560px] flex-col border-l border-black/10 bg-canvas shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-black/10 bg-white px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy text-sm font-bold text-white">{person.full_name.split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-bold text-navy">{person.full_name}</span>
              <StatusBadge tone={RISK_META[risk.tier].tone}>{RISK_META[risk.tier].label}</StatusBadge>
            </div>
            <div className="text-xs text-status-neutral">{person.role} · {person.department}{person.employee_no ? ` · ${person.employee_no}` : ''}</div>
            <div className="mt-1 text-[11px] text-status-neutral">File {completeness}% complete{f.updated_at ? ` · updated ${fmt(f.updated_at)}` : ''}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-status-neutral hover:bg-canvas"><X size={18} /></button>
        </div>

        {/* Risk banner */}
        {risk.reasons.length > 0 && (
          <div className={`flex items-start gap-2 px-5 py-2 text-[11px] ${risk.tier === 'high' ? 'bg-status-critical/5 text-status-critical' : 'bg-status-warning/10 text-[#8a6d10]'}`}>
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span><b>{RISK_META[risk.tier].label}:</b> {risk.reasons.join(' · ')}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-black/10 bg-white px-3">
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${tab === t.k ? 'border-brand text-navy' : 'border-transparent text-status-neutral hover:text-navy'}`}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {tab === 'details' && (
            <>
              <Section icon={User} title="Personal">
                <div className="grid grid-cols-2 gap-2">
                  {field('national_id', 'National ID / NRC')}{field('dob', 'Date of birth', 'date')}
                  {field('gender', 'Gender')}{field('marital_status', 'Marital status')}
                  {field('email', 'Email', 'email')}
                  <label className="block col-span-2"><span className="mb-1 block text-[11px] font-medium text-navy">Residential address</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={f.address} onChange={(e) => set('address', e.target.value)} /></label>
                </div>
              </Section>
              <Section icon={Briefcase} title="Employment">
                <div className="grid grid-cols-2 gap-2">
                  {field('start_date', 'Start date (hired)', 'date')}{field('job_title', 'Job title')}
                  {field('contract_type', 'Contract type')}{field('tpin', 'TPIN (tax)')}
                  {field('napsa', 'NAPSA / social security')}{field('bank_name', 'Bank')}
                  {field('bank_account', 'Bank account')}
                </div>
              </Section>
              <Section icon={FileText} title="Notes">
                <textarea disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="General HR notes about this person…" />
              </Section>
            </>
          )}

          {tab === 'contacts' && (
            <>
              <Section icon={User} title="Next of kin">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block col-span-2"><span className="mb-1 block text-[11px] font-medium text-navy">Name</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={f.next_of_kin.name} onChange={(e) => setNok({ name: e.target.value })} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Relationship</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={f.next_of_kin.relationship} onChange={(e) => setNok({ relationship: e.target.value })} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Phone</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={f.next_of_kin.phone} onChange={(e) => setNok({ phone: e.target.value })} /></label>
                </div>
              </Section>
              <Section icon={Phone} title="Emergency contacts">
                <div className="space-y-2">
                  {f.emergency_contacts.map((c, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
                      <input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} placeholder="Name" value={c.name} onChange={(e) => set('emergency_contacts', f.emergency_contacts.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                      <input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} placeholder="Relationship" value={c.relationship} onChange={(e) => set('emergency_contacts', f.emergency_contacts.map((x, idx) => idx === i ? { ...x, relationship: e.target.value } : x))} />
                      <input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} placeholder="Phone" value={c.phone} onChange={(e) => set('emergency_contacts', f.emergency_contacts.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x))} />
                      {canManage && <button onClick={() => set('emergency_contacts', f.emergency_contacts.filter((_, idx) => idx !== i))} className="rounded p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><X size={14} /></button>}
                    </div>
                  ))}
                  {canManage && <button onClick={() => set('emergency_contacts', [...f.emergency_contacts, { name: '', relationship: '', phone: '' }])} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={13} /> Add contact</button>}
                </div>
              </Section>
            </>
          )}

          {tab === 'documents' && (
            <DocumentsTab file={f} canManage={canManage} onUpload={uploadDoc} onRemove={(docId, fileId) => { employeeFileStore.removeDoc(person.id, docId); void deleteFile(fileId) }} />
          )}

          {tab === 'leave' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Accrued" value={bal.accrued} />
                <Stat label="Taken" value={bal.annualTaken} />
                <Stat label="Balance" value={bal.balance} tone={bal.balance <= 0 ? 'critical' : bal.balance <= 3 ? 'warning' : 'good'} />
              </div>
              <div className="text-[11px] text-status-neutral">{bal.paidOut ? `${bal.paidOut} day(s) paid out. ` : ''}Manage leave in <Link to="/hr/leave" className="font-medium text-brand hover:underline">HR → Leave</Link>.</div>
              <Section icon={CalendarDays} title={`Leave this year (${year})`}>
                {myLeave.filter((e) => e.start.slice(0, 4) === String(year)).length ? (
                  <div className="divide-y divide-black/5">
                    {myLeave.filter((e) => e.start.slice(0, 4) === String(year)).map((e) => (
                      <div key={e.id} className="flex items-center gap-2 py-1.5 text-xs">
                        <StatusBadge tone={e.type === 'sick' ? 'critical' : e.type === 'annual' ? 'good' : 'warning'}>{LEAVE_TYPE_LABEL[e.type]}</StatusBadge>
                        <span className="text-status-neutral">{fmt(e.start)} → {fmt(e.end)} · {e.days}d</span>
                        {e.attachment ? <button onClick={() => viewFile(e.attachment!.file_id, e.attachment!.file_name)} className="ml-auto inline-flex items-center gap-1 text-brand hover:underline"><FileText size={11} /> note</button> : e.type === 'sick' ? <span className="ml-auto text-[10px] text-[#8a6d10]">no note</span> : null}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-status-neutral">No leave recorded this year.</p>}
              </Section>
            </>
          )}

          {tab === 'conduct' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Incidents" value={myCases.length} />
                <Stat label="Fines" value={myFines.length} />
                <Stat label="Fines value" value={`K${finesTotal.toLocaleString()}`} tone={finesTotal ? 'warning' : 'neutral'} />
              </div>
              <Section icon={ShieldAlert} title="Disciplinary & incidents">
                {myCases.length ? (
                  <div className="divide-y divide-black/5">
                    {myCases.map((c) => (
                      <Link key={c.id} to={`/safety/incidents?case=${c.id}`} className="block py-1.5 hover:bg-canvas/60">
                        <div className="flex items-center gap-2 text-xs">
                          <StatusBadge tone={INCIDENT_TYPE_META[c.incident_type].tone}>{INCIDENT_TYPE_META[c.incident_type].label}</StatusBadge>
                          <span className="text-status-neutral">{fmt(c.event_datetime)}</span>
                          {c.stage === 'closed' && c.verdict && <span className={`ml-auto text-[11px] ${c.verdict.outcome === 'approved' ? 'text-navy' : 'text-status-neutral'}`}>{c.verdict.outcome === 'rejected' ? 'Rejected' : (c.verdict.decisions.map((d) => DECISION_LABEL[d]).join(', ') || '—')}</span>}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : <p className="text-xs text-status-neutral">No incidents on record.</p>}
              </Section>
              <Section icon={Coins} title="Fines (payroll deductions)">
                {myFines.length ? (
                  <div className="divide-y divide-black/5">
                    {myFines.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 py-1.5 text-xs">
                        <span className="font-medium text-navy">K{d.amount.toLocaleString()}</span>
                        <span className="text-status-neutral">{d.reason} · {fmt(d.date)}</span>
                        <StatusBadge tone={d.status === 'applied' ? 'good' : d.status === 'cancelled' ? 'neutral' : 'warning'}>{d.status}</StatusBadge>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-status-neutral">No fines on record. Fines from finalised speeding/incident cases appear here automatically.</p>}
              </Section>
            </>
          )}

          {tab === 'exit' && (
            <Section icon={DoorOpen} title="Exit interview">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Exit date</span><input type="date" disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={f.exit?.date || ''} onChange={(e) => set('exit', { ...(f.exit ?? { date: '', reason: '', note: '', file_id: '', file_name: '' }), date: e.target.value })} /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Reason</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} placeholder="Resignation / end of contract / dismissal…" value={f.exit?.reason || ''} onChange={(e) => set('exit', { ...(f.exit ?? { date: '', reason: '', note: '', file_id: '', file_name: '' }), reason: e.target.value })} /></label>
                <label className="block col-span-2"><span className="mb-1 block text-[11px] font-medium text-navy">Notes / findings</span><textarea disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} rows={4} value={f.exit?.note || ''} onChange={(e) => set('exit', { ...(f.exit ?? { date: '', reason: '', note: '', file_id: '', file_name: '' }), note: e.target.value })} /></label>
              </div>
              <div className="mt-2">
                {f.exit?.file_id ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[11px] text-navy"><FileText size={11} className="text-brand" /><button onClick={() => viewFile(f.exit!.file_id, f.exit!.file_name)} className="hover:underline">{f.exit.file_name}</button>{canManage && <button onClick={() => { void deleteFile(f.exit!.file_id); set('exit', { ...f.exit!, file_id: '', file_name: '' }) }} className="text-status-neutral hover:text-status-critical"><X size={11} /></button>}</span>
                ) : canManage ? (
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-brand/40 px-2.5 py-1 text-[11px] font-medium text-brand hover:border-brand"><Paperclip size={12} /> Attach exit interview<input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadExit(e.target.files[0])} /></label>
                ) : <span className="text-[11px] text-status-neutral">No exit document.</span>}
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        {canManage && (
          <div className="flex items-center gap-2 border-t border-black/10 bg-white px-5 py-3">
            <span className="text-[11px] text-status-neutral">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={onClose}>Close</Button>
              <Button onClick={save} disabled={!dirty}><Save size={15} /> Save file</Button>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-status-neutral"><Icon size={13} className="text-brand" /> {title}</div>
      {children}
    </div>
  )
}
function Stat({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'good' | 'warning' | 'critical' | 'neutral' }) {
  const c = tone === 'good' ? 'text-status-good' : tone === 'warning' ? 'text-[#8a6d10]' : tone === 'critical' ? 'text-status-critical' : 'text-navy'
  return <div className="rounded-xl border border-black/10 bg-white px-3 py-2 text-center"><div className={`text-lg font-bold leading-none ${c}`}>{value}</div><div className="mt-0.5 text-[11px] text-status-neutral">{label}</div></div>
}

function DocumentsTab({ file, canManage, onUpload, onRemove }: { file: EmployeeFile; canManage: boolean; onUpload: (c: DocCategory, f: File, name: string) => void; onRemove: (docId: string, fileId: string) => void }) {
  const [cat, setCat] = useState<DocCategory>('interview')
  const [name, setName] = useState('')
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="rounded-xl border border-black/10 bg-white p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Add a document</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Type</span>
              <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value as DocCategory)}>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</select></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Label (optional)</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Degree certificate" /></label>
          </div>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-brand/40 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand">
            <Paperclip size={13} /> Upload file
            <input type="file" accept=".pdf,image/*,.doc,.docx" className="hidden" onChange={(e) => { const ff = e.target.files?.[0]; if (ff) { onUpload(cat, ff, name); setName('') } e.target.value = '' }} />
          </label>
        </div>
      )}
      {DOC_CATEGORIES.filter((c) => file.documents.some((d) => d.category === c)).map((c) => (
        <div key={c}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">{DOC_CATEGORY_LABEL[c]}</div>
          <div className="space-y-1">
            {file.documents.filter((d) => d.category === c).map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs">
                <FileText size={13} className="shrink-0 text-brand" />
                <button onClick={() => viewFile(d.file_id, d.file_name)} className="min-w-0 flex-1 truncate text-left font-medium text-navy hover:underline">{d.name}</button>
                <span className="shrink-0 text-[10px] text-status-neutral">{fmt(d.at)}</span>
                {canManage && <button onClick={() => onRemove(d.id, d.file_id)} className="shrink-0 rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={12} /></button>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {file.documents.length === 0 && <p className="rounded-lg bg-canvas px-3 py-6 text-center text-xs text-status-neutral">No documents yet. Upload the interview transcript, qualifications, IDs and contract.</p>}
    </div>
  )
}
