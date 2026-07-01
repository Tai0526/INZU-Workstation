import { useMemo, useState } from 'react'
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, MapPin } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { BranchCode } from '@/lib/roles'
import { useVehicles } from '@/lib/fleet/store'
import { speedStore } from '@/lib/speed/store'
import { useSpeedGeo, speedGeoStore, type SpeedGeo } from '@/lib/speed/geo'
import { parseGeotab, type GeoParseResult } from '@/lib/speed/excel'
import type { SpeedEventInput } from '@/lib/speed/types'

const numCls = 'w-16 rounded-lg border border-black/15 bg-white px-2 py-1.5 text-sm font-semibold text-navy outline-none focus:border-brand'

export default function SpeedImportModal({ open, onClose, branch }: { open: boolean; onClose: () => void; branch: BranchCode }) {
  const vehicles = useVehicles().filter((v) => v.branch === branch)
  const geo = useSpeedGeo()
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GeoParseResult | null>(null)
  const [minOver, setMinOver] = useState(6)
  const [minDur, setMinDur] = useState(11)
  const [done, setDone] = useState<{ added: number; dupes: number; unmatched: number } | null>(null)

  function close() {
    setFileName(''); setResult(null); setDone(null); setBusy(false); setMinOver(6); setMinDur(11); onClose()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name); setBusy(true); setDone(null); setResult(null)
    try {
      setResult(await parseGeotab(file, vehicles))
    } catch {
      setResult({ format: 'unknown', candidates: [], total: 0, devices: 0, from: '', to: '', message: 'Could not read this file.' })
    } finally {
      setBusy(false)
    }
    e.target.value = ''
  }

  const existingRefs = useMemo(() => new Set(Object.values(geo).map((g) => g.ref).filter(Boolean)), [geo])

  // Apply the filter rules live, then split out duplicates already in the system.
  const meets = useMemo(
    () => (result?.candidates ?? []).filter((c) => c.over >= minOver && c.durSec >= minDur),
    [result, minOver, minDur],
  )
  const dupes = useMemo(() => meets.filter((c) => existingRefs.has(c.ref)).length, [meets, existingRefs])
  const toImport = useMemo(() => {
    const seen = new Set<string>()
    return meets.filter((c) => !existingRefs.has(c.ref) && !seen.has(c.ref) && seen.add(c.ref))
  }, [meets, existingRefs])
  const unmatched = toImport.filter((c) => !c.vehicle_id).length

  function commit() {
    if (toImport.length === 0) return
    const inputs: SpeedEventInput[] = toImport.map((c) => ({
      branch, event_datetime: c.startISO, driver_id: '', driver_name: '',
      vehicle_id: c.vehicle_id, vehicle_label: c.vehicle_label,
      route: c.loc, recorded_speed: c.maxSpeed, speed_limit: c.limit,
      status: 'pending', source: 'Geotab', notes: '',
      resolved_by: '', resolved_at: '',
    }))
    const created = speedStore.bulkAdd(inputs)
    const entries: Record<string, SpeedGeo> = {}
    created.forEach((ev, i) => {
      const c = toImport[i]
      entries[ev.id] = { lat: c.lat, lng: c.lng, dur: c.durSec, dist: c.distKm, ref: c.ref, loc: c.locFull }
    })
    speedGeoStore.setMany(entries)
    setDone({ added: created.length, dupes, unmatched })
    setResult(null)
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      title="Import Geotab overspeeding report"
      subtitle="Upload the daily .xlsx export. Events are filtered by your rules and land as “Pending driver”."
      footer={done ? <Button onClick={close}>Done</Button> : (
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={commit} disabled={toImport.length === 0}>Import {toImport.length} event{toImport.length === 1 ? '' : 's'}</Button>
        </>
      )}
    >
      {!done && !result && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy/20 bg-white px-6 py-10 text-center hover:border-brand">
          <UploadCloud size={28} className="text-brand" />
          <span className="text-sm font-medium text-navy">Click to choose the Geotab .xlsx report</span>
          <span className="text-xs text-status-neutral">{fileName || 'No file selected'}</span>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
        </label>
      )}

      {busy && <p className="mt-4 text-sm text-status-neutral">Reading report…</p>}

      {result?.format === 'unknown' && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">
          <AlertTriangle size={16} /> {result.message}
        </div>
      )}

      {result?.format === 'geotab' && (
        <div className="space-y-4">
          {/* Source summary */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-canvas px-4 py-2.5 text-sm">
            <span className="font-medium text-navy">{result.total.toLocaleString()} events</span>
            <span className="text-status-neutral">{result.devices} buses</span>
            <span className="text-status-neutral">{result.from} → {result.to}</span>
          </div>

          {/* Filter rules */}
          <div className="rounded-lg border border-black/10 px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-status-neutral">Upload rules — only events that break both</div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-navy">
              <label className="flex items-center gap-2">
                At least
                <input type="number" min={0} className={numCls} value={minOver} onChange={(e) => setMinOver(Math.max(0, Number(e.target.value) || 0))} />
                km/h over the limit
              </label>
              <label className="flex items-center gap-2">
                lasting at least
                <input type="number" min={0} className={numCls} value={minDur} onChange={(e) => setMinDur(Math.max(0, Number(e.target.value) || 0))} />
                seconds
              </label>
            </div>
          </div>

          {/* Result of the rules */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-status-good/30 bg-status-good/5 px-3 py-2">
              <div className="text-lg font-bold text-status-good">{toImport.length}</div>
              <div className="text-[11px] text-status-neutral">qualify to import</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-canvas px-3 py-2">
              <div className="text-lg font-bold text-navy">{dupes}</div>
              <div className="text-[11px] text-status-neutral">already imported</div>
            </div>
            <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2">
              <div className="text-lg font-bold text-[#8a6d10]">{unmatched}</div>
              <div className="text-[11px] text-status-neutral">bus not in fleet list</div>
            </div>
          </div>

          {/* Preview */}
          {toImport.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-black/10">
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-navy text-white">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">When</th>
                      <th className="px-2.5 py-1.5 font-medium">Bus</th>
                      <th className="px-2.5 py-1.5 font-medium">Speed</th>
                      <th className="px-2.5 py-1.5 font-medium">For</th>
                      <th className="px-2.5 py-1.5 font-medium">Where</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toImport.slice(0, 40).map((c, i) => (
                      <tr key={c.ref} className={i % 2 ? 'bg-canvas/40' : ''}>
                        <td className="whitespace-nowrap px-2.5 py-1 text-navy">{c.startISO.slice(5, 10)} <span className="text-status-neutral">{c.startISO.slice(11, 16)}</span></td>
                        <td className="whitespace-nowrap px-2.5 py-1">
                          <span className="font-medium text-navy">{c.vehicle_label}</span>
                          {!c.vehicle_id && <span title="Not matched to a vehicle in the fleet" className="ml-1 text-status-warning">•</span>}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1 text-navy">{c.maxSpeed}/{c.limit} <span className="font-semibold text-status-critical">+{c.over}</span></td>
                        <td className="whitespace-nowrap px-2.5 py-1 text-status-neutral">{c.durSec}s</td>
                        <td className="max-w-[220px] truncate px-2.5 py-1 text-status-neutral" title={c.locFull}>{c.loc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {toImport.length > 40 && <div className="bg-canvas px-3 py-1.5 text-center text-[11px] text-status-neutral">+{toImport.length - 40} more</div>}
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-status-neutral">
            <MapPin size={13} className="mt-0.5 shrink-0" />
            The report has no driver, so each event imports as <span className="font-medium text-navy">Pending driver</span>. Confirm the driver on the Events page after speaking to them, or write it off. Coordinates are kept for the hotspot map.
          </p>
        </div>
      )}

      {done && (
        <div className="mt-2 flex flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-8 text-center">
          <FileSpreadsheet size={26} className="text-status-good" />
          <div className="font-display text-base font-semibold text-navy">Import complete</div>
          <div className="text-sm text-status-neutral">
            {done.added} event{done.added === 1 ? '' : 's'} added as pending
            {done.dupes > 0 && `, ${done.dupes} already-imported skipped`}
            {done.unmatched > 0 && `, ${done.unmatched} with an unlisted bus`}.
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-status-good/20 bg-status-good/5 px-3 py-2 text-xs text-status-good">
          <CheckCircle2 size={14} /> Adjust the rules above and the counts update live before you import.
        </div>
      )}
    </Modal>
  )
}
