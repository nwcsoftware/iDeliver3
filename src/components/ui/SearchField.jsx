import React from 'react'
import { Search, X } from 'lucide-react'

/* The search box used across the app: the magnifier on the left, and — as soon
   as anything is typed — a clear button on the right.

   Why a clear button matters here: most of these boxes filter a list that is
   the whole point of the page. Leaving a stale word in one is how a page comes
   to look empty for no visible reason, and selecting-and-deleting text on a
   touch screen is fiddly enough that people simply don't.

   Renders as a FRAGMENT, not a wrapper: every caller already has its own
   positioned container sized to its toolbar (`relative flex-1 max-w-sm` and
   friends), and the clear button is positioned against it. Keeping the wrapper
   with the caller means this can be dropped into an existing toolbar without
   changing a single layout.

   The parent must therefore be `position: relative`. */
export default function SearchField({
  value,
  onChange,                 // (event) => void — matches a plain <input>
  onClear,                  // () => void; omitted, it calls onChange with ''
  placeholder = 'Search…',
  className = 'input pl-9',
  ...rest
}) {
  const has = String(value ?? '').length > 0

  const clear = () => {
    if (onClear) return onClear()
    // Enough of an event for the usual `e => setX(e.target.value)` handler.
    onChange?.({ target: { value: '' } })
  }

  return (
    <>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
      <input
        className={`${className}${has ? ' pr-9' : ''}`}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...rest}
      />
      {has && (
        <button type="button" onClick={clear} title="Clear" aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </>
  )
}
