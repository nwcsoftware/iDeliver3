import { orderAmountBreakdown } from './orderAmounts'
import { buildBuckets, bucketKeyOf } from './reportPeriods'

/* The arithmetic behind the Performance report, kept away from the page that
   draws it so the figures can be checked on their own.

   Everything here reads money through orderAmountBreakdown — the same function
   the order-amounts popup uses — so a total on this report and the popup on any
   one order in it are the same calculation, not two that happen to agree. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

/* The money categories, in the order they stack, with the colour each one wears.

   Colour is bound to the CATEGORY here — not to its position in a chart and not
   to the medium — so a window where nobody sold an ad does not repaint the other
   five, and "delivery packages" is the same orange on screen, in the PDF and in
   any legend that names it.

   `color` is the screen step, validated against the app's dark card surface
   (#1e293b); `print` is the same hue re-stepped for white paper and validated
   against it. Both sets pass the lightness / chroma / CVD-separation gates as an
   ordered whole, so neither one may be edited a slot at a time.

   Screen keeps a contrast warning on `ads` (2.96:1) and print on three slots;
   both are answered the same way — every figure also appears as text, on screen
   in the table at the foot of the page and in the PDF's own table. */
export const MONEY_SERIES = [
  { key: 'fees',           label: 'Delivery fees',            color: '#3987e5', print: '#2a78d6' },
  { key: 'packages',       label: 'Delivery packages',        color: '#d95926', print: '#eb6834' },
  { key: 'localRetail',    label: 'Local retail items',       color: '#199e70', print: '#1baf7a' },
  { key: 'externalRetail', label: 'External retail invoices', color: '#c98500', print: '#eda100' },
  { key: 'services',       label: 'Order services',           color: '#d55181', print: '#e87ba4' },
  { key: 'ads',            label: 'Ads & sponsorships',       color: '#008300', print: '#008300' },
]

export const COUNT_SERIES = [
  { key: 'orderCount',   label: 'Orders',   color: '#3987e5', print: '#2a78d6' },
  { key: 'packageCount', label: 'Packages', color: '#d95926', print: '#eb6834' },
]

export const MONEY_KEYS = MONEY_SERIES.map(s => s.key)

/* Axis figures only: 1.2k / 3.4M. Full precision lives in the tooltip, the table
   and the PDF — an axis is a ruler, not a statement of account. */
export function compact(n) {
  const v = Number(n) || 0
  const a = Math.abs(v)
  const cut = (unit, suffix) => `${(v / unit).toFixed(a / unit >= 10 ? 0 : 1).replace(/\.0$/, '')}${suffix}`
  if (a >= 1e9) return cut(1e9, 'B')
  if (a >= 1e6) return cut(1e6, 'M')
  if (a >= 1e3) return cut(1e3, 'k')
  return String(Math.round(v))
}

/* Axis ticks a person would have chosen: 0 to a round top in 1/2/5×10ⁿ steps. */
export function niceTicks(max, count = 4) {
  const m = Number(max) || 0
  if (m <= 0) return [0, 1]
  const mag  = Math.pow(10, Math.floor(Math.log10(m / count)))
  const norm = (m / count) / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const top  = Math.ceil(m / step) * step
  const out  = []
  for (let v = 0; v <= top + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

export const EMPTY_MONEY = () => ({
  fees: 0, packages: 0, localRetail: 0, externalRetail: 0, services: 0, ads: 0,
  discount: 0, vat: 0, total: 0, collected: 0,
})

/* The day an order counts under: its CLOSE date, falling back to the scheduled
   date and then to creation. Same "delivery day" the Packages report and the
   Daily Collection use, so the three never disagree about which week a delivery
   landed in — which is also why the timestamp is sliced rather than converted:
   closed_at is UTC, so an order closed after midnight local time counts to the
   previous day. Deliberately matched to the other two reports; changing it here
   alone would be worse than the quirk. */
export const orderDay = o =>
  String(o?.closed_at || o?.scheduled_date || o?.created_at || '').slice(0, 10)

/* One order reduced to the figures this report counts, per currency.

   A free order is waived to zero, so it earns nothing — but the goods still
   moved, so it keeps its order and package counts. (orderAmountBreakdown does
   not apply the waiver itself; orderTotalsByCurrency does, and this follows that
   reading so a free order can never inflate revenue.) */
export function orderFact(o) {
  const free = o?.is_free_order === true
  const cur  = {}
  for (const r of orderAmountBreakdown(o)) {
    const m = EMPTY_MONEY()
    if (!free) {
      for (const k of MONEY_KEYS) m[k] = r[k]
      m.discount = r.discount
      m.vat      = r.vat
      m.total    = r.total
    }
    m.collected = r.collected
    cur[r.cur] = m
  }
  return {
    day:          orderDay(o),
    closed:       o?.isclosed === true,
    packageCount: (o?.delivery_packages ?? []).length,
    invoiceCount: (o?.retail_goods_invoices ?? []).length,
    cur,
  }
}

export const emptyBucket = () => ({ orderCount: 0, packageCount: 0, invoiceCount: 0, cur: {} })

export function addFact(acc, f) {
  acc.orderCount   += 1
  acc.packageCount += f.packageCount
  acc.invoiceCount += f.invoiceCount
  for (const [c, m] of Object.entries(f.cur)) {
    const b = acc.cur[c] || (acc.cur[c] = EMPTY_MONEY())
    for (const k of Object.keys(b)) b[k] = round2(b[k] + m[k])
  }
}

/* Bucket a set of order facts into a window.

   `from` may be null — that is "till date", and the oldest fact on record
   becomes the start, because only the data knows how far back the books go.
   Empty buckets are kept: a closed Sunday is a fact about the week, not a gap to
   draw straight over. */
export function buildReport(facts, { from, to }) {
  const oldest = facts.reduce((min, f) => (f.day && (!min || f.day < min) ? f.day : min), null)
  const wanted = from || oldest || to
  const start  = wanted > to ? to : wanted
  const { grain, list } = buildBuckets(start, to)

  const map    = new Map(list.map(b => [b.key, emptyBucket()]))
  const totals = emptyBucket()
  for (const f of facts) {
    if (!f.day || f.day < start || f.day > to) continue
    const slot = map.get(bucketKeyOf(f.day, grain))
    if (!slot) continue
    addFact(slot, f)
    addFact(totals, f)
  }

  // Currencies that actually carry a figure in this window, biggest first — so
  // the page opens on the currency the business mostly works in.
  const currencies = Object.entries(totals.cur)
    .filter(([, m]) => m.total !== 0 || m.collected !== 0)
    .sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total))
    .map(([c]) => c)

  return { from: start, to, grain, buckets: list, map, totals, currencies }
}
