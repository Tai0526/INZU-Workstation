import { useMemo, useState } from 'react'
import { Plus, Download, Check, X, Wallet, ReceiptText, AlertTriangle, Ban, UserCog, HandCoins, Trash2, Paperclip, SkipForward } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES, ROLES, type BranchCode } from '@/lib/roles'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import StatusBadge from '@/components/ui/StatusBadge'
import KpiCard from '@/components/ui/KpiCard'
import {
  useReqs, useLedger, useActingApprover, actingStore,
  submitReq, authoriseReq, checkReq, approveReq, rejectReq, payReq, addLedger, removeLedger,
  addReceipt, removeReceipt, canApprove, canAuthorise, canCheck, canManageLedger, canSeePettyBooks, skipAuthorise,
} from '@/lib/pettycash/store'
import { putFile, viewFile, deleteFile } from '@/lib/storage/fileStore'
import {
  type Requisition, type LedgerEntry, type LedgerKind,
  REQ_STATUS_META, OPEN_STATUSES, LEDGER_KIND_LABEL, MONEY_IN_KINDS,
  fmtK, balanceOf, arrearsOf, withRunningBalance,
} from '@/lib/pettycash/types'
import { exportPettyCash } from '@/lib/pettycash/excel'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const today = () => new Date().toISOString().slice(0, 10)
type Tab = 'requests' | 'recon'

export default function PettyCash() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const myName = user!.fullName

  const approver = canApprove(role, myName)
  const authoriser = canAuthorise(role, myName)
  const checker = canCheck(role)
  const custodian = canManageLedger(role)
  const books = canSeePettyBooks(role) // Safety / Ops / Asst Ops / admin / MD — see the float, reconciliation & export
  const canSeeAll = books || approver   // an acting approver also needs the queue, to approve

  const allReqs = useReqs().filter((r) => r.branch === branch)
  const ledger = useLedger().filter((e) => e.branch === branch)
  const acting = useActingApprover()

  const myReqs = allReqs.filter((r) => r.requester_name.trim().toLowerCase() === myName.trim().toLowerCase())
  const reqs = canSeeAll ? allReqs : myReqs // what this user is allowed to see

  const [tab, setTab] = useState<Tab>('requests')
  const bal = balanceOf(ledger)
  const arrears = arrearsOf(ledger)
  const openReqs = reqs.filter((r) => OPEN_STATUSES.includes(r.status))
  const paidTotal = reqs.filter((r) => r.status === 'paid').reduce((s, r) => s + r.paid_amount, 0)
  const myPaid = myReqs.filter((r) => r.status === 'paid').reduce((s, r) => s + r.paid_amount, 0)
  const myOpen = myReqs.filter((r) => OPEN_STATUSES.includes(r.status)).length

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          {books
            ? <>Petty cash requisitions and the Safety-run reconciliation for {branchLabel}. Request → check (Safety) → authorise (Asst Ops, skipped if on leave) → approve (Ops/Asst Ops) → pay. Everyone in the chain is notified.</>
            : <>Your petty cash requisitions for {branchLabel}. Raise a request and it routes for authorisation, check and approval — you'll be notified at each step and when it is paid.</>}
        </p>
        {books && <Button variant="secondary" onClick={() => exportPettyCash({ reqs: allReqs, ledger, branchLabel })}><Download size={15} /> Export books (Excel)</Button>}
      </div>

      {/* KPIs — the full "books" view for privileged roles, a personal view for everyone else */}
      {books ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Cash balance" value={fmtK(bal)} tone={bal < 0 ? 'critical' : 'good'} sub={`${branchLabel} float`} info="Money received minus money paid out — the current petty-cash balance." />
          <KpiCard label="Awaiting action" value={openReqs.length} tone={openReqs.length ? 'warning' : 'good'} sub="requisitions in the chain" />
          <KpiCard label="Paid out (all)" value={fmtK(paidTotal)} sub="disbursed to date" />
          <KpiCard label="Arrears" value={fmtK(arrears)} tone={arrears > 0 ? 'critical' : 'good'} sub="borrowed, unrepaid" info="Money borrowed to cover an overdraft that hasn't been repaid yet." />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard label="Paid out to you" value={fmtK(myPaid)} tone="good" sub="disbursed to date" info="Total petty cash paid out to you across all your requisitions." />
          <KpiCard label="In progress" value={myOpen} tone={myOpen ? 'warning' : 'good'} sub="your requests in the chain" />
          <KpiCard label="Your requests" value={myReqs.length} sub="raised to date" />
        </div>
      )}

      {/* Acting-approver banner — only those who actually work the queue */}
      {acting && canSeeAll && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/25 bg-brand-tint/25 px-4 py-2.5 text-sm text-navy">
          <UserCog size={16} className="text-brand" />
          <span><span className="font-semibold">{acting.name}</span> is acting approver{acting.note ? ` — ${acting.note}` : ''} (set by {acting.by}).</span>
          {approver && <button onClick={() => actingStore.clear()} className="ml-auto text-xs text-brand hover:underline">clear</button>}
        </div>
      )}

      {/* Tabs — the reconciliation "books" are for privileged roles only */}
      {books && (
        <div className="flex gap-1 border-b border-black/10">
          {([['requests', 'Requisitions'], ['recon', 'Reconciliation']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-brand text-navy' : 'border-transparent text-status-neutral hover:text-navy'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {(!books || tab === 'requests') && <RequestsTab reqs={reqs} branch={branch} myName={myName} role={role} approver={approver} authoriser={authoriser} checker={checker} custodian={custodian} balance={bal} initialFilter={books ? 'open' : 'all'} />}
      {books && tab === 'recon' && <ReconTab ledger={ledger} reqs={allReqs} branch={branch} custodian={custodian} balance={bal} arrears={arrears} branchLabel={branchLabel} />}
    </div>
  )
}

// ── Requisitions ────────────────────────────────────────────────────────
function RequestsTab({ reqs, branch, myName, role, approver, authoriser, checker, custodian, balance, initialFilter = 'open' }: {
  reqs: Requisition[]; branch: BranchCode; myName: string; role: any; approver: boolean; authoriser: boolean; checker: boolean; custodian: boolean; balance: number; initialFilter?: 'open' | 'all' | 'paid' | 'rejected'
}) {
  const [filter, setFilter] = useState<'open' | 'all' | 'paid' | 'rejected'>(initialFilter)
  const [newOpen, setNewOpen] = useState(false)
  const [pay, setPay] = useState<Requisition | null>(null)
  const [reject, setReject] = useState<Requisition | null>(null)
  const [actingOpen, setActingOpen] = useState(false)

  const rows = useMemo(() => {
    const f = reqs.filter((r) => filter === 'all' ? true : filter === 'open' ? OPEN_STATUSES.includes(r.status) : r.status === filter)
    return [...f].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [reqs, filter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="open">In progress</option>
          <option value="all">All</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="text-xs text-status-neutral">{rows.length} shown</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {approver && <Button variant="secondary" onClick={() => setActingOpen(true)}><UserCog size={15} /> Acting approver</Button>}
          <Button onClick={() => setNewOpen(true)}><Plus size={15} /> New request</Button>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <ReqCard key={r.id} r={r} myName={myName} role={role} approver={approver} authoriser={authoriser} checker={checker} custodian={custodian} balance={balance} onPay={() => setPay(r)} onReject={() => setReject(r)} />
        ))}
        {rows.length === 0 && <div className="card px-6 py-12 text-center text-sm text-status-neutral">No requisitions here yet.</div>}
      </div>

      <NewRequestModal open={newOpen} onClose={() => setNewOpen(false)} branch={branch} myName={myName} />
      <PayModal req={pay} onClose={() => setPay(null)} balance={balance} />
      <RejectModal req={reject} onClose={() => setReject(null)} />
      <ActingApproverModal open={actingOpen} onClose={() => setActingOpen(false)} />
    </div>
  )
}

function Stamp({ label, by, at }: { label: string; by: string; at: string }) {
  if (!by) return null
  return <span className="text-[11px] text-status-neutral">{label} <span className="font-medium text-navy">{by}</span> · {at.slice(0, 10)}</span>
}

function ReqCard({ r, myName, role, approver, authoriser, checker, custodian, balance, onPay, onReject }: {
  r: Requisition; myName: string; role: any; approver: boolean; authoriser: boolean; checker: boolean; custodian: boolean; balance: number; onPay: () => void; onReject: () => void
}) {
  const mine = r.requester_name.trim().toLowerCase() === myName.trim().toLowerCase()
  const canDoCheck = r.status === 'pending' && checker                              // Safety checks first
  const canDoAuthorise = r.status === 'checked' && authoriser                       // Asst Ops authorises
  const canSkipAuth = r.status === 'checked' && !authoriser && (approver || checker) // skip when Asst Ops on leave
  const canDoApprove = r.status === 'authorised' && approver                        // Ops / Asst Ops approve
  const canDoPay = r.status === 'approved' && custodian
  const canDoReject = OPEN_STATUSES.includes(r.status) && (approver || checker)
  const receipts = r.receipts ?? []
  const canAttach = custodian || mine // Safety (checker) or the requester
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const id = `pcrcpt_${r.id}_${Date.now()}_${Math.round(Math.random() * 1e6)}`
    try { await putFile(id, file); addReceipt(r.id, { id, name: file.name, at: new Date().toISOString(), by: myName }) } catch { /* upload failed */ }
    e.target.value = ''
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy/5"><ReceiptText size={18} className="text-brand" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-bold text-navy">{fmtK(r.amount)}</span>
            <StatusBadge tone={REQ_STATUS_META[r.status].tone}>{REQ_STATUS_META[r.status].label}</StatusBadge>
            {mine && <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-medium text-navy">your request</span>}
          </div>
          <div className="mt-0.5 text-sm text-navy"><span className="font-medium">{r.requester_name}</span> · {r.department}{r.position ? ` · ${r.position}` : ''} · {r.date}</div>
          <p className="mt-1 text-sm text-status-neutral">{r.purpose}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
            <Stamp label="Checked:" by={r.checked_by} at={r.checked_at} />
            {r.authorised_skipped
              ? (!!r.authorised_at && <span className="text-[11px] text-status-neutral">Authorisation <span className="font-medium text-navy">skipped</span> (Asst Ops on leave) · {r.authorised_by} · {r.authorised_at.slice(0, 10)}</span>)
              : <Stamp label="Authorised:" by={r.authorised_by} at={r.authorised_at} />}
            <Stamp label="Approved:" by={r.approved_by} at={r.approved_at} />
            {r.status === 'paid' && <span className="text-[11px] text-status-good">Paid <span className="font-medium">{fmtK(r.paid_amount)}</span> by {r.paid_by} · {r.paid_at.slice(0, 10)}</span>}
            {r.status === 'rejected' && <span className="text-[11px] text-status-critical">Rejected by {r.rejected_by}{r.rejected_note ? ` — ${r.rejected_note}` : ''}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {canDoCheck && <Button variant="secondary" onClick={() => checkReq(r.id)}><Check size={14} /> Check</Button>}
          {canDoAuthorise && <Button variant="secondary" onClick={() => authoriseReq(r.id)}><Check size={14} /> Authorise</Button>}
          {canSkipAuth && <Button variant="secondary" onClick={() => { if (confirm('Skip the Asst Ops authorisation? Use this only when the Asst Ops is on leave.')) skipAuthorise(r.id) }}><SkipForward size={14} /> Skip authorisation</Button>}
          {canDoApprove && <Button onClick={() => approveReq(r.id)}><Check size={14} /> Approve</Button>}
          {canDoPay && <Button onClick={onPay}><HandCoins size={14} /> Pay</Button>}
          {canDoReject && <Button variant="secondary" onClick={onReject}><Ban size={14} /> Reject</Button>}
        </div>
      </div>
      {canDoPay && balance < r.amount && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-[#8a6d10]"><AlertTriangle size={12} /> Balance ({fmtK(balance)}) is below the requested amount — paying will overdraw. Record where the cash came from on the Reconciliation tab.</p>
      )}
      {(receipts.length > 0 || canAttach) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-black/5 pt-2">
          <span className="text-[11px] font-medium text-status-neutral">Receipts</span>
          {receipts.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[11px] text-navy" title={`Attached by ${f.by} · ${f.at.slice(0, 10)}`}>
              <Paperclip size={11} className="text-brand" />
              <button onClick={() => viewFile(f.id, f.name)} className="max-w-[160px] truncate hover:underline">{f.name}</button>
              {canAttach && <button onClick={() => { removeReceipt(r.id, f.id); void deleteFile(f.id) }} className="text-status-neutral hover:text-status-critical" title="Remove"><X size={11} /></button>}
            </span>
          ))}
          {receipts.length === 0 && <span className="text-[11px] text-status-neutral/70">none yet — optional, attach once purchased</span>}
          {canAttach && (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-brand/40 px-2 py-0.5 text-[11px] font-medium text-brand hover:border-brand">
              <Plus size={11} /> Attach receipt
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={onFile} />
            </label>
          )}
        </div>
      )}
    </div>
  )
}

function NewRequestModal({ open, onClose, branch, myName }: { open: boolean; onClose: () => void; branch: BranchCode; myName: string }) {
  const [f, setF] = useState({ date: today(), requester_name: myName, department: '', position: '', purpose: '', amount: '' })
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setF({ date: today(), requester_name: myName, department: '', position: '', purpose: '', amount: '' }) }
  if (!open && wasOpen) setWasOpen(false)
  const ready = f.requester_name.trim() && f.purpose.trim() && Number(f.amount) > 0
  function save() {
    if (!ready) return
    submitReq({ branch, date: f.date, requester_name: f.requester_name.trim(), department: f.department.trim(), position: f.position.trim(), purpose: f.purpose.trim(), amount: Number(f.amount) })
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Petty cash requisition" subtitle="Fill it in as on the paper form — it routes for checking, authorisation and approval."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>Submit request</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Name *</span><input className={inputCls} value={f.requester_name} onChange={(e) => setF({ ...f, requester_name: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Department</span><input className={inputCls} placeholder="e.g. Operations" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Position</span><input className={inputCls} placeholder="e.g. Bus Controller" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Purpose *</span><textarea className={inputCls} rows={4} placeholder="What is the money for?" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Total amount (K) *</span><input type="number" className={inputCls} placeholder="0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      </div>
    </Modal>
  )
}

function PayModal({ req, onClose, balance }: { req: Requisition | null; onClose: () => void; balance: number }) {
  const [amount, setAmount] = useState('')
  const [lastId, setLastId] = useState('')
  if (req && req.id !== lastId) { setLastId(req.id); setAmount(String(req.amount)) }
  if (!req) return null
  const amt = Number(amount) || 0
  function save() { if (amt <= 0) return; payReq(req!, amt); onClose() }
  return (
    <Modal open={!!req} onClose={onClose} title="Disburse petty cash" subtitle={`${req.requester_name} · requested ${fmtK(req.amount)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={amt <= 0}><HandCoins size={15} /> Pay {fmtK(amt)}</Button></>}>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Amount given (K)</span><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <p className="mt-2 text-[11px] text-status-neutral">This posts a disbursement to the reconciliation ledger and marks the requisition paid. Current balance: <span className="font-medium text-navy">{fmtK(balance)}</span>.{amt > balance && ' Paying this overdraws the float.'}</p>
    </Modal>
  )
}

function RejectModal({ req, onClose }: { req: Requisition | null; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [lastId, setLastId] = useState('')
  if (req && req.id !== lastId) { setLastId(req.id); setNote('') }
  if (!req) return null
  return (
    <Modal open={!!req} onClose={onClose} title="Reject requisition" subtitle={`${req.requester_name} · ${fmtK(req.amount)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => { rejectReq(req!.id, note); onClose() }}><Ban size={15} /> Reject</Button></>}>
      <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reason (shown to the requester)</span><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this being rejected?" /></label>
    </Modal>
  )
}

function ActingApproverModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const acting = useActingApprover()
  const [name, setName] = useState(acting?.name ?? '')
  const [note, setNote] = useState(acting?.note ?? '')
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setName(acting?.name ?? ''); setNote(acting?.note ?? '') }
  if (!open && wasOpen) setWasOpen(false)
  return (
    <Modal open={open} onClose={onClose} title="Acting approver" subtitle="When both Ops and Asst Ops are out, name who holds authorise/approve power."
      footer={<><Button variant="secondary" onClick={() => { actingStore.clear(); onClose() }}>Clear</Button><Button onClick={() => { actingStore.set(name, note); onClose() }} disabled={!name.trim()}>Set</Button></>}>
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Full name (must match their account)</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. James Nsalamba" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Note (optional)</span><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. covering 12–16 Jul while both are on leave" /></label>
        <p className="text-[11px] text-status-neutral">While set, this person can authorise and approve requisitions. Clear it when Ops/Asst Ops are back.</p>
      </div>
    </Modal>
  )
}

// ── Reconciliation ──────────────────────────────────────────────────────
function ReconTab({ ledger, reqs, branch, custodian, balance, arrears, branchLabel }: {
  ledger: LedgerEntry[]; reqs: Requisition[]; branch: BranchCode; custodian: boolean; balance: number; arrears: number; branchLabel: string
}) {
  const [inOpen, setInOpen] = useState(false)
  const rows = useMemo(() => withRunningBalance(ledger).reverse(), [ledger]) // newest first for display
  const totalIn = ledger.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0)
  const totalOut = ledger.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0)
  const awaiting = reqs.filter((r) => r.status === 'approved')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-navy/5 px-3 py-1.5 text-sm"><Wallet size={15} className="text-brand" /> Balance <span className={`font-bold ${balance < 0 ? 'text-status-critical' : 'text-navy'}`}>{fmtK(balance)}</span></div>
        <span className="text-xs text-status-neutral">In {fmtK(totalIn)} · Out {fmtK(totalOut)}{arrears > 0 ? ` · Arrears ${fmtK(arrears)}` : ''}</span>
        {custodian && <div className="ml-auto flex gap-2"><Button onClick={() => setInOpen(true)}><Plus size={15} /> Record money in / out</Button></div>}
      </div>

      {!custodian && <p className="rounded-lg bg-brand-tint/30 px-3 py-2 text-[11px] text-[#8a4513]">The reconciliation ledger is maintained by the Safety Officer (the custodian). You can view it and export the books.</p>}
      {awaiting.length > 0 && custodian && (
        <p className="rounded-lg border border-status-good/30 bg-status-good/5 px-3 py-2 text-sm text-navy"><span className="font-semibold text-status-good">{awaiting.length}</span> approved requisition{awaiting.length === 1 ? '' : 's'} awaiting disbursement — pay them on the Requisitions tab.</p>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Detail</th><th className="px-4 py-2.5 font-medium">Party / source</th>
                <th className="px-4 py-2.5 text-right font-medium">In</th><th className="px-4 py-2.5 text-right font-medium">Out</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>{custodian && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-4 py-2 text-navy">{e.date}</td>
                  <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${e.direction === 'in' ? 'bg-status-good/10 text-status-good' : 'bg-status-critical/10 text-status-critical'}`}>{e.direction === 'in' ? 'IN' : 'OUT'}</span></td>
                  <td className="px-4 py-2 text-status-neutral">{LEDGER_KIND_LABEL[e.kind]}{e.note ? <span className="text-status-neutral/80"> — {e.note}</span> : ''}</td>
                  <td className="px-4 py-2 text-navy">{e.party || '—'}</td>
                  <td className="px-4 py-2 text-right text-status-good">{e.direction === 'in' ? fmtK(e.amount) : ''}</td>
                  <td className="px-4 py-2 text-right text-status-critical">{e.direction === 'out' ? fmtK(e.amount) : ''}</td>
                  <td className={`px-4 py-2 text-right font-medium ${e.balance < 0 ? 'text-status-critical' : 'text-navy'}`}>{fmtK(e.balance)}</td>
                  {custodian && <td className="px-4 py-2 text-right">{!e.req_id && <button onClick={() => confirm('Remove this ledger entry?') && removeLedger(e.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>}</td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={custodian ? 8 : 7} className="px-4 py-12 text-center text-sm text-status-neutral">No ledger entries yet. {custodian && 'Record the opening float to start the books.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-status-neutral">Export the full workbook (requisition register + this ledger with the running balance) from the button at the top of the page for {branchLabel} stakeholders.</p>

      <MoneyModal open={inOpen} onClose={() => setInOpen(false)} branch={branch} balance={balance} />
    </div>
  )
}

function MoneyModal({ open, onClose, branch, balance }: { open: boolean; onClose: () => void; branch: BranchCode; balance: number }) {
  const [dir, setDir] = useState<'in' | 'out'>('in')
  const [kind, setKind] = useState<LedgerKind>('topup')
  const [f, setF] = useState({ date: today(), amount: '', party: '', note: '' })
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) { setWasOpen(true); setDir('in'); setKind('topup'); setF({ date: today(), amount: '', party: '', note: '' }) }
  if (!open && wasOpen) setWasOpen(false)
  const ready = Number(f.amount) > 0
  const kinds: LedgerKind[] = dir === 'in' ? MONEY_IN_KINDS : ['repayment', 'adjustment']
  function save() {
    if (!ready) return
    addLedger({ branch, date: f.date, direction: dir, kind, amount: Number(f.amount), party: f.party.trim(), note: f.note.trim() })
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Record money" subtitle="Cash received (top-up / float / borrowed) or paid out (arrears repayment / adjustment)."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>Save</Button></>}>
      <div className="space-y-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-black/15 text-sm">
          {(['in', 'out'] as const).map((d) => (
            <button key={d} onClick={() => { setDir(d); setKind(d === 'in' ? 'topup' : 'repayment') }} className={`px-4 py-1.5 font-medium ${dir === d ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-canvas'}`}>{d === 'in' ? 'Money in' : 'Money out'}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Date</span><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Type</span><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as LedgerKind)}>{kinds.map((k) => <option key={k} value={k}>{LEDGER_KIND_LABEL[k]}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Amount (K)</span><input type="number" className={inputCls} placeholder="0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-navy">{kind === 'borrowed' ? 'Borrowed from (who / where)' : dir === 'in' ? 'Received from' : 'Paid to'}</span><input className={inputCls} placeholder={kind === 'borrowed' ? 'e.g. J. Banda — to repay next float' : 'name / source'} value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Note</span><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        </div>
        {kind === 'borrowed' && <p className="text-[11px] text-[#8a4513]">Records who covered the overdraft — it shows as arrears until you record a repayment (money out → arrears repayment).</p>}
        <p className="text-[11px] text-status-neutral">Balance after this: <span className="font-medium text-navy">{fmtK(balance + (dir === 'in' ? 1 : -1) * (Number(f.amount) || 0))}</span></p>
      </div>
    </Modal>
  )
}
