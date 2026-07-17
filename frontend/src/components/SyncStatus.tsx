import { useEffect, useState } from 'react'
import { AlertTriangle, X, DatabaseZap } from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/supabase/client'

/**
 * Two guarantees about saving, both visible rather than buried in the console.
 *
 * 1. NOT CONNECTED TO THE DATABASE — if the Supabase env vars are missing, every
 *    store silently falls back to this browser's localStorage. The app looks like
 *    it works; clearing site data, a new device or a different browser loses the
 *    lot. That must never be discoverable only after the fact, so it's a
 *    permanent, undismissable bar.
 * 2. A SAVE DIDN'T LAND — listens for `inzu:sync-error` from the sync layer
 *    (lib/supabase/syncTable.ts). Transient: the change is held in a durable
 *    outbox and retried, so we say so. Permanent: the entry was rejected and
 *    rolled back, so we say that instead of letting it vanish quietly.
 */
export default function SyncStatus() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    function onErr(e: Event) {
      const detail = (e as CustomEvent).detail as { table?: string; message?: string } | undefined
      setMsg(detail?.message || 'A save could not be completed.')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setMsg(null), 8000)
    }
    window.addEventListener('inzu:sync-error', onErr as EventListener)
    return () => { window.removeEventListener('inzu:sync-error', onErr as EventListener); if (timer) clearTimeout(timer) }
  }, [])

  return (
    <>
      {!isSupabaseConfigured && (
        <div className="fixed inset-x-0 bottom-0 z-[70] border-t-2 border-status-critical bg-status-critical/95 px-4 py-2.5 text-white">
          <div className="mx-auto flex max-w-4xl items-start gap-2.5">
            <DatabaseZap size={18} className="mt-0.5 shrink-0" />
            <p className="text-sm leading-snug">
              <b>Not saving to the database.</b> This app has no database connection, so everything you enter is being kept in this browser only —
              it is not backed up, other people can't see it, and clearing site data or switching device will lose it permanently.
              Set <code className="rounded bg-white/20 px-1">VITE_SUPABASE_URL</code> and <code className="rounded bg-white/20 px-1">VITE_SUPABASE_ANON_KEY</code> and redeploy before entering real work.
            </p>
          </div>
        </div>
      )}
      {msg && (
        <div className={`fixed left-1/2 z-[60] w-[min(92vw,26rem)] -translate-x-1/2 ${isSupabaseConfigured ? 'bottom-4' : 'bottom-24'}`}>
          <div className="flex items-start gap-2 rounded-xl border border-status-warning/40 bg-surface px-4 py-3 shadow-cardhover">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-warning" />
            <p className="flex-1 text-sm leading-snug text-navy">{msg}</p>
            <button onClick={() => setMsg(null)} aria-label="Dismiss" className="rounded p-1 text-status-neutral hover:bg-canvas"><X size={14} /></button>
          </div>
        </div>
      )}
    </>
  )
}
