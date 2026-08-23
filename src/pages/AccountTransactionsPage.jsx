import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { OrderNumber } from '../components/orders/OrderQuickView'
import { BookText, FilterX, FileDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import SearchField from '../components/ui/SearchField'

const EMPTY_FILTERS = {
  transaction_type: '',
  currency_code:    '',
  account_number:   '',
  order_number:     '',
  date_from:        '',
  date_to:          '',
}

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}

/* ── page ─────────────────────────────────────────────────── */

export default function AccountTransactionsPage() {
  const { COMPANY_ID } = useApp()

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)

  /* ── fetch ───────────────────────────────────────────────── */

  const fetchRows = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('account_transaction_summary_view')
      .select('*')
      .order('transaction_date', { ascending: false })
      .order('transaction_id',   { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { fetchRows() }, [fetchRows])

  /* ── filter helpers ──────────────────────────────────────── */

  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setSearch('') }

  const hasActiveFilters = search.trim() !== '' ||
    Object.entries(filters).some(([k, v]) => v !== EMPTY_FILTERS[k])

  // Distinct values present in the data (for the dropdown filters).
  const types = useMemo(
    () => [...new Set(rows.map(r => r.transaction_type).filter(Boolean))].sort(),
    [rows],
  )
  const currencies = useMemo(
    () => [...new Set(rows.map(r => r.currency_code).filter(Boolean))].sort(),
    [rows],
  )

  /* ── filtered view ───────────────────────────────────────── */

  const visible = rows.filter(r => {
    const date = r.transaction_date ? String(r.transaction_date).slice(0, 10) : ''

    const s = search.trim().toLowerCase()
    const matchSearch = !s || [
      r.transaction_number, r.order_number, r.transaction_reference,
      r.transaction_description, r.account_number, r.customer_name, r.transaction_type,
    ].some(v => String(v ?? '').toLowerCase().includes(s))

    const matchType = !filters.transaction_type || r.transaction_type === filters.transaction_type
    const matchCur  = !filters.currency_code    || r.currency_code === filters.currency_code
    const matchAcct = !filters.account_number   || String(r.account_number ?? '').toLowerCase().includes(filters.account_number.toLowerCase())
    const matchOrd  = !filters.order_number     || String(r.order_number ?? '').toLowerCase().includes(filters.order_number.toLowerCase())
    const matchFrom = !filters.date_from || (date && date >= filters.date_from)
    const matchTo   = !filters.date_to   || (date && date <= filters.date_to)

    return matchSearch && matchType && matchCur && matchAcct && matchOrd && matchFrom && matchTo
  })

  // Per-currency totals (credit, debit, net) for the visible rows.
  const totalsByCurrency = useMemo(() => {
    const acc = {}
    for (const r of visible) {
      const cur = r.currency_code || 'USD'
      if (!acc[cur]) acc[cur] = { credit: 0, debit: 0 }
      acc[cur].credit += Number(r.credit_amount) || 0
      acc[cur].debit  += Number(r.debit_amount)  || 0
    }
    return acc
  }, [visible])

  const totalsEntries = Object.entries(totalsByCurrency)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cur, t]) => ({ cur, credit: t.credit, debit: t.debit, net: t.credit - t.debit }))

  /* ── filter summary (toolbar + PDF) ──────────────────────── */

  function activeFilterSummary() {
    const parts = []
    if (search.trim())             parts.push(`Search: "${search.trim()}"`)
    if (filters.transaction_type)  parts.push(`Type: ${filters.transaction_type}`)
    if (filters.currency_code)     parts.push(`Currency: ${filters.currency_code}`)
    if (filters.account_number)    parts.push(`Account: ${filters.account_number}`)
    if (filters.order_number)      parts.push(`Order: ${filters.order_number}`)
    if (filters.date_from)         parts.push(`From: ${filters.date_from}`)
    if (filters.date_to)           parts.push(`To: ${filters.date_to}`)
    return parts.join('   |   ')
  }

  /* ── PDF export — exactly what's currently displayed (filtered) ─── */

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Account Transaction Summary', marginX, 16)

    doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`Generated: ${now.toLocaleString()}`, marginX, 22)
    const summary = activeFilterSummary()
    doc.text(summary ? `Filters — ${summary}` : 'Filters — none (all transactions)', marginX, 27)

    autoTable(doc, {
      startY: 32,
      head: [['Date', 'Type', 'Order #', 'Account #', 'Customer', 'Reference', 'Description', 'Qty', 'Credit', 'Debit', 'Cur']],
      body: visible.map(r => [
        r.transaction_date ?? '—',
        r.transaction_type ?? '—',
        r.order_number ?? '—',
        r.account_number ?? '—',
        r.customer_name ?? '—',
        r.transaction_reference ?? '—',
        r.transaction_description ?? '—',
        r.quantity ?? '',
        (Number(r.credit_amount) || 0).toFixed((r.currency_code || 'USD') === 'LBP' ? 0 : 2),
        (Number(r.debit_amount)  || 0).toFixed((r.currency_code || 'USD') === 'LBP' ? 0 : 2),
        r.currency_code ?? 'USD',
      ]),
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
    })

    let finalY = (doc.lastAutoTable?.finalY ?? 32) + 8
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text(`Transactions: ${visible.length}`, marginX, finalY)
    finalY += 6
    for (const t of totalsEntries) {
      doc.text(`${t.cur} — Credit ${fmtMoney(t.credit, t.cur)}   Debit ${fmtMoney(t.debit, t.cur)}   Net ${fmtMoney(t.net, t.cur)}`, marginX, finalY)
      finalY += 5
    }

    doc.save(`account-transactions-${now.toISOString().slice(0, 10)}.pdf`)
  }

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <BookText className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Account Transactions</h1>
            <p className="text-xs text-slate-500 mt-0.5">{visible.length} of {rows.length} shown</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order #, account #, customer, ref, description…"
            className="input pl-9"
          />
        </div>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-ghost text-xs text-slate-400 hover:text-slate-100">
            <FilterX className="w-4 h-4" /> Clear
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input" value={filters.transaction_type} onChange={e => setFilter('transaction_type', e.target.value)}>
              <option value="">All types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" value={filters.currency_code} onChange={e => setFilter('currency_code', e.target.value)}>
              <option value="">All</option>
              {currencies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Account Number</label>
            <input className="input" value={filters.account_number} placeholder="e.g. 4274…"
              onChange={e => setFilter('account_number', e.target.value)} />
          </div>
          <div>
            <label className="label">Order Number</label>
            <input className="input" value={filters.order_number} placeholder="e.g. ORD-…"
              onChange={e => setFilter('order_number', e.target.value)} />
          </div>
          <div>
            <label className="label">Date From</label>
            <input type="date" className="input" value={filters.date_from}
              onChange={e => setFilter('date_from', e.target.value)} />
          </div>
          <div>
            <label className="label">Date To</label>
            <input type="date" className="input" value={filters.date_to}
              onChange={e => setFilter('date_to', e.target.value)} />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="border-b border-surface-border">
              {['Date', 'Type', 'Order #', 'Account #', 'Customer', 'Reference', 'Description', 'Qty', 'Credit', 'Debit', 'Cur'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-500">No transactions found</td></tr>
            ) : visible.map(r => (
              <tr key={r.transaction_id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{r.transaction_date ?? '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="px-2 py-0.5 rounded text-xs font-medium border bg-brand-600/10 text-brand-300 border-brand-600/20">{r.transaction_type ?? '—'}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.order_number
                    ? <OrderNumber value={r.order_number} className="text-xs" />
                    : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">{r.account_number ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-200 text-xs">{r.customer_name ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{r.transaction_reference ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{r.transaction_description ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs text-right">{r.quantity ?? '—'}</td>
                <td className="px-4 py-3 text-green-400 text-xs font-medium text-right whitespace-nowrap">
                  {Number(r.credit_amount) ? fmtMoney(r.credit_amount, r.currency_code || 'USD') : '—'}
                </td>
                <td className="px-4 py-3 text-red-400 text-xs font-medium text-right whitespace-nowrap">
                  {Number(r.debit_amount) ? fmtMoney(r.debit_amount, r.currency_code || 'USD') : '—'}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{r.currency_code ?? 'USD'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Floating summary bar — count + per-currency totals + PDF export */}
      <div className="sticky bottom-0 pb-1">
        <div className="card flex items-center justify-between gap-4 px-4 py-3 shadow-xl border-brand-600/30 bg-surface-card/95 backdrop-blur flex-wrap">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-slate-100">{visible.length}</span>
            <span className="text-slate-500"> / {rows.length}</span> transaction{visible.length === 1 ? '' : 's'}
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap">
              {totalsEntries.length === 0 ? (
                <span className="text-sm text-slate-500">No totals</span>
              ) : totalsEntries.map(t => (
                <div key={t.cur} className="text-xs text-slate-300">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold mr-1.5">{t.cur}</span>
                  <span className="text-green-400">Cr {fmtMoney(t.credit, t.cur)}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="text-red-400">Dr {fmtMoney(t.debit, t.cur)}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="font-semibold text-slate-100">Net {fmtMoney(t.net, t.cur)}</span>
                </div>
              ))}
            </div>
            <button className="btn-primary" onClick={exportPDF} disabled={visible.length === 0}>
              <FileDown className="w-4 h-4" /> Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
