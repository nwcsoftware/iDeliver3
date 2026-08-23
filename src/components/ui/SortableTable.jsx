import React, { useMemo, useState } from 'react'
import { ArrowUpAZ, ArrowDownZA, ChevronsUpDown } from 'lucide-react'

/* Sortable column headers, shared by the office lists.

   Three states, cycled by clicking: A→Z, Z→A, and back to the order the query
   returned. The third one is the point — "newest first" is itself a view, and
   without a way back to it a click on a header is a one-way door.

   The lists differ in what they sort BY: a Renewal column sorts by days left,
   an Amount column by the figure rather than its formatted text, an Online
   column by whether they are. So each page supplies a `value(row, key)` and
   this handles the rest. */

export function useTableSort(value) {
  const [sort, setSort] = useState({ key: null, dir: null })

  const cycle = (key) => setSort(s => (
    s.key !== key ? { key, dir: 'asc' }
      : s.dir === 'asc' ? { key, dir: 'desc' }
      : { key: null, dir: null }))

  /* Sort a list with the current state. Ties fall back to the row's position
     in the original list, so equal rows never swap places between renders. */
  const sortRows = useMemo(() => (rows = []) => {
    if (!sort.key || !sort.dir) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    const index = new Map(rows.map((r, i) => [r, i]))
    return rows.slice().sort((a, b) => {
      const va = value(a, sort.key)
      const vb = value(b, sort.key)
      if (va === vb) return index.get(a) - index.get(b)
      if (va == null) return 1                     // blanks sink, either way
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
  }, [sort, value])

  return { sort, cycle, sortRows }
}

/* One header cell. `sortKey` omitted = a plain, unsortable heading (an actions
   column, say). */
export function SortTh({ label, sortKey = null, sort, onSort, className = '', align = 'left' }) {
  const active = sortKey && sort.key === sortKey
  const base = `px-3 py-2 font-medium bg-surface-card text-${align}`
  if (!sortKey) return <th className={`${base} ${className}`}>{label}</th>
  return (
    <th className={`${base} ${className}`}>
      <button type="button" onClick={() => onSort(sortKey)}
        title={active
          ? (sort.dir === 'asc' ? 'Sorted A→Z — click for Z→A' : 'Sorted Z→A — click to clear')
          : `Sort by ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${
          active ? 'text-brand-300' : 'hover:text-slate-300'}`}>
        {label}
        {active
          ? (sort.dir === 'asc' ? <ArrowUpAZ className="w-3.5 h-3.5" /> : <ArrowDownZA className="w-3.5 h-3.5" />)
          : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  )
}
