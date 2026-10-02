import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Scale, Wallet, Landmark, TrendingUp, FileDown, CheckCircle2, Circle, Loader, AlertCircle,
  Pencil, X, RotateCcw, Info,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import SearchField from '../components/ui/SearchField'
import {
  fetchSubscriptions, saveSubscription, contactLabel, todayStr, PAYMENT_METHODS,
} from '../lib/subscriptions'
import { fetchPriceFloors, salePrice, fmtPerPeriod, DEFAULT_FLOORS } from '../lib/subscriptionPrices'
import {
  isPartnerSubscription, accountOf, accountTotals, ACCOUNT_STATUS, fmtAccount,
} from '../lib/subscriptionAccounts'
import { downloadSubscriptionAccountsPdf } from '../lib/subscriptionAccountsPdf'

/* SUBSCRIPTION ACCOUNTS (fix172) — the money side of partner subscriptions.

   Every partner login opens a one-year subscription at the admin's price,
   switched on at once. This page follows the money that is then owed both ways:
   the partner to the office, and the office to the super admin (the minimum,
   per subscription). Admin and super admin only — the route is gated, since
   prices are for administrators. The admin records the partners' payments;
   only the super admin records that the office has settled with them. */

const ymd = (ts) => (ts ? String(ts).slice(0, 10) : '')

function Chips({ value, onChange, options }) {
  return (
    <div className="flex items-center gap-1">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${value === v
            ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
            : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function SubscriptionAccountsPage() {
  const { currentUser, hasRole } = useAuth()
  const isSuperAdmin = hasRole('super_admin')
  const myName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || ''

  const [rows, setRows]       = useState([])
  const [logins, setLogins]   = useState(new Map())
  const [floors, setFloors]   = useState(DEFAULT_FLOORS)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [notice, setNotice]   = useState('')

  const [search, setSearch]     = useState('')
  const [year, setYear]         = useState('all')
  const [payF, setPayF]         = useState('all')       // all | paid | pending
  const [settleF, setSettleF]   = useState('all')       // all | settled | due
  const [showFree, setShowFree] = useState(false)
  const [picked, setPicked]     = useState(() => new Set())

  const [payFor, setPayFor]       = useState(null)
  const [payForm, setPayForm]     = useState({ paid_on: '', method: 'Cash', reference: '', note: '' })
  const [settleOpen, setSettleOpen] = useState(false)
  const [settleForm, setSettleForm] = useState({ on: '', reference: '' })
  const [vendorFor, setVendorFor] = useState(null)
  const [vendorDraft, setVendorDraft] = useState('')
  const [dlgErr, setDlgErr]       = useState('')
  const [busy, setBusy]           = useState(false)

  const today = todayStr()

  const load = useCallback(async () => {
    setLoading(true)
    const [{ rows: all, error: e }, { data: us }, fl] = await Promise.all([
      fetchSubscriptions(),
      // Never select('*') here: the table also holds the password hashes.
      supabase.from('user_accounts').select('id, username').not('contact_id', 'is', null),
      fetchPriceFloors(),
    ])
    setRows((all ?? []).filter(isPartnerSubscription))
    setLogins(new Map((us ?? []).map(u => [u.id, u.username])))
    setFloors(fl.floors)
    setError(e || '')
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // fix172 adds the super admin's columns; without them that side is unknown.
  const installed = !rows.length || rows.some(r => 'vendor_amount' in r)
  const loginName = useCallback((r) => logins.get(r.user_account_id) || '', [logins])

  const years = useMemo(() => [...new Set(rows.map(r => String(r.start_date || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      const a = accountOf(r, today)
      if (a.free && !showFree) return false
      if (year !== 'all' && String(r.start_date || '').slice(0, 4) !== year) return false
      if (payF === 'paid' && !(a.received && !a.free)) return false
      if (payF === 'pending' && (a.received || a.free)) return false
      if (settleF === 'settled' && !a.settled) return false
      if (settleF === 'due' && (a.settled || !(a.vendor > 0))) return false
      if (q && ![contactLabel(r.contact), loginName(r), r.description].some(v => String(v || '').toLowerCase().includes(q))) return false
      return true
    }).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))
  }, [rows, search, year, payF, settleF, showFree, today, loginName])

  const totals = useMemo(() => accountTotals(shown, today), [shown, today])
  const freeCount = rows.filter(r => accountOf(r, today).free).length

  // ── the partner's payment (admin and super admin) ───────────────────────
  function openPay(r) {
    setPayForm({ paid_on: today, method: 'Cash', reference: '', note: r.paid_by_note || '' })
    setDlgErr(''); setPayFor(r)
  }
  async function recordPayment() {
    if (!payForm.reference.trim()) { setDlgErr('Enter the payment reference — receipt, transfer or cheque number.'); return }
    if (!payForm.paid_on) { setDlgErr('Enter the date the money was received.'); return }
    setBusy(true)
    const err = await saveSubscription({
      ...payFor, is_paid: true,
      paid_at: new Date(`${payForm.paid_on}T12:00:00`).toISOString(),
      payment_method: payForm.method, payment_reference: payForm.reference.trim(),
      paid_recorded_by: myName, paid_by_note: payForm.note,
    }, { userId: currentUser?.user_id ?? null })
    setBusy(false)
    if (err) { setDlgErr(err); return }
    setPayFor(null); setNotice(`Payment recorded for ${contactLabel(payFor.contact)}.`); load()
  }
  async function markUnpaid(r) {
    if (!window.confirm(`Mark ${contactLabel(r.contact)} as NOT paid? The recorded payment is cleared. `
      + (r.is_active ? 'Their access stays on, with the payment due.' : ''))) return
    setBusy(true)
    const err = await saveSubscription({
      ...r, is_paid: false, paid_at: null, payment_method: null, payment_reference: null, paid_recorded_by: null,
      // Still switched on: it goes back to "on, payment due" rather than closing.
      ...(r.is_active ? { credit_granted_at: r.credit_granted_at || new Date().toISOString(),
                          credit_granted_by: r.credit_granted_by || myName } : {}),
    }, { userId: currentUser?.user_id ?? null })
    setBusy(false)
    if (err) setError(err); else load()
  }

  // ── the office's settlement with the super admin (super admin only) ──────
  const pickedRows = shown.filter(r => picked.has(r.id))
  const pickedTotals = accountTotals(pickedRows, today)
  function togglePick(id) { setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  async function settle(ids, settled, form = null) {
    if (settled && !form?.reference?.trim()) { setDlgErr('Enter the reference of the payment you received.'); return }
    setBusy(true)
    const { error: e } = await supabase.rpc('super_admin_settle_subscriptions', {
      p_actor_id: currentUser?.user_id, p_ids: ids, p_settled: settled,
      p_settled_on: settled ? (form?.on || today) : null, p_reference: settled ? form.reference.trim() : null,
    })
    setBusy(false)
    if (e) { const m = /not exist|schema cache/i.test(e.message) ? 'Settlements need supabase-fix172.sql.' : e.message; settled ? setDlgErr(m) : setError(m); return }
    setSettleOpen(false); setPicked(new Set())
    setNotice(settled ? `Settlement recorded for ${ids.length} subscription${ids.length === 1 ? '' : 's'}.` : 'Settlement undone.')
    load()
  }
  async function saveVendor() {
    const n = Number(vendorDraft)
    if (vendorDraft === '' || !(n >= 0)) { setDlgErr('Enter an amount — 0 or more.'); return }
    setBusy(true)
    const { error: e } = await supabase.rpc('super_admin_set_subscription_vendor', {
      p_actor_id: currentUser?.user_id, p_id: vendorFor.id, p_amount: n,
    })
    setBusy(false)
    if (e) { setDlgErr(e.message); return }
    setVendorFor(null); load()
  }

  async function exportPdf() {
    const note = [year !== 'all' ? `started in ${year}` : '', payF !== 'all' ? `partner payment ${payF}` : '',
      settleF !== 'all' ? `settlement ${settleF}` : '', search.trim() ? `matching "${search.trim()}"` : ''].filter(Boolean).join(', ')
    await downloadSubscriptionAccountsPdf(shown, { loginName, filterNote: note, generatedBy: myName, today })
  }

  const currencies = Object.keys(totals)

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Scale className="w-5 h-5 text-brand-400" />
        <div className="relative flex-1 max-w-xs">
          <SearchField value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a partner or login…" className="input pl-9" />
        </div>
        <select className="input w-auto py-1.5 text-xs" value={year} onChange={e => setYear(e.target.value)} aria-label="Year">
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>Started in {y}</option>)}
        </select>
        <Chips value={payF} onChange={setPayF} options={[['all', 'All'], ['paid', 'Partner paid'], ['pending', 'Partner pending']]} />
        <Chips value={settleF} onChange={setSettleF} options={[['all', 'All'], ['settled', 'Settled'], ['due', 'Due to super admin']]} />
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
          <input type="checkbox" className="accent-brand-500" checked={showFree} onChange={e => setShowFree(e.target.checked)} />
          Free seats ({freeCount})
        </label>
        <button type="button" onClick={exportPdf} disabled={loading} className="btn-primary ml-auto">
          <FileDown className="w-4 h-4" /> PDF report
        </button>
      </div>

      {!installed && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200 text-xs">Run <span className="font-mono">supabase-fix172.sql</span> — until then what each subscription owes the super admin is not recorded.</p>
        </div>
      )}
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
      {notice && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/10 text-xs text-green-300">
          <CheckCircle2 className="w-4 h-4" /><span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="text-green-300/70 hover:text-green-200"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* The two accounts, per currency — never added across currencies. */}
      <div className="grid md:grid-cols-3 gap-3">
        {[
          { key: 'charged', Icon: Wallet, title: 'Charged to partners', lines: c => [['Total', c.charged, 'text-slate-100'], ['Received', c.received, 'text-green-300'], ['Pending', c.pending, 'text-amber-300']] },
          { key: 'owed', Icon: Landmark, title: 'Owed to the super admin', lines: c => [['Total', c.owed, 'text-slate-100'], ['Settled', c.settled, 'text-green-300'], ['Due', c.due, 'text-amber-300']] },
          { key: 'margin', Icon: TrendingUp, title: 'Office margin', lines: c => [['Price less what the super admin is owed', c.margin, 'text-brand-300']] },
        ].map(card => (
          <div key={card.key} className="card p-4" data-card={card.key}>
            <div className="flex items-center gap-2 mb-2">
              <card.Icon className="w-4 h-4 text-slate-400" />
              <span className="text-[11px] uppercase tracking-wider text-slate-500">{card.title}</span>
            </div>
            {currencies.length === 0 && <p className="text-xs text-slate-500">Nothing in this view.</p>}
            {currencies.map(c => (
              <div key={c} className="space-y-0.5 mb-1.5 last:mb-0">
                {card.lines(totals[c]).map(([label, v, cls]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-slate-500">{label}</span>
                    <span className={`tabular-nums font-semibold ${cls}`}>{fmtAccount(v, c)}</span>
                  </div>
                ))}
                {card.key === 'owed' && totals[c].unknown > 0 && (
                  <p className="text-[11px] text-rose-300">{totals[c].unknown} subscription{totals[c].unknown === 1 ? '' : 's'} with no amount owed recorded — not counted.</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-surface-border bg-surface-hover/30">
        <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400 leading-relaxed">
          Every partner login opens a one-year subscription at your price — today{' '}
          <span className="text-slate-200">{fmtAccount(salePrice('partner', floors), floors.partner.currency)} a year</span> — switched on at once.
          For each one the super admin is owed the minimum in force when it was opened (today {fmtPerPeriod(floors.partner)});
          what is left is the office&rsquo;s. Switched-off subscriptions still count{isSuperAdmin ? ' — set what one owes to 0 to waive it' : ''}.
        </p>
      </div>

      {isSuperAdmin && pickedRows.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-brand-500/30 bg-brand-500/10 text-xs">
          <span className="text-brand-200">{pickedRows.length} selected · due {Object.entries(pickedTotals).map(([c, t]) => fmtAccount(t.due, c)).join(' · ') || '—'}</span>
          <button type="button" className="btn-primary py-1.5 text-xs ml-auto"
            onClick={() => { setSettleForm({ on: today, reference: '' }); setDlgErr(''); setSettleOpen(true) }}>
            <Landmark className="w-3.5 h-3.5" /> Record settlement
          </button>
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      {/* The subscriptions */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-card">
              <tr className="border-b border-surface-border text-left text-slate-500 text-xs uppercase tracking-wider">
                {isSuperAdmin && <th className="px-3 py-3 w-8" />}
                <th className="px-4 py-3">Partner</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3">Partner payment</th>
                <th className="px-4 py-3 text-right">Owed to super admin</th>
                <th className="px-4 py-3">Settlement</th>
                <th className="px-4 py-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No partner subscriptions in this view</td></tr>
              ) : shown.map(r => {
                const a = accountOf(r, today)
                const st = ACCOUNT_STATUS[a.status]
                const canSettle = !a.free && a.vendor > 0
                return (
                  <tr key={r.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40" data-row={r.id}>
                    {isSuperAdmin && (
                      <td className="px-3 py-3">
                        {canSettle && !a.settled && (
                          <input type="checkbox" className="accent-brand-500" aria-label="Select for settlement"
                            checked={picked.has(r.id)} onChange={() => togglePick(r.id)} />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="text-slate-100 font-medium">{contactLabel(r.contact)}</p>
                      {loginName(r) && <p className="text-[11px] font-mono text-slate-500">@{loginName(r)}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{r.start_date}<br />to {r.end_date}</td>
                    <td className="px-4 py-3"><span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${st.cls}`}>{st.label}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-200 whitespace-nowrap">{a.free ? '—' : fmtAccount(a.price, a.currency)}</td>
                    <td className="px-4 py-3">
                      {a.free ? <span className="text-[11px] text-slate-500">nothing to pay</span>
                        : a.received ? (
                          <button type="button" onClick={() => markUnpaid(r)} disabled={busy}
                            title={`Paid ${ymd(r.paid_at)}${r.payment_method ? ` by ${r.payment_method}` : ''}${r.payment_reference ? `, ref ${r.payment_reference}` : ''}${r.paid_recorded_by ? ` — recorded by ${r.paid_recorded_by}` : ''}. Click to mark unpaid.`}
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2 py-1 bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Paid {ymd(r.paid_at)}
                          </button>
                        ) : (
                          <button type="button" onClick={() => openPay(r)} disabled={busy}
                            title="Record the partner's payment — date, method and reference"
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2 py-1 bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15">
                            <Circle className="w-3.5 h-3.5" /> Pending — record
                          </button>
                        )}
                      {a.received && r.payment_reference && <p className="text-[10px] font-mono text-slate-500 mt-0.5">{r.payment_method ? `${r.payment_method} · ` : ''}{r.payment_reference}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                      <span className={a.vendor == null ? 'text-rose-300 text-xs' : 'text-slate-200'}>
                        {a.vendor == null ? 'not set' : fmtAccount(a.vendor, a.vendorCurrency)}
                      </span>
                      {isSuperAdmin && !a.free && (
                        <button type="button" title="Correct what this subscription owes you" aria-label="Correct the amount owed"
                          onClick={() => { setVendorFor(r); setVendorDraft(a.vendor == null ? '' : String(a.vendor)); setDlgErr('') }}
                          className="btn-ghost p-1 ml-1 text-slate-500 hover:text-slate-200"><Pencil className="w-3 h-3" /></button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!canSettle ? <span className="text-[11px] text-slate-500">—</span>
                        : a.settled ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-green-300"
                            title={`Settled ${ymd(r.vendor_settled_at)}${r.vendor_settled_by ? ` — recorded by ${r.vendor_settled_by}` : ''}`}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Settled {ymd(r.vendor_settled_at)}
                            {isSuperAdmin && (
                              <button type="button" title="Undo this settlement" onClick={() => settle([r.id], false)}
                                className="btn-ghost p-0.5 text-slate-500 hover:text-slate-200"><RotateCcw className="w-3 h-3" /></button>
                            )}
                          </span>
                        ) : <span className="text-[11px] text-amber-300">Due</span>}
                      {a.settled && r.vendor_reference && <p className="text-[10px] font-mono text-slate-500 mt-0.5">{r.vendor_reference}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-brand-300 whitespace-nowrap">{a.margin == null ? '—' : fmtAccount(a.margin, a.currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── record the partner's payment ── */}
      {payFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4" onClick={() => setPayFor(null)}>
          <div className="card w-full max-w-md" role="dialog" aria-label="Record the partner's payment" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">Record the partner&rsquo;s payment</h3>
              <p className="text-xs text-slate-500 mt-0.5">{contactLabel(payFor.contact)} · {fmtAccount(payFor.amount, payFor.currency)} · {payFor.start_date} to {payFor.end_date}</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="acc-pay-date">Received on *</label>
                  <input id="acc-pay-date" type="date" className="input" value={payForm.paid_on}
                    onChange={e => setPayForm(f => ({ ...f, paid_on: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="acc-pay-method">Method *</label>
                  <select id="acc-pay-method" className="input" value={payForm.method}
                    onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="acc-pay-ref">Reference *</label>
                <input id="acc-pay-ref" className="input font-mono" autoFocus value={payForm.reference} placeholder="Receipt, transfer or cheque number"
                  onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="acc-pay-note">Note</label>
                <input id="acc-pay-note" className="input" value={payForm.note} placeholder="Optional"
                  onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))} />
              </div>
              {dlgErr && <p className="text-xs text-red-400">{dlgErr}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border">
              <button type="button" className="btn-ghost" onClick={() => setPayFor(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={recordPayment} disabled={busy}>
                {busy ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Record payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── the super admin records the office's settlement ── */}
      {settleOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4" onClick={() => setSettleOpen(false)}>
          <div className="card w-full max-w-md" role="dialog" aria-label="Record settlement" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">Record settlement</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                The office has paid you for {pickedRows.length} subscription{pickedRows.length === 1 ? '' : 's'}: {Object.entries(pickedTotals).map(([c, t]) => fmtAccount(t.due, c)).join(' · ')}
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="settle-on">Received on *</label>
                  <input id="settle-on" type="date" className="input" value={settleForm.on} onChange={e => setSettleForm(f => ({ ...f, on: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="settle-ref">Reference *</label>
                  <input id="settle-ref" className="input font-mono" autoFocus value={settleForm.reference} placeholder="Receipt or transfer number"
                    onChange={e => setSettleForm(f => ({ ...f, reference: e.target.value }))} />
                </div>
              </div>
              {dlgErr && <p className="text-xs text-red-400">{dlgErr}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border">
              <button type="button" className="btn-ghost" onClick={() => setSettleOpen(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={busy}
                onClick={() => settle(pickedRows.map(r => r.id), true, settleForm)}>
                <Landmark className="w-4 h-4" /> Record settlement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── the super admin corrects what a subscription owes ── */}
      {vendorFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4" onClick={() => setVendorFor(null)}>
          <div className="card w-full max-w-sm" role="dialog" aria-label="Amount owed to the super admin" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">What this subscription owes you</h3>
              <p className="text-xs text-slate-500 mt-0.5">{contactLabel(vendorFor.contact)} · sold at {fmtAccount(vendorFor.amount, vendorFor.currency)}</p>
            </div>
            <div className="p-5 space-y-2">
              <input type="number" min="0" step="0.01" className="input" aria-label="Amount owed" value={vendorDraft}
                onChange={e => setVendorDraft(e.target.value)} />
              <p className="text-[11px] text-slate-500">0 waives it — for a subscription that was never used, for example.</p>
              {dlgErr && <p className="text-xs text-red-400">{dlgErr}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border">
              <button type="button" className="btn-ghost" onClick={() => setVendorFor(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveVendor} disabled={busy}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
