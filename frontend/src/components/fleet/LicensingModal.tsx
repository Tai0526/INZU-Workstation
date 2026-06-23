import { useState } from 'react'
import { UploadCloud, FileText, ExternalLink, AlertTriangle, History } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { useAuth } from '@/auth/AuthContext'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import { useDocuments, documentsStore } from '@/lib/documents/store'
import { CATEGORY_META, DOC_STATUS_META, docStatus, type DocCategory } from '@/lib/documents/types'
import type { Vehicle } from '@/lib/fleet/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

function fmt(d: string) {
  return d || '—'
}

export default function LicensingModal({
  open,
  onClose,
  vehicle,
  category,
  canEdit,
}: {
  open: boolean
  onClose: () => void
  vehicle: Vehicle | null
  category: DocCategory | null
  canEdit: boolean
}) {
  const { user } = useAuth()
  const allDocs = useDocuments()
  const [file, setFile] = useState<File | null>(null)
  const [issue, setIssue] = useState('')
  const [expiry, setExpiry] = useState('')
  const [ref, setRef] = useState('')
  const [issuer, setIssuer] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Reset the form whenever opened for a different cell.
  const cellKey = (vehicle?.id ?? '') + (category ?? '') + String(open)
  const [lastKey, setLastKey] = useState('')
  if (open && cellKey !== lastKey) {
    setFile(null); setIssue(''); setExpiry(''); setRef(''); setIssuer(''); setNotes(''); setError('')
    setLastKey(cellKey)
    const hasCurrent = !!(vehicle && category && documentsStore.currentFor(vehicle.id, category))
    setShowForm(!hasCurrent) // open straight into the form if nothing exists yet
  }

  if (!vehicle || !category) return null
  const meta = CATEGORY_META[category]
  const history = allDocs
    .filter((d) => d.entity_id === vehicle.id && d.category === category)
    .sort((a, b) => b.version - a.version)
  const current = history.find((d) => !d.superseded)
  const isExpired = current && docStatus(current) === 'expired'

  async function save() {
    if (!file) return setError('A document file is required — attach the scan or photo before saving.')
    if (!expiry) return setError('Expiry date is required.')
    setSaving(true)
    try {
      const fileId = `${vehicle!.id}_${category}_${Date.now()}`.replace(/\s/g, '')
      await putFile(fileId, file)
      documentsStore.addVersion({
        category: category!,
        entity_type: 'vehicle',
        entity_id: vehicle!.id,
        entity_label: vehicle!.fleet_no,
        branch: vehicle!.branch,
        issue_date: issue,
        expiry_date: expiry,
        reference_no: ref,
        issuer,
        file_id: fileId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        notes,
        uploaded_by_role: user!.role,
      })
      setShowForm(false)
      setFile(null); setIssue(''); setExpiry(''); setRef(''); setIssuer(''); setNotes('')
    } finally {
      setSaving(false)
    }
  }

  async function view(fileId: string, name: string) {
    const ok = await viewFile(fileId, name)
    if (!ok) alert('No file attached to this record (sample data).')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`${meta.label} — ${vehicle.fleet_no}`}
      subtitle={`${vehicle.reg_plate} · every licensing record keeps the attached document on file.`}
    >
      {/* Renewal-required banner */}
      {isExpired && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">
          <AlertTriangle size={16} /> This document has expired — upload the renewed document to restore compliance.
        </div>
      )}

      {/* History / versions */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">
          <History size={13} /> Records ({history.length})
        </div>
        {history.length === 0 ? (
          <p className="rounded-lg bg-canvas px-3 py-4 text-center text-sm text-status-neutral">
            No {meta.label.toLowerCase()} on file yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-navy text-white">
                <tr>
                  <th className="px-3 py-2 font-medium">Ver</th>
                  <th className="px-3 py-2 font-medium">Issued</th>
                  <th className="px-3 py-2 font-medium">Expires</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Document</th>
                </tr>
              </thead>
              <tbody>
                {history.map((d) => {
                  const st = docStatus(d)
                  return (
                    <tr key={d.id} className="border-t border-black/5">
                      <td className="px-3 py-2 text-status-neutral">v{d.version}</td>
                      <td className="px-3 py-2 text-navy">{fmt(d.issue_date)}</td>
                      <td className="px-3 py-2 text-navy">{fmt(d.expiry_date)}</td>
                      <td className="px-3 py-2"><StatusBadge tone={DOC_STATUS_META[st].tone}>{DOC_STATUS_META[st].label}</StatusBadge></td>
                      <td className="px-3 py-2">
                        <button onClick={() => view(d.file_id, d.file_name)} className="inline-flex items-center gap-1 text-brand hover:underline">
                          <FileText size={14} /> View <ExternalLink size={11} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload form */}
      {canEdit && !showForm && (
        <Button onClick={() => setShowForm(true)}>
          <UploadCloud size={15} /> {current ? 'Upload renewal' : `Add ${meta.label}`}
        </Button>
      )}

      {canEdit && showForm && (
        <div className="rounded-xl border border-black/10 bg-canvas/50 p-4">
          <div className="mb-3 font-display text-sm font-bold text-navy">
            {current ? 'Upload renewed document' : `Add ${meta.label}`}
          </div>
          {error && (
            <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Issue date</span>
              <input type="date" className={inputCls} value={issue} onChange={(e) => setIssue(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Expiry date *</span>
              <input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Reference no.</span>
              <input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Issuer</span>
              <input className={inputCls} value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </label>
          </div>

          <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-navy/20 bg-white px-4 py-6 text-center hover:border-brand">
            <UploadCloud size={22} className="text-brand" />
            <span className="text-sm font-medium text-navy">{file ? file.name : 'Attach document (required)'}</span>
            <span className="text-xs text-status-neutral">PDF, JPG or PNG — scan or photo of the actual document</span>
            <input
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError('') }}
            />
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setShowForm(false); setError('') }}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save document'}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
