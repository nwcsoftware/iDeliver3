import React, { useState } from 'react'
import { Trash2, AlertTriangle, CheckCircle2, Loader, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* The exact word the user must type to arm the deletion. */
const CONFIRM_WORD = 'Confirmed'

/* Related-data tables counted for the warning (label → table). order_items uses
   the soft-delete flag elsewhere, but a full delete removes every row. */
const COUNT_TABLES = [
  ['Packages',          'delivery_packages'],
  ['Services',          'order_services'],
  ['Local items',       'order_items'],
  ['External retails',  'retail_goods_invoices'],
  ['Payments',          'payment_collections'],
]

function contactLabel(c) {
  if (!c) return ''
  return (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
}

export default function DeleteOrderPage() {
  const { fetchOrders } = useApp()
  const { currentUser, hasRole } = useAuth()
  // Permanently removing data is restricted to the super_admin (the developer).
  const isAdmin = hasRole('super_admin')

  const [orderNumber, setOrderNumber] = useState('')
  const [order,       setOrder]       = useState(null)   // looked-up order + counts
  const [finding,     setFinding]     = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState('')
  const [done,        setDone]        = useState('')

  const armed = confirmText.trim().toLowerCase() === CONFIRM_WORD.toLowerCase()

  function reset(keepNumber = false) {
    setOrder(null); setConfirmText(''); setError('')
    if (!keepNumber) setOrderNumber('')
  }

  async function fetchCounts(orderId) {
    const out = {}
    for (const [label, table] of COUNT_TABLES) {
      let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('order_id', orderId)
      if (table === 'order_items') q = q.eq('is_deleted', false)
      const { count } = await q
      out[label] = count || 0
    }
    return out
  }

  async function findOrder() {
    const num = orderNumber.trim()
    if (!num || finding) return
    setFinding(true); setError(''); setDone(''); setOrder(null)
    const { data, error: e } = await supabase
      .from('delivery_orders')
      .select(`id, order_number, order_type, status, recipient_name, delivery_fee, currency,
               customer:contacts!customer_id(first_name, last_name, company_name),
               driver:contacts!driver_id(first_name, last_name)`)
      .eq('order_number', num)
      .maybeSingle()
    if (e) { setError(e.message); setFinding(false); return }
    if (!data) { setError(`No order found with number “${num}”.`); setFinding(false); return }
    const counts = await fetchCounts(data.id)
    setOrder({ ...data, counts }); setConfirmText(''); setFinding(false)
  }

  async function handleDelete() {
    if (!armed || !order || busy) return
    setBusy(true); setError(''); setDone('')
    const { data, error: e } = await supabase.rpc('delete_order_completely', {
      p_order_number: order.order_number,
      p_user_id:      currentUser?.user_id || null,
    })
    if (e) {
      setError(/ORDER_NOT_FOUND/.test(e.message) ? 'That order no longer exists (already deleted?).' : e.message)
      setBusy(false); return
    }
    await fetchOrders()
    setDone(data || `Order ${order.order_number} was permanently deleted.`)
    reset(); setOrderNumber(''); setBusy(false)
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        You don't have permission to access this page.
      </div>
    )
  }

  const customerName = contactLabel(order?.customer) || '—'
  const driverName   = contactLabel(order?.driver)
  const totalCounts  = order ? Object.values(order.counts).reduce((s, n) => s + n, 0) : 0

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-600/30 flex items-center justify-center">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Delete Order</h1>
            <p className="text-xs text-slate-500 mt-0.5">Permanently remove a single order and all of its data</p>
          </div>
        </div>

        {/* Step 1 — find the order */}
        <div className="card p-5 space-y-3">
          <label className="label">Order number</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                className="input pl-9"
                value={orderNumber}
                onChange={e => { setOrderNumber(e.target.value); reset(true); setDone('') }}
                onKeyDown={e => { if (e.key === 'Enter') findOrder() }}
                placeholder="e.g. ORD-2026-00123"
                autoComplete="off"
                disabled={busy}
              />
            </div>
            <button className="btn-primary" onClick={findOrder} disabled={!orderNumber.trim() || finding || busy}>
              {finding ? <><Loader className="w-4 h-4 animate-spin" /> Finding…</> : <>Find order</>}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </p>
          )}
          {done && (
            <p className="text-xs text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> {done}
            </p>
          )}
        </div>

        {/* Step 2 — warning + confirmation */}
        {order && (
          <div className="card p-5 border-red-600/30 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-300 space-y-1">
                <p className="font-semibold text-red-300">
                  You are about to permanently delete order {order.order_number}. This cannot be undone.
                </p>
                <p className="text-slate-400">Every record below will be removed from the database for good.</p>
              </div>
            </div>

            {/* Order identity */}
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between gap-3"><span className="text-slate-500">Order #</span><span className="text-slate-200 font-mono">{order.order_number}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Type</span><span className="text-slate-200 capitalize">{order.order_type || '—'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Customer</span><span className="text-slate-200 truncate">{customerName}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Driver</span><span className="text-slate-200 truncate">{driverName || <span className="text-slate-500">Unassigned</span>}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Recipient</span><span className="text-slate-200 truncate">{order.recipient_name || '—'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Status</span><span className="text-slate-200">{order.status || '—'}</span></div>
            </div>

            {/* What will be removed */}
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-[11px] text-red-300 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
                <Trash2 className="w-3.5 h-3.5" /> Will be deleted
              </p>
              {totalCounts === 0 ? (
                <p className="text-xs text-slate-400">No sub-records — only the order itself will be removed.</p>
              ) : (
                <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                  {COUNT_TABLES.map(([label]) => order.counts[label] > 0 && (
                    <li key={label} className="flex items-center justify-between text-xs text-slate-300">
                      <span>{label}</span>
                      <span className="font-mono text-red-300">{order.counts[label]} ✕</span>
                    </li>
                  ))}
                  {Number(order.delivery_fee) > 0 && (
                    <li className="flex items-center justify-between text-xs text-slate-300">
                      <span>Delivery fee</span>
                      <span className="font-mono text-red-300">cleared</span>
                    </li>
                  )}
                </ul>
              )}
              <p className="text-[11px] text-slate-500 mt-2">
                Plus order tracking, settlement &amp; sales-invoice links and order ledger entries. A history record is written to the audit log.
              </p>
            </div>

            {/* Confirmation */}
            <div className="pt-1 space-y-2">
              <label className="label">Type <span className="font-mono text-red-300">{CONFIRM_WORD}</span> to confirm</label>
              <input
                className="input"
                value={confirmText}
                onChange={e => { setConfirmText(e.target.value); setError('') }}
                placeholder={CONFIRM_WORD}
                autoComplete="off"
                disabled={busy}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost text-slate-400 hover:text-slate-100" onClick={() => reset()} disabled={busy}>
                <X className="w-4 h-4" /> Cancel
              </button>
              <button
                className="btn-primary !bg-red-600 hover:!bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={handleDelete}
                disabled={!armed || busy}>
                {busy
                  ? <><Loader className="w-4 h-4 animate-spin" /> Deleting…</>
                  : <><Trash2 className="w-4 h-4" /> Delete permanently</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
