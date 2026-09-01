import React, { useEffect, useMemo, useState } from 'react'
import { Ban, FilterX, RotateCcw, AlertCircle, CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { OrderNumber } from '../components/orders/OrderQuickView'
import SearchField from '../components/ui/SearchField'
import { useTableSort, SortTh } from '../components/ui/SortableTable'

/* Cancelled Orders — the one page in the app that is about cancelled orders.

   Everywhere else they are gone: no statement, no settlement, no report, no
   total (see lib/orderStatus.js). That is the point of them, and it is also why
   they need somewhere to live. An order that simply vanished is a customer
   asking "what happened to my delivery?" with nothing to answer from, so this
   page keeps the record — what the order was, who called it off, when, and why
   — and is the place an order that was cancelled in error is brought back.

   Deliberately no money. A cancelled order earns nothing and is owed nothing,
   and a column of "what it would have been worth" is exactly the figure someone
   would eventually add up. What it was FOR is answered by the order number,
   which opens the usual quick view. */

/* Cancellation, else scheduled, else creation — the date a person means when
   they ask when an order was cancelled. */
function cancelDate(o) {
  const raw = o?.cancellation_requested_at || o?.scheduled_date || o?.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

function fmtWhen(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return String(ts).slice(0, 10)
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`
}

function customerLabel(c) {
  if (!c) return '—'
  return (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'
}

function driverLabel(d) {
  if (!d) return '—'
  return `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || '—'
}

/* Where the cancellation came from. The customer app writes its own reason text
   (see lib/orderCancel.js); anything else was the office. */
function cancelledBySource(o) {
  return /cancelled by the customer/i.test(String(o?.cancellation_reason || ''))
    ? 'Customer app'
    : 'Office'
}

const EMPTY_FILTERS = { from: '', to: '', source: 'all' }

export default function CancelledOrdersPage() {
  const { cancelledOrders, loading, loadFullOrderHistory, refreshOrder } = useApp()
  const { hasRole } = useAuth()
  // Cancellations go back as far as the books do, so this page needs the whole
  // history rather than the recent window the app starts with.
  useEffect(() => { loadFullOrderHistory() }, [loadFullOrderHistory])

  // Bringing an order back is an admin's call — the same people who may cancel
  // one from the Deliveries list.
  const canReactivate = hasRole('super_admin', 'admin')

  const [search, setSearch]   = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [busyId, setBusyId]   = useState(null)
  const [error, setError]     = useState('')
  const [confirming, setConfirming] = useState(null)   // the order awaiting confirmation

  /* Who cancelled it. Orders store a user id; the names live in user_accounts —
     a dozen rows — so they are fetched once and mapped rather than joined onto
     every order. */
  const [userNames, setUserNames] = useState(() => new Map())
  useEffect(() => {
    let gone = false
    ;(async () => {
      const { data } = await supabase.from('user_accounts').select('id, username')
      if (!gone) setUserNames(new Map((data ?? []).map(u => [u.id, u.username])))
    })()
    return () => { gone = true }
  }, [])

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setSearch('') }
  const hasFilters = search.trim() !== '' || filters.from || filters.to || filters.source !== 'all'

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cancelledOrders.filter(o => {
      const date = cancelDate(o)
      if (filters.from && date < filters.from) return false
      if (filters.to   && date > filters.to)   return false
      if (filters.source !== 'all' && cancelledBySource(o) !== filters.source) return false
      if (!q) return true
      return [
        o.order_number, o.recipient_name, o.delivery_address,
        customerLabel(o.customer), o.cancellation_reason,
      ].some(v => String(v ?? '').toLowerCase().includes(q))
    })
  }, [cancelledOrders, search, filters])

  const sortValue = (o, key) => {
    switch (key) {
      case 'order':    return o.order_number || ''
      case 'date':     return cancelDate(o)
      case 'customer': return customerLabel(o.customer)
      case 'driver':   return driverLabel(o.driver)
      case 'source':   return cancelledBySource(o)
      case 'by':       return userNames.get(o.cancellation_requested_by) || ''
      case 'reason':   return o.cancellation_reason || ''
      default:         return ''
    }
  }
  const { sort, cycle, sortRows } = useTableSort(sortValue)
  // Newest cancellation first until a column is picked — the order someone
  // opening this page is looking for.
  const sorted = useMemo(() => {
    if (sort.key && sort.dir) return sortRows(rows)
    return [...rows].sort((a, b) => (cancelDate(b) || '').localeCompare(cancelDate(a) || ''))
  }, [rows, sort, sortRows])

  /* Bring an order back. It returns as 'pending' — the same state the Deliveries
     list reactivates into — and has to be re-confirmed and re-worked from there.

     What a cancel deleted (packages, services, invoices, payments) is NOT
     restored: those rows are gone, and inventing replacements would be worse
     than an empty order someone fills in again. The confirmation says so. */
  async function reactivate(o) {
    setBusyId(o.id); setError('')
    const { error: e } = await supabase
      .from('delivery_orders')
      .update({ status: 'pending' })
      .eq('id', o.id)
    setBusyId(null)
    setConfirming(null)
    if (e) { setError(`Could not reactivate ${o.order_number || 'the order'}: ${e.message}`); return }
    await refreshOrder(o.id)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-slate-500/20 border border-slate-500/30 flex items-center justify-center">
          <Ban className="w-5 h-5 text-slate-400" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-slate-100">Cancelled Orders</h1>
          <p className="text-xs text-slate-500">
            Orders that were called off. They count towards nothing — no statement, settlement, report or total
            includes them — and this is the only page that lists them.
          </p>
        </div>
        <span className="text-xs text-slate-500 ml-auto">
          {sorted.length} order{sorted.length === 1 ? '' : 's'}
          {sorted.length !== cancelledOrders.length && ` of ${cancelledOrders.length}`}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {/* ── filters ────────────────────────────────────────── */}
      <div className="card p-3 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Search</label>
          <div className="relative">
            <SearchField value={search} onChange={e => setSearch(e.target.value)}
              className="input py-1.5 text-xs pl-9"
              placeholder="Order number, customer, address or reason" />
          </div>
        </div>
        <div>
          <label className="label">Cancelled from</label>
          <input type="date" className="input py-1.5 text-xs" value={filters.from}
            onChange={e => setFilter('from', e.target.value)} />
        </div>
        <div>
          <label className="label">Cancelled to</label>
          <input type="date" className="input py-1.5 text-xs" value={filters.to}
            onChange={e => setFilter('to', e.target.value)} />
        </div>
        <div>
          <label className="label">Cancelled by</label>
          <select className="input py-1.5 text-xs" value={filters.source}
            onChange={e => setFilter('source', e.target.value)}>
            <option value="all">Anyone</option>
            <option value="Office">Office</option>
            <option value="Customer app">Customer app</option>
          </select>
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="btn-ghost text-xs flex items-center gap-1.5 py-1.5">
            <FilterX className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── list ───────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/30">
              <SortTh label="Order"     sortKey="order"    sort={sort} onSort={cycle} />
              <SortTh label="Cancelled" sortKey="date"     sort={sort} onSort={cycle} />
              <SortTh label="Customer"  sortKey="customer" sort={sort} onSort={cycle} />
              <SortTh label="Driver"    sortKey="driver"   sort={sort} onSort={cycle} />
              <SortTh label="Source"    sortKey="source"   sort={sort} onSort={cycle} />
              <SortTh label="By"        sortKey="by"       sort={sort} onSort={cycle} />
              <SortTh label="Reason"    sortKey="reason"   sort={sort} onSort={cycle} />
              {canReactivate && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {loading?.orders ? (
              <tr><td colSpan={canReactivate ? 8 : 7} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={canReactivate ? 8 : 7} className="px-3 py-6 text-center text-slate-600">
                {hasFilters ? 'No cancelled order matches these filters.' : 'Nothing has been cancelled.'}
              </td></tr>
            ) : sorted.map(o => (
              <tr key={o.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30 align-top">
                <td className="px-3 py-2">
                  <OrderNumber value={o.order_number} id={o.id} className="text-slate-200" />
                  {o.recipient_name && <div className="text-[10px] text-slate-500">{o.recipient_name}</div>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="w-3 h-3 text-slate-600" />
                    {fmtWhen(o.cancellation_requested_at)}
                  </span>
                  {o.scheduled_date && (
                    <div className="text-[10px] text-slate-500">was for {String(o.scheduled_date).slice(0, 10)}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-300">{customerLabel(o.customer)}</td>
                <td className="px-3 py-2 text-slate-400">{driverLabel(o.driver)}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
                    cancelledBySource(o) === 'Customer app'
                      ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                      : 'bg-slate-500/15 text-slate-400 border-slate-500/30'}`}>
                    {cancelledBySource(o)}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {userNames.get(o.cancellation_requested_by) || '—'}
                </td>
                <td className="px-3 py-2 text-slate-400 max-w-[22rem]">
                  {o.cancellation_reason || <span className="text-slate-600">No reason given</span>}
                </td>
                {canReactivate && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setConfirming(o)} disabled={busyId === o.id}
                      title="Bring this order back as pending"
                      className="btn-ghost p-1.5 text-emerald-400 disabled:opacity-40">
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── reactivate confirmation ────────────────────────── */}
      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setConfirming(null)}>
          <div className="card w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Reactivate {confirming.order_number || 'this order'}?
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              It comes back as <span className="text-slate-200">pending</span> and has to be confirmed again before
              anyone works it. It starts counting again from that moment — statements, settlements and reports will
              include it.
            </p>
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              Cancelling deleted the order's packages, services, invoices and payments. Those are not restored —
              the order comes back empty and has to be filled in again.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost text-xs" onClick={() => setConfirming(null)}>Keep it cancelled</button>
              <button className="btn-primary text-xs" disabled={busyId === confirming.id}
                onClick={() => reactivate(confirming)}>
                {busyId === confirming.id ? 'Reactivating…' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
