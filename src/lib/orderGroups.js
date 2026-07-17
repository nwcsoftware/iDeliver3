/* Outlook-style date grouping for the Closed Orders list.

   Buckets are evaluated in order and an order lands in the FIRST one it matches,
   so they're mutually exclusive even though the labels overlap in plain English
   ("last month" naturally includes "this week" — here it means what's left after
   the newer buckets have taken theirs).

   Weeks start on Monday. Dates are compared as plain 'YYYY-MM-DD' strings, which
   is how scheduled_date is stored — no timezone shifts. */

const iso = d => {
  const t = new Date(d)
  t.setHours(12, 0, 0, 0)                 // midday: immune to DST shifting the date
  return t.toISOString().slice(0, 10)
}

/** Monday of the week containing `date`. */
function weekStart(date) {
  const t = new Date(date)
  t.setHours(12, 0, 0, 0)
  const dow = (t.getDay() + 6) % 7        // 0 = Monday
  t.setDate(t.getDate() - dow)
  return t
}
const minusDays   = (d, n) => { const t = new Date(d); t.setHours(12,0,0,0); t.setDate(t.getDate() - n);   return t }
const minusMonths = (d, n) => { const t = new Date(d); t.setHours(12,0,0,0); t.setMonth(t.getMonth() - n); return t }

/**
 * Bucket definitions, newest first. Each has a `from` date — an order belongs to
 * the first bucket whose `from` it is on or after. The last bucket catches
 * everything else.
 */
export function groupDefs(today = new Date()) {
  const wk = weekStart(today)
  return [
    { key: 'this_week',    label: 'This week',      from: iso(wk) },
    { key: 'last_3_weeks', label: 'Last 3 weeks',   from: iso(minusDays(wk, 21)) },
    { key: 'last_month',   label: 'Last month',     from: iso(minusMonths(today, 1)) },
    { key: 'last_3_months',label: 'Last 3 months',  from: iso(minusMonths(today, 3)) },
    { key: 'older',        label: 'Older',          from: null },   // catch-all
  ]
}

/** The date an order is grouped by — the same one the list shows. */
export const orderGroupDate = o =>
  String(o?.scheduled_date || o?.closed_at || o?.created_at || '').slice(0, 10)

/**
 * Group orders into the buckets above, preserving the incoming order within each
 * bucket (so the caller's sort still applies). Empty buckets are dropped, except
 * that "This week" is always kept so the page doesn't look broken on a quiet week.
 *
 * @returns [{ key, label, from, orders }] newest bucket first
 */
export function buildOrderGroups(orders = [], today = new Date()) {
  const defs = groupDefs(today)
  const buckets = defs.map(d => ({ ...d, orders: [] }))

  for (const o of orders) {
    const day = orderGroupDate(o)
    // Undated orders can't be placed on the timeline — they go to Older rather
    // than silently vanishing from the list.
    const hit = day
      ? buckets.find(b => b.from === null || day >= b.from)
      : buckets[buckets.length - 1]
    ;(hit || buckets[buckets.length - 1]).orders.push(o)
  }

  return buckets.filter(b => b.orders.length > 0 || b.key === 'this_week')
}

/** Which group opens by default: the newest one that actually has orders. */
export function defaultOpenGroup(groups = []) {
  const first = groups.find(g => g.orders.length > 0)
  return first ? first.key : (groups[0]?.key ?? 'this_week')
}
