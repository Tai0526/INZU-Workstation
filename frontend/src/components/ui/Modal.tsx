import { useEffect } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-navy/50 p-4 backdrop-blur-sm sm:p-8">
      <div
        className={clsx(
          'my-auto w-full rounded-2xl bg-surface shadow-cardhover',
          size === 'xl' ? 'max-w-[min(96vw,1400px)]' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-black/5 px-6 py-4">
          <div className="flex-1">
            <h3 className="font-display text-base font-bold text-navy">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-status-neutral">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-status-neutral hover:bg-canvas hover:text-navy">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-black/5 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}
