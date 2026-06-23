import { useState, type FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { LogIn, Mail, Lock } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'

/** Credential login. Accounts are created by an administrator — there is no sign-up. */
export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await login(email, password)
    if (res.ok) navigate(res.landing || '/')
    else { setError(res.reason || 'Sign-in failed.'); setLoading(false) }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden font-sans">
      {/* LEFT PANEL */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy md:flex md:basis-[52%]">
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          <img src="/logo.png" alt="" className="w-[60%] max-w-[420px] object-contain opacity-95"
            style={{ filter: 'drop-shadow(0 25px 45px rgba(0,0,0,0.45))' }}
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
        </div>
        <div className="relative z-10 p-8 lg:p-11">
          <img src="/logo.png" alt="INZU" className="block h-12 object-contain" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
          <div className="mt-3">
            <div className="font-display text-[17px] font-bold tracking-tight text-white">INZU MCS Limited</div>
            <div className="mt-0.5 text-xs text-white/60">Transport · Safety · Compliance</div>
          </div>
        </div>
        <div className="relative z-10 p-8 lg:p-11">
          <div className="mb-3.5 h-[3px] w-8 rounded bg-brand" />
          <p className="m-0 mb-2 font-display text-2xl font-bold leading-tight tracking-tight text-white">
            Fleet, safety &amp; compliance,<br />built for FQM operations.
          </p>
          <p className="m-0 mb-4 text-xs text-white/50">Solwezi (Kansanshi) &amp; Kalumbila (Trident), Zambia</p>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5">
            <p className="m-0 text-[11px] leading-relaxed text-white/45">
              🔒 Custom internal software for INZU MCS Limited. Accounts are issued by the administrator. Unauthorised access is strictly prohibited.
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex flex-1 flex-col items-center justify-center overflow-auto bg-canvas px-6 py-8 sm:px-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-7">
            <h1 className="m-0 mb-1.5 font-display text-2xl font-bold tracking-tight text-navy">Sign in</h1>
            <p className="m-0 text-sm text-status-neutral">Use the credentials issued by your administrator.</p>
          </div>

          {error && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-navy">Email</span>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3.5 top-3.5 text-status-neutral" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username"
                  className="h-11 w-full rounded-[10px] border-[1.5px] border-navy/15 bg-white pl-10 pr-3.5 text-sm text-navy outline-none focus:border-brand" placeholder="you@inzumcs.com" />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-navy">Password</span>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3.5 top-3.5 text-status-neutral" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                  className="h-11 w-full rounded-[10px] border-[1.5px] border-navy/15 bg-white pl-10 pr-3.5 text-sm text-navy outline-none focus:border-brand" placeholder="••••••••" />
              </div>
            </label>
            <button type="submit" disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-navy font-display text-sm font-semibold tracking-wide text-white transition-colors hover:bg-navy-secondary disabled:opacity-70">
              <LogIn size={16} /> {loading ? 'Signing in…' : 'Enter Workstation'}
            </button>
          </form>

          <div className="mt-6 rounded-lg border border-navy/10 bg-navy/[0.04] px-3.5 py-3">
            <p className="m-0 text-center text-[11px] leading-relaxed text-status-neutral">
              Accounts are issued by the administrator. For access, contact your system administrator.
            </p>
          </div>

          <p className="mt-3.5 text-center text-[11px] text-status-neutral/70">© {new Date().getFullYear()} INZU MCS Limited · Confidential</p>
        </div>
      </div>
    </div>
  )
}
