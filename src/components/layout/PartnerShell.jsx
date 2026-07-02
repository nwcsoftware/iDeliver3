import React from 'react'
import { HashRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { Package, PackageCheck, AlertCircle } from 'lucide-react'
import { AppProvider } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import Header from './Header'
import BroadcastPopup from '../messages/BroadcastPopup'
import DeliveriesPage from '../../pages/DeliveriesPage'
import logo from '../../assets/Logo.png'

// Supplier & Partner users get a locked-down portal: the only screens they can
// reach are Sold Orders (the daily order list) and Completed Orders (the closed
// orders list). No other route is mounted here, so nothing else is reachable.
const navItems = [
  { to: '/sold-orders',      icon: Package,      label: 'Sold Orders' },
  { to: '/completed-orders', icon: PackageCheck, label: 'Completed Orders' },
]

export default function PartnerShell() {
  const { currentUser } = useAuth()
  // Orders are scoped to this 2nd party's own contact. A login that isn't linked
  // to a contact can't own any orders — surface that instead of an empty list.
  const partyContactId = currentUser?.contact_id || null

  return (
    <AppProvider>
      <HashRouter>
        <div className="h-screen flex flex-col overflow-hidden">
          <BroadcastPopup />
          <Header />
          <div className="flex flex-1 overflow-hidden">

            {/* Minimal sidebar — just the two allowed screens */}
            <aside className="w-56 flex-shrink-0 bg-surface-card border-r border-surface-border flex flex-col">
              <div className="h-[64px] flex items-center gap-3 px-4 border-b border-surface-border">
                <img src={logo} alt="iDeliver" className="w-9 h-9 object-contain" />
                <div className="min-w-0">
                  <p className="text-white font-bold text-base leading-none">iDeliver</p>
                  <p className="text-brand-400 text-xs font-semibold tracking-widest mt-0.5">III</p>
                </div>
              </div>
              <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
                {navItems.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 border
                       ${isActive
                         ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                         : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover border-transparent'}`
                    }>
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </nav>
            </aside>

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
                {/* Any other path falls back to the default screen. */}
                <Route path="*" element={<Navigate to="/sold-orders" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </HashRouter>
    </AppProvider>
  )
}
