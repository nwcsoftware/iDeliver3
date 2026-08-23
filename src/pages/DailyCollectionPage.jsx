import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Banknote, Search, FilterX, AlertCircle, Calendar, X, Shield, AlertTriangle } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { orderTotalsByCurrency, orderCollectedByCurrency } from '../lib/orderAmounts'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useTableSort, SortTh } from '../components/ui/SortableTable'
import { OrderNumber, useOrderQuickView } from '../components/orders/OrderQuickView'

/* Daily Collection — every recorded payment (payment_collections) with the order
   it belongs to. Shows the delivery date, order number, amount, driver, source,
   who collected it and the collection group (Driver / Call center). Free-text
   search matches any column, including the amount. Super-admin only. Clicking an
   order number opens a popup with the full order data. */

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100


function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}
function fmtCurMap(map) {
  const parts = CURRENCIES.filter(c => round2(map[c]) !== 0).map(c => fmtMoney(map[c], c))
  return parts.length ? parts.join(' · ') : '—'
}
function personName(c) {
  if (!c) return '—'
  return (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'
}
function driverName(d) {
  if (!d) return '—'
  return `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || '—'
}

/* Fetch the orders behind a set of collections, keyed by id — PostgREST can't
   reliably embed payment_collections → delivery_orders, so we resolve them here
   in parallel chunks. */
async function fetchOrders(ids) {
  const map = new Map()
  const clean = [...new Set(ids.filter(Boolean))]
  const CHUNK = 200
  const slices = []
  for (let i = 0; i < clean.length; i += CHUNK) slices.push(clean.slice(i, i + CHUNK))
  // Amount fields are included so we can compare the order total (packages &
  // external retail only when their paid flag is false — orderTotalsByCurrency
  // handles that) against everything collected on the order.
  const results = await Promise.all(slices.map(slice =>
    supabase.from('delivery_orders')
      .select(`
        id, order_number, order_source, closed_at, scheduled_date,
        currency, delivery_fee, discount_amount, discount_currency, vat_amount, is_free_order,
        driver:contacts!driver_id(first_name, last_name),
        order_items(line_total, currency, is_deleted),
        delivery_packages(package_price, paid, currency),
        order_services(service_fees, service_fees_currency),
        retail_goods_invoices(invoice_value, exclude_calculation, currency),
        payment_collections(amount, currency)
      `)
      .in('id', slice)))
  for (const { data } of results) for (const o of data ?? []) map.set(o.id, o)
  return map
}

/* An order needs attention when what was collected doesn't match the order total
   (in any currency). Total counts packages / external retail only when paid=false. */
function orderMismatch(o) {
  if (!o) return false
  const total     = orderTotalsByCurrency(o)
  const collected = orderCollectedByCurrency(o)
  const curs = new Set([...Object.keys(total), ...Object.keys(collected)])
  for (const c of curs) if (round2(total[c] || 0) !== round2(collected[c] || 0)) return true
  return false
}

/* What the warning actually says, in words and figures.

   "Payment ≠ order total" tells the reader there is a problem but not what to
   do about it. This names the gap per currency and which way it runs, because
   money still to collect and money collected twice are two different jobs. */
function mismatchNote(o) {
  if (!o) return ''
  const total     = orderTotalsByCurrency(o)
  const collected = orderCollectedByCurrency(o)
  const curs = [...new Set([...Object.keys(total), ...Object.keys(collected)])].sort()
  const lines = []
  for (const c of curs) {
    const t = round2(total[c] || 0)
    const p = round2(collected[c] || 0)
    if (t === p) continue
    const gap = round2(Math.abs(t - p))
    lines.push(`${c}: order ${fmtMoney(t, c)}, collected ${fmtMoney(p, c)} — `
      + (p < t ? `${fmtMoney(gap, c)} still to collect` : `${fmtMoney(gap, c)} collected over the total`))
  }
  if (lines.length === 0) return ''
  return 'What was collected does not match this order’s total.\n' + lines.join('\n')
    + '\n\nOpen the order number to see every line and payment on it.'
}

export default function DailyCollectionPage() {
  const { COMPANY_ID, loadFullOrderHistory } = useApp()
  // The startup fetch only covers the last few days; this page reads
  // further back, so it asks for the full history once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])
  const { hasRole } = useAuth()
  const isSuperAdmin = hasRole('super_admin')

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [search,   setSearch]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')


  const fetchCollections = useCallback(async () => {
    if (!isSuperAdmin) { setLoading(false); return }
    setLoading(true); setError('')
    const { data: pcs, error: err } = await fetchAllRows(() =>
      supabase.from('payment_collections')
        .select('id, order_id, amount, currency, collected_at, collected_by_name, collection_group, collection_type')
        .order('collected_at', { ascending: false }))
    if (err) { setError(err.message); setRows([]); setLoading(false); return }

    let orderMap
    try { orderMap = await fetchOrders((pcs ?? []).map(p => p.order_id)) }
    catch (e) { setError(e.message); setRows([]); setLoading(false); return }

    const joined = (pcs ?? []).map(p => {
      const o = orderMap.get(p.order_id) || null
      const deliveryDate = (o?.closed_at || o?.scheduled_date || p.collected_at || '').slice(0, 10)
      const mismatch = orderMismatch(o)
      const mismatchWhy = mismatch ? mismatchNote(o) : ''
      return {
        id: p.id,
        orderId:      p.order_id,
        deliveryDate,
        orderNumber:  o?.order_number ?? '—',
        amount:       round2(p.amount),
        currency:     p.currency || 'USD',
        driver:       driverName(o?.driver),
        source:       o?.order_source ?? '—',
        collectedBy:  p.collected_by_name || '—',
        group:        p.collection_group || '—',
        mismatch,
        mismatchWhy,
        orderTotal:     o ? fmtCurMap(orderTotalsByCurrency(o))   : '—',
        orderCollected: o ? fmtCurMap(orderCollectedByCurrency(o)): '—',
      }
    })
    setRows(joined); setLoading(false)
  }, [isSuperAdmin])

  useEffect(() => { fetchCollections() }, [fetchCollections])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (dateFrom && (!r.deliveryDate || r.deliveryDate < dateFrom)) return false
      if (dateTo   && (!r.deliveryDate || r.deliveryDate > dateTo))   return false
      if (!q) return true
      const hay = [
        r.deliveryDate, r.orderNumber, r.amount, fmtMoney(r.amount, r.currency),
        r.driver, r.source, r.collectedBy, r.group,
      ].map(v => String(v ?? '').toLowerCase()).join(' ')
      return hay.includes(q)
    })
  }, [rows, search, dateFrom, dateTo])

  // Per-currency total of the filtered collections.
  const totals = useMemo(() => {
    const t = {}
    for (const r of filtered) t[r.currency] = round2((t[r.currency] || 0) + r.amount)
    return t
  }, [filtered])
  const totalCurs = CURRENCIES.filter(c => totals[c])

  const hasFilters = search || dateFrom || dateTo
  function clearFilters() { setSearch(''); setDateFrom(''); setDateTo('') }

  /* ── access gate ─────────────────────────────────────────── */
  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Super administrators only</p>
        <p className="text-slate-500 text-sm">You don’t have permission to view the daily collection.</p>
      </div>
    )
  }

  /* What each column sorts BY — not always what it prints. The amount sorts by
     the figure rather than "USD 12.50", and the date by the day itself, so the
     order is the one a person means rather than the one the alphabet gives. */
  const sortValue = useCallback((r, key) => {
    switch (key) {
      case 'date':    return r.deliveryDate || ''
      case 'order':   return r.orderNumber === '—' ? '' : (r.orderNumber || '')
      case 'amount':  return Number(r.amount) || 0
      case 'driver':  return (r.driver || '').toLowerCase()
      case 'source':  return (r.source || '').toLowerCase()
      case 'by':      return (r.collectedBy || '').toLowerCase()
      case 'group':   return (r.group || '').toLowerCase()
      // The flag is called `mismatch` on the row: a collection that does not
      // agree with the order's own total.
      case 'warning': return r.mismatch ? 1 : 0
      default:        return ''
    }
  }, [])
  const { open: openQuickView } = useOrderQuickView()
  const { sort, cycle, sortRows } = useTableSort(sortValue)
  const visible = sortRows(filtered)

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-green-600/20 border-green-600/30">
          <Banknote className="w-4 h-4 text-green-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-slate-100 leading-none">Daily Collection</h1>
          <p className="text-xs text-slate-500 mt-0.5">{filtered.length} collection{filtered.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{error}</span>
        </div>
      )}

      {/* ── filters ────────────────────────────────────────── */}
      <div className="card p-3 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Search</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input className="input py-1.5 text-xs pl-8" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Amount, order #, driver, source, collector, group…" />
          </div>
        </div>
        <div>
          <label className="label">Date from</label>
          <input type="date" className="input py-1.5 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Date to</label>
          <input type="date" className="input py-1.5 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {hasFilters && (
          <button type="button" onClick={clearFilters}
            className="h-[34px] px-3 rounded-lg text-xs font-medium border border-surface-border text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5">
            <FilterX className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── totals ─────────────────────────────────────────── */}
      {totalCurs.length > 0 && (
        <div className="card p-4 flex items-center gap-6 flex-wrap">
          <span className="text-sm font-semibold text-slate-200">Total collected</span>
          {totalCurs.map(c => (
            <span key={c} className="tabular-nums text-base font-semibold text-green-300">{fmtMoney(totals[c], c)}</span>
          ))}
          <span className="text-xs text-slate-500 ml-auto">{filtered.length} collection{filtered.length === 1 ? '' : 's'}</span>
        </div>
      )}

      {/* ── table ──────────────────────────────────────────── */}
      {/* The table scrolls inside the card so its header can stay put: on a
          day with hundreds of collections the column you are reading is
          otherwise off the top of the screen by the time you reach the rows. */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface-card">
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <SortTh label="Delivery date"    sortKey="date"    sort={sort} onSort={cycle} />
              <SortTh label="Order #"          sortKey="order"   sort={sort} onSort={cycle} />
              <SortTh label="Collected amount" sortKey="amount"  sort={sort} onSort={cycle} align="right" />
              <SortTh label="Driver"           sortKey="driver"  sort={sort} onSort={cycle} />
              <SortTh label="Order Source"     sortKey="source"  sort={sort} onSort={cycle} />
              <SortTh label="Collected by"     sortKey="by"      sort={sort} onSort={cycle} />
              <SortTh label="Collection group" sortKey="group"   sort={sort} onSort={cycle} />
              <SortTh label="Warning"          sortKey="warning" sort={sort} onSort={cycle} align="center" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-600">No collections match these filters.</td></tr>
            ) : visible.map(r => (
              <tr key={r.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30">
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                  {r.deliveryDate ? <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3 text-slate-600" />{r.deliveryDate}</span> : '—'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.orderNumber === '—'
                    ? <span className="text-slate-600">—</span>
                    : <OrderNumber value={r.orderNumber} id={r.orderId} className="text-xs" />}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-green-300 whitespace-nowrap">{fmtMoney(r.amount, r.currency)}</td>
                <td className="px-3 py-2 text-slate-300">{r.driver}</td>
                <td className="px-3 py-2 text-slate-400">{r.source}</td>
                <td className="px-3 py-2 text-slate-300">{r.collectedBy}</td>
                <td className="px-3 py-2">
                  {r.group === '—' ? <span className="text-slate-600">—</span> : (
                    <span className={`text-[11px] font-medium border rounded px-2 py-0.5 whitespace-nowrap ${
                      /driver/i.test(r.group) ? 'bg-green-500/10 text-green-300 border-green-500/30'
                                              : 'bg-sky-500/10 text-sky-300 border-sky-500/30'}`}>
                      {r.group}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.mismatch ? (
                    /* Hovering explains the gap; clicking opens the order it is
                       about — the same quick view the order number opens, since
                       "what is wrong here?" is answered by the order itself.

                       The tooltip sits on the BUTTON, not on the icon: `title`
                       on an <svg> is not a tooltip — SVG needs a <title> child
                       — so hovering the icon alone said nothing at all. */
                    <button type="button"
                      onClick={() => r.orderId && openQuickView(r.orderId)}
                      disabled={!r.orderId}
                      title={`${r.mismatchWhy || 'What was collected does not match this order’s total.'}`
                        + (r.orderId ? `

Click to open the order.` : '')}
                      className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 disabled:cursor-help disabled:hover:text-red-400">
                      <AlertTriangle className="w-4 h-4 animate-pulse" />
                      <span className="text-[10px] font-medium uppercase tracking-wide underline decoration-dotted underline-offset-2">check</span>
                    </button>
                  ) : (
                    <span className="text-slate-700">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {totalCurs.length > 0 && (
            <tfoot>
              <tr className="border-t border-surface-border bg-surface-hover/30">
                <td colSpan={2} className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total</td>
                <td className="px-3 py-2 text-right">
                  {totalCurs.map(c => (
                    <div key={c} className="tabular-nums font-semibold text-green-300 whitespace-nowrap">{fmtMoney(totals[c], c)}</div>
                  ))}
                </td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>

    </div>
  )
}
