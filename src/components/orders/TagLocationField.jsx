import React, { useEffect, useRef, useState } from 'react'
import { MapPin, Plus, X } from 'lucide-react'

/**
 * Tag-style location field. Selected locations show as removable chips; clicking
 * the field (or focusing it) opens a small popup to quick-pick a saved/suggested
 * location, or type a brand-new one (Enter or "Add"). Built for speed: one click
 * to add, one click (×) to remove, Backspace removes the last chip.
 *
 * Props:
 *   label         field label
 *   required      show fuchsia required styling + asterisk
 *   tags          string[] selected locations
 *   setTags       (string[]) => void
 *   suggestions   string[] candidates to offer (saved + derived)
 *   onAddNew      (string) => void  called when a value not already a suggestion is committed
 *   placeholder
 */
export default function TagLocationField({
  label, required = false, tags = [], setTags, suggestions = [], onAddNew, placeholder = 'Add location…',
}) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDocDown = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey     = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey) }
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

  const q = query.trim().toLowerCase()
  const picks = suggestions
    .filter(s => !has(s))
    .filter(s => !q || s.toLowerCase().includes(q))
    .slice(0, 40)
  const canCreate = !!q && !suggestions.some(s => s.toLowerCase() === q) && !has(query.trim())

  return (
    <div className="relative" ref={wrapRef}>
      <label className={`label ${required ? 'text-fuchsia-300' : ''}`}>{label}{required ? ' *' : ''}</label>

      {/* Field box — chips + inline input */}
      <div
        className="input min-h-[38px] flex flex-wrap items-center gap-1.5 cursor-text py-1.5"
        onClick={() => { setOpen(true); inputRef.current?.focus() }}>
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 max-w-full bg-brand-600/20 border border-brand-600/40 text-brand-200 rounded-md pl-1.5 pr-1 py-0.5 text-xs">
            <MapPin className="w-3 h-3 flex-shrink-0 opacity-70" />
            <span className="truncate">{t}</span>
            <button type="button" onClick={e => { e.stopPropagation(); removeTag(t) }}
              className="flex-shrink-0 hover:text-red-300" title="Remove"><X className="w-3 h-3" /></button>
          </span>
        ))}
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
      </div>

      {/* Quick-pick popup */}
      {open && (
        <div className="absolute z-[55] left-0 right-0 mt-1 card border border-surface-border rounded-lg shadow-xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto p-2 space-y-1">
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
              <div className="flex flex-wrap gap-1.5">
                {picks.map(s => (
                  <button type="button" key={s}
                    onMouseDown={e => { e.preventDefault(); addTag(s) }}
                    className="inline-flex items-center gap-1 bg-surface-hover border border-surface-border rounded-md px-2 py-1 text-xs text-slate-300 hover:border-brand-600/50 hover:text-slate-100 transition-colors">
                    <MapPin className="w-3 h-3 flex-shrink-0 opacity-60" />
                    <span className="truncate max-w-[200px]">{s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
