import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Wallet, FileSpreadsheet, Search, Settings2, AlertTriangle, Columns3, ArrowUp, ArrowDown, X, Plus, RotateCcw, ReceiptText } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { usePayRun, type PayRow } from '@/lib/payroll/run'
import { deptNo } from '@/lib/payroll/payslip'
import { usePayrunCols, payrunColsStore, PAYRUN_COLUMNS, PAYRUN_COLUMN_LABEL, PAYRUN_NUMERIC } from '@/lib/payroll/columns'

const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' }) }

export default function PayRuns() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const canManage = canEdit(role, 'payroll')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [q, setQ] = useState('')
  const [colsOpen, setColsOpen] = useState(false)

  const { rows: all, tax, unpriced } = usePayRun(branch, month)
  const cur = tax.currency || 'ZMW'
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString()}`
  const cols = usePayrunCols()

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return term ? all.filter((r) => r.p.full_name.toLowerCase().includes(term) || r.p.department.toLowerCase().includes(term)) : all
  }, [all, q])

  const totals = useMemo(() => rows.reduce((t, r) => ({
    basic: t.basic + r.line.basic, allowances: t.allowances + r.line.allowances, leavePay: t.leavePay + r.line.leavePay,
    gross: t.gross + r.line.gross, paye: t.paye + r.line.paye, napsa: t.napsa + r.line.napsa,
    nhima: t.nhima + r.line.nhima, fines: t.fines + r.line.fines, net: t.net + r.line.net,
  }), { basic: 0, allowances: 0, leavePay: 0, gross: 0, paye: 0, napsa: 0, nhima: 0, fines: 0, net: 0 } as Record<string, number>), [rows])

  const colValue = (key: string, r: PayRow): string | number => {
    switch (key) {
      case 'employee': return r.p.full_name
      case 'employee_no': return r.p.employee_no
      case 'department': return r.p.department
      case 'dept_no': return deptNo(r.p.department, r.file.dept_no)
      case 'job_title': return r.file.job_title || r.p.role
      case 'grade': return r.grade || ''
      case 'nrc': return r.file.national_id || ''
      case 'napsa_no': return r.file.napsa || ''
      case 'tpin': return r.file.tpin || ''
      case 'pay_method': return r.file.pay_method || (r.file.bank_account ? 'Bank transfer' : '')
      case 'payment_type': return r.file.payment_type || 'Monthly salary'
      case 'bank': return r.file.bank_name || ''
      case 'bank_branch': return r.file.bank_branch || ''
      case 'bank_account': return r.file.bank_account || ''
      default: return (r.line as any)[key] ?? ''
    }
  }

  function exportXlsx() {
    const flat = rows.map((r) => Object.fromEntries(cols.map((k) => [PAYRUN_COLUMN_LABEL[k], colValue(k, r)])))
    const totalRow = Object.fromEntries(cols.map((k, i) => [PAYRUN_COLUMN_LABEL[k], i === 0 ? 'TOTAL' : (PAYRUN_NUMERIC.has(k) ? Math.round(totals[k] || 0) : '')]))
    flat.push(totalRow)
    const ws = XLSX.utils.json_to_sheet(flat.length ? flat : [{ Employee: 'No priced employees' }])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Pay run')
    XLSX.writeFile(wb, `INZU_Pay_Run_${branchLabel.replace(/\s+/g, '_')}_${month}.xlsx`)
  }

  const stat = (label: string, value: string, tone: 'neutral' | 'good' | 'warning' = 'neutral') => (
    <div className={`rounded-xl border px-3 py-2 ${tone === 'good' ? 'border-status-good/30 bg-status-good/5' : tone === 'warning' ? 'border-status-warning/40 bg-status-warning/10' : 'border-black/10 bg-white'}`}>
      <div className={`text-base font-bold leading-none ${tone === 'good' ? 'text-status-good' : tone === 'warning' ? 'text-[#8a6d10]' : 'text-navy'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-status-neutral">{label}</div>
    </div>
  )

  return (
    <div className="page space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-status-neutral">
          Pay run for <span className="font-medium text-navy">{branchLabel}</span> — <span className="font-medium text-navy">gross (basic + allowances) is read live from each employee's file</span>; PAYE, NAPSA &amp; NHIS come from <Link to="/payroll/taxes" className="font-medium text-brand hover:underline">Payroll → Taxes</Link>, plus any leave days paid out this month and any pending incident fines. Set an employee's salary in HR → Employees → their file → Salary.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/payroll/payslips" className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 px-3 py-2 text-sm font-medium text-navy hover:bg-canvas"><ReceiptText size={15} /> Payslips</Link>
          {canManage && <Button variant="secondary" onClick={() => setColsOpen(true)}><Columns3 size={15} /> Columns</Button>}
          <Button variant="secondary" onClick={exportXlsx} disabled={rows.length === 0}><FileSpreadsheet size={15} /> Export</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand" />
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee / dept…" className="w-56 rounded-lg border border-black/15 bg-white py-2 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <span className="text-[11px] text-status-neutral">{monthLabel(month)} · {rows.length} employee{rows.length === 1 ? '' : 's'}</span>
        <Link to="/payroll/taxes" className="ml-auto inline-flex items-center gap-1 rounded-lg border border-black/15 px-3 py-2 text-xs font-medium text-navy hover:bg-canvas"><Settings2 size={14} /> Tax rates</Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:max-w-3xl sm:grid-cols-4">
        {stat('Gross', money(totals.gross))}
        {stat('Statutory (PAYE+NAPSA+NHIMA)', money(totals.paye + totals.napsa + totals.nhima), 'warning')}
        {stat('Fines', money(totals.fines), totals.fines ? 'warning' : 'neutral')}
        {stat('Net pay', money(totals.net), 'good')}
      </div>

      {unpriced > 0 && <p className="inline-flex items-center gap-1.5 text-xs text-[#8a6d10]"><AlertTriangle size={13} /> {unpriced} active {unpriced === 1 ? 'person has' : 'people have'} no salary set — add it in their employee file to include them.</p>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Employee</th><th className="px-3 py-2.5 font-medium">Grade</th>
                <th className="px-3 py-2.5 text-right font-medium">Basic</th><th className="px-3 py-2.5 text-right font-medium">Allow.</th>
                <th className="px-3 py-2.5 text-right font-medium">Leave pay</th>
                <th className="px-3 py-2.5 text-right font-medium">Gross</th><th className="px-3 py-2.5 text-right font-medium">PAYE</th>
                <th className="px-3 py-2.5 text-right font-medium">NAPSA</th><th className="px-3 py-2.5 text-right font-medium">NHIS</th>
                <th className="px-3 py-2.5 text-right font-medium">Fines</th><th className="px-3 py-2.5 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.p.key} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 font-medium text-navy">{r.p.full_name}<div className="text-[11px] font-normal text-status-neutral">{r.p.department}</div></td>
                  <td className="px-3 py-2 text-status-neutral">{r.grade || '—'}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{r.line.basic.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{r.line.allowances ? r.line.allowances.toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{r.line.leavePay ? <span className="font-medium text-status-good" title={`${r.leave.paidDays} day(s) paid out`}>{r.line.leavePay.toLocaleString()}</span> : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium text-navy">{r.line.gross.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{r.line.paye.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{r.line.napsa.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{r.line.nhima.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-status-neutral">{r.line.fines ? r.line.fines.toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-right font-bold text-navy">{r.line.net.toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="px-4 py-12 text-center text-sm text-status-neutral"><Wallet size={22} className="mx-auto mb-2 text-status-neutral/60" />No priced employees. Set salaries in the employee files to build the run.</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-canvas font-bold text-navy">
                  <td className="px-3 py-2" colSpan={5}>Total ({cur})</td>
                  <td className="px-3 py-2 text-right">{totals.gross.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.paye.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.napsa.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.nhima.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.fines.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.net.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      <p className="text-[11px] text-status-neutral">Figures are computed live — a costing view. Salaries are the master values from each employee's file; statutory rates are configured in Payroll → Taxes.</p>

      {colsOpen && <ColumnArrangeModal onClose={() => setColsOpen(false)} />}
    </div>
  )
}

// Arrange which columns the Excel export includes, and in what order (e.g. bank
// name / branch code / account grouped with net pay for a bank payment file).
function ColumnArrangeModal({ onClose }: { onClose: () => void }) {
  const cols = usePayrunCols()
  const available = PAYRUN_COLUMNS.filter((c) => !cols.includes(c.key))
  const move = (i: number, delta: number) => {
    const j = i + delta; if (j < 0 || j >= cols.length) return
    const next = [...cols];[next[i], next[j]] = [next[j], next[i]]; payrunColsStore.set(next)
  }
  return (
    <Modal open onClose={onClose} title="Arrange export columns" subtitle="Choose which columns the Excel export includes and their order — e.g. group the bank details with net pay for a payment file."
      footer={<><Button variant="secondary" onClick={() => payrunColsStore.reset()}><RotateCcw size={15} /> Reset</Button><Button onClick={onClose}>Done</Button></>}>
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Included ({cols.length}) — in export order</div>
        {cols.map((k, i) => (
          <div key={k} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm">
            <span className="w-5 text-right text-[11px] text-status-neutral">{i + 1}</span>
            <span className="flex-1 font-medium text-navy">{PAYRUN_COLUMN_LABEL[k]}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-status-neutral hover:bg-canvas hover:text-navy disabled:opacity-30"><ArrowUp size={14} /></button>
            <button onClick={() => move(i, 1)} disabled={i === cols.length - 1} className="rounded p-1 text-status-neutral hover:bg-canvas hover:text-navy disabled:opacity-30"><ArrowDown size={14} /></button>
            <button onClick={() => payrunColsStore.set(cols.filter((x) => x !== k))} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove"><X size={14} /></button>
          </div>
        ))}
        {cols.length === 0 && <p className="text-xs text-status-neutral">No columns selected — add some below.</p>}
      </div>
      {available.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Available</div>
          <div className="flex flex-wrap gap-1.5">
            {available.map((c) => (
              <button key={c.key} onClick={() => payrunColsStore.set([...cols, c.key])} className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand/40 px-2.5 py-1 text-[11px] font-medium text-brand hover:border-brand"><Plus size={12} /> {c.label}</button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
