import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { RotateCcw, X, Check, Truck, Circle, Package } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import SearchField from '../components/ui/SearchField'

const daysSince = iso => {
  if (!iso) return 0
  const a = new Date(iso)
  return Math.max(0, Math.round((Date.now() - a.getTime()) / 86400000))
}
const fmtDate = iso => (iso ? String(iso).slice(0, 10) : '—')
const fmtQty  = n => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2) }
const lineTotal = it => Math.max(0, (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) - (Number(it.discount) || 0))
const fmtMoney = (amount, currency = 'USD') => `${currency || 'USD'} ${Number(amount || 0).toFixed(2)}`

export default function ReturnableItemsPage() {
  const { COMPANY_ID } = useApp()
  const { currentUser } = useAuth()
  const userName = currentUser?.username
    || `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
    || 'unknown'

  const [products, setProducts] = useState([])   // returnable products + in-store qty
  const [rows,     setRows]     = useState([])    // returnable order_items
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [showReturned, setShowReturned] = useState(false)
  const [busyId,   setBusyId]   = useState(null)
  const [orderModal, setOrderModal] = useState(null)
  const [orderItems, setOrderItems] = useState([])
  const [orderItemsLoading, setOrderItemsLoading] = useState(false)
  const [orderItemsError, setOrderItemsError] = useState('')

  /* ── data ─────────────────────────────────────────────────── */

  const fetchAll = useCallback(async () => {
    setLoading(true)
    let pq = supabase.from('products')
      .select('id, code, name, unit_of_measure, inventory(quantity_available)')
      .eq('is_active', true).eq('is_returnable', true).order('name')
    if (COMPANY_ID) pq = pq.eq('company_id', COMPANY_ID)

    // Every order_item of a returnable product = an issued returnable.
    const iq = supabase.from('order_items')
      .select(`id, product_id, quantity, added_at, is_returned, returned_at, returned_by,
        product:products!inner(code, name, is_returnable),
        order:delivery_orders(id, order_number, recipient_name, driver:contacts!driver_id(first_name, last_name))`)
      .eq('product.is_returnable', true)
      .eq('is_deleted', false)
      .order('added_at', { ascending: false })

    const [{ data: prods }, { data: items }] = await Promise.all([pq, iq])
    setProducts((prods ?? []).map(p => ({
      ...p,
      available: (p.inventory ?? []).reduce((s, i) => s + (Number(i.quantity_available) || 0), 0),
    })))
    setRows(items ?? [])
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

  const totalOut = Object.values(outByProduct).reduce((s, n) => s + n, 0)

  const visible = rows.filter(r => {
    if (!showReturned && r.is_returned) return false
    const s = search.trim().toLowerCase()
    return !s || [r.product?.code, r.product?.name, r.order?.order_number, r.order?.recipient_name, driverName(r.order)]
      .some(v => String(v ?? '').toLowerCase().includes(s))
  })

  /* ── actions ──────────────────────────────────────────────── */

  async function markReturned(r) {
    if (!window.confirm(`Mark ${fmtQty(r.quantity)} × ${r.product?.name ?? 'item'} (order ${r.order?.order_number ?? ''}) as returned?`)) return
    setBusyId(r.id)
    const { error: e } = await supabase.from('order_items')
      .update({ is_returned: true, returned_at: new Date().toISOString(), returned_by: userName })
      .eq('id', r.id)
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
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-600/20 border border-amber-600/30 flex items-center justify-center">
            <RotateCcw className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Returnable Items</h1>
            <p className="text-xs text-slate-500 mt-0.5">{fmtQty(totalOut)} out · {visible.length} record{visible.length === 1 ? '' : 's'}</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
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

      {/* Per-product summary: out vs available in store */}
      <div className="card p-4">
        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-3">Stock summary</p>
        {products.length === 0 ? (
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
                  <span className="text-green-400">In store: <b>{fmtQty(p.available)}</b></span>
                  <span className="text-slate-500">{p.unit_of_measure}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Issued items (from order_items) */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="border-b border-surface-border">
              {['Product', 'Order #', 'Recipient', 'Driver', 'Issued', 'Days Out', 'Qty', 'Returned', ''].map((h, i) => (
                <th key={h} className={`px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap ${i === 5 || i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
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
