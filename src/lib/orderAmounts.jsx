import React from 'react'
import { Receipt } from 'lucide-react'

/* Shared order-amounts helpers + summary card, used by the Deliveries (daily /
   closed) lists and the Driver Dues list so the popup stays identical. */

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

/* Display name for a joined provider/supplier contact: company name first, else
   person name, else empty (caller decides the fallback). */
function contactName(c) {
  if (!c) return ''
  return (c.company_name?.trim())
    || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
    || ''
}

/* Per-currency total of a saved order, from its line items + fee/discount/vat. */
export function orderTotalsByCurrency(o) {
  // A free order is waived to zero regardless of the items it carries, so it
  // reads as $0 everywhere (lists, settlements, payment popups).
  if (o?.is_free_order === true) return {}
  const t = {}
  const add = (cur, n) => { if (n) t[cur] = (t[cur] || 0) + n }
  const active = (o.order_items ?? []).filter(it => !it.is_deleted)
  for (const it of active) add(it.currency || 'USD', Number(it.line_total || 0))
  // Packages, services & external retail invoices each carry their own currency.
  // Packages already paid directly to the provider don't count toward the order total.
  for (const p of (o.delivery_packages ?? []))     if (!p.paid) add(p.currency || o.currency || 'USD', Number(p.package_price) || 0)
  for (const s of (o.order_services ?? []))         add(s.service_fees_currency || 'USD', Number(s.service_fees) || 0)
  // A retail invoice already paid directly to the shop is excluded from the order total.
  for (const r of (o.retail_goods_invoices ?? []))  if (!r.paid) add(r.currency || 'USD', Number(r.invoice_value) || 0)
  const discountCur = o.discount_currency || o.currency
  add(o.currency, Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : 0)
  add(discountCur, -Math.abs(Number(o.discount_amount) || 0))
  add(o.currency, Number(o.vat_amount) > 0 ? Number(o.vat_amount) : 0)
  return t
}

/* Per-currency amount collected on an order, derived from its payment_collections
   (each payment carries its own amount + currency). Replaces the old fixed
   collected_usd / collected_lbp columns, so any currency is supported. */
export function orderCollectedByCurrency(o) {
  const c = {}
  for (const p of (o.payment_collections ?? [])) {
    const cur = p.currency || 'USD'
    c[cur] = (c[cur] || 0) + (Number(p.amount) || 0)
  }
  return c
}

/* Per-currency amount the DRIVER collected from the customer = payments NOT taken
   by an office user. A payment stamped with collected_by_name was paid to the
   office directly, so the driver never handled that cash and it's left out of the
   driver settlement. Legacy payments (no collector name) count as driver-collected. */
export function orderDriverCollectedByCurrency(o) {
  const c = {}
  for (const p of (o.payment_collections ?? [])) {
    // Driver-collected = the order's own driver took the cash. The driver app stamps
    // the driver's contact id (collected_by) + name; legacy driver payments carry no
    // collector name at all. A named payment by anyone else is an office collection.
    const byDriver = !p.collected_by_name || (o.driver_id && p.collected_by === o.driver_id)
    if (!byDriver) continue
    const cur = p.currency || 'USD'
    c[cur] = (c[cur] || 0) + (Number(p.amount) || 0)
  }
  return c
}

/* Per-currency amount paid DIRECTLY to the office = payments stamped with a
   collector name (an office user took the cash). The mirror of
   orderDriverCollectedByCurrency: this money never passed through the driver, so
   there's nothing to collect from them for it — it's shown separately on the
   Driver Settlements screen. */
export function orderOfficeCollectedByCurrency(o) {
  const c = {}
  for (const p of (o.payment_collections ?? [])) {
    if (!p.collected_by_name) continue                        // no name = driver-collected
    if (o.driver_id && p.collected_by === o.driver_id) continue   // the order's driver, not office
    const cur = p.currency || 'USD'
    c[cur] = (c[cur] || 0) + (Number(p.amount) || 0)
  }
  return c
}

/* Distinct names of office users who collected payments on an order (those with a
   collected_by_name), for showing "Collected by <name>" in the amounts summary. */
export function orderCollectorNames(o) {
  const names = []
  for (const p of (o.payment_collections ?? [])) {
    if (o.driver_id && p.collected_by === o.driver_id) continue   // the driver, not an office collector
    const n = (p.collected_by_name || '').trim()
    if (n && !names.includes(n)) names.push(n)
  }
  return names
}

/* Per-currency "amount to collect from the driver" = delivery fees + local retail
   items (order_items) + unpaid delivery packages. A package already paid directly
   to its provider isn't collected from the driver. Mirrors the "To collect from
   driver" line in the popup, so list totals can show just that figure. */
export function orderDriverCollectByCurrency(o) {
  const t = {}
  const feeCur = o.currency || 'USD'
  const fee = Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : 0
  if (fee) t[feeCur] = (t[feeCur] || 0) + fee
  for (const it of (o.order_items ?? []).filter(i => !i.is_deleted)) {
    const cur = it.currency || 'USD'
    t[cur] = (t[cur] || 0) + (Number(it.line_total) || 0)
  }
  for (const p of (o.delivery_packages ?? [])) if (!p.paid) {
    const cur = p.currency || o.currency || 'USD'
    t[cur] = (t[cur] || 0) + (Number(p.package_price) || 0)
  }
  return t
}

/* Grouped money format for the amounts summary: thousands separators, 2 decimals
   for USD/EUR, none for LBP — e.g. 24,301.00 (USD) / 1,500,000 (LBP). */
export function fmtAmount(n, cur) {
  const dec = cur === 'LBP' ? 0 : 2
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/* Per-currency, per-category amount breakdown for an order. Each category keeps
   its own currency (packages/services/items/invoices can differ), so amounts are
   bucketed by currency. Returns one row per currency that has any figure.

   Per row:
     packages       delivery_packages (unpaid)
     services       order_services
     localRetail    order_items (your catalog products)
     externalRetail retail_goods_invoices
     fees           delivery_fee
     discount       discount_amount (subtracted from total)
     vat            vat_amount (added to total)
     total          Total All = packages+services+localRetail+externalRetail+fees−discount+vat
     collected      paid by the customer (to the driver) so far
     balance        Total All − collected
     fromDriver     to collect from the driver = what the driver collected (= collected)
     pending        Order Pending = localRetail + fees                         */
export function orderAmountBreakdown(o, filterContactId = null) {
  const feeCur      = o.currency || 'USD'
  const discountCur = o.discount_currency || o.currency || 'USD'

  const buckets = {}   // cur -> category sums
  const bucket = cur => (buckets[cur] ||= {
    packages: 0, services: 0, localRetail: 0, externalRetail: 0, fees: 0, discount: 0, vat: 0,
    // Per-line detail (source name + amount) so the popup can itemise each
    // package / service / external invoice when there's more than one.
    packageLines: [], serviceLines: [], externalLines: [],
  })

  // 2nd-party (supplier/partner) scoping: when a contact id is passed, only the
  // delivery packages they provide (provider_id) and the external retail invoices
  // for their shop/warehouse (contact_id) are counted — the order-level figures
  // (local retail, services, fees, discount, vat) belong to the whole order, not
  // to a single 2nd party, so they're skipped entirely.
  if (!filterContactId) {
    // Paid packages / invoices are still listed (so they're visible) but flagged
    // paid — the popup crosses them out and they don't add to the category sum.
    for (const it of (o.order_items ?? []).filter(i => !i.is_deleted)) bucket(it.currency || 'USD').localRetail += Number(it.line_total) || 0
  }
  for (const p of (o.delivery_packages ?? [])) {
    if (filterContactId && p.provider_id !== filterContactId) continue
    const amt = Number(p.package_price) || 0
    const b = bucket(p.currency || o.currency || 'USD')
    if (!p.paid) b.packages += amt
    b.packageLines.push({ name: contactName(p.provider), amount: amt, paid: !!p.paid })
  }
  if (!filterContactId) {
    for (const s of (o.order_services ?? [])) {
      const amt = Number(s.service_fees) || 0
      const b = bucket(s.service_fees_currency || 'USD')
      b.services += amt
      b.serviceLines.push({ name: contactName(s.provider), amount: amt, paid: false })
    }
  }
  for (const r of (o.retail_goods_invoices ?? [])) {
    if (filterContactId && r.contact_id !== filterContactId) continue
    const amt = Number(r.invoice_value) || 0
    const b = bucket(r.currency || 'USD')
    if (!r.paid) b.externalRetail += amt
    b.externalLines.push({ name: (r.shop_name || '').trim(), amount: amt, paid: !!r.paid })
  }
  if (!filterContactId) {
    if (Number(o.delivery_fee)   > 0) bucket(feeCur).fees       += Number(o.delivery_fee)
    if (Number(o.discount_amount)) bucket(discountCur).discount += Math.abs(Number(o.discount_amount))
    if (Number(o.vat_amount)      > 0) bucket(feeCur).vat        += Number(o.vat_amount)
  }

  const collected       = orderCollectedByCurrency(o)
  const driverCollected = orderDriverCollectedByCurrency(o)
  const currs = new Set([...Object.keys(buckets), ...Object.keys(collected)])

  const rows = []
  for (const cur of currs) {
    const b = bucket(cur)
    const packages       = round2(b.packages)
    const services       = round2(b.services)
    const localRetail    = round2(b.localRetail)
    const externalRetail = round2(b.externalRetail)
    const fees           = round2(b.fees)
    const discount       = round2(b.discount)
    const vat            = round2(b.vat)
    const total          = round2(packages + services + localRetail + externalRetail + fees - discount + vat)
    const coll           = round2(collected[cur] || 0)
    const hasLines       = b.packageLines.length || b.serviceLines.length || b.externalLines.length
    if (total === 0 && coll === 0 && !hasLines) continue
    rows.push({
      cur, packages, services, localRetail, externalRetail, fees, discount, vat,
      packageLines: b.packageLines, serviceLines: b.serviceLines, externalLines: b.externalLines,
      total, collected: coll,
      balance:    round2(total - coll),
      // "To collect from the driver" = what the driver collected from the customer.
      // Payments taken directly by an office user (paid to office) are excluded —
      // the driver never handled that cash, so it isn't owed back by the driver.
      fromDriver: round2(driverCollected[cur] || 0),
      pending:    round2(localRetail + fees),
    })
  }
  return rows
}

/* One amount category in the summary grid. With more than one line item it lists
   each separately, naming its source (package provider / service supplier / retail
   shop); with one it shows a single labelled line, still naming the source; with
   none it shows the plain category total. Paid lines are crossed out in gray
   ("switched off") and don't count toward the total. Emits bare grid cells. */
function CategoryRows({ groupLabel, itemLabel, lines, sum, cur, hideName = false }) {
  if (lines.length === 0) {
    return (
      <>
        <span className="text-slate-500">{groupLabel}</span>
        <span className="text-right">{fmtAmount(sum, cur)}</span>
      </>
    )
  }
  const multi = lines.length > 1
  return lines.map((ln, i) => {
    const label = multi ? itemLabel : groupLabel
    const labelCls  = ln.paid ? 'text-slate-600 line-through' : 'text-slate-500'
    const amountCls = ln.paid ? 'text-slate-600 line-through' : ''
    return (
      <React.Fragment key={i}>
        <span className={`truncate ${labelCls}`}>
          {label}{!hideName && ln.name ? <span className={ln.paid ? '' : 'text-slate-400'}> · {ln.name}</span> : ''}
        </span>
        <span className={`text-right ${amountCls}`}>{fmtAmount(ln.amount, cur)}</span>
      </React.Fragment>
    )
  })
}

/* Order amounts summary card body (header + per-currency breakdown). Shared by
   the click popover and the cursor-following hover preview; each caller supplies
   its own outer chrome (border / shadow / width). */
export function AmountSummaryContent({ order, filterContactId = null }) {
  const rows = orderAmountBreakdown(order, filterContactId)
  // 2nd-party (supplier/partner) view: show only their own packages + external
  // retail invoice totals. Hide the order-level / driver / collection rows.
  const partyView = !!filterContactId
  const driverName = `${order.driver?.first_name ?? ''} ${order.driver?.last_name ?? ''}`.trim()
  // Office users who took payment directly (paid to office). When present, the
  // money was collected by them rather than the driver.
  const collectorNames = orderCollectorNames(order)
  const collectedLabel = collectorNames.length
    ? `Collected by ${collectorNames.join(', ')}`
    : driverName ? `Collected from customer by ${driverName}` : 'Collected from customer'
  const fromDriverLabel = driverName ? `To collect from ${driverName}` : 'To collect from driver'
  return (
    <div className="text-xs">
      <div className="px-3 py-2 border-b border-surface-border flex items-center gap-2">
        <Receipt className="w-3.5 h-3.5 text-brand-300 flex-shrink-0" />
        <span className="font-mono text-brand-300">{order.order_number}</span>
        <span className="text-slate-400 truncate">· {order.recipient_name}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-slate-500 text-center">No amounts on this order</p>
      ) : (
        <div className="p-3 space-y-3">
          {rows.map(r => (
            <div key={r.cur} className="font-normal text-slate-300">
              {rows.length > 1 && <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1">{r.cur}</div>}
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
                <CategoryRows groupLabel="Delivery Packages" itemLabel="Delivery Package"
                  lines={r.packageLines} sum={r.packages} cur={r.cur} hideName={partyView} />
                {!partyView && (
                  <CategoryRows groupLabel="Order Services" itemLabel="Order Service"
                    lines={r.serviceLines} sum={r.services} cur={r.cur} />
                )}
                {!partyView && (<>
                  <span className="text-slate-500">Local retail items</span>
                  <span className="text-right">{fmtAmount(r.localRetail, r.cur)}</span>
                </>)}
                <CategoryRows groupLabel="External retail invoices" itemLabel="External retail invoice"
                  lines={r.externalLines} sum={r.externalRetail} cur={r.cur} hideName={partyView} />
                {!partyView && (<>
                  <span className="text-slate-500">Delivery fees</span>
                  <span className="text-right">{fmtAmount(r.fees, r.cur)}</span>
                </>)}
                {r.discount > 0 && (<>
                  <span className="text-slate-500">Discount</span>
                  <span className="text-right text-rose-300/90">−{fmtAmount(r.discount, r.cur)}</span>
                </>)}
                {r.vat > 0 && (<>
                  <span className="text-slate-500">VAT</span>
                  <span className="text-right">{fmtAmount(r.vat, r.cur)}</span>
                </>)}
                <span className="text-slate-200 font-medium border-t border-surface-border/60 pt-1">Total All</span>
                <span className="text-right text-slate-100 font-medium border-t border-surface-border/60 pt-1">{fmtAmount(r.total, r.cur)}</span>
                {!partyView && (<>
                  <span className="text-slate-500">{collectedLabel}</span>
                  <span className="text-right text-emerald-300/90">{fmtAmount(r.collected, r.cur)}</span>
                  <span className="text-slate-500">Balance</span>
                  <span className={`text-right ${r.balance > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{fmtAmount(r.balance, r.cur)}</span>
                  <span className="text-[#1dffd5] font-semibold [text-shadow:0_0_6px_rgba(29,255,213,0.75)] border-t border-surface-border/60 pt-1">{fromDriverLabel}</span>
                  <span className="text-right text-[#1dffd5] font-semibold [text-shadow:0_0_6px_rgba(29,255,213,0.75)] border-t border-surface-border/60 pt-1">{fmtAmount(r.fromDriver, r.cur)}</span>
                  <span className="text-slate-500">Order Pending</span>
                  <span className={`text-right ${r.pending > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{fmtAmount(r.pending, r.cur)}</span>
                </>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* Position the cursor-following hover panel near the pointer, flipping to the
   other side when it would overflow the viewport. Writes styles directly so
   pointer moves don't re-render the order list. */
export function placeHoverPanel(el, x, y) {
  if (!el) return
  const pad = 16
  const w = el.offsetWidth || 340
  const h = el.offsetHeight || 280
  let left = x + pad
  let top  = y + pad
  if (left + w > window.innerWidth - 8) left = x - w - pad
  if (top + h > window.innerHeight - 8) top = y - h - pad
  el.style.left = Math.max(8, left) + 'px'
  el.style.top  = Math.max(8, top) + 'px'
}
