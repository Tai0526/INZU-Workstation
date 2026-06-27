import { useMemo, useState } from 'react'
import { Package, Plus, Minus, Pencil, Trash2, Search, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES, type BranchCode } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import { useSpares, sparesStore } from '@/lib/workshop/store'
import { type Spare, type SpareInput, spareLow } from '@/lib/workshop/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

export default function CriticalSpares() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canManage = canEdit(role, 'workshop')

  const spares = useSpares().filter((s) => s.branch === branch)
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ open: boolean; editing: Spare | null }>({ open: false, editing: null })

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return [...spares]
      .filter((s) => !term || s.name.toLowerCase().includes(term) || s.part_no.toLowerCase().includes(term))
      .sort((a, b) => Number(spareLow(b)) - Number(spareLow(a)) || a.name.localeCompare(b.name))
  }, [spares, q])
  const low = spares.filter(spareLow).length

  const adjust = (s: Spare, d: number) => sparesStore.update(s.id, { qty: Math.max(0, s.qty + d) })

  return (
    <div className="page space-y-4">
      <p className="max-w-2xl text-sm text-status-neutral">
        Critical spares inventory for <span className="font-medium text-navy">{branchLabel}</span> — parts at or below their minimum stock are flagged so they can be reordered before they run out.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
        <div className="rounded-xl border border-black/10 bg-white px-3 py-2"><div className="text-lg font-bold leading-none text-navy">{spares.length}</div><div className="mt-0.5 text-[11px] text-status-neutral">Parts</div></div>
        <div className={`rounded-xl border px-3 py-2 ${low ? 'border-status-critical/40 bg-status-critical/5' : 'border-black/10 bg-white'}`}><div className={`text-lg font-bold leading-none ${low ? 'text-status-critical' : 'text-navy'}`}>{low}</div><div className="mt-0.5 text-[11px] text-status-neutral">Below minimum</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-status-neutral" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part or number…" className="w-60 rounded-lg border border-black/15 bg-white py-2 pl-8 pr-3 text-sm text-navy outline-none focus:border-brand" />
        </div>
        {canManage && <Button className="ml-auto" onClick={() => setForm({ open: true, editing: null })}><Plus size={15} /> Add part</Button>}
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-navy text-white">
              <tr>
                <th className="px-3 py-2.5 font-medium">Part</th><th className="px-3 py-2.5 font-medium">Part No</th>
                <th className="px-3 py-2.5 text-center font-medium">In stock</th><th className="px-3 py-2.5 text-right font-medium">Min</th>
                <th className="px-3 py-2.5 font-medium">Location</th><th className="px-3 py-2.5 font-medium">Status</th>{canManage && <th className="px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.id} className={i % 2 ? 'bg-canvas/40' : ''}>
                  <td className="px-3 py-2 font-medium text-navy">{s.name}{s.notes && <div className="text-[11px] font-normal text-status-neutral">{s.notes}</div>}</td>
                  <td className="px-3 py-2 text-status-neutral">{s.part_no || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1.5">
                      {canManage && <button onClick={() => adjust(s, -1)} className="flex h-6 w-6 items-center justify-center rounded border border-black/15 text-navy hover:bg-canvas"><Minus size={12} /></button>}
                      <span className="min-w-[2rem] text-center font-semibold text-navy">{s.qty}{s.unit ? <span className="text-[11px] font-normal text-status-neutral"> {s.unit}</span> : ''}</span>
                      {canManage && <button onClick={() => adjust(s, 1)} className="flex h-6 w-6 items-center justify-center rounded border border-black/15 text-navy hover:bg-canvas"><Plus size={12} /></button>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-status-neutral">{s.min_qty}</td>
                  <td className="px-3 py-2 text-status-neutral">{s.location || '—'}</td>
                  <td className="px-3 py-2">{spareLow(s) ? <StatusBadge tone="critical">Reorder</StatusBadge> : <StatusBadge tone="good">OK</StatusBadge>}</td>
                  {canManage && (
                    <td className="px-3 py-2"><div className="flex justify-end gap-1">
                      <button onClick={() => setForm({ open: true, editing: s })} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-navy" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => confirm('Remove this part?') && sparesStore.remove(s.id)} className="rounded-md p-1.5 text-status-neutral hover:bg-status-critical/10 hover:text-status-critical"><Trash2 size={14} /></button>
                    </div></td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={canManage ? 7 : 6} className="px-4 py-12 text-center text-sm text-status-neutral"><Package size={22} className="mx-auto mb-2 text-status-neutral/60" />No spares yet. {canManage && 'Add the critical parts you keep on hand.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {low > 0 && <p className="inline-flex items-center gap-1.5 text-xs text-status-critical"><AlertTriangle size={13} /> {low} part{low === 1 ? '' : 's'} at or below minimum — reorder.</p>}
      {!ROLES[role].canToggleBranch && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
      <SpareModal state={form} onClose={() => setForm({ open: false, editing: null })} branch={branch} />
    </div>
  )
}

function SpareModal({ state, onClose, branch }: { state: { open: boolean; editing: Spare | null }; onClose: () => void; branch: BranchCode }) {
  const e = state.editing
  const blank = (): SpareInput => ({ branch, name: '', part_no: '', qty: 0, min_qty: 1, unit: '', location: '', notes: '' })
  const [f, setF] = useState<SpareInput>(blank)
  const [key, setKey] = useState('')
  const k = (e?.id ?? 'new') + String(state.open)
  if (state.open && k !== key) { setKey(k); setF(e ? { branch: e.branch, name: e.name, part_no: e.part_no, qty: e.qty, min_qty: e.min_qty, unit: e.unit, location: e.location, notes: e.notes } : blank()) }
  function set<K extends keyof SpareInput>(kk: K, v: SpareInput[K]) { setF((p) => ({ ...p, [kk]: v })) }
  const ready = !!f.name.trim()
  function save() { if (!ready) return; const data = { ...f, name: f.name.trim(), part_no: f.part_no.trim() }; if (e) sparesStore.update(e.id, data); else sparesStore.add(data); onClose() }
  return (
    <Modal open={state.open} onClose={onClose} title={e ? 'Edit part' : 'Add part'} subtitle="A critical spare you keep in stock."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ready}>{e ? 'Save' : 'Add'}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-navy">Part name</span><input className={inputCls} placeholder="e.g. Brake pad set" value={f.name} onChange={(ev) => set('name', ev.target.value)} autoFocus /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Part no.</span><input className={inputCls} value={f.part_no} onChange={(ev) => set('part_no', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Unit</span><input className={inputCls} placeholder="e.g. set, litre, each" value={f.unit} onChange={(ev) => set('unit', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">In stock</span><input type="number" className={inputCls} value={f.qty} onChange={(ev) => set('qty', Number(ev.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Minimum stock</span><input type="number" className={inputCls} value={f.min_qty} onChange={(ev) => set('min_qty', Number(ev.target.value))} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Location</span><input className={inputCls} placeholder="e.g. Store shelf B3" value={f.location} onChange={(ev) => set('location', ev.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-navy">Notes</span><input className={inputCls} value={f.notes} onChange={(ev) => set('notes', ev.target.value)} /></label>
      </div>
    </Modal>
  )
}
