import { useState, type FormEvent } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'

/**
 * Forced password change — shown when a user signs in with an admin-issued
 * temporary password (or after an admin reset). They cannot reach the app until
 * they set their own password.
 */
export default function ChangePassword() {
  const { user, changePassword, logout } = useAuth()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (pw.length < 8) return setError('Use at least 8 characters.')
    if (pw !== confirm) return setError('The two passwords do not match.')
    setSaving(true)
    const res = await changePassword(pw)
    if (!res.ok) { setError(res.reason || 'Could not update your password.'); setSaving(false) }
    // On success the gate clears automatically and the app renders.
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-tint text-brand"><KeyRound size={20} /></span>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-navy">Set your password</h1>
            <p className="text-sm text-status-neutral">Welcome{user ? `, ${user.fullName}` : ''}. Choose a new password to continue.</p>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-navy">New password</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password"
              className="h-11 w-full rounded-[10px] border-[1.5px] border-navy/15 bg-white px-3.5 text-sm text-navy outline-none focus:border-brand" placeholder="At least 8 characters" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-navy">Confirm new password</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
              className="h-11 w-full rounded-[10px] border-[1.5px] border-navy/15 bg-white px-3.5 text-sm text-navy outline-none focus:border-brand" placeholder="Re-enter password" />
          </label>
          <button type="submit" disabled={saving}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-navy font-display text-sm font-semibold tracking-wide text-white transition-colors hover:bg-navy-secondary disabled:opacity-70">
            {saving ? 'Saving…' : 'Save password & continue'}
          </button>
        </form>

        <button onClick={logout} className="mt-4 inline-flex items-center gap-1.5 text-xs text-status-neutral hover:text-navy">
          <LogOut size={13} /> Sign out instead
        </button>
      </div>
    </div>
  )
}
