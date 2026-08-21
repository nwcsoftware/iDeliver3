import React, { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { Package, PackageCheck, Store, CreditCard, Wallet, HandCoins, Boxes, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { AppProvider } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import Header from './Header'
import BroadcastPopup from '../messages/BroadcastPopup'
import MessagesIndicator from '../messages/MessagesIndicator'
import { checkSubscriptionAccess, accessDeniedMessage } from '../../lib/subscriptions'
import SubscriptionAgreementGate from '../subscriptions/SubscriptionAgreementGate'
import DeliveriesPage from '../../pages/DeliveriesPage'
import ShopInventoryPage from '../../pages/ShopInventoryPage'
import MySubscriptionPage from '../../pages/MySubscriptionPage'
import PartnerStatementPage from '../../pages/PartnerStatementPage'
import PartyStatementPage from '../../pages/PartyStatementPage'
import { OrderQuickViewProvider } from '../orders/OrderQuickView'
import ShopStockPage from '../../pages/ShopStockPage'
import logo from '../../assets/Logo.png'

// Supplier & Partner users get a locked-down portal: the only screens they can
// reach are Sold Orders (the daily order list) and Completed Orders (the closed
// orders list). No other route is mounted here, so nothing else is reachable.
// My Shop is supplier-only — suppliers stock the shop inventory sold in the
// customer app; partners never add items, so they don't get the page at all.
const navItems = [
  { to: '/sold-orders',      icon: Package,      label: 'Sold Orders' },
  { to: '/completed-orders', icon: PackageCheck, label: 'Completed Orders' },
  { to: '/my-shop',          icon: Store,        label: 'My Shop', supplierOnly: true },
  { to: '/my-inventory',     icon: Boxes,        label: 'Inventory', supplierOnly: true },
  { to: '/my-statement',     icon: Wallet,       label: 'My Statement' },
  { to: '/package-balance',  icon: HandCoins,    label: 'Package Balance' },
  { to: '/my-subscription',  icon: CreditCard,   label: 'My Subscription' },
]

// Collapsible sidebar matching the main app's Sidebar: a 16-wide icon rail that
// expands to a labelled 56-wide panel. Collapsed items show a floating tooltip.
function PartnerSidebar({ isSupplier }) {
  const items = navItems.filter(i => !i.supplierOnly || isSupplier)
  const [collapsed, setCollapsed] = useState(true)
  const [tip, setTip] = useState({ label: '', y: 0, visible: false })

  function showTip(e, label) {
    const rect = e.currentTarget.getBoundingClientRect()
    setTip({ label, y: rect.top + rect.height / 2, visible: true })
  }
  function hideTip() { setTip(t => ({ ...t, visible: false })) }
  function handleCollapse() { setCollapsed(true); hideTip() }

  return (
    <>
      <aside className={`${collapsed ? 'w-16' : 'w-56'} flex-shrink-0 bg-surface-card border-r border-surface-border flex flex-col transition-all duration-200`}>

        {/* ── Logo ──────────────────────────────────────────────── */}
        <div className={`flex items-center border-b border-surface-border h-[64px] px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div
              onClick={collapsed ? () => setCollapsed(false) : undefined}
              className={`w-9 h-9 flex items-center justify-center flex-shrink-0 ${collapsed ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
            >
              <img src={logo} alt="iDeliver" className="w-9 h-9 object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0 overflow-hidden">
                <p className="text-white font-bold text-base leading-none">iDeliver</p>
                <p className="text-brand-400 text-xs font-semibold tracking-widest mt-0.5">III</p>
              </div>
            )}
          </div>
          {!collapsed && (
            <button onClick={handleCollapse}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors flex-shrink-0"
              title="Collapse sidebar">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Nav ───────────────────────────────────────────────── */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {items.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to}
              onMouseEnter={collapsed ? (e) => showTip(e, label) : undefined}
              onMouseLeave={collapsed ? hideTip : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 border
                 ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                 ${isActive
                   ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                   : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'}`
              }>
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* ── Messages + Expand button ───────────────────────────── */}
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 py-3 border-t border-surface-border">
            <MessagesIndicator collapsed />
            <button onClick={() => setCollapsed(false)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors"
              title="Expand sidebar">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="px-4 py-3 border-t border-surface-border">
            <MessagesIndicator />
          </div>
        )}
      </aside>

      {/* ── Floating tooltip (collapsed) ───────────────────────── */}
      {collapsed && tip.visible && (
        <div className="fixed z-[200] pointer-events-none"
          style={{ top: tip.y, left: 68, transform: 'translateY(-50%)' }}>
          <div className="bg-slate-900 border border-slate-700 text-slate-100 text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap">
            {tip.label}
          </div>
        </div>
      )}
    </>
  )
}

export default function PartnerShell() {
  const { currentUser, logout } = useAuth()
  // Orders are scoped to this 2nd party's own contact. A login that isn't linked
  // to a contact can't own any orders — surface that instead of an empty list.
  const partyContactId = currentUser?.contact_id || null
  // Only suppliers stock the shop; partners get no My Shop link and no route,
  // so /my-shop just falls through to Sold Orders for them.
  const isSupplier = currentUser?.role === 'supplier'

  // Subscription enforcement while the portal is OPEN: sign-in already checks
  // it, but a subscription can expire or be deactivated mid-session (and an
  // older session may predate the check entirely). Re-checked on mount and
  // every 5 minutes; the user is signed out with the reason.
  const [denied, setDenied] = useState(null)
  useEffect(() => {
    if (!currentUser) return undefined
    let cancelled = false
    const check = async () => {
      const { allowed, reason, row } = await checkSubscriptionAccess(currentUser.contact_id)
      if (cancelled || allowed) return
      setDenied(accessDeniedMessage(reason, row))
    }
    check()
    const t = setInterval(check, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [currentUser])

  if (denied) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-surface">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <p className="text-slate-100 font-semibold">Subscription not active</p>
        <p className="text-slate-400 text-sm max-w-md whitespace-pre-line leading-relaxed">{denied}</p>
        <button onClick={logout} className="btn-primary px-4 py-2 text-sm">Sign out</button>
      </div>
    )
  }

  /* The agreement stands in front of the portal — and in front of AppProvider,
     so nothing is fetched for someone who hasn't accepted yet. */
  return (
    <SubscriptionAgreementGate contactId={partyContactId} companyId={currentUser?.company_id ?? null}>
    <AppProvider>
      <OrderQuickViewProvider>
      <HashRouter>
        <div className="h-screen flex flex-col overflow-hidden">
          <BroadcastPopup />
          <Header />
          <div className="flex flex-1 overflow-hidden">

            {/* Collapsible sidebar — just the two allowed screens */}
            <PartnerSidebar isSupplier={isSupplier} />

            <main className="flex-1 flex flex-col overflow-hidden">
              {!partyContactId && (
                <div className="m-4 flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-200 text-xs leading-relaxed">
                    Your account isn’t linked to a contact yet, so no orders can be shown.
                    Ask an administrator to link your login from your contact record.
                  </p>
                </div>
              )}
              <Routes>
                <Route path="/sold-orders"      element={<DeliveriesPage partyContactId={partyContactId} />} />
                <Route path="/completed-orders" element={<DeliveriesPage closed partyContactId={partyContactId} />} />
                {isSupplier && (
                  <Route path="/my-shop"        element={<ShopInventoryPage partyContactId={partyContactId} />} />
                )}
                {isSupplier && (
                  <Route path="/my-inventory"   element={<ShopStockPage partyContactId={partyContactId} />} />
                )}
                {/* The full statement: orders by where they came from, money in
                    and out, and what is still pending. The older package-only
                    balance stays reachable as "Package balance". */}
                <Route path="/my-statement"     element={<PartyStatementPage partyContactId={partyContactId} />} />
                <Route path="/package-balance"  element={<PartnerStatementPage partyContactId={partyContactId} />} />
                <Route path="/my-subscription"  element={<MySubscriptionPage partyContactId={partyContactId} />} />
                {/* Any other path falls back to the default screen. */}
                <Route path="*" element={<Navigate to="/sold-orders" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </HashRouter>
      </OrderQuickViewProvider>
    </AppProvider>
    </SubscriptionAgreementGate>
  )
}
