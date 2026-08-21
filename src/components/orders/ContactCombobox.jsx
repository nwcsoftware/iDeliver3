import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'

/* Display name for a contact: company name first, else person name. */
function cname(c) {
  return (c?.company_name?.trim()) || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || '—'
}

/* The person's name (first + last), regardless of company name. */
function personName(c) {
  return `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim()
}

/**
 * Every role a contact holds, for the badges in the dropdown. Multi-role contacts
 * carry each role in contact_types[]; legacy rows that predate the array only have
 * the single primary contact_type. The primary is listed first, then the rest in
 * their stored order, so the badge that identifies the contact stays leftmost.
 */
function contactRoles(c) {
  const all = Array.isArray(c?.contact_types) ? c.contact_types.filter(Boolean) : []
  const primary = c?.contact_type || null
  const ordered = primary ? [primary, ...all.filter(t => t !== primary)] : all
  return [...new Set(ordered)]
}

/**
 * Typeahead contact picker that behaves like the order form's customer box:
 * type to search the given contacts; pick a match, or — when what you typed
 * isn't a valid contact — choose "Add new …" to create one (the parent opens the
 * full new-contact form and selects the result here).
 *
 * The dropdown is rendered with fixed positioning anchored to the field, so it
 * floats above the section/table frame and is never clipped.
 *
 * Props:
 *   value        selected contact id ('' when none)
 *   text         free-text fallback to display when nothing is selected (allowText)
 *   options      contacts to search
 *   onSelect     (contact) => void      a contact was picked (or just created)
 *   onText       (string)  => void      free text changed (only when allowText)
 *   onAddNew     (typedName, onCreated) => void   open the add-contact flow
 *   addLabel     word used in "Add new <addLabel>"
 *   allowText    permit free-text values that aren't a contact (e.g. shop name)
 *   compact      table-cell styling
 *   placeholder
 */
export default function ContactCombobox({
  value = '', text = '', options = [], onSelect, onText, onAddNew,
  addLabel = 'contact', allowText = false, compact = false, placeholder = 'Type a name…',
}) {
  const selected = value ? options.find(o => o.id === value) : null
  const [query, setQuery]     = useState('')
  const [editing, setEditing] = useState(false)
  const [open, setOpen]       = useState(false)
  const [coords, setCoords]   = useState(null)
  const wrapRef = useRef(null)
  const boxRef  = useRef(null)

  const baseDisplay = selected ? cname(selected) : (allowText ? (text || '') : '')
  const display = editing ? query : baseDisplay

  function updateCoords() {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // The field cell can be narrow (e.g. the Order Services "Service provider"
    // column), which would clip contact names. Widen the menu to a readable
    // minimum, but never wider than the field needs or the viewport allows, and
    // shift it left if it would overflow the right edge.
    const MIN_MENU_W = 320
    const menuW = Math.min(Math.max(r.width, MIN_MENU_W), window.innerWidth - 16)
    let left = r.left
    if (left + menuW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - menuW)
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < 240 && r.top > spaceBelow
    setCoords(openUp
      ? { left, width: menuW, bottom: window.innerHeight - r.top + 4 }
      : { left, width: menuW, top: r.bottom + 4 })
  }
  useLayoutEffect(() => { if (open) updateCoords() }, [open, query])

  useEffect(() => {
    if (!open) return
    const onDown = e => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return
      if (e.target.closest?.('[data-contact-popup]')) return
      close()
    }
    const onKey  = e => { if (e.key === 'Escape') close() }
    const onMove = () => updateCoords()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  function close() { setOpen(false); setEditing(false); setQuery('') }

  const q = query.trim().toLowerCase()
  // Search across company name, the person's name, mobile and contact code so a
  // contact is findable by any of them (even a company contact, by its person).
  const matches = options.filter(o => {
    const hay = `${o.company_name ?? ''} ${o.first_name ?? ''} ${o.last_name ?? ''}`.toLowerCase()
    return hay.includes(q) ||
      (o.mobile || '').includes(query.trim()) ||
      o.code?.toLowerCase?.().includes(q)
  })
    /* A retired contact only reaches this list for a super admin — everyone
       else has it filtered out upstream. Sort it below the live ones and label
       it, so "Madame Bougie" twice is never a guess about which is current. */
    .sort((a, b) => (a.is_active === false ? 1 : 0) - (b.is_active === false ? 1 : 0))
    .slice(0, 50)
  const exact     = options.some(o => cname(o).toLowerCase() === q)
  // Creating is offered only where the caller can actually do it. A picker
  // used purely as a filter (the Packages page) passes no onAddNew, and
  // offering to add a contact from a filter box is a trap: it looks like a
  // way to search and turns into a way to create data by accident.
  const canCreate = !!q && !exact && typeof onAddNew === 'function'

  function pick(c) { onSelect?.(c); close() }

  return (
    <div className="relative" ref={wrapRef}>
      <div className="relative" ref={boxRef}>
        <input
          className={`input w-full pr-7 ${compact ? 'py-1.5 text-xs' : ''}`}
          placeholder={placeholder}
          value={display}
          onFocus={() => { setEditing(true); setOpen(true); setQuery(baseDisplay) }}
          onChange={e => {
            const v = e.target.value
            setQuery(v); setEditing(true); setOpen(true)
            if (allowText) onText?.(v)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (matches.length === 1) pick(matches[0])
              else if (canCreate && !allowText) { onAddNew?.(query.trim(), onSelect); close() }
            }
          }} />
        {selected && !editing && <Check className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-green-400 pointer-events-none" />}
      </div>

      {open && coords && (
        <div data-contact-popup
          className="fixed z-[80] card border border-surface-border rounded-lg shadow-xl overflow-hidden"
          style={{ left: coords.left, width: coords.width, top: coords.top, bottom: coords.bottom }}>
          <div className="max-h-72 overflow-y-auto">
            {matches.map(c => {
              // Show the person's name as a sub-line when the primary label is a
              // company name, plus the mobile, so the user can tell contacts apart.
              const showPerson = !!c.company_name?.trim() && !!personName(c)
              const sub = [showPerson ? personName(c) : null, c.mobile || null].filter(Boolean).join('  ·  ')
              return (
                <button type="button" key={c.id} onMouseDown={e => { e.preventDefault(); pick(c) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover border-b border-surface-border/50 last:border-0 ${
                    c.is_active === false ? 'opacity-60' : ''}`}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-slate-100 text-xs truncate">{cname(c)}</span>
                    {sub && <span className="block text-[10px] text-slate-500 truncate">{sub}</span>}
                  </span>
                  {c.code && <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">{c.code}</span>}
                  {contactRoles(c).map(role => (
                    <span key={role} className="text-[9px] uppercase tracking-wide text-slate-400 bg-surface-hover border border-surface-border rounded px-1.5 py-0.5 flex-shrink-0">{role}</span>
                  ))}
                  {c.is_active === false && (
                    <span className="text-[9px] uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 flex-shrink-0">
                      deactivated
                    </span>
                  )}
                </button>
              )
            })}
            {canCreate && (
              <button type="button" onMouseDown={e => { e.preventDefault(); onAddNew?.(query.trim(), onSelect); close() }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-cyan-300 hover:bg-surface-hover border-t border-surface-border/50">
                <Plus className="w-3.5 h-3.5 flex-shrink-0" /> Add new {addLabel} “{query.trim()}”
              </button>
            )}
            {matches.length === 0 && !canCreate && (
              <p className="px-3 py-2 text-xs text-slate-600">
                {options.length ? 'No matches'
                  : (typeof onAddNew === 'function' ? 'Type a name to add a new one' : 'Nothing to choose from')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
