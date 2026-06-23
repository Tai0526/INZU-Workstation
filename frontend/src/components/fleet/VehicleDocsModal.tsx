import { useState } from 'react'
import { UploadCloud, FileText, ExternalLink, AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { useAuth } from '@/auth/AuthContext'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import { useDocuments, documentsStore } from '@/lib/documents/store'
import { CATEGORY_META, LICENSING_CATEGORIES, DOC_STATUS_META, docStatus, type DocCategory } from '@/lib/documents/types'
import type { Vehicle } from '@/lib/fleet/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

/** All required documents for one vehicle — see each one and upload / renew it. */
export default function VehicleDocsModal({ vehicle, open, onClose, canEdit }: { vehicle: Vehicle | null; open: boolean; onClose: () => void; canEdit: boolean }) {
  const { user } = useAuth()
  const docs = useDocuments()
  const [formCat, setFormCat] = useState<DocCategory | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [issue, setIssue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [ref, setRef] = useState('')
  const [issuer, setIssuer] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [seen, setSeen] = useState('')
  if (open && vehicle && seen !== vehicle.id) { setSeen(vehicle.id); setFormCat(null) }
  if (!open && seen) setSeen('')
  if (!vehicle) return null

  const currentFor = (cat: DocCategory) => docs.find((d) => d.entity_id === vehicle.id && d.category === cat && !d.superseded)

  function openForm(cat: DocCategory) {
    setFormCat(cat); setFile(null); setIssue(''); setExpiry(''); setRef(''); setIssuer(''); setError('')
  }
  async function save() {
    if (!formCat) return
    if (!file) return setError('Attach the document scan or photo before saving.')
    if (!expiry) return setError('Expiry date is required.')
    setSaving(true)
    try {
      const fileId = `${vehicle!.id}_${formCat}_${Date.now()}`.replace(/\s/g, '')
      await putFile(fileId, file)
      documentsStore.addVersion({
        category: formCat, entity_type: 'vehicle', entity_id: vehicle!.id, entity_label: vehicle!.fleet_no, branch: vehicle!.branch,
        issue_date: issue, expiry_date: expiry, reference_no: ref, issuer, file_id: fileId, file_name: file.name, file_size: file.size, mime_type: file.type, notes: '', uploaded_by_role: user!.role,
      })
      setFormCat(null)
    } finally { setSaving(false) }
  }
  async function view(fileId: string, name: string) {
    if (!(await viewFile(fileId, name))) alert('No file attached to this record (sample data).')
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Documents — ${vehicle.fleet_no}`} subtitle={`${vehicle.reg_plate} · ${vehicle.make} ${vehicle.model}`}>
      <div className="space-y-2">
        {LICENSING_CATEGORIES.map((cat) => {
          const cur = currentFor(cat)
          const st = cur ? docStatus(cur) : null
          const meta = CATEGORY_META[cat]
          return (
            <div key={cat} className="rounded-xl border border-black/10 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-sm font-semibold text-navy">{meta.label}</span>
                {cur && st ? <StatusBadge tone={DOC_STATUS_META[st].tone}>{DOC_STATUS_META[st].label}</StatusBadge>
                  : <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-status-critical/50 bg-status-critical/5 px-2 py-0.5 text-xs font-medium text-status-critical"><AlertTriangle size={12} /> Missing</span>}
                {cur && cur.file_id && <button onClick={() => view(cur.file_id, cur.file_name)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> View <ExternalLink size={11} /></button>}
                {canEdit && formCat !== cat && (
                  <Button variant="secondary" onClick={() => openForm(cat)}><UploadCloud size={14} /> {cur ? 'Renew' : 'Upload'}</Button>
                )}
              </div>
              {cur && <div className="mt-1 text-xs text-status-neutral">Expires {cur.expiry_date || '—'}{cur.reference_no ? ` · Ref ${cur.reference_no}` : ''}{cur.issuer ? ` · ${cur.issuer}` : ''}</div>}

              {canEdit && formCat === cat && (
                <div className="mt-3 rounded-lg border border-black/10 bg-canvas/50 p-3">
                  {error && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Issue date</span><input type="date" className={inputCls} value={issue} onChange={(e) => setIssue(e.target.value)} /></label>
                    <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Expiry date *</span><input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
                    <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Reference no.</span><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} /></label>
                    <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Issuer</span><input className={inputCls} value={issuer} onChange={(e) => setIssuer(e.target.value)} /></label>
                  </div>
                  <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-navy/20 bg-white px-4 py-5 text-center hover:border-brand">
                    <UploadCloud size={20} className="text-brand" />
                    <span className="text-sm font-medium text-navy">{file ? file.name : 'Attach document (required)'}</span>
                    <span className="text-xs text-status-neutral">PDF, JPG or PNG</span>
                    <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError('') }} />
                  </label>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setFormCat(null)}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save document'}</Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!canEdit && <p className="mt-3 text-xs text-status-neutral">View only — uploads are done by Workshop.</p>}
    </Modal>
  )
}
