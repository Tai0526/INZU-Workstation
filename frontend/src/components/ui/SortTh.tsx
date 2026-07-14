import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

/**
 * Tiny click-to-sort helper for the dark-headed data tables. `useSort` holds the
 * active column + direction; `SortTh` renders a sortable header cell; `sortRows`
 * applies the sort with numeric-aware comparison.
 */
export type SortDir = 'asc' | 'desc'

export function useSort(defaultKey: string, defaultDir: SortDir = 'asc') {
  const [key, setKey] = useState(defaultKey)
  const [dir, setDir] = useState<SortDir>(defaultDir)
  const toggle = (k: string) => {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setKey(k); setDir('asc') }
  }
  return { key, dir, toggle }
}

export function sortRows<T>(rows: T[], acc: (r: T) => string | number, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const va = acc(a), vb = acc(b)
    const c = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return dir === 'asc' ? c : -c
  })
}

export function SortTh({ label, k, sortKey, dir, onSort, className = '' }: {
  label: string; k: string; sortKey: string; dir: SortDir; onSort: (k: string) => void; className?: string
}) {
  const active = sortKey === k
  return (
    <th className={`px-4 py-2.5 font-medium ${className}`}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-white/75" title={`Sort by ${label}`}>
        {label}
        {active ? (dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  )
}
