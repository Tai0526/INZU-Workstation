import { useMemo, useRef, useState } from 'react'
import { Plus, Search, FileText, ExternalLink, UploadCloud, GraduationCap } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import StatusBadge from '@/components/ui/StatusBadge'
import KpiCard from '@/components/ui/KpiCard'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import { useDrivers } from '@/lib/drivers/store'
import {
  useTraining, trainingStore, TRAINING_META, credStatus, CRED_STATUS_META,
  type Credential, type CredStatus,
} from '@/lib/safety/registers'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

type FormState = {
  driver_id: string
  driver_name: string
  category: string
  issued: string
  expiry: string
  cert_file: Credential['cert_file']
  notes: string
}
const emptyForm: FormState = { driver_id: '', driver_name: '', category: '', issued: '', expiry: '', cert_file: null, notes: '' }

export default function TrainingRecords() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const editable = canEdit(role, 'safety')

  const all = useTraining()
  const drivers = useDrivers()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | CredStatus>('all')
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const mine = useMemo(() => all.filter((r) => r.branch === branch), [all, branch])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return mine
      .filter((r) => status === 'all' || credStatus(r.expiry) === status)
      .filter((r) => !term || [r.driver_name, TRAINING_META[r.category] ?? r.category].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [mine, q, status])

  const counts = useMemo(() => ({
    all: mine.length,
    valid: mine.filter((r) => credStatus(r.expiry) === 'valid').length,
    expiring: mine.filter((r) => credStatus(r.expiry) === 'expiring').length,
    expired: mine.filter((r) => credStatus(r.expiry) === 'expired').length,
    missing: mine.filter((r) => r.cert_file == null).length,
  }), [mine])

  function openAdd() {
    setEditId(null)
    setForm(emptyForm)
    setError('')
    setOpen(true)
  }
  function openEdit(r: Credential) {
    setEditId(r.id)
    setForm({ driver_id: r.driver_id, driver_name: r.driver_name, category: r.category, issued: r.issued, expiry: r.expiry, cert_file: r.cert_file, notes: r.notes })
    setError('')
    setOpen(true)
  }

  function pickDriver(id: string) {
    const d = drivers.find((x) => x.id === id)
    setForm((f) => ({ ...f, driver_id: id, driver_name: d?.full_name ?? '' }))
  }

  async function attach(file: File) {
    const fileId = `trn_${Date.now()}`.replace(/\s/g, '')
    await putFile(fileId, file)
    setForm((f) => ({ ...f, cert_file: { file_id: fileId, file_name: file.name } }))
  }
  async function view(f: Credential['cert_file']) {
    if (f && (await viewFile(f.file_id, f.file_name))) return
    alert('No file attached.')
  }

  function save() {
    if (!form.driver_id || !form.category) {
      setError('Select a driver and a training category.')
      return
    }
    if (editId) {
      trainingStore.update(editId, { ...form })
    } else {
      trainingStore.add({ branch, ...form })
    }
    setOpen(false)
  }
  function del() {
    if (editId && window.confirm('Delete this training record?')) {
      trainingStore.remove(editId)
      setOpen(false)
    }
  }

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        Driver training and certification — defensive driving, TATA OEM, first aid and more. Each record tracks the
        issuing certificate and its expiry so refreshers are scheduled before competencies lapse.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total records" value={counts.all} />
        <KpiCard label="Expiring" value={counts.expiring} tone="warning" />
        <KpiCard label="Expired" value={counts.expired} tone="critical" />
        <KpiCard label="Missing certificate" value={counts.missing} tone="neutral" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver, training…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All statuses ({counts.all})</option>
          <option value="valid">Valid ({counts.valid})</option>
          <option value="expiring">Expiring ({counts.expiring})</option>
          <option value="expired">Expired ({counts.expired})</option>
          <option value="missing">No certificate ({counts.missing})</option>
        </select>
        {editable && <Button onClick={openAdd}><Plus size={14} /> Add training record</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Driver</th>
                <th className="px-4 py-2.5 font-medium">Training</th>
                <th className="px-4 py-2.5 font-medium">Issued</th>
                <th className="px-4 py-2.5 font-medium">Expiry</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = credStatus(r.expiry)
                return (
                  <tr key={r.id} className={`cursor-pointer ${i % 2 ? 'bg-canvas/40' : ''} hover:bg-canvas`} onClick={() => openEdit(r)}>
                    <td className="px-4 py-2.5 font-medium text-navy">{r.driver_name}</td>
                    <td className="px-4 py-2.5 text-navy">{TRAINING_META[r.category] ?? r.category}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{r.issued || '—'}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{r.expiry || '—'}</td>
                    <td className="px-4 py-2.5"><StatusBadge tone={CRED_STATUS_META[st].tone}>{CRED_STATUS_META[st].label}</StatusBadge></td>
                    <td className="px-4 py-2.5">
                      {r.cert_file ? (
                        <button onClick={(e) => { e.stopPropagation(); view(r.cert_file) }} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> View <ExternalLink size={11} /></button>
                      ) : (
                        <span className="text-xs text-status-neutral">Missing</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <GraduationCap size={22} className="mx-auto mb-2 text-status-neutral" />
                  No training records yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Edit training record' : 'Add training record'}
        footer={
          <div className="flex w-full items-center justify-between">
            {editId && editable ? <Button variant="danger" onClick={del}>Delete</Button> : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        }
      >
        {error && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Driver</span>
            <select className={inputCls} value={form.driver_id} onChange={(e) => pickDriver(e.target.value)}>
              <option value="">Select driver…</option>
              {drivers.filter((d) => d.branch === branch).map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Training category</span>
            <select className={inputCls} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              <option value="">Select category…</option>
              {Object.entries(TRAINING_META).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Issued</span>
            <input type="date" className={inputCls} value={form.issued} onChange={(e) => setForm((f) => ({ ...f, issued: e.target.value }))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Expiry</span>
            <input type="date" className={inputCls} value={form.expiry} onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))} />
          </label>
        </div>

        <div className="mt-4">
          <span className="mb-1 block text-xs font-medium text-navy">Certificate</span>
          {form.cert_file ? (
            <button onClick={() => view(form.cert_file)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> {form.cert_file.file_name} <ExternalLink size={11} /></button>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs text-status-neutral hover:border-brand hover:text-brand"><UploadCloud size={14} /> Attach</button>
          )}
          <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
          {!form.cert_file && <p className="mt-1.5 text-xs text-[#8a6d10]">No certificate attached — training records should carry the issuing certificate.</p>}
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-navy">Notes</span>
          <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
      </Modal>
    </div>
  )
}
