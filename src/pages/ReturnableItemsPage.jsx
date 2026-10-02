import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Check, Truck, Circle, Package, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { syncOrderStock, fetchProductMovements, summarise, isRefillable, returnMovementType, stockFigures } from '../lib/productStock'
import SearchField from '../components/ui/SearchField'
import { useTableSort, SortTh } from '../components/ui/SortableTable'

const daysSince = iso => {
  if (!iso) return 0
  const a = new Date(iso)
  return Math.max(0, Math.round((Date.now() - a.getTime()) / 86400000))
}
const fmtDate = iso => (iso ? String(iso).slice(0, 10) : '—')
const fmtQty  = n => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2) }
const lineTotal = it => Math.max(0, (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) - (Number(it.discount) || 0))
const fmtMoney = (amount, currency = 'USD') => `${currency || 'USD'} ${Number(amount || 0).toFixed(2)}`

// Whether the stock summary is expanded — remembered per device, so someone
// who works mostly in the list below isn't folding it away every visit.
const SUMMARY_KEY = 'ideliver:returnablesSummaryOpen'

export default function ReturnableItemsPage() {
  const { COMPANY_ID } = useApp()
  const { currentUser } = useAuth()
  const userName = currentUser?.username
    || `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
    || 'unknown'

  const [products, setProducts] = useState([])   // returnable products + in-store qty
  const [rows,     setRows]     = useState([])    // returnable order_items
  const [untracked, setUntracked] = useState({})  // product_id → qty sold before returns were tracked
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [showReturned, setShowReturned] = useState(false)
  const [summaryOpen,  setSummaryOpen]  = useState(() => {
    try { return localStorage.getItem(SUMMARY_KEY) !== '0' } catch { return true }
  })
  const toggleSummary = () => setSummaryOpen(o => {
    const next = !o
    try { localStorage.setItem(SUMMARY_KEY, next ? '1' : '0') } catch { /* private mode — just don't remember */ }
    return next
  })
  const [busyId,   setBusyId]   = useState(null)
  const [orderModal, setOrderModal] = useState(null)
  const [orderItems, setOrderItems] = useState([])
  const [orderItemsLoading, setOrderItemsLoading] = useState(false)
  const [orderItemsError, setOrderItemsError] = useState('')

  /* ── data ─────────────────────────────────────────────────── */

  const fetchAll = useCallback(async () => {
    setLoading(true)
    // Every column: is_refillable and returnable_since arrive with fix166.
    let pq = supabase.from('products')
      .select('*')
      .eq('is_active', true).eq('is_returnable', true).order('name')
    if (COMPANY_ID) pq = pq.eq('company_id', COMPANY_ID)

    // Every order_item of a returnable product = an issued returnable. Paged:
    // with Gallon 20 L returnable (fix166) this list grows by a few lines a
    // day, and past 1000 a plain select would drop the oldest without a word.
    const iq = fetchAllRows(() => supabase.from('order_items')
      .select(`id, product_id, quantity, added_at, is_returned, returned_at, returned_by,
        product:products!inner(code, name, is_returnable),
        order:delivery_orders!inner(id, order_number, status, isclosed, closed_at, recipient_name, driver:contacts!driver_id(first_name, last_name))`)
      .eq('product.is_returnable', true)
      .eq('is_deleted', false)
      // Nothing went out on a cancelled order, so there is nothing to get back.
      .or('status.is.null,status.neq.cancelled', { referencedTable: 'order' })
      .order('added_at', { ascending: false })
      .order('id'))   // a stable order, or rows sharing a time can cross pages

    const [{ data: prods }, { data: items }] = await Promise.all([pq, iq])

    /* In store from the stock LEDGER — the same summarise() the Inventory page
       uses. This read the old `inventory` table, which nothing writes, so it
       said 0 for everything. A refillable has two counts: filled and empty. */
    const { rows: moves } = await fetchProductMovements(COMPANY_ID, (prods ?? []).map(p => p.id))
    const stock = summarise(moves)
    setProducts((prods ?? []).map(p => ({
      ...p,
      ...(() => {
        // The same figures as the Inventory sheet (stockFigures): owned, on
        // the shelf, empty — so the two pages can never disagree.
        const f = stockFigures(p, stock.get(p.id))
        return { owned: f.onHand, available: f.available, empty: f.empty }
      })(),
    })))

    /* An item that was sold outright and later made returnable (Gallon 20 L,
       fix166): what it sold BEFORE was never going to be recorded back, so
       those lines are not chased as "out". An order still open at that moment
       goes out under the new rule and is chased like any other. */
    const since = new Map((prods ?? []).filter(p => p.returnable_since).map(p => [p.id, p.returnable_since]))
    const before = (r) => {
      const at = since.get(r.product_id)
      if (!at || r.is_returned || !r.order?.isclosed) return false
      return !r.order.closed_at || new Date(r.order.closed_at) < new Date(at)
    }
    const skipped = {}
    for (const r of items ?? []) {
      if (before(r)) skipped[r.product_id] = (skipped[r.product_id] || 0) + (Number(r.quantity) || 0)
    }
    setUntracked(skipped)
    setRows((items ?? []).filter(r => !before(r)))
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { fetchAll() }, [fetchAll])

  /* ── derived ──────────────────────────────────────────────── */

  const driverName = o => {
    const d = o?.driver
    return d ? `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() : ''
  }

  const outByProduct = useMemo(() => {
    const m = {}
    for (const r of rows) if (!r.is_returned) m[r.product_id] = (m[r.product_id] || 0) + (Number(r.quantity) || 0)
    return m
  }, [rows])

  /* What each column sorts BY. "Days out" sorts by the number of days, not by
     the words beside it, so the longest-outstanding item comes to the top in
     one click — which is the whole reason this page is read. A returned item
     has no days out and sinks to the bottom either way. */
  const sortValue = useCallback((r, key) => {
    switch (key) {
      case 'product':   return `${r.product?.name || ''} ${r.product?.code || ''}`.toLowerCase()
      case 'order':     return (r.order?.order_number || '').toLowerCase()
      case 'recipient': return (r.order?.recipient_name || '').toLowerCase()
      case 'driver':    return driverName(r.order).toLowerCase()
      case 'issued':    return r.added_at || ''
      case 'days':      return r.is_returned ? null : daysSince(r.added_at)
      case 'qty':       return Number(r.quantity) || 0
      case 'returned':  return r.is_returned ? 1 : 0
      default:          return ''
    }
  }, [])

  const filtered = rows.filter(r => {
    if (!showReturned && r.is_returned) return false
    const s = search.trim().toLowerCase()
    return !s || [r.product?.code, r.product?.name, r.order?.order_number, r.order?.recipient_name, driverName(r.order)]
      .some(v => String(v ?? '').toLowerCase().includes(s))
  })

  const { sort, cycle, sortRows } = useTableSort(sortValue)
  const visible = sortRows(filtered)

  /* A return puts the item back on the shelf (+1), and undoing it takes it off
     again. syncOrderStock recomputes what the order should have posted — its
     sale and its returns — so it is right whichever button was pressed, and
     never counts twice (fix165). */
  async function restock(r) {
    const orderId = r.order?.id || r.order_id || orderModal?.id
    if (!orderId) return
    const err = await syncOrderStock(orderId, {
      companyId: COMPANY_ID, userId: currentUser?.user_id || null, userName,
    })
    if (err) console.warn('Could not update stock for this return:', err)
  }

  /* ── actions ──────────────────────────────────────────────── */

  async function markReturned(r) {
    const prod = products.find(p => p.id === r.product_id)
    const empty = returnMovementType(prod, new Date().toISOString()) === 'returned_empty'
    if (!window.confirm(`Mark ${fmtQty(r.quantity)} × ${r.product?.name ?? 'item'} (order ${r.order?.order_number ?? ''}) as returned?`
      + (empty ? '\n\nIt comes back EMPTY: it goes to the empties on the Inventory page, and is for sale again once it is refilled.' : ''))) return
    setBusyId(r.id)
    const { error: e } = await supabase.from('order_items')
      .update({ is_returned: true, returned_at: new Date().toISOString(), returned_by: userName })
      .eq('id', r.id)
    if (!e) await restock(r)
    setBusyId(null)
    if (e) { alert(e.message); return }
    await fetchAll()
    if (orderModal?.id) await loadOrderItems(orderModal, false)
  }

  async function undoReturn(r) {
    setBusyId(r.id)
    const { error: e } = await supabase.from('order_items')
      .update({ is_returned: false, returned_at: null, returned_by: null })
      .eq('id', r.id)
    if (!e) await restock(r)
    setBusyId(null)
    if (e) { alert(e.message); return }
    await fetchAll()
    if (orderModal?.id) await loadOrderItems(orderModal, false)
  }

  /* ── render ───────────────────────────────────────────────── */

  async function loadOrderItems(order, clearFirst = true) {
    if (!order?.id) return
    setOrderItemsLoading(true)
    setOrderItemsError('')
    if (clearFirst) setOrderItems([])

    const { data, error } = await supabase.from('order_items')
      .select(`id, product_id, quantity, unit_price, currency, discount, added_at, is_returned, returned_at, returned_by,
        product:products(code, name, unit_of_measure, is_returnable)`)
      .eq('order_id', order.id)
      .eq('is_deleted', false)
      .order('added_at', { ascending: true })

    if (error) {
      setOrderItemsError(error.message)
      setOrderItems([])
    } else {
      setOrderItems(data ?? [])
    }
    setOrderItemsLoading(false)
  }

  function openOrderItems(order) {
    if (!order?.id) return
    setOrderModal(order)
    loadOrderItems(order)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* No page icon or running count here: the header already names the
            page, and the stock summary below gives the out/in-store figures. */}
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search product, order #, recipient, driver…"
          />
        </div>

        <button type="button" onClick={() => setShowReturned(s => !s)} aria-pressed={showReturned}
          className={`ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border transition-colors select-none ${
            showReturned
              ? 'bg-green-500/15 border-green-500/40 text-green-300'
              : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
          {showReturned ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 flex-shrink-0" />}
          Show returned
        </button>
      </div>

      {/* Per-product summary: out vs available in store.
          It folds away on click — with a dozen returnable products it can eat
          half the screen, and the list below is what the page is for. */}
      <div className="card p-4 flex-shrink-0">
        <button type="button" onClick={toggleSummary} aria-expanded={summaryOpen}
          className={`flex w-full items-center gap-1.5 text-left text-[11px] uppercase tracking-wider font-semibold text-slate-500 hover:text-slate-300 transition-colors ${summaryOpen ? 'mb-3' : ''}`}>
          {summaryOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Stock summary
          {!summaryOpen && products.length > 0 && (
            <span className="ml-1.5 normal-case tracking-normal text-slate-600">
              {products.length} product{products.length === 1 ? '' : 's'}
            </span>
          )}
        </button>
        {!summaryOpen ? null : products.length === 0 ? (
          <p className="text-xs text-slate-600">No returnable products yet. Mark a product as “Returnable” in Products.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {products.map(p => (
              <div key={p.id} className="rounded-lg border border-surface-border bg-surface-hover/40 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-200 truncate">{p.name}</span>
                  <span className="font-mono text-[10px] text-brand-400">{p.code}</span>
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-xs">
                  <span className="text-amber-300">Out: <b>{fmtQty(outByProduct[p.id] || 0)}</b></span>
                  <span className="text-green-400" title="On the shelf, ready to go out">Available: <b>{fmtQty(p.available)}</b></span>
                  {isRefillable(p) && (
                    <span className="text-cyan-300" title="Back from customers, waiting to be refilled">Empty: <b>{fmtQty(p.empty)}</b></span>
                  )}
                  <span className="text-slate-300" title="Everything owned — on the shelf and with customers. Changes only with stock in, stock out and adjustments.">On hand: <b>{fmtQty(p.owned)}</b></span>
                  <span className="text-slate-500">{p.unit_of_measure}</span>
                </div>
                {untracked[p.id] > 0 && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    {fmtQty(untracked[p.id])} sold before {fmtDate(p.returnable_since)}, when returns were not yet
                    recorded — not chased here. Empties that come back from those go in with Correct empty count on
                    Inventory.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Issued items (from order_items) */}
      {/* The table scrolls inside the card so its header stays put while the
          list of what is still out is read from top to bottom. */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="sticky top-0 z-10 bg-surface-card">
            <tr className="border-b border-surface-border">
              {[
                ['Product', 'product'], ['Order #', 'order'], ['Recipient', 'recipient'],
                ['Driver', 'driver'], ['Issued', 'issued'], ['Days Out', 'days'],
                ['Qty', 'qty'], ['Returned', 'returned'], ['', null],
              ].map(([label, key], i) => (
                <SortTh key={label || 'actions'} label={label} sortKey={key} sort={sort} onSort={cycle}
                  align={i === 5 || i === 6 ? 'right' : 'left'}
                  className="px-4 py-3 text-slate-500 text-xs uppercase tracking-wider whitespace-nowrap" />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No returnable items {showReturned ? '' : 'out'} — add a returnable product to an order.</td></tr>
            ) : visible.map(r => {
              const out = !r.is_returned
              const days = out ? daysSince(r.added_at) : null
              return (
                <tr key={r.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${out ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3">
                    <span className="text-slate-200 text-xs">{r.product?.name ?? '—'}</span>
                    {r.product?.code && <span className="block font-mono text-[10px] text-brand-400">{r.product.code}</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.order?.id
                      ? <button onClick={() => openOrderItems(r.order)}
                          title="Open order — Items section"
                          className="font-mono text-xs text-brand-400 hover:text-brand-300 underline-offset-2 hover:underline">
                          {r.order.order_number}
                        </button>
                      : <span className="font-mono text-xs text-slate-500">{r.order?.order_number ?? '—'}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{r.order?.recipient_name ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">
                    {driverName(r.order)
                      ? <span className="inline-flex items-center gap-1"><Truck className="w-3 h-3 text-brand-400" />{driverName(r.order)}</span>
                      : <span className="text-slate-600">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(r.added_at)}</td>
                  <td className={`px-4 py-3 text-xs font-medium text-right ${out && days > 7 ? 'text-red-400' : out ? 'text-amber-300' : 'text-slate-500'}`}>
                    {out ? days : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-100 text-xs font-medium text-right">{fmtQty(r.quantity)}</td>
                  <td className="px-4 py-3">
                    {out ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20">No</span>
                    ) : (
                      <div className="text-[10px]">
                        <span className="px-2 py-0.5 rounded font-medium border bg-green-500/10 text-green-400 border-green-500/20">Yes</span>
                        <span className="block text-slate-500 mt-0.5">{fmtDate(r.returned_at)} · by {r.returned_by ?? '—'}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {out ? (
                      <button onClick={() => markReturned(r)} disabled={busyId === r.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15 disabled:opacity-50">
                        <Check className="w-3.5 h-3.5" /> Returned
                      </button>
                    ) : (
                      <button onClick={() => undoReturn(r)} disabled={busyId === r.id}
                        className="text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-50" title="Undo return">
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {orderModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] bg-surface border border-surface-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-border flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Package className="w-4 h-4 text-brand-400" />
                  <span className="font-mono">{orderModal.order_number}</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {orderModal.recipient_name || 'No recipient'}{driverName(orderModal) ? ` - ${driverName(orderModal)}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setOrderModal(null)}
                className="p-2 text-slate-500 hover:text-slate-200 transition-colors" title="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="border-b border-surface-border">
                    {['Item', 'Issued', 'Qty', 'Unit', 'Discount', 'Line total', 'Returned', ''].map((h, i) => (
                      <th key={h} className={`px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap ${i >= 2 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderItemsLoading ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading items...</td></tr>
                  ) : orderItemsError ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-red-400">{orderItemsError}</td></tr>
                  ) : orderItems.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No local retail items on this order.</td></tr>
                  ) : orderItems.map(it => {
                    const isReturnable = it.product?.is_returnable === true
                    const out = isReturnable && !it.is_returned
                    return (
                      <tr key={it.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-slate-200 text-xs">{it.product?.name ?? 'Unknown item'}</span>
                          <span className="block text-[10px] mt-0.5">
                            {it.product?.code && <span className="font-mono text-brand-400">{it.product.code}</span>}
                            {isReturnable && <span className="ml-2 px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-300 border-amber-500/20 font-medium">Returnable</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(it.added_at)}</td>
                        <td className="px-4 py-3 text-slate-100 text-xs font-medium text-right">{fmtQty(it.quantity)}</td>
                        <td className="px-4 py-3 text-slate-300 text-xs text-right whitespace-nowrap">{fmtMoney(it.unit_price, it.currency)}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs text-right whitespace-nowrap">{fmtMoney(it.discount, it.currency)}</td>
                        <td className="px-4 py-3 text-slate-100 text-xs font-semibold text-right whitespace-nowrap">{fmtMoney(lineTotal(it), it.currency)}</td>
                        <td className="px-4 py-3">
                          {!isReturnable ? (
                            <span className="text-[10px] text-slate-600">N/A</span>
                          ) : out ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20">No</span>
                          ) : (
                            <div className="text-[10px]">
                              <span className="px-2 py-0.5 rounded font-medium border bg-green-500/10 text-green-400 border-green-500/20">Yes</span>
                              <span className="block text-slate-500 mt-0.5">{fmtDate(it.returned_at)} - by {it.returned_by ?? 'none'}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isReturnable && (out ? (
                            <button onClick={() => markReturned({ ...it, order: orderModal })} disabled={busyId === it.id}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15 disabled:opacity-50">
                              <Check className="w-3.5 h-3.5" /> Returned
                            </button>
                          ) : (
                            <button onClick={() => undoReturn({ ...it, order: orderModal })} disabled={busyId === it.id}
                              className="text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-50" title="Undo return">
                              Undo
                            </button>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
