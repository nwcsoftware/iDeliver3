/* Reusable pickup / delivery locations the user has entered, persisted in
   localStorage so they're offered as quick-pick tags on future orders.
   kind is 'pickup' or 'delivery'. Kept intentionally tiny — no backend table,
   so it works offline and needs no migration. */

const KEY = kind => `ideliver.locations.${kind}`

export function getSavedLocations(kind) {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY(kind)) || '[]')
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

/* Add a value (case-insensitive de-dupe) and return the new list. */
export function addSavedLocation(kind, value) {
  const v = (value || '').trim()
  if (!v) return getSavedLocations(kind)
  const list = getSavedLocations(kind)
  if (list.some(x => x.toLowerCase() === v.toLowerCase())) return list
  const next = [...list, v]
  try { localStorage.setItem(KEY(kind), JSON.stringify(next)) } catch { /* quota / private mode */ }
  return next
}

/* Remove a value (case-insensitive) and return the new list. */
export function removeSavedLocation(kind, value) {
  const v = (value || '').trim().toLowerCase()
  const next = getSavedLocations(kind).filter(x => x.toLowerCase() !== v)
  try { localStorage.setItem(KEY(kind), JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

/* Rename a saved value (case-insensitive match on the old value). If the old
   value isn't in the saved list (e.g. it was only suggested from order history),
   the new value is simply added. Returns the new saved list. */
export function renameSavedLocation(kind, oldValue, newValue) {
  const nv = (newValue || '').trim()
  if (!nv) return getSavedLocations(kind)
  removeSavedLocation(kind, oldValue)
  return addSavedLocation(kind, nv)
}

/* A separate "hidden" list lets the user remove suggestions that come from order
   history / suppliers (not the saved list), so they stop appearing in the popup. */
const HKEY = kind => `ideliver.locations.hidden.${kind}`

export function getHiddenLocations(kind) {
  try {
    const arr = JSON.parse(localStorage.getItem(HKEY(kind)) || '[]')
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

/* Hide a value (case-insensitive de-dupe) so it's suppressed from suggestions. */
export function hideLocation(kind, value) {
  const v = (value || '').trim()
  if (!v) return getHiddenLocations(kind)
  const list = getHiddenLocations(kind)
  if (list.some(x => x.toLowerCase() === v.toLowerCase())) return list
  const next = [...list, v]
  try { localStorage.setItem(HKEY(kind), JSON.stringify(next)) } catch { /* ignore */ }
  return next
}
