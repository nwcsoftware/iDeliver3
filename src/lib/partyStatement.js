import { CURRENCIES } from './partnerDues'

/* One statement for a supplier or partner — the same figures whether it is read
   in the portal by the party themselves or in the office by the call centre.

   ── What belongs to a party on an order ────────────────────────────────────
   Three kinds of line can carry their name:
     • delivery_packages.provider_id   — a parcel they handed us to deliver
     • retail_goods_invoices.contact_id— goods bought from their shop
     • order_items.supplier_id         — their shop products sold in the app
   An order counts on their statement when at least one of those points at them.

   ── Who placed it, and what that means for money ───────────────────────────
     partner   — THEY placed it from the portal. No commission: we only charge
                 the delivery fee.
     customer  — the customer ordered their goods in the mobile app.
     office    — the call centre took the order by phone.
   For the last two we earn commission at the rate on their contact profile,
   snapshotted onto each line when the order is saved (commission_amount), so a
   later rate change never rewrites history.

   ── The balance ────────────────────────────────────────────────────────────
     goods sold (not paid to them directly)
   − commission we earned
   − already paid out to them
   = pending

   Delivery fees are reported but NOT deducted: a fee is billed on the order and
   collected with it, so it settles on its own account. This matches Partner
   Dues, the page payouts are made from — the two must agree.

   Every figure is per currency; nothing is ever converted. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const norm   = c => (CURRENCIES.includes(c) ? c : (c || 'USD'))

export const SOURCES = [
  { key: 'partner',  label: 'Placed by the shop',   hint: 'No commission — delivery fee only' },
  { key: 'customer', label: 'Customer application', hint: 'Commission at the profile rate' },
  { key: 'office',   label: 'Call centre',          hint: 'Commission at the profile rate' },
]

/* Which of the three a row belongs to. The stored values have drifted over
   time ('customer', 'customer application', and one batch with a stray newline),
   so this normalises rather than comparing exact strings. */
export function orderSource(o) {
  const raw = String(o?.order_source || '').trim().toLowerCase()
  if (raw === 'partner' || raw === 'supplier') return 'partner'
  if (raw.startsWith('customer')) return 'customer'
  return 'office'
}

export const isDelivered = (o) =>
  o?.delivery_status === 'Delivered' || String(o?.status || '').toLowerCase() === 'completed' || !!o?.isclosed

/* The date an order lands on the statement: when it closed, else its scheduled
   day, else when it was raised — same rule as the office statements. */
export function statementDate(o) {
  const raw = o?.closed_at || o?.scheduled_date || o?.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

/* Is this payment the driver's cash, or money taken at the office?
   Legacy rows carry no group and were always driver collections. */
const byDriver = (pc) => String(pc?.collection_group || 'Driver').toLowerCase() !== 'call center'

/* One order, seen from one party's side. Returns null when nothing on the
   order belongs to them. */
export function partyOrderLines(order, contactId) {
  if (!order || !contactId) return null

  const goods = {}        // currency → what their goods sold for
  const paidDirect = {}   // currency → collected by them from the customer
  const commission = {}   // currency → what we earned on their goods
  let packages = 0

  const add = (bag, cur, n) => { if (n) bag[norm(cur)] = round2((bag[norm(cur)] || 0) + n) }

  for (const p of order.delivery_packages ?? []) {
    if (p.provider_id !== contactId) continue
    packages += 1
    const amt = Number(p.package_price) || 0
    // A package flagged paid went straight into their pocket — it is theirs,
    // but we never held it, so it settles immediately.
    if (p.paid) add(paidDirect, p.currency || order.currency, amt)
    else        add(goods,      p.currency || order.currency, amt)
  }

  for (const r of order.retail_goods_invoices ?? []) {
    if (r.contact_id !== contactId) continue
    if (!r.exclude_calculation) add(goods, r.currency, Number(r.invoice_value) || 0)
    else                        add(paidDirect, r.currency, Number(r.invoice_value) || 0)
    add(commission, r.currency, Number(r.commission_amount) || 0)
  }

  for (const it of order.order_items ?? []) {
    if (it.is_deleted || it.supplier_id !== contactId) continue
    add(goods,      it.currency, Number(it.line_total) || 0)
    add(commission, it.currency, Number(it.commission_amount) || 0)
  }

  const currencies = new Set([...Object.keys(goods), ...Object.keys(paidDirect), ...Object.keys(commission)])
  if (currencies.size === 0 && packages === 0) return null

  // The delivery fee is only "theirs" when the order is billed to them — i.e.
  // they are the customer on it. Otherwise the customer paid it.
  const fees = {}
  if (order.customer_id === contactId && Number(order.delivery_fee) > 0) {
    add(fees, order.currency, Number(order.delivery_fee))
  }

  // Cash on this order, split the way the Cashier Box splits it.
  const collectedDriver = {}, collectedOffice = {}
  for (const pc of order.payment_collections ?? []) {
    add(byDriver(pc) ? collectedDriver : collectedOffice, pc.currency, Number(pc.amount) || 0)
  }

  return {
    order,
    id: order.id,
    orderNumber: order.order_number,
    date: statementDate(order),
    source: orderSource(order),
    delivered: isDelivered(order),
    closed: !!order.isclosed,
    packages,
    goods, paidDirect, commission, fees,
    collectedDriver, collectedOffice,
  }
}

const emptyTotals = () => ({
  scheduledCount: 0, deliveredCount: 0, packages: 0,
  scheduled: {}, delivered: {}, goods: {}, paidDirect: {}, commission: {}, fees: {},
  collectedDriver: {}, collectedOffice: {}, received: {}, pending: {},
})

const bump = (bag, cur, n) => { if (n) bag[norm(cur)] = round2((bag[norm(cur)] || 0) + n) }
const sumInto = (bag, other) => { for (const [c, v] of Object.entries(other || {})) bump(bag, c, v) }

/**
 * The whole statement.
 *
 * @param orders    every order in scope (the app's loaded list)
 * @param payouts   partner_payouts rows for this party
 * @param contactId the supplier/partner
 * @param from/to   optional YYYY-MM-DD range, inclusive
 */
export function buildPartyStatement({ orders = [], payouts = [], contactId, from = '', to = '' } = {}) {
  const rows = []
  const totals = emptyTotals()
  const bySource = Object.fromEntries(SOURCES.map(s => [s.key, emptyTotals()]))

  for (const o of orders) {
    const line = partyOrderLines(o, contactId)
    if (!line) continue
    if (from && line.date && line.date < from) continue
    if (to   && line.date && line.date > to)   continue
    rows.push(line)

    for (const bag of [totals, bySource[line.source]]) {
      bag.packages += line.packages
      if (line.delivered) { bag.deliveredCount += 1; sumInto(bag.delivered, line.goods) }
      else                { bag.scheduledCount += 1; sumInto(bag.scheduled, line.goods) }
      sumInto(bag.goods,           line.goods)
      sumInto(bag.paidDirect,      line.paidDirect)
      sumInto(bag.commission,      line.commission)
      sumInto(bag.fees,            line.fees)
      sumInto(bag.collectedDriver, line.collectedDriver)
      sumInto(bag.collectedOffice, line.collectedOffice)
    }
  }

  // Money we have actually handed over. Payouts are not per order, so they sit
  // on the statement as a whole and respect the same date range.
  for (const p of payouts) {
    const day = String(p.paid_at || p.created_at || '').slice(0, 10)
    if (from && day && day < from) continue
    if (to   && day && day > to)   continue
    bump(totals.received, p.currency, Number(p.amount) || 0)
  }

  /* Pending = what we hold for them, less what we earned and what we paid out.

     Delivery fees are deliberately NOT deducted. A fee is billed on the order
     and collected with it — from the driver's cash or at the counter — so it is
     settled on its own account. Netting it here disagreed with Partner Dues,
     the page the payouts are actually made from, and left a shop that had been
     paid in full showing a large negative balance. Two pages answering "what do
     we owe?" differently is worse than either answer. The fees remain on their
     own card, and in `feesOwed`, so nothing is hidden. */
  const currencies = new Set([
    ...Object.keys(totals.goods), ...Object.keys(totals.commission),
    ...Object.keys(totals.received),
  ])
  for (const c of currencies) {
    const v = round2((totals.goods[c] || 0) - (totals.commission[c] || 0) - (totals.received[c] || 0))
    if (v) totals.pending[c] = v
  }
  // What the shop owes US for delivery on its own orders — reported, not netted.
  totals.feesOwed = { ...totals.fees }

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date))
    || String(b.orderNumber).localeCompare(String(a.orderNumber)))
  return { rows, totals, bySource }
}

/* "120.00 USD + 3,000,000 LBP", or a dash when there is nothing. */
export const money = (v, c) =>
  `${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: c === 'LBP' ? 0 : 2,
    maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c}`

export const bagText = (bag) => {
  const parts = Object.entries(bag || {})
    .filter(([, v]) => Math.round((Number(v) || 0) * 100) !== 0)
    .map(([c, v]) => money(v, c))
  return parts.length ? parts.join('  +  ') : '—'
}
