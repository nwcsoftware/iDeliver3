/* Shop working hours (supabase-fix121).

   contacts.opening_hours is seven entries, Sunday first:
     [{ closed: false, from: '09:00', to: '22:00' }, …]

   A shop with no hours saved keeps no schedule and counts as always open, so
   nothing changes for shops that never fill them in. A day may run past
   midnight (from 18:00 to 02:00) — that is normal for restaurants, so the
   comparison wraps rather than treating it as a mistake. */

export const DAYS = [
  { key: 0, short: 'Sun', label: 'Sunday' },
  { key: 1, short: 'Mon', label: 'Monday' },
  { key: 2, short: 'Tue', label: 'Tuesday' },
  { key: 3, short: 'Wed', label: 'Wednesday' },
  { key: 4, short: 'Thu', label: 'Thursday' },
  { key: 5, short: 'Fri', label: 'Friday' },
  { key: 6, short: 'Sat', label: 'Saturday' },
]

export const emptyHours = () =>
  DAYS.map(() => ({ closed: false, from: '09:00', to: '22:00' }))

/* Whatever is stored, coerced into seven usable entries. */
export function normalizeHours(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null      // no schedule kept
  const out = emptyHours()
  for (let i = 0; i < 7; i++) {
    const d = raw[i] || {}
    out[i] = {
      closed: !!d.closed,
      from: typeof d.from === 'string' && /^\d{2}:\d{2}/.test(d.from) ? d.from.slice(0, 5) : '09:00',
      to:   typeof d.to   === 'string' && /^\d{2}:\d{2}/.test(d.to)   ? d.to.slice(0, 5)   : '22:00',
    }
  }
  return out
}

const mins = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const hhmm = (total) => {
  const t = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/* Does `day` cover `minute`? Handles a shift that runs past midnight. */
function covers(day, minute) {
  if (!day || day.closed) return false
  const from = mins(day.from), to = mins(day.to)
  if (from === to) return true                    // 24 hours
  return to > from ? (minute >= from && minute < to) : (minute >= from || minute < to)
}

/* Is the shop taking orders right now?

   Returns { open, keepsHours, today, opensAt, nextOpen } where nextOpen is
   { date: 'YYYY-MM-DD', time: 'HH:MM', label: 'tomorrow 09:00' } — what the
   customer needs in order to schedule instead of giving up. */
export function shopOpenState(contact, now = new Date()) {
  const hours = normalizeHours(contact?.opening_hours)
  if (!hours) return { open: true, keepsHours: false, today: null, nextOpen: null }

  const dow = now.getDay()
  const minute = now.getHours() * 60 + now.getMinutes()
  const today = hours[dow]

  // Yesterday's late shift can still be running (open 18:00 → 02:00).
  const yesterday = hours[(dow + 6) % 7]
  const openNow = covers(today, minute)
    || (yesterday && !yesterday.closed && mins(yesterday.to) < mins(yesterday.from) && minute < mins(yesterday.to))

  return {
    open: openNow,
    keepsHours: true,
    today,
    nextOpen: openNow ? null : nextOpening(hours, now),
  }
}

/* The next moment the shop is open, searched over the coming week. */
function nextOpening(hours, now) {
  const pad = n => String(n).padStart(2, '0')
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const minute = now.getHours() * 60 + now.getMinutes()

  for (let ahead = 0; ahead < 8; ahead++) {
    const d = new Date(now)
    d.setDate(d.getDate() + ahead)
    const day = hours[d.getDay()]
    if (!day || day.closed) continue
    const from = mins(day.from)
    // Today only counts if opening is still to come.
    if (ahead === 0 && minute >= from) continue
    const label = ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : DAYS[d.getDay()].label
    return { date: dateStr(d), time: hhmm(from), label: `${label} ${hhmm(from)}`, dayLabel: label }
  }
  return null
}

/* "09:00 – 22:00" / "Closed" for one day. */
export const dayText = (day) =>
  (!day || day.closed ? 'Closed' : `${day.from} – ${day.to}`)

/* One-line summary of today's hours, for a card. */
export function todayText(contact, now = new Date()) {
  const state = shopOpenState(contact, now)
  if (!state.keepsHours) return ''
  return dayText(state.today)
}
