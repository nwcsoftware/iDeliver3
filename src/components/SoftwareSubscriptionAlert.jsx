import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, X, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  fetchDueSoftwareSubscriptions, daysUntil, todayStr, fmtMoney,
  paymentSummary, REMINDER_DAYS,
} from '../lib/softwareSubscriptions'

/* "Your software subscription is due" — shown once when the application starts.

   Office users (call center and admins) see it from REMINDER_DAYS before a
   subscription expires, and every start-up after that until it is renewed. A
   confirmed payment covering past the expiry date silences it (the rule lives
   in needsReminder), so nobody is nagged about something already paid.

   Dismissing hides it for this run of the app — it comes back next start-up,
   which is the point: it should keep asking until someone renews. */
export default function SoftwareSubscriptionAlert() {
  const { hasRole } = useAuth()
  const { COMPANY_ID } = useApp()
  const navigate = useNavigate()

  // The people who act on it. The super admin manages subscriptions from the
  // page itself and is reminded there, so they are not interrupted here.
  const shouldSee = hasRole('admin', 'call_center')
  const canOpenPage = hasRole('admin')

  const [rows, setRows]   = useState([])
  const [open, setOpen]   = useState(false)

  useEffect(() => {
    if (!shouldSee) return
    let cancelled = false
    ;(async () => {
      const { rows: due } = await fetchDueSoftwareSubscriptions(COMPANY_ID)
      if (cancelled || due.length === 0) return
      // One reminder per launch of the app.
      const seen = sessionStorage.getItem('ideliver:swSubReminder')
      if (seen === 'dismissed') return
      setRows(due); setOpen(true)
    })()
    return () => { cancelled = true }
  }, [shouldSee, COMPANY_ID])

  if (!open || rows.length === 0) return null

  const close = () => {
    sessionStorage.setItem('ideliver:swSubReminder', 'dismissed')
    setOpen(false)
  }
  const today = todayStr()
  const worst = Math.min(...rows.map(r => daysUntil(r.expiry_date, today) ?? 99))

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={close}>
      <div className="card w-full max-w-md overflow-hidden shadow-2xl shadow-black/50" onClick={e => e.stopPropagation()}>
        <div className={`flex items-center gap-2 px-5 py-3 border-b border-surface-border ${
          worst < 0 ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
          {worst < 0
            ? <AlertCircle className="w-4 h-4 text-red-300" />
            : <CalendarClock className="w-4 h-4 text-amber-300" />}
          <span className="text-sm font-semibold text-slate-100">
            {worst < 0 ? 'Software subscription expired' : 'Software subscription due'}
          </span>
          <button onClick={close} className="btn-ghost p-1.5 ml-auto text-slate-500 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-400">
            {rows.length === 1
              ? 'This subscription needs renewing:'
              : `${rows.length} subscriptions need renewing:`}
          </p>

          <div className="space-y-2">
            {rows.map(r => {
              const d = daysUntil(r.expiry_date, today)
              const s = paymentSummary(r)
              const late = d < 0
              return (
                <div key={r.id} className={`rounded-lg border px-3 py-2.5 ${
                  late ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-slate-100">{r.software_name}</span>
                    <span className={`ml-auto text-[11px] font-semibold ${late ? 'text-red-300' : 'text-amber-300'}`}>
                      {late
                        ? `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`
                        : d === 0 ? 'Due today' : `due in ${d} day${d === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Expires {r.expiry_date}
                    {Number(r.amount) > 0 && <> · {fmtMoney(r.amount, r.currency)}</>}
                    {s.due > 0 && <span className="text-fuchsia-300"> · {fmtMoney(s.due, r.currency)} outstanding</span>}
                  </p>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-slate-500">
            You are told {REMINDER_DAYS} days ahead. This stops once a renewal payment is confirmed.
          </p>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-surface-border">
          <button onClick={close} className="btn-ghost text-xs border border-surface-border ml-auto">Dismiss</button>
          {canOpenPage && (
            <button onClick={() => { close(); navigate('/settings/software-subscriptions') }}
              className="btn-primary text-xs">
              <CalendarClock className="w-3.5 h-3.5" /> View subscriptions
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
