import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  fetchDueSoftwareSubscriptions, daysUntil, todayStr, LICENSE_NOTICE_DAYS,
} from '../lib/softwareSubscriptions'

/* The licence bar that sits in the application header.

   From LICENSE_NOTICE_DAYS (one month) before a software subscription expires,
   a bar appears in the header and STAYS there — it cannot be dismissed — until
   the licence is renewed, i.e. until a confirmed payment covers past the expiry
   date (the rule lives in needsReminder) or the expiry itself is moved on.

   Shown to call centre and admin users. The super admin manages the
   subscriptions page itself, so their header is left alone.

   Distinct from SoftwareSubscriptionAlert: that is the once-per-launch popup at
   10 days; this is the permanent reminder at 30. */
const REFRESH_MS = 10 * 60 * 1000     // re-check every 10 minutes

export default function LicenseNotice() {
  const { hasRole } = useAuth()
  const { COMPANY_ID } = useApp()
  const navigate = useNavigate()

  const shouldSee   = hasRole('admin', 'call_center')
  const canOpenPage = hasRole('admin')

  const [rows, setRows] = useState([])

  const check = useCallback(async () => {
    const { rows: due } = await fetchDueSoftwareSubscriptions(COMPANY_ID, { withinDays: LICENSE_NOTICE_DAYS })
    setRows(due)
  }, [COMPANY_ID])

  useEffect(() => {
    if (!shouldSee) return
    check()
    // Keep checking so the bar clears itself once the licence is renewed,
    // without anyone having to restart the application.
    const t = setInterval(check, REFRESH_MS)
    return () => clearInterval(t)
  }, [shouldSee, check])

  if (!shouldSee || rows.length === 0) return null

  const today = todayStr()
  // The most urgent one drives the wording and the colour.
  const worst = rows.reduce((a, b) =>
    (daysUntil(a.expiry_date, today) ?? 999) <= (daysUntil(b.expiry_date, today) ?? 999) ? a : b)
  const days = daysUntil(worst.expiry_date, today) ?? 0
  const late = days < 0

  const headline = late
    ? `Licence expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
    : days === 0
      ? 'Licence expires today'
      : `Licence due in ${days} day${days === 1 ? '' : 's'}`

  const title = `${worst.software_name} — expires ${worst.expiry_date}`
    + (rows.length > 1 ? ` · ${rows.length - 1} other subscription${rows.length === 2 ? '' : 's'} also due` : '')
    + (canOpenPage ? '. Click to open Software Subscriptions.' : '. Please inform the administration.')

  const Icon = late ? AlertTriangle : CalendarClock
  const tone = late
    ? 'bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25'
    : 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25'

  return (
    <button
      type="button"
      onClick={() => { if (canOpenPage) navigate('/settings/software-subscriptions') }}
      title={title}
      style={{ WebkitAppRegion: 'no-drag' }}
      className={`relative flex items-center gap-2 max-w-[42vw] px-3 py-1.5 rounded-lg border
                  text-[11px] font-medium shadow-lg backdrop-blur-sm transition-colors
                  ${tone} ${canOpenPage ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span className="relative flex w-2 h-2 flex-shrink-0">
        <span className={`absolute inline-flex w-full h-full rounded-full opacity-70 animate-ping
                          ${late ? 'bg-red-400' : 'bg-amber-400'}`} />
        <span className={`relative inline-flex w-2 h-2 rounded-full ${late ? 'bg-red-400' : 'bg-amber-400'}`} />
      </span>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="whitespace-nowrap">{headline}</span>
      <span className="hidden md:inline truncate opacity-80">— {worst.software_name}</span>
      {rows.length > 1 && (
        <span className="flex-shrink-0 rounded-full bg-black/25 px-1.5 py-0.5 text-[10px]">
          +{rows.length - 1}
        </span>
      )}
    </button>
  )
}
