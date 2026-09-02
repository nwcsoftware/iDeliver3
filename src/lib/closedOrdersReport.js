import { ymd, parseDay } from './reportPeriods'

/* The arithmetic behind the Closed Orders report: what finished work was worth,
   read down four streams and never across currencies.

   Kept out of the page for the usual reason — these are decisions about what a
   figure MEANS, not about how it is painted. Four of them are worth reading
   before trusting a number here.

   ── 1. Only CLOSED orders count ─────────────────────────────────────────────
   An open order is work in progress: its packages may still come back, its
   invoice may still be corrected, its fee may still be waived. Counting it
   would make this month's figure change tomorrow without anything having
   happened. So the gate is delivery_orders.isclosed — the same flag the Closed
   Orders list filters on, which is what lets a reader tie a total here back to
   a page they can actually open and count.

   Cancelled orders never reach this file: useApp().orders is already the live
   split (a cancelled order never happened). Free orders ARE excluded here and
   the count of them is reported, so the omission is visible rather than silent
   — a waived order earns nothing, and counting it at face value would inflate
   every stream on this page.

   ── 2. The four streams are the four ways an order carries money ────────────
     Delivery fees          delivery_orders.delivery_fee — ours outright.
     Stories orders         a Story order's whole worth — see 2a.
     Delivered packages     delivery_packages.package_price — a partner's goods
                            we carried.
     Local market invoices  retail_goods_invoices.invoice_value — a shop's goods
                            we fetched.

   The streams are MUTUALLY EXCLUSIVE: a Story order's delivery fee is Stories
   money, not fee money, so nothing is counted twice.

   They are still deliberately NOT a reconciliation of the order total: on an
   ordinary order, order services, 3asari3 retail items (order_items), VAT and
   discount are none of these four, so the streams sum to less than the order's
   gross. This report answers "what did each stream bring in", not "does the
   order add up" — the order form and the Deliveries totals panel answer that.

   ── 2a. Where Stories money is read from ────────────────────────────────────
   `order_services` rows whose service_description says "story" — matched case
   -insensitively, because the live rows are spelled "story" and "Story" and an
   exact "STORY" comparison finds none of them.

   NOT the `ads` table. That was the first definition and it reported zero on a
   business holding 25 closed Story orders, because every row in `ads` hangs off
   an order that is still open. The company records the sale as a service line,
   so the service line is the sale.

   The consequence, stated plainly because the figure depends on it: a Story
   order with no story service line contributes NOTHING here, even if it carries
   money elsewhere (an order item, say). That is a gap in the record rather than
   in the report, so the page counts those orders and says so on screen instead
   of quietly making the total up from whatever else it can find.

   ── 2b. Which DAY a story counts under ──────────────────────────────────────
   The ORDER's day (see 4), never the service's own `service_date`. A story
   raised on an order opened last month counts under LAST month, even if the
   story itself was entered this month. That is deliberate — an order is one
   piece of work and its money should not be split across periods — but it is
   surprising enough that both report pages say it on screen.

   ── 3. Gross or net of what was paid directly ───────────────────────────────
   A package flagged `paid` was settled by the customer straight to the partner;
   an invoice flagged `exclude_calculation` was settled straight to the shop.
   That money moved — the package was still delivered, the invoice still
   fetched — but it never passed through us.

   Both readings are legitimate and they answer different questions, so neither
   is baked in: `includeDirect` selects between them and the page exposes it as
   a switch. On (the default) the figure is the VALUE DELIVERED, which is what
   "total delivered packages" says; off, it is the value that came through our
   hands. The direct part is always reported separately as pkgDirect / invDirect
   so the difference between the two readings is never hidden.

   ── 4. The day an order counts under ────────────────────────────────────────
   Its close date, falling back to the scheduled date and then to creation — the
   same `orderDay` the Customer Categories report, the Partner Dues page and the
   Packages report use, so none of them disagree about which month a delivery
   landed in.

   Money is never converted between currencies; every figure is per currency. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const norm   = c => c || 'USD'

/* ── the four streams ─────────────────────────────────────────────────────────
   Colour identifies the STREAM and nothing else — not its size, not whether it
   is doing well. The four are the categorical palette's first four slots,
   validated as a set against this app's dark card surface (#1e293b): worst
   adjacent CVD separation ΔE 8.4 (protan), normal-vision ΔE 19.8, all four
   above 3:1 contrast. They are drawn in this order everywhere — the stacked
   bars, the legend, the cards and the CSV columns — so a colour learned in one
   place still means the same stream in the next. */
export const STREAMS = [
  {
    key: 'fees', label: 'Delivery fees', short: 'Fees',
    color: '#3987e5',
    note: 'The delivery fee charged on the order. Ours outright.',
  },
  {
    key: 'ads', label: 'Stories orders', short: 'Stories',
    color: '#d95926',
    note: 'Order-service lines described as “story”. Dated by the order, not by the story.',
  },
  {
    key: 'packages', label: 'Delivered packages', short: 'Packages',
    color: '#199e70',
    note: 'What the packages we carried were worth.',
  },
  {
    key: 'invoices', label: 'Local market invoices', short: 'Invoices',
    color: '#c98500',
    note: 'What the shop invoices we fetched were worth.',
  },
]

export const STREAM_KEYS = STREAMS.map(s => s.key)

/* Order-type slices, in assignment order. Slots 1–5 of the categorical palette
   plus violet in place of green, which alone falls under 3:1 on this surface.
   Validated as a set for the dark card: worst adjacent CVD ΔE 8.4 (protan),
   normal-vision ΔE 19.3, every slot above 3:1.

   Six is the cap because a pie stops being readable past about six segments,
   not because six is all we can colour — everything below the top five folds
   into "Other", which wears a deliberately low-chroma grey so it reads as a
   remainder rather than as another category competing for attention. */
export const TYPE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']
export const OTHER_COLOR = '#64748b'
export const MAX_TYPE_SLICES = 5   // + "Other"

/* Story orders are the ads product; the value is stored on the order exactly
   like this, so it is matched case-insensitively but written back as it is. */
const STORY_TYPE = 'story'

/** Same test as the Deliveries list, so the two always agree what a Story is. */
export const isStoryOrder = o => String(o?.order_type ?? '').trim().toLowerCase() === STORY_TYPE

/* A story sale is an order_services line describing itself as a story.

   Matched case-INSENSITIVELY on purpose. The rule is written down as
   "service_description = STORY", but nothing in the table is actually spelled
   that way: the live rows say "story" (12 of them) and "Story" (1). An exact
   comparison would report zero, which is precisely the failure this rule was
   brought in to fix, so the comparison is folded to lower case and trimmed. */
export const isStoryService = s =>
  String(s?.service_description ?? '').trim().toLowerCase() === STORY_TYPE

/** The story-sale lines on an order. */
export const storyServicesOf = o => (o?.order_services ?? []).filter(isStoryService)

/** The day an order counts under: close date → scheduled date → creation. */
export const orderDay = o =>
  String(o?.closed_at || o?.scheduled_date || o?.created_at || '').slice(0, 10)

/** Closed = finished and counted. The gate this whole report stands on. */
export const isClosed = o => o?.isclosed === true

/** A waived order is worth nothing, whatever its lines say. */
export const isFree = o => o?.is_free_order === true

/* Display name for an order type. Built-in types are stored lower-cased
   ('restaurant'), custom ones as the name the user typed, and older orders may
   carry nothing at all — all three have to read as something. */
export function typeLabel(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return 'Unspecified'
  if (s.toLowerCase() === STORY_TYPE) return 'Ads & Services'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The key an order's type is grouped under — its stored value, or '' for none. */
export const typeKeyOf = o => String(o?.order_type ?? '').trim()

export const emptyStreams = () => ({
  fees: 0, ads: 0, packages: 0, invoices: 0,
  // The part of packages / invoices the customer settled directly with the
  // partner or the shop. Reported alongside rather than folded away, so the
  // gross and net readings are both legible from the same figures.
  pkgDirect: 0, invDirect: 0,
  orders: 0,
})

/** Sum of the four streams — what this report calls the order's worth. */
export const streamTotal = m =>
  round2((m?.fees || 0) + (m?.ads || 0) + (m?.packages || 0) + (m?.invoices || 0))

const bagOf = (byCur, cur) => (byCur[norm(cur)] ||= emptyStreams())

/* One order → per-currency stream figures. Each line keeps its OWN currency:
   a package priced in LBP on a USD order is LBP money, and rolling it into the
   order's currency would invent an exchange rate nobody agreed to. */
export function orderStreams(o, includeDirect = true) {
  const byCur = {}

  /* Stories money is the order_services lines that say they are stories, and
     nothing else. Not the `ads` table (whose rows, on this data, hang only off
     orders that are still open), and not "everything on a Story order" — the
     company records the sale as a service line, so that line is the sale. An
     order can therefore be of type Story and contribute nothing here, if nobody
     wrote the service line; that is a gap in the record, not in the report, and
     the page says how many such orders it saw. */
  for (const s of storyServicesOf(o)) {
    const amt = Number(s.service_fees) || 0
    if (!amt) continue
    const b = bagOf(byCur, s.service_fees_currency)
    b.ads = round2(b.ads + amt)
  }

  const fee = Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : 0
  if (fee) bagOf(byCur, o.currency).fees = round2(fee)

  for (const p of (o.delivery_packages ?? [])) {
    const amt = Number(p.package_price) || 0
    if (!amt) continue
    const b = bagOf(byCur, p.currency || o.currency)
    if (p.paid) {
      b.pkgDirect = round2(b.pkgDirect + amt)
      if (!includeDirect) continue
    }
    b.packages = round2(b.packages + amt)
  }

  for (const r of (o.retail_goods_invoices ?? [])) {
    const amt = Number(r.invoice_value) || 0
    if (!amt) continue
    const b = bagOf(byCur, r.currency)
    if (r.exclude_calculation) {
      b.invDirect = round2(b.invDirect + amt)
      if (!includeDirect) continue
    }
    b.invoices = round2(b.invoices + amt)
  }

  // The order is counted once per currency it actually touched, so "orders"
  // under USD means "orders that carried USD money", not "all orders".
  for (const b of Object.values(byCur)) b.orders = 1
  return byCur
}

const addStreams = (dst, src) => {
  dst.fees      = round2(dst.fees      + (src.fees      || 0))
  dst.ads       = round2(dst.ads       + (src.ads       || 0))
  dst.packages  = round2(dst.packages  + (src.packages  || 0))
  dst.invoices  = round2(dst.invoices  + (src.invoices  || 0))
  dst.pkgDirect = round2(dst.pkgDirect + (src.pkgDirect || 0))
  dst.invDirect = round2(dst.invDirect + (src.invDirect || 0))
  dst.orders    = dst.orders + (src.orders || 0)
}

/* The orders this report will count, and what was left out on the way. Shared
   by the window totals and the monthly series so the two can never disagree
   about which orders are in play. */
function eligible(orders) {
  const kept = []
  let openSkipped = 0
  let freeSkipped = 0
  for (const o of (orders ?? [])) {
    if (!isClosed(o)) { openSkipped++; continue }
    if (isFree(o))    { freeSkipped++; continue }
    kept.push(o)
  }
  return { kept, openSkipped, freeSkipped }
}

/* ── the window: totals per currency, and the split by order type ─────────── */

/**
 * @param orders        every live (non-cancelled) order the app holds
 * @param from,to       local YYYY-MM-DD bounds, both inclusive; `from` null = no floor
 * @param includeDirect count packages/invoices settled directly with the partner or shop
 */
export function buildClosedOrdersReport({ orders, from, to, includeDirect = true }) {
  const { kept, openSkipped, freeSkipped } = eligible(orders)

  const totals   = {}            // cur -> streams
  const typeBag  = new Map()     // type key -> { key, label, orders, cur: { cur -> streams } }
  let orderCount = 0
  let oldestDay  = ''
  /* Story-type orders in the window with no story service line on them. They
     contribute nothing to the Stories figure, so the page names the number
     rather than letting the total quietly under-report. */
  let storyNoService = 0

  for (const o of kept) {
    const day = orderDay(o)
    if (!day) continue
    if (!oldestDay || day < oldestDay) oldestDay = day
    if (from && day < from) continue
    if (to   && day > to)   continue

    if (isStoryOrder(o) && storyServicesOf(o).length === 0) storyNoService++

    const byCur = orderStreams(o, includeDirect)
    const curs  = Object.keys(byCur)
    if (curs.length === 0) continue      // a closed order carrying no money at all

    orderCount++

    const tk = typeKeyOf(o)
    let entry = typeBag.get(tk)
    if (!entry) { entry = { key: tk, label: typeLabel(tk), orders: 0, cur: {} }; typeBag.set(tk, entry) }
    entry.orders++

    for (const c of curs) {
      addStreams((totals[c] ||= emptyStreams()), byCur[c])
      addStreams((entry.cur[c] ||= emptyStreams()), byCur[c])
    }
  }

  return {
    from: from || oldestDay || to,
    to,
    orderCount,
    openSkipped,
    freeSkipped,
    storyNoService,
    /* Ranked by HOW MANY orders carry each currency, never by how large the
       figures are. Ranking by magnitude would open this report on LBP every
       single time — a million lira is a smaller sum than a thousand dollars but
       a much bigger number, and the currency a reader meets first should be the
       one the business actually works in. Ties break on value. */
    currencies: Object.keys(totals).sort((a, b) =>
      (totals[b].orders - totals[a].orders) || (streamTotal(totals[b]) - streamTotal(totals[a]))),
    totals,
    types: [...typeBag.values()],
  }
}

/* ── the pie: order types in one currency, capped at six readable slices ───── */

/** Top types by value in `cur`, everything smaller folded into one "Other". */
export function typeSlices(types, cur, max = MAX_TYPE_SLICES) {
  const rows = (types ?? [])
    .map(t => ({
      key:    t.key,
      label:  t.label,
      orders: t.cur[cur] ? t.cur[cur].orders : 0,
      value:  streamTotal(t.cur[cur]),
      m:      t.cur[cur] || emptyStreams(),
    }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)

  if (rows.length <= max + 1) {
    return rows.map((r, i) => ({ ...r, color: TYPE_COLORS[i % TYPE_COLORS.length] }))
  }

  const head = rows.slice(0, max).map((r, i) => ({ ...r, color: TYPE_COLORS[i] }))
  const tail = rows.slice(max)
  const rest = {
    key: '__other__',
    label: `Other (${tail.length} type${tail.length === 1 ? '' : 's'})`,
    orders: tail.reduce((s, r) => s + r.orders, 0),
    value:  round2(tail.reduce((s, r) => s + r.value, 0)),
    m:      tail.reduce((acc, r) => { addStreams(acc, r.m); return acc }, emptyStreams()),
    color:  OTHER_COLOR,
    // Kept so the tooltip and the table can still name what was folded away —
    // "Other" must never be a place figures disappear into.
    folded: tail.map(r => ({ label: r.label, value: r.value, orders: r.orders })),
  }
  return [...head, rest]
}

/* ── the bars: whole calendar months, however short the chosen window is ───── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The window covering the last `monthsBack` calendar months, this one included. */
export function monthWindow(monthsBack, today = new Date()) {
  const t     = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const start = new Date(t.getFullYear(), t.getMonth() - (monthsBack - 1), 1)
  return { from: ymd(start), to: ymd(t) }
}

/**
 * One bar per calendar month, each split into the four streams.
 *
 * Deliberately independent of the period chips above it: those windows are
 * weeks and part-months, and a "month" bar built from half a month would be a
 * shorter bar that looks like a worse month. Empty months are kept — a month
 * with no closed orders is a fact about the year, and dropping it would draw
 * the chart straight over a shutdown as if it never happened.
 */
export function buildMonthlySeries({ orders, monthsBack = 12, includeDirect = true, today = new Date() }) {
  const { from, to } = monthWindow(monthsBack, today)
  const { kept }     = eligible(orders)

  const bag = new Map()   // 'YYYY-MM' -> { cur -> streams }
  for (const o of kept) {
    const day = orderDay(o)
    if (!day || day < from || day > to) continue
    const key   = day.slice(0, 7)
    const byCur = orderStreams(o, includeDirect)
    let month = bag.get(key)
    if (!month) { month = {}; bag.set(key, month) }
    for (const c of Object.keys(byCur)) addStreams((month[c] ||= emptyStreams()), byCur[c])
  }

  const list = []
  const start = parseDay(from)
  const end   = parseDay(to)
  let d = new Date(start.getFullYear(), start.getMonth(), 1)
  while (d <= end) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    list.push({
      key,
      label: `${MONTHS[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}`,
      title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      cur:   bag.get(key) || {},
    })
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  }
  return { from, to, months: list }
}

/* ── shared with the page ─────────────────────────────────────────────────── */

/** '2026-08-14' → '14 Aug 2026'. Empty in, empty out. */
export function dayText(s) {
  if (!s) return ''
  const d = parseDay(s)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
