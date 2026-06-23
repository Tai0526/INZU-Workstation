import { useMemo, useRef, useState } from 'react'
import { Plus, Search, CheckCircle2, Circle, UploadCloud, FileText, ExternalLink, ClipboardCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import StatusBadge from '@/components/ui/StatusBadge'
import KpiCard from '@/components/ui/KpiCard'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import {
  useCap, capStore, CAP_STATUS_META, capProgress,
  type CapFinding, type CapStatus, type CapAction, type SafetyFile,
} from '@/lib/safety/registers'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

interface Draft {
  ref: string
  title: string
  description: string
  owner: string
  target_date: string
  status: CapStatus
  actionsText: string
}
const EMPTY_DRAFT: Draft = { ref: '', title: '', description: '', owner: '', target_date: '', status: 'open', actionsText: '' }

export default function CapTracker() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const editable = canEdit(role, 'safety')

  const all = useCap()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | CapStatus>('all')
  const [editId, setEditId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [err, setErr] = useState('')

  const branchRows = useMemo(() => all.filter((f) => f.branch === branch), [all, branch])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return branchRows
      .filter((f) => status === 'all' || f.status === status)
      .filter((f) => !term || [f.ref, f.title, f.owner].some((v) => v.toLowerCase().includes(term)))
      .sort((a, b) => a.ref.localeCompare(b.ref))
  }, [branchRows, q, status])

  const counts = useMemo(() => ({
    open: branchRows.filter((f) => f.status === 'open').length,
    in_progress: branchRows.filter((f) => f.status === 'in_progress').length,
    compliant: branchRows.filter((f) => f.status === 'compliant').length,
  }), [branchRows])

  const kpis = useMemo(() => {
    const total = branchRows.length
    const compliant = counts.compliant
    const overdue = branchRows.filter((f) => f.status !== 'compliant' && f.target_date && new Date(f.target_date) < new Date()).length
    return {
      total,
      compliant,
      in_progress: counts.in_progress,
      overdue,
      pct: total ? Math.round((compliant / total) * 100) : 0,
    }
  }, [branchRows, counts])

  const editing = editId ? all.find((f) => f.id === editId) ?? null : null

  function openAdd() {
    setErr('')
    setEditId(null)
    setDraft(EMPTY_DRAFT)
    setAdding(true)
  }
  function openEdit(f: CapFinding) {
    setErr('')
    setAdding(false)
    setEditId(f.id)
    setDraft({
      ref: f.ref,
      title: f.title,
      description: f.description,
      owner: f.owner,
      target_date: f.target_date,
      status: f.status,
      actionsText: f.actions.map((a) => a.text).join('\n'),
    })
  }
  function closeModal() {
    setAdding(false)
    setEditId(null)
    setErr('')
  }

  function save() {
    if (!draft.ref.trim() || !draft.title.trim()) {
      setErr('Reference and title are required.')
      return
    }
    const lines = draft.actionsText.split('\n').map((l) => l.trim()).filter(Boolean)
    const actions: CapAction[] = lines.map((text, i) => ({
      id: editing?.actions[i]?.id ?? `act_${Date.now()}_${i}`,
      text,
      done: editing?.actions[i]?.done ?? false,
    }))
    const patch = {
      ref: draft.ref.trim(),
      title: draft.title.trim(),
      description: draft.description.trim(),
      owner: draft.owner.trim(),
      target_date: draft.target_date,
      status: draft.status,
      actions,
    }
    if (editing) {
      capStore.update(editing.id, patch)
    } else {
      capStore.add({ branch, evidence: null, notes: '', ...patch })
    }
    closeModal()
  }

  function remove() {
    if (editing && window.confirm(`Delete finding ${editing.ref}? This cannot be undone.`)) {
      capStore.remove(editing.id)
      closeModal()
    }
  }

  function toggleAction(f: CapFinding, id: string) {
    if (!editable) return
    capStore.update(f.id, { actions: f.actions.map((a) => (a.id === id ? { ...a, done: !a.done } : a)) })
  }

  function setStatusFor(f: CapFinding, next: CapStatus) {
    if (next === 'compliant' && !(f.evidence && f.actions.every((a) => a.done))) {
      window.alert('Attach evidence and complete all sub-actions before marking compliant.')
      return
    }
    capStore.update(f.id, { status: next })
  }

  async function attach(f: CapFinding, file: File) {
    const fileId = `${f.id}_evi_${Date.now()}`
    await putFile(fileId, file)
    const evidence: SafetyFile = { file_id: fileId, file_name: file.name }
    capStore.update(f.id, { evidence })
  }

  const modalOpen = adding || !!editId

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        The corrective-action plan from the FQM Trident OHS audit. Every finding needs its sub-actions completed and
        evidence attached before it is compliant.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total findings" value={kpis.total} sub={`${kpis.pct}% compliant`} />
        <KpiCard label="Compliant" value={kpis.compliant} tone="good" />
        <KpiCard label="In progress" value={kpis.in_progress} tone="warning" />
        <KpiCard label="Open / overdue" value={kpis.overdue} tone="critical" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, title, owner…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All findings</option>
          <option value="open">Open ({counts.open})</option>
          <option value="in_progress">In progress ({counts.in_progress})</option>
          <option value="compliant">Compliant ({counts.compliant})</option>
        </select>
        {editable && <Button onClick={openAdd}><Plus size={14} /> Add finding</Button>}
      </div>

      <div className="space-y-3">
        {rows.map((f) => {
          const done = f.actions.filter((a) => a.done).length
          const pct = Math.round(capProgress(f) * 100)
          return (
            <div key={f.id} className="card p-5 space-y-3">
              <div className="flex flex-wrap items-start gap-2">
                <span className="rounded bg-navy/5 px-2 py-0.5 text-xs font-bold text-navy">{f.ref}</span>
                <div className="font-display font-bold text-navy">{f.title}</div>
                <StatusBadge tone={CAP_STATUS_META[f.status].tone} className="ml-auto">{CAP_STATUS_META[f.status].label}</StatusBadge>
              </div>

              <div className="text-xs text-status-neutral">
                {f.owner || 'Unassigned'}{f.target_date ? ` · Target ${f.target_date}` : ''}
              </div>

              {f.description && <p className="text-sm text-navy">{f.description}</p>}

              <div>
                <div className="h-2 rounded bg-black/10">
                  <div className={`h-2 rounded ${pct === 100 ? 'bg-status-good' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-xs text-status-neutral">{done}/{f.actions.length} actions</div>
              </div>

              {f.actions.length > 0 && (
                <ul className="space-y-1.5">
                  {f.actions.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-sm">
                      <button
                        onClick={() => toggleAction(f, a.id)}
                        disabled={!editable}
                        className={`mt-0.5 shrink-0 ${editable ? 'cursor-pointer' : 'cursor-default'} ${a.done ? 'text-status-good' : 'text-status-neutral'}`}
                      >
                        {a.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                      </button>
                      <span className={a.done ? 'text-status-neutral line-through' : 'text-navy'}>{a.text}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {f.evidence ? (
                  <button onClick={() => viewFile(f.evidence!.file_id, f.evidence!.file_name)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
                    <FileText size={14} /> {f.evidence.file_name} <ExternalLink size={11} />
                  </button>
                ) : editable ? (
                  <EvidenceButton onPick={(file) => attach(f, file)} />
                ) : (
                  <span className="text-xs text-status-neutral">No evidence attached</span>
                )}

                {editable && (
                  <div className="ml-auto flex items-center gap-2">
                    <label className="text-xs text-status-neutral" htmlFor={`st-${f.id}`}>Status</label>
                    <select
                      id={`st-${f.id}`}
                      value={f.status}
                      onChange={(e) => setStatusFor(f, e.target.value as CapStatus)}
                      className="rounded-lg border border-black/15 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-brand"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="compliant">Compliant</option>
                    </select>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(f)}>Edit</Button>
                    <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => { if (window.confirm(`Delete finding ${f.ref}? This cannot be undone.`)) capStore.remove(f.id) }}>Delete</Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {rows.length === 0 && (
          <div className="card p-12 text-center text-sm text-status-neutral">
            <ClipboardCheck size={22} className="mx-auto mb-2 text-status-neutral" />
            No corrective-action findings match. {editable ? 'Add a finding to start tracking the audit close-out.' : ''}
          </div>
        )}
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? `Edit ${editing.ref}` : 'Add corrective-action finding'}
        subtitle="FQM Trident OHS audit"
        footer={
          <div className="flex w-full items-center justify-between">
            {editing && editable
              ? <Button variant="danger" onClick={remove}>Delete</Button>
              : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={closeModal}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        }
      >
        {err && <p className="mb-3 text-sm text-status-critical">{err}</p>}
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Reference</span>
              <input className={inputCls} value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} placeholder="CAP-13" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Owner</span>
              <input className={inputCls} value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Safety Officer" />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Title</span>
            <input className={inputCls} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Description</span>
            <textarea className={inputCls} rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Target date</span>
              <input type="date" className={inputCls} value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Status</span>
              <select className={inputCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as CapStatus })}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="compliant">Compliant</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Sub-actions (one per line)</span>
            <textarea className={inputCls} rows={4} value={draft.actionsText} onChange={(e) => setDraft({ ...draft, actionsText: e.target.value })} placeholder={'Draft policy\nBrief crews\nLog evidence'} />
          </label>
        </div>
      </Modal>
    </div>
  )
}

function EvidenceButton({ onPick }: { onPick: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button onClick={() => ref.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs text-status-neutral hover:border-brand hover:text-brand">
        <UploadCloud size={14} /> Attach evidence
      </button>
      <input ref={ref} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
    </>
  )
}
