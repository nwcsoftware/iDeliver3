import React, { useState } from 'react'
import { Trash2, AlertTriangle, CheckCircle2, Loader } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* The exact word the user must type to arm the destructive reset. */
const CONFIRM_WORD = 'RESET'

/* Tables emptied / unlinked by reset_all_orders() — shown so the user knows
   exactly what will be wiped before they confirm. */
const WIPED = [
  'delivery_orders', 'order_items', 'order_external_items', 'order_services',
  'retail_goods_invoices', 'delivery_packages', 'order_tracking',
  'payment_collections', 'sales_invoices', 'driver_daily_settlements',
  'order-linked account_transactions',
]
const KEPT = [
  'contacts', 'vehicles', 'products', 'inventory', 'users', 'companies',
  'delivery_zones', 'POS', 'driver petty cash',
  'mileage logs & returnable issuances (order link cleared, records kept)',
]

export default function ResetOrdersPage() {
  const { fetchOrders } = useApp()
  const { hasRole } = useAuth()
  const isAdmin = hasRole('super_admin', 'admin')

  const [confirmText, setConfirmText] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [done,    setDone]    = useState(false)

  const armed = confirmText.trim().toUpperCase() === CONFIRM_WORD

  async function handleReset() {
    if (!armed || busy) return
    setBusy(true); setError(''); setDone(false)
    const { error } = await supabase.rpc('reset_all_orders')
    if (error) { setError(error.message); setBusy(false); return }
    await fetchOrders()
    setConfirmText(''); setDone(true); setBusy(false)
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
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-600/30 flex items-center justify-center">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Reset Data</h1>
            <p className="text-xs text-slate-500 mt-0.5">Clear all orders and related records</p>
          </div>
        </div>

        {/* Danger card */}
        <div className="card p-5 border-red-600/30 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-300 space-y-1">
              <p className="font-semibold text-red-300">This permanently deletes every order. It cannot be undone.</p>
              <p className="text-slate-400">Take a database backup/snapshot first if you're unsure.</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-red-300 uppercase tracking-wider mb-2">Emptied</p>
              <ul className="text-xs text-slate-400 space-y-1">
                {WIPED.map(t => <li key={t} className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-red-500" /> {t}
                </li>)}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-green-300 uppercase tracking-wider mb-2">Kept</p>
              <ul className="text-xs text-slate-400 space-y-1">
                {KEPT.map(t => <li key={t} className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-green-500" /> {t}
                </li>)}
              </ul>
            </div>
          </div>

          {/* Confirmation */}
          <div className="pt-1 space-y-2">
            <label className="label">Type <span className="font-mono text-red-300">{CONFIRM_WORD}</span> to confirm</label>
            <input
              className="input"
              value={confirmText}
              onChange={e => { setConfirmText(e.target.value); setDone(false); setError('') }}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
              disabled={busy}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </p>
          )}
          {done && (
            <p className="text-xs text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> All order data has been cleared.
            </p>
          )}

          <div className="flex justify-end pt-1">
            <button
              className="btn-primary !bg-red-600 hover:!bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleReset}
              disabled={!armed || busy}>
              {busy
                ? <><Loader className="w-4 h-4 animate-spin" /> Resetting…</>
                : <><Trash2 className="w-4 h-4" /> Reset all orders</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
