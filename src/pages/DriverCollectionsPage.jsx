import React, { useMemo, useState } from 'react'
import { Truck, Calendar, CheckCircle2, Loader, AlertTriangle, Wallet, CheckSquare, Square } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { orderTotalsByCurrency, orderCollectedByCurrency, fmtAmount } from '../lib/orderAmounts'

/* ── Driver App — Payment Collection Simulator ───────────────────────────────
   Super-admin-only demonstration tool. In production the external "Driver app"
   is what records that a driver collected cash from a customer on delivery. This
   page mimics that step for a chosen day: for each selected order it inserts a
   payment_collections row (attributed to the driver — NOT an office user) and sets
   the order's payment_status to `collected_by_driver`.

   That is the FIRST hop of the money lifecycle demonstrated by the app:
     Driver app (this page)  →  collected_by_driver
       → Driver Settlements  →  paid_to_office + order closed   (cash reaches the datacenter)
         → Cashier Box       →  cash box                        (final reconciliation)

   Note: payments are recorded WITHOUT a collected_by_name on purpose. The amounts
   library treats a named collector as "paid directly to the office"; leaving it
   blank keeps the cash owed by the driver, so it correctly appears in the Driver
   Settlements screen — exactly as a real driver-app collection would. */

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

/* Per-currency amount still owed on an order = total − already collected (>0 only). */
function remainingByCurrency(o) {
  const totals    = orderTotalsByCurrency(o)
  const collected = orderCollectedByCurrency(o)
  const rem = {}
  for (const cur of Object.keys(totals)) {
    const r = round2((totals[cur] || 0) - (collected[cur] || 0))
    if (r > 0) rem[cur] = r
  }
  return rem
}

const driverName = (o) =>
  `${o.driver?.first_name ?? ''} ${o.driver?.last_name ?? ''}`.trim() || 'Unassigned'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function DriverCollectionsPage() {
  const { orders, fetchOrders, loading } = useApp()
  const { hasRole } = useAuth()
  // Demonstration tool — restricted to super_admin (the developer) only.
  const isSuperAdmin = hasRole('super_admin')

  const [date,      setDate]      = useState(todayStr())
  // "As of" date the collection is recorded / the order is closed on. Defaults to
  // the scheduled date, but the super admin can back- or forward-date it so the
  // payment_collections row lands on a specific day regardless of when it's run.
  const [asOfDate,  setAsOfDate]  = useState(todayStr())
  const [selected,  setSelected]  = useState(() => new Set())
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [result,    setResult]    = useState(null)   // { orders, payments, totals:{cur:amt} }

  /* Orders eligible to be "collected by the driver" on the chosen day:
     scheduled that date, confirmed, still open, not cancelled/failed, with an
     assigned driver, and still carrying an outstanding balance. Credit-customer
     orders are excluded — the driver collects no cash on them (the customer
     settles their account later on the Credit Customers page). */
  const eligible = useMemo(() => {
    if (!isSuperAdmin) return []
    return orders
      .filter(o =>
        // scheduled_date may carry a time component, so compare the date part only
        // (matches how the rest of the app normalises it).
        String(o.scheduled_date || '').slice(0, 10) === date &&
        o.order_confirmed === true &&
        o.isclosed !== true &&
        o.customer?.credit_debit_allowed !== true &&
        !['cancelled', 'failed'].includes(o.status) &&
        !!o.driver_id &&
        Object.keys(remainingByCurrency(o)).length > 0)
      .map(o => ({ order: o, remaining: remainingByCurrency(o) }))
  }, [orders, date, isSuperAdmin])

  const allSelected = eligible.length > 0 && eligible.every(({ order }) => selected.has(order.id))

  function toggle(id) {
    setResult(null)
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setResult(null)
    setSelected(allSelected ? new Set() : new Set(eligible.map(({ order }) => order.id)))
  }
  function onDateChange(v) {
    // Keep the "as of" date in step with the scheduled date until the admin
    // overrides it, so the common case (collect on the scheduled day) needs no
    // second click.
    setDate(v)
    setAsOfDate(prev => (prev === date ? v : prev))
    setSelected(new Set()); setResult(null); setError('')
  }
  function onAsOfChange(v) {
    setAsOfDate(v); setResult(null); setError('')
  }

  async function process() {
    if (busy) return
    const rows = eligible.filter(({ order }) => selected.has(order.id))
    if (rows.length === 0) { setError('Select at least one order to collect.'); return }
    setBusy(true); setError(''); setResult(null)

    const collectedAt = `${asOfDate}T12:00:00`
    const totalsByCur = {}
    let paymentsInserted = 0

    for (const { order, remaining } of rows) {
      // 1. One payment_collections row per currency still owed, attributed to the
      //    driver: collected_by = the driver's contact id, collected_by_name = the
      //    driver's name — exactly what the real driver app records. The driver
      //    settlement math still counts these as driver-collected because the
      //    collector matches the order's own driver.
      const payments = Object.entries(remaining).map(([currency, amount]) => ({
        order_id:          order.id,
        collection_type:   'cash',
        amount,
        currency,
        collected_at:      collectedAt,
        notes:             `Driver app (simulated) — collected by ${driverName(order)}`,
        collected_by:      order.driver_id,
        collected_by_name: driverName(order),
      }))
      const { error: pe } = await supabase.from('payment_collections').insert(payments)
      if (pe) { setError(`Order ${order.order_number}: ${pe.message}`); setBusy(false); return }

      // 2. Flag the order as collected by the driver (money is with the driver,
      //    not yet in the office) and mark the customer collection complete.
      const { error: ue } = await supabase.from('delivery_orders').update({
        payment_status:           'collected_by_driver',
        collection_from_customer: 'Money Fully collected',
      }).eq('id', order.id)
      if (ue) { setError(`Order ${order.order_number}: ${ue.message}`); setBusy(false); return }

      paymentsInserted += payments.length
      for (const [cur, amt] of Object.entries(remaining)) totalsByCur[cur] = round2((totalsByCur[cur] || 0) + amt)
    }

    await fetchOrders()
    setSelected(new Set())
    setResult({ orders: rows.length, payments: paymentsInserted, totals: totalsByCur, asOf: asOfDate })
    setBusy(false)
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        You don't have permission to access this page.
      </div>
    )
  }

  const selectedCount = eligible.filter(({ order }) => selected.has(order.id)).length

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-600/30 flex items-center justify-center">
            <Truck className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Driver App — Collect Payments</h1>
            <p className="text-xs text-slate-500 mt-0.5">Simulate a day's driver collections (super admin only)</p>
          </div>
        </div>

        {/* Flow explainer */}
        <div className="card p-4 border-cyan-600/20">
          <p className="text-xs text-slate-400 leading-relaxed">
            This mimics the external <span className="text-cyan-300 font-medium">Driver app</span>: for the chosen day it records
            that each driver collected the cash owed on their orders — inserting a payment and setting the order to
            <span className="text-cyan-300"> “With Driver”</span>. From there the money follows the normal flow:
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px]">
            <span className="px-2 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">1 · Driver app → With Driver</span>
            <span className="text-slate-600">→</span>
            <span className="px-2 py-1 rounded-md bg-slate-700/40 text-slate-300 border border-slate-600/40">2 · Driver Settlements → Paid to office</span>
            <span className="text-slate-600">→</span>
            <span className="px-2 py-1 rounded-md bg-slate-700/40 text-slate-300 border border-slate-600/40">3 · Cashier Box</span>
          </div>
        </div>

        {/* Date pickers */}
        <div className="card p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="label flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Scheduled date</label>
            <input type="date" className="input" value={date} onChange={e => onDateChange(e.target.value)} disabled={busy} />
            <p className="text-[11px] text-slate-500 mt-1">Picks which orders to collect.</p>
          </div>
          <div>
            <label className="label flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Collect / close as of</label>
            <input type="date" className="input" value={asOfDate} onChange={e => onAsOfChange(e.target.value)} disabled={busy} />
            <p className="text-[11px] text-slate-500 mt-1">Date the payment is recorded on.</p>
          </div>
          <div className="text-xs text-slate-500 pb-1">
            {loading?.orders
              ? 'Loading orders…'
              : `${eligible.length} order${eligible.length === 1 ? '' : 's'} with a balance scheduled on ${date}.`}
          </div>
        </div>

        {/* Eligible orders */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-border">
            <button onClick={toggleAll} disabled={eligible.length === 0 || busy}
              className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
              {allSelected ? <CheckSquare className="w-4 h-4 text-cyan-400" /> : <Square className="w-4 h-4" />}
              Select all
            </button>
            <span className="text-xs text-slate-500">{selectedCount} selected</span>
          </div>

          {eligible.length === 0 ? (
            <p className="px-4 py-10 text-sm text-slate-500 text-center">
              No confirmed, driver-assigned orders with an outstanding balance on this date.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-surface-border">
                    <th className="px-4 py-2 w-8"></th>
                    <th className="px-4 py-2">Order</th>
                    <th className="px-4 py-2">Recipient</th>
                    <th className="px-4 py-2">Driver</th>
                    <th className="px-4 py-2 text-right">To collect</th>
                  </tr>
                </thead>
                <tbody>
                  {eligible.map(({ order, remaining }) => {
                    const on = selected.has(order.id)
                    return (
                      <tr key={order.id}
                        onClick={() => !busy && toggle(order.id)}
                        className={`border-b border-surface-border/60 cursor-pointer transition-colors ${on ? 'bg-cyan-500/5' : 'hover:bg-surface-hover'}`}>
                        <td className="px-4 py-2.5">
                          {on ? <CheckSquare className="w-4 h-4 text-cyan-400" /> : <Square className="w-4 h-4 text-slate-600" />}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-brand-300 text-xs whitespace-nowrap">{order.order_number}</td>
                        <td className="px-4 py-2.5 text-slate-300">{order.recipient_name}</td>
                        <td className="px-4 py-2.5 text-slate-400">{driverName(order)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {Object.entries(remaining).map(([cur, amt]) => (
                            <div key={cur} className="text-amber-300">{fmtAmount(amt, cur)} <span className="text-slate-500 text-xs">{cur}</span></div>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </p>
        )}
        {result && (
          <div className="card p-4 border-green-600/30 space-y-1">
            <p className="text-sm text-green-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              {result.orders} order{result.orders === 1 ? '' : 's'} marked as collected by drivers as of {result.asOf} ({result.payments} payment{result.payments === 1 ? '' : 's'} recorded).
            </p>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap">
              <Wallet className="w-3.5 h-3.5" /> Collected:
              {Object.entries(result.totals).map(([cur, amt]) => (
                <span key={cur} className="text-slate-200">{fmtAmount(amt, cur)} {cur}</span>
              ))}
            </p>
            <p className="text-[11px] text-slate-500">Next: settle this cash with the driver in <span className="text-slate-300">Driver Settlements</span>.</p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            className="btn-primary !bg-cyan-600 hover:!bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={process}
            disabled={busy || selectedCount === 0}>
            {busy
              ? <><Loader className="w-4 h-4 animate-spin" /> Processing…</>
              : <><Truck className="w-4 h-4" /> Mark {selectedCount || ''} as collected by drivers</>}
          </button>
        </div>
      </div>
    </div>
  )
}
