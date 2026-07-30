import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MapPin, Plus, X, Pencil } from 'lucide-react'

/**
 * Tag-style location field. Selected locations show as removable chips; clicking
 * the field (or focusing it) opens a small popup to quick-pick a saved/suggested
 * location, or type a brand-new one (Enter or "Add"). Built for speed: one click
 * to add, one click (×) to remove, Backspace removes the last chip.
 *
 * The quick-pick popup is rendered with fixed positioning anchored to the field,
 * so it floats above the (overflow-clipped) section frame and is always fully
 * visible. Each suggestion can be edited (✎) or deleted (×) when the parent
 * supplies onEditSuggestion / onDeleteSuggestion.
 *
 * Props:
 *   label              field label
 *   required           show fuchsia required styling + asterisk
 *   tags               string[] selected locations
 *   setTags            (string[]) => void
 *   suggestions        string[] candidates to offer (saved + derived)
 *   onAddNew           (string) => void  called when a value not already a suggestion is committed
 *   onEditSuggestion   (oldVal, newVal) => void  rename a saved/suggested location
 *   onDeleteSuggestion (val) => void  remove a saved/suggested location from the list
 *   placeholder
 */
export default function TagLocationField({
  label, required = false, tags = [], setTags, suggestions = [], onAddNew,
  onEditSuggestion, onDeleteSuggestion, placeholder = 'Add location…', labelRight = null,
  Icon = MapPin, disabled = false,
}) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState(null)   // { left, top|bottom, width } in viewport px
  const wrapRef  = useRef(null)
  const boxRef   = useRef(null)
  const inputRef = useRef(null)

  // Position the popup relative to the field box, flipping above when the space
  // below is tight, so it's never clipped by the section's overflow-hidden frame.
  function updateCoords() {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < 280 && r.top > spaceBelow
    setCoords(openUp
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
      : { left: r.left, width: r.width, top: r.bottom + 4 })
  }

  useLayoutEffect(() => { if (open) updateCoords() }, [open, tags.length, query])

  // Close on outside click / Escape; reposition while open (the modal scrolls).
  useEffect(() => {
    if (!open) return
    const onDocDown = e => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return
      if (e.target.closest?.('[data-tag-popup]')) return
      setOpen(false)
    }
    const onKey  = e => { if (e.key === 'Escape') setOpen(false) }
    const onMove = () => updateCoords()
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  const has = v => tags.some(t => t.toLowerCase() === v.toLowerCase())

  function addTag(v) {
    const val = (v || '').trim()
    if (!val) return
    if (!has(val)) setTags([...tags, val])
    setQuery('')
    inputRef.current?.focus()
  }
  function removeTag(v) { setTags(tags.filter(t => t !== v)) }

  // Commit the typed text: remember it as a new location if it isn't a known
  // suggestion, then add it as a tag.
  function commitTyped() {
    const val = query.trim()
    if (!val) return
    if (!suggestions.some(s => s.toLowerCase() === val.toLowerCase())) onAddNew?.(val)
    addTag(val)
  }

  function editSuggestion(s) {
    const next = (window.prompt('Edit location', s) || '').trim()
    if (!next || next.toLowerCase() === s.toLowerCase()) return
    onEditSuggestion?.(s, next)
    // Keep the field's own selected chips in sync if this value was selected.
    if (has(s)) setTags(tags.map(t => (t.toLowerCase() === s.toLowerCase() ? next : t)))
    inputRef.current?.focus()
  }
  function deleteSuggestion(s) {
    onDeleteSuggestion?.(s)
    inputRef.current?.focus()
  }

  const q = query.trim().toLowerCase()
  const picks = suggestions
    .filter(s => !has(s))
    .filter(s => !q || s.toLowerCase().includes(q))
    .slice(0, 40)
  const canCreate = !!q && !suggestions.some(s => s.toLowerCase() === q) && !has(query.trim())

  return (
    <div className="relative" ref={wrapRef}>
      {(label || labelRight) && (
        <div className="flex items-center justify-between">
          <label className={`label ${required ? 'text-fuchsia-300' : ''}`}>{label}{required ? ' *' : ''}</label>
          {labelRight}
        </div>
      )}

      {/* Field box — chips + inline input */}
      <div ref={boxRef}
        className={`input min-h-[38px] flex flex-wrap items-center gap-1.5 py-1.5 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-text'}`}
        onClick={() => { if (disabled) return; setOpen(true); inputRef.current?.focus() }}>
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 max-w-full bg-brand-600/20 border border-brand-600/40 text-brand-200 rounded-md pl-1.5 pr-1 py-0.5 text-xs">
            <Icon className="w-3 h-3 flex-shrink-0 opacity-70" />
            <span className="truncate">{t}</span>
            {!disabled && (
              <button type="button" onClick={e => { e.stopPropagation(); removeTag(t) }}
                className="flex-shrink-0 hover:text-red-300" title="Remove"><X className="w-3 h-3" /></button>
            )}
          </span>
        ))}
        {!disabled && (
          <input ref={inputRef}
            className="flex-1 min-w-[90px] bg-transparent outline-none text-sm placeholder:text-slate-600"
            placeholder={tags.length === 0 ? placeholder : ''}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitTyped() }
              else if (e.key === 'Backspace' && !query && tags.length) removeTag(tags[tags.length - 1])
            }} />
        )}
        {disabled && tags.length === 0 && <span className="text-sm text-slate-600">—</span>}
      </div>

      {/* Quick-pick popup — fixed so it floats above the section frame */}
      {open && coords && (
        <div data-tag-popup
          className="fixed z-[70] card border border-surface-border rounded-lg shadow-xl overflow-hidden"
          style={{ left: coords.left, width: coords.width, top: coords.top, bottom: coords.bottom }}>
          <div className="max-h-72 overflow-y-auto p-2 space-y-1">
            {canCreate && (
              <button type="button" onMouseDown={e => { e.preventDefault(); commitTyped() }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-emerald-300 hover:bg-surface-hover">
                <Plus className="w-3.5 h-3.5 flex-shrink-0" /> Add “{query.trim()}”
              </button>
            )}
            {picks.length === 0 && !canCreate ? (
              <p className="px-2 py-2 text-xs text-slate-600 text-center">
                {suggestions.length ? 'No matches' : 'Type a location and press Enter'}
              </p>
            ) : (
              <div className="space-y-1">
                {picks.map(s => (
                  <div key={s}
                    className="group flex items-center gap-1 bg-surface-hover border border-surface-border rounded-md pl-2 pr-1 py-1 hover:border-brand-600/50 transition-colors">
                    <button type="button" onMouseDown={e => { e.preventDefault(); addTag(s) }}
                      className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-slate-100 text-left">
                      <Icon className="w-3 h-3 flex-shrink-0 opacity-60" />
                      <span className="truncate">{s}</span>
                    </button>
                    {onEditSuggestion && (
                      <button type="button" title="Edit this location"
                        onMouseDown={e => { e.preventDefault(); editSuggestion(s) }}
                        className="flex-shrink-0 p-1 text-slate-500 hover:text-brand-300"><Pencil className="w-3 h-3" /></button>
                    )}
                    {onDeleteSuggestion && (
                      <button type="button" title="Delete this location"
                        onMouseDown={e => { e.preventDefault(); deleteSuggestion(s) }}
                        className="flex-shrink-0 p-1 text-slate-500 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
