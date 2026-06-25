import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X, Check } from 'lucide-react'
import clsx from 'clsx'

export interface SSOption { value: string; label: string; sub?: string }

/**
 * A type-to-filter dropdown. Looks like a normal select but you can start typing
 * (e.g. "GIB") to narrow a long list of drivers / vehicles instead of scrolling.
 */
export default function SearchableSelect({
  value, onChange, options, placeholder = 'Select…', className, disabled, allowClear = true, emptyText = 'No matches',
}: {
  value: string
  onChange: (v: string) => void
  options: SSOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  allowClear?: boolean
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const selected = options.find((o) => o.value === value)
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return options
    return options.filter((o) => o.label.toLowerCase().includes(t) || (o.sub ?? '').toLowerCase().includes(t))
  }, [q, options])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (disabled) return; setQ(''); setOpen((o) => !o) }}
        className={clsx(className, 'flex items-center justify-between gap-2 text-left', disabled && 'opacity-60')}
      >
        <span className={clsx('truncate', !selected && 'text-status-neutral')}>{selected ? selected.label : (value || placeholder)}</span>
        <span className="flex shrink-0 items-center gap-1">
          {allowClear && value && !disabled && (
            <X size={14} className="text-status-neutral hover:text-status-critical" onClick={(e) => { e.stopPropagation(); onChange('') }} />
          )}
          <ChevronDown size={14} className="text-status-neutral" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-lg border border-black/15 bg-white shadow-cardhover">
          <div className="relative border-b border-black/5 p-1.5">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-status-neutral" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type to search…"
              className="w-full rounded-md border border-black/10 bg-white py-1.5 pl-7 pr-2 text-sm text-navy outline-none focus:border-brand"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-canvas', o.value === value && 'bg-brand-tint/40')}
              >
                <span className="truncate text-navy">{o.label}</span>
                {o.sub && <span className="ml-auto shrink-0 text-xs text-status-neutral">{o.sub}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-xs text-status-neutral">{emptyText}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Multi-pick variant — same type-to-filter dropdown, but you can choose several
 * (shown as removable chips). Used e.g. when a refuel covered more than one route.
 */
export function SearchableMultiSelect({
  values, onChange, options, placeholder = 'Select…', className, emptyText = 'No matches',
}: {
  values: string[]
  onChange: (v: string[]) => void
  options: SSOption[]
  placeholder?: string
  className?: string
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return options
    return options.filter((o) => o.label.toLowerCase().includes(t) || (o.sub ?? '').toLowerCase().includes(t))
  }, [q, options])
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => { setQ(''); setOpen((o) => !o) }} className={clsx(className, 'flex min-h-[38px] flex-wrap items-center gap-1 text-left')}>
        {values.length === 0 && <span className="text-status-neutral">{placeholder}</span>}
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-brand-tint/60 px-1.5 py-0.5 text-xs text-navy">
            {labelOf(v)}
            <X size={11} className="hover:text-status-critical" onClick={(e) => { e.stopPropagation(); toggle(v) }} />
          </span>
        ))}
        <ChevronDown size={14} className="ml-auto shrink-0 text-status-neutral" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-lg border border-black/15 bg-white shadow-cardhover">
          <div className="relative border-b border-black/5 p-1.5">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-status-neutral" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" className="w-full rounded-md border border-black/10 bg-white py-1.5 pl-7 pr-2 text-sm text-navy outline-none focus:border-brand" />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((o) => {
              const on = values.includes(o.value)
              return (
                <button key={o.value} type="button" onClick={() => toggle(o.value)} className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-canvas', on && 'bg-brand-tint/40')}>
                  <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand bg-brand text-white' : 'border-black/25')}>{on && <Check size={11} />}</span>
                  <span className="truncate text-navy">{o.label}</span>
                  {o.sub && <span className="ml-auto shrink-0 text-xs text-status-neutral">{o.sub}</span>}
                </button>
              )
            })}
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-xs text-status-neutral">{emptyText}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
