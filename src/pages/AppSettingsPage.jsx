import React, { useEffect, useState } from 'react'
import { Settings, Bell, Save, CheckCircle2, Clock, Database, Lock, ArrowRightLeft, CalendarRange, BadgeDollarSign } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isStrictAdmin } from '../lib/roles'
import { DEFAULT_CURRENCY_LIMITS } from '../lib/currencyCheck'
import { PERIODS, DEFAULT_PERIOD, periodByKey, periodRange } from '../lib/currencyCheckPeriod'
import { fetchPriceFloors, setPriceFloor, setSalePrice, salePrice, fmtFloor, fmtPerPeriod, DEFAULT_FLOORS } from '../lib/subscriptionPrices'

/* General application settings. Currently holds the order-confirmation reminder
   time; built as a list of cards so more settings can be added over time. */
export default function AppSettingsPage() {
  const { appSettings, updateAppSettings } = useApp()
  const { hasRole, currentUser } = useAuth()
  const isSuperAdmin = hasRole('super_admin')
  /* Strict: a Senior Call Center user inherits admin elsewhere and is kept out
     of App Settings entirely. The route refuses too — this is the second lock
     so the settings are never read either. */
  const canSetLimits = isStrictAdmin(currentUser?.role)
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

  /* SUBSCRIPTION MINIMUMS (fix169). The super admin sets them; an admin reads
     them here, since every subscription an admin prices is held to them. They
     live in their own table, written only through a super-admin function — not
     in the shared settings row, which every client can write. */
  const [floors, setFloors]         = useState(DEFAULT_FLOORS)
  const [floorsReady, setFloorsReady] = useState(true)
  const [floorDraft, setFloorDraft] = useState({})            // { partner: '12' }
  const [floorMsg, setFloorMsg]     = useState({})            // { partner: { ok, text } }
  useEffect(() => {
    if (!canSetLimits) return
    fetchPriceFloors().then(r => { setFloors(r.floors); setFloorsReady(r.installed) })
  }, [canSetLimits])

  /* THE ADMIN'S PARTNER PRICE (fix172) — what every new partner login's
     one-year subscription is sold at. Admin and super admin set it, never under
     the minimum; the database refuses less. */
  const [saleDraft, setSaleDraft] = useState(undefined)
  const [saleMsg, setSaleMsg]     = useState(null)            // { ok, text }
  async function saveSale() {
    const amount = Math.round((Number(saleDraft) || 0) * 100) / 100
    const floor = Number(floors.partner.amount) || 0
    if (!(amount > 0)) { setSaleMsg({ ok: false, text: 'Enter a price.' }); return }
    if (amount < floor) { setSaleMsg({ ok: false, text: `It cannot be under the minimum of ${fmtPerPeriod(floors.partner)}.` }); return }
    const { row, error } = await setSalePrice(currentUser?.user_id, 'partner', amount)
    if (error) { setSaleMsg({ ok: false, text: error }); return }
    setFloors(f => ({ ...f, partner: { ...f.partner, ...(row || {}), sale_amount: Number(row?.sale_amount ?? amount) } }))
    setSaleDraft(undefined)
    setSaleMsg({ ok: true, text: 'Saved' })
    setTimeout(() => setSaleMsg(null), 2000)
  }

  async function saveFloor(role) {
    const raw = floorDraft[role]
    const amount = Math.round((Number(raw) || 0) * 100) / 100
    if (!(amount > 0)) { setFloorMsg(m => ({ ...m, [role]: { ok: false, text: 'Enter a price above 0.' } })); return }
    const { row, error } = await setPriceFloor(currentUser?.user_id, role, amount)
    if (error) { setFloorMsg(m => ({ ...m, [role]: { ok: false, text: error } })); return }
    setFloors(f => ({ ...f, [role]: { ...f[role], ...(row || {}), amount: Number(row?.amount ?? amount) } }))
    setFloorDraft(d => { const x = { ...d }; delete x[role]; return x })
    setFloorMsg(m => ({ ...m, [role]: { ok: true, text: 'Saved' } }))
    setTimeout(() => setFloorMsg(m => { const x = { ...m }; delete x[role]; return x }), 2000)
  }

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

        {/* How far back an admin may reopen a closed order (super admin only) */}
        {isSuperAdmin && (
          <div className="card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                <Lock className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Reopening a closed order — the administrators&rsquo; window</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  How many days after an order closes an <span className="text-slate-300 font-medium">administrator</span> may
                  reopen it and correct it. A wrong fee is usually spotted within a day or two by whoever entered it, and
                  having to fetch a super admin is how an order stays wrong. Set it to
                  <span className="text-slate-300 font-medium"> 0</span> and reopening is the super admin&rsquo;s alone again.
                </p>
                <p className="text-xs text-slate-500 mt-1.5">
                  Whatever the number, the order keeps its own record: who reopened it, and what the edit disturbed —
                  money already counted, stock already moved, a partner already credited. That record sits in a note
                  no administrator can write to.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input type="number" min="0" max="365" step="1"
                className="input w-28 text-sm"
                value={Number(appSettings.adminReopenDays) >= 0 ? Number(appSettings.adminReopenDays) : 0}
                onChange={e => {
                  const v = Math.max(0, Math.min(365, Math.floor(Number(e.target.value) || 0)))
                  updateAppSettings({ adminReopenDays: v })
                }} />
              <span className="text-sm text-slate-400">
                {Number(appSettings.adminReopenDays) > 0
                  ? `day${Number(appSettings.adminReopenDays) === 1 ? '' : 's'} — an admin may reopen an order closed within this window`
                  : 'days — super admin only'}
              </span>
            </div>

            <p className="text-[11px] text-slate-500">
              Only the super admin can change this. It is a company-wide policy — it applies to
              <span className="text-slate-400"> every signed-in user on any device or location</span>,
              and takes effect immediately.
            </p>
          </div>
        )}

        {/* Subscription minimums (super admin sets; admin reads) — fix169 */}
        {canSetLimits && (
          <div className="card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
                <BadgeDollarSign className="w-4 h-4 text-fuchsia-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Subscription prices — the minimums</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  The least a partner or supplier subscription may cost. An administrator prices each subscription
                  by hand and may charge more, but never less, never 0 and never empty. A new partner starts at the
                  partner minimum. Free partner seats and a supplier&rsquo;s free trial are not affected.
                </p>
              </div>
            </div>

            {!floorsReady && (
              <p className="text-[11px] text-amber-300">
                Not installed yet — run supabase-fix169.sql. Until then today&rsquo;s prices apply:
                partner {fmtPerPeriod(DEFAULT_FLOORS.partner)}, supplier {fmtPerPeriod(DEFAULT_FLOORS.supplier)}.
              </p>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              {['partner', 'supplier'].map(role => {
                const f = floors[role]
                const draft = floorDraft[role]
                const dirty = draft !== undefined && Number(draft) !== Number(f.amount)
                const msg = floorMsg[role]
                return (
                  <div key={role} className="rounded-lg border border-surface-border p-3 space-y-2">
                    <p className="text-xs font-medium text-slate-200 capitalize">{role} — per {f.period}</p>
                    {isSuperAdmin ? (
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <input type="number" min="0.01" step="0.01" className="input pr-14 text-sm"
                            disabled={!floorsReady} aria-label={`${role} minimum`}
                            value={draft ?? String(f.amount)}
                            onChange={e => setFloorDraft(d => ({ ...d, [role]: e.target.value }))} />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">{f.currency}</span>
                        </div>
                        <button type="button" onClick={() => saveFloor(role)} disabled={!dirty || !floorsReady}
                          className="btn-primary px-3 py-2 text-xs disabled:opacity-40">
                          <Save className="w-3.5 h-3.5" /> Save
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-100 tabular-nums">{fmtPerPeriod(f)}</p>
                    )}
                    {msg && (
                      <p className={`text-[11px] flex items-center gap-1 ${msg.ok ? 'text-green-400' : 'text-rose-300'}`}>
                        {msg.ok && <CheckCircle2 className="w-3 h-3" />}{msg.text}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="text-[11px] text-slate-500">
              {isSuperAdmin
                ? 'Only you can change these. The database holds every price an administrator sets to them; your own prices may go below.'
                : 'Set by the super admin. Every subscription you price is held to these.'}
            </p>
          </div>
        )}

        {/* The admin's own partner price (fix172) */}
        {canSetLimits && (
          <div className="card p-5 space-y-4" data-section="partner-price">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
                <BadgeDollarSign className="w-4 h-4 text-brand-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Partner subscription — your price</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  What a partner pays you for a year. Every portal login opened for a partner gets a one-year
                  subscription at this price, switched on at once. For each one the super admin is owed the
                  minimum ({fmtPerPeriod(floors.partner)}); anything above it is yours. It cannot be lower than the minimum.
                </p>
              </div>
            </div>
            {(() => {
              const floor = Number(floors.partner.amount) || 0
              const set = Number(floors.partner.sale_amount) || 0
              const value = saleDraft ?? String(set || floor)
              const dirty = saleDraft !== undefined && Number(saleDraft) !== (set || floor)
              const margin = Math.round(((Number(value) || 0) - floor) * 100) / 100
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 max-w-md">
                    <div className="relative flex-1">
                      <input type="number" min={floor} step="0.01" className="input pr-24 text-sm" aria-label="Your partner price"
                        disabled={!floorsReady} value={value}
                        onChange={e => { setSaleDraft(e.target.value); setSaleMsg(null) }} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">{floors.partner.currency} / year</span>
                    </div>
                    <button type="button" onClick={saveSale} disabled={!dirty || !floorsReady}
                      className="btn-primary px-3 py-2 text-xs disabled:opacity-40">
                      <Save className="w-3.5 h-3.5" /> Save
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {Number(value) >= floor
                      ? <>The super admin gets {fmtFloor(floor, floors.partner.currency)} of it; you keep <span className="text-slate-300">{fmtFloor(margin, floors.partner.currency)}</span> per subscription.</>
                      : <span className="text-rose-300">Below the minimum of {fmtPerPeriod(floors.partner)}.</span>}
                  </p>
                  {set > 0 && set < floor && (
                    <p className="text-[11px] text-amber-300">
                      The super admin has raised the minimum above your price — new subscriptions are charged the
                      minimum, {fmtFloor(salePrice('partner', floors), floors.partner.currency)}, until you set a new price.
                    </p>
                  )}
                  {!set && floorsReady && (
                    <p className="text-[11px] text-slate-500">Not set yet — new subscriptions are charged the minimum.</p>
                  )}
                  {saleMsg && (
                    <p className={`text-[11px] flex items-center gap-1 ${saleMsg.ok ? 'text-green-400' : 'text-rose-300'}`}>
                      {saleMsg.ok && <CheckCircle2 className="w-3 h-3" />}{saleMsg.text}
                    </p>
                  )}
                </div>
              )
            })()}
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

        {/* ── Currency check period ─────────────────────────────────────── */}
        {canSetLimits && (() => {
          const current = appSettings.currencyCheckPeriod || DEFAULT_PERIOD
          const range = periodRange(current)
          return (
            <div className="card p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
                  <CalendarRange className="w-4 h-4 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">Currency check period</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    How far back the <span className="text-slate-300">Currency Check</span> page reads. It used to
                    pull the entire order history before it could show anything — a wait that grows every month,
                    for a question that is nearly always about recent work. A shorter period opens faster; a
                    longer one catches a slip found late.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {PERIODS.map(p => {
                  const on = current === p.key
                  const r = periodRange(p.key)
                  return (
                    <button key={p.key} type="button"
                      onClick={() => updateAppSettings({ currencyCheckPeriod: p.key })}
                      className={`text-left rounded-lg border p-3 transition-colors ${
                        on ? 'border-brand-500/50 bg-brand-500/5' : 'border-surface-border hover:bg-surface-hover/40'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{p.label}</span>
                        {on && <CheckCircle2 className="w-3.5 h-3.5 text-brand-300 ml-auto" />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{p.note}</p>
                      <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                        {r.from} → {r.to} · {r.days} day{r.days === 1 ? '' : 's'}
                      </p>
                    </button>
                  )
                })}
              </div>

              <p className="text-[11px] text-slate-500">
                Currently reading <span className="text-slate-300">{periodByKey(current).label.toLowerCase()}</span> —
                {' '}{range.from} to {range.to}. Company-wide and immediate: it decides what “checked” means, so
                everyone looks at the same window. The page can still be narrowed by hand with its own date boxes.
              </p>
            </div>
          )
        })()}

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
