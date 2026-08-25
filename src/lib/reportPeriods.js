/* The windows the Performance report looks through, and the time buckets a
   window is drawn in.

   Kept out of the page because these are decisions about what a figure MEANS,
   not about how it is painted: "last 2 weeks" has to mean the same thing every
   time it is quoted, and a second report reading the same words must be able to
   reach for the same definition rather than inventing its own.

   Every window ENDS TODAY except "Last month", which is the previous calendar
   month closed and done. That mix is deliberate: the wide lenses (2 weeks, 3
   months) are asked in order to see the run-up to now, so cutting them off at
   the last completed period would hide the very days being asked about; "last
   month" is asked as a closed book, and a month-to-date figure smuggled into it
   would make it disagree with itself as the month went on.

   Weeks start on MONDAY — the delivery week is worked Monday to Saturday, and a
   Sunday-start week splits every Saturday's takings from the days they belong
   to (same rule as the Currency Check). */

const pad = n => String(n).padStart(2, '0')

/** Local YYYY-MM-DD. Never toISOString(): that shifts to UTC and, east of
    Greenwich, hands back yesterday for anything before 03:00. */
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 'YYYY-MM-DD' → local Date at midnight. */
export const parseDay = s => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays  = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7))

export const PERIODS = [
  { key: 'week',      short: 'This week',    label: 'Current week',   note: 'Monday to today.' },
  { key: 'weeks2',    short: '2 weeks',      label: 'Last 2 weeks',   note: 'Last Monday week to today.' },
  { key: 'month',     short: 'This month',   label: 'Current month',  note: 'The 1st to today.' },
  { key: 'lastMonth', short: 'Last month',   label: 'Last month',     note: 'The previous calendar month, complete.' },
  { key: 'months3',   short: '3 months',     label: 'Last 3 months',  note: 'This month and the two before it, to today.' },
  { key: 'all',       short: 'Till date',    label: 'Till date',      note: 'Every order on record.' },
]

export const DEFAULT_PERIOD = 'month'

export const periodByKey = key =>
  PERIODS.find(p => p.key === key) || PERIODS.find(p => p.key === DEFAULT_PERIOD)

/* The window a period covers, as local YYYY-MM-DD bounds (both inclusive).
   `from` is null for 'Till date' — the caller substitutes the oldest order it
   actually holds, because only it knows how far back the data goes. */
export function periodRange(key, today = new Date()) {
  const t    = midnight(today)
  const meta = periodByKey(key)
  let from = null
  let to   = ymd(t)

  switch (meta.key) {
    case 'week':
      from = ymd(mondayOf(t))
      break
    case 'weeks2':
      // The Monday BEFORE this week's Monday, so a full week plus the current one.
      from = ymd(addDays(mondayOf(t), -7))
      break
    case 'lastMonth':
      from = ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1))
      to   = ymd(new Date(t.getFullYear(), t.getMonth(), 0))   // day 0 = last of prev month
      break
    case 'months3':
      from = ymd(new Date(t.getFullYear(), t.getMonth() - 2, 1))
      break
    case 'all':
      from = null
      break
    case 'month':
    default:
      from = ymd(new Date(t.getFullYear(), t.getMonth(), 1))
      break
  }
  return { key: meta.key, label: meta.label, short: meta.short, note: meta.note, from, to }
}

/* How many days a window spans, both ends counted. */
export const daysBetween = (from, to) =>
  Math.round((parseDay(to) - parseDay(from)) / 86400000) + 1

/* The grain a window is drawn at. A year of daily bars is a picket fence nobody
   can read, and a week of monthly bars is one column — so the bucket widens
   with the window rather than being asked for. */
export function grainFor(from, to) {
  const days = daysBetween(from, to)
  if (days <= 31)  return 'day'
  if (days <= 126) return 'week'   // ~4 months, still ≤ 18 columns
  return 'month'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* The bucket a given day falls in, as a sortable key. */
export function bucketKeyOf(day, grain) {
  if (grain === 'month') return String(day).slice(0, 7)
  if (grain === 'week')  return ymd(mondayOf(parseDay(day)))
  return String(day).slice(0, 10)
}

/* Every bucket in the window, in order and INCLUDING the empty ones — a day
   with no orders is a fact about the week, and dropping it would draw a line
   straight over a closed Sunday as if it never happened.

   Each bucket carries a short `label` for the axis and a full `title` for the
   tooltip, which is where the reader finds out that "17 Aug" means a whole week. */
export function buildBuckets(from, to) {
  const grain = grainFor(from, to)
  const start = parseDay(from)
  const end   = parseDay(to)
  const list  = []

  if (grain === 'month') {
    let d = new Date(start.getFullYear(), start.getMonth(), 1)
    while (d <= end) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
      list.push({
        key,
        label: `${MONTHS[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}`,
        title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      })
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    }
  } else if (grain === 'week') {
    let d = mondayOf(start)
    while (d <= end) {
      const last = addDays(d, 6)
      list.push({
        key:   ymd(d),
        label: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
        title: `Week of ${d.getDate()} ${MONTHS[d.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]}`,
      })
      d = addDays(d, 7)
    }
  } else {
    let d = new Date(start)
    while (d <= end) {
      list.push({
        key:   ymd(d),
        label: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
        title: d.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      })
      d = addDays(d, 1)
    }
  }
  return { grain, list }
}
