import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Wallet, Package, HandCoins, Truck, AlertCircle, CheckCircle2, Clock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { CURRENCIES, buildPartnerDues } from '../lib/partnerDues'

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const fmtMoney = (v, c) => `${c} ${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })}`
const fmtDate = ts => (ts ? new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—')

/* "My Statement" in the supplier/partner portal — what 3asari3 owes them.

     total packages delivered
   − paid directly by the customer   (packages flagged "paid direct")
   − received from 3asari3           (partner_payouts, i.e. the Partner Dues page's Pay button)
   − delivery fees charged to them   (fees on orders where THEY are the customer)
   = pending balance

   Read-only: every figure is derived from closed orders and payout records. */
export default function PartnerStatementPage({ partyContactId = null }) {
  const { currentUser } = useAuth()
  const { orders, loading, loadFullOrderHistory } = useApp()
  const contactId = partyContactId || currentUser?.contact_id || null

  // Balances span the whole history, not just the recent window.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [payouts,    setPayouts]    = useState([])
  const [payLoading, setPayLoading] = useState(true)
  const [error,      setError]      = useState('')

  const fetchPayouts = useCallback(async () => {
    if (!contactId) { setPayouts([]); setPayLoading(false); return }
    setPayLoading(true)
    const { data, error: e } = await supabase
      .from('partner_payouts')
      .select('*')
      .eq('partner_id', contactId)
      .order('paid_at', { ascending: false })
    if (e) setError(e.message)
    else   { setPayouts(data ?? []); setError('') }
    setPayLoading(false)
  }, [contactId])

  useEffect(() => { fetchPayouts() }, [fetchPayouts])

  /* Packages delivered + what has been settled, straight from the same
     calculation the office's Partner Dues page uses. */
  const dues = useMemo(() => {
    const list = buildPartnerDues({ orders, payouts })
    return list.find(p => p.id === contactId) || null
  }, [orders, payouts, contactId])

  /* How many packages were delivered (closed orders carrying their packages),
     and the delivery fees charged to them — fees on orders where this contact
     is the customer, i.e. the ones they pay for. */
  const extras = useMemo(() => {
    let packages = 0
    let deliveries = 0
    const fees = {}
    for (const o of orders) {
      if (!o.isclosed) continue
      const mine = (o.delivery_packages ?? []).filter(pk => pk.provider_id === contactId)
      if (mine.length) { packages += mine.length; deliveries += 1 }
      if (o.customer_id === contactId) {
        const cur = CURRENCIES.includes(o.currency) ? o.currency : 'USD'
        const fee = round2(o.delivery_fee)
        if (fee) fees[cur] = round2((fees[cur] || 0) + fee)
      }
    }
    return { packages, deliveries, fees }
  }, [orders, contactId])

  /* Per-currency statement lines. Balance = delivered − paid direct − received
     − delivery fees charged to them. */
  const lines = useMemo(() => {
    const curs = new Set([...(dues?.curs ?? []), ...Object.keys(extras.fees)])
    return [...curs].filter(c => CURRENCIES.includes(c)).map(c => {
      const b = dues?.cur?.[c] ?? { delivered: 0, paidDirect: 0, paidOut: 0 }
      const fee = round2(extras.fees[c] || 0)
      return {
        cur: c,
        delivered:  round2(b.delivered),
        paidDirect: round2(b.paidDirect),
        received:   round2(b.paidOut),
        fees:       fee,
        balance:    round2(b.delivered - b.paidDirect - b.paidOut - fee),
      }
    })
  }, [dues, extras])

  const busy = payLoading || loading?.orders

  if (!contactId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Wallet className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">No linked contact</p>
        <p className="text-slate-500 text-sm">Your login isn’t linked to a supplier/partner contact yet.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-brand-400" />
        <h2 className="text-base font-semibold text-slate-100">My Statement</h2>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* Headline counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Packages delivered
          </p>
          <p className="text-xl font-bold text-slate-100 mt-1 tabular-nums">{busy ? '…' : extras.packages}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">across {extras.deliveries} delivered order{extras.deliveries === 1 ? '' : 's'}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5">
            <HandCoins className="w-3.5 h-3.5" /> Received from 3asari3
          </p>
          <div className="mt-1 space-y-0.5">
            {lines.filter(l => l.received).length === 0
              ? <p className="text-xl font-bold text-slate-500 tabular-nums">—</p>
              : lines.filter(l => l.received).map(l => (
                  <p key={l.cur} className="text-base font-bold text-green-300 tabular-nums">{fmtMoney(l.received, l.cur)}</p>
                ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{payouts.length} payment{payouts.length === 1 ? '' : 's'}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Pending balance
          </p>
          <div className="mt-1 space-y-0.5">
            {lines.filter(l => l.balance).length === 0
              ? <p className="text-xl font-bold text-[#1dffd5] tabular-nums">Settled</p>
              : lines.filter(l => l.balance).map(l => (
                  <p key={l.cur} className={`text-base font-bold tabular-nums ${l.balance > 0 ? 'text-amber-300' : 'text-[#1dffd5]'}`}>
                    {fmtMoney(l.balance, l.cur)}
                  </p>
                ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">what 3asari3 still owes you</p>
        </div>
      </div>

      {/* The calculation, per currency */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Currency', 'Total packages', 'Paid directly by customer', 'Received from 3asari3', 'Delivery fees charged to you', 'Pending balance'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : lines.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No delivered packages yet.</td></tr>
            ) : lines.map(l => (
              <tr key={l.cur} className="border-b border-surface-border/50">
                <td className="px-4 py-3 text-slate-200 font-medium">{l.cur}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-100">{fmtMoney(l.delivered, l.cur)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {l.paidDirect ? `− ${fmtMoney(l.paidDirect, l.cur)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-green-300">
                  {l.received ? `− ${fmtMoney(l.received, l.cur)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                  {l.fees ? `− ${fmtMoney(l.fees, l.cur)}` : '—'}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums font-semibold ${l.balance > 0 ? 'text-amber-300' : 'text-[#1dffd5]'}`}>
                  {fmtMoney(l.balance, l.cur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Pending balance = total packages − paid directly by the customer − received from 3asari3 − delivery fees charged to you.
        Only delivered (closed) orders count.
      </p>

      {/* Money received — the payouts recorded on the Partner Dues page */}
      <div>
        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
          <HandCoins className="w-3.5 h-3.5" /> Money received from 3asari3
        </p>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border">
                {['Date', 'Amount', 'Method', 'Reference / notes'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payLoading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : payouts.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No payments received yet.</td></tr>
              ) : payouts.map(p => (
                <tr key={p.id} className="border-b border-surface-border/50">
                  <td className="px-4 py-2.5 text-slate-300 text-xs whitespace-nowrap">{fmtDate(p.paid_at)}</td>
                  <td className="px-4 py-2.5 text-green-300 tabular-nums whitespace-nowrap">
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 -mt-px" />
                    {fmtMoney(p.amount, p.currency || 'USD')}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs capitalize">{(p.method || 'cash').replace('_', ' ')}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{p.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delivery fees they are charged */}
      {Object.keys(extras.fees).length > 0 && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-surface-hover/40 border border-surface-border rounded-lg">
          <Truck className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Delivery fees on orders you requested are charged to you, so they are deducted from what you are owed:{' '}
            {Object.entries(extras.fees).map(([c, v]) => fmtMoney(v, c)).join(' + ')}.
          </p>
        </div>
      )}
    </div>
  )
}
