import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Save, FileText, Trash2, Plus, Paperclip, ShieldAlert, CalendarDays, Coins, User, Briefcase, Phone, DoorOpen, AlertTriangle, Banknote, FileClock, Settings2, Search, Wallet } from 'lucide-react'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import Modal from '@/components/ui/Modal'
import { type HrPerson } from '@/lib/hr/directory'
import { putFile, viewFile, deleteFile } from '@/lib/storage/fileStore'
import { useCompliance, useTraining, useComplianceClasses, classMap, credStatus, CRED_STATUS_META, TRAINING_META } from '@/lib/safety/registers'
import {
  employeeFileStore, useEmployeeFiles, fileCompleteness, contractExpiry,
  DOC_CATEGORIES, DOC_CATEGORY_LABEL, EVENT_TYPES, EVENT_TYPE_LABEL,
  type EmployeeFile, type Contact, type DocCategory, type EventType, type SalaryInfo, type ExpiryState,
  type ContractDoc, type FileEvent,
} from '@/lib/hr/employeeFile'
import { useSalaryBands, salaryBandsStore, leaveDayRate } from '@/lib/hr/salaryBands'
import { useLeaveLedger, leaveBalance, leavePhase, LEAVE_TYPE_LABEL, type LeaveEntry } from '@/lib/hr/leaveLedger'
import { assessRisk, RISK_META } from '@/lib/hr/analytics'
import { useCases, DECISION_LABEL, INCIDENT_TYPE_META } from '@/lib/safety/cases'
import { useDeductions } from '@/lib/payroll/deductions'
import { deptNo, STANDARD_ALLOWANCES } from '@/lib/payroll/payslip'
import { useSpeedEvents } from '@/lib/speed/store'
import { countsAgainstDriver } from '@/lib/speed/types'
import { useDriverLeave } from '@/lib/drivers/leave'
import { useEmployeeLeave } from '@/lib/hr/leave'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const fmt = (iso: string) => { try { return iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' } catch { return iso } }
type Tab = 'details' | 'contacts' | 'documents' | 'compliance' | 'contracts' | 'salary' | 'leave' | 'conduct' | 'history' | 'exit'
const TABS: { k: Tab; label: string }[] = [
  { k: 'details', label: 'Details' }, { k: 'contacts', label: 'Contacts' }, { k: 'documents', label: 'Documents' },
  { k: 'compliance', label: 'Compliance' }, { k: 'contracts', label: 'Contracts' }, { k: 'salary', label: 'Salary' },
  { k: 'leave', label: 'Leave' }, { k: 'conduct', label: 'Conduct' }, { k: 'history', label: 'History' }, { k: 'exit', label: 'Exit' },
]
// Scalar (form-edited) fields; documents/events/contracts mutate the store directly,
// so Save must not write them back from the stale form and clobber live additions.
const SCALAR_KEYS: (keyof EmployeeFile)[] = ['national_id', 'dob', 'gender', 'marital_status', 'address', 'email', 'start_date', 'leave_opening', 'leave_opening_at', 'job_title', 'contract_type', 'dept_no', 'tpin', 'napsa', 'pay_method', 'payment_type', 'bank_name', 'bank_branch', 'bank_account', 'next_of_kin', 'emergency_contacts', 'salary', 'exit', 'notes']
const scalars = (x: EmployeeFile): Partial<EmployeeFile> => { const o: Partial<EmployeeFile> = {}; for (const k of SCALAR_KEYS) (o as any)[k] = x[k]; return o }

export default function EmployeeFileDrawer({ person, canManage, onClose }: { person: HrPerson; canManage: boolean; onClose: () => void }) {
  useEmployeeFiles() // reactivity
  const stored = employeeFileStore.for(person.id)
  const ledger = useLeaveLedger()
  const cases = useCases()
  const deductions = useDeductions()
  const speed = useSpeedEvents()
  const driverLeave = useDriverLeave()
  const empLeave = useEmployeeLeave()
  const year = new Date().getFullYear()
  const today = new Date().toISOString().slice(0, 10)
  const curLeave = person.source === 'driver' ? driverLeave[person.id] : empLeave[person.id]

  const [tab, setTab] = useState<Tab>('details')
  const [f, setF] = useState<EmployeeFile>(stored)
  const [key, setKey] = useState('')
  if (key !== person.id) { setKey(person.id); setF(employeeFileStore.for(person.id)) }
  const set = <K extends keyof EmployeeFile>(k: K, v: EmployeeFile[K]) => setF((p) => ({ ...p, [k]: v }))
  const setNok = (patch: Partial<Contact>) => setF((p) => ({ ...p, next_of_kin: { ...p.next_of_kin, ...patch } }))

  function save() { employeeFileStore.set(person.id, scalars(f)); onClose() }
  const dirty = JSON.stringify(scalars(f)) !== JSON.stringify(scalars(stored))

  const bal = useMemo(() => leaveBalance(ledger, person.id, { openingBalance: f.leave_opening, openingAt: f.leave_opening_at, asOf: today, currentLeave: curLeave }), [ledger, person.id, f.leave_opening, f.leave_opening_at, today, curLeave])
  const myLeave = useMemo(() => ledger.filter((e) => e.person_id === person.id && e.kind === 'leave').sort((a, b) => b.start.localeCompare(a.start)), [ledger, person.id])
  const speedCount = useMemo(() => speed.filter((e) => (e.driver_id ? e.driver_id === person.id : e.driver_name === person.full_name) && countsAgainstDriver(e)).length, [speed, person])
  const risk = useMemo(() => assessRisk({ personId: person.id, personName: person.full_name, ledger, cases, deductions, year, speedEvents: speedCount }), [ledger, cases, deductions, person, year, speedCount])
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
  const pick = (k: keyof EmployeeFile, label: string, options: string[], fallback = '') => (
    <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">{label}</span>
      <select disabled={!canManage} className={`${inputCls} disabled:bg-canvas disabled:text-status-neutral`} value={(f[k] as string) || fallback} onChange={(e) => set(k, e.target.value as any)}>
        {!fallback && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select></label>
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
            <div className="text-xs text-status-neutral">{f.job_title || person.role} · {person.department}{person.employee_no ? ` · ${person.employee_no}` : ''}</div>
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
        <div className="flex gap-1 overflow-x-auto border-b border-black/10 bg-white px-3">
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium ${tab === t.k ? 'border-brand text-navy' : 'border-transparent text-status-neutral hover:text-navy'}`}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {tab === 'details' && (
            <>
              <Section icon={User} title="Personal">
                <div className="grid grid-cols-2 gap-2">
                  {field('national_id', 'National ID / NRC')}{field('dob', 'Date of birth', 'date')}
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Gender</span>
                    <select disabled={!canManage} className={`${inputCls} disabled:bg-canvas disabled:text-status-neutral`} value={f.gender || 'Male'} onChange={(e) => set('gender', e.target.value)}><option value="Male">Male</option><option value="Female">Female</option></select></label>
                  {field('marital_status', 'Marital status')}
                  {field('email', 'Email', 'email')}
                  <label className="block col-span-2"><span className="mb-1 block text-[11px] font-medium text-navy">Residential address</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={f.address} onChange={(e) => set('address', e.target.value)} /></label>
                </div>
              </Section>
              <Section icon={Briefcase} title="Employment">
                <div className="grid grid-cols-2 gap-2">
                  {field('start_date', 'Start date (hired)', 'date')}
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Role / job title</span>
                    <input disabled={!canManage} className={`${inputCls} disabled:bg-canvas disabled:text-status-neutral`} value={f.job_title || person.role} onChange={(e) => set('job_title', e.target.value)} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Dept no</span>
                    <input disabled={!canManage} className={`${inputCls} disabled:bg-canvas disabled:text-status-neutral`} value={f.dept_no} placeholder={deptNo(person.department, '') || '—'} onChange={(e) => set('dept_no', e.target.value)} /></label>
                  {field('tpin', 'TPIN (tax)')}
                  {field('napsa', 'NAPSA / social security no')}
                </div>
              </Section>
              {/* Pay method, bank & account — printed on the payslip and exported as a group for the bank file. */}
              <Section icon={Wallet} title="Payment details">
                <div className="grid grid-cols-2 gap-2">
                  {pick('pay_method', 'Pay method', ['Bank transfer', 'Cash', 'Mobile money', 'Cheque'])}
                  {pick('payment_type', 'Payment type', ['Monthly salary', 'Weekly wage', 'Fortnightly', 'Contract', 'Casual'])}
                  {field('bank_name', 'Bank')}
                  {field('bank_branch', 'Bank branch code')}
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
            <DocumentsTab file={stored} canManage={canManage} onUpload={uploadDoc} onRemove={(docId, fileId) => { employeeFileStore.removeDoc(person.id, docId); void deleteFile(fileId) }} />
          )}
          {tab === 'compliance' && <ComplianceTab person={person} />}
          {tab === 'contracts' && <ContractsTab person={person} contracts={stored.contracts} canManage={canManage} today={today} />}
          {tab === 'salary' && <SalaryTab salary={f.salary} onChange={(s) => set('salary', s)} canManage={canManage} takenDays={bal.annualTaken} />}
          {tab === 'history' && <HistoryTab person={person} events={stored.events} canManage={canManage} />}

          {tab === 'leave' && (
            <>
              {canManage && (
                <Section icon={CalendarDays} title="Opening balance (system go-live)">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Days carried in</span><input type="number" className={inputCls} value={f.leave_opening || ''} onChange={(e) => set('leave_opening', Number(e.target.value))} /></label>
                    <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">As of date</span><input type="date" className={inputCls} value={f.leave_opening_at} onChange={(e) => set('leave_opening_at', e.target.value)} /></label>
                  </div>
                  <p className="mt-1 text-[11px] text-status-neutral">Set once at onboarding — the balance accrues +2/month from this date on top of the days carried in. (Set the start date under Details.)</p>
                </Section>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Accrued" value={bal.accrued} />
                <Stat label="Taken" value={bal.annualTaken} />
                <Stat label="Balance" value={bal.balance} tone={bal.balance <= 0 ? 'critical' : bal.balance <= 3 ? 'warning' : 'good'} />
              </div>
              {curLeave && (() => { const ph = leavePhase(curLeave, today); const label = ph === 'current' ? 'On leave now' : ph === 'upcoming' ? 'Upcoming leave' : 'Last leave'; return <div className={`rounded-lg px-3 py-2 text-[11px] ${ph === 'current' ? 'bg-status-warning/10 text-[#8a6d10]' : 'bg-canvas text-status-neutral'}`}>{label}: <b>{fmt(curLeave.start)} → {fmt(curLeave.end)}</b>{ph === 'ended' ? ' (ended)' : ''}{person.source === 'driver' ? ' · from the driver profile' : ''}.</div> })()}
              <div className="text-[11px] text-status-neutral">{bal.paidOut ? `${bal.paidOut} day(s) paid out. ` : ''}Accruing from {fmt(bal.since)}. Grant/adjust leave in <Link to="/hr/leave" className="font-medium text-brand hover:underline">HR → Leave</Link>.</div>
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
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const docs = file.documents.filter((d) => !term || d.name.toLowerCase().includes(term) || DOC_CATEGORY_LABEL[d.category].toLowerCase().includes(term))
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
      {file.documents.length > 0 && (
        <div className="relative"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" className="w-full rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" /></div>
      )}
      {DOC_CATEGORIES.filter((c) => docs.some((d) => d.category === c)).map((c) => (
        <div key={c}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">{DOC_CATEGORY_LABEL[c]}</div>
          <div className="space-y-1">
            {docs.filter((d) => d.category === c).map((d) => (
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
      {file.documents.length > 0 && docs.length === 0 && <p className="rounded-lg bg-canvas px-3 py-6 text-center text-xs text-status-neutral">No documents match your search.</p>}
    </div>
  )
}

const EXPIRY_TONE: Record<ExpiryState, 'good' | 'warning' | 'critical' | 'neutral'> = { valid: 'good', expiring: 'warning', expired: 'critical', none: 'neutral' }

function ContractsTab({ person, contracts, canManage, today }: { person: HrPerson; contracts: ContractDoc[]; canManage: boolean; today: string }) {
  const [name, setName] = useState(''); const [type, setType] = useState('Employment'); const [start, setStart] = useState(''); const [expiry, setExpiry] = useState(''); const [note, setNote] = useState('')
  const [file, setFile] = useState<{ file_id: string; file_name: string } | null>(null)
  async function pick(fl: File) { const id = `ctr_${person.id}_${Date.now()}`.replace(/\s/g, ''); try { await putFile(id, fl); setFile({ file_id: id, file_name: fl.name }) } catch { /* */ } }
  function add() {
    employeeFileStore.addContract(person.id, { branch: person.branch, person_name: person.full_name, name, type, start, expiry, file_id: file?.file_id, file_name: file?.file_name, note })
    setName(''); setType('Employment'); setStart(''); setExpiry(''); setNote(''); setFile(null)
  }
  const sorted = [...contracts].sort((a, b) => (b.expiry || '').localeCompare(a.expiry || ''))
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="rounded-xl border border-black/10 bg-white p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Add a contract</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block col-span-2"><span className="mb-1 block text-[11px] font-medium text-navy">Name</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2-year employment contract" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Type</span><input className={inputCls} value={type} onChange={(e) => setType(e.target.value)} placeholder="Employment / Fixed-term…" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Start</span><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Expiry</span><input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Note</span><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {file ? <span className="inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[11px] text-navy"><FileText size={11} className="text-brand" /><span className="max-w-[150px] truncate">{file.file_name}</span><button onClick={() => { void deleteFile(file.file_id); setFile(null) }}><X size={11} /></button></span>
              : <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-brand/40 px-2.5 py-1 text-[11px] font-medium text-brand hover:border-brand"><Paperclip size={12} /> Attach<input type="file" accept=".pdf,image/*,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} /></label>}
            <Button className="ml-auto" onClick={add} disabled={!expiry && !name}><Plus size={14} /> Add contract</Button>
          </div>
        </div>
      )}
      {sorted.map((c) => { const st = contractExpiry(c.expiry, today); return (
        <div key={c.id} className="rounded-lg border border-black/10 bg-white px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <FileClock size={14} className="shrink-0 text-brand" />
            <span className="min-w-0 flex-1 truncate font-medium text-navy">{c.name}{c.type ? <span className="font-normal text-status-neutral"> · {c.type}</span> : ''}</span>
            <StatusBadge tone={EXPIRY_TONE[st]}>{st === 'none' ? 'No expiry' : st === 'valid' ? 'Valid' : st === 'expiring' ? 'Expiring' : 'Expired'}</StatusBadge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-status-neutral">
            <span>{c.start ? `${fmt(c.start)} → ` : ''}{c.expiry ? fmt(c.expiry) : 'no expiry'}</span>
            {c.file_id && <button onClick={() => viewFile(c.file_id, c.file_name)} className="inline-flex items-center gap-1 text-brand hover:underline"><FileText size={11} /> {c.file_name}</button>}
            {c.note && <span className="truncate">· {c.note}</span>}
            {canManage && <button onClick={() => { employeeFileStore.removeContract(person.id, c.id); if (c.file_id) void deleteFile(c.file_id) }} className="ml-auto rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={12} /></button>}
          </div>
        </div>
      ) })}
      {sorted.length === 0 && <p className="rounded-lg bg-canvas px-3 py-6 text-center text-xs text-status-neutral">No contracts. Upload each with its expiry — HR is reminded before it lapses.</p>}
    </div>
  )
}

function SalaryTab({ salary, onChange, canManage, takenDays }: { salary: SalaryInfo | null; onChange: (s: SalaryInfo) => void; canManage: boolean; takenDays: number }) {
  const bands = useSalaryBands()
  const [bandsOpen, setBandsOpen] = useState(false)
  const s: SalaryInfo = { grade: '', band: '', basic: 0, currency: 'ZMW', effective: '', allowances: [], ...(salary ?? {}) }
  const alw = s.allowances ?? []
  const set = (patch: Partial<SalaryInfo>) => onChange({ ...s, allowances: alw, ...patch })
  function pickGrade(gradeId: string) {
    const b = bands.find((x) => x.id === gradeId)
    if (b) set({ grade: b.grade, band: b.band, basic: b.basic || s.basic, currency: b.currency || s.currency }); else set({ grade: gradeId })
  }
  const band = bands.find((b) => b.grade === s.grade)
  const gross = (s.basic || 0) + alw.reduce((t, a) => t + (a.amount || 0), 0)
  const rate = leaveDayRate(band ?? { basic: s.basic, leave_day_rate: 0 })
  const leaveCost = Math.round(rate * (takenDays || 0))
  const money = (n: number) => `${s.currency} ${n.toLocaleString()}`
  return (
    <div className="space-y-3">
      <Section icon={Banknote} title="Salary (optional)">
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Grade</span>
            {bands.length ? (
              <select disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={bands.find((b) => b.grade === s.grade)?.id || ''} onChange={(e) => pickGrade(e.target.value)}>
                <option value="">{s.grade || '— pick a grade —'}</option>
                {bands.map((b) => <option key={b.id} value={b.id}>{b.grade}{b.band ? ` · ${b.band}` : ''}</option>)}
              </select>
            ) : <input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={s.grade} onChange={(e) => set({ grade: e.target.value })} placeholder="e.g. G5" />}
          </label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Band</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={s.band} onChange={(e) => set({ band: e.target.value })} /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Basic pay</span><input type="number" disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={s.basic || ''} onChange={(e) => set({ basic: Number(e.target.value) })} /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Currency</span><input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={s.currency} onChange={(e) => set({ currency: e.target.value })} /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Effective from</span><input type="date" disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} value={s.effective} onChange={(e) => set({ effective: e.target.value })} /></label>
        </div>
        {canManage && <button onClick={() => setBandsOpen(true)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"><Settings2 size={12} /> Manage grades</button>}
      </Section>

      <Section icon={Coins} title="Allowances">
        <div className="space-y-1.5">
          {alw.map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-1.5">
              <input disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} placeholder="e.g. Housing, Transport" value={a.name} onChange={(e) => set({ allowances: alw.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x) })} />
              <input type="number" disabled={!canManage} className={`${inputCls} disabled:bg-canvas`} placeholder="Amount" value={a.amount || ''} onChange={(e) => set({ allowances: alw.map((x, idx) => idx === i ? { ...x, amount: Number(e.target.value) } : x) })} />
              {canManage && <button onClick={() => set({ allowances: alw.filter((_, idx) => idx !== i) })} className="rounded p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><X size={14} /></button>}
            </div>
          ))}
          {canManage && <button onClick={() => set({ allowances: [...alw, { name: '', amount: 0 }] })} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs font-medium text-brand hover:border-brand"><Plus size={13} /> Add allowance</button>}
          {alw.length === 0 && !canManage && <p className="text-xs text-status-neutral">No allowances.</p>}
          {/* The standard ones have a reserved payslip code, so they always print in the same place. */}
          {canManage && (() => {
            const missing = STANDARD_ALLOWANCES.filter((n) => !alw.some((a) => a.name.trim().toLowerCase() === n.toLowerCase()))
            return missing.length ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-status-neutral">Quick add:</span>
                {missing.map((n) => (
                  <button key={n} onClick={() => set({ allowances: [...alw, { name: n, amount: 0 }] })} className="inline-flex items-center gap-0.5 rounded-full border border-black/15 px-2 py-0.5 text-[11px] font-medium text-navy hover:border-brand hover:text-brand"><Plus size={10} /> {n}</button>
                ))}
              </div>
            ) : null
          })()}
        </div>
        {(s.basic > 0 || alw.length > 0) && <div className="mt-2 flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-xs"><span className="text-status-neutral">Gross (basic + allowances)</span><b className="text-navy">{money(gross)}</b></div>}
      </Section>

      <Section icon={CalendarDays} title="Leave cost">
        <div className="flex items-center justify-between text-xs">
          <span className="text-status-neutral">Leave taken this year · {takenDays || 0} day{takenDays === 1 ? '' : 's'} @ {money(rate)}/day</span>
          <b className="text-navy">≈ {money(leaveCost)}</b>
        </div>
        <p className="mt-1 text-[11px] text-status-neutral">Uses the grade's leave-day rate (set in Manage grades), or basic ÷ 22 if unset. When set, payroll reads the basic from here; statutory deductions stay in Payroll.</p>
      </Section>
      {bandsOpen && <BandsModal onClose={() => setBandsOpen(false)} />}
    </div>
  )
}

function BandsModal({ onClose }: { onClose: () => void }) {
  const bands = useSalaryBands()
  const [grade, setGrade] = useState(''); const [band, setBand] = useState(''); const [basic, setBasic] = useState(0); const [currency, setCurrency] = useState('ZMW'); const [rate, setRate] = useState(0)
  function add() { if (!grade.trim()) return; salaryBandsStore.add({ grade: grade.trim(), band: band.trim(), basic: Number(basic) || 0, currency: currency.trim() || 'ZMW', leave_day_rate: Number(rate) || 0, note: '' }); setGrade(''); setBand(''); setBasic(0); setRate(0) }
  return (
    <Modal open onClose={onClose} title="Salary grades / bands" subtitle="Define grades once; picking a grade pre-fills the basic. The leave-day rate lets you cost leave taken." footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-1.5">
        {bands.map((b) => (
          <div key={b.id} className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-sm">
            <span className="font-medium text-navy">{b.grade}</span><span className="text-status-neutral">{b.band}</span>
            <span className="ml-auto text-status-neutral">{b.currency} {b.basic.toLocaleString()} · {leaveDayRate(b).toLocaleString()}/leave-day</span>
            <button onClick={() => salaryBandsStore.remove(b.id)} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={13} /></button>
          </div>
        ))}
        {bands.length === 0 && <p className="text-xs text-status-neutral">No grades yet.</p>}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        <input className={inputCls} placeholder="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
        <input className={inputCls} placeholder="Band" value={band} onChange={(e) => setBand(e.target.value)} />
        <input type="number" className={inputCls} placeholder="Basic" value={basic || ''} onChange={(e) => setBasic(Number(e.target.value))} />
        <input className={inputCls} placeholder="Cur" value={currency} onChange={(e) => setCurrency(e.target.value)} />
        <input type="number" className={inputCls} placeholder="Leave/day" value={rate || ''} onChange={(e) => setRate(Number(e.target.value))} />
      </div>
      <p className="mt-1 text-[11px] text-status-neutral">Leave/day is the cost of one leave day for the grade (leave blank to use basic ÷ 22).</p>
      <div className="mt-2 flex justify-end"><Button onClick={add}><Plus size={14} /> Add grade</Button></div>
    </Modal>
  )
}

function HistoryTab({ person, events, canManage }: { person: HrPerson; events: FileEvent[]; canManage: boolean }) {
  const [type, setType] = useState<EventType>('training'); const [date, setDate] = useState(''); const [title, setTitle] = useState(''); const [detail, setDetail] = useState('')
  const [file, setFile] = useState<{ file_id: string; file_name: string } | null>(null)
  async function pick(fl: File) { const id = `ev_${person.id}_${Date.now()}`.replace(/\s/g, ''); try { await putFile(id, fl); setFile({ file_id: id, file_name: fl.name }) } catch { /* */ } }
  function add() {
    if (!title.trim()) return
    employeeFileStore.addEvent(person.id, { type, date: date || new Date().toISOString().slice(0, 10), title, detail, file_id: file?.file_id, file_name: file?.file_name })
    setTitle(''); setDetail(''); setDate(''); setFile(null); setType('training')
  }
  const sorted = [...events].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="rounded-xl border border-black/10 bg-white p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Add a record</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Type</span><select className={inputCls} value={type} onChange={(e) => setType(e.target.value as EventType)}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}</select></label>
            <label className="block"><span className="mb-1 block text-[11px] font-medium text-navy">Date</span><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="block col-span-2"><span className="mb-1 block text-[11px] font-medium text-navy">Title</span><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Promoted to Senior Mechanic / Defensive driving course" /></label>
            <label className="block col-span-2"><span className="mb-1 block text-[11px] font-medium text-navy">Detail</span><textarea className={inputCls} rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {file ? <span className="inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[11px] text-navy"><FileText size={11} className="text-brand" /><span className="max-w-[150px] truncate">{file.file_name}</span><button onClick={() => { void deleteFile(file.file_id); setFile(null) }}><X size={11} /></button></span>
              : <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-brand/40 px-2.5 py-1 text-[11px] font-medium text-brand hover:border-brand"><Paperclip size={12} /> Attach (optional)<input type="file" accept=".pdf,image/*,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} /></label>}
            <Button className="ml-auto" onClick={add} disabled={!title.trim()}><Plus size={14} /> Add record</Button>
          </div>
        </div>
      )}
      <ol className="relative space-y-2 border-l border-black/10 pl-4">
        {sorted.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand ring-2 ring-white" />
            <div className="flex items-center gap-2">
              <StatusBadge tone="neutral">{EVENT_TYPE_LABEL[e.type]}</StatusBadge>
              <span className="text-[11px] text-status-neutral">{fmt(e.date)}</span>
              {e.file_id && <button onClick={() => viewFile(e.file_id, e.file_name)} className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"><FileText size={11} /> file</button>}
              {canManage && <button onClick={() => employeeFileStore.removeEvent(person.id, e.id)} className="ml-auto rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={12} /></button>}
            </div>
            <div className="text-sm font-medium text-navy">{e.title}</div>
            {e.detail && <div className="text-[11px] text-status-neutral">{e.detail}</div>}
            <div className="text-[10px] text-status-neutral">{e.by}{e.at ? ` · ${fmt(e.at)}` : ''}</div>
          </li>
        ))}
        {sorted.length === 0 && <li className="text-xs text-status-neutral">No records yet. Log trainings, promotions, transfers and salary changes here.</li>}
      </ol>
    </div>
  )
}

function ComplianceTab({ person }: { person: HrPerson }) {
  const creds = useCompliance().filter((c) => (c.driver_id ? c.driver_id === person.id : c.driver_name === person.full_name))
  const classes = useComplianceClasses()
  const byKey = classMap(classes)
  const training = useTraining().filter((t) => (t.driver_id ? t.driver_id === person.id : t.driver_name === person.full_name))
  const row = (id: string, label: string, issued: string, expiry: string, hasExpiry: boolean, file: { file_id: string; file_name: string } | null) => {
    const st = hasExpiry ? credStatus(expiry) : (issued ? 'valid' : 'missing')
    const meta = CRED_STATUS_META[st]
    return (
      <div key={id} className="flex items-center gap-2 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-navy">{label}</span>
        <span className="shrink-0 text-status-neutral">{issued ? fmt(issued) : '—'}{hasExpiry && expiry ? ` → ${fmt(expiry)}` : ''}</span>
        {file && <button onClick={() => viewFile(file.file_id, file.file_name)} className="shrink-0 text-brand hover:underline" title={file.file_name}><FileText size={12} /></button>}
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <Section icon={ShieldAlert} title="Medicals & site classes">
        {creds.length ? <div className="divide-y divide-black/5">{creds.map((c) => row(c.id, byKey[c.category]?.label || c.category, c.issued, c.expiry, !!byKey[c.category]?.has_expiry, c.cert_file))}</div>
          : <p className="text-xs text-status-neutral">No compliance records for this person.</p>}
      </Section>
      <Section icon={FileText} title="Training">
        {training.length ? <div className="divide-y divide-black/5">{training.map((t) => row(t.id, TRAINING_META[t.category as keyof typeof TRAINING_META] || t.category, t.issued, t.expiry, !!t.expiry, t.cert_file))}</div>
          : <p className="text-xs text-status-neutral">No training records for this person.</p>}
      </Section>
      <p className="text-[11px] text-status-neutral">Medicals, silicosis &amp; site classes are managed in <Link to="/safety/compliance" className="font-medium text-brand hover:underline">Driver Compliance</Link> and <Link to="/safety/training" className="font-medium text-brand hover:underline">Training</Link>; they show here as the master employee record.</p>
    </div>
  )
}
