import { useEffect, useState, type ReactNode } from 'react'
import { FileText, ExternalLink, UploadCloud, Check, X, Send, Trash2, History, ShieldCheck, Globe, Lock, Share2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import type { RoleKey, BranchCode } from '@/lib/roles'
import { useBranches } from '@/lib/roles'
import { useVehicles } from '@/lib/fleet/store'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import { useDocuments, documentsStore } from '@/lib/documents/store'
import ShareModal from './ShareModal'
import {
  type DocumentRecord, docStatus, DOC_STATUS_META, APPROVAL_STATUS_META, AUDIT_LABEL,
  approvalOf, typeLabelOf, displayNameOf, departmentOf, visibilityOf, canManageDoc,
} from '@/lib/documents/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-status-neutral">{label}</div>
      <div className="text-sm text-navy">{children || '—'}</div>
    </div>
  )
}

/** Full document record: metadata, version history, audit trail and the approval workflow. */
export default function DocumentDetailModal({
  doc, open, onClose, canApprove, role, userId, branch, canToggle,
}: {
  doc: DocumentRecord | null
  open: boolean
  onClose: () => void
  canApprove: boolean
  role: RoleKey
  userId: string
  branch: BranchCode
  canToggle: boolean
}) {
  const all = useDocuments()
  const branches = useBranches()
  const vehicles = useVehicles()
  const [note, setNote] = useState('')
  const [showNewVer, setShowNewVer] = useState(false)
  const [nvFile, setNvFile] = useState<File | null>(null)
  const [nvIssue, setNvIssue] = useState('')
  const [nvExpiry, setNvExpiry] = useState('')
  const [nvReview, setNvReview] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => {
    if (open) { setNote(''); setShowNewVer(false); setNvFile(null); setNvIssue(''); setNvExpiry(''); setNvReview(''); setErr(''); setShareOpen(false) }
  }, [open, doc?.id])

  if (!doc) return null

  // Resolve the live family (stays current after every action) from the store.
  const versions = all
    .filter((d) => d.entity_id === doc.entity_id && d.category === doc.category)
    .sort((a, b) => b.version - a.version)
  const current = versions.find((v) => !v.superseded) ?? versions[0] ?? doc
  const st = docStatus(current)
  const appr = approvalOf(current)
  const vis = visibilityOf(current)
  const canManage = canManageDoc(current, { userId, role, branch, canToggle })
  const canDelete = role === 'administrator' || current.owner_id === userId
  const branchLabel = current.all_branches ? 'Company-wide' : (branches.find((b) => b.code === current.branch)?.short ?? current.branch)
  const isEntity = current.entity_type !== 'general'
  const reg = current.entity_type === 'vehicle'
    ? (vehicles.find((v) => v.id === current.entity_id || v.fleet_no === current.entity_label)?.reg_plate ?? '')
    : ''

  // Combined audit trail across all versions, newest first.
  const trail = versions
    .flatMap((v) => (v.audit ?? []).map((e) => ({ ...e, version: v.version })))
    .sort((a, b) => b.at.localeCompare(a.at))

  async function view(fileId: string, name: string) {
    if (!(await viewFile(fileId, name))) alert('No file attached to this record (sample data).')
  }

  function act(fn: () => void) { fn(); setNote('') }

  async function saveNewVersion() {
    if (!nvFile) return setErr('Attach the new file.')
    setBusy(true)
    try {
      const fileId = `doc_${current.entity_id}_${Date.now()}`
      await putFile(fileId, nvFile)
      documentsStore.addVersion({
        category: current.category, title: current.title, entity_type: current.entity_type,
        entity_id: current.entity_id, entity_label: current.entity_label, branch: current.branch,
        issue_date: nvIssue || current.issue_date, expiry_date: nvExpiry || current.expiry_date,
        reference_no: current.reference_no, issuer: current.issuer,
        file_id: fileId, file_name: nvFile.name, file_size: nvFile.size, mime_type: nvFile.type,
        notes: current.notes, uploaded_by_role: role,
        doc_type: current.doc_type, department: current.department, owner: current.owner,
        tags: current.tags, review_date: nvReview || current.review_date, all_branches: current.all_branches,
        approval_status: 'pending',
      })
      setShowNewVer(false); setNvFile(null); setNvIssue(''); setNvExpiry(''); setNvReview('')
    } finally { setBusy(false) }
  }

  function del() {
    if (!confirm(`Delete "${displayNameOf(current)}" and all ${versions.length} version(s)? This cannot be undone.`)) return
    documentsStore.removeFamily(current.entity_id, current.category)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEntity ? `${current.entity_label} — ${typeLabelOf(current)}` : displayNameOf(current)}
      subtitle={`${typeLabelOf(current)} · ${departmentOf(current)} · ${branchLabel}`}
    >
      {/* Status + lifecycle */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={APPROVAL_STATUS_META[appr].tone}>{APPROVAL_STATUS_META[appr].label}</StatusBadge>
        <StatusBadge tone={DOC_STATUS_META[st].tone}>{DOC_STATUS_META[st].label}</StatusBadge>
        <span className="rounded-full border border-black/10 bg-white px-2.5 py-0.5 text-xs text-status-neutral">Version {current.version}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-0.5 text-xs text-status-neutral">
          {vis === 'public' ? <><Globe size={12} /> Public</> : <><Lock size={12} /> Private</>}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {canManage && <button onClick={() => setShareOpen(true)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><Share2 size={14} /> Share</button>}
          {current.file_id
            ? <button onClick={() => view(current.file_id, current.file_name)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> View file <ExternalLink size={11} /></button>
            : <span className="text-xs text-status-neutral">No file attached (sample)</span>}
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {isEntity && <Field label={current.entity_type === 'vehicle' ? 'Vehicle' : 'Driver'}>{current.entity_label}{reg ? ` · ${reg}` : ''}</Field>}
        <Field label="Owner">{current.owner}</Field>
        <Field label="Reference">{current.reference_no}</Field>
        <Field label="Issuer">{current.issuer}</Field>
        <Field label="Issued">{current.issue_date}</Field>
        <Field label="Expires">{current.expiry_date}</Field>
        <Field label="Next review">{current.review_date}</Field>
        <Field label="Uploaded by">{current.uploaded_by}</Field>
        <Field label="Uploaded at">{current.uploaded_at?.slice(0, 16).replace('T', ' ')}</Field>
        <Field label="Access">{vis === 'public' ? 'Public' : `Private · ${current.shared_with?.length ?? 0} ${(current.shared_with?.length ?? 0) === 1 ? 'person' : 'people'}`}</Field>
      </div>
      {current.tags && current.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {current.tags.map((t) => <span key={t} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-status-neutral">#{t}</span>)}
        </div>
      )}
      {current.notes && <p className="mt-3 rounded-lg bg-canvas/60 px-3 py-2 text-sm text-navy">{current.notes}</p>}

      {/* Workflow actions */}
      {(canManage || canApprove) && (
        <div className="mt-4 rounded-xl border border-black/10 bg-canvas/40 p-3">
          {err && <div className="mb-2 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{err}</div>}
          {(appr === 'pending' && canApprove) && (
            <>
              <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (optional)…" />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => act(() => documentsStore.approve(current.id, note))}><Check size={14} /> Approve</Button>
                <Button variant="danger" onClick={() => act(() => documentsStore.reject(current.id, note))}><X size={14} /> Reject</Button>
              </div>
            </>
          )}
          {(appr === 'draft' && canManage) && (
            <Button onClick={() => act(() => documentsStore.submit(current.id, note))}><Send size={14} /> Submit for approval</Button>
          )}
          {(appr === 'rejected' && canManage) && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-status-critical">This document was rejected.</span>
              <Button onClick={() => act(() => documentsStore.submit(current.id, note))}><Send size={14} /> Re-submit</Button>
            </div>
          )}
          {(appr === 'approved') && (
            <p className="flex items-center gap-1.5 text-sm text-status-good"><ShieldCheck size={15} /> Approved and in force.</p>
          )}

          {canManage && (
            <div className="mt-3 border-t border-black/10 pt-3">
              {!showNewVer ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setShowNewVer(true)}><UploadCloud size={14} /> Upload new version</Button>
                  {canDelete && <Button variant="danger" onClick={del}><Trash2 size={14} /> Delete</Button>}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="block"><span className="mb-1 block text-xs text-navy">Issue date</span><input type="date" className={inputCls} value={nvIssue} onChange={(e) => setNvIssue(e.target.value)} /></label>
                    <label className="block"><span className="mb-1 block text-xs text-navy">Expiry date</span><input type="date" className={inputCls} value={nvExpiry} onChange={(e) => setNvExpiry(e.target.value)} /></label>
                    <label className="block"><span className="mb-1 block text-xs text-navy">Next review</span><input type="date" className={inputCls} value={nvReview} onChange={(e) => setNvReview(e.target.value)} /></label>
                  </div>
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-navy/20 bg-white px-4 py-4 text-center hover:border-brand">
                    <UploadCloud size={18} className="text-brand" />
                    <span className="text-sm font-medium text-navy">{nvFile ? nvFile.name : 'Attach new file'}</span>
                    <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" className="hidden" onChange={(e) => { setNvFile(e.target.files?.[0] ?? null); setErr('') }} />
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setShowNewVer(false)}>Cancel</Button>
                    <Button onClick={saveNewVersion} disabled={busy}>{busy ? 'Saving…' : 'Save new version'}</Button>
                  </div>
                  <p className="text-xs text-status-neutral">The current version is kept as history; the new one goes back to pending approval.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Version history */}
      {versions.length > 1 && (
        <div className="mt-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-navy"><History size={14} /> Version history</h4>
          <div className="space-y-1">
            {versions.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm">
                <span className="font-medium text-navy">v{v.version}</span>
                {!v.superseded && <StatusBadge tone="good">Current</StatusBadge>}
                <span className="text-status-neutral">{v.uploaded_by} · {v.uploaded_at?.slice(0, 10)}</span>
                {v.file_id && <button onClick={() => view(v.file_id, v.file_name)} className="ml-auto inline-flex items-center gap-1 text-brand hover:underline"><FileText size={13} /> View</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit trail */}
      <div className="mt-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-navy"><ShieldCheck size={14} /> Audit trail</h4>
        <ol className="space-y-1.5 border-l-2 border-black/10 pl-4">
          {trail.map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[1.30rem] top-1.5 h-2 w-2 rounded-full bg-brand" />
              <span className="font-medium text-navy">{AUDIT_LABEL[e.action]}</span>
              <span className="text-status-neutral"> — {e.by} · {e.at.slice(0, 16).replace('T', ' ')} · v{e.version}</span>
              {e.note && <div className="text-status-neutral">“{e.note}”</div>}
            </li>
          ))}
        </ol>
      </div>

      <ShareModal doc={current} open={shareOpen} onClose={() => setShareOpen(false)} />
    </Modal>
  )
}
