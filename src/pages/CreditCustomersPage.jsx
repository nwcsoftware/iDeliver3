import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { CreditCard, Search, FilterX, FileDown, HandCoins, X, Banknote, CheckCircle2, AlertCircle, User, ChevronRight, Plus, Scissors, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { orderTotalsByCurrency } from '../lib/orderAmounts'
import { formatAccountNumber } from '../lib/accountNumber'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* Multi-currency, matching Driver Settlements / Cashier Box. A currency only needs
   to exist in the DB currency_type enum and be listed here; zero columns hide. */
const CURRENCIES = ['USD', 'LBP', 'EUR']
const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'other']

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }
function emptyCur() { return Object.fromEntries(CURRENCIES.map(c => [c, 0])) }

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}

/* Render a per-currency map ({USD: 100, LBP: 50000}) as "USD 100.00 · LBP 50,000".
   Skips zero/empty currencies; returns "—" when nothing. */
function fmtCurMap(map) {
  const parts = CURRENCIES.filter(c => round2(map[c]) !== 0).map(c => fmtMoney(map[c], c))
  return parts.length ? parts.join(' · ') : '—'
}

function customerName(c) {
  if (!c) return '—'
  return (c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()) || '—'
}

/* The date an order lands on the account = when it was closed (else scheduled,
   else created) — what the user filters the statement by. */
function orderDate(o) {
  const raw = o.closed_at || o.scheduled_date || o.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

/* ── page ─────────────────────────────────────────────────── */

export default function CreditCustomersPage() {
  const { orders, loading, fetchOrders, COMPANY_ID } = useApp()
  const { currentUser } = useAuth()
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || null

  const [payments,     setPayments]     = useState([])      // credit_customer_payments rows
  const [clears,       setClears]       = useState([])      // credit_customer_clears rows
  const [payLoading,   setPayLoading]    = useState(true)
  const [selectedId,   setSelectedId]   = useState(null)    // selected customer_id
  const [showAll,      setShowAll]      = useState(false)   // expand statement past the clear checkpoint
  const [clearing,     setClearing]     = useState(false)

  const [search,       setSearch]       = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [statusFilter, setStatusFilter] = useState('outstanding')  // outstanding | settled | all

  // Collect-payment modal — an editable list of { currency, amount } lines.
  const [collectOpen,  setCollectOpen]  = useState(false)
  const [payLines,     setPayLines]     = useState([])
  const [payMethod,    setPayMethod]    = useState('cash')
  const [payDate,      setPayDate]      = useState(() => new Date().toISOString().slice(0, 10))
  const [payNotes,     setPayNotes]     = useState('')
  const [posting,      setPosting]      = useState(false)
  const [postError,    setPostError]    = useState('')

  /* ── fetch account-level payments ────────────────────────── */
  const fetchPayments = useCallback(async () => {
    setPayLoading(true)
    let q = supabase.from('credit_customer_payments').select('*').order('paid_at', { ascending: true })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error } = await q
    if (!error && data) setPayments(data)
    setPayLoading(false)
  }, [COMPANY_ID])

  /* ── fetch statement clear checkpoints ───────────────────── */
  const fetchClears = useCallback(async () => {
    let q = supabase.from('credit_customer_clears').select('*').order('cleared_through', { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error } = await q
    if (!error && data) setClears(data)
  }, [COMPANY_ID])

  useEffect(() => { fetchPayments(); fetchClears() }, [fetchPayments, fetchClears])

  // customer_id → latest cleared_through date ('YYYY-MM-DD'), the active checkpoint.
  const cutoffByCustomer = useMemo(() => {
    const m = new Map()
    for (const c of clears) {
      const d = String(c.cleared_through).slice(0, 10)
      if (!m.has(c.customer_id) || d > m.get(c.customer_id)) m.set(c.customer_id, d)
    }
    return m
  }, [clears])

  /* ── closed orders belonging to credit customers ─────────── */
  // Every CLOSED order whose customer is credit-allowed is a charge on that
  // customer's account, regardless of how the order was closed.
  const creditOrders = useMemo(
    () => orders.filter(o => o.isclosed === true && o.customer?.credit_debit_allowed === true),
    [orders],
  )

  // Group payments by customer for quick lookup.
  const paymentsByCustomer = useMemo(() => {
    const m = new Map()
    for (const p of payments) {
      if (!m.has(p.customer_id)) m.set(p.customer_id, [])
      m.get(p.customer_id).push(p)
    }
    return m
  }, [payments])

  /* ── per-customer account summary (charges − payments) ──────
     Built from ALL the customer's closed orders + payments so the balance is
     the true account balance. The date filter only narrows what's listed in the
     statement, never the running balance. */
  const accounts = useMemo(() => {
    const m = new Map()
    const ensure = (cust) => {
      if (!m.has(cust.id)) {
        m.set(cust.id, { customer: cust, orders: [], payments: [], charged: emptyCur(), paid: emptyCur() })
      }
      return m.get(cust.id)
    }
    for (const o of creditOrders) {
      const a = ensure(o.customer)
      a.orders.push(o)
      const t = orderTotalsByCurrency(o)
      for (const c of CURRENCIES) a.charged[c] += round2(t[c] || 0)
    }
    for (const [custId, ps] of paymentsByCustomer) {
      // A customer may have payments but (after a data reset) no orders loaded —
      // surface them anyway so the balance/credit is never silently dropped.
      const cust = creditOrders.find(o => o.customer_id === custId)?.customer
        || { id: custId, first_name: '', last_name: '', company_name: ps[0]?.customer_name || '' }
      const a = ensure(cust)
      a.payments.push(...ps)
      for (const p of ps) a.paid[p.currency || 'USD'] += round2(Number(p.amount) || 0)
    }
    // balance + a "has any outstanding currency" flag
    for (const a of m.values()) {
      a.balance = {}
      a.outstanding = false
      for (const c of CURRENCIES) {
        a.balance[c] = round2(a.charged[c] - a.paid[c])
        if (a.balance[c] > 0) a.outstanding = true
      }
    }
    return m
  }, [creditOrders, paymentsByCustomer])

  /* ── customer list (left pane) with search + status filter ── */
  const customerList = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...accounts.values()]
      .filter(a => {
        if (statusFilter === 'outstanding' && !a.outstanding) return false
        if (statusFilter === 'settled' && a.outstanding) return false
        if (!q) return true
        return [
          customerName(a.customer),
          a.customer.account_number,
          a.customer.mobile,
        ].some(v => String(v ?? '').toLowerCase().includes(q))
      })
      .sort((x, y) => customerName(x.customer).localeCompare(customerName(y.customer)))
  }, [accounts, search, statusFilter])

  const selected = selectedId ? accounts.get(selectedId) : null
  const cutoff   = selectedId ? (cutoffByCustomer.get(selectedId) || null) : null   // active clear date

  // Keep a valid selection as filters change.
  useEffect(() => {
    if (selectedId && !accounts.has(selectedId)) setSelectedId(null)
  }, [accounts, selectedId])

  // Collapse back to "since the checkpoint" whenever a different customer is opened.
  useEffect(() => { setShowAll(false) }, [selectedId])

  /* ── statement of the selected customer ─────────────────────
     Orders (debit) + payments (credit) merged chronologically. When the account
     has been cleared up to a date (and "Show all" is off), everything on/before
     that date is folded into one "Standing balance brought forward" opening line
     and only newer entries are listed. The date filter narrows the listed rows;
     the header balance cards always show the full account balance. */
  const statement = useMemo(() => {
    if (!selected) return []
    const inRange = (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo)
    const activeCutoff = showAll ? null : cutoff      // fold entries on/before this date

    const all = []
    for (const o of selected.orders) {
      all.push({
        kind: 'order', date: orderDate(o), ref: o.order_number || String(o.id).slice(0, 8),
        label: o.recipient_name || o.order_type || 'Order', debit: orderTotalsByCurrency(o), credit: null, _t: o.closed_at || o.created_at,
      })
    }
    for (const p of selected.payments) {
      all.push({
        kind: 'payment', date: (p.paid_at || p.created_at || '').slice(0, 10), ref: p.method || 'payment',
        label: p.notes || 'Account payment', debit: null, credit: { [p.currency || 'USD']: round2(Number(p.amount) || 0) }, _t: p.paid_at || p.created_at,
      })
    }
    all.sort((a, b) => String(a._t || a.date).localeCompare(String(b._t || b.date)))

    // Brought-forward opening balance = net of everything on/before the cutoff.
    const rows = []
    if (activeCutoff) {
      const opening = emptyCur()
      for (const r of all) {
        if (r.date && r.date <= activeCutoff) {
          if (r.debit)  for (const c of CURRENCIES) opening[c] += round2(r.debit[c] || 0)
          if (r.credit) for (const c of CURRENCIES) opening[c] -= round2(r.credit[c] || 0)
        }
      }
      const debit = {}, credit = {}
      for (const c of CURRENCIES) {
        const v = round2(opening[c])
        if (v > 0) debit[c] = v
        else if (v < 0) credit[c] = -v
      }
      rows.push({ kind: 'opening', date: activeCutoff, ref: '—', label: 'Standing balance brought forward',
        debit: Object.keys(debit).length ? debit : null, credit: Object.keys(credit).length ? credit : null, _t: '' })
    }

    for (const r of all) {
      if (activeCutoff && r.date && r.date <= activeCutoff) continue   // folded into opening
      if (!inRange(r.date)) continue
      rows.push(r)
    }
    return rows
  }, [selected, dateFrom, dateTo, cutoff, showAll])

  // Totals of what's currently listed in the statement (respects the date filter).
  const statementTotals = useMemo(() => {
    const charged = emptyCur(), paid = emptyCur()
    for (const r of statement) {
      if (r.debit)  for (const c of CURRENCIES) charged[c] += round2(r.debit[c] || 0)
      if (r.credit) for (const c of CURRENCIES) paid[c]    += round2(r.credit[c] || 0)
    }
    const balance = Object.fromEntries(CURRENCIES.map(c => [c, round2(charged[c] - paid[c])]))
    return { charged, paid, balance }
  }, [statement])

  const hasActiveFilters = search.trim() || dateFrom || dateTo || statusFilter !== 'outstanding'
  function clearFilters() { setSearch(''); setDateFrom(''); setDateTo(''); setStatusFilter('outstanding') }

  /* ── collect payment ─────────────────────────────────────── */
  // A new payment list always starts with one USD line and one LBP line.
  function defaultPayLines() {
    return [
      { _key: Date.now(),     currency: 'USD', amount: '' },
      { _key: Date.now() + 1, currency: 'LBP', amount: '' },
    ]
  }
  const addPayLine    = () => setPayLines(ls => [...ls, { _key: Date.now(), currency: CURRENCIES[0], amount: '' }])
  const removePayLine = (key) => setPayLines(ls => ls.filter(l => l._key !== key))
  const setPayLine    = (key, patch) => setPayLines(ls => ls.map(l => l._key === key ? { ...l, ...patch } : l))

  function openCollect() {
    setPayLines(defaultPayLines())
    setPayMethod('cash'); setPayDate(new Date().toISOString().slice(0, 10)); setPayNotes('')
    setPostError(''); setCollectOpen(true)
  }

  async function recordPayment() {
    if (!selected) return
    // Sum the lines by currency so multiple lines of the same currency combine.
    const byCur = {}
    for (const l of payLines) {
      const amt = round2(Number(l.amount) || 0)
      if (amt > 0) byCur[l.currency] = round2((byCur[l.currency] || 0) + amt)
    }
    const rows = Object.entries(byCur).map(([currency, amount]) => ({ currency, amount }))
    if (rows.length === 0) { setPostError('Enter an amount in at least one line.'); return }

    setPosting(true); setPostError('')
    const payload = rows.map(r => ({
      customer_id:       selected.customer.id,
      amount:            r.amount,
      currency:          r.currency,
      method:            payMethod,
      paid_at:           payDate ? new Date(payDate).toISOString() : new Date().toISOString(),
      notes:             payNotes.trim() || null,
      collected_by:      currentUser?.user_id || null,
      collected_by_name: currentUserName,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }))
    const { error } = await supabase.from('credit_customer_payments').insert(payload)
    if (error) { setPostError(error.message); setPosting(false); return }

    await fetchPayments()
    setPosting(false); setCollectOpen(false)
  }

  /* ── clear the statement (carry-forward checkpoint) ────────
     Records a checkpoint at the given date; everything on/before it folds into a
     "Standing balance brought forward" line next time. Defaults to yesterday. */
  async function clearStatement(throughDate) {
    if (!selected) return
    setClearing(true)
    const { error } = await supabase.from('credit_customer_clears').insert([{
      customer_id:     selected.customer.id,
      cleared_through: throughDate,
      created_by:      currentUser?.user_id || null,
      created_by_name: currentUserName,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }])
    setClearing(false)
    if (error) { window.alert(`Could not clear the statement: ${error.message}`); return }
    setShowAll(false)
    await fetchClears()
  }

  function clearAsOfYesterday() {
    const y = new Date(); y.setDate(y.getDate() - 1)
    const ymd = y.toISOString().slice(0, 10)
    if (window.confirm(`Clear ${customerName(selected.customer)}'s statement as of ${ymd}?\n\nEntries on or before that date will be summarised as a single brought-forward balance. Nothing is deleted — "Show all" still shows the full history.`)) {
      clearStatement(ymd)
    }
  }

  /* ── PDF — the selected customer's statement ─────────────── */
  function exportPDF() {
    if (!selected) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Credit Customer Statement', marginX, 16)
    doc.setFontSize(10); doc.setTextColor(40)
    doc.text(customerName(selected.customer), marginX, 23)
    doc.setFontSize(9); doc.setTextColor(110)
    if (selected.customer.account_number) doc.text(`Account: ${formatAccountNumber(selected.customer.account_number)}`, marginX, 28)
    const range = [dateFrom && `From ${dateFrom}`, dateTo && `To ${dateTo}`].filter(Boolean).join('   ') || 'All dates'
    doc.text(`Generated: ${now.toLocaleString()}   |   ${range}`, marginX, 33)

    autoTable(doc, {
      startY: 38,
      head: [['Date', 'Reference', 'Description', 'Charge (Debit)', 'Payment (Credit)']],
      body: statement.map(r => [
        r.date || '—',
        r.kind === 'order' ? `#${r.ref}` : String(r.ref),
        r.label,
        r.debit ? fmtCurMap(r.debit) : '',
        r.credit ? fmtCurMap(r.credit) : '',
      ]),
      styles: { fontSize: 8, cellPadding: 1.4 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    })

    let y = (doc.lastAutoTable?.finalY ?? 38) + 8
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text('Account balance', marginX, y); y += 6
    doc.setFontSize(9)
    for (const c of CURRENCIES) {
      if (!selected.charged[c] && !selected.paid[c]) continue
      doc.text(
        `${c} — Charged ${fmtMoney(selected.charged[c], c)}   Paid ${fmtMoney(selected.paid[c], c)}   Balance ${fmtMoney(selected.balance[c], c)}`,
        marginX, y)
      y += 5
    }
    doc.save(`statement-${(selected.customer.account_number || customerName(selected.customer)).toString().replace(/\s+/g, '-')}-${now.toISOString().slice(0, 10)}.pdf`)
  }

  const busy = loading.orders || payLoading

  /* ── render ──────────────────────────────────────────────── */
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <CreditCard className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Credit Customers</h1>
            <p className="text-xs text-slate-500 mt-0.5">{customerList.length} customer{customerList.length === 1 ? '' : 's'}</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-xs ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search customer, account, mobile…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="outstanding">Outstanding</option>
          <option value="settled">Settled</option>
          <option value="all">All</option>
        </select>

        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span>From</span>
          <input type="date" className="input w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span>To</span>
          <input type="date" className="input w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-ghost text-xs text-slate-400 hover:text-slate-100">
            <FilterX className="w-4 h-4" /> Clear
          </button>
        )}
      </div>

      <div className="flex gap-4 items-start">
        {/* ── Customer list ──────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 bg-surface-card border border-surface-border rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-surface-border text-xs font-semibold text-slate-400 uppercase tracking-wider">Customers</div>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto divide-y divide-surface-border/50">
            {busy ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Loading…</p>
            ) : customerList.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">No credit customers</p>
            ) : customerList.map(a => {
              const active = a.customer.id === selectedId
              return (
                <button key={a.customer.id} onClick={() => setSelectedId(a.customer.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${active ? 'bg-brand-600/15' : 'hover:bg-surface-hover'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <User className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                      <span className="text-sm text-slate-200 truncate">{customerName(a.customer)}</span>
                    </span>
                    {a.outstanding
                      ? <span className="text-[10px] font-semibold text-amber-400 flex-shrink-0">DUE</span>
                      : <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
                  </div>
                  {a.customer.account_number && (
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5 ml-5">{formatAccountNumber(a.customer.account_number)}</p>
                  )}
                  <p className={`text-[11px] mt-0.5 ml-5 ${a.outstanding ? 'text-amber-300' : 'text-slate-500'}`}>
                    Balance: {fmtCurMap(a.balance)}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Statement ──────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {!selected ? (
            <div className="bg-surface-card border border-surface-border rounded-xl p-10 text-center text-slate-500">
              <ChevronRight className="w-6 h-6 mx-auto mb-2 opacity-50" />
              Select a credit customer to view their account statement.
            </div>
          ) : (
            <>
              {/* Header + balance cards */}
              <div className="bg-surface-card border border-surface-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100">{customerName(selected.customer)}</h2>
                    {selected.customer.account_number && (
                      <p className="text-xs font-mono text-slate-500 mt-0.5">Account {formatAccountNumber(selected.customer.account_number)}</p>
                    )}
                    {selected.customer.mobile && <p className="text-xs text-slate-500">{selected.customer.mobile}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={clearAsOfYesterday} disabled={clearing} title="Summarise everything up to yesterday as a brought-forward balance"
                      className="btn-ghost text-xs text-slate-300 hover:text-slate-100 disabled:opacity-50">
                      <Scissors className="w-4 h-4" /> Clear as of yesterday
                    </button>
                    <button onClick={exportPDF} className="btn-ghost text-xs text-slate-300 hover:text-slate-100">
                      <FileDown className="w-4 h-4" /> Statement PDF
                    </button>
                    <button onClick={openCollect}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-500 transition-colors">
                      <HandCoins className="w-4 h-4" /> Collect Payment
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                  {CURRENCIES.filter(c => selected.charged[c] || selected.paid[c]).map(c => (
                    <div key={c} className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{c}</p>
                      <div className="flex justify-between text-xs text-slate-400 mt-1"><span>Charged</span><span>{fmtMoney(selected.charged[c], c)}</span></div>
                      <div className="flex justify-between text-xs text-slate-400"><span>Paid</span><span className="text-green-400">{fmtMoney(selected.paid[c], c)}</span></div>
                      <div className="flex justify-between text-sm font-semibold mt-1 pt-1 border-t border-surface-border">
                        <span className="text-slate-300">Balance</span>
                        <span className={selected.balance[c] > 0 ? 'text-amber-400' : 'text-slate-300'}>{fmtMoney(selected.balance[c], c)}</span>
                      </div>
                    </div>
                  ))}
                  {CURRENCIES.every(c => !selected.charged[c] && !selected.paid[c]) && (
                    <p className="text-sm text-slate-500 col-span-full">No activity on this account.</p>
                  )}
                </div>
              </div>

              {/* Statement table */}
              <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-surface-border flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-slate-200">Statement</span>
                  <div className="flex items-center gap-3">
                    {cutoff && (
                      <span className="text-xs text-slate-500">
                        {showAll ? 'Showing full history' : `Cleared through ${cutoff} — showing newer activity`}
                      </span>
                    )}
                    {cutoff && (
                      <button onClick={() => setShowAll(s => !s)} className="btn-ghost text-xs text-brand-400 hover:text-brand-300">
                        {showAll
                          ? <><ChevronUp className="w-3.5 h-3.5" /> Collapse</>
                          : <><ChevronDown className="w-3.5 h-3.5" /> Show all</>}
                      </button>
                    )}
                    <span className="text-xs text-slate-500">{statement.length} entr{statement.length === 1 ? 'y' : 'ies'}{(dateFrom || dateTo) ? ' (filtered)' : ''}</span>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-surface-border">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Reference</th>
                      <th className="px-4 py-2 font-medium">Description</th>
                      <th className="px-4 py-2 font-medium text-right">Charge</th>
                      <th className="px-4 py-2 font-medium text-right">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No entries for the selected dates.</td></tr>
                    ) : statement.map((r, i) => (
                      <tr key={i} className={`border-b border-surface-border/50 ${r.kind === 'opening' ? 'bg-amber-500/5' : 'hover:bg-surface-hover/40'}`}>
                        <td className="px-4 py-2.5 text-slate-400 font-mono text-xs whitespace-nowrap">{r.date || '—'}</td>
                        <td className="px-4 py-2.5">
                          {r.kind === 'opening' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400"><RotateCcw className="w-3 h-3" /> B/F</span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${r.kind === 'order' ? 'text-brand-400' : 'text-green-400'}`}>
                              {r.kind === 'order' ? `#${r.ref}` : <><Banknote className="w-3 h-3" /> {r.ref}</>}
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 truncate max-w-[280px] ${r.kind === 'opening' ? 'text-amber-300 font-medium italic' : 'text-slate-300'}`}>{r.label}</td>
                        <td className="px-4 py-2.5 text-right text-slate-300 whitespace-nowrap">{r.debit ? fmtCurMap(r.debit) : ''}</td>
                        <td className="px-4 py-2.5 text-right text-green-400 whitespace-nowrap">{r.credit ? fmtCurMap(r.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  {statement.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-surface-border bg-surface-hover/30 font-semibold text-slate-200">
                        <td className="px-4 py-2.5" colSpan={3}>Totals shown{(dateFrom || dateTo) ? ' (filtered)' : ''}</td>
                        <td className="px-4 py-2.5 text-right">{fmtCurMap(statementTotals.charged)}</td>
                        <td className="px-4 py-2.5 text-right text-green-400">{fmtCurMap(statementTotals.paid)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Collect payment modal ──────────────────────────────── */}
      {collectOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !posting && setCollectOpen(false)}>
          <div className="bg-surface-card border border-surface-border rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Collect Payment</h3>
                <p className="text-xs text-slate-500">{customerName(selected.customer)}</p>
              </div>
              <button onClick={() => !posting && setCollectOpen(false)} className="btn-ghost p-1.5 text-slate-500"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-4 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-0.5">
                  <span className="flex-1">Amount</span>
                  <span className="w-24">Currency</span>
                  <span className="w-6" />
                </div>
                {payLines.map(line => (
                  <div key={line._key} className="flex items-center gap-2">
                    <input type="number" min="0" step="any" className="input flex-1" placeholder="0.00"
                      value={line.amount} onChange={e => setPayLine(line._key, { amount: e.target.value })} />
                    <select className="input w-24" value={line.currency} onChange={e => setPayLine(line._key, { currency: e.target.value })}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button type="button" onClick={() => removePayLine(line._key)} disabled={payLines.length <= 1}
                      className="btn-ghost p-1.5 text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed" title="Remove line">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button type="button" onClick={addPayLine} className="btn-ghost text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3.5 h-3.5" /> Add line
                  </button>
                  {CURRENCIES.some(c => selected.balance[c] > 0) && (
                    <span className="text-[11px] text-slate-500">Due {fmtCurMap(selected.balance)}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">Method</label>
                  <select className="input mt-1" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Date</label>
                  <input type="date" className="input mt-1" value={payDate} onChange={e => setPayDate(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400">Notes</label>
                <input className="input mt-1" placeholder="Optional" value={payNotes} onChange={e => setPayNotes(e.target.value)} />
              </div>

              {postError && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {postError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface-border">
              <button onClick={() => setCollectOpen(false)} disabled={posting} className="btn-ghost text-sm text-slate-400 hover:text-slate-100">Cancel</button>
              <button onClick={recordPayment} disabled={posting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-500 transition-colors disabled:opacity-50">
                <HandCoins className="w-4 h-4" /> {posting ? 'Saving…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
