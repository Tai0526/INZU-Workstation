import { Link } from 'react-router-dom'
import { Wallet, ArrowRight, Check } from 'lucide-react'
import clsx from 'clsx'

type Stage = 'draft' | 'ops_review' | 'md_approval' | 'locked'
const STEPS: { key: Stage; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'ops_review', label: 'Ops review' },
  { key: 'md_approval', label: 'MD lock' },
  { key: 'locked', label: 'Locked' },
]

/** Visual Payroll pipeline — shows exactly which approval step a run is sitting at. */
export default function PayrollCard({
  stage,
  headcount,
  link = '/payroll',
}: {
  stage: Stage
  headcount: number
  link?: string
}) {
  const current = STEPS.findIndex((s) => s.key === stage)
  const locked = stage === 'locked'

  return (
    <Link to={link} className="card group p-4 transition-shadow hover:shadow-cardhover">
      <div className="mb-3 flex items-center gap-2">
        <Wallet size={16} className="text-brand" />
        <span className="font-display text-sm font-bold text-navy">Payroll</span>
        <span className="ml-auto text-xs text-status-neutral">{headcount} staff</span>
        <ArrowRight size={14} className="text-status-neutral transition-transform group-hover:translate-x-0.5" />
      </div>

      <div className="flex items-center">
        {STEPS.map((step, i) => {
          const done = locked || i < current
          const active = !locked && i === current
          return (
            <div key={step.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={clsx(
                    'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold',
                    done && 'bg-status-good text-white',
                    active && 'bg-brand text-white ring-4 ring-brand/20',
                    !done && !active && 'bg-canvas text-status-neutral',
                  )}
                >
                  {done ? <Check size={14} /> : i + 1}
                </div>
                <span className={clsx('mt-1 whitespace-nowrap text-[10px]', active ? 'font-semibold text-navy' : 'text-status-neutral')}>
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={clsx('mx-1 mb-4 h-0.5 flex-1', i < current || locked ? 'bg-status-good' : 'bg-canvas')} />
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-status-neutral">
        {locked ? 'This run is locked and final.' : `Awaiting ${STEPS[current]?.label.toLowerCase()} before it can proceed.`}
      </p>
    </Link>
  )
}
