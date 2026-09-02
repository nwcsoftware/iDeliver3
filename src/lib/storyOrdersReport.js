import { ymd, parseDay, daysBetween, buildBuckets, bucketKeyOf } from './reportPeriods'
import { isClosed, isFree, isStoryOrder, isStoryService, orderDay, dayText } from './closedOrdersReport'

/* The arithmetic behind the Story Orders report: what advertising was sold,
   over time, per currency.

   Story work is a different business from delivery — sold time rather than
   carried goods — and it moves on its own rhythm, so it gets its own page
   rather than a slice of a delivery report.

   ── What counts ─────────────────────────────────────────────────────────────
   `order_services` lines whose service_description says "story", on orders that
   are CLOSED and not free. Matched case-insensitively: the live rows are
   spelled "story" and "Story", and an exact "STORY" comparison finds none of
   them.

   Nothing else on the order counts — not its delivery fee, not its order items,
   not the `ads` table. The company records a story sale as a service line, so
   the service line IS the sale. A Story-type order carrying no such line
   therefore contributes nothing, and the page reports how many it saw rather
   than inventing a figure from whatever else is lying on the order.

   ── Which day a story counts under ──────────────────────────────────────────
   The ORDER's day — its close date, else its scheduled date, else creation —
   and NEVER the service's own `service_date`.

   So a story entered in March on an order opened in February is February's
   money. This is deliberate: an order is one piece of work, and splitting its
   money across two periods would make every period disagree with the order it
   came from. It is also genuinely surprising, so the page says it on screen.
   `serviceDateDrift` counts the lines where the two dates fall in different
   months, so the size of the effect is visible rather than theoretical.

   Currencies are never added together. Every figure is per currency. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const norm   = c => c || 'USD'

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays  = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7))

/* The windows this report can be asked for. Weeks start MONDAY, the same as the
   Performance report and the Currency Check, so two reports quoting "this week"
   are quoting the same days. Every window ends today. */
export const PERIODS = [
  { key: 'week',    label: 'Current week',   note: 'Monday to today.' },
  { key: 'month',   label: 'Current month',  note: 'The 1st to today.' },
  { key: 'months3', label: 'Last 3 months',  note: 'This month and the two before it, to today.' },
  { key: 'months6', label: 'Last 6 months',  note: 'This month and the five before it, to today.' },
  { key: 'year',    label: 'Current year',   note: '1 January to today.' },
]

export const DEFAULT_PERIOD = 'months3'

export function periodWindow(key, today = new Date()) {
  const t    = midnight(today)
  const meta = PERIODS.find(p => p.key === key) || PERIODS.find(p => p.key === DEFAULT_PERIOD)
  let from
  switch (meta.key) {
    case 'week':    from = ymd(mondayOf(t)); break
    case 'month':   from = ymd(new Date(t.getFullYear(), t.getMonth(), 1)); break
    case 'months6': from = ymd(new Date(t.getFullYear(), t.getMonth() - 5, 1)); break
    case 'year':    from = ymd(new Date(t.getFullYear(), 0, 1)); break
    case 'months3':
    default:        from = ymd(new Date(t.getFullYear(), t.getMonth() - 2, 1)); break
  }
  const to = ymd(t)
  return { key: meta.key, label: meta.label, note: meta.note, from, to, days: daysBetween(from, to) }
}

/** The story-sale lines on one order, each already reduced to money + currency. */
export function storyLines(o) {
  const out = []
  for (const s of (o?.order_services ?? [])) {
    if (!isStoryService(s)) continue
    const amt = round2(s.service_fees)
    if (!amt) continue
    out.push({
      cur:         norm(s.service_fees_currency),
      amount:      amt,
      // The story's own date, kept only to measure how far it drifts from the
      // order's — it is never what the figure is filed under.
      serviceDate: String(s.service_date ?? '').slice(0, 10),
    })
  }
  return out
}

export const emptyCur = () => ({ amount: 0, stories: 0, orders: 0 })

/**
 * @param orders   every live (non-cancelled) order the app holds
 * @param from,to  local YYYY-MM-DD bounds, both inclusive
 */
export function buildStoryReport({ orders, from, to }) {
  // Grain widens with the window on its own: days for a week or a month, weeks
  // for three, months for a year — a year of daily points is a picket fence.
  const { list: buckets, grain } = buildBuckets(from, to)

  const totals  = {}                                    // cur -> { amount, stories, orders }
  const series  = buckets.map(b => ({ ...b, cur: {} })) // one entry per bucket, empties kept
  const byKey   = new Map(series.map(b => [b.key, b]))
  const rows    = []                                    // one row per story line, for the table & CSV

  let openSkipped = 0, freeSkipped = 0, noServiceLine = 0, serviceDateDrift = 0

  for (const o of (orders ?? [])) {
    if (!isStoryOrder(o)) continue
    if (!isClosed(o)) { openSkipped++; continue }
    if (isFree(o))    { freeSkipped++; continue }

    const day = orderDay(o)
    if (!day || day < from || day > to) continue

    const lines = storyLines(o)
    if (lines.length === 0) { noServiceLine++; continue }

    const bucket = byKey.get(bucketKeyOf(day, grain))
    const seen   = new Set()

    for (const ln of lines) {
      if (ln.serviceDate && ln.serviceDate.slice(0, 7) !== day.slice(0, 7)) serviceDateDrift++

      const t = (totals[ln.cur] ||= emptyCur())
      t.amount  = round2(t.amount + ln.amount)
      t.stories += 1
      if (!seen.has(ln.cur)) { t.orders += 1; seen.add(ln.cur) }

      if (bucket) {
        const b = (bucket.cur[ln.cur] ||= emptyCur())
        b.amount  = round2(b.amount + ln.amount)
        b.stories += 1
      }

      rows.push({
        day,
        bucketTitle:  bucket?.title ?? dayText(day),
        orderNumber:  o.order_number ?? '',
        customer:     o.customer
          ? (o.customer.company_name?.trim() || `${o.customer.first_name ?? ''} ${o.customer.last_name ?? ''}`.trim() || '—')
          : '—',
        cur:          ln.cur,
        amount:       ln.amount,
        serviceDate:  ln.serviceDate,
        // True when the story's own date sits in a different month from the day
        // this row is filed under — the case the on-screen notice describes.
        drifted:      !!ln.serviceDate && ln.serviceDate.slice(0, 7) !== day.slice(0, 7),
      })
    }

    // One order can hold several stories; count the order once per bucket/currency.
    if (bucket) for (const c of seen) bucket.cur[c].orders = (bucket.cur[c].orders || 0) + 1
  }

  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))   // newest first

  return {
    from, to, grain,
    series,
    totals,
    rows,
    openSkipped,
    freeSkipped,
    noServiceLine,
    serviceDateDrift,
    storyCount: rows.length,
    /* Ranked by how many stories carry each currency, never by how large the
       figures are — a million lira is a smaller sum than a thousand dollars but
       a much bigger number. Ties break on value. */
    currencies: Object.keys(totals).sort((a, b) =>
      (totals[b].stories - totals[a].stories) || (totals[b].amount - totals[a].amount)),
  }
}

/* An ad counts only once it has been CONFIRMED. `confirmed_ads` is the flag the
   Deliveries page sets when someone activates the ad ("this is running now"),
   so an unconfirmed row is a plan rather than a fact — it must not put money on
   a chart, and must not date any either. Strictly `=== true`: the column is
   nullable and a null is not a confirmation. */
export const isConfirmedAd = a => a?.confirmed_ads === true

/** The day an order's advertising STARTS RUNNING: the earliest start_at among
    its CONFIRMED ads. Empty when it has no confirmed ad carrying a start. */
export function adStartDay(o) {
  let earliest = ''
  for (const a of (o?.ads ?? [])) {
    if (!isConfirmedAd(a)) continue
    const d = String(a?.start_at ?? '').slice(0, 10)
    if (!d) continue
    if (!earliest || d < earliest) earliest = d
  }
  return earliest
}

/* ── the campaign view: the ADS table, read on its own terms ────────────────
   The page's first chart answers "what did we sell, and when was the order" —
   money from the story service lines, filed under the order's day. This one
   answers a different question: "what advertising is RUNNING, and when" —
   money from `ads.price`, filed under `ads.start_at`.

   They are two different books and they will NOT add up to the same figure.
   That is not an error waiting to be reconciled: the service line is what was
   billed, the ad row is what runs, and a business needs to see both. Each
   chart says on its face which one it is.

   Three rules:

     · CONFIRMED ads only — `confirmed_ads === true`, strictly. The column is
       nullable and a null is not a confirmation. An unconfirmed ad is a plan,
       not a campaign: it brings no money and dates nothing.
     · CLOSED Story orders only, the same gate as the rest of the page.
     · Each ad keeps its own currency. Nothing is converted or added across.

   ── What this shows today, and why ─────────────────────────────────────────
   Nothing — and that is the data, not the code. All 25 confirmed ads hang off
   Story orders whose `isclosed` is null (status "pending"), and not one of the
   25 CLOSED Story orders carries an ad at all. The chart fills in by itself as
   those pending orders are closed.

   `notClosedAds` / `waitingMoney` carry the confirmed ads held back for
   exactly that reason, so the page can say what it is waiting on instead of
   showing a bare empty frame. */
export function buildStoryByAdStart({ orders, from, to }) {
  const { list: buckets, grain } = buildBuckets(from, to)

  const series = buckets.map(b => ({ ...b, cur: {} }))
  const byKey  = new Map(series.map(b => [b.key, b]))
  const totals = {}
  let adCount = 0, zeroPriced = 0, unconfirmed = 0, noStartDate = 0, movedPeriod = 0
  // Confirmed ads sitting on a Story order that is not closed yet: the money
  // this chart is waiting on, kept per currency.
  let notClosedAds = 0
  const waitingMoney = {}
  // Story-service money on closed orders carrying no confirmed ad — the gap
  // between this chart's book and the one above it.
  let ordersMissingAd = 0
  const missingAdMoney = {}

  for (const o of (orders ?? [])) {
    if (!isStoryOrder(o) || isFree(o)) continue

    const ads = o.ads ?? []

    if (!isClosed(o)) {
      for (const a of ads) {
        if (!isConfirmedAd(a)) continue
        const d = String(a.start_at ?? '').slice(0, 10)
        if (!d || d < from || d > to) continue
        notClosedAds++
        const cur = norm(a.currency)
        waitingMoney[cur] = round2((waitingMoney[cur] || 0) + (Number(a.price) || 0))
      }
      continue
    }

    // A closed order with billed story money but no confirmed ad to run it.
    if (!adStartDay(o)) {
      const lines = storyLines(o)
      if (lines.length) {
        ordersMissingAd++
        for (const ln of lines) missingAdMoney[ln.cur] = round2((missingAdMoney[ln.cur] || 0) + ln.amount)
      }
    }

    const oDay = orderDay(o)
    for (const a of ads) {
      if (!isConfirmedAd(a)) { unconfirmed++; continue }
      const day = String(a.start_at ?? '').slice(0, 10)
      if (!day) { noStartDate++; continue }
      if (day < from || day > to) continue

      const amount = round2(a.price)
      adCount++
      if (!amount) zeroPriced++          // a real campaign, priced at nothing
      if (oDay && bucketKeyOf(day, grain) !== bucketKeyOf(oDay, grain)) movedPeriod++

      const cur = norm(a.currency)
      const t = (totals[cur] ||= emptyCur())
      t.amount  = round2(t.amount + amount)
      t.stories += 1

      const bucket = byKey.get(bucketKeyOf(day, grain))
      if (bucket) {
        const b = (bucket.cur[cur] ||= emptyCur())
        b.amount  = round2(b.amount + amount)
        b.stories += 1
      }
    }
  }

  return {
    from, to, grain, series, totals,
    adCount, zeroPriced, unconfirmed, noStartDate,
    notClosedAds, waitingMoney,
    ordersMissingAd, missingAdMoney,
    // Ads whose start falls in a different bucket from their order's day — the
    // size of the disagreement with the chart above, stated not implied.
    movedPeriod,
    currencies: Object.keys(totals).sort((a, b) =>
      (totals[b].stories - totals[a].stories) || (totals[b].amount - totals[a].amount)),
  }
}

export { dayText, parseDay }
