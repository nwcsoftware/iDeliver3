import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { OrderNumber } from '../components/orders/OrderQuickView'
import { Wallet, AlertTriangle, CheckCircle2, Loader, X, EyeOff, RotateCcw, Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* Money-movement categories the Cashier Box reads (jsonb key → label), shown so
   the admin sees exactly what a reset will HIDE (nothing is deleted). */
const COUNT_KEYS = [
  ['payments', 'Payments (IN)'],
  ['retail',   'Retail invoices (OUT)'],
  ['packages', 'Delivery packages (OUT)'],
  ['services', 'Order services (OUT)'],
]

const todayStr = () => new Date().toISOString().slice(0, 10)
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '—')

/* Super-admin tool — reset the Daily Cashier Box "as of" a date by HIDING every
   movement dated (by close date) on or before it. It writes a reversible
   checkpoint (cashier_box_resets); orders, payments and driver settlements are
   never touched, and removing the checkpoint brings the movements back. */
export default function CashierBoxResetPage() {
  const { COMPANY_ID } = useApp()
  const { currentUser, hasRole } = useAuth()
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || null
  const isSuperAdmin = hasRole('super_admin')

  const [through,   setThrough]   = useState(todayStr())
  const [checkpoints, setCheckpoints] = useState([])   // existing reset rows (newest first)
  const [orders,    setOrders]    = useState(null)      // preview: affected closed orders (null = not previewed)
  const [checking,  setChecking]  = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [done,      setDone]      = useState('')

  const fetchCheckpoints = useCallback(async () => {
    let q = supabase.from('cashier_box_resets').select('*').order('reset_through', { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setCheckpoints(data ?? [])
  }, [COMPANY_ID])

  useEffect(() => { if (isSuperAdmin) fetchCheckpoints() }, [isSuperAdmin, fetchCheckpoints])

  // The active checkpoint = the latest reset_through.
  const activeThrough = checkpoints[0]?.reset_through ? dateOnly(checkpoints[0].reset_through) : null

  function clearPreview() { setOrders(null); setError('') }
  function onDateChange(v) { setThrough(v); clearPreview(); setDone('') }

  async function runPreview() {
    if (!through || checking) return
    setChecking(true); setError(''); setDone(''); setOrders(null)
    const { data, error: e } = await supabase.rpc('preview_cashier_box_reset', { p_through: through })
    if (e) { setError(/DATE_REQUIRED/.test(e.message) ? 'Please choose an "as of" date.' : e.message); setChecking(false); return }
    setOrders(Array.isArray(data) ? data : [])
    setChecking(false)
  }

  const totals = useMemo(() => {
    const t = { orders: 0, payments: 0, retail: 0, packages: 0, services: 0 }
    for (const o of orders || []) {
      t.orders += 1
      for (const [k] of COUNT_KEYS) t[k] += Number(o[k]) || 0
    }
    return t
  }, [orders])

  async function applyReset() {
    if (!through || busy) return
    setBusy(true); setError(''); setDone('')
    const { error: e } = await supabase.from('cashier_box_resets').insert([{
      reset_through:   through,
      created_by:      currentUser?.user_id || null,
      created_by_name: currentUserName,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }])
    if (e) { setError(e.message); setBusy(false); return }
    setDone(`Cashier Box reset applied as of ${through}. Those movements are now hidden from the box (nothing was deleted).`)
    clearPreview()
    await fetchCheckpoints()
    setBusy(false)
  }

  async function removeCheckpoint(id) {
    if (busy) return
    setBusy(true); setError(''); setDone('')
    const { error: e } = await supabase.from('cashier_box_resets').delete().eq('id', id)
    if (e) { setError(e.message); setBusy(false); return }
    setDone('Reset removed — the hidden movements are back in the Cashier Box.')
    await fetchCheckpoints()
    setBusy(false)
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
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Reset Cashier Box</h1>
            <p className="text-xs text-slate-500 mt-0.5">Hide the Daily Cashier Box movements up to a chosen date — orders, payments &amp; driver settlements are never touched</p>
          </div>
        </div>

        {/* Explanation */}
        <div className="flex items-start gap-2 rounded-lg border border-brand-600/25 bg-brand-600/5 px-3 py-2.5 text-xs text-slate-300">
          <EyeOff className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-brand-400" />
          <span>
            The Cashier Box has no data of its own — it's computed from the orders' payments and costs. A reset simply
            <span className="text-slate-100 font-medium"> hides</span> every movement whose close date is on or before the
            chosen date, so the box reads clean from that day back. <span className="text-slate-100 font-medium">Nothing is
            deleted</span> and it's fully reversible — orders, payments and driver settlements stay exactly as they are.
          </span>
        </div>

        {/* Active resets */}
        {checkpoints.length > 0 && (
          <div className="card p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-200">Active resets</p>
            {activeThrough && (
              <p className="text-xs text-amber-300 flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5" /> Box is currently hidden through <span className="font-semibold">{activeThrough}</span>.
              </p>
            )}
            <div className="rounded-lg border border-surface-border divide-y divide-surface-border/60">
              {checkpoints.map(cp => (
                <div key={cp.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="text-slate-300">
                    Reset as of <span className="font-semibold text-slate-100">{dateOnly(cp.reset_through)}</span>
                    <span className="text-slate-500">
                      {cp.created_by_name ? ` · by ${cp.created_by_name}` : ''}{cp.created_at ? ` · ${dateOnly(cp.created_at)}` : ''}
                    </span>
                  </div>
                  <button onClick={() => removeCheckpoint(cp.id)} disabled={busy}
                    className="btn-ghost text-xs text-slate-400 hover:text-slate-100 disabled:opacity-40">
                    <Undo2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 1 — pick the "as of" date */}
        <div className="card p-5 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Reset box as of (close date)</label>
              <input type="date" className="input" value={through}
                onChange={e => onDateChange(e.target.value)} disabled={busy} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button className="btn-ghost text-xs border border-surface-border rounded-lg" onClick={runPreview} disabled={!through || checking || busy}>
              {checking ? <><Loader className="w-4 h-4 animate-spin" /> Checking…</> : <>Preview affected</>}
            </button>
            <button className="btn-primary" onClick={applyReset} disabled={!through || busy}>
              {busy ? <><Loader className="w-4 h-4 animate-spin" /> Applying…</> : <><EyeOff className="w-4 h-4" /> Reset box as of {through || '…'}</>}
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

        {/* Optional preview — what will be hidden */}
        {orders && (
          orders.length === 0 ? (
            <div className="card p-5 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-300">
                No closed orders were closed on or before <span className="text-slate-100 font-medium">{through}</span> —
                the box has nothing to hide for that period.
              </p>
            </div>
          ) : (
            <div className="card p-5 space-y-4">
              <div className="flex items-start gap-3">
                <EyeOff className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-slate-300 space-y-1">
                  <p className="font-semibold text-slate-100">
                    {totals.orders} closed order{totals.orders === 1 ? '' : 's'} (closed on or before {through}) would be hidden from the Cashier Box.
                  </p>
                  <p className="text-slate-400">These records stay in the system — only the box view hides them.</p>
                </div>
              </div>

              {/* Affected order list */}
              <div className="rounded-lg border border-surface-border overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
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
                            <td className="px-3 py-2 text-xs whitespace-nowrap"><OrderNumber value={o.order_number} id={o.id} className="text-xs" /></td>
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

              {/* Totals of what gets hidden */}
              <div className="rounded-lg border border-surface-border bg-surface-hover/20 p-3">
                <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
                  <RotateCcw className="w-3.5 h-3.5" /> Hidden from the box
                </p>
                <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                  {COUNT_KEYS.map(([key, label]) => (
                    <li key={key} className="flex items-center justify-between text-xs text-slate-300">
                      <span>{label}</span><span className="font-mono text-slate-400">{totals[key]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button className="btn-ghost text-slate-400 hover:text-slate-100" onClick={clearPreview} disabled={busy}>
                  <X className="w-4 h-4" /> Close preview
                </button>
                <button className="btn-primary" onClick={applyReset} disabled={busy}>
                  {busy ? <><Loader className="w-4 h-4 animate-spin" /> Applying…</> : <><EyeOff className="w-4 h-4" /> Reset box as of {through}</>}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
