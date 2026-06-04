import React, { useState } from 'react'
import { ShieldAlert, Eye, EyeOff, X, KeyRound, AlertCircle, Loader, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Shown after a successful login when the account is flagged must_change_password
// (a brand-new account or an admin password reset). The user cannot reach the
// app until they set a new password of their own.
export default function ForcePasswordChangePage() {
  const { currentUser, changePassword, logout } = useAuth()
  const [current,  setCurrent]  = useState('')
  const [next,     setNext]     = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const electron = window.electron

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!current)            { setError('Enter the password you just signed in with.'); return }
    if (next.length < 8)     { setError('New password must be at least 8 characters.'); return }
    if (next === current)    { setError('Choose a password different from the temporary one.'); return }
    if (next !== confirm)    { setError('New password and confirmation do not match.'); return }

    setLoading(true)
    const result = await changePassword(current, next)
    setLoading(false)

    if (!result.success) setError(result.error)
    // On success, AuthContext clears the flag and AppShell renders the app.
  }

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      {/* Frameless title bar */}
      <div className="h-8 flex items-center justify-end px-2 flex-shrink-0" style={{ WebkitAppRegion: 'drag' }}>
        {electron && (
          <button
            onClick={() => electron.window.close()}
            className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30">
              <ShieldAlert className="w-8 h-8 text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Set a new password</h1>
              <p className="text-slate-500 text-sm mt-0.5">
                You must change your password before continuing.
              </p>
            </div>
          </div>

          <div className="card p-7 space-y-5 shadow-2xl shadow-black/40">
            <p className="text-slate-400 text-xs">
              Signed in as <span className="text-slate-200 font-medium">{currentUser?.username}</span>.
              Your username is set by your administrator and cannot be changed.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="label">Temporary password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input"
                  placeholder="The password you just used"
                  value={current}
                  onChange={e => { setCurrent(e.target.value); setError('') }}
                  autoComplete="current-password"
                  autoFocus
                  disabled={loading}
                />
              </div>

              <div>
                <label className="label">New password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="At least 8 characters"
                    value={next}
                    onChange={e => { setNext(e.target.value); setError('') }}
                    autoComplete="new-password"
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

              <div>
                <label className="label">Confirm new password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input"
                  placeholder="Re-enter new password"
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setError('') }}
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm py-2.5 rounded-lg transition-colors duration-150 shadow-md shadow-brand-900/40"
              >
                {loading
                  ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</>
                  : <><KeyRound className="w-4 h-4" /> Change password & continue</>
                }
              </button>
            </form>

            <button
              onClick={async () => { await logout() }}
              className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
