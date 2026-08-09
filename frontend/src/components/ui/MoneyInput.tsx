import { useState } from 'react'
import clsx from 'clsx'

/**
 * Cost entry that takes USD or Kwacha. The app stores costs in USD (FQM's
 * reporting currency), so when K is chosen the amount converts at the given
 * BoZ rate — the one set per month in Fuel → Summary — and the equivalent is
 * shown underneath. Lets a kwacha invoice be typed exactly as printed.
 *
 * Switching currency converts the typed number, so the money keeps meaning
 * the same amount (K1,000 → $37.04 → back to K1,000).
 */
export default function MoneyInput({ label, valueUsd, onChange, fx, placeholder, small, className }: {
  label: string
  valueUsd: number | null
  onChange: (usd: number | null) => void
  /** Kwacha per USD for the relevant month (BoZ). */
  fx: number
  placeholder?: string
  /** Compact label size, matching tight grids (job-card forms). */
  small?: boolean
  className?: string
}) {
  const [cur, setCur] = useState<'USD' | 'ZMW'>('USD')
  const [text, setText] = useState(valueUsd != null ? String(valueUsd) : '')
  const rate = fx > 0 ? fx : 27 // BoZ default used app-wide when a month has no rate yet
  const n = Number(text)
  const hasValue = text !== '' && Number.isFinite(n) && n > 0

  function emit(t: string, c: 'USD' | 'ZMW') {
    const v = Number(t)
    if (t === '' || !Number.isFinite(v)) return onChange(null)
    onChange(c === 'USD' ? v : Math.round((v / rate) * 10_000) / 10_000)
  }
  function switchCur(c: 'USD' | 'ZMW') {
    if (c === cur) return
    let t = text
    if (hasValue) t = String(Math.round((c === 'ZMW' ? n * rate : n / rate) * 100) / 100)
    setCur(c)
    setText(t)
    emit(t, c)
  }

  return (
    <label className={clsx('block', className)}>
      <span className={clsx('mb-1 flex items-center justify-between gap-2 font-medium text-navy', small ? 'text-[11px]' : 'text-xs')}>
        <span>{label}</span>
        <span className="inline-flex shrink-0 overflow-hidden rounded-md border border-black/15 text-[10px] font-semibold leading-none">
          {(['USD', 'ZMW'] as const).map((c) => (
            <button key={c} type="button" onClick={() => switchCur(c)}
              className={clsx('px-1.5 py-1', cur === c ? 'bg-navy text-white' : 'bg-white text-status-neutral hover:text-navy')}>
              {c === 'USD' ? '$ USD' : 'K ZMW'}
            </button>
          ))}
        </span>
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-status-neutral">{cur === 'USD' ? '$' : 'K'}</span>
        <input
          type="number" step="0.01" min="0" placeholder={placeholder}
          className="w-full rounded-lg border border-black/15 bg-white py-2 pl-7 pr-3 text-sm text-navy outline-none focus:border-brand"
          value={text}
          onChange={(e) => { setText(e.target.value); emit(e.target.value, cur) }}
        />
      </div>
      {hasValue && (
        <span className="mt-1 block text-[11px] text-status-neutral">
          ≈ {cur === 'USD'
            ? `K${(n * rate).toLocaleString('en', { maximumFractionDigits: 2 })}`
            : `$${(n / rate).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          {' '}at K{rate.toFixed(2)}/USD
        </span>
      )}
    </label>
  )
}
