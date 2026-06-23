import { useMemo, useState } from 'react'
import { Plus, Search, Wrench, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import StatusBadge from '@/components/ui/StatusBadge'
import KpiCard from '@/components/ui/KpiCard'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import {
  useTools, toolsStore, TOOL_CONDITION_META, inspectionDue, type ToolInspection, type ToolCondition,
} from '@/lib/safety/registers'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const CONDITIONS = Object.keys(TOOL_CONDITION_META) as ToolCondition[]

type Draft = Omit<ToolInspection, keyof import('@/lib/safety/registers').Audited | 'branch'>

const blankDraft = (): Draft => ({
  asset_tag: '', tool_name: '', category: '', condition: 'good', safe_to_use: true,
  last_inspection: '', next_inspection: '', inspector: '', notes: '',
})

export default function ToolInspections() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch
  const editable = canEdit(role, 'safety')

  const all = useTools()
  const [q, setQ] = useState('')
  const [condition, setCondition] = useState<'all' | ToolCondition>('all')
  const [editId, setEditId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [error, setError] = useState('')

  const branchTools = useMemo(() => all.filter((t) => t.branch === branch), [all, branch])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return branchTools
      .filter((t) => condition === 'all' || t.condition === condition)
      .filter((t) => !term || [t.asset_tag, t.tool_name, t.category].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => a.asset_tag.localeCompare(b.asset_tag))
  }, [branchTools, q, condition])

  const counts = useMemo(() => ({
    total: branchTools.length,
    good: branchTools.filter((t) => t.condition === 'good').length,
    fair: branchTools.filter((t) => t.condition === 'fair').length,
    defective: branchTools.filter((t) => t.condition === 'defective').length,
    due: branchTools.filter((t) => inspectionDue(t)).length,
    unsafe: branchTools.filter((t) => !t.safe_to_use).length,
  }), [branchTools])

  function openAdd() {
    setError('')
    setDraft(blankDraft())
    setAdding(true)
  }
  function openEdit(t: ToolInspection) {
    setError('')
    setDraft({
      asset_tag: t.asset_tag, tool_name: t.tool_name, category: t.category, condition: t.condition,
      safe_to_use: t.safe_to_use, last_inspection: t.last_inspection, next_inspection: t.next_inspection,
      inspector: t.inspector, notes: t.notes,
    })
    setEditId(t.id)
  }
  function close() {
    setAdding(false)
    setEditId(null)
  }
  function save() {
    if (!draft.asset_tag.trim() || !draft.tool_name.trim()) {
      setError('Asset tag and tool name are required.')
      return
    }
    if (editId) toolsStore.update(editId, draft)
    else toolsStore.add({ ...draft, branch })
    close()
  }
  function remove() {
    if (editId && window.confirm('Delete this tool record?')) {
      toolsStore.remove(editId)
      close()
    }
  }

  const open = adding || editId !== null
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <div className="page space-y-5">
      <p className="max-w-2xl text-sm text-status-neutral">
        Periodic inspection of hand tools and workshop equipment — condition, safe-to-use flag, and next inspection date.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total tools" value={counts.total} />
        <KpiCard label="Defective" value={counts.defective} tone="critical" />
        <KpiCard label="Due for inspection" value={counts.due} tone="warning" />
        <KpiCard label="Unsafe" value={counts.unsafe} tone="critical" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tag, tool, category…"
            className="w-full rounded-lg border border-black/15 bg-white py-2 pl-9 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        <select value={condition} onChange={(e) => setCondition(e.target.value as any)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand">
          <option value="all">All conditions</option>
          <option value="good">Good ({counts.good})</option>
          <option value="fair">Fair ({counts.fair})</option>
          <option value="defective">Defective ({counts.defective})</option>
        </select>
        {editable && <Button onClick={openAdd}><Plus size={14} /> Add tool</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy text-white">
              <tr>
                <th className="px-4 py-2.5 font-medium">Asset tag</th>
                <th className="px-4 py-2.5 font-medium">Tool</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Condition</th>
                <th className="px-4 py-2.5 font-medium">Safe to use</th>
                <th className="px-4 py-2.5 font-medium">Last</th>
                <th className="px-4 py-2.5 font-medium">Next</th>
                <th className="px-4 py-2.5 font-medium">Inspector</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id} className={`cursor-pointer ${i % 2 ? 'bg-canvas/40' : ''} hover:bg-canvas`} onClick={() => openEdit(t)}>
                  <td className="px-4 py-2.5 font-medium text-navy">{t.asset_tag}</td>
                  <td className="px-4 py-2.5 text-navy">{t.tool_name}</td>
                  <td className="px-4 py-2.5 text-status-neutral">{t.category}</td>
                  <td className="px-4 py-2.5"><StatusBadge tone={TOOL_CONDITION_META[t.condition].tone}>{TOOL_CONDITION_META[t.condition].label}</StatusBadge></td>
                  <td className="px-4 py-2.5">
                    {t.safe_to_use ? <span className="text-status-good">Yes</span> : <span className="font-medium text-status-critical">No</span>}
                  </td>
                  <td className="px-4 py-2.5 text-status-neutral">{t.last_inspection || '—'}</td>
                  <td className="px-4 py-2.5">
                    {inspectionDue(t)
                      ? <span className="font-medium text-status-critical">{t.next_inspection || '—'} <span className="text-xs">due</span></span>
                      : <span className="text-status-neutral">{t.next_inspection || '—'}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-status-neutral">{t.inspector}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-status-neutral">
                  <Wrench size={22} className="mx-auto mb-2 text-status-neutral" />
                  No tools recorded yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}

      <Modal
        open={open}
        onClose={close}
        title={editId ? 'Edit tool inspection' : 'Add tool'}
        footer={
          <>
            {editId && editable && <Button variant="danger" className="mr-auto" onClick={remove}>Delete</Button>}
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Asset tag</span>
            <input className={inputCls} value={draft.asset_tag} onChange={(e) => set('asset_tag', e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Tool name</span>
            <input className={inputCls} value={draft.tool_name} onChange={(e) => set('tool_name', e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Category</span>
            <input className={inputCls} value={draft.category} onChange={(e) => set('category', e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Condition</span>
            <select className={inputCls} value={draft.condition} onChange={(e) => set('condition', e.target.value as ToolCondition)}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{TOOL_CONDITION_META[c].label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={draft.safe_to_use} onChange={(e) => set('safe_to_use', e.target.checked)} />
            <span className="text-sm text-navy">Safe to use</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Last inspection</span>
            <input type="date" className={inputCls} value={draft.last_inspection} onChange={(e) => set('last_inspection', e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Next inspection</span>
            <input type="date" className={inputCls} value={draft.next_inspection} onChange={(e) => set('next_inspection', e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-navy">Inspector</span>
            <input className={inputCls} value={draft.inspector} onChange={(e) => set('inspector', e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-navy">Notes</span>
            <textarea className={inputCls} rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>
        {error && <p className="mt-3 flex items-center gap-1.5 text-xs text-status-critical"><AlertTriangle size={13} /> {error}</p>}
      </Modal>
    </div>
  )
}
