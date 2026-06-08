import React, { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, Package, PackageCheck, MapPin, BarChart3,
  Building2, Tag, ChevronLeft, ChevronRight, FileText, Receipt,
  ChevronDown, BookUser, Building, UserCheck, Handshake, Settings, UserCog,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import logo from '../../assets/Logo.png'

const mainNav = [
  { to: '/',                   icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/deliveries',         icon: Package,         label: 'Orders'        },
  { to: '/closed-orders',      icon: PackageCheck,    label: 'Closed Orders' },
  { to: '/drivers',            icon: Users,           label: 'Drivers'   },
  { to: '/tracking',           icon: MapPin,          label: 'Tracking'  },
  { to: '/reports',            icon: BarChart3,       label: 'Reports'   },
]

const bottomNav = [
  { to: '/products',           icon: Tag,             label: 'Products'  },
  { to: '/purchase-invoices',  icon: FileText,        label: 'Purchases' },
  { to: '/retail-invoices',    icon: Receipt,         label: 'Retail Invoices' },
  { to: '/company',            icon: Building2,       label: 'Company'   },
]

const contactsSubItems = [
  { to: '/contacts/suppliers', icon: Building,   label: 'Suppliers' },
  { to: '/contacts/customers', icon: UserCheck,  label: 'Customers' },
  { to: '/contacts/partners',  icon: Handshake,  label: 'Partners'  },
]

const settingsSubItems = [
  { to: '/settings/users', icon: UserCog, label: 'User Accounts' },
]

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
  const { hasRole } = useAuth()
  const location  = useLocation()

  const isAdmin = hasRole('super_admin', 'admin')

  const [collapsed,     setCollapsed]     = useState(true)
  const [contactsOpen,  setContactsOpen]  = useState(false)
  const [settingsOpen,  setSettingsOpen]  = useState(false)
  const [tip,           setTip]           = useState({ label: '', y: 0, visible: false })

  const isContactsActive = location.pathname.startsWith('/contacts/')
  const isSettingsActive = location.pathname.startsWith('/settings/')

  function showTip(e, label) {
    const rect = e.currentTarget.getBoundingClientRect()
    setTip({ label, y: rect.top + rect.height / 2, visible: true })
  }
  function hideTip() { setTip(t => ({ ...t, visible: false })) }

  function handleCollapse() { setCollapsed(true); setTip(t => ({ ...t, visible: false })) }

  function handleContactsClick() {
    if (collapsed) { setCollapsed(false); setContactsOpen(true) }
    else setContactsOpen(o => !o)
  }

  function handleSettingsClick() {
    if (collapsed) { setCollapsed(false); setSettingsOpen(true) }
    else setSettingsOpen(o => !o)
  }

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

          {/* Main nav items */}
          {mainNav.map(({ to, icon, label }) => (
            <NavItem key={to} to={to} icon={icon} label={label} collapsed={collapsed}
              onMouseEnter={collapsed ? (e) => showTip(e, label) : undefined}
              onMouseLeave={collapsed ? hideTip : undefined}
            />
          ))}

          {/* ── Contacts group ──────────────────────────────────── */}
          <div>
            <button
              onClick={handleContactsClick}
              onMouseEnter={collapsed ? (e) => showTip(e, 'Contacts') : undefined}
              onMouseLeave={collapsed ? hideTip : undefined}
              className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 border
                ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                ${isContactsActive
                  ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'
                }`}
            >
              <BookUser className="w-[18px] h-[18px] flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Contacts</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${contactsOpen ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>

            {/* Sub-items — expanded sidebar only */}
            {!collapsed && contactsOpen && (
              <div className="ml-3 mt-0.5 pl-2.5 border-l border-surface-border space-y-0.5">
                {contactsSubItems.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 border
                       ${isActive
                         ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                         : 'text-slate-500 hover:text-slate-100 hover:bg-surface-hover border-transparent'
                       }`
                    }
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>

          {/* Bottom nav items */}
          {bottomNav.map(({ to, icon, label }) => (
            <NavItem key={to} to={to} icon={icon} label={label} collapsed={collapsed}
              onMouseEnter={collapsed ? (e) => showTip(e, label) : undefined}
              onMouseLeave={collapsed ? hideTip : undefined}
            />
          ))}

          {/* ── Settings group (admins only) ────────────────────── */}
          {isAdmin && (
            <div>
              <button
                onClick={handleSettingsClick}
                onMouseEnter={collapsed ? (e) => showTip(e, 'Settings') : undefined}
                onMouseLeave={collapsed ? hideTip : undefined}
                className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 border
                  ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                  ${isSettingsActive
                    ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'
                  }`}
              >
                <Settings className="w-[18px] h-[18px] flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Settings</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${settingsOpen ? 'rotate-180' : ''}`} />
                  </>
                )}
              </button>

              {!collapsed && settingsOpen && (
                <div className="ml-3 mt-0.5 pl-2.5 border-l border-surface-border space-y-0.5">
                  {settingsSubItems.map(({ to, icon: Icon, label }) => (
                    <NavLink key={to} to={to}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors duration-150 border
                         ${isActive
                           ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                           : 'text-slate-500 hover:text-slate-100 hover:bg-surface-hover border-transparent'
                         }`
                      }
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* ── Expand button (collapsed) ──────────────────────────── */}
        {collapsed && (
          <div className="flex justify-center py-3 border-t border-surface-border">
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
      </aside>

      {/* ── Floating tooltip ───────────────────────────────────── */}
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
