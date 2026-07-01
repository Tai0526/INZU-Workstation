import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/**
 * Global, unobtrusive notice that a save could not be completed right away. It
 * listens for the `inzu:sync-error` window event dispatched by the Supabase sync
 * layer (see lib/supabase/syncTable.ts). A transient issue (offline / server
 * blip) reassures the user their entry is held locally and will sync; a hard
 * rejection asks them to re-check what they entered. Either way a failed save is
 * never silent — the old behaviour that let data quietly disappear.
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

  if (!msg) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] w-[min(92vw,26rem)] -translate-x-1/2">
      <div className="flex items-start gap-2 rounded-xl border border-status-warning/40 bg-surface px-4 py-3 shadow-cardhover">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-warning" />
        <p className="flex-1 text-sm leading-snug text-navy">{msg}</p>
        <button onClick={() => setMsg(null)} aria-label="Dismiss" className="rounded p-1 text-status-neutral hover:bg-canvas"><X size={14} /></button>
      </div>
    </div>
  )
}
