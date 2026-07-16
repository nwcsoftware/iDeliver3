import React, { useState, useRef } from 'react'
import { Eye, EyeOff, X, LogIn, AlertCircle, Loader, Headset, Store } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/Logo.png'

// Which login tab is active. Persisted so the box reopens on the last one used.
const TAB_KEY = 'ideliver_login_tab'
const TABS = [
  { id: 'staff',   label: 'Call Center',        mode: 'staff',   icon: Headset,
    help: 'Use your username, email, or mobile number' },
  { id: 'partner', label: 'Partner / Supplier', mode: 'partner', icon: Store,
    help: 'Sign in to your partner or supplier account' },
]

export default function LoginPage() {
  const { login } = useAuth()
  const [tab,        setTab]        = useState(() => (localStorage.getItem(TAB_KEY) === 'partner' ? 'partner' : 'staff'))
  const [identifier, setIdentifier] = useState('')
  const [password,   setPassword]   = useState('')
  const [showPw,     setShowPw]     = useState(false)
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const idRef = useRef(null)

  const electron = window.electron
  const activeTab = TABS.find(t => t.id === tab) || TABS[0]

  function selectTab(id) {
    setTab(id)
    setError('')
    localStorage.setItem(TAB_KEY, id)
    idRef.current?.focus()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!identifier.trim()) { setError('Please enter your username, email, or mobile.'); return }
    if (!password)           { setError('Please enter your password.'); return }

    setLoading(true)
    const result = await login(identifier, password, activeTab.mode)
    setLoading(false)

    if (!result.success) {
      setError(result.error)
      idRef.current?.focus()
    }
  }

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">

      {/* Frameless title bar — drag region + close */}
      <div
        className="h-8 flex items-center justify-end px-2 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' }}
      >
        {electron && (
          <button
            onClick={() => electron.window.close()}
            className="w-6 h-6 rounded flex items-center justify-center text-slate-600
                       hover:text-red-400 hover:bg-red-500/10 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">

          {/* Logo */}
          <div className="text-center space-y-3">
            <img src={logo} alt="iDeliver" className="inline-block w-20 h-20 object-contain" />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">iDeliver <span className="text-brand-400">III</span></h1>
              <p className="text-slate-500 text-sm mt-0.5">Delivery Management System</p>
            </div>
          </div>

          {/* Card */}
          <div className="card p-7 space-y-5 shadow-2xl shadow-black/40">
            {/* Login-type tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-surface-hover/60 rounded-lg">
              {TABS.map(t => {
                const Icon = t.icon
                const active = t.id === tab
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTab(t.id)}
                    disabled={loading}
                    className={`flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors
                                disabled:cursor-not-allowed
                                ${active
                                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/40'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'}`}
                  >
                    <Icon className="w-4 h-4" /> {t.label}
                  </button>
                )
              })}
            </div>

            <div>
              <h2 className="text-base font-semibold text-slate-100">Sign in to your account</h2>
              <p className="text-slate-500 text-xs mt-0.5">{activeTab.help}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Identifier */}
              <div>
                <label className="label">Username / Email / Mobile</label>
                <input
                  ref={idRef}
                  type="text"
                  className={`input ${error ? 'border-red-500/60 focus:ring-red-500' : ''}`}
                  placeholder="admin or admin@example.com"
                  value={identifier}
                  onChange={e => { setIdentifier(e.target.value); setError('') }}
                  autoComplete="username"
                  autoFocus
                  disabled={loading}
                />
              </div>

              {/* Password */}
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className={`input pr-10 ${error ? 'border-red-500/60 focus:ring-red-500' : ''}`}
                    placeholder="••••••••••"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500
                           disabled:opacity-60 disabled:cursor-not-allowed
                           text-white font-medium text-sm py-2.5 rounded-lg
                           transition-colors duration-150 shadow-md shadow-brand-900/40"
              >
                {loading
                  ? <><Loader className="w-4 h-4 animate-spin" /> Signing in…</>
                  : <><LogIn className="w-4 h-4" /> Sign In</>
                }
              </button>
            </form>
          </div>

          {/* Footer */}
          <p className="text-center text-slate-600 text-xs">
            iDeliver III &nbsp;·&nbsp; v3.00.0014
          </p>
        </div>
      </div>
    </div>
  )
}
