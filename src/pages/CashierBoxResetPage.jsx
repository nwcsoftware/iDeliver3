import React, { useMemo, useState } from 'react'
import { Wallet, AlertTriangle, CheckCircle2, Loader, X, Trash2, RotateCcw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* The exact word the user must type to arm the reset. */
const CONFIRM_WORD = 'RESET'

/* Per-order money-movement categories summed into the "Will be cleared" panel
   (jsonb key on each order row → label). These are exactly what the Cashier Box
   reads: payments (IN) + retail/packages/services (OUT). */
const COUNT_KEYS = [
  ['payments', 'Payments (IN)'],
  ['retail',   'Retail invoices (OUT)'],
  ['packages', 'Delivery packages (OUT)'],
  ['services', 'Order services (OUT)'],
]

const todayStr = () => new Date().toISOString().slice(0, 10)
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '—')

/* Super-admin tool — permanently wipe the money movements that feed the Daily
   Cashier Box for every CLOSED order closed on or before a chosen "as of" date.
   Order shells stay closed; only their cashier-box transactions are removed. */
export default function CashierBoxResetPage() {
  const { fetchOrders } = useApp()
  const { currentUser, hasRole } = useAuth()
  // Permanently removing data is restricted to the super_admin (the developer).
  const isSuperAdmin = hasRole('super_admin')

  const [through,     setThrough]     = useState(todayStr())
  const [orders,      setOrders]      = useState(null)   // matched closed orders (null = not previewed)
  const [checking,    setChecking]    = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState('')
  const [done,        setDone]        = useState('')

  const armed = confirmText.trim().toUpperCase() === CONFIRM_WORD

  function reset() {
    setOrders(null); setConfirmText(''); setError('')
  }
  function onDateChange(v) {
    setThrough(v); reset(); setDone('')
  }

  function friendlyError(msg) {
    if (/DATE_REQUIRED/.test(msg)) return 'Please choose an "as of" date.'
    return msg
  }

  async function runPreview() {
    if (!through || checking) return
    setChecking(true); setError(''); setDone(''); setOrders(null)
    const { data, error: e } = await supabase.rpc('preview_cashier_box_reset', { p_through: through })
    if (e) { setError(friendlyError(e.message)); setChecking(false); return }
    setOrders(Array.isArray(data) ? data : [])
    setConfirmText(''); setChecking(false)
  }

  // Totals across all matched orders.
  const totals = useMemo(() => {
    const t = { orders: 0, payments: 0, retail: 0, packages: 0, services: 0 }
    for (const o of orders || []) {
      t.orders += 1
      for (const [k] of COUNT_KEYS) t[k] += Number(o[k]) || 0
    }
    return t
  }, [orders])

  async function handleReset() {
    if (!armed || busy || totals.orders === 0) return
    setBusy(true); setError(''); setDone('')
    const { data, error: e } = await supabase.rpc('reset_cashier_box_through', {
      p_through: through, p_user_id: currentUser?.user_id || null,
    })
    if (e) { setError(friendlyError(e.message)); setBusy(false); return }
    await fetchOrders()
    const n = data?.orders ?? totals.orders
    setDone(`Cashier Box reset as of ${through}. Cleared money movements on ${n} closed order${n === 1 ? '' : 's'}.`)
    reset(); setBusy(false)
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        You don't have permission to access this page.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-600/30 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Reset Cashier Box</h1>
            <p className="text-xs text-slate-500 mt-0.5">Permanently clear the money movements feeding the Daily Cashier Box, as of a chosen date</p>
          </div>
        </div>

        {/* Step 1 — pick the "as of" date */}
        <div className="card p-5 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Reset as of (close date)</label>
              <input type="date" className="input" value={through}
                onChange={e => onDateChange(e.target.value)} disabled={busy} />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Every <span className="font-semibold">closed order</span> whose close date is{' '}
              <span className="font-semibold">on or before {through || '—'}</span> is affected. Its cashier-box money
              movements (payments, retail invoices, packages, services) are removed for good. The order itself stays
              closed — only its money lines are cleared.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button className="btn-primary" onClick={runPreview} disabled={!through || checking || busy}>
              {checking ? <><Loader className="w-4 h-4 animate-spin" /> Checking…</> : <>Preview</>}
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

        {/* Step 2 — affected orders + confirmation */}
        {orders && (
          orders.length === 0 ? (
            <div className="card p-5 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-300">
                No closed orders were closed on or before <span className="text-slate-100 font-medium">{through}</span>.
                The Cashier Box has nothing to reset for that period.
              </p>
            </div>
          ) : (
            <div className="card p-5 border-red-600/30 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-slate-300 space-y-1">
                  <p className="font-semibold text-red-300">
                    {totals.orders} closed order{totals.orders === 1 ? '' : 's'} closed on or before {through} will have their
                    cashier-box money movements permanently cleared. This cannot be undone.
                  </p>
                  <p className="text-slate-400">
                    This also affects Deliveries, Driver Settlements and Credit Customers, since those money records are shared.
                  </p>
                </div>
              </div>

              {/* Affected order list */}
              <div className="rounded-lg border border-surface-border overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border bg-surface-card/60">
                  <span className="text-xs font-medium text-slate-300">Affected closed orders</span>
                  <span className="text-xs text-slate-500">{totals.orders} order{totals.orders === 1 ? '' : 's'}</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-surface-border">
                        <th className="px-3 py-2">Closed</th>
                        <th className="px-3 py-2">Order #</th>
                        <th className="px-3 py-2">Recipient</th>
                        <th className="px-3 py-2">Customer</th>
                        <th className="px-3 py-2 text-right">Money lines</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => {
                        const money = COUNT_KEYS.reduce((s, [k]) => s + (Number(o[k]) || 0), 0)
                        return (
                          <tr key={o.id} className="border-b border-surface-border/50">
                            <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">{dateOnly(o.closed_at)}</td>
                            <td className="px-3 py-2 font-mono text-brand-400 text-xs whitespace-nowrap">{o.order_number}</td>
                            <td className="px-3 py-2 text-slate-300 text-xs truncate max-w-[10rem]">{o.recipient_name || '—'}</td>
                            <td className="px-3 py-2 text-slate-400 text-xs truncate max-w-[10rem]">{o.customer || '—'}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-500 tabular-nums">
                              {money > 0 ? `${money} line${money === 1 ? '' : 's'}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* What will be removed */}
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-[11px] text-red-300 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
                  <Trash2 className="w-3.5 h-3.5" /> Will be cleared
                </p>
                <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                  {COUNT_KEYS.map(([key, label]) => (
                    <li key={key} className="flex items-center justify-between text-xs text-slate-300">
                      <span>{label}</span><span className="font-mono text-red-300">{totals[key]} ✕</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-500 mt-2">
                  Plus order-linked ledger entries and driver-settlement links for these orders. The orders stay closed;
                  a summary is written to the audit log.
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
                <button className="btn-ghost text-slate-400 hover:text-slate-100" onClick={reset} disabled={busy}>
                  <X className="w-4 h-4" /> Cancel
                </button>
                <button
                  className="btn-primary !bg-red-600 hover:!bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={handleReset}
                  disabled={!armed || busy || totals.orders === 0}>
                  {busy
                    ? <><Loader className="w-4 h-4 animate-spin" /> Resetting…</>
                    : <><RotateCcw className="w-4 h-4" /> Reset {totals.orders} order{totals.orders === 1 ? '' : 's'}</>}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
