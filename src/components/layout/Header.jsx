import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, Square, X, Bell, LogOut, ChevronDown } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const pageTitles = {
  '/':           'Dashboard',
  '/drivers':    'Driver Management',
  '/deliveries': 'Deliveries',
  '/tracking':   'Real-time Tracking',
  '/reports':    'Reports & Analytics',
  '/settings/users': 'User Accounts',
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
  const electron             = window.electron
  const [userMenu, setUserMenu] = useState(false)

  const initials = currentUser
    ? `${currentUser.first_name?.[0] ?? ''}${currentUser.last_name?.[0] ?? ''}`.toUpperCase() || 'U'
    : 'U'

  return (
    <header
      className="relative z-40 h-12 bg-surface-card border-b border-surface-border flex items-center px-4 gap-4 flex-shrink-0"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Title */}
      <h1 className="text-sm font-semibold text-slate-100 flex-1">{title}</h1>

      {/* Actions */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        {/* Notification bell */}
        <button className="btn-ghost p-2 relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-brand-500 rounded-full" />
        </button>

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
