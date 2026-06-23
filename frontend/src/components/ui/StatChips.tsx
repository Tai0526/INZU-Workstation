import clsx from 'clsx'
import type { StatusTone } from './StatusBadge'

/**
 * A compact, clickable counter strip — "12 confirmed · 3 disputed" style — used
 * to show how many items sit at each status/stage and to filter to one with a tap.
 */
export interface Stat<T extends string> {
  value: T
  label: string
  count: number
  tone?: StatusTone
}

const DOT: Record<StatusTone, string> = {
  good: 'bg-status-good',
  warning: 'bg-status-warning',
  critical: 'bg-status-critical',
  neutral: 'bg-status-neutral',
}

export default function StatChips<T extends string>({
  stats, active, onPick,
}: {
  stats: Stat<T>[]
  active: T
  onPick: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {stats.map((s) => (
        <button
          key={s.value}
          onClick={() => onPick(s.value)}
          className={clsx(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
            active === s.value ? 'border-brand bg-brand-tint/50 text-navy' : 'border-black/10 bg-white text-status-neutral hover:bg-canvas',
          )}
        >
          {s.tone && <span className={clsx('h-2 w-2 rounded-full', DOT[s.tone])} />}
          <span className="font-medium text-navy">{s.count}</span>
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  )
}
