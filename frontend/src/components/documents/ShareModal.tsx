import { useEffect, useState } from 'react'
import { Globe, Lock, Trash2, UserPlus } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useUsers } from '@/lib/auth/users'
import { ROLES, useBranches } from '@/lib/roles'
import { documentsStore } from '@/lib/documents/store'
import { type DocumentRecord, type DocVisibility, type ShareGrant, visibilityOf, displayNameOf } from '@/lib/documents/types'

const inputCls = 'rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'

/** Owner/admin control over who can access a document (public, or private to chosen people). */
export default function ShareModal({ doc, open, onClose }: { doc: DocumentRecord | null; open: boolean; onClose: () => void }) {
  const users = useUsers()
  const branches = useBranches()
  const [visibility, setVisibility] = useState<DocVisibility>('public')
  const [grants, setGrants] = useState<ShareGrant[]>([])
  const [pick, setPick] = useState('')
  const [pickAccess, setPickAccess] = useState<'view' | 'edit'>('view')

  useEffect(() => {
    if (open && doc) { setVisibility(visibilityOf(doc)); setGrants(doc.shared_with ?? []); setPick(''); setPickAccess('view') }
  }, [open, doc?.id])

  if (!doc) return null

  const byId = (id: string) => users.find((u) => u.id === id)
  const ownerName = (doc.owner_id && byId(doc.owner_id)?.full_name) || doc.uploaded_by
  const addable = users.filter((u) => u.active && u.id !== doc.owner_id && !grants.some((g) => g.user_id === u.id))
  const branchLabel = doc.all_branches ? 'both branches' : (branches.find((b) => b.code === doc.branch)?.short ?? doc.branch)

  function addGrant() {
    if (!pick) return
    setGrants((g) => [...g, { user_id: pick, access: pickAccess }])
    setPick(''); setPickAccess('view')
  }

  function save() {
    documentsStore.setAccess(doc!.id, visibility, grants)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={`Share “${displayNameOf(doc)}”`}
      subtitle={`Owner: ${ownerName} · choose who can access this document`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save access</Button></>}
    >
      {/* Public / Private */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setVisibility('public')}
          className={`flex items-start gap-2 rounded-xl border p-3 text-left ${visibility === 'public' ? 'border-brand bg-brand-tint/40' : 'border-black/10 bg-white hover:bg-canvas'}`}
        >
          <Globe size={18} className="mt-0.5 text-brand" />
          <span>
            <span className="block text-sm font-semibold text-navy">Public</span>
            <span className="block text-xs text-status-neutral">Anyone in {branchLabel} can view it in the library.</span>
          </span>
        </button>
        <button
          onClick={() => setVisibility('private')}
          className={`flex items-start gap-2 rounded-xl border p-3 text-left ${visibility === 'private' ? 'border-brand bg-brand-tint/40' : 'border-black/10 bg-white hover:bg-canvas'}`}
        >
          <Lock size={18} className="mt-0.5 text-brand" />
          <span>
            <span className="block text-sm font-semibold text-navy">Private</span>
            <span className="block text-xs text-status-neutral">Only you and the people you choose.</span>
          </span>
        </button>
      </div>

      {visibility === 'private' && (
        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-status-neutral">Shared with</div>

          {/* Existing grants */}
          <div className="mt-2 space-y-1.5">
            {grants.length === 0 && <p className="text-sm text-status-neutral">No one yet — add people below.</p>}
            {grants.map((g) => {
              const u = byId(g.user_id)
              return (
                <div key={g.user_id} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-navy">
                    {(u?.full_name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('')}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-navy">{u?.full_name ?? 'Unknown user'}</div>
                    <div className="text-xs text-status-neutral">{u ? ROLES[u.role].label : ''}</div>
                  </div>
                  <select
                    value={g.access}
                    onChange={(e) => setGrants((gg) => gg.map((x) => (x.user_id === g.user_id ? { ...x, access: e.target.value as 'view' | 'edit' } : x)))}
                    className={inputCls}
                  >
                    <option value="view">Can view</option>
                    <option value="edit">Can edit</option>
                  </select>
                  <button onClick={() => setGrants((gg) => gg.filter((x) => x.user_id !== g.user_id))} className="rounded-md p-1.5 text-status-neutral hover:bg-canvas hover:text-status-critical" title="Remove">
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Add a person */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputCls} min-w-[180px] flex-1`}>
              <option value="">Add a person…</option>
              {addable.map((u) => <option key={u.id} value={u.id}>{u.full_name} · {ROLES[u.role].label}</option>)}
            </select>
            <select value={pickAccess} onChange={(e) => setPickAccess(e.target.value as 'view' | 'edit')} className={inputCls}>
              <option value="view">Can view</option>
              <option value="edit">Can edit</option>
            </select>
            <Button variant="secondary" onClick={addGrant} disabled={!pick}><UserPlus size={14} /> Add</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
