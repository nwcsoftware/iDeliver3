import React, { useCallback, useEffect, useState } from 'react'
import {
  ShieldCheck, Check, X, Loader, AlertCircle, CalendarClock, FileText, ArrowLeft, FileDown,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { getDeviceName } from '../../lib/device'
import {
  SUBSCRIPTION_PLANS, PLAN_CURRENCY, DEFAULT_PLAN, TRIAL_PLAN_DAYS, planByKey,
  AGREEMENT_VERSION, agreementText, fetchAgreement, saveAgreement, fetchTrialEnd,
  daysToTrialEnd, fetchAgreementParty,
} from '../../lib/subscriptionAgreement'
import { downloadAgreementPdf } from '../../lib/subscriptionAgreementPdf'

/* The subscription agreement, shown to a supplier / partner before their portal
   opens (supabase-fix128.sql).

   It stands between sign-in and everything else on purpose: the fees are what
   the whole arrangement rests on, so they are read and accepted once, in the
   open, rather than assumed. Accepting is recorded with who, when and from
   which device; declining is recorded too and shown to the office, because a
   partner who says no is information the office needs, not an error.

   It fails OPEN. If the migration hasn't been run, or the lookup itself fails,
   the portal is shown as before — a subscription screen is not worth locking
   working shops out of their orders over. */

const dmy = (d) => {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : String(d)
}

export default function SubscriptionAgreementGate({ contactId, companyId = null, children }) {
  const { currentUser, logout } = useAuth()

  const [state,   setState]   = useState('loading')  // loading | ask | declined | open
  const [trialEnd, setTrialEnd] = useState(null)
  const [checked, setChecked] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [reason,  setReason]  = useState('')
  const [party,   setParty]   = useState(null)   // the subscriber, for the PDF

  const planKey = DEFAULT_PLAN
  const plan    = planByKey(planKey)

  const load = useCallback(async () => {
    if (!contactId) { setState('open'); return }          // unlinked login: nothing to agree to
    const [{ status, missing, error: err }, end, who] = await Promise.all([
      fetchAgreement(contactId),
      fetchTrialEnd(contactId),
      fetchAgreementParty(contactId),
    ])
    setTrialEnd(end)
    setParty(who)
    // Missing table or a failed lookup → let them work.
    if (missing || err)          { setState('open'); return }
    if (status === 'agreed')     { setState('open'); return }
    if (status === 'rejected')   { setState('declined'); return }
    setState('ask')
  }, [contactId])

  useEffect(() => { load() }, [load])

  async function answer(status) {
    setSaving(true); setError('')
    const { error: err } = await saveAgreement(contactId, status, {
      companyId,
      userId:   currentUser?.user_id ?? null,
      userName: `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || null,
      device:   getDeviceName(),
      note:     status === 'rejected' ? reason : null,
      planKey,
      trialEndsOn: trialEnd,
    })
    setSaving(false)
    if (err) { setError(err); return }
    setState(status === 'agreed' ? 'open' : 'declined')
  }

  if (state === 'open')    return children
  if (state === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-surface">
        <Loader className="w-5 h-5 animate-spin text-brand-400" />
      </div>
    )
  }

  /* Declined — they keep the way back. Someone who says no today may say yes
     tomorrow, and making them ask an administrator to reopen it helps nobody. */
  if (state === 'declined') {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-surface">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <X className="w-6 h-6 text-red-400" />
        </div>
        <p className="text-slate-100 font-semibold">You didn’t accept the subscription agreement</p>
        <p className="text-slate-400 text-sm max-w-md leading-relaxed">
          Your pages stay closed until the agreement is accepted. The office can see that you declined
          and may contact you about it — or you can read it again and accept.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => { setConfirmDecline(false); setReason(''); setChecked(false); setState('ask') }}
            className="btn-ghost px-4 py-2 text-sm border border-surface-border text-slate-200">
            <ArrowLeft className="w-4 h-4" /> Read it again
          </button>
          <button onClick={logout} className="btn-primary px-4 py-2 text-sm">Sign out</button>
        </div>
      </div>
    )
  }

  const daysLeft = daysToTrialEnd(trialEnd)

  return (
    <div className="h-screen overflow-y-auto bg-surface">
      <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
        <div className="card w-full max-w-2xl">

          {/* Header */}
          <div className="flex items-start gap-3 px-5 sm:px-6 py-5 border-b border-surface-border">
            <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-brand-300" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-slate-100">Subscription agreement</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Please read and accept before you continue. Version {AGREEMENT_VERSION}.
              </p>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-5 space-y-5">

            {/* The free period they are on right now */}
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 flex items-start gap-3">
              <CalendarClock className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-green-300 font-medium">
                  You have {TRIAL_PLAN_DAYS} free days on the {plan.name} plan
                  {daysLeft != null && daysLeft >= 0 && (
                    <span className="text-green-200/80 font-normal"> — {daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>
                  )}
                </p>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  {trialEnd
                    ? <>Nothing is charged until <span className="text-slate-200">{dmy(trialEnd)}</span>. After that the {plan.name} fee of {plan.price} {PLAN_CURRENCY} per month applies unless you ask us to change your plan.</>
                    : <>Nothing is charged during the free period. After it the {plan.name} fee of {plan.price} {PLAN_CURRENCY} per month applies unless you ask us to change your plan.</>}
                </p>
              </div>
            </div>

            {/* The published fees */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-2">Monthly subscription fees</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {SUBSCRIPTION_PLANS.map(p => {
                  const mine = p.key === planKey
                  return (
                    <div key={p.key}
                      className={`rounded-lg border p-3 ${mine
                        ? 'border-brand-500/40 bg-brand-500/5'
                        : 'border-surface-border bg-surface-hover/30'}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-100">{p.name}</span>
                        {mine && <span className="text-[10px] px-1.5 py-0.5 rounded border border-brand-500/30 bg-brand-500/10 text-brand-300">your plan</span>}
                      </div>
                      <p className="mt-1 text-lg font-bold text-slate-100 tabular-nums">
                        {p.price} <span className="text-xs font-medium text-slate-500">{PLAN_CURRENCY}/month</span>
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{p.blurb}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* The wording that gets stored with their answer */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> What you are agreeing to
              </p>
              <div className="rounded-lg border border-surface-border bg-surface-hover/20 p-4 max-h-56 overflow-y-auto">
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                  {agreementText({ trialEndsOn: trialEnd, planKey })}
                </p>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-xs">{error}</p>
              </div>
            )}

            {/* Declining asks once more, and lets them say why — the office sees it. */}
            {confirmDecline ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
                <p className="text-sm text-slate-200">Decline the agreement?</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your pages will stay closed and the office will see that you declined. You can accept
                  later from this same screen.
                </p>
                <textarea className="input text-xs" rows={2} value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Anything you want the office to know (optional)" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmDecline(false)} disabled={saving}
                    className="btn-ghost px-3 py-1.5 text-xs border border-surface-border text-slate-300">Back</button>
                  <button onClick={() => answer('rejected')} disabled={saving}
                    className="px-3 py-1.5 text-xs rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-60">
                    {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : 'Yes, decline'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 mt-0.5 accent-emerald-500"
                    checked={checked} onChange={e => { setChecked(e.target.checked); setError('') }} />
                  <span className="text-sm text-slate-200 leading-relaxed">
                    I have read the agreement and I agree to pay the monthly subscription fee for my plan
                    after the free {TRIAL_PLAN_DAYS} days.
                  </span>
                </label>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setConfirmDecline(true)} disabled={saving}
                      className="btn-ghost px-4 py-2 text-sm border border-surface-border text-slate-400 hover:text-red-300">
                      I do not agree
                    </button>
                    {/* A copy to keep, or to sign on paper — theirs before they answer. */}
                    <button onClick={() => downloadAgreementPdf({ contact: party, agreement: null, trialEnd })}
                      className="btn-ghost px-3 py-2 text-sm border border-surface-border text-slate-400 hover:text-slate-200"
                      title="Download this agreement as a PDF">
                      <FileDown className="w-4 h-4" /> PDF
                    </button>
                  </div>
                  <button onClick={() => answer('agreed')} disabled={!checked || saving}
                    className="btn-primary px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                    {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</>
                      : <><Check className="w-4 h-4" /> I agree — continue</>}
                  </button>
                </div>
              </>
            )}

            <p className="text-[11px] text-slate-600">
              Signed in as {currentUser?.username}. Your answer is recorded with the date and this device.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
