import React, { useState } from 'react'
import { Settings, Bell, Save, CheckCircle2, Clock, Database, Lock, ArrowRightLeft } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { DEFAULT_CURRENCY_LIMITS } from '../lib/currencyCheck'

/* General application settings. Currently holds the order-confirmation reminder
   time; built as a list of cards so more settings can be added over time. */
export default function AppSettingsPage() {
  const { appSettings, updateAppSettings } = useApp()
  const { hasRole } = useAuth()
  const isSuperAdmin = hasRole('super_admin')
  const canSetLimits = hasRole('super_admin', 'admin')
  const limits = { ...DEFAULT_CURRENCY_LIMITS, ...(appSettings.currencyLimits || {}) }

  /* Currency limits are edited as drafts and committed when the field is left,
     not on every keystroke: they are a company-wide setting, so typing "2000"
     would otherwise push 2, 20, 200 and 2000 to every signed-in user in turn.
     Blank and 0 both mean "no bound" on that side, which is how LBP is set up:
     checked from below only. */
  const [limitDraft, setLimitDraft] = useState({})   // { 'USD.max': '2000' }

  const commitLimit = (cur, side, raw) => {
    setLimitDraft(d => { const n = { ...d }; delete n[`${cur}.${side}`]; return n })
    const next = Math.max(0, Math.round(Number(raw) || 0))
    if (next === (Number(limits[cur]?.[side]) || 0)) return          // nothing changed
    updateAppSettings({
      currencyLimits: { ...limits, [cur]: { ...(limits[cur] || {}), [side]: next } },
    })
  }

  // Restriction: lock a local-market invoice once its order is saved (super admin).
  const lockInvoices = appSettings.lockSavedLocalInvoices !== false
  // Restriction: a saved payment can only be edited/deleted by whoever recorded it.
  const protectPayments = appSettings.protectOthersPayments === true

  // Order-confirmation reminder (minutes). Edited as a draft string so the field
  // can be cleared while typing; saved (clamped to a whole number ≥ 0) on Save.
  const [reminderMins, setReminderMins] = useState(
    String(appSettings.orderConfirmReminderMinutes ?? 15)
  )
  const [savedMsg, setSavedMsg] = useState('')

  // Minutes before an order's scheduled (start) time at which its row turns red
  // in the daily order list. Edited as a draft string like above.
  const [highlightMins, setHighlightMins] = useState(
    String(appSettings.highlightBeforeScheduledMinutes ?? 5)
  )
  const [highlightSavedMsg, setHighlightSavedMsg] = useState('')

  // How many days of orders the shared load pulls on login (0 = all). Lower = less
  // data downloaded; financial pages always pull the full history regardless.
  const [ordersWindow, setOrdersWindow] = useState(
    String(appSettings.ordersWindowDays ?? 90)
  )
  const [ordersWindowSavedMsg, setOrdersWindowSavedMsg] = useState('')

  const reminderDirty =
    String(appSettings.orderConfirmReminderMinutes ?? 15) !== reminderMins.trim()

  const highlightDirty =
    String(appSettings.highlightBeforeScheduledMinutes ?? 5) !== highlightMins.trim()

  const ordersWindowDirty =
    String(appSettings.ordersWindowDays ?? 90) !== ordersWindow.trim()

  function saveReminder() {
    const n = Math.max(0, Math.round(Number(reminderMins) || 0))
    updateAppSettings({ orderConfirmReminderMinutes: n })
    setReminderMins(String(n))
    setSavedMsg('Saved')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  function saveHighlight() {
    const n = Math.max(0, Math.round(Number(highlightMins) || 0))
    updateAppSettings({ highlightBeforeScheduledMinutes: n })
    setHighlightMins(String(n))
    setHighlightSavedMsg('Saved')
    setTimeout(() => setHighlightSavedMsg(''), 2000)
  }

  function saveOrdersWindow() {
    const n = Math.max(0, Math.round(Number(ordersWindow) || 0))
    updateAppSettings({ ordersWindowDays: n })
    setOrdersWindow(String(n))
    setOrdersWindowSavedMsg('Saved')
    setTimeout(() => setOrdersWindowSavedMsg(''), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Settings className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Settings</h1>
            <p className="text-xs text-slate-500 mt-0.5">Application preferences and behaviour</p>
          </div>
        </div>

        {/* Order confirmation reminder */}
        <div className="card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
              <Bell className="w-4 h-4 text-fuchsia-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Order confirmation reminder</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                When a newly-placed order stays unconfirmed for longer than this time,
                its row in the daily order list starts blinking to remind you to confirm it.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-[12rem]">
              <label className="label">Waiting time before blinking (minutes)</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={reminderMins}
                onChange={e => { setReminderMins(e.target.value); setSavedMsg('') }}
                onKeyDown={e => { if (e.key === 'Enter') saveReminder() }}
              />
            </div>
            <button
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={saveReminder}
              disabled={!reminderDirty}
            >
              <Save className="w-4 h-4" /> Save
            </button>
            {savedMsg && (
              <span className="text-xs text-green-400 flex items-center gap-1.5 pb-2.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {savedMsg}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Set to <span className="font-mono text-slate-400">0</span> to turn the blinking reminder off.
          </p>
        </div>

        {/* Highlight before scheduled time */}
        <div className="card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-red-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Highlight orders before their scheduled time</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                A reminder before pickup: when an active order's scheduled start time is
                this many minutes away, its row in the daily order list turns red — so you
                can see at a glance which orders are about to start.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-[12rem]">
              <label className="label">Highlight starts before scheduled time (minutes)</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={highlightMins}
                onChange={e => { setHighlightMins(e.target.value); setHighlightSavedMsg('') }}
                onKeyDown={e => { if (e.key === 'Enter') saveHighlight() }}
              />
            </div>
            <button
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={saveHighlight}
              disabled={!highlightDirty}
            >
              <Save className="w-4 h-4" /> Save
            </button>
            {highlightSavedMsg && (
              <span className="text-xs text-green-400 flex items-center gap-1.5 pb-2.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {highlightSavedMsg}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Example: <span className="font-mono text-slate-400">5</span> turns a row red 5 minutes before
            its scheduled time. Set to <span className="font-mono text-slate-400">0</span> to turn it off.
          </p>
        </div>

        {/* Recent-orders window (data usage) */}
        <div className="card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
              <Database className="w-4 h-4 text-sky-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Recent orders window (reduce data usage)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                On start-up the app loads only orders created or scheduled within this
                many days, which cuts the amount of data downloaded. Financial pages
                (Cashier Box, Credit Customers, Driver/Partner Dues, Reports) still load
                the full history automatically when you open them.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-[12rem]">
              <label className="label">Days of orders to load on start-up</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={ordersWindow}
                onChange={e => { setOrdersWindow(e.target.value); setOrdersWindowSavedMsg('') }}
                onKeyDown={e => { if (e.key === 'Enter') saveOrdersWindow() }}
              />
            </div>
            <button
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={saveOrdersWindow}
              disabled={!ordersWindowDirty}
            >
              <Save className="w-4 h-4" /> Save
            </button>
            {ordersWindowSavedMsg && (
              <span className="text-xs text-green-400 flex items-center gap-1.5 pb-2.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {ordersWindowSavedMsg}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Lower values download less data. Set to <span className="font-mono text-slate-400">0</span> to
            load the entire order history on start-up (the old behaviour). Takes effect on the next start-up
            or refresh.
          </p>
        </div>

        {/* Restriction — lock saved local-market invoices (super admin only) */}
        {isSuperAdmin && (
          <div className="card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                <Lock className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Restriction — lock saved local-market invoices</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  When <span className="text-slate-300 font-medium">on</span>, a local-market invoice becomes
                  read-only once the order is saved — it can no longer be edited or deleted, only new invoices
                  can be added. When <span className="text-slate-300 font-medium">off</span>, saved invoices
                  stay editable until the order is closed. A closed order always locks everything.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => updateAppSettings({ lockSavedLocalInvoices: !lockInvoices })}
              aria-pressed={lockInvoices}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                lockInvoices
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                  : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}
            >
              <Lock className="w-4 h-4" />
              Restriction is {lockInvoices ? 'ON' : 'OFF'}
            </button>

            <p className="text-[11px] text-slate-500">
              Only the super admin can change this. It is a company-wide policy — it applies to
              <span className="text-slate-400"> every signed-in user on any device or location</span>,
              and takes effect immediately.
            </p>
          </div>
        )}

        {/* Restriction — protect other users' payments (super admin only) */}
        {isSuperAdmin && (
          <div className="card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                <Lock className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Restriction — protect other users' payments</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  When <span className="text-slate-300 font-medium">on</span>, a saved payment can only be
                  edited or deleted by the user who recorded it — so a call-center user can't change or remove
                  a payment collected by a driver (or another user). Each user still manages their own
                  payments. When <span className="text-slate-300 font-medium">off</span>, anyone can edit or
                  delete any payment.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => updateAppSettings({ protectOthersPayments: !protectPayments })}
              aria-pressed={protectPayments}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                protectPayments
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                  : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}
            >
              <Lock className="w-4 h-4" />
              Restriction is {protectPayments ? 'ON' : 'OFF'}
            </button>

            <p className="text-[11px] text-slate-500">
              Only the super admin can change this. It is a company-wide policy — it applies to
              <span className="text-slate-400"> every signed-in user on any device or location</span>,
              and takes effect immediately.
            </p>
          </div>
        )}

        {/* ── Currency limits ───────────────────────────────────────────── */}
        {canSetLimits && (
          <div className="card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                <ArrowRightLeft className="w-4 h-4 text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-100">Currency limits</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  What a plausible amount looks like in each currency. An amount below the minimum, or above
                  the maximum, is flagged on the <span className="text-slate-300">Currency Check</span> page
                  and in the daily <span className="text-slate-300">Check orders</span> audit as probably
                  typed against the wrong currency. Nothing is ever blocked or corrected — it is only
                  pointed at.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-surface-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-hover/40 border-b border-surface-border">
                    <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">Currency</th>
                    <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">Minimum</th>
                    <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">Maximum</th>
                    <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">Reads as</th>
                  </tr>
                </thead>
                <tbody>
                  {['USD', 'LBP', 'EUR'].map(cur => {
                    const min = Number(limits[cur]?.min) || 0
                    const max = Number(limits[cur]?.max) || 0
                    return (
                      <tr key={cur} className="border-b border-surface-border/50 last:border-0">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-200">{cur}</td>
                        {['min', 'max'].map(side => {
                          const key = `${cur}.${side}`
                          const stored = side === 'min' ? min : max
                          return (
                            <td key={side} className="px-4 py-2">
                              <input type="number" min="0" step="1" className="input py-1.5 text-xs w-36"
                                placeholder={side === 'min' ? 'no minimum' : 'no maximum'}
                                value={limitDraft[key] ?? (stored || '')}
                                onChange={e => setLimitDraft(d => ({ ...d, [key]: e.target.value }))}
                                onBlur={e => commitLimit(cur, side, e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                            </td>
                          )
                        })}
                        <td className="px-4 py-2 text-[11px] text-slate-400">
                          {!min && !max ? <span className="text-slate-600">not checked</span>
                            : min && max ? `flag under ${min.toLocaleString()} or over ${max.toLocaleString()}`
                            : min ? `flag under ${min.toLocaleString()}`
                            : `flag over ${max.toLocaleString()}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-slate-500">
              Leave a box empty for no limit on that side — LBP normally needs only a minimum, USD only a
              maximum. Zero amounts are never flagged. This is a company-wide rule: it applies to
              <span className="text-slate-400"> every signed-in user</span>, immediately.
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
