/* The arithmetic behind the Most Sold Items report.
 *
 * One question: of the company's own goods, what moved, and how much of it.
 *
 * WHAT COUNTS AS SOLD. An order line against one of our products, on an order
 * that is not cancelled. By default only CLOSED orders count — the same line
 * the stock ledger and the money reports draw, so "sold 40" here and "sold 40"
 * on the product's own history are the same forty. The toggle widens it to
 * every live order, which answers a different question ("what is going out this
 * week", including work still in progress) and is labelled as such.
 *
 * A line taken back off an order is not a sale and never counts.
 *
 * MONEY IS PER CURRENCY, ALWAYS. There is no exchange rate anywhere in this
 * application, so revenue is kept in its own currency and never summed across
 * them. QUANTITY is the one figure that can be added up safely, which is why
 * the ranking is by quantity and the money sits beside it rather than under it.
 */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const pad = n => String(n).padStart(2, '0')
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/* ── the windows this report can be asked for ────────────────────────────────
   Every one ENDS TODAY. A period that ended last night would answer a question
   nobody asked on the day they are asking it. */
export const PERIODS = [
  { key: 'week',    label: 'This week',    note: 'Monday to today.' },
  { key: 'month',   label: 'This month',   note: 'The 1st to today.' },
  { key: 'quarter', label: 'This quarter', note: 'The start of the current quarter to today.' },
  { key: 'year',    label: 'This year',    note: 'The 1st of January to today.' },
  { key: 'custom',  label: 'Between dates', note: 'Pick the two days yourself.' },
]

export const DEFAULT_PERIOD = 'month'

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const mondayOf = d => {
  const x = midnight(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

/* The window a period covers, as local YYYY-MM-DD bounds, both inclusive.
   'custom' hands back what it was given, swapping the dates if they were
   entered back to front and falling back to this month if either is blank. */
export function periodWindow(key, { customFrom = '', customTo = '', today = new Date() } = {}) {
  const t = midnight(today)
  const to = ymd(t)
  switch (key) {
    case 'week':    return { from: ymd(mondayOf(t)), to }
    case 'quarter': return { from: ymd(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1)), to }
    case 'year':    return { from: ymd(new Date(t.getFullYear(), 0, 1)), to }
    case 'custom': {
      if (!customFrom || !customTo) return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to }
      return customFrom <= customTo
        ? { from: customFrom, to: customTo }
        : { from: customTo,   to: customFrom }
    }
    case 'month':
    default:        return { from: ymd(new Date(t.getFullYear(), t.getMonth(), 1)), to }
  }
}

/* The day a sale belongs to: when the order was meant to happen, else when it
   closed, else when it was raised. The same rule the rest of the app dates an
   order by, so two reports over the same window cover the same orders. */
export const saleDay = (order, line) =>
  (order?.scheduled_date || order?.closed_at || order?.created_at || line?.added_at || '').slice(0, 10)

const isCancelled = o => ['cancelled', 'failed'].includes(String(o?.status || '').toLowerCase())

/**
 * Rank the goods sold in a window.
 *
 * `lines`      order_items rows, each carrying its `order` and `product`
 * `from`/`to`  inclusive YYYY-MM-DD bounds
 * `closedOnly` count only finished orders (the default)
 *
 * Returns the ranked items and a summary of the same window — the summary is
 * derived from the very same rows, so a total can never disagree with the list
 * it sits above.
 */
export function buildTopItems(lines = [], { from, to, closedOnly = true } = {}) {
  const byProduct = new Map()
  const orderIds = new Set()
  const revenue = {}            // currency -> amount
  let units = 0
  let skippedNoProduct = 0

  for (const l of lines) {
    if (l.is_deleted) continue
    const o = l.order
    if (!o || isCancelled(o)) continue
    if (closedOnly && o.isclosed !== true) continue

    const day = saleDay(o, l)
    if (!day || day < from || day > to) continue

    if (!l.product_id || !l.product) { skippedNoProduct += 1; continue }

    const qty = Number(l.quantity) || 0
    const cur = l.currency || 'USD'
    const value = round2(l.line_total != null ? l.line_total : (Number(l.unit_price) || 0) * qty)

    const key = l.product_id
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        id: key,
        code: l.product.code || '—',
        name: l.product.name || '—',
        qty: 0,
        revenue: {},
        orders: new Set(),
        firstDay: day,
        lastDay: day,
      })
    }
    const row = byProduct.get(key)
    row.qty += qty
    row.revenue[cur] = round2((row.revenue[cur] || 0) + value)
    row.orders.add(o.id)
    if (day < row.firstDay) row.firstDay = day
    if (day > row.lastDay)  row.lastDay = day

    units += qty
    revenue[cur] = round2((revenue[cur] || 0) + value)
    orderIds.add(o.id)
  }

  const items = [...byProduct.values()]
    .map(r => ({ ...r, orders: r.orders.size, share: units > 0 ? r.qty / units : 0 }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))

  return {
    from, to, closedOnly,
    items,
    summary: {
      units: round2(units),
      distinctItems: items.length,
      orders: orderIds.size,
      revenue,
      currencies: Object.keys(revenue).filter(c => round2(revenue[c]) !== 0),
      top: items[0] || null,
      /* Lines with no product behind them — a free-text parcel, an external
         request. They were sold, but not as a catalogue item, so they cannot be
         ranked. Reported rather than dropped in silence. */
      skippedNoProduct,
    },
  }
}
