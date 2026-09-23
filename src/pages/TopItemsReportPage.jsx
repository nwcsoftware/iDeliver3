import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Package, Trophy, Download, FilterX, Boxes, ShoppingCart, Receipt, AlertTriangle, TrendingUp,
} from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { PERIODS, DEFAULT_PERIOD, periodWindow, buildTopItems } from '../lib/topItemsReport'
import DataLoadingOverlay from '../components/ui/DataLoadingOverlay'
import SearchField from '../components/ui/SearchField'
import AdsValueChart from '../components/reports/AdsValueChart'

/* Most Sold Items — what the company's own goods did over a window.
 *
 * Ranked by QUANTITY, because quantity is the only figure that can honestly be
 * added across a shelf: twelve bottles and twelve gas bottles are both twelve.
 * Money sits beside each line in its own currency and is never summed across
 * currencies, for the reason the rest of this application gives — there is no
 * exchange rate here, so a combined total would be a number nobody could check.
 *
 * The summary above the table is built from the SAME rows as the table, in the
 * same pass, so the headline and the list cannot drift apart.
 */

/* The stacked bar's two halves. Brand indigo for what the goods cost, the
   app's emerald for what the sale earned — the same green the Benefit column
   and tile already use, so the colour means one thing everywhere. Slate is
   revenue that cannot be split because no cost was ever recorded. */
const BAR       = '#6366f1'
const BAR_COST  = '#6366f1'
const BAR_GAIN  = '#34d399'
const BAR_UNKNOWN = '#475569'
const TOP_N = 12

const fmtMoney = (v, c) => `${c} ${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })}`

const fmtQty = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const round2q = n => Math.round((Number(n) || 0) * 100) / 100

function compact(n) {
  const v = Number(n) || 0, a = Math.abs(v)
  const cut = (u, s) => `${(v / u).toFixed(a / u >= 10 ? 0 : 1).replace(/\.0$/, '')}${s}`
  if (a >= 1e6) return cut(1e6, 'M')
  if (a >= 1e3) return cut(1e3, 'k')
  return String(Math.round(v))
}

function exportCSV(rows, filename) {
  if (!rows.length) return
  const headers = Object.keys(rows[0]).join(',')
  const body = rows.map(r => Object.values(r)
    .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([headers + '\n' + body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function Stat({ Icon, label, value, sub, tone = 'text-slate-100' }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-slate-500 text-[11px] uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{sub}</p>}
    </div>
  )
}

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-xs text-slate-100">{d.name}</p>
      <p className="text-[11px] text-slate-400 font-mono">{d.code}</p>
      <p className="text-xs text-brand-300 mt-1 tabular-nums">{fmtQty(d.qty)} sold</p>
      {Object.entries(d.revenue || {}).map(([c, v]) => (
        <p key={c} className="text-[11px] text-slate-400 tabular-nums">{fmtMoney(v, c)}</p>
      ))}
      {/* The split the bar is drawing, in the one currency it can draw. */}
      {d.chartCur && (
        <div className="mt-1.5 pt-1.5 border-t border-surface-border/60 space-y-0.5">
          {d.qtyUncosted > 0 ? (
            <p className="text-[11px] text-slate-400">No cost recorded, so the bar cannot be split</p>
          ) : (
            <>
              <p className="text-[11px] text-indigo-300 tabular-nums">Cost {fmtMoney(d.cost, d.chartCur)}</p>
              <p className={`text-[11px] tabular-nums ${d.benefit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                Benefit {fmtMoney(d.benefit, d.chartCur)}
                {d.marginPct != null && ` · ${d.marginPct.toFixed(0)}% of the value`}
              </p>
              {d.benefit < 0 && (
                <p className="text-[10px] text-rose-300/80">Sold below cost — no green on the bar.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function TopItemsReportPage() {
  const { COMPANY_ID } = useApp()

  const [periodKey,  setPeriodKey]  = useState(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [closedOnly, setClosedOnly] = useState(true)
  const [search,     setSearch]     = useState('')

  const [lines,   setLines]   = useState([])
  const [stockIn, setStockIn] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  /* Every order line that names one of our products, with the order it sits on
     and the product it points at. Read once for the page: the windows are all
     narrower than the data, so changing the period is instant rather than
     another trip to the server. */
  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: e } = await fetchAllRows(() => {
      let q = supabase.from('order_items')
        .select('id, product_id, quantity, unit_price, unit_cost, line_total, currency, added_at, is_deleted, '
          + 'order:delivery_orders(id, order_number, status, isclosed, scheduled_date, closed_at, created_at, company_id), '
          + 'product:products(id, code, name, is_service, is_advertisement)')
        .not('product_id', 'is', null)
        .order('id')
      return q
    })
    if (e) { setError(e); setLoading(false); return }
    const rows = COMPANY_ID
      ? (data ?? []).filter(r => !r.order?.company_id || r.order.company_id === COMPANY_ID)
      : (data ?? [])
    setLines(rows)

    /* What came IN, so the table can put bought beside sold. Stock-in
       movements only — 'in' and nothing else. A return to the shelf, an
       adjustment or an opening balance are not purchases, and folding them in
       here would quietly inflate the figure. */
    const { data: mv } = await fetchAllRows(() => {
      let q = supabase.from('product_movements')
        .select('product_id, quantity, moved_at, movement_type')
        .eq('movement_type', 'in')
        .order('id')
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    })
    setStockIn(Array.isArray(mv) ? mv : [])
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { load() }, [load])

  const period = useMemo(
    () => periodWindow(periodKey, { customFrom, customTo }),
    [periodKey, customFrom, customTo])

  const model = useMemo(
    () => buildTopItems(lines, { ...period, closedOnly }),
    [lines, period, closedOnly])

  /* Quantity received per product, over the SAME window the sales use, dated
     by when the stock moved. */
  const purchasedBy = useMemo(() => {
    const t = new Map()
    for (const m of stockIn) {
      const day = String(m.moved_at || '').slice(0, 10)
      if (!day || day < period.from || day > period.to) continue
      t.set(m.product_id, (t.get(m.product_id) || 0) + (Number(m.quantity) || 0))
    }
    return t
  }, [stockIn, period.from, period.to])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const withIn = model.items.map(i => ({ ...i, purchased: purchasedBy.get(i.id) || 0 }))
    if (!q) return withIn
    return withIn.filter(i =>
      i.name.toLowerCase().includes(q) || String(i.code).toLowerCase().includes(q))
  }, [model.items, search, purchasedBy])

  /* THE BAR IS THE SOLD QUANTITY, and the axis counts units — that is what
     the chart is for and what the heading promises.

     The green part is how much of that bar is profit, BY VALUE. Money cannot
     be laid end to end with units on one axis, so the margin is applied to the
     bar instead of added to it: an item selling 530 units at a 70% margin
     shows 371 units' worth of green. The length is still 530 either way, so
     the ranking the axis shows is never distorted; what changes is how much of
     each bar is earnings rather than cost.

     The split is worked out in one currency, the one carrying most of the
     window's revenue, since nothing here is ever summed across currencies. */
  const chartCur = useMemo(() => {
    const t = {}
    for (const i of shown) for (const [c, v] of Object.entries(i.revenue || {})) t[c] = (t[c] || 0) + (Number(v) || 0)
    return Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }, [shown])

  const chartData = shown.slice(0, TOP_N).map(i => {
    const revenue = Number(i.revenue?.[chartCur] || 0)
    const benefit = Number(i.benefit?.[chartCur] || 0)
    const cost    = Number(i.cost?.[chartCur] || 0)
    const qty     = Number(i.qty) || 0
    /* An item with no cost recorded keeps its full bar — it really sold — but
       as one neutral block. Drawing it as all profit would be a lie; leaving
       it out would be a different one.

       A loss (benefit below zero) shows no green at all and says so in the
       tooltip: a negative length stacked on a positive one draws a bar that
       reads as neither. */
    const splittable = i.anyCosted && revenue > 0 && benefit > 0
    const gainShare  = splittable ? Math.min(1, benefit / revenue) : 0
    return {
      ...i,
      label: i.name.slice(0, 18),
      chartCur, cost, benefit, revenue,
      // The three pieces add up to the sold quantity, always.
      qtyCost:     i.anyCosted ? round2q(qty * (1 - gainShare)) : 0,
      qtyBenefit:  round2q(qty * gainShare),
      qtyUncosted: i.anyCosted ? 0 : qty,
      marginPct:   revenue > 0 ? (benefit / revenue) * 100 : null,
    }
  })
  const anyFilter = periodKey !== DEFAULT_PERIOD || !closedOnly || !!search.trim()

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      <DataLoadingOverlay
        open={loading}
        title="Building the most-sold report"
        subtitle="Reading every order line that names one of your products…"
        steps={[{ label: 'Loading order lines', done: !loading }, { label: 'Ranking by quantity', done: false }]}
      />

      {/* ── heading + period ─────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100">Most Sold Items</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {period.from} to {period.to} · {closedOnly ? 'closed orders only' : 'every live order'}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {anyFilter && (
              <button onClick={() => { setPeriodKey(DEFAULT_PERIOD); setClosedOnly(true); setSearch(''); setCustomFrom(''); setCustomTo('') }}
                className="btn-ghost text-xs text-slate-400 hover:text-slate-100">
                <FilterX className="w-3.5 h-3.5" /> Clear
              </button>
            )}
            <button
              onClick={() => exportCSV(
                model.items.map((i, n) => ({
                  rank: n + 1, code: i.code, item: i.name,
                  // Same two columns the table shows, in the same order.
                  purchased: purchasedBy.get(i.id) || 0,
                  sold: i.qty,
                  orders: i.orders,
                  share: `${(i.share * 100).toFixed(1)}%`,
                  ...Object.fromEntries(Object.entries(i.revenue).map(([c, v]) => [`revenue ${c}`, v])),
                  ...Object.fromEntries(Object.entries(i.benefit).map(([c, v]) => [`benefit ${c}`, v])),
                  'units not costed': i.uncostedQty,
                  first_sold: i.firstDay, last_sold: i.lastDay,
                })),
                `most-sold-${period.from}_${period.to}.csv`)}
              disabled={!model.items.length}
              className="btn-ghost text-xs text-slate-300 hover:text-slate-100 disabled:opacity-40">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriodKey(p.key)} title={p.note}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                periodKey === p.key ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                                    : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
              {p.label}
            </button>
          ))}

          {periodKey === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" className="input py-1 text-xs w-auto" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)} />
              <span className="text-slate-600 text-xs">to</span>
              <input type="date" className="input py-1 text-xs w-auto" value={customTo}
                onChange={e => setCustomTo(e.target.value)} />
            </div>
          )}

          {/* Which orders count. Closed is the same line the stock ledger and the
              money reports draw; the wider view answers "what is going out", not
              "what was sold". */}
          <label className="flex items-center gap-2 cursor-pointer select-none ml-2">
            <input type="checkbox" className="accent-brand-500" checked={closedOnly}
              onChange={e => setClosedOnly(e.target.checked)} />
            <span className="text-xs text-slate-400">Closed orders only</span>
          </label>

          <div className="ml-auto w-full sm:w-56">
            <SearchField value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an item…" />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* ── the summary, over the same window ─────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat Icon={Boxes} label="Units sold" value={fmtQty(model.summary.units)}
          sub={`across ${model.summary.distinctItems} item${model.summary.distinctItems === 1 ? '' : 's'}`} />
        <Stat Icon={ShoppingCart} label="Orders" value={model.summary.orders.toLocaleString()}
          sub="orders carrying at least one item" />
        <Stat Icon={Receipt} label="Revenue"
          value={model.summary.currencies.length
            ? fmtMoney(model.summary.revenue[model.summary.currencies[0]], model.summary.currencies[0])
            : '—'}
          sub={model.summary.currencies.slice(1)
            .map(c => fmtMoney(model.summary.revenue[c], c)).join(' · ') || 'never summed across currencies'} />
        {/* Benefit says plainly how much of the window it covers. A margin
            worked out over a third of the units is a different claim from one
            worked out over all of them, and the tile should not hide which. */}
        <Stat Icon={TrendingUp} label="Benefit"
          tone={model.summary.benefitCurrencies.length && model.summary.benefit[model.summary.benefitCurrencies[0]] < 0
            ? 'text-rose-300' : 'text-emerald-300'}
          value={model.summary.benefitCurrencies.length
            ? fmtMoney(model.summary.benefit[model.summary.benefitCurrencies[0]], model.summary.benefitCurrencies[0])
            : '—'}
          sub={model.summary.costedUnits === 0
            ? 'no cost recorded on any item sold'
            : [
                model.summary.benefitCurrencies.slice(1)
                  .map(c => fmtMoney(model.summary.benefit[c], c)).join(' · '),
                model.summary.uncostedUnits > 0
                  ? `on ${(model.summary.costedShare * 100).toFixed(0)}% of units — ${fmtQty(model.summary.uncostedUnits)} have no cost`
                  : 'on every unit sold',
              ].filter(Boolean).join(' · ')} />
        <Stat Icon={Trophy} label="Top item"
          value={model.summary.top ? fmtQty(model.summary.top.qty) : '—'}
          tone="text-brand-300"
          sub={model.summary.top
            ? `${model.summary.top.name} — ${(model.summary.top.share * 100).toFixed(1)}% of everything sold`
            : 'nothing sold in this window'} />
      </div>

      {model.summary.skippedNoProduct > 0 && (
        <p className="text-[11px] text-slate-500">
          {model.summary.skippedNoProduct} sold line{model.summary.skippedNoProduct === 1 ? '' : 's'} carried no
          catalogue item (a free-text parcel or an external request) and cannot be ranked — they are left out of
          the figures above.
        </p>
      )}

      {/* ── the ranking ──────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-200">Top {Math.min(TOP_N, chartData.length)} by quantity</h2>
        <p className="text-xs text-slate-500 mt-0.5 mb-2">
          Ranked by units, because units are the only figure that adds up honestly across different goods.
          Each bar is the quantity sold; the green part is how much of it is profit, by value{chartCur ? ` (${chartCur})` : ''}.
        </p>
        {chartCur && (
          <div className="flex items-center gap-4 mb-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR_COST }} /> Cost
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR_GAIN }} /> Benefit
            </span>
            {chartData.some(d => d.qtyUncosted > 0) && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR_UNKNOWN }} /> No cost recorded
              </span>
            )}
          </div>
        )}
        {chartData.length ? (
          <div style={{ height: Math.max(180, chartData.length * 28) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#2b3a52" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={compact} />
                <YAxis type="category" dataKey="label" width={130}
                  tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                {/* Stacked: cost, then benefit on top of it, so the whole bar
                    is the revenue and the green part is what was made on it. */}
                {/* The three add up to the sold quantity, so the bar's length
                    is the figure the axis counts and the heading names. */}
                <Bar dataKey="qtyCost"     stackId="qty" fill={BAR_COST}    radius={[0, 0, 0, 0]} />
                <Bar dataKey="qtyBenefit"  stackId="qty" fill={BAR_GAIN}    radius={[0, 3, 3, 0]} />
                <Bar dataKey="qtyUncosted" stackId="qty" fill={BAR_UNKNOWN} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-8 text-center">
            Nothing sold in this window{closedOnly ? ' on a closed order' : ''}.
          </p>
        )}
      </div>

      {/* ── every item ───────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-surface-border flex items-center gap-2">
          <Package className="w-3.5 h-3.5 text-slate-500" />
          <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Every item sold</h2>
          <span className="text-[11px] text-slate-500 ml-auto">
            {shown.length === model.items.length ? `${shown.length}` : `${shown.length} of ${model.items.length}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-slate-500 text-xs">
                <th className="text-left px-4 py-2 font-medium w-12">#</th>
                <th className="text-left px-4 py-2 font-medium">Code</th>
                <th className="text-left px-4 py-2 font-medium">Item</th>
                <th className="text-right px-4 py-2 font-medium" title="Quantity received into stock in this window — stock-in movements only. Returns, adjustments and opening balances are not counted.">Purchased</th>
                <th className="text-right px-4 py-2 font-medium" title="Quantity sold in this window, from the order lines.">Sold</th>
                <th className="text-right px-4 py-2 font-medium">Share</th>
                <th className="text-right px-4 py-2 font-medium">Orders</th>
                <th className="text-right px-4 py-2 font-medium">Revenue</th>
                <th className="text-right px-4 py-2 font-medium" title="What the sale earned: revenue less what the goods cost us, using the cost recorded on each line at the time it was sold.">Benefit</th>
                <th className="text-left px-4 py-2 font-medium">Last sold</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500 text-xs">
                  Nothing to show for this window.
                </td></tr>
              ) : shown.map((i, n) => (
                <tr key={i.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40">
                  <td className="px-4 py-2 text-slate-500 tabular-nums">{n + 1}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-400">{i.code}</td>
                  <td className="px-4 py-2 text-slate-100">{i.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {i.purchased > 0
                      ? <span className="text-sky-300">{fmtQty(i.purchased)}</span>
                      : <span className="text-slate-600" title="Nothing was booked into stock for this item in this window.">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-brand-300 tabular-nums font-medium">{fmtQty(i.qty)}</td>
                  <td className="px-4 py-2 text-right text-slate-400 tabular-nums">{(i.share * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2 text-right text-slate-400 tabular-nums">{i.orders}</td>
                  <td className="px-4 py-2 text-right text-slate-300 tabular-nums whitespace-nowrap">
                    {Object.entries(i.revenue).map(([c, v]) => (
                      <div key={c}>{fmtMoney(v, c)}</div>
                    ))}
                  </td>
                  {/* Blank, not zero, when nothing was costed: a product with
                      no cost entered would otherwise read as pure profit. */}
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                    {!i.anyCosted ? (
                      <span className="text-slate-600 text-xs" title="No cost is recorded for this product, so its benefit cannot be worked out. Enter a cost on the product and future sales will carry it.">—</span>
                    ) : (
                      <>
                        {Object.entries(i.benefit).map(([c, v]) => (
                          <div key={c} className={v >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{fmtMoney(v, c)}</div>
                        ))}
                        {!i.fullyCosted && (
                          <div className="text-[10px] text-amber-400/80"
                            title={`${fmtQty(i.uncostedQty)} of ${fmtQty(i.qty)} units have no cost recorded and are left out of this figure.`}>
                            part costed
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{i.lastDay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── advertising, over the same window ─────────────────── */}
      {/* Dated by the day each advert STARTS, which is why it sits apart from
          the goods above rather than as another row in them: an advert is sold
          time, and the day it counts under is the day it runs. */}
      <AdsValueChart
        from={period.from}
        to={period.to}
        closedOnly={closedOnly}
        companyId={COMPANY_ID}
      />

    </div>
  )
}
