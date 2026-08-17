import React, { useState, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Minus, Square, X, Bell, LogOut, ChevronDown, Receipt, EyeOff, Search, MapPin, CheckSquare, MinusSquare, Check, Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import LicenseNotice from '../LicenseNotice'
import PartnerSubscriptionNotice from '../PartnerSubscriptionNotice'

// Orders still waiting for someone to confirm them — what the "Unconfirmed"
// chip on the Deliveries page shows. Mirrors DeliveriesPage's isConfirmed
// (delivery_orders.order_confirmed), and ignores rows that are out of play:
// closed orders live on their own page, cancelled/failed need no confirming.
// Confirming moves a delivery that is still 'Pending' on to its normal first
// step, with the money still due — the same promotion the Deliveries page
// applies when an order is confirmed one at a time.
const DELIVERY_PENDING = 'Pending'
const COLLECTION_DUE   = 'Money is due'

const isUnconfirmedOrder = (o) =>
  o?.order_confirmed !== true &&
  o?.isclosed !== true &&
  !['cancelled', 'failed'].includes(String(o?.status || '').toLowerCase())

const pageTitles = {
  '/':           'Dashboard',
  '/drivers':    'Driver Management',
  '/deliveries': 'Deliveries',
  '/tracking':   'Real-time Tracking',
  '/reports':    'Reports & Analytics',
  '/settings/users': 'User Accounts',
  '/settings/shop-categories': 'Shop Categories',
  '/settings/header-background': 'Header Background',
  '/settings/subscriptions': 'Subscriptions',
  '/settings/software-subscriptions': 'Software Subscriptions',
  '/settings/change-requests': 'Change Requests',
  '/package-labels': 'Package Labels',
  '/sold-orders':      'Sold Orders',
  '/completed-orders': 'Completed Orders',
  '/supplier-settlements': 'Supplier Settlements',
  '/party-statements': 'Shop Statements',
}

const roleLabel = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  call_center: 'Call Center',
  driver:      'Driver',
  customer:    'Customer',
  supplier:    'Supplier',
  partner:     'Partner',
}

export default function Header() {
  const location             = useLocation()
  const navigate             = useNavigate()
  const title                = pageTitles[location.pathname] || 'iDeliver III'
  const { currentUser, logout } = useAuth()
  const { orders, refreshOrders, showSummary, toggleShowSummary, headerBackground } = useApp()
  const electron             = window.electron
  const [userMenu, setUserMenu] = useState(false)

  // The bell is an office tool: it counts every order awaiting confirmation, so
  // 2nd-party logins (supplier/partner) don't get it at all.
  const showBell = !['supplier', 'partner'].includes(currentUser?.role)

  // Orders awaiting confirmation → bell badge (9+ once it goes past nine).
  const pending = useMemo(() => orders.filter(isUnconfirmedOrder), [orders])
  const pendingCount = pending.length
  const badgeLabel = pendingCount > 9 ? '9+' : String(pendingCount)

  // …and the same orders grouped by scheduled date for the bell popup, newest
  // day first. Each group can be collapsed; they all start open.
  const pendingGroups = useMemo(() => {
    const byDay = new Map()
    for (const o of pending) {
      const day = String(o.scheduled_date || o.created_at || '').slice(0, 10) || 'No date'
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push(o)
    }
    return [...byDay.entries()]
      .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
      .map(([day, list]) => ({ day, list }))
  }, [pending])

  const [bellOpen,   setBellOpen]   = useState(false)
  const [bellSearch, setBellSearch] = useState('')
  const [collapsed,  setCollapsed]  = useState(() => new Set())   // days folded shut

  // The popup's own search — order number, reception (recipient), customer and
  // delivery location. Empty days drop out of the list.
  const bellGroups = useMemo(() => {
    const q = bellSearch.trim().toLowerCase()
    if (!q) return pendingGroups
    const hit = o => [
      o.order_number, o.recipient_name, o.delivery_address, o.pickup_address,
      o.customer?.company_name,
      `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`,
    ].some(v => String(v ?? '').toLowerCase().includes(q))
    return pendingGroups
      .map(g => ({ ...g, list: g.list.filter(hit) }))
      .filter(g => g.list.length > 0)
  }, [pendingGroups, bellSearch])

  const bellShown = bellGroups.reduce((n, g) => n + g.list.length, 0)

  /* ── bulk confirmation ──────────────────────────────────────────────────
     Orders can be ticked one by one or a whole day at a time, then confirmed
     together. Only what is currently visible can be selected, so a search
     narrows the reach of "select all" as you would expect. */
  const [selected,   setSelected]   = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [bulkError,  setBulkError]  = useState('')
  // How far the bulk confirmation has got, for the progress bar.
  const [progress,   setProgress]   = useState({ done: 0, total: 0 })

  const visibleIds = useMemo(
    () => bellGroups.flatMap(g => g.list.map(o => o.id)),
    [bellGroups])
  // Selections survive a search, but drop off once an order is confirmed away.
  const selectedIds = useMemo(
    () => visibleIds.filter(id => selected.has(id)),
    [visibleIds, selected])

  const toggleOrder = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  // A day header ticks or clears every order shown under it.
  const toggleGroup = (list) => setSelected(prev => {
    const next = new Set(prev)
    const all = list.every(o => next.has(o.id))
    for (const o of list) all ? next.delete(o.id) : next.add(o.id)
    return next
  })
  const toggleAll = () => setSelected(prev => {
    const all = visibleIds.length > 0 && visibleIds.every(id => prev.has(id))
    const next = new Set(prev)
    for (const id of visibleIds) all ? next.delete(id) : next.add(id)
    return next
  })

  async function confirmSelected() {
    if (selectedIds.length === 0 || confirming) return
    const stamp = {
      order_confirmed: true,
      confirmed_at:    new Date().toISOString(),
      confirmed_by:    currentUser?.user_id || null,
    }
    // Two kinds of update: orders still 'Pending' also start their delivery,
    // the rest only take the confirmation stamp.
    const chosen   = pending.filter(o => selectedIds.includes(o.id))
    const starting = chosen.filter(o => o.delivery_status === DELIVERY_PENDING).map(o => o.id)
    const plain    = chosen.filter(o => o.delivery_status !== DELIVERY_PENDING).map(o => o.id)

    setConfirming(true); setBulkError('')
    setProgress({ done: 0, total: chosen.length })

    // Sent in small batches so the bar reflects real work rather than jumping
    // from empty to full, and so a long list doesn't ride on one huge request.
    const BATCH = 20
    const run = async (ids, patch) => {
      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH)
        const { error } = await supabase.from('delivery_orders').update(patch).in('id', slice)
        if (error) return error.message
        setProgress(pr => ({ ...pr, done: pr.done + slice.length }))
      }
      return null
    }

    let failed = await run(starting,
      { ...stamp, delivery_status: 'Awaiting Pickup', collection_from_customer: COLLECTION_DUE })
    if (!failed) failed = await run(plain, stamp)

    // Only the orders we touched come back — the list is never re-downloaded.
    await refreshOrders(chosen.map(o => o.id))
    setConfirming(false)
    setProgress({ done: 0, total: 0 })
    if (failed) { setBulkError(failed); return }
    setSelected(new Set())
  }

  const closeBell = () => {
    if (confirming) return          // the popup stays put until the run ends
    setBellOpen(false); setBellSearch('')
    setSelected(new Set()); setBulkError('')
  }

  // Order number → close the popup and open that order's form (the Deliveries
  // page picks the id up from ?edit=).
  const openOrder = (o) => {
    closeBell()
    navigate(`/deliveries?edit=${o.id}`)
  }
  const toggleDay = (day) => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(day) ? next.delete(day) : next.add(day)
    return next
  })
  const dayLabel = (day) => {
    if (day === 'No date') return 'No scheduled date'
    const d = new Date(`${day}T00:00:00`)
    return isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  }

  const initials = currentUser
    ? `${currentUser.first_name?.[0] ?? ''}${currentUser.last_name?.[0] ?? ''}`.toUpperCase() || 'U'
    : 'U'

  // NOTE: the header must NOT be `overflow-hidden` — it would clip the user
  // menu, which drops below it. The background layers are `inset-0`, so they
  // can't spill out anyway.
  return (
    <header
      className="relative z-40 h-[50px] bg-surface-card border-b border-surface-border flex items-center px-4 gap-4 flex-shrink-0"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Scheduled decorative background (super admin, fix109). Purely visual:
          it sits behind everything and never takes pointer events. A dark
          gradient over it keeps the title and buttons readable. */}
      {headerBackground?.image_url && (
        <>
          <div aria-hidden
            className="absolute inset-0 bg-cover bg-center pointer-events-none"
            style={{
              backgroundImage: `url("${headerBackground.image_url}")`,
              opacity: Number(headerBackground.opacity) || 0.35,
            }} />
          <div aria-hidden
            className="absolute inset-0 pointer-events-none bg-gradient-to-r from-surface-card/85 via-surface-card/40 to-surface-card/85" />
        </>
      )}

      {/* Title */}
      <h1 className="relative text-sm font-semibold text-slate-100 flex-1 drop-shadow">{title}</h1>

      {/* Expiry bar — stays put from a month before expiry until renewal. Each
          component renders only for the roles it serves: the office sees the
          company's software licences, a 2nd party sees their own subscription. */}
      <div className="relative" style={{ WebkitAppRegion: 'no-drag' }}>
        <LicenseNotice />
        <PartnerSubscriptionNotice />
      </div>

      {/* Actions */}
      <div
        className="relative flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        {/* Amounts summary popup show/hide — per-user view preference */}
        <button
          onClick={toggleShowSummary}
          className={`btn-ghost p-2 relative transition-colors ${
            showSummary ? 'text-brand-300' : 'text-slate-500'}`}
          title={showSummary
            ? 'Amounts summary popup: shown — click to hide'
            : 'Amounts summary popup: hidden — click to show'}
        >
          <Receipt className="w-4 h-4" />
          {!showSummary && (
            <EyeOff className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-slate-400" />
          )}
        </button>

        {/* Notification bell — orders awaiting confirmation. Rings (swings +
            pulsing halo) whenever the count isn't zero. Office roles only. */}
        {showBell && (
        <div className="relative">
          <button
            onClick={() => setBellOpen(o => !o)}
            className={`btn-ghost p-2 relative transition-colors ${
              pendingCount > 0 ? 'text-fuchsia-300 hover:text-fuchsia-200' : ''}`}
            title={pendingCount > 0
              ? `${pendingCount} order${pendingCount === 1 ? '' : 's'} awaiting confirmation — click to list them`
              : 'No orders awaiting confirmation'}
          >
            {pendingCount > 0 && (
              <span className="absolute inset-1 rounded-full bg-fuchsia-400/20 animate-ping" />
            )}
            <Bell className={`w-4 h-4 relative ${pendingCount > 0 ? 'animate-bell-ring' : ''}`} />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center
                               rounded-full bg-fuchsia-500 text-white text-[10px] font-bold leading-none">
                {badgeLabel}
              </span>
            )}
          </button>

          {/* Unconfirmed orders — a centred popup, grouped by scheduled date,
              searchable, with the order number opening that order. */}
          {bellOpen && (
            <div className={`fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm ${confirming ? 'cursor-wait' : ''}`}
              onClick={closeBell}>
              <div className="card relative w-full max-w-3xl max-h-[82vh] flex flex-col overflow-hidden shadow-2xl shadow-black/50"
                onClick={e => e.stopPropagation()}>

                {/* While a bulk confirmation runs, this covers the popup and
                    swallows every click, so nothing can be changed mid-run.
                    The backdrop behind it already blocks the rest of the app. */}
                {confirming && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3
                                  bg-surface-card/85 backdrop-blur-sm cursor-wait"
                    onClick={e => { e.preventDefault(); e.stopPropagation() }}>
                    <Loader2 className="w-6 h-6 text-brand-300 animate-spin" />
                    <p className="text-sm font-medium text-slate-100">Confirming orders…</p>
                    <div className="w-64 h-2 rounded-full bg-surface-hover overflow-hidden">
                      <div className="h-full bg-brand-500 transition-[width] duration-200 ease-out"
                        style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {progress.done} of {progress.total} · please wait
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border bg-surface-hover/40 flex-shrink-0">
                  <Bell className="w-4 h-4 text-fuchsia-300" />
                  <span className="text-sm font-semibold text-slate-100">Orders awaiting confirmation</span>
                  {bellShown > 0 && (
                    <button onClick={toggleAll} disabled={confirming}
                      title={selectedIds.length === bellShown ? 'Clear the selection' : 'Select every order listed'}
                      className="btn-ghost py-1 px-2 text-[11px] text-slate-400 hover:text-slate-100">
                      {selectedIds.length === bellShown
                        ? <CheckSquare className="w-3.5 h-3.5 text-brand-300" />
                        : selectedIds.length > 0
                          ? <MinusSquare className="w-3.5 h-3.5 text-brand-300" />
                          : <Square className="w-3.5 h-3.5" />}
                      Select all
                    </button>
                  )}
                  <span className="ml-auto text-[11px] text-slate-400">
                    {bellShown} of {pendingCount} order{pendingCount === 1 ? '' : 's'} · {bellGroups.length} day{bellGroups.length === 1 ? '' : 's'}
                  </span>
                  <button onClick={closeBell} disabled={confirming}
                    className="btn-ghost p-1.5 text-slate-500 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Search across number, recipient, customer and location */}
                <div className="px-5 py-2.5 border-b border-surface-border flex-shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input autoFocus disabled={confirming}
                      className="input pl-9 py-1.5 text-xs disabled:opacity-50" value={bellSearch}
                      onChange={e => setBellSearch(e.target.value)}
                      placeholder="Search order number, reception, customer or delivery location…" />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {bellGroups.length === 0 ? (
                    <p className="px-4 py-10 text-center text-xs text-slate-500">
                      {pendingCount === 0 ? 'Nothing is waiting for confirmation.' : 'No orders match your search.'}
                    </p>
                  ) : bellGroups.map(({ day, list }) => {
                    const shut    = collapsed.has(day)
                    const dayAll  = list.every(o => selected.has(o.id))
                    const daySome = !dayAll && list.some(o => selected.has(o.id))
                    return (
                      <div key={day} className="border-b border-surface-border/50 last:border-b-0">
                        <div className="w-full flex items-center gap-2 px-5 py-2 hover:bg-surface-hover/40 transition-colors sticky top-0 bg-surface-card z-10">
                          {/* Ticks the whole day at once. */}
                          <button onClick={() => toggleGroup(list)} disabled={confirming}
                            title={dayAll ? 'Clear this day' : 'Select every order on this day'}
                            className="text-slate-500 hover:text-brand-300 transition-colors flex-shrink-0">
                            {dayAll
                              ? <CheckSquare className="w-3.5 h-3.5 text-brand-300" />
                              : daySome
                                ? <MinusSquare className="w-3.5 h-3.5 text-brand-300" />
                                : <Square className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => toggleDay(day)} className="flex-1 flex items-center gap-2 text-left">
                            <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${shut ? '-rotate-90' : ''}`} />
                            <span className="text-xs font-medium text-slate-200">{dayLabel(day)}</span>
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">
                              {list.length}
                            </span>
                          </button>
                        </div>
                        {!shut && (
                          <table className="w-full text-xs">
                            <tbody>
                              {list.map(o => (
                                <tr key={o.id} className={`hover:bg-surface-hover/30 ${selected.has(o.id) ? 'bg-brand-500/10' : ''}`}>
                                  <td className="pl-5 pr-0 py-1.5 w-8">
                                    <button onClick={() => toggleOrder(o.id)} disabled={confirming}
                                      title={selected.has(o.id) ? 'Deselect' : 'Select for confirmation'}
                                      className="text-slate-600 hover:text-brand-300 transition-colors">
                                      {selected.has(o.id)
                                        ? <CheckSquare className="w-3.5 h-3.5 text-brand-300" />
                                        : <Square className="w-3.5 h-3.5" />}
                                    </button>
                                  </td>
                                  <td className="pl-3 pr-3 py-1.5 w-[10rem]">
                                    <button onClick={() => openOrder(o)}
                                      title="Open this order"
                                      className="font-mono text-[11px] text-brand-300 hover:text-brand-200 hover:underline">
                                      {o.order_number || '—'}
                                    </button>
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-300 truncate max-w-[11rem]">{o.recipient_name || '—'}</td>
                                  <td className="px-3 py-1.5 text-slate-400 truncate max-w-[10rem]">
                                    {o.customer?.company_name
                                      || `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.trim() || '—'}
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-400 truncate max-w-[14rem]">
                                    <span className="inline-flex items-center gap-1">
                                      <MapPin className="w-3 h-3 text-slate-600 flex-shrink-0" />
                                      {o.delivery_address || '—'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Confirm everything ticked in one go. */}
                <div className="flex items-center gap-3 px-5 py-3 border-t border-surface-border bg-surface-hover/30 flex-shrink-0">
                  <span className="text-[11px] text-slate-400">
                    {selectedIds.length === 0
                      ? 'Tick orders, or a whole day, to confirm them together.'
                      : `${selectedIds.length} order${selectedIds.length === 1 ? '' : 's'} selected`}
                  </span>
                  {bulkError && <span className="text-[11px] text-red-400 truncate">{bulkError}</span>}
                  <button onClick={confirmSelected} disabled={selectedIds.length === 0 || confirming}
                    className="btn-primary ml-auto py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed">
                    {confirming
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Confirming…</>
                      : <><Check className="w-3.5 h-3.5" />Confirm selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenu(m => !m)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-brand-600/40 flex items-center justify-center text-brand-300 text-xs font-bold">
              {initials}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-medium text-slate-200 leading-none">
                {currentUser?.first_name} {currentUser?.last_name}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {roleLabel[currentUser?.role] ?? currentUser?.role}
              </p>
            </div>
            <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${userMenu ? 'rotate-180' : ''}`} />
          </button>

          {userMenu && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
              {/* Dropdown */}
              <div className="absolute right-0 top-full mt-1 w-52 card py-1 z-20 shadow-2xl shadow-black/40">
                <div className="px-3 py-2 border-b border-surface-border">
                  <p className="text-xs font-medium text-slate-200">{currentUser?.username}</p>
                  <p className="text-xs text-slate-500 truncate">{currentUser?.email}</p>
                </div>
                <button
                  onClick={async () => { setUserMenu(false); await logout() }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400
                             hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Window controls */}
        {electron && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => electron.window.minimize()}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400
                         hover:bg-surface-hover hover:text-slate-100 transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              onClick={() => electron.window.maximize()}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400
                         hover:bg-surface-hover hover:text-slate-100 transition-colors"
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={() => electron.window.close()}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400
                         hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
