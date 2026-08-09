import { Sun, Moon, Monitor, Check } from 'lucide-react'
import clsx from 'clsx'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useAuth } from '@/auth/AuthContext'
import { ACCENTS, THEMES, useAppearance, setAppearance, type ThemeMode } from '@/lib/prefs/store'

/**
 * Personal appearance settings — theme and accent colour. Applies instantly
 * (the whole app is the preview) and saves to the signed-in user's account,
 * so it follows them to any device without changing anyone else's look.
 */

/** Fixed-colour thumbnail so each option shows its own look regardless of the current theme. */
function Thumb({ kind }: { kind: 'light' | 'dark' | 'system' }) {
  const half = (bg: string, card: string) => (
    <div className="flex h-full flex-1 gap-1 p-1.5" style={{ background: bg }}>
      <div className="w-2.5 shrink-0 rounded-sm" style={{ background: '#0F1B33' }} />
      <div className="flex flex-1 flex-col gap-1">
        <div className="h-2 rounded-sm" style={{ background: card }} />
        <div className="flex-1 rounded-sm" style={{ background: card }} />
      </div>
    </div>
  )
  return (
    <div className="flex h-14 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-black/10">
      {kind !== 'dark' && half('#F2F2F2', '#FFFFFF')}
      {kind !== 'light' && half('#0B1220', '#161E2E')}
    </div>
  )
}

const MODE_OPTIONS: { key: ThemeMode; label: string; icon: typeof Sun; hint: string }[] = [
  { key: 'light', label: 'Light', icon: Sun, hint: 'Bright, the classic look' },
  { key: 'dark', label: 'Dark', icon: Moon, hint: 'Easy on the eyes' },
  { key: 'system', label: 'System', icon: Monitor, hint: 'Follows your device' },
]

export default function AppearanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const a = useAppearance(user!.id)

  return (
    <Modal open={open} onClose={onClose} title="Appearance"
      subtitle="Personal to your account — it follows you to any device, and everyone else keeps their own look."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-6">
        {/* Theme */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Theme</h4>
          <div className="grid grid-cols-3 gap-3">
            {MODE_OPTIONS.map(({ key, label, icon: Icon, hint }) => (
              <button key={key} onClick={() => setAppearance(user!.id, { mode: key })}
                className={clsx(
                  'rounded-xl border-2 p-2 text-left transition-colors',
                  a.mode === key ? 'border-brand bg-brand-tint/30' : 'border-black/10 hover:border-black/25',
                )}>
                <Thumb kind={key} />
                <div className="mt-2 flex items-center gap-1.5 px-0.5">
                  <Icon size={14} className={a.mode === key ? 'text-brand' : 'text-status-neutral'} />
                  <span className="text-sm font-medium text-navy">{label}</span>
                  {a.mode === key && <Check size={14} className="ml-auto text-brand" />}
                </div>
                <div className="px-0.5 text-[11px] text-status-neutral">{hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Colour theme — recolours sidebar, table headers and buttons */}
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-status-neutral">Colour theme</h4>
          <p className="mb-2.5 text-[11px] text-status-neutral">The sidebar, table headers and buttons take this colour — the background stays clean.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {THEMES.map((t) => (
              <button key={t.key} onClick={() => setAppearance(user!.id, { theme: t.key })}
                className={clsx(
                  'rounded-xl border-2 p-1.5 text-left transition-colors',
                  a.theme === t.key ? 'border-brand bg-brand-tint/30' : 'border-black/10 hover:border-black/25',
                )}>
                {/* Mini preview: coloured sidebar + header bar on a white page */}
                <div className="flex h-11 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-black/10" style={{ background: '#FFFFFF' }}>
                  <div className="w-3 shrink-0" style={{ background: t.chrome }} />
                  <div className="flex flex-1 flex-col gap-1 p-1.5">
                    <div className="h-2 rounded-sm" style={{ background: t.chrome }} />
                    <div className="h-1.5 w-2/3 rounded-sm" style={{ background: 'rgba(0,0,0,0.08)' }} />
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 px-0.5 pb-0.5">
                  <span className="text-xs font-medium text-navy">{t.label}</span>
                  {a.theme === t.key && <Check size={13} className="ml-auto text-brand" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Accent */}
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-status-neutral">Accent colour</h4>
          <p className="mb-2.5 text-[11px] text-status-neutral">Buttons, highlights and active items across the app.</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ACCENTS.map((acc) => (
              <button key={acc.key} onClick={() => setAppearance(user!.id, { accent: acc.key })} title={acc.label}
                className={clsx(
                  'flex flex-col items-center gap-1.5 rounded-xl border-2 px-1 py-2.5 transition-colors',
                  a.accent === acc.key ? 'border-brand bg-brand-tint/30' : 'border-black/10 hover:border-black/25',
                )}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: acc.hex }}>
                  {a.accent === acc.key && <Check size={15} className="text-white" strokeWidth={3} />}
                </span>
                <span className="text-center text-[10px] font-medium leading-tight text-navy">{acc.label}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="rounded-lg bg-canvas px-3 py-2 text-[11px] leading-relaxed text-status-neutral">
          Changes apply straight away — this window is the only control, the app behind it is the preview.
        </p>
      </div>
    </Modal>
  )
}
