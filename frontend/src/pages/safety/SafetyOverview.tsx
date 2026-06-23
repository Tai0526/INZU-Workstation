import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert, AlertTriangle, ClipboardCheck, GraduationCap, Lock, Wrench, ChevronRight } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ROLES, BRANCHES } from '@/lib/roles'
import KpiCard from '@/components/ui/KpiCard'
import StatusBadge from '@/components/ui/StatusBadge'
import { useCases, CASE_STAGE_META, CASE_STEPS, currentStepIndex, INCIDENT_TYPE_META } from '@/lib/safety/cases'
import {
  useHazards, riskScore, riskBand, HAZARD_STATUS_META,
  useCap, capProgress,
  useCompliance, useTraining, useComplianceClasses, classMap, credStatus, CRED_STATUS_META, TRAINING_META, type Credential,
  useLoto, lotoStatus, LOTO_STATUS_META,
  useTools, inspectionDue, TOOL_CONDITION_META,
} from '@/lib/safety/registers'

function Card({ title, to, icon, children }: { title: string; to?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
        {icon}
        <h3 className="font-display text-sm font-bold text-navy">{title}</h3>
        {to && <Link to={to} className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline">Open <ChevronRight size={13} /></Link>}
      </div>
      {children}
    </div>
  )
}

export default function SafetyOverview() {
  const { user } = useAuth()
  const role = user!.role
  const branch = user!.branch
  const branchLabel = BRANCHES.find((b) => b.code === branch)!.short
  const canToggle = ROLES[role].canToggleBranch

  const cases = useCases().filter((c) => c.branch === branch)
  const hazards = useHazards().filter((h) => h.branch === branch)
  const cap = useCap().filter((f) => f.branch === branch)
  const compliance = useCompliance().filter((c) => c.branch === branch)
  const training = useTraining().filter((t) => t.branch === branch)
  const classByKey = classMap(useComplianceClasses())
  const loto = useLoto().filter((p) => p.branch === branch)
  const tools = useTools().filter((t) => t.branch === branch)

  const openCases = cases.filter((c) => c.stage !== 'closed')
  const openHazards = hazards.filter((h) => h.status !== 'closed')
  const highRisk = openHazards.filter((h) => riskScore(h) >= 10)
  const capCompliant = cap.filter((f) => f.status === 'compliant').length
  const capPct = cap.length ? Math.round((capCompliant / cap.length) * 100) : 0
  const expiries = useMemo(() => {
    // Compliance: only flag classes that actually carry an expiry, and only when
    // they're expiring/expired (a no-expiry class isn't "missing a certificate").
    const comp = compliance
      .filter((c) => classByKey[c.category]?.has_expiry)
      .map((c) => { const st = credStatus(c.expiry); return st === 'expired' || st === 'expiring' ? { ...c, kind: 'Compliance', st } : null })
    const train = training.map((c) => { const st = credStatus(c.expiry); return st === 'expired' || st === 'expiring' || st === 'missing' ? { ...c, kind: 'Training', st } : null })
    return [...comp, ...train].filter(Boolean) as (Credential & { kind: string; st: ReturnType<typeof credStatus> })[]
  }, [compliance, training, classByKey])
  const lotoOverdue = loto.filter((p) => lotoStatus(p) !== 'compliant')
  const toolsAttention = tools.filter((t) => t.condition === 'defective' || !t.safe_to_use || inspectionDue(t))

  const labelFor = (c: Credential & { kind: string }) => (c.kind === 'Compliance' ? classByKey[c.category]?.label : TRAINING_META[c.category]) ?? c.category

  return (
    <div className="page space-y-6">
      <p className="max-w-2xl text-sm text-status-neutral">
        {branchLabel} safety snapshot — disciplinary incidents, hazards, the FQM CAP, driver compliance &amp; training,
        LOTO and tool inspections, rolled up live from each register below.
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Open incidents" value={openCases.length} tone={openCases.length ? 'critical' : 'good'} sub="awaiting action" info="Disciplinary cases not yet closed." />
        <KpiCard label="Open hazards" value={openHazards.length} tone={openHazards.length ? 'warning' : 'good'} sub={`${highRisk.length} high/extreme`} />
        <KpiCard label="CAP completion" value={`${capPct}%`} tone={capPct === 100 ? 'good' : capPct >= 50 ? 'warning' : 'critical'} sub={`${capCompliant}/${cap.length} compliant`} />
        <KpiCard label="Expiring / expired" value={expiries.length} tone={expiries.length ? 'warning' : 'good'} sub="compliance & training" />
        <KpiCard label="LOTO needing audit" value={lotoOverdue.length} tone={lotoOverdue.length ? 'critical' : 'good'} sub="due or overdue" />
        <KpiCard label="Tools to action" value={toolsAttention.length} tone={toolsAttention.length ? 'warning' : 'good'} sub="defective / unsafe / due" />
      </div>

      {/* Incidents + Hazards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Disciplinary incidents" to="/safety/incidents" icon={<ShieldAlert size={16} className="text-status-critical" />}>
          {cases.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-status-neutral">No incidents raised. Confirm a speed event and escalate it to start a case.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {cases.slice(0, 5).map((c) => (
                <Link key={c.id} to="/safety/incidents" className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-navy">
                      {c.title || c.driver_name || INCIDENT_TYPE_META[c.incident_type].label}
                      {c.source === 'speed' && c.over_by != null && <span className="text-status-critical"> · +{c.over_by} km/h</span>}
                    </div>
                    <div className="text-xs text-status-neutral">
                      {INCIDENT_TYPE_META[c.incident_type].label} · Step {currentStepIndex(c.stage) + 1}/{CASE_STEPS.length} · {CASE_STEPS[currentStepIndex(c.stage)]}
                    </div>
                  </div>
                  <StatusBadge tone={CASE_STAGE_META[c.stage].tone}>{CASE_STAGE_META[c.stage].label}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Top open hazards" to="/safety/hazards" icon={<AlertTriangle size={16} className="text-status-warning" />}>
          {openHazards.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-status-neutral">No open hazards.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {[...openHazards].sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 5).map((h) => {
                const band = riskBand(riskScore(h))
                return (
                  <Link key={h.id} to="/safety/hazards" className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-navy">{h.location}</div>
                      <div className="truncate text-xs text-status-neutral">{h.description}</div>
                    </div>
                    <StatusBadge tone={band.tone}>{band.label} · {riskScore(h)}</StatusBadge>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* CAP progress */}
      <Card title="FQM CAP tracker" to="/safety/cap" icon={<ClipboardCheck size={16} className="text-brand" />}>
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-status-neutral">Overall completion</span>
            <span className="font-bold text-navy">{capPct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-status-good transition-[width]" style={{ width: `${capPct}%` }} />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {cap.filter((f) => f.status !== 'compliant').slice(0, 6).map((f) => (
              <Link key={f.id} to="/safety/cap" className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 hover:bg-canvas">
                <span className="rounded bg-navy/5 px-1.5 py-0.5 text-[11px] font-bold text-navy">{f.ref}</span>
                <span className="flex-1 truncate text-sm text-navy">{f.title}</span>
                <span className="text-xs text-status-neutral">{Math.round(capProgress(f) * 100)}%</span>
              </Link>
            ))}
            {cap.filter((f) => f.status !== 'compliant').length === 0 && <p className="text-sm text-status-good">All findings compliant.</p>}
          </div>
        </div>
      </Card>

      {/* Expiries + LOTO/Tools */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Compliance & training to renew" icon={<GraduationCap size={16} className="text-status-warning" />}>
          {expiries.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-status-neutral">Everything current.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {expiries.sort((a, b) => (a.expiry || '9').localeCompare(b.expiry || '9')).slice(0, 6).map((c) => (
                <Link key={c.id} to={c.kind === 'Compliance' ? '/safety/compliance' : '/safety/training'} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-navy">{c.driver_name}</div>
                    <div className="text-xs text-status-neutral">{c.kind} · {labelFor(c)}{c.expiry ? ` · ${c.expiry}` : ''}</div>
                  </div>
                  <StatusBadge tone={CRED_STATUS_META[c.st].tone}>{CRED_STATUS_META[c.st].label}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="LOTO & tools needing attention" icon={<Lock size={16} className="text-status-critical" />}>
          {lotoOverdue.length === 0 && toolsAttention.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-status-neutral">No outstanding LOTO audits or tool issues.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {lotoOverdue.slice(0, 3).map((p) => (
                <Link key={p.id} to="/safety/loto" className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                  <Lock size={14} className="text-status-neutral" />
                  <div className="flex-1"><div className="text-sm font-medium text-navy">{p.asset}</div><div className="text-xs text-status-neutral">{p.label_code}</div></div>
                  <StatusBadge tone={LOTO_STATUS_META[lotoStatus(p)].tone}>{LOTO_STATUS_META[lotoStatus(p)].label}</StatusBadge>
                </Link>
              ))}
              {toolsAttention.slice(0, 3).map((t) => (
                <Link key={t.id} to="/safety/tools" className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                  <Wrench size={14} className="text-status-neutral" />
                  <div className="flex-1"><div className="text-sm font-medium text-navy">{t.tool_name}</div><div className="text-xs text-status-neutral">{t.asset_tag}{inspectionDue(t) ? ' · inspection due' : ''}</div></div>
                  <StatusBadge tone={TOOL_CONDITION_META[t.condition].tone}>{!t.safe_to_use ? 'Unsafe' : TOOL_CONDITION_META[t.condition].label}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {!canToggle && <p className="text-xs text-status-neutral">Showing {branchLabel} only.</p>}
    </div>
  )
}
