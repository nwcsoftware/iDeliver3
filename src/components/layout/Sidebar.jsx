import React, { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, Package, PackageCheck, MapPin, BarChart3,
  Building2, Tag, ChevronLeft, ChevronRight, FileText, Receipt, Car,
  ChevronDown, BookUser, Building, UserCheck, Handshake, Settings, UserCog, BookText, Menu, X, ClipboardList, RotateCcw, HandCoins, Trash2, Wallet, PackageX, Megaphone, MessageSquare, CreditCard, ShieldCheck, Store, Truck, CalendarRange, Boxes, Banknote, Tags, Image as ImageIcon, ClipboardPen, AppWindow, Ban,
  ArrowRightLeft, Palette, UserX, TrendingUp, Scale,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import logo from '../../assets/Logo.png'
import AboutPopup from '../about/AboutPopup'
import MessagesIndicator from '../messages/MessagesIndicator'

/* The menu, as three pinned screens plus collapsible groups.

   Pinned: opened dozens of times a day, so never behind a click.
   Groups: everything else, gathered by the job being done rather than by which
   table it reads. Each group carries `adminOnly` / `superOnly` where the whole
   group is restricted; individual items may restrict themselves the same way.

   Open groups are remembered per user on this device, and the group holding the
   current page opens itself. */

export const pinnedNav = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/deliveries', icon: Package,         label: 'Orders'    },
  { to: '/tracking',   icon: MapPin,          label: 'Tracking'  },
]

export const navGroups = [
  {
    key: 'orders', label: 'Orders & Delivery', icon: PackageCheck,
    items: [
      { to: '/closed-orders',    icon: PackageCheck,  label: 'Closed Orders' },
      // The only list of cancelled orders — they are excluded everywhere else.
      { to: '/cancelled-orders', icon: Ban,           label: 'Cancelled Orders' },
      { to: '/packages',         icon: Boxes,         label: 'Packages' },
      { to: '/package-labels',   icon: Tags,          label: 'Package Labels' },
      { to: '/returnable-items', icon: RotateCcw,     label: 'Returnable Items' },
      { to: '/driver-dues',      icon: HandCoins,     label: 'Driver Settlements' },
    ],
  },
  {
    key: 'cash', label: 'Cash & Collections', icon: Banknote,
    items: [
      { to: '/daily-collection', icon: Banknote,   label: 'Daily Collection', superOnly: true },
      { to: '/cashier-box',      icon: Wallet,     label: 'Cashier Box' },
      { to: '/credit-customers', icon: CreditCard, label: 'Credit Customers' },
      { to: '/retail-invoices',  icon: Receipt,    label: 'Retail Invoices' },
      // Amounts that look like they were typed against the wrong currency.
      { to: '/currency-check',   icon: ArrowRightLeft, label: 'Currency Check' },
    ],
  },
  {
    key: 'shops', label: 'Shops & Partners', icon: Store,
    items: [
      { to: '/partner-dues',         icon: Handshake, label: 'Partner Dues' },
      { to: '/supplier-settlements', icon: Store,     label: 'Supplier Settlements' },
      { to: '/party-statements',     icon: Wallet,    label: 'Shop Statements' },
      { to: '/products',             icon: Tag,       label: 'Products' },
      // What is actually on hand, as opposed to what we sell (fix126).
      { to: '/inventory',            icon: Boxes,     label: 'Inventory' },
    ],
  },
  {
    key: 'accounting', label: 'Accounting', icon: BookText,
    items: [
      { to: '/purchase-invoices',    icon: FileText,      label: 'Purchases' },
      { to: '/price-list',           icon: ClipboardList, label: 'Price List' },
      { to: '/account-statements',   icon: BookText,      label: 'Account Statements' },
      { to: '/account-transactions', icon: BookText,      label: 'Account Transactions' },
    ],
  },
  {
    key: 'people', label: 'People & Fleet', icon: BookUser,
    items: [
      { to: '/contacts/suppliers', icon: Building,   label: 'Suppliers' },
      { to: '/contacts/customers', icon: UserCheck,  label: 'Customers' },
      { to: '/contacts/partners',  icon: Handshake,  label: 'Partners' },
      { to: '/drivers',            icon: Users,      label: 'Drivers' },
      { to: '/vehicles',           icon: Car,        label: 'Vehicles' },
      { to: '/company',            icon: Building2,  label: 'Company' },
    ],
  },
  {
    key: 'reports', label: 'Reports', icon: BarChart3,
    items: [
      { to: '/reports', icon: BarChart3, label: 'Reports' },
      // Earnings & volume over a chosen window (week / month / 3 months / all).
      { to: '/performance', icon: TrendingUp, label: 'Performance' },
      // Credit vs regular customers: fees, packages and shop invoices,
      // what came in and what is still owed either way.
      { to: '/customer-categories', icon: Scale, label: 'Customer Categories' },
    ],
  },
  {
    key: 'admin', label: 'Administration', icon: Settings, adminOnly: true,
    items: [
      { to: '/settings/app',                    icon: Settings,     label: 'App Settings' },
      { to: '/settings/users',                  icon: UserCog,      label: 'User Accounts' },
      { to: '/settings/subscriptions',          icon: CreditCard,   label: 'Subscriptions' },
      { to: '/settings/software-subscriptions', icon: AppWindow,    label: 'Software Subscriptions' },
      { to: '/settings/change-requests',        icon: ClipboardPen, label: 'Change Requests' },
    ],
  },
  {
    // Destructive and developer-only work, deliberately last and on its own.
    key: 'super', label: 'Super Admin', icon: ShieldCheck, superOnly: true, tone: 'danger',
    items: [
      { to: '/settings/account',             icon: ShieldCheck,   label: 'Developer Account' },
      { to: '/settings/driver-collections',  icon: Truck,         label: 'Driver App (Collect)' },
      { to: '/settings/shop-categories',     icon: Tags,          label: 'Shop Categories' },
      { to: '/settings/header-background',   icon: ImageIcon,     label: 'Header Background' },
      // The customer app's seasonal look: colours + a background movie, by date.
      { to: '/settings/customer-theme',      icon: Palette,       label: 'Customer App Theme' },
      { to: '/settings/messages',            icon: Megaphone,     label: 'Broadcast Messages' },
      { to: '/settings/delete-order',        icon: PackageX,      label: 'Delete Order' },
      { to: '/settings/delete-orders-range', icon: CalendarRange, label: 'Delete Orders by Date' },
      { to: '/settings/delete-driver',       icon: UserX,         label: 'Delete Driver' },
      { to: '/settings/reset-cashier-box',   icon: Wallet,        label: 'Reset Cashier Box' },
      { to: '/settings/reset',               icon: Trash2,        label: 'Reset Data' },
    ],
  },
]

const GROUPS_KEY = (userId) => `ideliver:navGroups:${userId || 'anon'}`

function NavItem({ to, icon: Icon, label, collapsed, onMouseEnter, onMouseLeave }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 border
         ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
         ${isActive
           ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
           : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'
         }`
      }
    >
      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  )
}

export default function Sidebar() {
  const { stats } = useApp()
  const { hasRole, currentUser } = useAuth()

  const isAdmin      = hasRole('super_admin', 'admin')
  const isSuperAdmin = hasRole('super_admin')

  const [collapsed,     setCollapsed]     = useState(true)
  const [secondaryOpen, setSecondaryOpen] = useState(false)   // the all-in-one fly-out

  /* Which groups are open. Several may be at once, and the choice is kept per
     user on this device so the menu opens tomorrow the way it was left. */
  const location = useLocation()
  const userKey  = GROUPS_KEY(currentUser?.user_id)
  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const raw = localStorage.getItem(GROUPS_KEY(currentUser?.user_id))
      if (raw) return new Set(JSON.parse(raw))
    } catch { /* first run */ }
    return new Set(['orders'])          // a sensible first impression
  })
  useEffect(() => {
    try { localStorage.setItem(userKey, JSON.stringify([...openGroups])) } catch { /* ignore */ }
  }, [openGroups, userKey])

  /* The group holding the current page opens itself — landing on a page whose
     group is shut, with no way to see where you are, is disorienting. */
  useEffect(() => {
    const path = location.pathname
    const hit = navGroups.find(g => g.items.some(i => i.to === path))
    if (hit) setOpenGroups(prev => (prev.has(hit.key) ? prev : new Set([...prev, hit.key])))
  }, [location.pathname])

  const toggleGroup = (key) => setOpenGroups(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  // Only the groups this user may see, with their permitted items.
  const visibleGroups = navGroups
    .filter(g => (!g.adminOnly || isAdmin) && (!g.superOnly || isSuperAdmin))
    .map(g => ({ ...g, items: g.items.filter(i => (!i.superOnly || isSuperAdmin) && (!i.adminOnly || isAdmin)) }))
    .filter(g => g.items.length > 0)
  const [aboutOpen,     setAboutOpen]     = useState(false)   // "About _NXCORE" popup
  const [tip,           setTip]           = useState({ label: '', y: 0, visible: false })

  function showTip(e, label) {
    const rect = e.currentTarget.getBoundingClientRect()
    setTip({ label, y: rect.top + rect.height / 2, visible: true })
  }
  function hideTip() { setTip(t => ({ ...t, visible: false })) }

  function handleCollapse() { setCollapsed(true); setTip(t => ({ ...t, visible: false })) }

  return (
    <>
      <aside className={`${collapsed ? 'w-16' : 'w-64'} flex-shrink-0 bg-surface-card border-r border-surface-border flex flex-col transition-all duration-200`}>

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

          {/* Hamburger — toggles the secondary fly-out menu */}
          <button
            onClick={() => setSecondaryOpen(o => !o)}
            onMouseEnter={collapsed ? (e) => showTip(e, 'Menu') : undefined}
            onMouseLeave={collapsed ? hideTip : undefined}
            className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 border mb-1
              ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
              ${secondaryOpen
                ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'}`}
          >
            <Menu className="w-[18px] h-[18px] flex-shrink-0" />
            {!collapsed && <span>Menu</span>}
          </button>

          {/* The rail is deliberately short: the three screens opened all day.
              Everything else lives in the Menu fly-out beside it. */}
          {pinnedNav.map(({ to, icon, label }) => (
            <NavItem key={to} to={to} icon={icon} label={label} collapsed={collapsed}
              onMouseEnter={collapsed ? (e) => showTip(e, label) : undefined}
              onMouseLeave={collapsed ? hideTip : undefined}
            />
          ))}
        </nav>

        {/* ── Messages + Expand button (collapsed) ───────────────── */}
        {collapsed && (
          <div className="flex flex-col items-center gap-2 py-3 border-t border-surface-border">
            <MessagesIndicator collapsed />
            <button onClick={() => setCollapsed(false)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors"
              title="Expand sidebar">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Quick Stats (expanded only) ────────────────────────── */}
        {!collapsed && (
          <div className="px-4 pb-4 pt-4 space-y-2 border-t border-surface-border">
            <MessagesIndicator />
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Quick Stats</p>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Available Drivers</span>
              <span className="text-green-400 font-semibold">{stats.activeDrivers}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">In Transit</span>
              <span className="text-brand-400 font-semibold">{stats.inTransit}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Pending</span>
              <span className="text-yellow-400 font-semibold">{stats.pendingOrders}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Failed / Cancelled</span>
              <span className="text-red-400 font-semibold">{stats.failed + stats.cancelled}</span>
            </div>
          </div>
        )}

        {/* ── Powered by _NXCORE — opens the About popup ──────────── */}
        <button
          onClick={() => setAboutOpen(true)}
          onMouseEnter={collapsed ? (e) => showTip(e, 'About _NXCORE') : undefined}
          onMouseLeave={collapsed ? hideTip : undefined}
          className={`border-t border-surface-border py-2.5 text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors ${collapsed ? 'flex justify-center' : 'w-full text-center'}`}
          title="About _NXCORE"
        >
          {collapsed
            ? <span className="text-[10px] font-bold tracking-widest">NX</span>
            : <span className="text-[10px] tracking-widest">POWERED BY <span className="font-bold text-slate-300">_NXCORE</span></span>}
        </button>
      </aside>

      {/* ── Secondary fly-out menu — sits right next to the sidebar and moves
            with it (collapse/expand) since it's the next flex sibling. ──────── */}
      {secondaryOpen && (
        <aside className="w-64 flex-shrink-0 bg-surface-card border-r border-surface-border flex flex-col transition-all duration-200">
          <div className="h-[64px] flex items-center justify-between px-4 border-b border-surface-border">
            <span className="text-sm font-semibold text-slate-200">Menu</span>
            <button onClick={() => setSecondaryOpen(false)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors"
              title="Close menu">
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
            {/* Grouped by the job being done. Several groups may be open at
                once and the choice is remembered per user; the group holding
                the current page opens itself. */}
            {visibleGroups.map(g => {
              const open = openGroups.has(g.key)
              const GroupIcon = g.icon
              const danger = g.tone === 'danger'
              return (
                <div key={g.key}>
                  <button type="button" onClick={() => toggleGroup(g.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-semibold
                                uppercase tracking-wider transition-colors
                                ${danger
                                  ? 'text-red-400/80 hover:text-red-300 hover:bg-red-500/10'
                                  : 'text-slate-500 hover:text-slate-300 hover:bg-surface-hover'}`}>
                    <GroupIcon className="w-[15px] h-[15px] flex-shrink-0" />
                    <span className="truncate">{g.label}</span>
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                      danger ? 'bg-red-500/10 text-red-300/80' : 'bg-surface-hover text-slate-500'}`}>
                      {g.items.length}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
                  </button>
                  {open && (
                    <div className="mt-0.5 mb-1.5 ml-3 pl-2 border-l border-surface-border space-y-0.5">
                      {g.items.map(({ to, icon: Icon, label }) => (
                        <NavLink key={to} to={to} end={to === '/'}
                          onClick={() => setSecondaryOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 border
                             ${isActive
                               ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                               : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'}`
                          }>
                          <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                          <span className="truncate">{label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* About keeps its place at the foot of the menu. */}
            <div className="pt-2 mt-1 border-t border-surface-border">
              <button onClick={() => { setSecondaryOpen(false); setAboutOpen(true) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 border border-transparent text-slate-400 hover:text-slate-100 hover:bg-surface-hover">
                <Building2 className="w-[18px] h-[18px] flex-shrink-0" />
                <span>About _NXCORE</span>
              </button>
            </div>
          </nav>
        </aside>
      )}

      {/* ── Floating tooltip ───────────────────────────────────── */}
      {collapsed && tip.visible && (
        <div className="fixed z-[200] pointer-events-none"
          style={{ top: tip.y, left: 68, transform: 'translateY(-50%)' }}>
          <div className="bg-slate-900 border border-slate-700 text-slate-100 text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap">
            {tip.label}
          </div>
        </div>
      )}

      {/* ── About _NXCORE popup ─────────────────────────────────── */}
      <AboutPopup open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  )
}
