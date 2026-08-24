/* How far back the Currency Check looks.

   The page used to pull the WHOLE order history before it could show anything —
   thousands of orders with every package, item, invoice and payment embedded,
   to flag a handful of suspect amounts. On a growing database that is a wait
   that gets worse every month, for a question that is nearly always about
   recent work: a mistyped currency is corrected while the order is still open,
   not a year later.

   So the period is a setting, and the page loads only that window. The choice
   is company-wide rather than per-device: it decides what "checked" means, and
   two people disagreeing about the window is two people disagreeing about
   whether the books are clean. */

export const PERIODS = [
  { key: 'week',   label: 'Current week',   note: 'Monday to today — the daily desk check.' },
  { key: 'month',  label: 'Current month',  note: 'The 1st to today. The usual choice.' },
  { key: 'last2',  label: 'Last 2 months',  note: 'This month and the one before — catches a slip found late.' },
]

export const DEFAULT_PERIOD = 'month'

export const periodByKey = (key) =>
  PERIODS.find(p => p.key === key) || PERIODS.find(p => p.key === DEFAULT_PERIOD)

const ymd = (d) => {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* The window a period covers, as { from, to, days, label } in local dates.

   Weeks start on MONDAY: the delivery week is worked Monday to Saturday, and a
   Sunday-start week would split every Saturday's takings from the days they
   belong to. */
export function periodRange(key, today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const to = ymd(t)
  let from

  switch (key) {
    case 'week': {
      const dow = (t.getDay() + 6) % 7                 // 0 = Monday
      from = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - dow))
      break
    }
    case 'last2':
      from = ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1))
      break
    case 'month':
    default:
      from = ymd(new Date(t.getFullYear(), t.getMonth(), 1))
      break
  }

  const days = Math.round(
    (new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1
  return { from, to, days, key: periodByKey(key).key, label: periodByKey(key).label }
}
