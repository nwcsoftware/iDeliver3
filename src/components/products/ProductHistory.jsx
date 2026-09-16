import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import { Loader2, TrendingUp, ShoppingCart, Truck, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/* What this item has cost and what it has sold for.
 *
 * An item here is not fixed-price: it is bought at whatever the market asked
 * that week and sold at whatever the market will bear. So the two numbers on
 * the product form — unit_cost and unit_price — are not facts about the item,
 * they are the CURRENT standing prices, and the only way to judge whether they
 * are still right is to see what actually happened either side of them.
 *
 * Hence three things, together, in the form itself rather than on a report
 * nobody opens: the purchases, the sales, and a line through both.
 *
 * ONE CURRENCY AT A TIME. Prices live in LBP and USD and there is no rate
 * anywhere in this application. Plotting both on one axis would draw a cliff
 * every time the currency changed and call it a price movement, so the chart
 * shows a single currency and says which. The picker only offers currencies
 * this item has actually traded in.
 */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const day = d => (d ? String(d).slice(0, 10) : '')

const fmt = (v, cur) => `${cur} ${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: cur === 'LBP' ? 0 : 2,
  maximumFractionDigits: cur === 'LBP' ? 0 : 2,
})}`

/* Axis figures only — 1.2k / 3.4M. Full precision lives in the tooltip. */
function compact(n) {
  const v = Number(n) || 0, a = Math.abs(v)
  const cut = (u, s) => `${(v / u).toFixed(a / u >= 10 ? 0 : 1).replace(/\.0$/, '')}${s}`
  if (a >= 1e9) return cut(1e9, 'B')
  if (a >= 1e6) return cut(1e6, 'M')
  if (a >= 1e3) return cut(1e3, 'k')
  return String(Math.round(v))
}

const COST = '#f59e0b'   // what we paid
const SOLD = '#22c55e'   // what we got

function ChartTip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] text-slate-400">{label}</p>
      {payload.filter(p => p.value != null).map(p => (
        <p key={p.dataKey} className="text-xs mt-0.5" style={{ color: p.color }}>
          {p.name}: <span className="tabular-nums">{fmt(p.value, currency)}</span>
        </p>
      ))}
    </div>
  )
}

export default function ProductHistory({ product }) {
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [purchases, setPurchases] = useState([])
  const [sales,     setSales]     = useState([])
  const [currency,  setCurrency]  = useState(product?.currency || 'USD')

  const load = useCallback(async () => {
    if (!product?.id) return
    setLoading(true); setError('')
    try {
      const [pi, oi] = await Promise.all([
        supabase.from('purchase_invoice_items')
          .select('id, quantity, unit_cost, line_total, purchase_invoice:purchase_invoices'
            + '(invoice_number, invoice_date, currency, status, supplier:contacts!supplier_id(company_name, first_name, last_name))')
          .eq('product_id', product.id),
        supabase.from('order_items')
          .select('id, quantity, unit_price, currency, added_at, is_deleted, '
            + 'order:delivery_orders(order_number, scheduled_date, status)')
          .eq('product_id', product.id)
          .order('added_at', { ascending: false })
          .limit(500),
      ])
      if (pi.error) throw new Error(pi.error.message)
      if (oi.error) throw new Error(oi.error.message)

      setPurchases((pi.data ?? []).map(r => ({
        id: r.id,
        date: day(r.purchase_invoice?.invoice_date),
        qty: Number(r.quantity) || 0,
        price: round2(r.unit_cost),
        currency: r.purchase_invoice?.currency || 'USD',
        ref: r.purchase_invoice?.invoice_number || '—',
        who: (r.purchase_invoice?.supplier?.company_name
          || `${r.purchase_invoice?.supplier?.first_name ?? ''} ${r.purchase_invoice?.supplier?.last_name ?? ''}`.trim()
          || '—'),
        status: r.purchase_invoice?.status || '',
      })).sort((a, b) => b.date.localeCompare(a.date)))

      /* A deleted order line is a line somebody took back off the order. It was
         never sold, so it is not part of what this item sells for. */
      setSales((oi.data ?? []).filter(r => !r.is_deleted).map(r => ({
        id: r.id,
        date: day(r.order?.scheduled_date || r.added_at),
        qty: Number(r.quantity) || 0,
        price: round2(r.unit_price),
        currency: r.currency || 'USD',
        ref: r.order?.order_number || '—',
      })).sort((a, b) => b.date.localeCompare(a.date)))
    } catch (e) {
      setError(e?.message || 'Could not read this item’s history.')
    } finally {
      setLoading(false)
    }
  }, [product?.id])

  useEffect(() => { load() }, [load])

  // Currencies this item has actually traded in, plus its own.
  const currencies = useMemo(() => {
    const set = new Set([product?.currency || 'USD'])
    for (const p of purchases) set.add(p.currency)
    for (const s of sales) set.add(s.currency)
    return [...set]
  }, [purchases, sales, product?.currency])

  useEffect(() => {
    if (currencies.length && !currencies.includes(currency)) setCurrency(currencies[0])
  }, [currencies, currency])

  const buys  = purchases.filter(p => p.currency === currency)
  const sells = sales.filter(s => s.currency === currency)

  /* One point per DAY. Several sales of the same item on one day are averaged
     rather than drawn on top of each other — the question the chart answers is
     "what was it going for that week", not "list every line". */
  const series = useMemo(() => {
    const byDay = new Map()
    const add = (date, key, v) => {
      if (!date) return
      if (!byDay.has(date)) byDay.set(date, { date, _c: [], _s: [] })
      byDay.get(date)[key].push(v)
    }
    for (const b of buys)  add(b.date, '_c', b.price)
    for (const s of sells) add(s.date, '_s', s.price)
    const avg = a => (a.length ? round2(a.reduce((x, y) => x + y, 0) / a.length) : null)
    return [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, cost: avg(d._c), sold: avg(d._s) }))
  }, [buys, sells])

  const hasChart = series.some(p => p.cost != null) || series.some(p => p.sold != null)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-500 gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading this item’s history…
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Currency — never two on one axis. */}
      {currencies.length > 1 && (
        <div className="flex items-center gap-1">
          {currencies.map(c => (
            <button key={c} type="button" onClick={() => setCurrency(c)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                currency === c ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                               : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* ── the line through both ─────────────────────────────── */}
      <div className="card p-3">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-brand-400" />
          <h3 className="text-xs font-semibold text-slate-200">Cost against selling price</h3>
          <span className="text-[11px] text-slate-500 ml-auto">{currency}</span>
        </div>
        {hasChart ? (
          <div style={{ height: 190 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#2b3a52" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickMargin={6} minTickGap={24} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={compact} width={48} />
                <Tooltip content={<ChartTip currency={currency} />} />
                <Legend formatter={v => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>} />
                {/* The standing prices on the form, for comparison against what
                    actually happened. */}
                {Number(product?.unit_cost) > 0 && currency === (product?.currency || 'USD') && (
                  <ReferenceLine y={Number(product.unit_cost)} stroke={COST} strokeDasharray="4 4" strokeOpacity={0.5} />
                )}
                {Number(product?.unit_price) > 0 && currency === (product?.currency || 'USD') && (
                  <ReferenceLine y={Number(product.unit_price)} stroke={SOLD} strokeDasharray="4 4" strokeOpacity={0.5} />
                )}
                <Line type="monotone" dataKey="cost" name="Purchase cost" stroke={COST}
                  strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="sold" name="Sold at" stroke={SOLD}
                  strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-6 text-center">
            Nothing traded in {currency} yet — the line appears once this item has been bought or sold.
          </p>
        )}
        <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">
          Dotted lines are the standing cost and selling price on this form. Several movements on one day are
          averaged, so a point is what the item was going for that day rather than one particular line.
        </p>
      </div>

      {/* ── purchases ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Truck className="w-3.5 h-3.5 text-amber-400" />
          <h3 className="text-xs font-semibold text-slate-200">Purchases</h3>
          <span className="text-[11px] text-slate-500">{buys.length} in {currency}</span>
        </div>
        <div className="card overflow-hidden">
          <div className="max-h-40 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-surface-card border-b border-surface-border text-slate-500">
                  <th className="text-left px-3 py-1.5 font-medium">Date</th>
                  <th className="text-left px-3 py-1.5 font-medium">Invoice</th>
                  <th className="text-left px-3 py-1.5 font-medium">Supplier</th>
                  <th className="text-right px-3 py-1.5 font-medium">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium">Unit cost</th>
                </tr>
              </thead>
              <tbody>
                {buys.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-500">No purchases in {currency}</td></tr>
                ) : buys.map(b => (
                  <tr key={b.id} className="border-b border-surface-border/50">
                    <td className="px-3 py-1.5 text-slate-400">{b.date || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-400 font-mono">{b.ref}</td>
                    <td className="px-3 py-1.5 text-slate-400 truncate max-w-[10rem]">{b.who}</td>
                    <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">{b.qty}</td>
                    <td className="px-3 py-1.5 text-right text-amber-300 tabular-nums">{fmt(b.price, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── sales ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <ShoppingCart className="w-3.5 h-3.5 text-green-400" />
          <h3 className="text-xs font-semibold text-slate-200">Sold</h3>
          <span className="text-[11px] text-slate-500">{sells.length} in {currency}</span>
        </div>
        <div className="card overflow-hidden">
          <div className="max-h-40 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="bg-surface-card border-b border-surface-border text-slate-500">
                  <th className="text-left px-3 py-1.5 font-medium">Date</th>
                  <th className="text-left px-3 py-1.5 font-medium">Order</th>
                  <th className="text-right px-3 py-1.5 font-medium">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium">Sold at</th>
                </tr>
              </thead>
              <tbody>
                {sells.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-5 text-center text-slate-500">No sales in {currency}</td></tr>
                ) : sells.map(s => (
                  <tr key={s.id} className="border-b border-surface-border/50">
                    <td className="px-3 py-1.5 text-slate-400">{s.date || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-400 font-mono">{s.ref}</td>
                    <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">{s.qty}</td>
                    <td className="px-3 py-1.5 text-right text-green-300 tabular-nums">{fmt(s.price, s.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[10px] text-slate-600 mt-1">
          Lines removed from an order are left out — they were never sold.
        </p>
      </div>

    </div>
  )
}
