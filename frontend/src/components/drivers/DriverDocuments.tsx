import { useState } from 'react'
import { UploadCloud, FileText, ExternalLink, Trash2, Plus, FolderOpen } from 'lucide-react'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { useAuth } from '@/auth/AuthContext'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import { useDocuments, documentsStore } from '@/lib/documents/store'
import { CATEGORY_META, DRIVER_DOC_CATEGORIES, DOC_STATUS_META, docStatus, type DocCategory } from '@/lib/documents/types'
import type { Driver } from '@/lib/drivers/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

export default function DriverDocuments({ driver, canEdit }: { driver: Driver; canEdit: boolean }) {
  const { user } = useAuth()
  const allDocs = useDocuments()
  const docs = allDocs
    .filter((d) => d.entity_id === driver.id && !d.superseded)
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))

  const [showForm, setShowForm] = useState(false)
  const [category, setCategory] = useState<DocCategory>('driver_licence')
  const [title, setTitle] = useState('')
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const meta = CATEGORY_META[category]

  async function view(id: string, name: string) {
    if (!(await viewFile(id, name))) alert('No file attached to this record.')
  }

  function remove(id: string, label: string) {
    if (confirm(`Remove ${label}? This cannot be undone.`)) documentsStore.remove(id)
  }

  async function save() {
    if (!file) return setError('Attach the document file (PDF or image).')
    if (meta.expiry && !expiry) return setError('Expiry date is required for this document.')
    if (meta.multi && !title.trim()) return setError('Give this training/certificate a name.')
    setSaving(true)
    try {
      const fileId = `${driver.id}_${category}_${Date.now()}`.replace(/\s/g, '')
      await putFile(fileId, file)
      const input = {
        category,
        title: meta.multi ? title.trim() : undefined,
        entity_type: 'driver' as const,
        entity_id: driver.id,
        entity_label: driver.full_name,
        branch: driver.branch,
        issue_date: '',
        expiry_date: meta.expiry ? expiry : '',
        reference_no: '',
        issuer: '',
        file_id: fileId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        notes: '',
        uploaded_by_role: user!.role,
      }
      if (meta.multi) documentsStore.add(input)
      else documentsStore.addVersion(input) // renewal supersedes the prior of this category
      setShowForm(false); setFile(null); setTitle(''); setExpiry(''); setCategory('driver_licence'); setError('')
    } finally {
      setSaving(false)
    }
  }

  function docLabel(d: (typeof docs)[number]) {
    const base = CATEGORY_META[d.category].label
    return d.title ? `${base}: ${d.title}` : base
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-status-neutral">Documents &amp; certificates</span>
        {canEdit && !showForm && (
          <button onClick={() => setShowForm(true)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      {docs.length === 0 && !showForm && (
        <div className="flex flex-col items-center gap-1.5 rounded-lg bg-canvas px-4 py-6 text-center text-status-neutral">
          <FolderOpen size={20} />
          <p className="text-sm">No documents on file yet.</p>
        </div>
      )}

      {docs.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-left text-sm">
            <tbody>
              {docs.map((d) => {
                const cmeta = CATEGORY_META[d.category]
                const st = docStatus(d)
                return (
                  <tr key={d.id} className="border-b border-black/5 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium text-navy">{docLabel(d)}</div>
                      <div className="text-[11px] text-status-neutral">
                        Uploaded by {d.uploaded_by} · {new Date(d.uploaded_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {cmeta.expiry && (
                        <div className="flex flex-col items-start gap-0.5">
                          <StatusBadge tone={DOC_STATUS_META[st].tone}>{DOC_STATUS_META[st].label}</StatusBadge>
                          <span className="text-[11px] text-status-neutral">exp {d.expiry_date || '—'}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => view(d.file_id, d.file_name)} className="inline-flex items-center gap-1 text-brand hover:underline">
                          <FileText size={13} /> View <ExternalLink size={10} />
                        </button>
                        {canEdit && (
                          <button onClick={() => remove(d.id, docLabel(d))} className="rounded p-1 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical" title="Remove">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && showForm && (
        <div className="mt-3 rounded-xl border border-black/10 bg-canvas/50 p-4">
          {error && <div className="mb-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-navy">Document type</span>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as DocCategory)}>
                {DRIVER_DOC_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
              </select>
            </label>
            {meta.multi && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Name *</span>
                <input className={inputCls} placeholder="e.g. First Aid, TATA OEM" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
            )}
            {meta.expiry && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Expiry date *</span>
                <input type="date" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </label>
            )}
          </div>

          <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-navy/20 bg-white px-4 py-5 text-center hover:border-brand">
            <UploadCloud size={20} className="text-brand" />
            <span className="text-sm font-medium text-navy">{file ? file.name : 'Attach document (required)'}</span>
            <span className="text-xs text-status-neutral">PDF, JPG or PNG</span>
            <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError('') }} />
          </label>

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setShowForm(false); setError('') }}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save document'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
