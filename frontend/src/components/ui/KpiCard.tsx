import clsx from 'clsx'
import { TrendingUp, TrendingDown, Info } from 'lucide-react'
import type { StatusTone } from './StatusBadge'

/**
 * KPI tile (spec §3.4): large bold figure, small grey label beneath.
 * `tone` colour-codes the value + a left accent bar to draw attention
 * (e.g. critical counts in red); `highlight` uses the brand accent.
 */
const TONE_TEXT: Record<StatusTone, string> = {
  good: 'text-status-good',
  warning: 'text-[#8a6d10]',
  critical: 'text-status-critical',
  neutral: 'text-navy',
}
const TONE_BAR: Record<StatusTone, string> = {
  good: 'before:bg-status-good',
  warning: 'before:bg-status-warning',
  critical: 'before:bg-status-critical',
  neutral: 'before:bg-transparent',
}

export default function KpiCard({
  label,
  value,
  trend,
  highlight = false,
  tone,
  sub,
  info,
}: {
  label: string
  value: string | number
  trend?: { dir: 'up' | 'down'; text: string; good?: boolean }
  highlight?: boolean
  tone?: StatusTone
  sub?: string
  info?: string
}) {
  const valueColor = highlight ? 'text-brand' : tone ? TONE_TEXT[tone] : 'text-navy'
  return (
    <div
      className={clsx(
        'card relative overflow-hidden p-4',
        tone && 'before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:content-[""]',
        tone && TONE_BAR[tone],
      )}
    >
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-status-neutral">
        <span>{label}</span>
        {info && (
          <span title={info} className="inline-flex cursor-help text-status-neutral/60">
            <Info size={12} />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className={clsx('text-3xl font-bold leading-none', valueColor)}>{value}</span>
        {trend && (
          <span
            className={clsx(
              'mb-0.5 inline-flex items-center gap-0.5 text-xs font-medium',
              trend.good ? 'text-status-good' : 'text-status-critical',
            )}
          >
            {trend.dir === 'up' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {trend.text}
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-status-neutral">{sub}</div>}
    </div>
  )
}
