import React, { useState } from 'react'
import {
  ShieldCheck, UserCog, KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2, Loader,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Self-service account module for the super_admin (the software's developer):
// change the login username and password. Hidden from everyone else in the
// sidebar and guarded here so a direct URL can't reach it either.
export default function DeveloperAccountPage() {
  const { currentUser, hasRole, changeUsername, changePassword } = useAuth()
  const isSuperAdmin = hasRole('super_admin')

  // ── Username form ──
  const [newUsername,    setNewUsername]    = useState('')
  const [usernamePw,     setUsernamePw]     = useState('')
  const [showUsernamePw, setShowUsernamePw] = useState(false)
  const [uError,         setUError]         = useState('')
  const [uSaved,         setUSaved]         = useState(false)
  const [uBusy,          setUBusy]          = useState(false)

  // ── Password form ──
  const [current,    setCurrent]    = useState('')
  const [next,       setNext]       = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [showPw,     setShowPw]     = useState(false)
  const [pError,     setPError]     = useState('')
  const [pSaved,     setPSaved]     = useState(false)
  const [pBusy,      setPBusy]      = useState(false)

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-slate-400">You don't have permission to view this page.</p>
      </div>
    )
  }

  async function submitUsername(e) {
    e.preventDefault()
    setUError(''); setUSaved(false)
    if (!newUsername.trim())          { setUError('Enter a new username.'); return }
    if (newUsername.trim().length < 3) { setUError('Username must be at least 3 characters.'); return }
    if (!usernamePw)                  { setUError('Enter your current password to confirm.'); return }

    setUBusy(true)
    const result = await changeUsername(usernamePw, newUsername)
    setUBusy(false)
    if (result.success) {
      setUSaved(true); setNewUsername(''); setUsernamePw('')
    } else {
      setUError(result.error)
    }
  }

  async function submitPassword(e) {
    e.preventDefault()
    setPError(''); setPSaved(false)
    if (!current)         { setPError('Enter your current password.'); return }
    if (next.length < 8)  { setPError('New password must be at least 8 characters.'); return }
    if (next === current) { setPError('Choose a password different from the current one.'); return }
    if (next !== confirm) { setPError('New password and confirmation do not match.'); return }

    setPBusy(true)
    const result = await changePassword(current, next)
    setPBusy(false)
    if (result.success) {
      setPSaved(true); setCurrent(''); setNext(''); setConfirm('')
    } else {
      setPError(result.error)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mt-0.5">
              Change the super-admin username and password. Signed in as{' '}
              <span className="text-slate-300 font-medium">{currentUser?.username}</span>.
            </p>
          </div>
        </div>

        {/* ── Change username ── */}
        <form onSubmit={submitUsername} className="card p-5 space-y-4" noValidate>
          <div className="flex items-center gap-2">
            <UserCog className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-slate-100">Change username</h2>
          </div>

          <div>
            <label className="label">New username</label>
            <input className="input" value={newUsername} maxLength={100} autoComplete="off"
              onChange={e => { setNewUsername(e.target.value); setUError(''); setUSaved(false) }}
              placeholder={currentUser?.username || 'New username'} disabled={uBusy} />
          </div>

          <div>
            <label className="label">Current password</label>
            <div className="relative">
              <input type={showUsernamePw ? 'text' : 'password'} className="input pr-10"
                value={usernamePw} autoComplete="current-password"
                onChange={e => { setUsernamePw(e.target.value); setUError(''); setUSaved(false) }}
                placeholder="Confirm with your password" disabled={uBusy} />
              <button type="button" onClick={() => setShowUsernamePw(s => !s)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                {showUsernamePw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {uError && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs leading-relaxed">{uError}</p>
            </div>
          )}
          {uSaved && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-green-300 text-xs leading-relaxed">Username updated. Use it the next time you sign in.</p>
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={uBusy}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors">
              {uBusy ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : <><UserCog className="w-4 h-4" /> Update username</>}
            </button>
          </div>
        </form>

        {/* ── Change password ── */}
        <form onSubmit={submitPassword} className="card p-5 space-y-4" noValidate>
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-slate-100">Change password</h2>
          </div>

          <div>
            <label className="label">Current password</label>
            <input type={showPw ? 'text' : 'password'} className="input"
              value={current} autoComplete="current-password"
              onChange={e => { setCurrent(e.target.value); setPError(''); setPSaved(false) }}
              placeholder="Your current password" disabled={pBusy} />
          </div>

          <div>
            <label className="label">New password</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} className="input pr-10"
                value={next} autoComplete="new-password"
                onChange={e => { setNext(e.target.value); setPError(''); setPSaved(false) }}
                placeholder="At least 8 characters" disabled={pBusy} />
              <button type="button" onClick={() => setShowPw(s => !s)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Confirm new password</label>
            <input type={showPw ? 'text' : 'password'} className="input"
              value={confirm} autoComplete="new-password"
              onChange={e => { setConfirm(e.target.value); setPError(''); setPSaved(false) }}
              placeholder="Re-enter new password" disabled={pBusy} />
          </div>

          {pError && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs leading-relaxed">{pError}</p>
            </div>
          )}
          {pSaved && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-green-300 text-xs leading-relaxed">Password changed successfully.</p>
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={pBusy}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors">
              {pBusy ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : <><KeyRound className="w-4 h-4" /> Change password</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
