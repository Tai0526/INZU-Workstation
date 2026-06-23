import { Check } from 'lucide-react'
import { CASE_STEPS, currentStepIndex, type CaseStage } from '@/lib/safety/cases'

/**
 * Horizontal process stepper showing where a disciplinary case sits:
 * Confirmed & escalated → Safety review → Ops verdict → Closed.
 * Steps before the current one are "done", the current one is "active".
 */
export default function CaseStepper({ stage }: { stage: CaseStage }) {
  const current = currentStepIndex(stage)
  const closed = stage === 'closed'

  return (
    <div className="flex items-center">
      {CASE_STEPS.map((label, i) => {
        const done = i < current || (closed && i === current)
        const active = i === current && !closed
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  done ? 'bg-status-good text-white'
                    : active ? 'bg-brand text-white ring-4 ring-brand/20'
                    : 'bg-canvas text-status-neutral ring-1 ring-black/10'
                }`}
              >
                {done ? <Check size={14} /> : i + 1}
              </div>
              <span className={`whitespace-nowrap text-[10px] font-medium ${active ? 'text-brand' : done ? 'text-navy' : 'text-status-neutral'}`}>
                {label}
              </span>
            </div>
            {i < CASE_STEPS.length - 1 && (
              <div className={`mx-1.5 h-0.5 flex-1 rounded ${i < current ? 'bg-status-good' : 'bg-black/10'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
