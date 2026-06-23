import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowRight } from 'lucide-react'
import RingGauge from '@/components/ui/RingGauge'

/** Visual Safety summary — progress rings make compliance gaps obvious at a glance. */
export default function SafetyCard({
  openIncidents,
  capCompletion,
  driverCompliance,
  link = '/safety',
}: {
  openIncidents: number
  capCompletion: number
  driverCompliance: number
  link?: string
}) {
  return (
    <Link to={link} className="card group p-4 transition-shadow hover:shadow-cardhover">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className="text-brand" />
        <span className="font-display text-sm font-bold text-navy">Safety</span>
        <ArrowRight size={14} className="ml-auto text-status-neutral transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <RingGauge value={capCompletion} label="CAP done" />
        <RingGauge value={driverCompliance} label="Compliance" />
        <div className="text-center">
          <div className={`text-2xl font-bold leading-none ${openIncidents > 0 ? 'text-status-critical' : 'text-status-good'}`}>
            {openIncidents}
          </div>
          <div className="mt-1 text-[11px] text-status-neutral">open<br />incidents</div>
        </div>
      </div>
    </Link>
  )
}
