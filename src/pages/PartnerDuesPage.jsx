import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Handshake, Search, FilterX, HandCoins, X, AlertCircle, Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { CURRENCIES, buildPartnerDues, sumPartnerDues } from '../lib/partnerDues'

/* Partner Dues — what we owe each partner for the packages they sent through us.

   A package is collected from the customer unless it's flagged "Paid directly to
   <partner>", so:  dues = delivered − paid directly − paid to partner.

   The payout side lives in partner_payouts (fix82); everything else is derived
   live from closed orders, the same records the Cashier Box reads. */

const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'other']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}

export default function PartnerDuesPage() {
  const { orders, loading, COMPANY_ID } = useApp()
  const { currentUser, hasRole } = useAuth()
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || null
  const canPay = hasRole('super_admin', 'admin')

  const [payouts,    setPayouts]    = useState([])
  const [payLoading, setPayLoading] = useState(true)
  const [loadError,  setLoadError]  = useState('')

  const [search,   setSearch]   = useState('')
  const [dateFrom, setDateFrom] = useState('')   // blank = all time, so dues read as a true balance
  const [dateTo,   setDateTo]   = useState('')
  const [onlyDue,  setOnlyDue]  = useState(true)

  // Record-payout modal — an editable list of { currency, amount } lines, so one
  // payout can settle several currencies at once.
  const [payFor,    setPayFor]    = useState(null)   // the partner being paid
  const [payLines,  setPayLines]  = useState([])
  const [payMethod, setPayMethod] = useState('cash')
  const [payDate,   setPayDate]   = useState(() => new Date().toISOString().slice(0, 10))
  const [payNotes,  setPayNotes]  = useState('')
  const [posting,   setPosting]   = useState(false)
  const [postError, setPostError] = useState('')

  const fetchPayouts = useCallback(async () => {
    setPayLoading(true); setLoadError('')
    let q = supabase.from('partner_payouts').select('*').order('paid_at', { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error } = await q
    if (error) setLoadError(error.message)
    else       setPayouts(data ?? [])
    setPayLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { fetchPayouts() }, [fetchPayouts])

  const list = useMemo(
    () => buildPartnerDues({ orders, payouts, from: dateFrom, to: dateTo }),
    [orders, payouts, dateFrom, dateTo],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !String(p.code ?? '').toLowerCase().includes(q)) return false
      if (onlyDue && !p.curs.some(c => round2(p.cur[c].dues) !== 0)) return false
      return true
    })
  }, [list, search, onlyDue])

  const totals     = useMemo(() => sumPartnerDues(filtered), [filtered])
  const activeCurs = CURRENCIES.filter(c => Object.values(totals[c]).some(v => v !== 0))

  // Render one field of a partner's per-currency map as stacked lines.
  const curLines = (p, key, cls = 'text-slate-300') => {
    const rows = p.curs.filter(c => round2(p.cur[c][key]) !== 0)
    if (!rows.length) return <span className="text-slate-600">—</span>
    return rows.map(c => (
      <div key={c} className={`tabular-nums whitespace-nowrap ${cls}`}>{fmtMoney(p.cur[c][key], c)}</div>
    ))
  }

  /* ── record a payout ──────────────────────────────────────── */
  function openPay(p) {
    // Pre-fill a line per currency the partner is actually owed in.
    const owed = p.curs.filter(c => round2(p.cur[c].dues) > 0)
    setPayFor(p)
    setPayLines(owed.length
      ? owed.map(c => ({ currency: c, amount: String(p.cur[c].dues) }))
      : [{ currency: 'USD', amount: '' }])
    setPayMethod('cash'); setPayDate(new Date().toISOString().slice(0, 10))
    setPayNotes(''); setPostError(''); setPosting(false)
  }
  function closePay() { setPayFor(null); setPayLines([]); setPostError('') }

  const setLine = (i, k, v) => setPayLines(ls => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const addLine = () => setPayLines(ls => [...ls, { currency: 'USD', amount: '' }])
  const dropLine = i => setPayLines(ls => ls.filter((_, idx) => idx !== i))

  async function postPayout() {
    const rows = payLines
      .map(l => ({ currency: l.currency, amount: round2(l.amount) }))
      .filter(l => l.amount > 0)
    if (!rows.length) { setPostError('Enter an amount greater than zero.'); return }

    setPosting(true); setPostError('')
    const { error } = await supabase.from('partner_payouts').insert(
      rows.map(r => ({
        partner_id:   payFor.id,
        amount:       r.amount,
        currency:     r.currency,
        method:       payMethod,
        paid_at:      new Date(`${payDate}T12:00:00`).toISOString(),
        notes:        payNotes.trim() || null,
        paid_by:      currentUser?.user_id || null,
        paid_by_name: currentUserName,
        ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      })),
    )
    if (error) { setPostError(error.message); setPosting(false); return }
    setPosting(false); closePay(); fetchPayouts()
  }

  async function deletePayout(id) {
    const { error } = await supabase.from('partner_payouts').delete().eq('id', id)
    if (error) { setLoadError(error.message); return }
    fetchPayouts()
  }

  const busy = loading.orders || payLoading

  return (
    <div className="p-6 space-y-4">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Handshake className="w-5 h-5 text-purple-400" />
          <h1 className="text-lg font-semibold text-slate-100">Partner Dues</h1>
          <span className="text-xs text-slate-500">· {filtered.length} partner{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <p className="text-xs text-slate-500 -mt-2">
        Packages on closed orders are collected from the customer unless flagged “Paid directly to the partner”.
        Dues = delivered − paid directly − paid to partner.
      </p>

      {loadError && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>{loadError}</span>
        </div>
      )}

      {/* ── filters ────────────────────────────────────────── */}
      <div className="card p-3 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <label className="label">Search</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input className="input py-1.5 text-xs pl-8" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Partner name or code" />
          </div>
        </div>
        <div>
          <label className="label">Closed from</label>
          <input type="date" className="input py-1.5 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Closed to</label>
          <input type="date" className="input py-1.5 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <button type="button" onClick={() => setOnlyDue(o => !o)} aria-pressed={onlyDue}
          className={`h-[34px] px-3 rounded-lg text-xs font-medium border transition-colors ${
            onlyDue ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                    : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
          Outstanding only
        </button>
        {(search || dateFrom || dateTo) && (
          <button type="button" onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
            className="h-[34px] px-3 rounded-lg text-xs font-medium border border-surface-border text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5">
            <FilterX className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── summary ────────────────────────────────────────── */}
      {activeCurs.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">
            Totals{dateFrom || dateTo ? ` — ${dateFrom || '…'} → ${dateTo || '…'}` : ' — all time'}
          </h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${activeCurs.length}, minmax(0, 1fr))` }}>
            {activeCurs.map(c => (
              <div key={c} className="rounded-lg border border-surface-border p-3 space-y-1.5">
                <div className="text-xs font-semibold text-slate-400">{c}</div>
                {[
                  ['Delivered packages',  'delivered',        'text-slate-200'],
                  ['Paid directly',       'paidDirect',       'text-sky-300'],
                  ['Collected by drivers','collectedDrivers', 'text-green-300'],
                  ['Paid to partner',     'paidOut',          'text-purple-300'],
                ].map(([label, key, cls]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{label}</span>
                    <span className={`tabular-nums ${cls}`}>{fmtMoney(totals[c][key], c)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs border-t border-surface-border/50 pt-1.5">
                  <span className="text-slate-300 font-medium">Dues</span>
                  <span className={`tabular-nums font-semibold ${totals[c].dues > 0 ? 'text-amber-300' : 'text-[#1dffd5]'}`}>
                    {fmtMoney(totals[c].dues, c)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── per-partner table ──────────────────────────────── */}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/30">
              <th className="px-3 py-2 font-medium">Partner</th>
              <th className="px-3 py-2 font-medium text-right">Delivered packages</th>
              <th className="px-3 py-2 font-medium text-right">Paid directly to partner</th>
              <th className="px-3 py-2 font-medium text-right">Collected by drivers</th>
              <th className="px-3 py-2 font-medium text-right">Paid to partner</th>
              <th className="px-3 py-2 font-medium text-right">Partner dues</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-600">
                {onlyDue ? 'No partner has outstanding dues for this range.' : 'No partner package movement for this range.'}
              </td></tr>
            ) : filtered.map(p => (
              <tr key={p.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30 align-top">
                <td className="px-3 py-2">
                  <div className="text-slate-200">{p.name}</div>
                  {p.code && <div className="text-[10px] font-mono text-slate-500">{p.code}</div>}
                </td>
                <td className="px-3 py-2 text-right">{curLines(p, 'delivered', 'text-slate-200')}</td>
                <td className="px-3 py-2 text-right">{curLines(p, 'paidDirect', 'text-sky-300')}</td>
                <td className="px-3 py-2 text-right">{curLines(p, 'collectedDrivers', 'text-green-300')}</td>
                <td className="px-3 py-2 text-right">{curLines(p, 'paidOut', 'text-purple-300')}</td>
                <td className="px-3 py-2 text-right">
                  {p.curs.filter(c => round2(p.cur[c].dues) !== 0).length === 0
                    ? <span className="inline-flex items-center gap-1 text-[#1dffd5]"><CheckCircle2 className="w-3.5 h-3.5" /> Settled</span>
                    : p.curs.filter(c => round2(p.cur[c].dues) !== 0).map(c => (
                        <div key={c} className={`tabular-nums font-semibold whitespace-nowrap ${p.cur[c].dues > 0 ? 'text-amber-300' : 'text-[#1dffd5]'}`}>
                          {fmtMoney(p.cur[c].dues, c)}
                        </div>
                      ))}
                </td>
                <td className="px-3 py-2 text-right">
                  {canPay && (
                    <button type="button" onClick={() => openPay(p)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-purple-500/40 bg-purple-500/15 text-purple-200 hover:bg-purple-500/25 whitespace-nowrap">
                      <HandCoins className="w-3.5 h-3.5" /> Pay
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── recent payouts ─────────────────────────────────── */}
      {payouts.length > 0 && (
        <div className="card p-4 space-y-2">
          <h2 className="text-sm font-semibold text-slate-200">Recent payouts</h2>
          <p className="text-xs text-slate-500">Deleting a payout puts its amount back on the partner’s dues.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/30">
                  <th className="px-3 py-1.5 font-medium">Date</th>
                  <th className="px-3 py-1.5 font-medium">Partner</th>
                  <th className="px-3 py-1.5 font-medium">Method</th>
                  <th className="px-3 py-1.5 font-medium">Paid by</th>
                  <th className="px-3 py-1.5 font-medium">Notes</th>
                  <th className="px-3 py-1.5 font-medium text-right">Amount</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {payouts.slice(0, 25).map(p => {
                  const who = list.find(x => x.id === p.partner_id)
                  return (
                    <tr key={p.id} className="border-t border-surface-border/40">
                      <td className="px-3 py-1.5 text-slate-400">{String(p.paid_at).slice(0, 10)}</td>
                      <td className="px-3 py-1.5 text-slate-300">{who?.name ?? '—'}</td>
                      <td className="px-3 py-1.5 text-slate-400">{p.method}</td>
                      <td className="px-3 py-1.5 text-slate-400">{p.paid_by_name || '—'}</td>
                      <td className="px-3 py-1.5 text-slate-500">{p.notes || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-purple-300 whitespace-nowrap">{fmtMoney(p.amount, p.currency)}</td>
                      <td className="px-3 py-1.5 text-right">
                        {canPay && (
                          <button type="button" onClick={() => deletePayout(p.id)} title="Delete payout"
                            className="text-slate-500 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── payout modal ───────────────────────────────────── */}
      {payFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closePay}>
          <div className="card w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Pay {payFor.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">Records what we hand the partner; it comes off their dues.</p>
              </div>
              <button type="button" onClick={closePay} className="text-slate-500 hover:text-slate-200"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2">
              {payLines.map((l, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="w-24">
                    <label className="label">Currency</label>
                    <select className="input py-1.5 text-xs" value={l.currency} onChange={e => setLine(i, 'currency', e.target.value)}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="label">Amount</label>
                    <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={l.amount}
                      onChange={e => setLine(i, 'amount', e.target.value)} placeholder="0.00" />
                  </div>
                  {payLines.length > 1 && (
                    <button type="button" onClick={() => dropLine(i)} className="h-[34px] px-2 text-slate-500 hover:text-red-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addLine} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                <Plus className="w-3.5 h-3.5" /> Add currency
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Method</label>
                <select className="input py-1.5 text-xs" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input py-1.5 text-xs" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input py-1.5 text-xs" value={payNotes} onChange={e => setPayNotes(e.target.value)}
                placeholder="Reference / cheque no." />
            </div>

            {postError && (
              <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{postError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={closePay} className="px-3 py-1.5 rounded-lg text-xs border border-surface-border text-slate-400 hover:text-slate-200">Cancel</button>
              <button type="button" onClick={postPayout} disabled={posting}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50">
                {posting ? 'Saving…' : 'Record payout'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
