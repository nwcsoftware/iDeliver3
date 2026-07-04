import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Users, Package, PackageCheck, MapPin, BarChart3,
  Building2, Tag, ChevronLeft, ChevronRight, FileText, Receipt, Car,
  ChevronDown, BookUser, Building, UserCheck, Handshake, Settings, UserCog, BookText, Menu, X, ClipboardList, RotateCcw, HandCoins, Trash2, Wallet, PackageX, Megaphone, MessageSquare, CreditCard, ShieldCheck, Store, Truck, CalendarRange,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import logo from '../../assets/Logo.png'
import AboutPopup from '../about/AboutPopup'

// Main sidebar: the everyday driver-dispatch screens only.
const mainNav = [
  { to: '/',                   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/deliveries',         icon: Package,         label: 'Orders'        },
  { to: '/closed-orders',      icon: PackageCheck,    label: 'Closed Orders' },
  { to: '/driver-dues',        icon: HandCoins,       label: 'Driver Settlements' },
  { to: '/credit-customers',   icon: CreditCard,      label: 'Credit Customers' },
  { to: '/cashier-box',        icon: Wallet,          label: 'Cashier Box' },
  { to: '/tracking',           icon: MapPin,          label: 'Tracking'  },
]

// Everything else lives in the hamburger fly-out menu.
const secondaryNav = [
  { to: '/drivers',              icon: Users,           label: 'Drivers' },
  { to: '/reports',              icon: BarChart3,       label: 'Reports' },
  { to: '/products',             icon: Tag,             label: 'Products'  },
  { to: '/price-list',           icon: ClipboardList,   label: 'Price List' },
  { to: '/returnable-items',     icon: RotateCcw,       label: 'Returnable Items' },
  { to: '/purchase-invoices',    icon: FileText,        label: 'Purchases' },
  { to: '/retail-invoices',      icon: Receipt,         label: 'Retail Invoices' },
  { to: '/account-transactions', icon: BookText,        label: 'Account Transactions' },
  { to: '/supplier-settlements', icon: Store,           label: 'Supplier Settlements' },
  { to: '/vehicles',             icon: Car,             label: 'Vehicles'  },
  { to: '/company',              icon: Building2,       label: 'Company'   },
]

const contactsSubItems = [
  { to: '/contacts/suppliers', icon: Building,   label: 'Suppliers' },
  { to: '/contacts/customers', icon: UserCheck,  label: 'Customers' },
  { to: '/contacts/partners',  icon: Handshake,  label: 'Partners'  },
]

// Settings entries available to any admin (super_admin + admin).
const settingsSubItems = [
  { to: '/settings/app',          icon: Settings,  label: 'App Settings' },
  { to: '/settings/users',        icon: UserCog,   label: 'User Accounts' },
]
// Settings entries restricted to super_admin only (the developer).
const superAdminSettingsItems = [
  { to: '/settings/account',      icon: ShieldCheck, label: 'Developer Account' },
  { to: '/settings/driver-collections', icon: Truck, label: 'Driver App (Collect)' },
  { to: '/settings/messages',     icon: Megaphone,   label: 'Broadcast Messages' },
  { to: '/settings/delete-order', icon: PackageX,    label: 'Delete Order' },
  { to: '/settings/delete-orders-range', icon: CalendarRange, label: 'Delete Orders by Date' },
  { to: '/settings/reset',        icon: Trash2,      label: 'Reset Data' },
]

// Broadcast-message indicator: a bell with the user's unread count (9+ when >9).
// Clicking opens the global message popup. Rendered both in the collapsed rail
// and at the top of the expanded Quick Stats panel.
function MessagesIndicator({ collapsed, unreadCount, onClick }) {
  const badge = unreadCount > 9 ? '9+' : String(unreadCount)
  if (collapsed) {
    return (
      <button onClick={onClick} title={unreadCount ? `${unreadCount} unread message${unreadCount > 1 ? 's' : ''}` : 'Messages'}
        className="relative p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-hover transition-colors">
        <MessageSquare className={`w-[18px] h-[18px] ${unreadCount ? 'text-brand-400' : ''}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badge}
          </span>
        )}
      </button>
    )
  }
  return (
    <button onClick={onClick}
      className="w-full flex items-center justify-between mb-3 group">
      <span className="flex items-center gap-2 text-xs font-medium text-slate-300 group-hover:text-slate-100 transition-colors">
        <MessageSquare className={`w-4 h-4 ${unreadCount ? 'text-brand-400' : 'text-slate-400'}`} /> Messages
      </span>
      {unreadCount > 0
        ? <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">{badge}</span>
        : <span className="text-[10px] text-slate-600">None</span>}
    </button>
  )
}

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
  const { stats, unreadCount, setMessagesOpen } = useApp()
  const { hasRole } = useAuth()

  const isAdmin      = hasRole('super_admin', 'admin')
  const isSuperAdmin = hasRole('super_admin')

  const [collapsed,     setCollapsed]     = useState(true)
  const [secondaryOpen, setSecondaryOpen] = useState(false)   // hamburger fly-out menu
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

          {/* Main nav items */}
          {mainNav.map(({ to, icon, label }) => (
            <NavItem key={to} to={to} icon={icon} label={label} collapsed={collapsed}
              onMouseEnter={collapsed ? (e) => showTip(e, label) : undefined}
              onMouseLeave={collapsed ? hideTip : undefined}
            />
          ))}
        </nav>

        {/* ── Messages + Expand button (collapsed) ───────────────── */}
        {collapsed && (
          <div className="flex flex-col items-center gap-2 py-3 border-t border-surface-border">
            <MessagesIndicator collapsed unreadCount={unreadCount} onClick={() => setMessagesOpen(true)} />
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
            <MessagesIndicator unreadCount={unreadCount} onClick={() => setMessagesOpen(true)} />
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
        <aside className="w-56 flex-shrink-0 bg-surface-card border-r border-surface-border flex flex-col transition-all duration-200">
          <div className="h-[64px] flex items-center justify-between px-4 border-b border-surface-border">
            <span className="text-sm font-semibold text-slate-200">Menu</span>
            <button onClick={() => setSecondaryOpen(false)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors"
              title="Close menu">
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
            {[
              ...secondaryNav,
              { _section: 'Contacts' },
              ...contactsSubItems,
              ...(isAdmin ? [{ _section: 'Settings' }, ...settingsSubItems,
                              ...(isSuperAdmin ? superAdminSettingsItems : [])] : []),
              { _section: 'About' },
              { _action: 'about', icon: Building2, label: 'About _NXCORE' },
            ].map((item, idx) => {
              if (item._section) {
                return (
                  <p key={`sec-${idx}`} className="px-3 pt-3 pb-1 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    {item._section}
                  </p>
                )
              }
              const Icon = item.icon
              if (item._action === 'about') {
                return (
                  <button key="about" onClick={() => { setSecondaryOpen(false); setAboutOpen(true) }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 border border-transparent text-slate-400 hover:text-slate-100 hover:bg-surface-hover">
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                    <span>{item.label}</span>
                  </button>
                )
              }
              return (
                <NavLink key={item.to} to={item.to} end={item.to === '/'}
                  onClick={() => setSecondaryOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 border
                     ${isActive
                       ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                       : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'}`
                  }>
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
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
