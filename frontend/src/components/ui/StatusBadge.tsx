import clsx from 'clsx'

export type StatusTone = 'good' | 'warning' | 'critical' | 'neutral'

const TONE: Record<StatusTone, string> = {
  good: 'bg-status-good/10 text-status-good',
  warning: 'bg-status-warning/10 text-[#8a6d10]',
  critical: 'bg-status-critical/10 text-status-critical',
  neutral: 'bg-status-neutral/10 text-status-neutral',
}

/** Status pill using the system-wide four-colour vocabulary (spec §3.2). */
export default function StatusBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', {
        'bg-status-good': tone === 'good',
        'bg-status-warning': tone === 'warning',
        'bg-status-critical': tone === 'critical',
        'bg-status-neutral': tone === 'neutral',
      })} />
      {children}
    </span>
  )
}
