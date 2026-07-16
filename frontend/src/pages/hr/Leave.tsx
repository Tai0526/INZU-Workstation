import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, CheckCircle2, UserRound, Coins, Scale, Paperclip, FileText, X, Trash2, Search, CalendarDays } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { useHrPeople, type HrPerson } from '@/lib/hr/directory'
import { leaveStore } from '@/lib/drivers/leave'
import { empLeaveStore } from '@/lib/hr/leave'
import { putFile, viewFile, deleteFile } from '@/lib/storage/fileStore'
import {
  useLeaveLedger, leaveLedgerStore, leaveBalance, accruedByMonth,
  LEAVE_TYPES, LEAVE_TYPE_LABEL, DRAWS_BALANCE, ANNUAL_ENTITLEMENT, type LeaveType, type LeaveEntry,
} from '@/lib/hr/leaveLedger'
import { employeeFileStore, useEmployeeFiles } from '@/lib/hr/employeeFile'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const todayISO = () => new Date().toISOString().slice(0, 10)
const addDaysISO = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const fmt = (iso: string) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: '2-digit', month: 'short' }) } catch { return iso } }
const TYPE_TONE: Record<LeaveType, 'good' | 'warning' | 'critical' | 'neutral'> = { annual: 'good', sick: 'critical', compassionate: 'warning', maternity: 'warning', paternity: 'warning', unpaid: 'neutral', other: 'neutral' }

export default function HrLeave() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'hr')

  const people = useHrPeople(branch)
  const ledger = useLeaveLedger().filter((e) => e.branch === branch)
  useEmployeeFiles() // reactivity for opening balances
  const today = todayISO()
  const year = new Date().getFullYear()

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const [grant, setGrant] = useState(false)
  const [balMode, setBalMode] = useState<{ person: HrPerson; mode: 'payout' | 'adjustment' } | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | LeaveType>('all')
  const [q, setQ] = useState('')

  const balanceOf = (id: string) => { const fl = employeeFileStore.for(id); return leaveBalance(ledger, id, { openingBalance: fl.leave_opening, openingAt: fl.leave_opening_at, asOf: today }) }

  // Leave spells this year (kind='leave'), newest first, with the person joined.
  const spells = useMemo(() => ledger
    .filter((e) => e.kind === 'leave' && (typeFilter === 'all' || e.type === typeFilter))
    .map((e) => ({ e, person: byId.get(e.person_id) }))
    .sort((a, b) => b.e.start.localeCompare(a.e.start)), [ledger, typeFilter, byId])
  const phaseOf = (e: LeaveEntry) => (e.start <= today && today <= e.end ? 0 : e.start > today ? 1 : 2)
  const onLeaveNow = spells.filter((s) => phaseOf(s.e) === 0).length
  const upcoming = spells.filter((s) => phaseOf(s.e) === 1).length
  const daysThisYear = ledger.filter((e) => e.kind === 'leave').reduce((s, e) => s + e.days, 0)

  // Balances for active staff (search-filtered).
  const activePeople = useMemo(() => {
    const term = q.trim().toLowerCase()
    return people.filter((p) => p.status === 'active').filter((p) => !term || p.full_name.toLowerCase().includes(term) || p.employee_no?.toLowerCase().includes(term))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [people, q])

  function endLeave(e: LeaveEntry) {
    if (!confirm(`Mark ${e.person_name}'s ${LEAVE_TYPE_LABEL[e.type].toLowerCase()} as ended now? They return to the roster; the record is kept.`)) return
    if (e.source === 'driver') leaveStore.clear(e.person_id); else empLeaveStore.clear(e.person_id)
  }
  function removeEntry(e: LeaveEntry) {
    if (!confirm('Delete this leave record? This also frees up the balance if it was annual.')) return
    if (phaseOf(e) !== 2) { if (e.source === 'driver') leaveStore.clear(e.person_id); else empLeaveStore.clear(e.person_id) }
    if (e.attachment) void deleteFile(e.attachment.file_id)
    leaveLedgerStore.remove(e.id)
  }

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Leave for <span className="font-medium text-navy">{branchLabel}</span> — each person accrues <span className="font-medium text-navy">{ANNUAL_ENTITLEMENT} annual days a year (+2 a month)</span>. Heads set leave by type; annual leave can’t exceed the accrued balance. Driver leave can also be set from <Link to="/drivers/profiles" className="font-medium text-brand hover:underline">Drivers → Profiles</Link>.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:max-w-lg sm:grid-cols-4">
        <div className={`rounded-xl border px-3 py-2 ${onLeaveNow ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${onLeaveNow ? 'text-[#8a6d10]' : 'text-navy'}`}>{onLeaveNow}</div><div className="mt-0.5 text-[11px] text-status-neutral">On leave now</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{upcoming}</div><div className="mt-0.5 text-[11px] text-status-neutral">Upcoming</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{daysThisYear}</div><div className="mt-0.5 text-[11px] text-status-neutral">Days taken · {year}</div></div>
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{accruedByMonth(today)}</div><div className="mt-0.5 text-[11px] text-status-neutral">Accrued to date</div></div>
      </div>

      {canManage && <Button onClick={() => setGrant(true)}><Plus size={15} /> Grant leave</Button>}

      {/* Balances */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <CalendarDays size={16} className="text-brand" />
          <h3 className="font-display text-sm font-bold text-navy">Annual leave balances <span className="font-normal text-status-neutral">· {year}</span></h3>
          <div className="relative ml-auto">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person…" className="w-48 rounded-lg border border-black/15 bg-white py-1.5 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
          </div>
        </div>
        <div className="max-h-[24rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white"><tr>
              <th className="px-4 py-2.5 font-medium">Person</th><th className="px-3 py-2.5 text-right font-medium">Accrued</th>
              <th className="px-3 py-2.5 text-right font-medium">Annual taken</th><th className="px-3 py-2.5 text-right font-medium">Paid out</th>
              <th className="px-3 py-2.5 text-right font-medium">Balance</th><th className="px-4 py-2.5" />
            </tr></thead>
            <tbody>
              {activePeople.map((p, i) => {
                const b = balanceOf(p.id)
                const tone = b.balance <= 0 ? 'text-status-critical' : b.balance <= 3 ? 'text-[#8a6d10]' : 'text-status-good'
                return (
                  <tr key={p.key} className={i % 2 ? 'bg-canvas/40' : ''}>
                    <td className="px-4 py-2 font-medium text-navy">{p.full_name}<div className="text-[11px] font-normal text-status-neutral">{p.role} · {p.department}</div></td>
                    <td className="px-3 py-2 text-right text-status-neutral">{b.accrued}{b.adjust ? <span className="text-[11px]"> {b.adjust > 0 ? '+' : ''}{b.adjust}</span> : ''}</td>
                    <td className="px-3 py-2 text-right text-status-neutral">{b.annualTaken}</td>
                    <td className="px-3 py-2 text-right text-status-neutral">{b.paidOut || '—'}</td>
                    <td className={`px-3 py-2 text-right font-bold ${tone}`}>{b.balance}</td>
                    <td className="px-4 py-2">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setBalMode({ person: p, mode: 'payout' })} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-[11px] font-medium text-navy hover:bg-canvas" title="Pay out leave days"><Coins size={12} /> Pay out</button>
                          <button onClick={() => setBalMode({ person: p, mode: 'adjustment' })} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-[11px] font-medium text-navy hover:bg-canvas" title="Adjust the balance (carry-over / correction)"><Scale size={12} /> Adjust</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {activePeople.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-status-neutral">No active staff match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leave history */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <h3 className="font-display text-sm font-bold text-navy">Leave history <span className="font-normal text-status-neutral">· {year}</span></h3>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="ml-auto rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm text-navy outline-none focus:border-brand">
            <option value="all">All types</option>
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white"><tr>
              <th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">From</th><th className="px-4 py-2.5 font-medium">To</th>
              <th className="px-4 py-2.5 font-medium">Days</th><th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Proof</th><th className="px-4 py-2.5 font-medium">By</th><th className="px-4 py-2.5" />
            </tr></thead>
            <tbody>
              {spells.map(({ e, person }, i) => {
                const ph = phaseOf(e)
                return (
                  <tr key={e.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                    <td className="px-4 py-2 font-medium text-navy">{person?.full_name || e.person_name}{e.note ? <div className="text-[11px] font-normal text-status-neutral">{e.note}</div> : null}</td>
                    <td className="px-4 py-2"><StatusBadge tone={TYPE_TONE[e.type]}>{LEAVE_TYPE_LABEL[e.type]}</StatusBadge></td>
                    <td className="px-4 py-2 text-status-neutral">{fmt(e.start)}</td>
                    <td className="px-4 py-2 text-status-neutral">{fmt(e.end)}</td>
                    <td className="px-4 py-2 text-status-neutral">{e.days}</td>
                    <td className="px-4 py-2"><StatusBadge tone={ph === 0 ? 'warning' : ph === 1 ? 'neutral' : 'good'}>{ph === 0 ? 'On leave' : ph === 1 ? 'Upcoming' : 'Ended'}</StatusBadge></td>
                    <td className="px-4 py-2">{e.attachment ? <button onClick={() => viewFile(e.attachment!.file_id, e.attachment!.file_name)} className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"><FileText size={12} /> View</button> : (e.type === 'sick' ? <span className="text-[11px] text-[#8a6d10]">no note</span> : <span className="text-[11px] text-status-neutral">—</span>)}</td>
                    <td className="px-4 py-2 text-[11px] text-status-neutral">{e.by || '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        {canManage && ph !== 2 && <button onClick={() => endLeave(e)} className="text-[11px] font-medium text-status-critical hover:underline">End</button>}
                        {canManage && <button onClick={() => removeEntry(e)} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Delete record"><Trash2 size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {spells.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-status-neutral"><CheckCircle2 size={22} className="mx-auto mb-2 text-status-good" />No leave recorded{typeFilter !== 'all' ? ' of this type' : ''} for {year}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <GrantLeaveModal open={grant} onClose={() => setGrant(false)} people={people} branch={branch} ledger={ledger} today={today} />
      <BalanceModal state={balMode} onClose={() => setBalMode(null)} branch={branch} />
    </div>
  )
}

// ── Grant leave (typed, with balance guard + optional sick note) ────────
function GrantLeaveModal({ open, onClose, people, branch, ledger, today }: {
  open: boolean; onClose: () => void; people: HrPerson[]; branch: any; ledger: LeaveEntry[]; today: string
}) {
  const [pid, setPid] = useState('')
  const [type, setType] = useState<LeaveType>('annual')
  const [start, setStart] = useState(todayISO())
  const [days, setDays] = useState(7)
  const [note, setNote] = useState('')
  const [file, setFile] = useState<{ file_id: string; file_name: string } | null>(null)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setPid(''); setType('annual'); setStart(todayISO()); setDays(7); setNote(''); setFile(null) }
  if (!open && wasOpen) setWasOpen(false)
  if (!open) return null

  const person = people.find((p) => p.id === pid)
  const n = Math.max(1, Number(days) || 1)
  const fl = pid ? employeeFileStore.for(pid) : null
  const bal = pid && fl ? leaveBalance(ledger, pid, { openingBalance: fl.leave_opening, openingAt: fl.leave_opening_at, asOf: today }) : null
  const drawsBalance = DRAWS_BALANCE.includes(type)
  const overBalance = !!bal && drawsBalance && n > bal.balance
  const ready = !!pid && !!start && !overBalance

  async function onPick(f: File) {
    const id = `sick_${pid}_${Date.now()}`.replace(/\s/g, '')
    try { await putFile(id, f); setFile({ file_id: id, file_name: f.name }) } catch { /* upload failed */ }
  }
  function save() {
    if (!ready || !person) return
    const end = addDaysISO(start, n - 1)
    leaveLedgerStore.add({ branch, person_id: pid, person_name: person.full_name, source: person.source === 'driver' ? 'driver' : 'emp', kind: 'leave', type, start, end, days: n, note: note.trim(), attachment: file })
    // Keep the roster's single active-period store in sync.
    if (person.source === 'driver') leaveStore.set(pid, start, end); else empLeaveStore.set(pid, start, end, note)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Grant leave" subtitle="Record a leave spell by type. Annual leave draws down the accrued balance; sick / compassionate etc. are tracked separately."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>Grant {n} day{n === 1 ? '' : 's'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Person</span>
          <SearchableSelect className={inputCls} value={pid} onChange={setPid} placeholder="Search person…"
            options={people.map((p) => ({ value: p.id, label: p.full_name, sub: `${p.role} · ${p.department}` }))}
            emptyText="No people — register them in HR → Employees" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Leave type</span>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as LeaveType)}>{LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Start date</span><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days</span><input type="number" min={1} className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <div className="flex flex-wrap items-end gap-1.5">{[3, 5, 7, 14, 30].map((d) => (<button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${n === d ? 'border-brand bg-brand-tint text-[#8a4513]' : 'border-black/15 text-status-neutral hover:border-brand'}`}>{d}</button>))}</div>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Note (optional)</span><input className={inputCls} placeholder="e.g. bereavement, medical…" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-navy">{type === 'sick' ? 'Sick note' : 'Attachment'} {type === 'sick' && <span className="font-normal text-status-neutral">— recommended</span>}</span>
          {file ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[11px] text-navy"><FileText size={11} className="text-brand" /><button onClick={() => viewFile(file.file_id, file.file_name)} className="max-w-[180px] truncate hover:underline">{file.file_name}</button><button onClick={() => { void deleteFile(file.file_id); setFile(null) }} className="text-status-neutral hover:text-status-critical"><X size={11} /></button></span>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-brand/40 px-2.5 py-1 text-[11px] font-medium text-brand hover:border-brand"><Paperclip size={12} /> Attach<input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} /></label>
          )}
        </div>
      </div>

      {bal && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-[11px] ${overBalance ? 'bg-status-critical/5 text-status-critical' : 'bg-canvas text-status-neutral'}`}>
          <UserRound size={12} className="mr-1 inline" /> {person?.full_name}: <b className="text-navy">{bal.balance}</b> of {bal.accrued} annual days available{bal.paidOut ? ` · ${bal.paidOut} paid out` : ''}.
          {drawsBalance && <> After this: <b className={overBalance ? 'text-status-critical' : 'text-navy'}>{bal.balance - n}</b>.</>}
          {overBalance && <div className="mt-1 font-semibold">Exceeds the accrued annual balance — reduce the days, or record the excess as unpaid leave.</div>}
          {!drawsBalance && <> This {LEAVE_TYPE_LABEL[type].toLowerCase()} doesn’t draw the annual balance.</>}
        </div>
      )}
    </Modal>
  )
}

// ── Pay out / adjust the balance ────────────────────────────────────────
function BalanceModal({ state, onClose, branch }: { state: { person: HrPerson; mode: 'payout' | 'adjustment' } | null; onClose: () => void; branch: any }) {
  const [days, setDays] = useState(1)
  const [note, setNote] = useState('')
  const [key, setKey] = useState('')
  if (state && key !== `${state.person.id}:${state.mode}`) { setKey(`${state.person.id}:${state.mode}`); setDays(state.mode === 'payout' ? 1 : 0); setNote('') }
  if (!state) return null
  const isPayout = state.mode === 'payout'
  const n = Number(days) || 0
  const ready = isPayout ? n > 0 : n !== 0
  function save() {
    if (!ready) return
    leaveLedgerStore.add({ branch, person_id: state!.person.id, person_name: state!.person.full_name, source: state!.person.source === 'driver' ? 'driver' : 'emp', kind: state!.mode, type: 'annual', start: '', end: '', days: n, note: note.trim(), attachment: null })
    onClose()
  }
  return (
    <Modal open={!!state} onClose={onClose} title={isPayout ? `Pay out leave — ${state.person.full_name}` : `Adjust balance — ${state.person.full_name}`}
      subtitle={isPayout ? 'Record annual days paid out instead of taken — they’re subtracted from the balance.' : 'Carry-over or correction. Positive adds days, negative removes them.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>{isPayout ? 'Record pay-out' : 'Apply adjustment'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Days {isPayout ? 'paid out' : '(+/−)'}</span><input type="number" className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Note</span><input className={inputCls} placeholder={isPayout ? 'e.g. 5 days paid with November salary' : 'e.g. 4 days carried over from 2025'} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <p className="mt-2 text-[11px] text-status-neutral">{isPayout ? 'Subtracts from the available annual balance.' : n > 0 ? `Adds ${n} day(s) to the balance.` : n < 0 ? `Removes ${-n} day(s) from the balance.` : 'Enter a positive or negative number.'}</p>
    </Modal>
  )
}
