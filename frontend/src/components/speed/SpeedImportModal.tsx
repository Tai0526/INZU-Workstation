import { useState } from 'react'
import { Download, UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import type { BranchCode } from '@/lib/roles'
import { speedStore } from '@/lib/speed/store'
import { downloadTemplate, parseImportFile, type ImportResult } from '@/lib/speed/excel'

export default function SpeedImportModal({ open, onClose, branch }: { open: boolean; onClose: () => void; branch: BranchCode }) {
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null)

  function close() {
    setFileName(''); setParsed(null); setDone(null); setBusy(false); onClose()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name); setBusy(true); setDone(null)
    try {
      setParsed(await parseImportFile(file, branch))
    } catch {
      setParsed({ valid: [], errors: [{ row: 0, reason: 'Could not read this file. Use the .xlsx template.' }] })
    } finally {
      setBusy(false)
    }
    e.target.value = ''
  }

  function commit() {
    if (!parsed) return
    speedStore.bulkAdd(parsed.valid)
    setDone({ added: parsed.valid.length, skipped: parsed.errors.length })
    setParsed(null)
  }

  const matched = parsed ? parsed.valid.filter((v) => v.driver_id).length : 0

  return (
    <Modal
      open={open}
      onClose={close}
      title="Bulk upload speed events"
      subtitle="Import historical or batch Geotab events from Excel (.xlsx)."
      footer={done ? <Button onClick={close}>Done</Button> : (
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={commit} disabled={!parsed || parsed.valid.length === 0}>Import {parsed?.valid.length ?? 0} event(s)</Button>
        </>
      )}
    >
      <div className="mb-4 flex items-center justify-between rounded-lg bg-canvas px-4 py-3">
        <div className="text-sm text-navy">
          <div className="font-medium">Start with the template</div>
          <div className="text-xs text-status-neutral">Date/Time, Driver, Vehicle, Route, Recorded, Limit, Status…</div>
        </div>
        <Button variant="secondary" onClick={downloadTemplate}><Download size={15} /> Template</Button>
      </div>

      {!done && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-navy/20 bg-white px-6 py-8 text-center hover:border-brand">
          <UploadCloud size={26} className="text-brand" />
          <span className="text-sm font-medium text-navy">Click to choose an .xlsx file</span>
          <span className="text-xs text-status-neutral">{fileName || 'No file selected'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
        </label>
      )}

      {busy && <p className="mt-4 text-sm text-status-neutral">Reading file…</p>}

      {parsed && !busy && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-status-good/30 bg-status-good/5 px-3 py-2 text-sm text-status-good">
            <CheckCircle2 size={16} /> {parsed.valid.length} event(s) ready · {matched} matched to a roster driver
          </div>
          {parsed.errors.length > 0 && (
            <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-sm text-status-critical">
              <div className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle size={16} /> {parsed.errors.length} row(s) skipped</div>
              <ul className="ml-6 list-disc space-y-0.5 text-xs">
                {parsed.errors.slice(0, 8).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
                {parsed.errors.length > 8 && <li>…and {parsed.errors.length - 8} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {done && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl bg-canvas px-6 py-8 text-center">
          <FileSpreadsheet size={26} className="text-status-good" />
          <div className="font-display text-base font-semibold text-navy">Import complete</div>
          <div className="text-sm text-status-neutral">{done.added} added{done.skipped > 0 && `, ${done.skipped} skipped`}.</div>
        </div>
      )}
    </Modal>
  )
}
