import React, { useEffect, useState } from 'react'
import { Settings, Bell, Save, CheckCircle2, Clock, Database, Lock, ArrowRightLeft, CalendarRange, BadgeDollarSign } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isStrictAdmin } from '../lib/roles'
import { DEFAULT_CURRENCY_LIMITS } from '../lib/currencyCheck'
import { PERIODS, DEFAULT_PERIOD, periodByKey, periodRange } from '../lib/currencyCheckPeriod'
import { fetchPriceFloors, setPriceFloor, setSalePrice, salePrice, planPrice, fmtFloor, fmtPerPeriod, DEFAULT_FLOORS } from '../lib/subscriptionPrices'
import { fetchSeatSettings, setSeat } from '../lib/seatSettings'
import { SEATS, SUPPLIER_SUBSCRIPTION } from '../lib/billing'
import { TRIAL_DAYS } from '../lib/subscriptions'
import { fetchSoftwareSubscriptions, saveSoftwareSubscription, paymentSummary } from '../lib/softwareSubscriptions'

/* General application settings. Currently holds the order-confirmation reminder
   time; built as a list of cards so more settings can be added over time. */
export default function AppSettingsPage() {
  const { appSettings, updateAppSettings, COMPANY_ID } = useApp()
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

  /* SUBSCRIPTION SETTINGS — one section, one row per kind. Every figure is
     stored once, so no two places can show a different price:

       super admin's price  partners per year, suppliers per month — the
                            minimum (subscription_price_floors, fix169);
                            office seats and drivers per extra seat a year
                            (seat_settings.extra_rate, fix174)
       selling price        partners only — what the partner pays
                            (subscription_price_floors.sale_amount, fix172)
       free seats           seat_settings.included (fix174)
       software fee         the Software Subscriptions record itself, so the
                            licence reminder in the header reads the same one

     The super admin edits all of it. An admin edits only the partner selling
     price, never under the super admin's price; the database refuses less. */
  const [floors, setFloors]           = useState(DEFAULT_FLOORS)
  const [floorsReady, setFloorsReady] = useState(true)
  const [seats, setSeats]             = useState(SEATS)
  const [seatsReady, setSeatsReady]   = useState(true)
  const [software, setSoftware]       = useState([])
  const [draft, setDraft]             = useState({})          // { 'partner.sale': '15', 'driver.rate': '20', 'sw.<id>': '650' }
  const [rowMsg, setRowMsg]           = useState({})          // { partner: { ok, text } }
  const [rowBusy, setRowBusy]         = useState('')
  useEffect(() => {
    if (!canSetLimits) return
    fetchPriceFloors().then(r => { setFloors(r.floors); setFloorsReady(r.installed) })
    fetchSeatSettings().then(r => { setSeats(r.seats); setSeatsReady(r.installed) })
    fetchSoftwareSubscriptions(COMPANY_ID).then(r =>
      setSoftware((r.rows || []).filter(x => x.is_active !== false && x.billing_cycle === 'annual')))
  }, [canSetLimits, COMPANY_ID])

  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const valueOf = (key, current) => draft[key] ?? String(current ?? '')
  const changed = (key, current) => draft[key] !== undefined && String(draft[key]).trim() !== String(current ?? '')
                                  && Number(draft[key]) !== Number(current)
  const edit = (row, key, v) => {
    setDraft(d => ({ ...d, [key]: v }))
    setRowMsg(m => { const y = { ...m }; delete y[row]; return y })
  }

  /* One row's changes, saved together — each through its own guarded function. */
  async function saveRow(row) {
    const uid = currentUser?.user_id
    const errs = []
    setRowBusy(row)
    let nextFloors = floors

    // The super admin's price for partners (a year) or suppliers (a month).
    if ((row === 'partner' || row === 'supplier') && isSuperAdmin && changed(`${row}.floor`, floors[row].amount)) {
      const amount = r2(draft[`${row}.floor`])
      if (!(amount > 0)) errs.push('Enter the super admin’s price.')
      else {
        const { row: saved, error } = await setPriceFloor(uid, row, amount)
        if (error) errs.push(error)
        else nextFloors = { ...nextFloors, [row]: { ...nextFloors[row], ...(saved || {}), amount: Number(saved?.amount ?? amount) } }
      }
    }
    // The partner selling price — never under the super admin's price.
    if (row === 'partner' && changed('partner.sale', salePrice('partner', floors))) {
      const amount = r2(draft['partner.sale'])
      const floor = Number(nextFloors.partner.amount) || 0
      if (!(amount > 0)) errs.push('Enter the selling price.')
      else if (amount < floor) errs.push(`The selling price cannot be under the super admin’s price of ${fmtPerPeriod(nextFloors.partner)}.`)
      else {
        const { row: saved, error } = await setSalePrice(uid, 'partner', amount)
        if (error) errs.push(error)
        else nextFloors = { ...nextFloors, partner: { ...nextFloors.partner, sale_amount: Number(saved?.sale_amount ?? amount) } }
      }
    }
    setFloors(nextFloors)

    // Free seats, and the price of each seat beyond them.
    if (['partner', 'admin', 'call_center', 'driver'].includes(row) && isSuperAdmin) {
      const cur = seats[row]
      if (changed(`${row}.included`, cur.included) || (row !== 'partner' && changed(`${row}.rate`, cur.extraRate))) {
        const included = draft[`${row}.included`] ?? cur.included
        const rate = draft[`${row}.rate`] ?? cur.extraRate
        if (String(included).trim() === '' || !(Number(included) >= 0)) errs.push('Enter the number of free seats.')
        else if (row !== 'partner' && !(Number(rate) > 0)) errs.push('Enter the super admin’s price.')
        else {
          const { row: saved, error } = await setSeat(uid, row, Math.floor(Number(included)), Number(rate) || 0)
          if (error) errs.push(error)
          else setSeats(sx => ({ ...sx, [row]: { ...sx[row], included: Number(saved?.included ?? included),
            extraRate: row === 'partner' ? sx[row].extraRate : Number(saved?.extra_rate ?? rate) } }))
        }
      }
    }

    // The yearly software fee, on its Software Subscriptions record.
    if (row.startsWith('sw.') && isSuperAdmin) {
      const rec = software.find(x => `sw.${x.id}` === row)
      if (rec && changed(row, rec.amount)) {
        const amount = r2(draft[row])
        if (!(amount > 0)) errs.push('Enter the yearly fee.')
        else {
          const err = await saveSoftwareSubscription({ ...rec, amount }, { companyId: COMPANY_ID, userId: uid ?? null })
          if (err) errs.push(err)
          else setSoftware(list => list.map(x => (x.id === rec.id ? { ...x, amount } : x)))
        }
      }
    }

    setRowBusy('')
    if (errs.length) { setRowMsg(m => ({ ...m, [row]: { ok: false, text: errs.join(' ') } })); return }
    setDraft(d => Object.fromEntries(Object.entries(d).filter(([k]) => !(k === row || k.startsWith(row + '.')))))
    setRowMsg(m => ({ ...m, [row]: { ok: true, text: 'Saved' } }))
    setTimeout(() => setRowMsg(m => { const y = { ...m }; delete y[row]; return y }), 2000)
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

        {/* Subscription settings — every price, free seat and the software fee,
            one row per kind (fix169 / fix172 / fix174) */}
        {canSetLimits && (() => {
          const cur = (c) => c || 'USD'
          const pFloor = Number(floors.partner.amount) || 0
          const pSale  = Number(valueOf('partner.sale', salePrice('partner', floors))) || 0
          const pFloorNow = Number(valueOf('partner.floor', floors.partner.amount)) || 0
          const keeps = Math.round((pSale - pFloorNow) * 100) / 100
          const numberIn = (key, current, label, { min = '0', step = '1', unit = '', width = 'w-14', disabled = false } = {}) => (
            <div className={`relative ${width}`}>
              <input type="number" min={min} step={step} aria-label={label} disabled={disabled}
                className={`input py-1.5 px-2 text-sm ${unit ? 'pr-9' : ''}`} value={valueOf(key, current)}
                onChange={e => edit(key.split('.')[0] === 'sw' ? key : key.split('.')[0], key, e.target.value)} />
              {unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">{unit}</span>}
            </div>
          )
          const text = (v) => <span className="text-sm text-slate-100 tabular-nums whitespace-nowrap">{v}</span>
          const none = <span className="text-slate-600">—</span>
          const saveCell = (row, dirty) => (
            <td className="px-2 py-2 text-right">
              {rowMsg[row] && <span className={`block text-[11px] mb-1 ${rowMsg[row].ok ? 'text-green-400' : 'text-rose-300'}`}>{rowMsg[row].text}</span>}
              <button type="button" onClick={() => saveRow(row)} disabled={!dirty || rowBusy === row} title="Save this row"
                className="btn-primary p-2 text-xs disabled:opacity-40">
                <Save className="w-3.5 h-3.5" /><span className="sr-only">Save</span>
              </button>
            </td>
          )
          const seatRows = [
            { family: 'admin',       label: 'Administrators' },
            { family: 'call_center', label: 'Call centre & Senior Call Center' },
            { family: 'driver',      label: 'Drivers' },
          ]
          return (
            <div className="card p-5 space-y-4" data-section="subscription-settings">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
                  <BadgeDollarSign className="w-4 h-4 text-fuchsia-300" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Subscription settings</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Every subscription price in one place. The <span className="text-slate-300">super admin&rsquo;s price</span> is
                    what the office owes the super admin; for partners, the <span className="text-slate-300">selling price</span> is
                    what the partner pays, and the office keeps the difference. Seats beyond the free ones are charged when the
                    account or driver is added. {isSuperAdmin
                      ? 'You can change everything here.'
                      : 'Set by the super admin — you set the partner selling price, never below the super admin’s price.'}
                  </p>
                </div>
              </div>
              {(!floorsReady || !seatsReady) && (
                <p className="text-[11px] text-amber-300">
                  {!floorsReady && 'Prices need supabase-fix169.sql. '}{!seatsReady && 'Seats need supabase-fix174.sql. '}
                  Until then the package&rsquo;s figures apply.
                </p>
              )}

              <div className="rounded-lg border border-surface-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-border text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-2 py-2">Kind</th>
                      <th className="px-2 py-2">Free</th>
                      <th className="px-2 py-2">Super admin price</th>
                      <th className="px-2 py-2">Selling price</th>
                      <th className="px-2 py-2">Office keeps</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* Partners: all three numbers, each in its own column. */}
                    <tr className="border-b border-surface-border/50" data-row="partner">
                      <td className="px-2 py-2 text-xs text-slate-200">Partners<p className="text-[10px] text-slate-500">per year</p></td>
                      <td className="px-2 py-2">{isSuperAdmin ? numberIn('partner.included', seats.partner.included, 'Partners free seats', { disabled: !seatsReady }) : text(seats.partner.included)}</td>
                      <td className="px-2 py-2">{isSuperAdmin
                        ? numberIn('partner.floor', floors.partner.amount, 'Partners super admin price', { min: '0.01', step: '0.01', unit: cur(floors.partner.currency), width: 'w-24', disabled: !floorsReady })
                        : text(fmtFloor(pFloor, cur(floors.partner.currency)))}</td>
                      <td className="px-2 py-2">{numberIn('partner.sale', salePrice('partner', floors), 'Partners selling price',
                        { min: String(pFloorNow || 0.01), step: '0.01', unit: cur(floors.partner.currency), width: 'w-24', disabled: !floorsReady })}</td>
                      <td className={`px-2 py-2 text-sm tabular-nums whitespace-nowrap ${keeps < 0 ? 'text-rose-300' : 'text-brand-300'}`}>
                        {keeps < 0 ? 'below the super admin’s price' : fmtFloor(keeps, cur(floors.partner.currency))}
                      </td>
                      {saveCell('partner', changed('partner.sale', salePrice('partner', floors))
                        || (isSuperAdmin && (changed('partner.floor', floors.partner.amount) || changed('partner.included', seats.partner.included))))}
                    </tr>

                    {/* Suppliers: a free trial, then a monthly plan never under the minimum. */}
                    <tr className="border-b border-surface-border/50" data-row="supplier">
                      <td className="px-2 py-2 text-xs text-slate-200">Suppliers<p className="text-[10px] text-slate-500">per month</p></td>
                      <td className="px-2 py-2 text-[11px] text-slate-400">{TRIAL_DAYS}-day trial</td>
                      <td className="px-2 py-2">{isSuperAdmin
                        ? numberIn('supplier.floor', floors.supplier.amount, 'Suppliers super admin price', { min: '0.01', step: '0.01', unit: cur(floors.supplier.currency), width: 'w-24', disabled: !floorsReady })
                        : text(fmtFloor(floors.supplier.amount, cur(floors.supplier.currency)))}</td>
                      <td className="px-2 py-2 text-[11px] text-slate-500 whitespace-nowrap"
                        title={SUPPLIER_SUBSCRIPTION.plans.map(pl => `${pl.name} ${planPrice(pl, floors)} a month`).join(' · ')}>
                        plans {SUPPLIER_SUBSCRIPTION.plans.map(pl => planPrice(pl, floors)).join(' · ')}
                      </td>
                      <td className="px-2 py-2">{none}</td>
                      {isSuperAdmin ? saveCell('supplier', changed('supplier.floor', floors.supplier.amount)) : <td />}
                    </tr>

                    {/* Office seats and drivers: free seats, then a yearly price per seat. */}
                    {seatRows.map(({ family, label }) => (
                      <tr key={family} className="border-b border-surface-border/50" data-row={family}>
                        <td className="px-2 py-2 text-xs text-slate-200">{label}<p className="text-[10px] text-slate-500">per extra seat, a year</p></td>
                        <td className="px-2 py-2">{isSuperAdmin ? numberIn(`${family}.included`, seats[family].included, `${label} free seats`, { disabled: !seatsReady }) : text(seats[family].included)}</td>
                        <td className="px-2 py-2">{isSuperAdmin
                          ? numberIn(`${family}.rate`, seats[family].extraRate, `${label} super admin price`, { min: '0.01', step: '0.01', unit: cur(seats[family].currency), width: 'w-24', disabled: !seatsReady })
                          : text(fmtFloor(seats[family].extraRate, cur(seats[family].currency)))}</td>
                        <td className="px-2 py-2">{none}</td>
                        <td className="px-2 py-2">{none}</td>
                        {isSuperAdmin ? saveCell(family, changed(`${family}.included`, seats[family].included) || changed(`${family}.rate`, seats[family].extraRate)) : <td />}
                      </tr>
                    ))}

                    {/* The yearly software fee: the Software Subscriptions record. */}
                    {software.map(rec => {
                      const pay = paymentSummary(rec)
                      const covered = !!pay.coveredUntil && String(pay.coveredUntil) >= String(rec.expiry_date || '')
                      const key = `sw.${rec.id}`
                      return (
                        <tr key={rec.id} data-row={key}>
                          <td className="px-2 py-2 text-xs text-slate-200">
                            Software<p className="text-[10px] text-slate-500">per year</p>
                            <p className="text-[10px] text-slate-500 truncate max-w-[9rem]" title={rec.software_name}>{rec.software_name}</p>
                          </td>
                          <td className="px-2 py-2">
                            <span className={`text-[10px] border rounded px-1.5 py-0.5 whitespace-nowrap ${covered
                              ? 'bg-green-500/10 text-green-300 border-green-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
                              {pay.coveredUntil ? `Paid to ${pay.coveredUntil}` : 'Not paid'}
                            </span>
                          </td>
                          <td className="px-2 py-2">{isSuperAdmin
                            ? numberIn(key, rec.amount, 'Yearly software fee', { min: '0.01', step: '0.01', unit: cur(rec.currency), width: 'w-24' })
                            : text(fmtFloor(rec.amount, cur(rec.currency)))}</td>
                          <td className="px-2 py-2">{none}</td>
                          <td className="px-2 py-2">{none}</td>
                          {isSuperAdmin ? saveCell(key, changed(key, rec.amount)) : <td />}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">
                Changing a price applies to subscriptions opened from then on; existing ones keep what they were opened at.
                Software payments and renewals are recorded on Software Subscriptions.
              </p>
            </div>
          )
        })()}

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
