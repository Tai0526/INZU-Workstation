import { useEffect, useState } from 'react'
import { UploadCloud, Send, Save, Globe, Lock } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, useBranches } from '@/lib/roles'
import type { BranchCode, RoleKey } from '@/lib/roles'
import { useUsers } from '@/lib/auth/users'
import { putFile } from '@/lib/storage/fileStore'
import { documentsStore } from '@/lib/documents/store'
import { DOC_TYPE_META, DOC_TYPE_KEYS, DEPARTMENTS, type DocType, type ApprovalStatus, type DocVisibility } from '@/lib/documents/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const labelCls = 'mb-1 block text-xs font-medium text-navy'

function newFamilyId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `fam_${Date.now()}_${Math.round(Math.random() * 1e6)}`
}

/** Add a new document to the library (policies, SOPs, permits, IDs, contracts…). */
export default function UploadDocumentModal({ open, onClose, branch, role }: { open: boolean; onClose: () => void; branch: BranchCode; role: RoleKey }) {
  const { user } = useAuth()
  const branches = useBranches()
  const users = useUsers()

  const [docType, setDocType] = useState<DocType>('policy')
  const [title, setTitle] = useState('')
  const [department, setDepartment] = useState<string>('Operations')
  const [owner, setOwner] = useState('')
  const [allBranches, setAllBranches] = useState(false)
  const [visibility, setVisibility] = useState<DocVisibility>('public')
  const [shareIds, setShareIds] = useState<string[]>([])
  const [issue, setIssue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [review, setReview] = useState('')
  const [ref, setRef] = useState('')
  const [issuer, setIssuer] = useState('')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDocType('policy'); setTitle(''); setDepartment('Operations'); setOwner(''); setAllBranches(false)
      setVisibility('public'); setShareIds([])
      setIssue(''); setExpiry(''); setReview(''); setRef(''); setIssuer(''); setTags(''); setNotes('')
      setFile(null); setError(''); setSaving(false)
    }
  }, [open])

  const expires = DOC_TYPE_META[docType].expiry
  const shareable = users.filter((u) => u.active && u.id !== user?.id)

  async function save(approval_status: ApprovalStatus) {
    if (!title.trim()) return setError('Give the document a title.')
    if (!file) return setError('Attach the document file before saving.')
    setSaving(true)
    try {
      const familyId = newFamilyId()
      const fileId = `doc_${familyId}_${Date.now()}`
      await putFile(fileId, file)
      documentsStore.add({
        category: 'other',
        title: title.trim(),
        entity_type: 'general',
        entity_id: familyId,
        entity_label: allBranches ? 'Company-wide' : department,
        branch,
        issue_date: issue,
        expiry_date: expiry,
        reference_no: ref.trim(),
        issuer: issuer.trim(),
        file_id: fileId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        notes: notes.trim(),
        uploaded_by_role: role,
        doc_type: docType,
        department,
        owner: owner.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        review_date: review,
        all_branches: allBranches,
        approval_status,
        visibility,
        owner_id: user?.id ?? '',
        shared_with: visibility === 'private' ? shareIds.map((id) => ({ user_id: id, access: 'view' as const })) : [],
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const branchLabel = branches.find((b) => b.code === branch)?.short ?? branch

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add document to library"
      subtitle={`Filed by ${user?.fullName ?? 'you'} · ${allBranches ? 'Company-wide' : branchLabel}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="secondary" onClick={() => save('draft')} disabled={saving}><Save size={14} /> Save as draft</Button>
          <Button onClick={() => save('pending')} disabled={saving}><Send size={14} /> {saving ? 'Saving…' : 'Submit for approval'}</Button>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelCls}>Title *</span>
          <input className={inputCls} value={title} onChange={(e) => { setTitle(e.target.value); setError('') }} placeholder="e.g. Transport & Road Safety Policy" />
        </label>

        <label className="block">
          <span className={labelCls}>Type</span>
          <select className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPE_KEYS.map((t) => <option key={t} value={t}>{DOC_TYPE_META[t].label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Department</span>
          <select className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)}>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Owner / responsible</span>
          <input className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. Safety Manager" />
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} />
          <span className="text-sm text-navy">Company-wide (both branches)</span>
        </label>

        <label className="block">
          <span className={labelCls}>Issue date</span>
          <input type="date" className={inputCls} value={issue} onChange={(e) => setIssue(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Expiry date {expires ? '(recommended)' : ''}</span>
          <input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>

        <label className="block">
          <span className={labelCls}>Next review date</span>
          <input type="date" className={inputCls} value={review} onChange={(e) => setReview(e.target.value)} />
        </label>
        <label className="block">
          <span className={labelCls}>Reference no.</span>
          <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Policy / permit number" />
        </label>

        <label className="block">
          <span className={labelCls}>Issuer / authority</span>
          <input className={inputCls} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="e.g. RTSA, FQM" />
        </label>
        <label className="block">
          <span className={labelCls}>Tags (comma-separated)</span>
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="safety, driving, induction" />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelCls}>Notes</span>
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {/* Visibility / access */}
      <div className="mt-3">
        <span className={labelCls}>Who can see this?</span>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setVisibility('public')} className={`flex items-start gap-2 rounded-xl border p-3 text-left ${visibility === 'public' ? 'border-brand bg-brand-tint/40' : 'border-black/10 bg-white hover:bg-canvas'}`}>
            <Globe size={18} className="mt-0.5 text-brand" />
            <span><span className="block text-sm font-semibold text-navy">Public</span><span className="block text-xs text-status-neutral">Everyone in the library can view it.</span></span>
          </button>
          <button type="button" onClick={() => setVisibility('private')} className={`flex items-start gap-2 rounded-xl border p-3 text-left ${visibility === 'private' ? 'border-brand bg-brand-tint/40' : 'border-black/10 bg-white hover:bg-canvas'}`}>
            <Lock size={18} className="mt-0.5 text-brand" />
            <span><span className="block text-sm font-semibold text-navy">Private</span><span className="block text-xs text-status-neutral">Only you and the people you choose.</span></span>
          </button>
        </div>
        {visibility === 'private' && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-black/10 bg-white p-2">
            {shareable.length === 0 && <p className="px-1 text-sm text-status-neutral">No other users to share with yet.</p>}
            {shareable.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-canvas">
                <input
                  type="checkbox"
                  checked={shareIds.includes(u.id)}
                  onChange={(e) => setShareIds((ids) => e.target.checked ? [...ids, u.id] : ids.filter((x) => x !== u.id))}
                />
                <span className="text-sm text-navy">{u.full_name}</span>
                <span className="text-xs text-status-neutral">· {ROLES[u.role].label}</span>
              </label>
            ))}
            <p className="px-1 pt-1 text-[11px] text-status-neutral">Everyone here gets view access. You can grant edit and add more later via Share.</p>
          </div>
        )}
      </div>

      <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-navy/20 bg-white px-4 py-5 text-center hover:border-brand">
        <UploadCloud size={20} className="text-brand" />
        <span className="text-sm font-medium text-navy">{file ? file.name : 'Attach document (required)'}</span>
        <span className="text-xs text-status-neutral">PDF, Word, Excel, JPG or PNG</span>
        <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError('') }} />
      </label>

      <p className="mt-3 text-xs text-status-neutral">
        Save as draft to keep working on it, or submit for approval to send it to a manager. Either way it is logged with your name and the time for audit.
      </p>
    </Modal>
  )
}
