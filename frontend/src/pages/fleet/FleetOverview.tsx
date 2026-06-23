import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Truck, ShieldCheck, ArrowRight, FileWarning, Activity, ChevronRight } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import { useVehicles } from '@/lib/fleet/store'
import { useDocuments } from '@/lib/documents/store'
import { CATEGORY_META, LICENSING_CATEGORIES, DOC_STATUS_META, docStatus } from '@/lib/documents/types'

function rel(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

export default function FleetOverview() {
  const { user } = useAuth()
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short

  const vehicles = useVehicles()
  const docs = useDocuments()

  const fleet = useMemo(() => vehicles.filter((v) => v.branch === branch), [vehicles, branch])
  const branchDocs = useMemo(() => docs.filter((d) => d.branch === branch && !d.superseded), [docs, branch])

  const counts = useMemo(() => {
    const active = fleet.filter((v) => v.status === 'active').length
    const repair = fleet.filter((v) => v.status === 'under_repair').length
    const grounded = fleet.filter((v) => v.status === 'grounded').length
    const total = fleet.length
    return { active, repair, grounded, total, avail: total ? Math.round((active / total) * 100) : 0 }
  }, [fleet])

  // ── Licensing attention (prioritised: expired first, then soonest) ──
  const attention = useMemo(() => {
    const items = branchDocs
      .map((d) => ({ d, st: docStatus(d) }))
      .filter(({ st }) => st === 'expired' || st === 'expiring')
    const order: Record<string, number> = { expired: 0, expiring: 1 }
    return items.sort((a, b) => order[a.st] - order[b.st] || a.d.expiry_date.localeCompare(b.d.expiry_date))
  }, [branchDocs])

  const expired = attention.filter((a) => a.st === 'expired').length
  const expiring = attention.filter((a) => a.st === 'expiring').length

  const incomplete = useMemo(
    () =>
      fleet.filter((v) =>
        LICENSING_CATEGORIES.some((cat) => !branchDocs.some((d) => d.entity_id === v.id && d.category === cat)),
      ).length,
    [fleet, branchDocs],
  )

  // ── Composition by seating capacity ──
  const capacityData = useMemo(() => {
    const m = new Map<number, number>()
    for (const v of fleet) {
      const cap = v.capacity ?? 0
      m.set(cap, (m.get(cap) ?? 0) + 1)
    }
    return [...m.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([cap, n]) => ({ name: cap ? `${cap}-seat` : 'Unset', vehicles: n }))
  }, [fleet])
  const totalSeats = useMemo(() => fleet.reduce((s, v) => s + (v.capacity ?? 0), 0), [fleet])

  // ── Recent activity (audit) — latest 5 ──
  const activity = useMemo(() => {
    type Ev = { at: string; who: string; text: string }
    const evs: Ev[] = []
    for (const v of fleet) {
      const created = v.created_at === v.updated_at
      evs.push({ at: v.updated_at, who: created ? v.created_by : v.updated_by, text: created ? `added vehicle ${v.fleet_no}` : `updated vehicle ${v.fleet_no}` })
    }
    for (const d of branchDocs) {
      evs.push({ at: d.uploaded_at, who: d.uploaded_by, text: `uploaded ${CATEGORY_META[d.category].label} for ${d.entity_label}` })
    }
    return evs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  }, [fleet, branchDocs])

  return (
    <div className="page space-y-6">
      <p className="text-sm text-status-neutral">
        Live summary of the Vehicle Register and Licensing for <span className="font-medium text-navy">{branchLabel}</span>.
      </p>

      {/* Priority alerts — colour-coded to grab attention first */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Licensing expired" value={expired} tone={expired > 0 ? 'critical' : 'good'} sub={expired > 0 ? 'needs renewal now' : 'all current'} />
        <KpiCard label="Expiring ≤30 days" value={expiring} tone={expiring > 0 ? 'warning' : 'good'} sub={expiring > 0 ? 'renew soon' : 'none due'} />
        <KpiCard label="Grounded" value={counts.grounded} tone={counts.grounded > 0 ? 'critical' : 'good'} sub="out of service" />
        <KpiCard label="In workshop" value={counts.repair} tone={counts.repair > 0 ? 'warning' : 'good'} sub="under repair" />
      </div>

      {/* Fleet status — neutral KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard label="Fleet availability" value={`${counts.avail}%`} highlight sub={`${counts.active} of ${counts.total} on road`} />
        <KpiCard label="Total vehicles" value={counts.total} />
        <KpiCard label="Active" value={counts.active} tone="good" />
        <KpiCard label="Incomplete licensing" value={incomplete} tone={incomplete > 0 ? 'warning' : 'good'} sub="missing a doc" />
        <KpiCard label="Documents on file" value={branchDocs.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Needs attention — licensing first */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <FileWarning size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Licensing — needs attention</h3>
            {attention.length > 0 && (
              <span className="ml-2 rounded-full bg-status-critical/10 px-2 py-0.5 text-xs font-medium text-status-critical">{attention.length}</span>
            )}
            <Link to="/fleet/licensing" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">
              Open licensing <ChevronRight size={13} />
            </Link>
          </div>
          {attention.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-status-neutral">
              <ShieldCheck size={24} className="text-status-good" />
              <p className="text-sm">All licensing current for {branchLabel}.</p>
            </div>
          ) : (
            <div className="divide-y divide-black/5">
              {attention.map(({ d, st }) => (
                <Link to="/fleet/licensing" key={d.id} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                  <StatusBadge tone={DOC_STATUS_META[st].tone}>{DOC_STATUS_META[st].label}</StatusBadge>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-navy">{CATEGORY_META[d.category].label} — {d.entity_label}</div>
                    <div className="text-xs text-status-neutral">Expiry {d.expiry_date || '—'}</div>
                  </div>
                  <ArrowRight size={15} className="text-status-neutral" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity (audit) — latest 5 */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <Activity size={16} className="text-brand" />
            <h3 className="font-display text-sm font-bold text-navy">Recent activity</h3>
            <span className="ml-auto text-[11px] text-status-neutral">latest 5</span>
          </div>
          {activity.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-status-neutral">No activity yet.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {activity.map((e, i) => (
                <div key={i} className="px-5 py-2.5 text-sm">
                  <span className="font-medium text-navy">{e.who}</span>{' '}
                  <span className="text-status-neutral">{e.text}</span>
                  <div className="text-[11px] text-status-neutral">{rel(e.at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composition by seating capacity + quick links */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-navy">Fleet by seating capacity</h3>
            <span className="text-xs text-status-neutral">{totalSeats.toLocaleString()} seats total</span>
          </div>
          {capacityData.length === 0 ? (
            <p className="py-8 text-center text-sm text-status-neutral">No vehicles yet.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={capacityData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(209,107,33,0.06)' }}
                    contentStyle={{ borderRadius: 10, border: '1px solid #eee', fontSize: 12 }}
                    formatter={(v: number) => [`${v} vehicle${v === 1 ? '' : 's'}`, 'Count']}
                  />
                  <Bar dataKey="vehicles" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {capacityData.map((_, i) => (
                      <Cell key={i} fill="#D16B21" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="mb-3 font-display text-sm font-bold text-navy">Jump to</h3>
          <div className="space-y-2">
            <Link to="/fleet/vehicles" className="flex items-center gap-3 rounded-lg border border-black/10 px-4 py-3 hover:bg-canvas">
              <Truck size={16} className="text-brand" />
              <span className="text-sm font-medium text-navy">Vehicle Register</span>
              <ArrowRight size={15} className="ml-auto text-status-neutral" />
            </Link>
            <Link to="/fleet/licensing" className="flex items-center gap-3 rounded-lg border border-black/10 px-4 py-3 hover:bg-canvas">
              <ShieldCheck size={16} className="text-brand" />
              <span className="text-sm font-medium text-navy">Licensing &amp; Documents</span>
              <ArrowRight size={15} className="ml-auto text-status-neutral" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
