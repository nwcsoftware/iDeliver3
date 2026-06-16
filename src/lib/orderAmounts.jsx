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

/* Grouped money format for the amounts summary: thousands separators, 2 decimals
   for USD/EUR, none for LBP — e.g. 24,301.00 (USD) / 1,500,000 (LBP). */
export function fmtAmount(n, cur) {
  const dec = cur === 'LBP' ? 0 : 2
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/* Per-currency amount breakdown for an order row: delivery fee, other amounts
   (items/packages/services/invoices/vat − discount), the order total, the amount
   collected so far and the pending balance. Returns one entry per currency that
   has any non-zero figure, so single-currency orders stay compact. */
export function orderAmountBreakdown(o) {
  const total = orderTotalsByCurrency(o)              // { USD, LBP, … } order totals
  const feeCur = o.currency || 'USD'
  const fee = Number(o.delivery_fee) > 0 ? Number(o.delivery_fee) : 0
  // Collected is derived per-currency from the order's payments.
  const collected = orderCollectedByCurrency(o)
  const currs = new Set([...Object.keys(total), ...Object.keys(collected), feeCur])
  const rows = []
  for (const cur of currs) {
    const tot   = round2(total[cur] || 0)
    const deliv = cur === feeCur ? round2(fee) : 0
    const other = round2(tot - deliv)
    const coll  = round2(collected[cur] || 0)
    const pend  = round2(Math.max(0, tot - coll))
    if (tot === 0 && deliv === 0 && coll === 0) continue
    rows.push({ cur, delivery: deliv, other, total: tot, collected: coll, pending: pend })
  }
  return rows
}

/* Order amounts summary card body (header + per-currency breakdown). Shared by
   the click popover and the cursor-following hover preview; each caller supplies
   its own outer chrome (border / shadow / width). */
export function AmountSummaryContent({ order }) {
  const rows = orderAmountBreakdown(order)
  const driverName = `${order.driver?.first_name ?? ''} ${order.driver?.last_name ?? ''}`.trim()
  const collectedLabel = driverName ? `Collected by ${driverName}` : 'Collected'
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
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
                <span className="text-slate-500">Delivery fee</span>
                <span className="text-right">{fmtAmount(r.delivery, r.cur)}</span>
                <span className="text-slate-500">Other amounts</span>
                <span className="text-right">{fmtAmount(r.other, r.cur)}</span>
                <span className="text-slate-300 border-t border-surface-border/60 pt-1">Total order</span>
                <span className="text-right text-slate-100 border-t border-surface-border/60 pt-1">{fmtAmount(r.total, r.cur)}</span>
                <span className="text-slate-500">{collectedLabel}</span>
                <span className="text-right text-emerald-300/90">{fmtAmount(r.collected, r.cur)}</span>
                <span className="text-slate-500">Pending</span>
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
  const w = el.offsetWidth || 300
  const h = el.offsetHeight || 220
  let left = x + pad
  let top  = y + pad
  if (left + w > window.innerWidth - 8) left = x - w - pad
  if (top + h > window.innerHeight - 8) top = y - h - pad
  el.style.left = Math.max(8, left) + 'px'
  el.style.top  = Math.max(8, top) + 'px'
}
