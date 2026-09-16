import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Loader2, BarChart3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/* How much of this item goes out, month by month.
 *
 * The movement table beside this answers "what happened"; this answers "how
 * much, and is it rising or falling" — the question stock levels are actually
 * set from. Quantity is the subject, because that is what a reorder level is
 * measured in; the money is on the tooltip for context rather than as a second
 * axis fighting for the same space.
 *
 * Value is summed PER CURRENCY and never across them — there is no rate in this
 * application — so the tooltip lists each currency separately rather than
 * inventing a total.
 */

const MONTHS_BACK = 12
const BAR = '#6366f1'

const money = (v, c) => `${c} ${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })}`

function compact(n) {
  const v = Number(n) || 0, a = Math.abs(v)
  const cut = (u, s) => `${(v / u).toFixed(a / u >= 10 ? 0 : 1).replace(/\.0$/, '')}${s}`
  if (a >= 1e6) return cut(1e6, 'M')
  if (a >= 1e3) return cut(1e3, 'k')
  return String(Math.round(v))
}

/* The last twelve months as YYYY-MM, oldest first, including the ones with no
   sales at all — a gap is information, and a chart that silently skips empty
   months makes a quiet spell look like a busy one. */
function monthKeys(back = MONTHS_BACK) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = back - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-xs text-slate-100 mt-0.5 tabular-nums">{d.qty} sold</p>
      {Object.entries(d.value || {}).map(([cur, v]) => (
        <p key={cur} className="text-[11px] text-slate-400 tabular-nums">{money(v, cur)}</p>
      ))}
      {d.orders > 0 && <p className="text-[10px] text-slate-500 mt-0.5">{d.orders} order line{d.orders === 1 ? '' : 's'}</p>}
    </div>
  )
}

export default function ProductMonthlySales({ product }) {
  const [loading, setLoading] = useState(true)
  const [rows,    setRows]    = useState([])
  const [error,   setError]   = useState('')

  const load = useCallback(async () => {
    if (!product?.id) return
    setLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('order_items')
      .select('quantity, unit_price, line_total, currency, added_at, is_deleted, order:delivery_orders(scheduled_date, status)')
      .eq('product_id', product.id)
      .limit(2000)
    if (e) { setError(e.message); setLoading(false); return }
    setRows((data ?? []).filter(r => !r.is_deleted))
    setLoading(false)
  }, [product?.id])

  useEffect(() => { load() }, [load])

  const series = useMemo(() => {
    const months = monthKeys()
    const bag = new Map(months.map(m => [m, { month: m, qty: 0, orders: 0, value: {} }]))
    for (const r of rows) {
      // Dated by the delivery it belonged to, falling back to when the line was
      // added — the sale happened when the goods moved, not when it was typed.
      const d = String(r.order?.scheduled_date || r.added_at || '').slice(0, 7)
      const slot = bag.get(d)
      if (!slot) continue                      // older than the window
      const cur = r.currency || 'USD'
      slot.qty    += Number(r.quantity) || 0
      slot.orders += 1
      slot.value[cur] = (slot.value[cur] || 0) + (Number(r.line_total) || 0)
    }
    return [...bag.values()].map(s => ({ ...s, label: s.month.slice(2) }))
  }, [rows])

  const total = series.reduce((n, s) => n + s.qty, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-500 gap-2 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading monthly sales…
      </div>
    )
  }

  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="w-4 h-4 text-brand-400" />
        <h3 className="text-xs font-semibold text-slate-200">Monthly sales</h3>
        <span className="text-[11px] text-slate-500 ml-auto">
          {total > 0 ? `${total} sold in the last ${MONTHS_BACK} months` : `nothing sold in ${MONTHS_BACK} months`}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-red-300 py-4 text-center">{error}</p>
      ) : (
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#2b3a52" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} tickMargin={6} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={compact} width={40} allowDecimals={false} />
              <Tooltip content={<Tip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
              <Legend formatter={() => <span style={{ color: '#94a3b8', fontSize: 11 }}>Quantity sold</span>} />
              <Bar dataKey="qty" name="Quantity sold" fill={BAR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">
        Dated by the delivery, not by when the line was typed. Empty months are shown as empty rather than
        skipped. Lines removed from an order are left out. Hover a bar for the value, per currency.
      </p>
    </div>
  )
}
