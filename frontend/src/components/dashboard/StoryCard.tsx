import { Link } from 'react-router-dom'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import type { ModuleKey } from '@/lib/permissions'

export interface Stat {
  label: string
  value: string | number
  tone?: 'critical' | 'warning' | 'good'
}
export interface Story {
  module: ModuleKey
  title: string
  icon: LucideIcon
  narrative: string
  link: string
  stats: Stat[]
}

const STAT_COLOR = {
  critical: 'text-status-critical',
  warning: 'text-[#8a6d10]',
  good: 'text-status-good',
  default: 'text-navy',
}

/** Generic at-a-glance card: narrative + small stat tiles. */
export default function StoryCard({ s }: { s: Story }) {
  return (
    <Link to={s.link} className="card group p-4 transition-shadow hover:shadow-cardhover">
      <div className="mb-2 flex items-center gap-2">
        <s.icon size={16} className="text-brand" />
        <span className="font-display text-sm font-bold text-navy">{s.title}</span>
        <ArrowRight size={14} className="ml-auto text-status-neutral transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mb-3 text-xs leading-relaxed text-status-neutral">{s.narrative}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {s.stats.map((st, i) => (
          <div key={i}>
            <div className={`text-lg font-bold leading-none ${STAT_COLOR[st.tone ?? 'default']}`}>{st.value}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-status-neutral">{st.label}</div>
          </div>
        ))}
      </div>
    </Link>
  )
}
