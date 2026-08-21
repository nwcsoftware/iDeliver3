import React, { useCallback, useEffect, useState } from 'react'
import {
  CreditCard, CalendarRange, CheckCircle2, Circle, AlertCircle, Loader, Clock,
  ShieldCheck, ChevronRight, FileDown,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  fetchSubscriptionsForContact, subscriptionStatus, STATUS_STYLES, daysLeft, todayStr,
} from '../lib/subscriptions'
import {
  fetchAgreement, agreementText, AGREEMENT_STATUS, SUBSCRIPTION_PLANS, PLAN_CURRENCY,
  fetchAgreementParty,
} from '../lib/subscriptionAgreement'
import { downloadAgreementPdf } from '../lib/subscriptionAgreementPdf'

const dmy = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : String(d)
}
const money = (v, c) => `${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`

/* "My Subscription" in the supplier/partner portal — read-only. Shows the
   subscription that is letting them in (or the most recent one), how long is
   left, and the history of previous periods. Subscriptions are managed by the
   administration; there is nothing to change here. */
export default function MySubscriptionPage({ partyContactId = null }) {
  const { currentUser } = useAuth()
  const contactId = partyContactId || currentUser?.contact_id || null

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [agreement, setAgreement] = useState(null)   // their answer to the agreement
  const [party,     setParty]     = useState(null)   // their own details, for the PDF
  const [showTerms, setShowTerms] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ rows: r, error: e }, ag, who] = await Promise.all([
      fetchSubscriptionsForContact(contactId),
      fetchAgreement(contactId),
      fetchAgreementParty(contactId),
    ])
    setRows(r); setError(e || ''); setAgreement(ag.row); setParty(who); setLoading(false)
  }, [contactId])

  useEffect(() => { load() }, [load])

  const today   = todayStr()
  const current = rows.find(r => subscriptionStatus(r, today) === 'active') || rows[0] || null
  const others  = rows.filter(r => r !== current)
  const left    = current ? daysLeft(current.end_date, today) : null

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-brand-400" />
        <h2 className="text-base font-semibold text-slate-100">My Subscription</h2>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-slate-500 text-sm">Loading…</div>
      ) : error ? (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      ) : !current ? (
        <div className="card p-8 text-center space-y-2">
          <CreditCard className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-slate-300 text-sm font-medium">No subscription on file</p>
          <p className="text-slate-500 text-xs">Please contact the administration to set one up.</p>
        </div>
      ) : (() => {
        const st  = subscriptionStatus(current, today)
        const cfg = STATUS_STYLES[st] ?? STATUS_STYLES.deactivated
        return (
          <>
            {/* Current subscription */}
            <div className="card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    {current.description || 'Subscription'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                    <CalendarRange className="w-3.5 h-3.5" />
                    {dmy(current.start_date)} → {dmy(current.end_date)}
                  </p>
                </div>
                <span className={`text-[11px] border rounded px-2 py-0.5 ${cfg.cls}`}>{cfg.label}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Amount</p>
                  <p className="text-sm font-semibold text-slate-100 mt-1 tabular-nums">
                    {Number(current.amount) > 0 ? money(current.amount, current.currency) : 'Free'}
                  </p>
                </div>
                <div className="rounded-lg border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Payment</p>
                  <p className={`text-sm font-semibold mt-1 inline-flex items-center gap-1.5 ${
                    current.is_paid ? 'text-green-300' : 'text-fuchsia-300'}`}>
                    {current.is_paid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                    {current.is_paid ? 'Paid' : 'Unpaid'}
                  </p>
                </div>
                <div className="rounded-lg border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Access</p>
                  <p className={`text-sm font-semibold mt-1 ${current.is_active ? 'text-green-300' : 'text-slate-400'}`}>
                    {current.is_active ? 'Activated' : 'Not activated'}
                  </p>
                </div>
                <div className="rounded-lg border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Time left</p>
                  <p className={`text-sm font-semibold mt-1 ${
                    left == null ? 'text-slate-400' : left < 0 ? 'text-red-300' : left <= 7 ? 'text-amber-300' : 'text-slate-100'}`}>
                    {left == null ? '—' : left < 0 ? 'Ended' : left === 0 ? 'Last day' : `${left} day${left === 1 ? '' : 's'}`}
                  </p>
                </div>
              </div>

              {/* Heads-up when it is about to end or already blocking access */}
              {st === 'active' && left != null && left <= 7 && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-200 text-xs leading-relaxed">
                    Your subscription ends on {dmy(current.end_date)}. Contact the administration to renew it
                    and keep your access.
                  </p>
                </div>
              )}
              {st !== 'active' && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed">
                    {st === 'expired'     && `This subscription expired on ${dmy(current.end_date)}.`}
                    {st === 'unpaid'      && 'This subscription is awaiting payment confirmation.'}
                    {st === 'scheduled'   && `This subscription starts on ${dmy(current.start_date)}.`}
                    {st === 'deactivated' && 'This subscription is not active.'}
                    {' '}Please contact the administration.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Subscriptions are managed by the administration — this page is for your information only.
              </p>
            </div>

            {/* What they accepted, and the fees it commits them to. Kept on the
                page they already visit for their subscription, so the terms are
                never something they saw once and can't find again. */}
            {agreement?.status === 'agreed' && (
              <div className="card p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-4 h-4 text-green-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100">Subscription agreement accepted</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {agreement.responded_at ? `On ${dmy(String(agreement.responded_at).slice(0, 10))}` : 'Accepted'}
                      {agreement.responded_name ? ` by ${agreement.responded_name}` : ''}
                      {agreement.version ? ` · version ${agreement.version}` : ''}
                    </p>
                  </div>
                  <span className={`text-[11px] border rounded px-2 py-0.5 flex-shrink-0 ${AGREEMENT_STATUS.agreed.cls}`}>
                    {AGREEMENT_STATUS.agreed.label}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  {SUBSCRIPTION_PLANS.map(pl => (
                    <span key={pl.key}
                      className={`px-2 py-1 rounded-lg border ${
                        pl.key === (agreement.plan || 'basic')
                          ? 'bg-brand-500/10 text-brand-300 border-brand-500/30'
                          : 'border-surface-border text-slate-500'}`}>
                      {pl.name} {Number(pl.key === 'basic' ? agreement.basic_price
                        : pl.key === 'pro' ? agreement.pro_price
                        : agreement.pro_max_price) || pl.price} {agreement.currency || PLAN_CURRENCY}/month
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={() => setShowTerms(o => !o)}
                    className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200">
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showTerms ? 'rotate-90' : ''}`} />
                    {showTerms ? 'Hide the agreement' : 'Read the agreement'}
                  </button>
                  {/* Their own copy, as accepted — the prices and dates of that day. */}
                  <button onClick={() => downloadAgreementPdf({ contact: party, agreement })}
                    className="flex items-center gap-1.5 text-[11px] text-brand-300 hover:text-brand-200">
                    <FileDown className="w-3.5 h-3.5" /> Download PDF
                  </button>
                </div>
                {showTerms && (
                  <div className="rounded-lg border border-surface-border bg-surface-hover/20 p-4">
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                      {agreement.agreement_text || agreementText({ trialEndsOn: agreement.trial_ends_on, planKey: agreement.plan })}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Previous periods */}
            {others.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Previous subscriptions</p>
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-border">
                        {['Description', 'From', 'To', 'Amount', 'Status'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {others.map(r => {
                        const s = subscriptionStatus(r, today)
                        const c = STATUS_STYLES[s] ?? STATUS_STYLES.deactivated
                        return (
                          <tr key={r.id} className="border-b border-surface-border/50">
                            <td className="px-4 py-3 text-slate-300">{r.description || '—'}</td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{dmy(r.start_date)}</td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{dmy(r.end_date)}</td>
                            <td className="px-4 py-3 text-slate-300 tabular-nums">
                              {Number(r.amount) > 0 ? money(r.amount, r.currency) : 'Free'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-[11px] border rounded px-2 py-0.5 ${c.cls}`}>{c.label}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}
