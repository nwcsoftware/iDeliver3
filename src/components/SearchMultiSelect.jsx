import React, { useMemo, useRef, useState, useEffect } from 'react'
import { ChevronDown, CheckCircle2, Circle, X, ListChecks, XCircle } from 'lucide-react'
import SearchField from './ui/SearchField'

/**
 * A filter dropdown that combines a search box with multi-selection, for lists
 * long enough that a plain <select> is unusable (customers, drivers…).
 *
 * TWO WAYS TO ARRIVE AT THE SAME ANSWER. Wanting three of forty things, you tick
 * three. Wanting all of them but two, ticking thirty-eight is absurd — so
 * "Select all" fills the list and you untick the two you do not want. The button
 * then says so: "All except Shein, taxi", because that is the filter the user
 * has in mind, and reading "41 selected" back would not confirm it.
 *
 * Every option ticked is left as a full list rather than quietly folded back to
 * [] — folding it would clear the ticks the moment they were set and leave
 * nothing to untick, which is the whole point of the button.
 *
 * While a search is typed, the two buttons act on WHAT IS ON SCREEN and say so
 * ("Select 6 matching"), so a search can build a selection a piece at a time.
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

  /* Adds what the search currently shows to the selection, leaving anything
     already chosen but filtered out of view alone. */
  function selectShown() {
    onChange([...new Set([...value, ...shown.map(o => o.value)])])
  }

  const label_of = v => options.find(o => o.value === v)?.label ?? v
  const missing  = value.length ? options.filter(o => !selected.has(o.value)) : []

  const buttonText = value.length === 0 || value.length === options.length
    ? allLabel
    : value.length === 1
      ? (label_of(value[0]) || '1 selected')
      /* Named, not counted, while the exceptions are few enough to read. */
      : missing.length > 0 && missing.length <= 3
        ? `All except ${missing.map(o => o.label).join(', ')}`
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
            <SearchField
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className={`input pl-7 py-1.5 text-xs ${query ? 'pr-7' : ''}`}
              onKeyDown={e => { if (e.key === 'Escape') close() }}
              ref={searchRef}
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus() }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Start from everything, then take away — the short road to "all
              except one or two". */}
          {options.length > 1 && (
            <div className="flex items-center gap-1 px-1 pb-1">
              <button type="button" onClick={selectShown}
                className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] text-slate-300 bg-surface-hover/60 hover:bg-surface-hover">
                <ListChecks className="w-3 h-3" />
                {q ? `Select ${shown.length} matching` : 'Select all'}
              </button>
              <button type="button" onClick={() => onChange([])}
                disabled={value.length === 0}
                className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] text-slate-400 bg-surface-hover/60 hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-surface-hover/60">
                <XCircle className="w-3 h-3" /> Clear
              </button>
            </div>
          )}

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
