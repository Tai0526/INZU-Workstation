import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, CalendarRange, IdCard, ChevronRight, AlertOctagon } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import { canEdit } from '@/lib/permissions'
import { SECTIONS } from '@/lib/org/sections'
import StatusBadge from '@/components/ui/StatusBadge'
import DriverDetail from '@/components/drivers/DriverDetail'
import DriverFormModal from '@/components/drivers/DriverFormModal'
import { useDrivers } from '@/lib/drivers/store'
import { type Driver, driverShiftState, complianceItems, worstExpiry, EXPIRY_TONE } from '@/lib/drivers/types'
import { useScheduling, crewShiftLabel } from '@/lib/drivers/scheduling'
import { useWeeklyAssign } from '@/lib/operations/store'
import { buildAssignmentIndex, dutyOn } from '@/lib/drivers/duty'
import { useDriverLeave } from '@/lib/drivers/leave'

/**
 * Drivers Overview — one card per page in the section: who is driving right
 * now (Roster), whether the days ahead are covered (Work Schedule), and whose
 * paperwork needs renewing (Profiles). Everything is derived with the same
 * helpers those pages use, so the numbers can never disagree.
 */

const STATE_STYLE = {
  on_shift: { bar: 'bg-status-good', label: 'On shift' },
  overtime: { bar: 'bg-status-warning', label: 'On overtime' },
  off: { bar: 'bg-status-neutral/50', label: 'Off duty' },
  leave: { bar: 'bg-navy', label: 'On leave' },
  suspended: { bar: 'bg-status-critical', label: 'Suspended' },
} as const
type StateKey = keyof typeof STATE_STYLE

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (base: string, n: number) => iso(new Date(new Date(`${base}T00:00:00Z`).getTime() + n * 86_400_000))
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
const shortDate = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—')

export default function DriversOverview() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const editable = canEdit(role, 'drivers')
  const canToggle = ROLES[role].canToggleBranch

  const all = useDrivers()
  const sched = useScheduling()
  const assigns = useWeeklyAssign()
  useDriverLeave() // re-render when a driver goes on / off leave
  const drivers = useMemo(() => all.filter((d) => d.branch === branch), [all, branch])
  const otIdx = useMemo(() => buildAssignmentIndex(assigns.filter((a) => a.branch === branch)), [assigns, branch])
  const today = iso(new Date())

  const [detail, setDetail] = useState<Driver | null>(null)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // ── Roster: who is driving right now ──
  const roster = useMemo(() => {
    const by: Record<StateKey, number> = { on_shift: 0, overtime: 0, off: 0, leave: 0, suspended: 0 }
    for (const d of drivers) {
      const s = driverShiftState(d)
      const ot = dutyOn(d, today, otIdx).kind === 'overtime' || d.overtime
      if (s === 'suspended') by.suspended++
      else if (s === 'leave') by.leave++
      else if (s === 'overtime' || ot) by.overtime++
      else if (s === 'on_shift') by.on_shift++
      else by.off++
    }
    // Crews with nobody in them would render "0 of 0 on" — noise, not insight.
    const crews = sched.crews.map((c) => ({
      id: c.id,
      label: c.label,
      shift: crewShiftLabel(sched, c.id) || '',
      total: drivers.filter((d) => d.crew === c.id).length,
      onNow: drivers.filter((d) => d.crew === c.id && driverShiftState(d) === 'on_shift').length,
    })).filter((c) => c.total > 0)
    const working = by.on_shift + by.overtime
    return { by, crews, working, total: drivers.length, active: drivers.filter((d) => d.status === 'active').length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, sched, otIdx, today])

  // ── Work Schedule: is the week ahead covered? ──
  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((date) => {
      let working = 0, overtime = 0, off = 0, away = 0
      for (const d of drivers) {
        const k = dutyOn(d, date, otIdx).kind
        if (k === 'worked') working++
        else if (k === 'overtime') { working++; overtime++ }
        else if (k === 'leave' || k === 'suspended') away++
        else off++
      }
      return { date, working, overtime, off, away }
    })
    const peak = Math.max(...days.map((d) => d.working), 1)
    const avg = days.reduce((s, d) => s + d.working, 0) / days.length
    // A day well under the week's own norm is where cover gets thin.
    const thin = days.filter((d) => d.working < avg * 0.75)
    return { days, peak, avg, thin }
  }, [drivers, otIdx, today])

  // ── Profiles: headcount and paperwork ──
  const profiles = useMemo(() => {
    const attention = drivers
      .map((d) => ({ d, items: complianceItems(d).filter((c) => c.status === 'expired' || c.status === 'expiring'), worst: worstExpiry(d) }))
      .filter((x) => x.items.length > 0)
      .sort((a, b) => {
        const rank = (w: string) => (w === 'expired' ? 0 : 1)
        if (rank(a.worst) !== rank(b.worst)) return rank(a.worst) - rank(b.worst)
        return (a.items[0]?.date ?? '').localeCompare(b.items[0]?.date ?? '')
      })
    const expired = attention.filter((a) => a.worst === 'expired').length
    const sections = SECTIONS[branch]
      .map((s) => ({ name: s, n: drivers.filter((d) => d.section === s).length }))
      .filter((s) => s.n > 0)
      .sort((a, b) => b.n - a.n)
    const unassigned = drivers.filter((d) => !d.section || !SECTIONS[branch].includes(d.section)).length
    return { attention, expired, expiring: attention.length - expired, sections, unassigned }
  }, [drivers, branch])

  const urgent = profiles.expired + roster.by.suspended

  function openDetail(d: Driver) { setDetail(d) }
  function openEdit(d: Driver) { setDetail(null); setEditing(d); setFormOpen(true) }

  return (
    <div className="page space-y-5">
      <p className="text-sm text-status-neutral">
        Who is driving for {branchLabel} today, whether the week ahead is covered, and whose paperwork needs renewing.
      </p>

      {/* Only shown when something genuinely needs acting on */}
      {urgent > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-status-critical/30 bg-status-critical/5 px-4 py-3 text-sm">
          <AlertOctagon size={16} className="shrink-0 text-status-critical" />
          {profiles.expired > 0 && (
            <Link to="/drivers/profiles" className="text-navy hover:underline">
              <b className="text-status-critical">{profiles.expired}</b> driver{profiles.expired === 1 ? '' : 's'} with expired paperwork — cannot drive
            </Link>
          )}
          {roster.by.suspended > 0 && (
            <Link to="/drivers/roster" className="text-navy hover:underline">
              <b className="text-status-critical">{roster.by.suspended}</b> suspended
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Driver Roster ── */}
        <SectionCard icon={Users} title="Driver Roster" to="/drivers/roster" linkLabel="Open roster">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-display text-3xl font-bold leading-none text-navy">{roster.working}</div>
              <div className="mt-1 text-[11px] text-status-neutral">inside their shift window right now — of {roster.total}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-xl font-bold leading-none text-[#8a6d10]">{roster.by.overtime}</div>
              <div className="mt-1 text-[11px] text-status-neutral">on overtime</div>
            </div>
          </div>

          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-black/5">
            {(Object.keys(STATE_STYLE) as StateKey[]).map((k) => (
              roster.by[k] > 0
                ? <div key={k} className={clsx('h-full', STATE_STYLE[k].bar)} style={{ width: `${(roster.by[k] / Math.max(1, roster.total)) * 100}%` }} title={`${STATE_STYLE[k].label}: ${roster.by[k]}`} />
                : null
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {(Object.keys(STATE_STYLE) as StateKey[]).filter((k) => roster.by[k] > 0).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-status-neutral">
                <span className={clsx('h-2 w-2 rounded-full', STATE_STYLE[k].bar)} />
                {STATE_STYLE[k].label} <b className="text-navy">{roster.by[k]}</b>
              </span>
            ))}
          </div>

          {roster.crews.length > 0 && (
            <div className="mt-4 border-t border-black/5 pt-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Crews</div>
              <div className="space-y-1.5">
                {roster.crews.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 font-medium text-navy">Crew {c.label}</span>
                    <span className="w-24 shrink-0 truncate text-[11px] text-status-neutral">{c.shift}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                      <div className="h-full rounded-full bg-status-good" style={{ width: `${(c.onNow / Math.max(1, c.total)) * 100}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-status-neutral"><b className="text-navy">{c.onNow}</b> of {c.total} on</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── Work Schedule ── */}
        <SectionCard icon={CalendarRange} title="Work Schedule" to="/drivers/schedule" linkLabel="Open schedule"
          note="Drivers rostered on for each of the next seven days — the rotation, not the clock.">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-display text-3xl font-bold leading-none text-navy">{Math.round(week.avg)}</div>
              <div className="mt-1 text-[11px] text-status-neutral">rostered on per day, on average</div>
            </div>
            <div className="text-right">
              <div className="font-display text-xl font-bold leading-none text-navy">{week.days[0].away}</div>
              <div className="mt-1 text-[11px] text-status-neutral">away today (leave / suspended)</div>
            </div>
          </div>

          <div className="mt-4 flex items-end gap-1.5">
            {week.days.map((d, i) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.working} on duty${d.overtime ? ` (incl. ${d.overtime} overtime)` : ''} · ${d.off} off · ${d.away} away`}>
                <span className="text-[10px] font-medium text-navy">{d.working}</span>
                <div className="flex h-24 w-full items-end overflow-hidden rounded-md bg-canvas">
                  <div className={clsx('w-full rounded-md transition-[height]', week.thin.includes(d) ? 'bg-status-warning' : i === 0 ? 'bg-brand' : 'bg-navy/70')}
                    style={{ height: `${Math.max(4, (d.working / week.peak) * 100)}%` }} />
                </div>
                <span className={clsx('text-[10px]', i === 0 ? 'font-semibold text-brand' : 'text-status-neutral')}>{i === 0 ? 'Today' : dayLabel(d.date)}</span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-status-neutral">
            {week.thin.length > 0
              ? <>Cover thins on <b className="text-[#8a6d10]">{week.thin.map((d) => (d.date === today ? 'today' : dayLabel(d.date))).join(', ')}</b> — worth checking the plan before those days.</>
              : <>Cover holds steady all week — no day falls meaningfully below the others.</>}
          </p>
        </SectionCard>
      </div>

      {/* ── Driver Profiles ── */}
      <SectionCard icon={IdCard} title="Driver Profiles" to="/drivers/profiles" linkLabel="Open profiles">
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="flex items-end gap-6">
              <div>
                <div className="font-display text-3xl font-bold leading-none text-navy">{roster.total}</div>
                <div className="mt-1 text-[11px] text-status-neutral">on the books · {roster.active} active</div>
              </div>
              <div>
                <div className={clsx('font-display text-xl font-bold leading-none', profiles.attention.length ? 'text-status-critical' : 'text-status-good')}>{profiles.attention.length}</div>
                <div className="mt-1 text-[11px] text-status-neutral">{profiles.expired} expired · {profiles.expiring} expiring</div>
              </div>
            </div>

            {profiles.sections.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">By section</div>
                <div className="space-y-1.5">
                  {profiles.sections.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 truncate text-navy" title={s.name}>{s.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${(s.n / Math.max(1, profiles.sections[0].n)) * 100}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right font-medium text-navy">{s.n}</span>
                    </div>
                  ))}
                  {profiles.unassigned > 0 && (
                    <p className="pt-0.5 text-[11px] text-[#8a6d10]">{profiles.unassigned} driver{profiles.unassigned === 1 ? '' : 's'} without a section.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-neutral">Licence &amp; PSV — renew next</div>
            {profiles.attention.length === 0 ? (
              <p className="rounded-lg bg-canvas px-3 py-6 text-center text-xs text-status-neutral">Every driver's licence and PSV are current.</p>
            ) : (
              <div className="divide-y divide-black/5 rounded-lg border border-black/10">
                {profiles.attention.slice(0, 5).map(({ d, items }) => (
                  <button key={d.id} onClick={() => openDetail(d)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-navy">{d.full_name}</div>
                      <div className="truncate text-[10px] text-status-neutral">{items.map((c) => `${c.label} ${shortDate(c.date)}`).join(' · ')}</div>
                    </div>
                    <StatusBadge tone={EXPIRY_TONE[items[0].status]}>{items[0].status}</StatusBadge>
                  </button>
                ))}
                {profiles.attention.length > 5 && (
                  <Link to="/drivers/profiles" className="block px-3 py-2 text-[11px] text-brand hover:underline">
                    +{profiles.attention.length - 5} more to renew
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only — your role is locked to this branch.</p>}

      <DriverDetail driver={detail} open={!!detail} onClose={() => setDetail(null)} canEdit={editable} onEdit={openEdit} />
      <DriverFormModal open={formOpen} onClose={() => setFormOpen(false)} editing={editing} lockedBranch={canToggle ? null : branch} activeBranch={branch} />
    </div>
  )
}

/** A card that summarises one page of the section and links straight to it. */
function SectionCard({ icon: Icon, title, to, linkLabel, note, children }: {
  icon: typeof Users; title: string; to: string; linkLabel: string; note?: string; children: React.ReactNode
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-brand" />
        <h2 className="font-display text-sm font-bold text-navy">{title}</h2>
        <Link to={to} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          {linkLabel} <ChevronRight size={13} />
        </Link>
      </div>
      {note && <p className="-mt-1.5 mb-3 text-[11px] text-status-neutral">{note}</p>}
      {children}
    </section>
  )
}
