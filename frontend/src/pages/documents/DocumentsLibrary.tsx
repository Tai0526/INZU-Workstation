import { useMemo, useState } from 'react'
import { Search, FileText, ExternalLink } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import StatusBadge from '@/components/ui/StatusBadge'
import { useDocuments } from '@/lib/documents/store'
import { viewFile } from '@/lib/storage/fileStore'
import { CATEGORY_META, DOC_STATUS_META, docStatus, type DocCategory, type DocStatus } from '@/lib/documents/types'

export default function DocumentsLibrary() {
  const { user } = useAuth()
  const branch = user!.branch
  const canToggle = ROLES[user!.role].canToggleBranch
  const all = useDocuments()

  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'all' | DocCategory>('all')
  const [status, setStatus] = useState<'all' | DocStatus>('all')
  const [showHistory, setShowHistory] = useState(false)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all
      .filter((d) => d.branch === branch)
      .filter((d) => (showHistory ? true : !d.superseded))
      .filter((d) => cat === 'all' || d.category === cat)
      .filter((d) => status === 'all' || docStatus(d) === status)
      .filter(
        (d) =>
          !term ||
          [d.entity_label, CATEGORY_META[d.category].label, d.reference_no, d.issuer, d.file_name].some((f) =>
            (f || '').toLowerCase().includes(term),
          ),
      )
      .sort((a, b) => (a.entity_label + a.category).localeCompare(b.entity_label + b.category) || b.version - a.version)
  }, [all, branch, q, cat, status, showHistory])

  async function view(fileId: string, name: string) {
    const ok = await viewFile(fileId, name)
    if (!ok) alert('No file attached to this record (sample data).')
  }

  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        Searchable library of every document on file for <span className="font-medium text-navy">{branchLabel}</span>.
        Licensing uploads flow in automatically — metadata comes from the record and the vehicle it belongs to.
      </p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vehicle, category, reference, issuer, file…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand"
          />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All categories</option>
          {(Object.keys(CATEGORY_META) as DocCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_META[c].label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All statuses</option>
          {(Object.keys(DOC_STATUS_META) as DocStatus[]).map((s) => (
            <option key={s} value={s}>{DOC_STATUS_META[s].label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Include history
        </label>
      </div>

      <div className="text-xs text-status-neutral">Showing <b className="text-navy">{rows.length}</b> document(s)</div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Subject</th>
                <th className="px-4 py-2.5 font-medium">Issued</th>
                <th className="px-4 py-2.5 font-medium">Expires</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Ver</th>
                <th className="px-4 py-2.5 font-medium">Document</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => {
                const st = docStatus(d)
                return (
                  <tr key={d.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                    <td className="px-4 py-2.5 font-medium text-navy">{CATEGORY_META[d.category].label}{d.title ? `: ${d.title}` : ''}</td>
                    <td className="px-4 py-2.5 text-navy">{d.entity_label}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{d.issue_date || '—'}</td>
                    <td className="px-4 py-2.5 text-status-neutral">{d.expiry_date || '—'}</td>
                    <td className="px-4 py-2.5"><StatusBadge tone={DOC_STATUS_META[st].tone}>{DOC_STATUS_META[st].label}</StatusBadge></td>
                    <td className="px-4 py-2.5 text-status-neutral">v{d.version}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => view(d.file_id, d.file_name)} className="inline-flex items-center gap-1 text-brand hover:underline">
                        <FileText size={14} /> View <ExternalLink size={11} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-status-neutral">No documents match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && (
        <p className="text-xs text-status-neutral">Showing {branchLabel} only — your role is locked to this branch.</p>
      )}
    </div>
  )
}
