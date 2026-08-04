import React, { useMemo, useState } from 'react'
import { CalendarRange, AlertTriangle, CheckCircle2, Loader, X, Trash2, CheckSquare, Square } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* The exact word the user must type to arm the deletion. */
const CONFIRM_WORD = 'Confirmed'

/* Per-order related-record categories summed into the "Will be deleted" panel
   (jsonb key on each order row → label). */
const COUNT_KEYS = [
  ['items',    'Local items'],
  ['services', 'Services'],
  ['packages', 'Packages'],
  ['retail',   'External retails'],
  ['payments', 'Payments'],
]

const todayStr = () => new Date().toISOString().slice(0, 10)
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '—')

export default function DeleteOrdersRangePage() {
  const { fetchOrders } = useApp()
  const { currentUser, hasRole } = useAuth()
  // Permanently removing data is restricted to the super_admin (the developer).
  const isAdmin = hasRole('super_admin')

  const [from,        setFrom]        = useState(todayStr())
  const [to,          setTo]          = useState(todayStr())
  const [orders,      setOrders]      = useState(null)   // array of matched orders (null = not previewed)
  const [selected,    setSelected]    = useState(() => new Set())
  const [checking,    setChecking]    = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState('')
  const [done,        setDone]        = useState('')

  const armed        = confirmText.trim().toLowerCase() === CONFIRM_WORD.toLowerCase()
  const rangeInvalid = !from || !to || from > to

  function reset() {
    setOrders(null); setSelected(new Set()); setConfirmText(''); setError('')
  }
  function onRangeChange(setter, v) {
    setter(v); reset(); setDone('')
  }

  function friendlyError(msg) {
    if (/DATE_RANGE_REQUIRED/.test(msg)) return 'Please choose both a start and an end date.'
    if (/DATE_RANGE_INVALID/.test(msg))  return 'The start date must be on or before the end date.'
    if (/NO_ORDERS_SELECTED/.test(msg))  return 'Select at least one order to delete.'
    return msg
  }

  async function runPreview() {
    if (rangeInvalid || checking) return
    setChecking(true); setError(''); setDone(''); setOrders(null)
    const { data, error: e } = await supabase.rpc('preview_orders_delete_range', {
      p_from: from, p_to: to,
    })
    if (e) { setError(friendlyError(e.message)); setChecking(false); return }
    const list = Array.isArray(data) ? data : []
    setOrders(list)
    // Every matched order starts selected — the admin unticks the ones to keep.
    setSelected(new Set(list.map(o => o.id)))
    setConfirmText(''); setChecking(false)
  }

  const allSelected = orders && orders.length > 0 && orders.every(o => selected.has(o.id))

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set((orders || []).map(o => o.id)))
  }

  // Totals across the currently-selected orders only.
  const totals = useMemo(() => {
    const t = { orders: 0, items: 0, services: 0, packages: 0, retail: 0, payments: 0 }
    for (const o of orders || []) {
      if (!selected.has(o.id)) continue
      t.orders += 1
      for (const [k] of COUNT_KEYS) t[k] += Number(o[k]) || 0
    }
    return t
  }, [orders, selected])

  async function handleDelete() {
    if (!armed || busy || totals.orders === 0) return
    const ids = (orders || []).filter(o => selected.has(o.id)).map(o => o.id)
    setBusy(true); setError(''); setDone('')
    const { data, error: e } = await supabase.rpc('delete_orders_by_ids', {
      p_ids: ids, p_user_id: currentUser?.user_id || null,
    })
    if (e) { setError(friendlyError(e.message)); setBusy(false); return }
    await fetchOrders()
    const n = data?.orders ?? ids.length
    setDone(`${n} order${n === 1 ? '' : 's'} were permanently deleted.`)
    reset(); setBusy(false)
  }

  if (!isAdmin) {
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
            <CalendarRange className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Delete Orders by Date</h1>
            <p className="text-xs text-slate-500 mt-0.5">Permanently remove selected orders (and all their data) scheduled in a date range</p>
          </div>
        </div>

        {/* Step 1 — pick the range */}
        <div className="card p-5 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">From (scheduled date)</label>
              <input type="date" className="input" value={from}
                onChange={e => onRangeChange(setFrom, e.target.value)} disabled={busy} />
            </div>
            <div>
              <label className="label">To (scheduled date)</label>
              <input type="date" className="input" value={to}
                onChange={e => onRangeChange(setTo, e.target.value)} disabled={busy} />
            </div>
          </div>

          {/* Inclusive-range warning — always visible so the admin never mis-reads it. */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Both the <span className="font-semibold">start date ({from || '—'})</span> and the{' '}
              <span className="font-semibold">end date ({to || '—'})</span> are <span className="font-semibold">included</span> in the
              list — every order scheduled on those two days, and all days between them, is shown below (all ticked by default).
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            {rangeInvalid && from && to && (
              <span className="text-xs text-red-400 mr-auto flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Start date must be on or before the end date.
              </span>
            )}
            <button className="btn-primary" onClick={runPreview} disabled={rangeInvalid || checking || busy}>
              {checking ? <><Loader className="w-4 h-4 animate-spin" /> Checking…</> : <>Preview orders</>}
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

        {/* Step 2 — order list + confirmation */}
        {orders && (
          orders.length === 0 ? (
            <div className="card p-5 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-300">
                No orders are scheduled between <span className="text-slate-100 font-medium">{from}</span> and{' '}
                <span className="text-slate-100 font-medium">{to}</span> (inclusive). Nothing to delete.
              </p>
            </div>
          ) : (
            <div className="card p-5 border-red-600/30 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-slate-300 space-y-1">
                  <p className="font-semibold text-red-300">
                    {totals.orders} of {orders.length} order{orders.length === 1 ? '' : 's'} selected for permanent deletion
                    ({from} → {to}, both days included). This cannot be undone.
                  </p>
                  <p className="text-slate-400">Untick any order you want to keep. Every record of the ticked orders is removed for good.</p>
                </div>
              </div>

              {/* Order list */}
              <div className="rounded-lg border border-surface-border overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border bg-surface-card/60">
                  <button onClick={toggleAll} disabled={busy}
                    className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-slate-100 disabled:opacity-40">
                    {allSelected ? <CheckSquare className="w-4 h-4 text-red-400" /> : <Square className="w-4 h-4" />}
                    {allSelected ? 'Unselect all' : 'Select all'}
                  </button>
                  <span className="text-xs text-slate-500">{totals.orders} selected</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-surface-border">
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Order #</th>
                        <th className="px-3 py-2">Recipient</th>
                        <th className="px-3 py-2">Customer</th>
                        <th className="px-3 py-2 text-right">Related</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => {
                        const on = selected.has(o.id)
                        const related = COUNT_KEYS.reduce((s, [k]) => s + (Number(o[k]) || 0), 0)
                        return (
                          <tr key={o.id}
                            onClick={() => !busy && toggle(o.id)}
                            className={`border-b border-surface-border/50 cursor-pointer transition-colors ${on ? 'bg-red-500/5' : 'hover:bg-surface-hover/40'}`}>
                            <td className="px-3 py-2">
                              {on ? <CheckSquare className="w-4 h-4 text-red-400" /> : <Square className="w-4 h-4 text-slate-600" />}
                            </td>
                            <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">{dateOnly(o.scheduled_date)}</td>
                            <td className="px-3 py-2 font-mono text-brand-400 text-xs whitespace-nowrap">{o.order_number}</td>
                            <td className="px-3 py-2 text-slate-300 text-xs truncate max-w-[10rem]">{o.recipient_name || '—'}</td>
                            <td className="px-3 py-2 text-slate-400 text-xs truncate max-w-[10rem]">{o.customer || '—'}</td>
                            <td className="px-3 py-2 text-right text-xs text-slate-500 tabular-nums">
                              {related > 0 ? `${related} record${related === 1 ? '' : 's'}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* What will be removed (across the selected orders) */}
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-[11px] text-red-300 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
                  <Trash2 className="w-3.5 h-3.5" /> Will be deleted (selected orders)
                </p>
                <ul className="grid sm:grid-cols-3 gap-x-6 gap-y-1">
                  <li className="flex items-center justify-between text-xs text-slate-300">
                    <span>Orders</span><span className="font-mono text-red-300">{totals.orders} ✕</span>
                  </li>
                  {COUNT_KEYS.map(([key, label]) => (
                    <li key={key} className="flex items-center justify-between text-xs text-slate-300">
                      <span>{label}</span><span className="font-mono text-red-300">{totals[key]} ✕</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-500 mt-2">
                  Plus order tracking, settlement &amp; sales-invoice links and order ledger entries. Returnable issuances and
                  mileage logs are kept but unlinked. A summary is written to the audit log.
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
                  onClick={handleDelete}
                  disabled={!armed || busy || totals.orders === 0}>
                  {busy
                    ? <><Loader className="w-4 h-4 animate-spin" /> Deleting…</>
                    : <><Trash2 className="w-4 h-4" /> Delete {totals.orders} order{totals.orders === 1 ? '' : 's'} permanently</>}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
