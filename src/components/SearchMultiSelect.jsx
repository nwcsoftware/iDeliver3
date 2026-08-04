import React, { useMemo, useRef, useState, useEffect } from 'react'
import { ChevronDown, Search, CheckCircle2, Circle, X } from 'lucide-react'

/**
 * A filter dropdown that combines a search box with multi-selection, for lists
 * long enough that a plain <select> is unusable (customers, drivers…).
 *
 * Props:
 *   label     - field label above the control
 *   Icon      - optional lucide icon rendered next to the label
 *   options   - [{ value, label }]
 *   value     - array of selected values ([] = no filter, i.e. "all")
 *   onChange  - (nextValues[]) => void
 *   allLabel  - button text when nothing is selected ("All drivers")
 *   width     - tailwind width class for the button + menu
 */
export default function SearchMultiSelect({
  label, Icon, options = [], value = [], onChange,
  allLabel = 'All', searchPlaceholder = 'Search…', width = 'w-44',
}) {
  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState('')
  const searchRef = useRef(null)

  useEffect(() => { if (open) searchRef.current?.focus() }, [open])

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => (q ? options.filter(o => String(o.label ?? '').toLowerCase().includes(q)) : options),
    [options, q])

  const selected = new Set(value)
  function toggle(v) {
    onChange(selected.has(v) ? value.filter(x => x !== v) : [...value, v])
  }

  const buttonText = value.length === 0
    ? allLabel
    : value.length === 1
      ? (options.find(o => o.value === value[0])?.label || '1 selected')
      : `${value.length} selected`

  function close() { setOpen(false); setQuery('') }

  return (
    <div className="relative">
      <label className="label flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </label>
      <button type="button" onClick={() => (open ? close() : setOpen(true))}
        className={`input py-1.5 text-xs ${width} flex items-center justify-between gap-1 text-left`}>
        <span className={`truncate ${value.length ? 'text-slate-100' : ''}`}>{buttonText}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0 text-slate-500" />
      </button>

      {open && (<>
        <div className="fixed inset-0 z-40" onClick={close} />
        <div className={`absolute z-50 mt-1 ${width} min-w-[13rem] rounded-lg border border-surface-border bg-surface-card shadow-xl p-1`}>
          {/* Search — filters the list without clearing the current selection */}
          <div className="relative p-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input ref={searchRef} className={`input pl-7 py-1.5 text-xs ${query ? 'pr-7' : ''}`}
              placeholder={searchPlaceholder} value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') close() }} />
            {query && (
              <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus() }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto">
            <button type="button" onClick={() => onChange([])}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-surface-hover">
              {value.length === 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" /> : <Circle className="w-3.5 h-3.5 text-slate-600" />}
              <span className="truncate">{allLabel}</span>
            </button>
            {shown.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-slate-500">No matches</p>
            ) : shown.map(o => {
              const on = selected.has(o.value)
              return (
                <button key={o.value} type="button" onClick={() => toggle(o.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-surface-hover">
                  {on ? <CheckCircle2 className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />}
                  <span className="truncate text-left">{o.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </>)}
    </div>
  )
}
