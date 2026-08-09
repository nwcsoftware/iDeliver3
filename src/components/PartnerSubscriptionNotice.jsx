import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  fetchSubscriptionsForContact, subscriptionNotice, SUBSCRIPTION_NOTICE_DAYS,
} from '../lib/subscriptions'

/* The subscription bar in the supplier / partner portal header.

   Same idea as LicenseNotice, but the data is the signed-in 2nd party's own
   rows in `subscriptions`, found through their linked contact. It appears a
   month before their cover ends and stays until they hold a subscription that
   is paid, activated and dated past that point — the same condition that lets
   them sign in at all, so the bar clears exactly when their access is safe. */
const REFRESH_MS = 10 * 60 * 1000

export default function PartnerSubscriptionNotice() {
  const { currentUser, hasRole } = useAuth()
  const navigate = useNavigate()

  const isParty   = hasRole('partner', 'supplier')
  const contactId = currentUser?.contact_id || null

  const [notice, setNotice] = useState(null)

  const check = useCallback(async () => {
    if (!contactId) return
    const { rows } = await fetchSubscriptionsForContact(contactId)
    setNotice(subscriptionNotice(rows))
  }, [contactId])

  useEffect(() => {
    if (!isParty || !contactId) return
    check()
    // Keep looking, so activating a renewal clears the bar without a restart.
    const t = setInterval(check, REFRESH_MS)
    return () => clearInterval(t)
  }, [isParty, contactId, check])

  if (!isParty || !notice) return null

  const { row, days, expired, pendingRenewal, none } = notice

  const headline = none
    ? 'No active subscription'
    : expired
      ? `Subscription expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
      : days === 0
        ? 'Subscription expires today'
        : `Subscription ends in ${days} day${days === 1 ? '' : 's'}`

  const title = [
    none ? 'You have no paid, activated subscription.' : `Your subscription runs to ${row.end_date}.`,
    pendingRenewal
      ? 'A renewal has been recorded and is waiting for payment confirmation.'
      : 'Contact the office to renew — access stops when it expires.',
    'Click to open My Subscription.',
  ].join(' ')

  const Icon = expired || none ? AlertTriangle : CalendarClock
  const tone = expired || none
    ? 'bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25'
    : 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25'
  const dot  = expired || none ? 'bg-red-400' : 'bg-amber-400'

  return (
    <button
      type="button"
      onClick={() => navigate('/my-subscription')}
      title={title}
      style={{ WebkitAppRegion: 'no-drag' }}
      className={`relative flex items-center gap-2 max-w-[42vw] px-3 py-1.5 rounded-lg border
                  text-[11px] font-medium shadow-lg backdrop-blur-sm transition-colors cursor-pointer ${tone}`}
    >
      <span className="relative flex w-2 h-2 flex-shrink-0">
        <span className={`absolute inline-flex w-full h-full rounded-full opacity-70 animate-ping ${dot}`} />
        <span className={`relative inline-flex w-2 h-2 rounded-full ${dot}`} />
      </span>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="whitespace-nowrap">{headline}</span>
      {pendingRenewal && (
        <span className="hidden md:inline flex-shrink-0 rounded-full bg-black/25 px-1.5 py-0.5 text-[10px]">
          renewal pending
        </span>
      )}
    </button>
  )
}
