import { useRef, useState } from 'react'
import { UploadCloud, FileText, ExternalLink, Gavel, History, Send, Clock, MapPin, CheckCircle2, XCircle, Wallet } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import StatusBadge from '@/components/ui/StatusBadge'
import CaseStepper from '@/components/safety/CaseStepper'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import {
  useCases, casesStore, CASE_STAGE_META, DECISION_LABEL, INCIDENT_TYPE_META, SEVERITY_META,
  type Decision, type CaseFile,
} from '@/lib/safety/cases'
import { useDeductions, DEDUCTION_STATUS_META } from '@/lib/payroll/deductions'
import { useSpeedGeo } from '@/lib/speed/geo'
import { useSpeedEvents } from '@/lib/speed/store'
import { recommendationForEvent, penaltyLabel } from '@/lib/speed/types'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const ALL_DECISIONS = Object.keys(DECISION_LABEL) as Decision[]

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-status-neutral">{label}</div><div className="text-sm text-navy">{value}</div></div>
}

export default function CaseModal({
  caseId, open, onClose, canPrepare, canVerdict,
}: {
  caseId: string | null
  open: boolean
  onClose: () => void
  canPrepare: boolean
  canVerdict: boolean
}) {
  const all = useCases()
  const deductions = useDeductions()
  const geoMap = useSpeedGeo()
  const speedEvents = useSpeedEvents()
  const c = all.find((x) => x.id === caseId) ?? null
  // Live recommendation, recomputed from the current events (the case's stored
  // rec_* is a snapshot at escalation and can be stale — see the Speed Events page).
  const liveRec = c && c.source === 'speed' ? recommendationForEvent(speedEvents, c.event_id) : null
  const chargeRef = useRef<HTMLInputElement>(null)
  const excRef = useRef<HTMLInputElement>(null)
  const memoRef = useRef<HTMLInputElement>(null)
  const reportRef = useRef<HTMLInputElement>(null)
  const fineRef = useRef<HTMLInputElement>(null)

  // Safety (propose) inputs
  const [report, setReport] = useState('')
  const [propDecisions, setPropDecisions] = useState<Decision[]>([])
  const [propFine, setPropFine] = useState(0)
  // Ops (decide) inputs
  const [opsDecisions, setOpsDecisions] = useState<Decision[]>([])
  const [opsFine, setOpsFine] = useState(0)
  const [opsNotes, setOpsNotes] = useState('')
  const [toPayroll, setToPayroll] = useState(true)
  const [fineFile, setFineFile] = useState<CaseFile | null>(null)
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState('')

  // Seed inputs when the open case changes.
  const [lastId, setLastId] = useState('')
  if (open && c && c.id !== lastId) {
    setLastId(c.id)
    setReport(c.safety_report)
    setPropDecisions(c.proposal?.decisions ?? [])
    setPropFine(c.proposal?.fine_amount ?? liveRec?.fine ?? c.rec_fine ?? 0)
    setOpsDecisions(c.proposal?.decisions ?? [])
    setOpsFine(c.proposal?.fine_amount ?? 0)
    setOpsNotes('')
    setToPayroll(true)
    setFineFile(null)
    setMode(null)
    setRejectReason('')
    setError('')
  }

  if (!c) return null
  const history = casesStore.historyForDriver(c.driver_id, c.driver_name, c.id)
  const isSpeed = c.source === 'speed'
  const geo = isSpeed ? geoMap[c.event_id] : undefined
  const typeMeta = INCIDENT_TYPE_META[c.incident_type]
  const deduction = deductions.find((d) => d.incident_id === c.id)

  async function uploadCaseFile(kind: 'charge' | 'exc' | 'memo' | 'report', file: File) {
    const fileId = `${c!.id}_${kind}_${Date.now()}`.replace(/\s/g, '')
    await putFile(fileId, file)
    const payload: CaseFile = { file_id: fileId, file_name: file.name }
    const patch = kind === 'charge' ? { charge_statement: payload }
      : kind === 'exc' ? { exculpatory: payload }
      : kind === 'report' ? { incident_report: payload }
      : { memo: payload }
    const label = kind === 'charge' ? 'Charge statement attached' : kind === 'exc' ? 'Exculpatory form attached' : kind === 'report' ? 'Incident report attached' : 'Memo attached'
    casesStore.update(c!.id, patch)
    casesStore.log(c!.id, label, file.name)
  }
  async function uploadFineDoc(file: File) {
    const fileId = `${c!.id}_fine_${Date.now()}`.replace(/\s/g, '')
    await putFile(fileId, file)
    setFineFile({ file_id: fileId, file_name: file.name })
  }
  async function view(f: CaseFile | null) {
    if (f && (await viewFile(f.file_id, f.file_name))) return
    alert('No file attached.')
  }
  const toggle = (arr: Decision[], set: (v: Decision[]) => void, d: Decision) =>
    set(arr.includes(d) ? arr.filter((x) => x !== d) : [...arr, d])

  function sendToOps() {
    if (!report.trim()) return setError('Write the investigation report before sending to Ops.')
    if (isSpeed && !c!.charge_statement && !c!.memo) return setError('Attach the charge statement (or a memo) first.')
    if (propDecisions.includes('fine') && propFine <= 0) return setError('Enter the proposed fine amount.')
    casesStore.update(c!.id, { safety_report: report })
    casesStore.sendToOps(c!.id, { decisions: propDecisions, fine_amount: propDecisions.includes('fine') ? propFine : 0 })
    onClose()
  }
  function approve() {
    if (opsDecisions.length === 0) return setError('Select at least one decision to approve.')
    if (opsDecisions.includes('fine') && opsFine <= 0) return setError('Enter the fine amount.')
    if (opsDecisions.includes('fine') && !fineFile) return setError('Attach the fine documentation.')
    casesStore.approve(c!.id, {
      decisions: opsDecisions,
      fine_amount: opsDecisions.includes('fine') ? opsFine : 0,
      fine_file: fineFile,
      to_payroll: opsDecisions.includes('fine') ? toPayroll : false,
      notes: opsNotes,
    })
    onClose()
  }
  function reject() {
    if (!rejectReason.trim()) return setError('Give a reason for rejecting the proposed verdict.')
    casesStore.reject(c!.id, rejectReason)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={c.title || `${typeMeta.label} — ${c.driver_name || 'Incident'}`}
      subtitle={`${c.event_datetime.replace('T', ' ')}${c.vehicle_label ? ` · ${c.vehicle_label}` : ''}${c.route ? ` · ${c.route}` : ''}`}
    >
      {error && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={CASE_STAGE_META[c.stage].tone}>{CASE_STAGE_META[c.stage].label}</StatusBadge>
        <StatusBadge tone={typeMeta.tone}>{typeMeta.label}</StatusBadge>
        <span className="rounded-full bg-navy/5 px-2.5 py-0.5 text-xs font-medium text-navy">{isSpeed ? 'Escalated from speed' : 'Registered by Safety'}</span>
        {isSpeed && c.over_by != null && <span className="rounded-full bg-status-critical/10 px-2.5 py-0.5 text-xs font-medium text-status-critical">+{c.over_by} km/h over</span>}
        {!isSpeed && c.severity && <StatusBadge tone={SEVERITY_META[c.severity].tone}>{SEVERITY_META[c.severity].label} severity</StatusBadge>}
        {(c.repeat_total ?? 0) >= 2 && <span className="rounded-full bg-status-critical/10 px-2.5 py-0.5 text-xs font-bold text-status-critical">Repeat offender ×{c.repeat_total}</span>}
      </div>

      {/* Where the case is in the process */}
      <div className="mb-5 rounded-xl border border-black/10 bg-canvas/40 px-4 py-3.5">
        <CaseStepper stage={c.stage} />
      </div>

      {/* System recommendation — recomputed live so it stays correct as the driver's offences change */}
      {isSpeed && (
        <div className="mb-4 rounded-xl border border-brand/30 bg-brand-tint/40 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8a4513]">System recommendation</div>
          <div className="mt-0.5 text-sm font-bold text-navy">{liveRec ? penaltyLabel(liveRec) : `${c.rec_action}${(c.rec_fine ?? 0) > 0 ? ` · K${c.rec_fine!.toLocaleString()}` : ''}`}</div>
          <div className="text-xs text-status-neutral">{liveRec?.bandKey ?? c.rec_band} km/h band · offence #{liveRec?.offence ?? c.rec_offence} in band · {c.repeat_total} total prior offence(s)</div>
        </div>
      )}

      {/* Details */}
      {isSpeed ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Row label="Recorded" value={`${c.recorded_speed} km/h`} />
          <Row label="Limit" value={`${c.speed_limit} km/h`} />
          <Row label="Over by" value={`${c.over_by} km/h`} />
          <Row label="Branch" value={c.branch === 'kansanshi' ? 'Kansanshi' : 'Trident'} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Row label="Type" value={typeMeta.label} />
            <Row label="Driver" value={c.driver_name || '—'} />
            <Row label="Vehicle" value={c.vehicle_label || '—'} />
            <Row label="Branch" value={c.branch === 'kansanshi' ? 'Kansanshi' : 'Trident'} />
          </div>
          {c.description && <Row label="What happened" value={c.description} />}
        </div>
      )}

      {/* Geotab detail — how long, how far, and where it happened (carried from the speed event) */}
      {isSpeed && geo && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-black/10 bg-canvas px-3 py-2 text-xs text-status-neutral">
          <span className="inline-flex items-center gap-1"><Clock size={13} /> <span className="font-medium text-navy">{geo.dur}s</span> over the limit</span>
          <span><span className="font-medium text-navy">{geo.dist.toFixed(2)} km</span> while speeding</span>
          {(geo.lat !== 0 || geo.lng !== 0) && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}</span>}
          {geo.loc && <span className="font-medium text-navy">{geo.loc}</span>}
        </div>
      )}

      {/* Driver precedent */}
      {history.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-status-neutral"><History size={13} /> Past verdicts for this driver</div>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-left text-sm">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-black/5 last:border-0">
                    <td className="px-3 py-1.5 text-navy">{h.event_datetime.slice(0, 10)}</td>
                    <td className="px-3 py-1.5 text-status-neutral">{INCIDENT_TYPE_META[h.incident_type].label}</td>
                    <td className="px-3 py-1.5 text-navy">{h.verdict?.outcome === 'rejected' ? 'Rejected' : (h.verdict?.decisions.map((d) => DECISION_LABEL[d]).join(', ') || '—')}</td>
                    <td className="px-3 py-1.5 text-right text-status-neutral">{h.verdict?.fine_amount ? `K${h.verdict.fine_amount.toLocaleString()}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Safety report (read once written) */}
      {c.safety_report && c.stage !== 'safety_review' && (
        <div className="mt-5 rounded-xl border border-black/10 bg-canvas/40 p-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-status-neutral">Safety report</div>
          <p className="whitespace-pre-wrap text-sm text-navy">{c.safety_report}</p>
        </div>
      )}

      {/* Evidence */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Evidence</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {!isSpeed && <EvidenceSlot label="Incident report" file={c.incident_report} canEdit={canPrepare && c.stage !== 'closed'} onPick={() => reportRef.current?.click()} onView={() => view(c.incident_report)} />}
          <EvidenceSlot label="Charge statement" file={c.charge_statement} canEdit={canPrepare && c.stage === 'safety_review'} onPick={() => chargeRef.current?.click()} onView={() => view(c.charge_statement)} />
          <EvidenceSlot label="Driver exculpatory form" file={c.exculpatory} canEdit={canPrepare && c.stage === 'safety_review'} onPick={() => excRef.current?.click()} onView={() => view(c.exculpatory)} />
          <EvidenceSlot label="Memo" file={c.memo} canEdit={canPrepare && c.stage === 'safety_review'} onPick={() => memoRef.current?.click()} onView={() => view(c.memo)} />
        </div>
        <input ref={reportRef} type="file" accept=".pdf,image/*,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCaseFile('report', e.target.files[0])} />
        <input ref={chargeRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCaseFile('charge', e.target.files[0])} />
        <input ref={excRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCaseFile('exc', e.target.files[0])} />
        <input ref={memoRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCaseFile('memo', e.target.files[0])} />
      </div>

      {/* ── Stage: Safety review (write report + propose verdict) ── */}
      {c.stage === 'safety_review' && canPrepare && (
        <div className="mt-4 rounded-xl border border-black/10 bg-canvas/50 p-4">
          <div className="mb-2 text-sm font-bold text-navy">Investigation &amp; proposed verdict</div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-navy">Report (after speaking with the driver)</span>
            <textarea className={inputCls} rows={3} value={report} onChange={(e) => setReport(e.target.value)} placeholder="Summary of the incident, the driver's account, and your recommendation…" />
          </label>
          <div className="mt-3">
            <span className="mb-1 block text-xs font-medium text-navy">Propose a verdict for Ops to approve</span>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {ALL_DECISIONS.map((d) => (
                <label key={d} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-navy">
                  <input type="checkbox" checked={propDecisions.includes(d)} onChange={() => toggle(propDecisions, setPropDecisions, d)} />
                  {DECISION_LABEL[d]}
                </label>
              ))}
            </div>
            {propDecisions.includes('fine') && (
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium text-navy">Proposed fine (K)</span>
                <input type="number" className={inputCls} value={propFine || ''} onChange={(e) => setPropFine(Number(e.target.value))} />
              </label>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-status-neutral">Ops approves or rejects your proposal.</span>
            <Button onClick={sendToOps}><Send size={14} /> Send to Ops</Button>
          </div>
        </div>
      )}
      {c.stage === 'safety_review' && !canPrepare && (
        <div className="mt-4 rounded-xl border border-black/10 bg-canvas/50 p-4 text-xs text-status-neutral">With Safety for investigation and a proposed verdict.</div>
      )}

      {/* ── Stage: Ops decision (approve / reject) ── */}
      {c.stage === 'ops_review' && (
        <div className="mt-4 rounded-xl border border-black/10 bg-canvas/50 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy"><Gavel size={15} className="text-brand" /> Ops Manager decision</div>

          {/* Safety's proposal */}
          {c.proposal && (
            <div className="mb-3 rounded-lg border border-brand/30 bg-brand-tint/40 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8a4513]">Safety's proposed verdict</div>
              <div className="text-sm font-bold text-navy">{c.proposal.decisions.map((d) => DECISION_LABEL[d]).join(', ') || 'No action'}{c.proposal.fine_amount ? ` · K${c.proposal.fine_amount.toLocaleString()}` : ''}</div>
              <div className="text-[11px] text-status-neutral">Proposed by {c.proposal.proposed_by}</div>
            </div>
          )}

          {!canVerdict && <p className="text-xs text-status-neutral">Awaiting the Operations Manager's decision.</p>}
          {canVerdict && mode === null && (
            <div className="flex gap-2">
              <Button onClick={() => { setMode('approve'); setError('') }}><CheckCircle2 size={14} /> Approve</Button>
              <Button variant="danger" onClick={() => { setMode('reject'); setError('') }}><XCircle size={14} /> Reject</Button>
            </div>
          )}

          {canVerdict && mode === 'approve' && (
            <>
              <div className="mb-1 text-xs font-medium text-navy">Confirm the decision (adjust if needed)</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {ALL_DECISIONS.map((d) => (
                  <label key={d} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-navy">
                    <input type="checkbox" checked={opsDecisions.includes(d)} onChange={() => toggle(opsDecisions, setOpsDecisions, d)} />
                    {DECISION_LABEL[d]}
                  </label>
                ))}
              </div>
              {opsDecisions.includes('fine') && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-navy">Fine amount (K)</span>
                    <input type="number" className={inputCls} value={opsFine || ''} onChange={(e) => setOpsFine(Number(e.target.value))} />
                  </label>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-navy">Fine documentation</span>
                    {fineFile ? (
                      <button onClick={() => view(fineFile)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> {fineFile.file_name} <ExternalLink size={11} /></button>
                    ) : (
                      <button onClick={() => fineRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs text-status-neutral hover:border-brand hover:text-brand"><UploadCloud size={14} /> Attach</button>
                    )}
                    <input ref={fineRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFineDoc(e.target.files[0])} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-navy sm:col-span-2">
                    <input type="checkbox" checked={toPayroll} onChange={(e) => setToPayroll(e.target.checked)} />
                    <Wallet size={14} className="text-status-neutral" /> Deduct this fine from the driver's payroll
                  </label>
                </div>
              )}
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium text-navy">Decision notes</span>
                <textarea className={inputCls} rows={2} value={opsNotes} onChange={(e) => setOpsNotes(e.target.value)} />
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMode(null)}>Back</Button>
                <Button onClick={approve}><CheckCircle2 size={14} /> Approve &amp; close</Button>
              </div>
            </>
          )}

          {canVerdict && mode === 'reject' && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-navy">Reason for rejection</span>
                <textarea className={inputCls} rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Why the proposed verdict is rejected (sent back as the closing note)…" />
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMode(null)}>Back</Button>
                <Button variant="danger" onClick={reject}><XCircle size={14} /> Reject &amp; close</Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Stage: Closed ── */}
      {c.stage === 'closed' && c.verdict && (
        <div className={`mt-4 rounded-xl border p-4 ${c.verdict.outcome === 'approved' ? 'border-status-good/30 bg-status-good/5' : 'border-status-critical/30 bg-status-critical/5'}`}>
          <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-navy">
            {c.verdict.outcome === 'approved' ? <CheckCircle2 size={15} className="text-status-good" /> : <XCircle size={15} className="text-status-critical" />}
            Verdict {c.verdict.outcome}
          </div>
          {c.verdict.outcome === 'approved' ? (
            <div className="text-sm text-navy">{c.verdict.decisions.map((d) => DECISION_LABEL[d]).join(', ')}{c.verdict.fine_amount ? ` · K${c.verdict.fine_amount.toLocaleString()}` : ''}</div>
          ) : (
            <div className="text-sm text-navy">Proposed verdict rejected.</div>
          )}
          {c.verdict.notes && <p className="mt-1 text-xs text-status-neutral">{c.verdict.notes}</p>}
          {c.verdict.fine_file && (
            <button onClick={() => view(c.verdict!.fine_file)} className="mt-1 inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> {c.verdict.fine_file.file_name} <ExternalLink size={11} /></button>
          )}
          {deduction && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-navy">
              <Wallet size={13} className="text-status-neutral" /> Payroll deduction K{deduction.amount.toLocaleString()}
              <StatusBadge tone={DEDUCTION_STATUS_META[deduction.status].tone}>{DEDUCTION_STATUS_META[deduction.status].label}</StatusBadge>
            </div>
          )}
          <p className="mt-1 text-[11px] text-status-neutral">Decided by {c.verdict.decided_by} on {new Date(c.verdict.decided_at).toLocaleDateString()}</p>
        </div>
      )}

      {/* Audit trail */}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-status-neutral"><Clock size={13} /> Audit trail</div>
        <ol className="relative space-y-3 border-l border-black/10 pl-4">
          {(c.trail ?? []).map((ev, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-white" />
              <div className="text-sm font-medium text-navy">{ev.action}</div>
              {ev.detail && <div className="text-xs text-status-neutral">{ev.detail}</div>}
              <div className="text-[11px] text-status-neutral">{new Date(ev.at).toLocaleString()} · {ev.by}</div>
            </li>
          ))}
          {(c.trail ?? []).length === 0 && <li className="text-xs text-status-neutral">No actions recorded yet.</li>}
        </ol>
      </div>

      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </Modal>
  )
}

function EvidenceSlot({ label, file, canEdit, onPick, onView }: { label: string; file: CaseFile | null; canEdit: boolean; onPick: () => void; onView: () => void }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-3">
      <div className="mb-1.5 text-xs font-medium text-navy">{label}</div>
      {file ? (
        <button onClick={onView} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> {file.file_name} <ExternalLink size={11} /></button>
      ) : canEdit ? (
        <button onClick={onPick} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs text-status-neutral hover:border-brand hover:text-brand"><UploadCloud size={14} /> Attach</button>
      ) : (
        <span className="text-xs text-status-neutral">Not attached</span>
      )}
    </div>
  )
}
