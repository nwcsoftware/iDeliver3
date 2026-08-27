import { orderTotalsByCurrency, orderCollectedByCurrency } from './orderAmounts'
import { buildBuckets, bucketKeyOf, ymd, parseDay, daysBetween } from './reportPeriods'

/* The arithmetic behind the Customer Categories report: what the two kinds of
   customer — credit and regular — were billed for, what came in, and what is
   still owed outwards to the partners and shops whose goods moved.

   Kept out of the page for the usual reason: these are decisions about what a
   figure MEANS. Three of them are worth reading before trusting a number here.

   ── 1. A category is a property of the CUSTOMER, not the order ──────────────
   contacts.credit_debit_allowed is the same flag the Credit Customers page and
   the order form read, so an order appears under "Credit Customers" here
   exactly when it appears on that customer's credit statement.

   ── 2. Money collected is not recorded per category of charge ───────────────
   A payment is taken against the ORDER — the driver hands over one sum, not a
   sum per line. So "delivery fees collected" cannot be looked up; it has to be
   apportioned. The rule is the simplest one that cannot mislead: an order that
   is x% settled has every one of its lines x% settled.

       ratio = collected ÷ order total   (per currency, capped at 1)

   A fully-paid order therefore reads 100% collected on every line and nothing
   pending, an untouched one reads zero across the board, and a half-paid one
   splits evenly. Lines that are not ours to collect — a package flagged "paid
   directly to the partner", an invoice flagged "calculation excluded" — are
   outside the order total already, so they never absorb any of it.

   ── 3. Payouts are not recorded per order either ────────────────────────────
   partner_payouts (fix82) is one row per payment handed to a partner or shop:
   a party, a currency, an amount, a date. Nothing ties it to the packages or
   invoices it settled. So a payout is spread across that party's own unsettled
   lines in the window, in proportion to what each line owes them — which is how
   a payment against a running account behaves anyway. The spread is computed
   over EVERY line in the window before the customer filter is applied, so
   narrowing to one customer shows that customer's share of the payout rather
   than re-spreading the whole thing over less debt.

   Both apportionments are exact in the ordinary case (an order settled in full;
   a party paid what they were owed) and an estimate only where the underlying
   record is genuinely silent.

   ── What the closing figures mean ───────────────────────────────────────────
     partner dues       = packages − paid directly to partner − paid out
                          (identical to the Partner Dues page)
     supplier pending   = invoices − paid directly to shop − commission − paid out
                          (identical to the Shop Statements page)
   Money is never converted between currencies; every figure is per currency. */

const round2  = n => Math.round((Number(n) || 0) * 100) / 100
const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n)
const norm    = c => c || 'USD'

/* ── the two categories ───────────────────────────────────────────────────────
   Colour identifies the CATEGORY and nothing else — not its position in a
   chart, not whether it is winning. The pair is validated as a categorical
   palette against the app's dark card surface (#1e293b): worst adjacent CVD
   separation ΔE 15.9 (protan), normal-vision ΔE 26.5, both above 3:1 contrast.
   Inside a bar the same hue carries the settled part solid and the outstanding
   part faded, so state is lightness and identity stays colour. */
export const CATEGORIES = [
  {
    key: 'credit', label: 'Credit Customers', short: 'Credit',
    color: '#d55181', faded: 'rgba(213,81,129,0.30)',
    note: 'Customers allowed to run a balance (credit / debit allowed on their contact).',
  },
  {
    key: 'regular', label: 'Regular Customers', short: 'Regular',
    color: '#3987e5', faded: 'rgba(57,135,229,0.30)',
    note: 'Everyone else — expected to settle the order as it is delivered.',
  },
]

export const CATEGORY_KEYS = CATEGORIES.map(c => c.key)

/* Which category an order belongs to. The same flag the Credit Customers page
   filters on, read off the joined customer contact. */
export const categoryOf = o => (o?.customer?.credit_debit_allowed === true ? 'credit' : 'regular')

/* ── the three money streams ──────────────────────────────────────────────── */
export const STREAMS = [
  { key: 'fees',     label: 'Delivery fees', totalKey: 'fees',     collectedKey: 'feesCollected' },
  { key: 'packages', label: 'Packages',      totalKey: 'pkgTotal', collectedKey: 'pkgCollected'  },
  { key: 'invoices', label: 'Invoices',      totalKey: 'invTotal', collectedKey: 'invCollected'  },
]

/* ── the windows this report can be asked for ─────────────────────────────────
   Every window ENDS TODAY except "Last month", which is the previous calendar
   month closed and done — the same mix, and the same Monday-start weeks, the
   Performance report and the Currency Check use, so two reports quoting "last
   2 weeks" are quoting the same fortnight. */
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays  = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7))

export const PERIODS = [
  { key: 'week',      label: 'Current week',  note: 'Monday to today.' },
  { key: 'weeks2',    label: 'Last 2 weeks',  note: 'Last Monday week to today.' },
  { key: 'month',     label: 'Current month', note: 'The 1st to today.' },
  { key: 'lastMonth', label: 'Last month',    note: 'The previous calendar month, complete.' },
  { key: 'months2',   label: 'Last 2 months', note: 'The previous calendar month and this one, to today.' },
  { key: 'custom',    label: 'Between dates', note: 'Pick the two days yourself.' },
]

export const DEFAULT_PERIOD = 'month'

/* The window a period covers, as local YYYY-MM-DD bounds (both inclusive).
   'custom' hands back whatever the caller was given, swapping the two dates if
   they were entered back to front and falling back to this month if either is
   still blank. */
export function periodWindow(key, { customFrom = '', customTo = '', today = new Date() } = {}) {
  const t    = midnight(today)
  const meta = PERIODS.find(p => p.key === key) || PERIODS.find(p => p.key === DEFAULT_PERIOD)
  let from = ymd(new Date(t.getFullYear(), t.getMonth(), 1))
  let to   = ymd(t)

  switch (meta.key) {
    case 'week':
      from = ymd(mondayOf(t))
      break
    case 'weeks2':
      from = ymd(addDays(mondayOf(t), -7))
      break
    case 'lastMonth':
      from = ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1))
      to   = ymd(new Date(t.getFullYear(), t.getMonth(), 0))   // day 0 = last of prev month
      break
    case 'months2':
      from = ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1))
      break
    case 'custom':
      if (customFrom && customTo) {
        from = customFrom <= customTo ? customFrom : customTo
        to   = customFrom <= customTo ? customTo : customFrom
      } else if (customFrom) { from = customFrom; to = customFrom > to ? customFrom : to }
      else if (customTo)     { to = customTo; if (from > to) from = customTo }
      break
    case 'month':
    default:
      break
  }
  return { key: meta.key, label: meta.label, note: meta.note, from, to, days: daysBetween(from, to) }
}

/* ── one order, reduced to the figures this report counts ─────────────────── */

export const emptyCur = () => ({
  // Delivery fee charged on the order, and the share of it settled.
  fees: 0, feesCollected: 0,
  // Packages: everything on the order, the part the customer paid the partner
  // directly, the part we collected on the partner's behalf, and payouts.
  pkgTotal: 0, pkgDirect: 0, pkgCollected: 0, pkgPaidOut: 0,
  // Shop invoices: the same shape, plus the commission we keep out of what we
  // owe the shop.
  invTotal: 0, invDirect: 0, invCollected: 0, invCommission: 0, invPaidOut: 0,
})

export const emptyGroup = () => ({ orders: 0, packages: 0, invoices: 0, cur: {} })

const curOf   = (g, c) => (g.cur[c] ||= emptyCur())
const addInto = (dst, src) => { for (const k of Object.keys(dst)) dst[k] = round2(dst[k] + (src[k] || 0)) }

/* The day an order counts under: its CLOSE date, falling back to the scheduled
   date and then to creation. The same "delivery day" the Performance report,
   the Packages report and the Daily Collection use, so none of them disagree
   about which week a delivery landed in. */
export const orderDay = o =>
  String(o?.closed_at || o?.scheduled_date || o?.created_at || '').slice(0, 10)

/* Display name for a contact — company first, else the person. */
export function contactName(c) {
  if (!c) return '—'
  return (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'
}

/* One order → per-currency figures, plus the party lines a payout can settle.

   `lines` are only used to spread payouts and are dropped afterwards; each is
   { partyId, cur, kind: 'pkg' | 'inv', owed } where `owed` is what that single
   line leaves us holding for that party. */
function extractOrder(o, day) {
  const totals = orderTotalsByCurrency(o)          // {} on a free order
  const coll   = orderCollectedByCurrency(o)

  /* How much of this order has been settled, per currency. Capped at 1 so an
     overpayment can never report more collected than was ever charged. */
  const ratioFor = cur => {
    const t = round2(totals[cur] || 0)
    const c = round2(coll[cur] || 0)
    if (t > 0) return clamp01(c / t)
    return c > 0 ? 1 : 0
  }

  const cur   = {}
  const bag   = c => (cur[norm(c)] ||= emptyCur())
  const lines = []

  const feeCur = norm(o.currency)
  const fee    = Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : 0
  if (fee) bag(feeCur).fees = round2(fee)

  const packages = o.delivery_packages ?? []
  for (const p of packages) {
    const amt = round2(p.package_price)
    if (!amt) continue
    const c = norm(p.currency || o.currency)
    const b = bag(c)
    b.pkgTotal = round2(b.pkgTotal + amt)
    if (p.paid) b.pkgDirect = round2(b.pkgDirect + amt)      // customer settled with the partner
    else if (p.provider_id) lines.push({ partyId: p.provider_id, cur: c, kind: 'pkg', owed: amt })
  }

  const invoices = o.retail_goods_invoices ?? []
  for (const r of invoices) {
    const amt  = round2(r.invoice_value)
    const comm = round2(r.commission_amount)
    if (!amt && !comm) continue
    const c = norm(r.currency)
    const b = bag(c)
    b.invTotal      = round2(b.invTotal + amt)
    b.invCommission = round2(b.invCommission + comm)
    if (r.exclude_calculation) b.invDirect = round2(b.invDirect + amt)   // customer paid the shop
    else if (r.contact_id) {
      const owed = round2(amt - comm)
      if (owed > 0) lines.push({ partyId: r.contact_id, cur: c, kind: 'inv', owed })
    }
  }

  // What of each stream we actually collected, at the order's own settled rate.
  for (const [c, b] of Object.entries(cur)) {
    const ratio = ratioFor(c)
    b.feesCollected = round2(b.fees * ratio)
    b.pkgCollected  = round2((b.pkgTotal - b.pkgDirect) * ratio)
    b.invCollected  = round2((b.invTotal - b.invDirect) * ratio)
  }

  return {
    id:       o.id,
    day,
    category: categoryOf(o),
    customerId: o.customer_id || o.customer?.id || '',
    packages: packages.length,
    invoices: invoices.length,
    cur,
    lines,
  }
}

/* ── the derived closing figures ──────────────────────────────────────────────
   Kept in one place so the panels, the charts, the table and the CSV all read
   the same arithmetic rather than four copies of it. */
export function derive(m) {
  const paidToPartner  = round2(m.pkgDirect + m.pkgPaidOut)
  const paidToSupplier = round2(m.invDirect + m.invPaidOut)
  return {
    ...m,
    feesPending:     round2(m.fees - m.feesCollected),
    paidToPartner,
    partnerDues:     round2(m.pkgTotal - paidToPartner),
    paidToSupplier,
    supplierPending: round2(m.invTotal - m.invDirect - m.invCommission - m.invPaidOut),
    billed:          round2(m.fees + m.pkgTotal + m.invTotal),
    collected:       round2(m.feesCollected + m.pkgCollected + m.invCollected),
  }
}

/* Is there anything at all in this currency bucket? Used to drop the currencies
   a window never touched, so the picker only offers the ones that carry money. */
const isEmpty = m => Object.values(m).every(v => round2(v) === 0)

/**
 * The whole report.
 *
 * @param orders      every loaded order (the window is applied here)
 * @param payouts     partner_payouts rows (partner AND shop payments live here)
 * @param from/to     inclusive 'YYYY-MM-DD' window bounds
 * @param closedOnly  count only delivered (closed) orders — the default, and
 *                    what makes the dues figures agree with the dues pages
 * @param customerId  narrow to one customer ('' = every customer)
 */
export function buildCategoryReport({
  orders = [], payouts = [], from, to, closedOnly = true, customerId = '',
} = {}) {
  /* ── 1. the orders the window holds, before any customer filter ──────────
     The payout spread below needs the full picture: a partner's payment is
     settled against everything they are owed, not only the part belonging to
     the customer someone happens to be looking at. */
  const rows = []
  let freeSkipped = 0
  let openSkipped = 0
  for (const o of orders) {
    const day = orderDay(o)
    if (!day || day < from || day > to) continue
    if (closedOnly && o.isclosed !== true) { openSkipped += 1; continue }
    // A free order is waived to zero — it earns nothing and owes nothing, so it
    // is left out entirely rather than counted as a fully-discounted sale.
    if (o.is_free_order === true) { freeSkipped += 1; continue }
    rows.push(extractOrder(o, day))
  }

  /* ── 2. spread each party's payouts over the lines they settle ───────────── */
  const owedBy = new Map()          // `${partyId}|${cur}` → what the window owes them
  for (const r of rows) for (const ln of r.lines) {
    const k = `${ln.partyId}|${ln.cur}`
    owedBy.set(k, round2((owedBy.get(k) || 0) + ln.owed))
  }

  const paidTo = new Map()          // `${partyId}|${cur}` → what we handed over
  for (const p of payouts) {
    const day = String(p.paid_at || p.created_at || '').slice(0, 10)
    if (!day || day < from || day > to) continue
    const k = `${p.partner_id}|${norm(p.currency)}`
    paidTo.set(k, round2((paidTo.get(k) || 0) + (Number(p.amount) || 0)))
  }

  for (const r of rows) for (const ln of r.lines) {
    const k    = `${ln.partyId}|${ln.cur}`
    const paid = paidTo.get(k) || 0
    const base = owedBy.get(k) || 0
    if (!paid || !base) continue
    // Never credit a party with more than the line owed them: a payout larger
    // than the window's debt is settling older deliveries, and letting the
    // surplus land here would turn this window's dues negative.
    const share = round2(Math.min(paid, base) * (ln.owed / base))
    const b = r.cur[ln.cur]
    if (ln.kind === 'pkg') b.pkgPaidOut = round2(b.pkgPaidOut + share)
    else                   b.invPaidOut = round2(b.invPaidOut + share)
  }

  /* ── 3. aggregate, now honouring the customer filter ─────────────────────── */
  const scoped = customerId ? rows.filter(r => r.customerId === customerId) : rows

  const { grain, list } = buildBuckets(from, to)
  const blank   = () => Object.fromEntries(CATEGORY_KEYS.map(k => [k, emptyGroup()]))
  const totals  = blank()
  const byBucket = new Map(list.map(b => [b.key, blank()]))

  /* How many orders each currency appears on. This — not the size of the
     totals — is what orders the currency picker: LBP figures are six digits
     where USD figures are two, so ranking by magnitude would open every report
     on LBP forever, which is the cross-currency comparison this whole report
     refuses to make. A count is currency-free and says the true thing: the
     currency the business mostly works in. */
  const curOrders = new Map()

  for (const r of scoped) {
    for (const c of Object.keys(r.cur)) curOrders.set(c, (curOrders.get(c) || 0) + 1)
    const slot = byBucket.get(bucketKeyOf(r.day, grain))
    for (const g of [totals[r.category], slot?.[r.category]]) {
      if (!g) continue
      g.orders   += 1
      g.packages += r.packages
      g.invoices += r.invoices
      for (const [c, m] of Object.entries(r.cur)) addInto(curOf(g, c), m)
    }
  }

  /* Currencies that actually carry a figure, most-used first. */
  const live = new Set()
  for (const k of CATEGORY_KEYS) {
    for (const [c, m] of Object.entries(totals[k].cur)) if (!isEmpty(m)) live.add(c)
  }
  const currencies = [...live].sort((a, b) =>
    (curOrders.get(b) || 0) - (curOrders.get(a) || 0) || a.localeCompare(b))

  const series = list.map(b => ({ ...b, groups: byBucket.get(b.key) }))

  return {
    from, to, grain, buckets: list, series, totals, currencies,
    orderCount: scoped.length,
    freeSkipped, openSkipped,
    /* A payout only reaches a figure through a line it can settle. Money paid to
       a party with nothing in this window — or paid beyond what the window owed
       them, which is an older delivery being cleared — lands nowhere, so it is
       reported here rather than silently dropped: it left the building either
       way, and a report that hides it would not balance. */
    unmatchedPayouts: [...paidTo.entries()].reduce((acc, [k, paid]) => {
      const spare = round2(paid - Math.min(paid, owedBy.get(k) || 0))
      if (spare <= 0) return acc
      const cur = k.split('|')[1]
      acc[cur] = round2((acc[cur] || 0) + spare)
      return acc
    }, {}),
  }
}

/* Per-category, per-currency figures for one bucket (or the window total),
   already derived. `null` when that category has nothing in that currency. */
export function groupMoney(group, cur) {
  const m = group?.cur?.[cur]
  return m ? derive(m) : null
}

export const ZERO = () => derive(emptyCur())

/* A day, written the way the filter bar and the PDF-free CSV both want it. */
export const dayText = d =>
  parseDay(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
