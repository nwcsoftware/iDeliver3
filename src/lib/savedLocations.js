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
