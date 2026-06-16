import React from 'react'
import { Receipt } from 'lucide-react'

/* Shared order-amounts helpers + summary card, used by the Deliveries (daily /
   closed) lists and the Driver Dues list so the popup stays identical. */

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

/* Per-currency total of a saved order, from its line items + fee/discount/vat. */
export function orderTotalsByCurrency(o) {
  const t = {}
  const add = (cur, n) => { if (n) t[cur] = (t[cur] || 0) + n }
  const active = (o.order_items ?? []).filter(it => !it.is_deleted)
  for (const it of active) add(it.currency || 'USD', Number(it.line_total || 0))
  // Packages, services & external retail invoices each carry their own currency.
  // Packages already paid directly to the provider don't count toward the order total.
  for (const p of (o.delivery_packages ?? []))     if (!p.paid) add(p.currency || o.currency || 'USD', Number(p.package_price) || 0)
  for (const s of (o.order_services ?? []))         add(s.service_fees_currency || 'USD', Number(s.service_fees) || 0)
  for (const r of (o.retail_goods_invoices ?? []))  add(r.currency || 'USD', Number(r.invoice_value) || 0)
  const discountCur = o.discount_currency || o.currency
  add(o.currency, Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : 0)
  add(discountCur, Number(o.discount_amount) > 0 ? -Number(o.discount_amount) : 0)
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

/* Per-currency "amount to collect from the driver" = delivery fees + local retail
   items (order_items). Mirrors the "To collect from driver" line in the popup, so
   list totals can show just that figure. */
export function orderDriverCollectByCurrency(o) {
  const t = {}
  const feeCur = o.currency || 'USD'
  const fee = Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : 0
  if (fee) t[feeCur] = (t[feeCur] || 0) + fee
  for (const it of (o.order_items ?? []).filter(i => !i.is_deleted)) {
    const cur = it.currency || 'USD'
    t[cur] = (t[cur] || 0) + (Number(it.line_total) || 0)
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
     fromDriver     to collect from the driver = fees + localRetail
     pending        Order Pending = localRetail + fees                         */
export function orderAmountBreakdown(o) {
  const feeCur      = o.currency || 'USD'
  const discountCur = o.discount_currency || o.currency || 'USD'

  const buckets = {}   // cur -> category sums
  const bucket = cur => (buckets[cur] ||= {
    packages: 0, services: 0, localRetail: 0, externalRetail: 0, fees: 0, discount: 0, vat: 0,
  })

  for (const it of (o.order_items ?? []).filter(i => !i.is_deleted)) bucket(it.currency || 'USD').localRetail += Number(it.line_total) || 0
  for (const p of (o.delivery_packages ?? [])) if (!p.paid)         bucket(p.currency || o.currency || 'USD').packages += Number(p.package_price) || 0
  for (const s of (o.order_services ?? []))                          bucket(s.service_fees_currency || 'USD').services += Number(s.service_fees) || 0
  for (const r of (o.retail_goods_invoices ?? []))                   bucket(r.currency || 'USD').externalRetail += Number(r.invoice_value) || 0
  if (Number(o.delivery_fee)   > 0) bucket(feeCur).fees       += Number(o.delivery_fee)
  if (Number(o.discount_amount) > 0) bucket(discountCur).discount += Number(o.discount_amount)
  if (Number(o.vat_amount)      > 0) bucket(feeCur).vat        += Number(o.vat_amount)

  const collected = orderCollectedByCurrency(o)
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
    if (total === 0 && coll === 0) continue
    rows.push({
      cur, packages, services, localRetail, externalRetail, fees, discount, vat,
      total, collected: coll,
      balance:    round2(total - coll),
      fromDriver: round2(fees + localRetail),
      pending:    round2(localRetail + fees),
    })
  }
  return rows
}

/* Order amounts summary card body (header + per-currency breakdown). Shared by
   the click popover and the cursor-following hover preview; each caller supplies
   its own outer chrome (border / shadow / width). */
export function AmountSummaryContent({ order }) {
  const rows = orderAmountBreakdown(order)
  const driverName = `${order.driver?.first_name ?? ''} ${order.driver?.last_name ?? ''}`.trim()
  const collectedLabel = driverName ? `Collected from customer by ${driverName}` : 'Collected from customer'
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
                <span className="text-slate-500">Delivery Packages</span>
                <span className="text-right">{fmtAmount(r.packages, r.cur)}</span>
                <span className="text-slate-500">Order Services</span>
                <span className="text-right">{fmtAmount(r.services, r.cur)}</span>
                <span className="text-slate-500">Local retail items</span>
                <span className="text-right">{fmtAmount(r.localRetail, r.cur)}</span>
                <span className="text-slate-500">External retail invoices</span>
                <span className="text-right">{fmtAmount(r.externalRetail, r.cur)}</span>
                <span className="text-slate-500">Delivery fees</span>
                <span className="text-right">{fmtAmount(r.fees, r.cur)}</span>
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
                <span className="text-slate-500">{collectedLabel}</span>
                <span className="text-right text-emerald-300/90">{fmtAmount(r.collected, r.cur)}</span>
                <span className="text-slate-500">Balance</span>
                <span className={`text-right ${r.balance > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{fmtAmount(r.balance, r.cur)}</span>
                <span className="text-[#1dffd5] font-semibold [text-shadow:0_0_6px_rgba(29,255,213,0.75)] border-t border-surface-border/60 pt-1">{fromDriverLabel}</span>
                <span className="text-right text-[#1dffd5] font-semibold [text-shadow:0_0_6px_rgba(29,255,213,0.75)] border-t border-surface-border/60 pt-1">{fmtAmount(r.fromDriver, r.cur)}</span>
                <span className="text-slate-500">Order Pending</span>
                <span className={`text-right ${r.pending > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{fmtAmount(r.pending, r.cur)}</span>
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
