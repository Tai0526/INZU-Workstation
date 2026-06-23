import { useMemo, useState } from 'react'
import { Plus, Search, Lock, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import StatusBadge from '@/components/ui/StatusBadge'
import KpiCard from '@/components/ui/KpiCard'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import {
  useLoto, lotoStore, ENERGY_META, LOTO_STATUS_META, lotoStatus, type LotoPoint, type LotoStatus,
} from '@/lib/safety/registers'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

type Draft = Omit<LotoPoint, 'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at'>

export default function LotoRegister() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const editable = canEdit(role, 'safety')

  const all = useLoto()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | LotoStatus>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const branchPoints = useMemo(() => all.filter((p) => p.branch === branch), [all, branch])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return branchPoints
      .filter((p) => status === 'all' || lotoStatus(p) === status)
      .filter((p) => !term || [p.asset, p.label_code, p.isolation_point].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => a.label_code.localeCompare(b.label_code))
  }, [branchPoints, q, status])

  const kpi = useMemo(() => {
    const s = (st: LotoStatus) => branchPoints.filter((p) => lotoStatus(p) === st).length
    return { total: branchPoints.length, compliant: s('compliant'), due: s('due'), overdue: s('overdue') }
  }, [branchPoints])

  const editing = openId ? all.find((p) => p.id === openId) ?? null : null

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        Lock-Out Tag-Out isolation points for each workshop asset — label code, energy type, procedure reference,
        labelling status, and audit due-dates.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total points" value={kpi.total} />
        <KpiCard label="Compliant" value={kpi.compliant} tone="good" />
        <KpiCard label="Audit due" value={kpi.due} tone="warning" />
        <KpiCard label="Overdue" value={kpi.overdue} tone="critical" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset, label code, isolation point…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All statuses</option>
          <option value="compliant">Compliant ({kpi.compliant})</option>
          <option value="due">Audit due ({kpi.due})</option>
          <option value="overdue">Overdue ({kpi.overdue})</option>
        </select>
        {editable && <Button onClick={() => setAdding(true)}><Plus size={14} /> Add isolation point</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Asset</th>
                <th className="px-4 py-2.5 font-medium">Label code</th>
                <th className="px-4 py-2.5 font-medium">Isolation point</th>
                <th className="px-4 py-2.5 font-medium">Energy</th>
                <th className="px-4 py-2.5 font-medium">Procedure ref</th>
                <th className="px-4 py-2.5 font-medium">Labelled</th>
                <th className="px-4 py-2.5 font-medium">Last audit</th>
                <th className="px-4 py-2.5 font-medium">Next audit</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.id} className={`cursor-pointer ${i % 2 ? 'bg-canvas/40' : ''} hover:bg-canvas`} onClick={() => setOpenId(p.id)}>
                  <td className="px-4 py-2.5 font-medium text-navy">{p.asset}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{p.label_code}</td>
                  <td className="px-4 py-2.5 text-navy">{p.isolation_point}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{ENERGY_META[p.energy_type]}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{p.procedure_ref}</td>
                  <td className="px-4 py-2.5">{p.labelled ? <span className="text-status-good">Yes</span> : <span className="text-status-critical">No</span>}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{p.last_audit || '—'}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{p.next_audit || '—'}</td>
                  <td className="px-4 py-2.5"><StatusBadge tone={LOTO_STATUS_META[lotoStatus(p)].tone}>{LOTO_STATUS_META[lotoStatus(p)].label}</StatusBadge></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <Lock size={22} className="mx-auto mb-2 text-status-neutral" />
                  No isolation points recorded yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      {(adding || editing) && (
        <PointModal
          point={editing}
          branch={branch}
          editable={editable}
          onClose={() => { setAdding(false); setOpenId(null) }}
        />
      )}
    </div>
  )
}

function PointModal({
  point, branch, editable, onClose,
}: {
  point: LotoPoint | null
  branch: LotoPoint['branch']
  editable: boolean
  onClose: () => void
}) {
  const [asset, setAsset] = useState(point?.asset ?? '')
  const [labelCode, setLabelCode] = useState(point?.label_code ?? '')
  const [isolationPoint, setIsolationPoint] = useState(point?.isolation_point ?? '')
  const [energyType, setEnergyType] = useState(point?.energy_type ?? Object.keys(ENERGY_META)[0])
  const [procedureRef, setProcedureRef] = useState(point?.procedure_ref ?? '')
  const [labelled, setLabelled] = useState(point?.labelled ?? false)
  const [lastAudit, setLastAudit] = useState(point?.last_audit ?? '')
  const [nextAudit, setNextAudit] = useState(point?.next_audit ?? '')
  const [notes, setNotes] = useState(point?.notes ?? '')
  const [error, setError] = useState('')

  function save() {
    if (!asset.trim() || !labelCode.trim()) {
      setError('Asset and label code are required.')
      return
    }
    const data: Draft = {
      branch,
      asset: asset.trim(),
      label_code: labelCode.trim(),
      isolation_point: isolationPoint.trim(),
      energy_type: energyType,
      procedure_ref: procedureRef.trim(),
      labelled,
      last_audit: lastAudit,
      next_audit: nextAudit,
      notes,
    }
    if (point) lotoStore.update(point.id, data)
    else lotoStore.add(data)
    onClose()
  }

  function remove() {
    if (point && window.confirm('Delete this isolation point?')) {
      lotoStore.remove(point.id)
      onClose()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={point ? 'Edit isolation point' : 'Add isolation point'}
      footer={
        <>
          {point && editable && <Button variant="danger" className="mr-auto" onClick={remove}>Delete</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {editable && <Button onClick={save}>Save</Button>}
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Asset</span>
          <input className={inputCls} value={asset} onChange={(e) => setAsset(e.target.value)} disabled={!editable} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Label code</span>
          <input className={inputCls} value={labelCode} onChange={(e) => setLabelCode(e.target.value)} disabled={!editable} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Isolation point</span>
          <input className={inputCls} value={isolationPoint} onChange={(e) => setIsolationPoint(e.target.value)} disabled={!editable} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Energy type</span>
          <select className={inputCls} value={energyType} onChange={(e) => setEnergyType(e.target.value)} disabled={!editable}>
            {Object.entries(ENERGY_META).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Procedure ref</span>
          <input className={inputCls} value={procedureRef} onChange={(e) => setProcedureRef(e.target.value)} disabled={!editable} />
        </label>
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={labelled} onChange={(e) => setLabelled(e.target.checked)} disabled={!editable} />
          Point is labelled in the field
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Last audit</span>
            <input type="date" className={inputCls} value={lastAudit} onChange={(e) => setLastAudit(e.target.value)} disabled={!editable} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Next audit</span>
            <input type="date" className={inputCls} value={nextAudit} onChange={(e) => setNextAudit(e.target.value)} disabled={!editable} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Notes</span>
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
        </label>
        {error && (
          <p className="flex items-center gap-1.5 text-xs text-status-critical"><AlertTriangle size={13} /> {error}</p>
        )}
      </div>
    </Modal>
  )
}
