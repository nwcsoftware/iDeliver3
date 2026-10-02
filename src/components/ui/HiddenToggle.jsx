import React, { useState } from 'react'
import { Eye, EyeOff, Loader } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { setHidden } from '../../lib/hidden'

/* The super admin's hide / show switch for a login, contact or subscription
   (fix176), with the "Hidden" badge beside it. Renders nothing for anyone
   else — they never see hidden records at all. */
export default function HiddenToggle({ kind, id, hidden, onDone, size = 'w-3.5 h-3.5' }) {
  const { currentUser, hasRole } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!hasRole('super_admin')) return null
  const what = kind === 'login' ? 'this login, its subscriptions and its contact'
    : kind === 'contact' ? 'this contact, its logins and its subscriptions' : 'this subscription'
  async function flip(e) {
    e?.stopPropagation?.()
    const next = !hidden
    if (next && !window.confirm(`Hide ${what}? Nobody but you will see it, and it is left out of every total and report. It can still sign in.`)) return
    setBusy(true)
    const { error } = await setHidden(currentUser?.user_id, kind, id, next)
    setBusy(false)
    if (error) { window.alert(error); return }
    onDone?.()
  }
  return (
    <span className="inline-flex items-center gap-1">
      {hidden && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-500/40 bg-slate-500/15 text-slate-300 whitespace-nowrap"
          title="Hidden: only you see it; left out of every total and report">Hidden</span>
      )}
      <button type="button" onClick={flip} disabled={busy} aria-label={hidden ? 'Show' : 'Hide'}
        title={hidden ? `Show ${what} again` : `Hide ${what} from everyone else and from every report`}
        className="btn-ghost p-1 text-slate-500 hover:text-slate-200 disabled:opacity-40">
        {busy ? <Loader className={`${size} animate-spin`} /> : hidden ? <Eye className={size} /> : <EyeOff className={size} />}
      </button>
    </span>
  )
}
