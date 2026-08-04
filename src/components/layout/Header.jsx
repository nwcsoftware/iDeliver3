import React, { useState, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, Square, X, Bell, LogOut, ChevronDown, Receipt, EyeOff } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'

// Orders still waiting for someone to confirm them — what the "Unconfirmed"
// chip on the Deliveries page shows. Mirrors DeliveriesPage's isConfirmed
// (delivery_orders.order_confirmed), and ignores rows that are out of play:
// closed orders live on their own page, cancelled/failed need no confirming.
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
  '/sold-orders':      'Sold Orders',
  '/completed-orders': 'Completed Orders',
  '/supplier-settlements': 'Supplier Settlements',
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
  const title                = pageTitles[location.pathname] || 'iDeliver III'
  const { currentUser, logout } = useAuth()
  const { orders, showSummary, toggleShowSummary, headerBackground } = useApp()
  const electron             = window.electron
  const [userMenu, setUserMenu] = useState(false)

  // The bell is an office tool: it counts every order awaiting confirmation, so
  // 2nd-party logins (supplier/partner) don't get it at all.
  const showBell = !['supplier', 'partner'].includes(currentUser?.role)

  // Orders awaiting confirmation → bell badge (9+ once it goes past nine).
  const pendingCount = useMemo(
    () => orders.filter(isUnconfirmedOrder).length,
    [orders],
  )
  const badgeLabel = pendingCount > 9 ? '9+' : String(pendingCount)

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
        <button
          className={`btn-ghost p-2 relative transition-colors ${
            pendingCount > 0 ? 'text-fuchsia-300 hover:text-fuchsia-200' : ''}`}
          title={pendingCount > 0
            ? `${pendingCount} order${pendingCount === 1 ? '' : 's'} awaiting confirmation`
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
