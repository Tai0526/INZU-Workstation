import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Timer, Users } from 'lucide-react'

export interface OpsInsightData {
  branchLabel: string
  // fleet status (real)
  active: number
  repair: number
  grounded: number
  avail: number
  // staffing (real)
  overtimeDrivers: number
  activeDrivers: number
  onShift: number
  zones: { name: string; drivers: number }[]
}

const FLEET_COLORS = { active: '#2E7D4F', repair: '#C9A227', grounded: '#B3261E' }

export default function OpsInsight(d: OpsInsightData) {
  const pie = [
    { name: 'Active', value: d.active, fill: FLEET_COLORS.active },
    { name: 'In workshop', value: d.repair, fill: FLEET_COLORS.repair },
    { name: 'Grounded', value: d.grounded, fill: FLEET_COLORS.grounded },
  ].filter((p) => p.value > 0)

  const shiftPct = d.activeDrivers ? Math.min(100, Math.round((d.onShift / d.activeDrivers) * 100)) : 0

  return (
    <div>
      <h3 className="mb-3 font-display text-sm font-bold text-navy">Operations &amp; staffing</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* Fleet status donut */}
        <div className="card p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-status-neutral">Fleet status</div>
          <div className="relative h-36">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none">
                  {pie.map((p, i) => <Cell key={i} fill={p.fill} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${v} vehicle${v === 1 ? '' : 's'}`, n]} contentStyle={{ borderRadius: 10, border: '1px solid #eee', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none text-navy">{d.avail}%</span>
              <span className="text-[10px] text-status-neutral">available</span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px]">
            <Legend color={FLEET_COLORS.active} label="Active" value={d.active} />
            <Legend color={FLEET_COLORS.repair} label="Workshop" value={d.repair} />
            <Legend color={FLEET_COLORS.grounded} label="Grounded" value={d.grounded} />
          </div>
        </div>

        {/* Drivers by section / zone */}
        <div className="card p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-status-neutral">Drivers by section</div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.zones} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11, fill: '#0F1B33' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(209,107,33,0.06)' }} formatter={(v: number) => [`${v} drivers`, 'Assigned']} contentStyle={{ borderRadius: 10, border: '1px solid #eee', fontSize: 12 }} />
                <Bar dataKey="drivers" fill="#D16B21" radius={[0, 5, 5, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Overtime */}
        <div className="card relative overflow-hidden p-4 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-status-warning before:content-['']">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-status-neutral">
            <Timer size={13} className="text-[#8a6d10]" /> Overtime
          </div>
          <div className={`text-3xl font-bold leading-none ${d.overtimeDrivers ? 'text-[#8a6d10]' : 'text-status-good'}`}>{d.overtimeDrivers}</div>
          <div className="mt-1 text-xs text-status-neutral">driver{d.overtimeDrivers === 1 ? '' : 's'} flagged on overtime</div>
          <p className="mt-3 text-[11px] leading-relaxed text-status-neutral">
            Drivers working outside their assigned shift window. Manage on the Driver Roster.
          </p>
        </div>

        {/* Drivers on shift */}
        <div className="card relative overflow-hidden p-4 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-status-good before:content-['']">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-status-neutral">
            <Users size={13} className="text-status-good" /> Drivers on shift
          </div>
          <div className="text-3xl font-bold leading-none text-navy">{d.onShift}<span className="text-base font-medium text-status-neutral"> / {d.activeDrivers}</span></div>
          <div className="mt-1 text-xs text-status-neutral">on shift now of active drivers</div>
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-status-good" style={{ width: `${shiftPct}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] text-status-neutral">{shiftPct}% of active drivers currently on shift</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-status-neutral">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label} <b className="text-navy">{value}</b>
    </span>
  )
}
