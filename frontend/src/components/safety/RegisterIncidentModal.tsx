import { useRef, useState } from 'react'
import { UploadCloud, FileText, ExternalLink } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { BranchCode } from '@/lib/roles'
import { putFile, viewFile } from '@/lib/storage/fileStore'
import { useDrivers } from '@/lib/drivers/store'
import { useVehicles } from '@/lib/fleet/store'
import {
  casesStore, INCIDENT_TYPE_META, MANUAL_INCIDENT_TYPES, SEVERITY_META,
  type IncidentType, type IncidentSeverity, type CaseFile,
} from '@/lib/safety/cases'

const inputCls = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-brand'
const SEVERITIES = Object.keys(SEVERITY_META) as IncidentSeverity[]

/** Safety registers an incident directly (near miss, accident, injury, …). */
export default function RegisterIncidentModal({ open, onClose, branch }: { open: boolean; onClose: () => void; branch: BranchCode }) {
  const drivers = useDrivers().filter((d) => d.branch === branch)
  const vehicles = useVehicles().filter((v) => v.branch === branch)

  const [type, setType] = useState<IncidentType>('near_miss')
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const [location, setLocation] = useState('')
  const [driverId, setDriverId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [severity, setSeverity] = useState<IncidentSeverity>('medium')
  const [description, setDescription] = useState('')
  const [report, setReport] = useState<CaseFile | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [seen, setSeen] = useState(false)
  if (open && !seen) {
    setSeen(true)
    setType('near_miss'); setTitle(''); setWhen(''); setLocation(''); setDriverId(''); setVehicleId(''); setSeverity('medium'); setDescription(''); setReport(null); setError('')
  }
  if (!open && seen) setSeen(false)

  async function uploadReport(file: File) {
    const id = `increp_${Date.now()}`.replace(/\s/g, '')
    await putFile(id, file)
    setReport({ file_id: id, file_name: file.name })
  }

  function save() {
    if (!title.trim()) return setError('Give the incident a short title.')
    if (!when) return setError('When did it happen?')
    const driver = drivers.find((d) => d.id === driverId)
    const vehicle = vehicles.find((v) => v.id === vehicleId)
    casesStore.createManual({
      branch, incident_type: type, title: title.trim(), description: description.trim(),
      route: location.trim(), event_datetime: when,
      driver_id: driverId, driver_name: driver?.full_name ?? '',
      vehicle_label: vehicle?.fleet_no ?? '', severity, incident_report: report,
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Register incident"
      subtitle="Log a safety incident — it then follows the investigation → Ops decision workflow."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Register</Button></>}
    >
      {error && <div className="mb-4 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">{error}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Incident type *</span>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
            {MANUAL_INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_META[t].label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Severity</span>
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-navy">Title *</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Near miss at Sentinel pickup point" />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Date &amp; time *</span>
          <input type="datetime-local" className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Location / area</span>
          <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Driver (if any)</span>
          <select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">— none —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-navy">Vehicle (if any)</span>
          <select className={inputCls} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">— none —</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.fleet_no}</option>)}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-navy">What happened</span>
          <textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-navy">Incident report</span>
          {report ? (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => viewFile(report.file_id, report.file_name)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><FileText size={14} /> {report.file_name} <ExternalLink size={11} /></button>
              <button type="button" onClick={() => setReport(null)} className="text-xs text-status-neutral hover:text-status-critical">Remove</button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-navy/25 px-3 py-1.5 text-xs text-status-neutral hover:border-brand hover:text-brand"><UploadCloud size={14} /> Upload report</button>
          )}
          <input ref={fileRef} type="file" accept=".pdf,image/*,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && uploadReport(e.target.files[0])} />
          <p className="mt-1 text-[11px] text-status-neutral">Attach the near-miss / incident report or photos (optional — can also be added later).</p>
        </div>
      </div>
    </Modal>
  )
}
