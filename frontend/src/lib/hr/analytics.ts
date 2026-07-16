import type { StatusTone } from '@/components/ui/StatusBadge'
import { leaveStats, type LeaveEntry, type LeaveStats } from '@/lib/hr/leaveLedger'
import type { DisciplinaryCase } from '@/lib/safety/cases'
import type { PayrollDeduction } from '@/lib/payroll/deductions'

/**
 * Per-person HR risk assessment — turns leave patterns and conduct into a simple,
 * defensible flag so HR can spot who needs a conversation. Deliberately graduated
 * and neutral in wording ("Monitor" / "At risk"), not a blunt "liability" label:
 * it lists the specific reasons so it can be acted on, not just judged.
 */
export type RiskTier = 'low' | 'watch' | 'high'
export const RISK_META: Record<RiskTier, { label: string; tone: StatusTone }> = {
  low: { label: 'Good standing', tone: 'good' },
  watch: { label: 'Monitor', tone: 'warning' },
  high: { label: 'At risk', tone: 'critical' },
}

export interface RiskAssessment {
  tier: RiskTier
  score: number
  reasons: string[]
  leave: LeaveStats
  disciplinary: number // closed cases with an upheld outcome
  fines: number
  absenceDays: number  // sick + unpaid + compassionate days (unplanned-ish)
}

/** Disciplinary cases upheld (approved, not "cleared") for a person. */
function upheldCases(cases: DisciplinaryCase[], personId: string, personName: string): number {
  return cases.filter((c) =>
    c.stage === 'closed' && c.verdict?.outcome === 'approved' && !c.verdict.decisions.includes('cleared') &&
    (personId ? c.driver_id === personId : c.driver_name === personName)).length
}

export function assessRisk(opts: {
  personId: string; personName: string; ledger: LeaveEntry[]; cases: DisciplinaryCase[]; deductions: PayrollDeduction[]; year: number
}): RiskAssessment {
  const { personId, personName, ledger, cases, deductions, year } = opts
  const leave = leaveStats(ledger, personId, year)
  const disciplinary = upheldCases(cases, personId, personName)
  const fines = deductions.filter((d) => (personId ? d.driver_id === personId : d.driver_name === personName)).length
  const unsupportedSick = Math.max(0, leave.sickSpells - leave.sickNotes)
  const absenceDays = leave.byType.sick.days + leave.byType.unpaid.days + leave.byType.compassionate.days

  const reasons: string[] = []
  let score = 0
  if (leave.sickSpells >= 3) { score++; reasons.push(`${leave.sickSpells} sick spells this year`) }
  if (unsupportedSick >= 2) { score++; reasons.push(`${unsupportedSick} sick spells with no note`) }
  if (leave.spells >= 6) { score++; reasons.push(`${leave.spells} leave spells this year`) }
  if (absenceDays >= 15) { score++; reasons.push(`${absenceDays} sick/unpaid days this year`) }
  if (disciplinary > 0) { score += Math.min(2, disciplinary); reasons.push(`${disciplinary} disciplinary outcome${disciplinary === 1 ? '' : 's'}`) }
  if (fines >= 2) { score++; reasons.push(`${fines} fines on record`) }

  const tier: RiskTier = score >= 3 ? 'high' : score === 2 ? 'watch' : 'low'
  return { tier, score, reasons, leave, disciplinary, fines, absenceDays }
}
