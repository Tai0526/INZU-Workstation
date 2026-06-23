import { Link } from 'react-router-dom'
import { Gauge, ArrowRight } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

/** Visual Speed summary — clean-vs-repeat driver split as a donut. */
export default function SpeedCard({
  events,
  repeat,
  clean,
  link = '/speed',
}: {
  events: number
  repeat: number
  clean: number
  link?: string
}) {
  const data = [
    { name: 'Clean record', value: clean, fill: '#2E7D4F' },
    { name: 'Repeat offenders', value: repeat, fill: '#B3261E' },
  ].filter((d) => d.value > 0)

  return (
    <Link to={link} className="card group p-4 transition-shadow hover:shadow-cardhover">
      <div className="mb-2 flex items-center gap-2">
        <Gauge size={16} className="text-brand" />
        <span className="font-display text-sm font-bold text-navy">Speed</span>
        <ArrowRight size={14} className="ml-auto text-status-neutral transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="flex items-center gap-3">
        <div className="relative h-24 w-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={30} outerRadius={44} paddingAngle={2} stroke="none">
                {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip formatter={(v: number, n: string) => [`${v} drivers`, n]} contentStyle={{ borderRadius: 10, border: '1px solid #eee', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold leading-none text-navy">{events}</span>
            <span className="text-[9px] text-status-neutral">events</span>
          </div>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-status-good" />
            <span className="text-status-neutral">Clean record</span>
            <b className="text-navy">{clean}</b>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-status-critical" />
            <span className="text-status-neutral">Repeat offenders</span>
            <b className="text-status-critical">{repeat}</b>
          </div>
          <div className="pt-0.5 text-[11px] text-status-neutral">{events} events this month</div>
        </div>
      </div>
    </Link>
  )
}
