import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Receipt, FilterX, FileDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

/* Business types a supplier/shop can have (mirrors the Suppliers form). */
const SHOP_TYPES = ['supermarket', 'grocery', 'bakery', 'restaurant', 'sweets', 'flowers', 'other']

const EMPTY_FILTERS = {
  contact_code: '',
  order_number: '',
  shop_name:    '',
  shop_type:    '',
  date_from:    '',
  date_to:      '',
  paid:         'all',   // 'all' | 'paid' | 'unpaid'
}

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toFixed(currency === 'LBP' ? 0 : 2)}`
}

/* ── page ─────────────────────────────────────────────────── */

export default function RetailInvoicesPage() {
  const { COMPANY_ID } = useApp()

  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filters,  setFilters]  = useState(EMPTY_FILTERS)

  /* ── fetch ───────────────────────────────────────────────── */

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('retail_goods_invoices')
      .select('*, order:delivery_orders(order_number)')
      .order('invoice_date', { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setInvoices(data ?? [])
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { fetchInvoices() }, [fetchInvoices])

  /* ── filter helpers ──────────────────────────────────────── */

  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setSearch('') }

  const hasActiveFilters = search.trim() !== '' ||
    Object.entries(filters).some(([k, v]) => v !== EMPTY_FILTERS[k])

  // Distinct shop names present in the data (for the Shop filter dropdown).
  const shopNames = useMemo(
    () => [...new Set(invoices.map(i => i.shop_name).filter(Boolean))].sort(),
    [invoices],
  )

  /* ── filtered view ───────────────────────────────────────── */

  const visible = invoices.filter(inv => {
    const orderNo = inv.order?.order_number ?? ''
    const date    = inv.invoice_date ? inv.invoice_date.slice(0, 10) : ''

    const s = search.trim().toLowerCase()
    const matchSearch = !s || [orderNo, inv.contact_code, inv.shop_name, inv.shop_type, inv.invoice_reference]
      .some(v => String(v ?? '').toLowerCase().includes(s))

    const matchCode  = !filters.contact_code || String(inv.contact_code ?? '').toLowerCase().includes(filters.contact_code.toLowerCase())
    const matchOrder = !filters.order_number || orderNo.toLowerCase().includes(filters.order_number.toLowerCase())
    const matchShop  = !filters.shop_name || inv.shop_name === filters.shop_name
    const matchType  = !filters.shop_type || inv.shop_type === filters.shop_type
    const matchFrom  = !filters.date_from || (date && date >= filters.date_from)
    const matchTo    = !filters.date_to   || (date && date <= filters.date_to)
    const matchPaid  = filters.paid === 'all' || (filters.paid === 'paid' ? inv.paid === true : inv.paid !== true)

    return matchSearch && matchCode && matchOrder && matchShop && matchType && matchFrom && matchTo && matchPaid
  })

  // Per-currency totals for the visible rows.
  const totalsByCurrency = visible.reduce((acc, inv) => {
    const cur = inv.currency || 'USD'
    acc[cur] = (acc[cur] || 0) + (Number(inv.invoice_value) || 0)
    return acc
  }, {})

  const totalsStr = Object.entries(totalsByCurrency).map(([c, v]) => fmtMoney(v, c)).join('   •   ') || '—'

  // Human-readable summary of the active search/filters (for the toolbar + PDF).
  function activeFilterSummary() {
    const parts = []
    if (search.trim())            parts.push(`Search: "${search.trim()}"`)
    if (filters.contact_code)     parts.push(`Code: ${filters.contact_code}`)
    if (filters.order_number)     parts.push(`Order: ${filters.order_number}`)
    if (filters.shop_name)        parts.push(`Shop: ${filters.shop_name}`)
    if (filters.shop_type)        parts.push(`Type: ${filters.shop_type}`)
    if (filters.date_from)        parts.push(`From: ${filters.date_from}`)
    if (filters.date_to)          parts.push(`To: ${filters.date_to}`)
    if (filters.paid !== 'all')   parts.push(`Paid: ${filters.paid}`)
    return parts.join('   |   ')
  }

  /* ── PDF export — exactly what's currently displayed (filtered) ─── */

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Retail Goods Invoices Report', marginX, 16)

    doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`Generated: ${now.toLocaleString()}`, marginX, 22)
    const summary = activeFilterSummary()
    doc.text(summary ? `Filters — ${summary}` : 'Filters — none (all invoices)', marginX, 27)

    autoTable(doc, {
      startY: 32,
      head: [['Order #', 'Contact Code', 'Shop', 'Business Type', 'Invoice Ref', 'Date', 'Value', 'Currency', 'Paid']],
      body: visible.map(inv => [
        inv.order?.order_number ?? '—',
        inv.contact_code ?? '—',
        inv.shop_name ?? '—',
        inv.shop_type ?? '—',
        inv.invoice_reference ?? '—',
        inv.invoice_date ?? '—',
        (Number(inv.invoice_value) || 0).toFixed((inv.currency || 'USD') === 'LBP' ? 0 : 2),
        inv.currency ?? 'USD',
        inv.paid ? 'Paid' : 'Unpaid',
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 6: { halign: 'right' } },
    })

    const finalY = doc.lastAutoTable?.finalY ?? 32
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text(`Invoices: ${visible.length}`, marginX, finalY + 8)
    doc.text(`Total: ${totalsStr}`, marginX, finalY + 14)

    doc.save(`retail-invoices-${now.toISOString().slice(0, 10)}.pdf`)
  }

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Retail Goods Invoices</h1>
            <p className="text-xs text-slate-500 mt-0.5">{visible.length} of {invoices.length} shown</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search order #, code, shop, type, ref…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-ghost text-xs text-slate-400 hover:text-slate-100">
            <FilterX className="w-4 h-4" /> Clear
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Contact Code</label>
            <input className="input" value={filters.contact_code} placeholder="e.g. SUP-001"
              onChange={e => setFilter('contact_code', e.target.value)} />
          </div>
          <div>
            <label className="label">Order Number</label>
            <input className="input" value={filters.order_number} placeholder="e.g. ORD-…"
              onChange={e => setFilter('order_number', e.target.value)} />
          </div>
          <div>
            <label className="label">Shop</label>
            <select className="input" value={filters.shop_name} onChange={e => setFilter('shop_name', e.target.value)}>
              <option value="">All shops</option>
              {shopNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Business Type</label>
            <select className="input" value={filters.shop_type} onChange={e => setFilter('shop_type', e.target.value)}>
              <option value="">All types</option>
              {SHOP_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
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
          <div>
            <label className="label">Paid</label>
            <select className="input" value={filters.paid} onChange={e => setFilter('paid', e.target.value)}>
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Order #', 'Contact Code', 'Shop', 'Business Type', 'Invoice Ref', 'Date', 'Value', 'Currency', 'Paid'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No invoices found</td></tr>
            ) : visible.map(inv => (
              <tr key={inv.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-4 py-3">
                  {inv.order?.order_number
                    ? <span className="font-mono text-xs text-brand-400 bg-brand-600/10 border border-brand-600/20 px-2 py-0.5 rounded">{inv.order.order_number}</span>
                    : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300">{inv.contact_code ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-200 text-xs">{inv.shop_name ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs capitalize">{inv.shop_type ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{inv.invoice_reference ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{inv.invoice_date ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-100 text-xs font-medium">{fmtMoney(inv.invoice_value, inv.currency || 'USD')}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{inv.currency ?? 'USD'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${inv.paid
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'}`}>
                    {inv.paid ? 'Paid' : 'Unpaid'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Floating summary bar — same width as the list, sticks to the bottom.
          Reflects the current filters: invoice count, per-currency totals, PDF export. */}
      <div className="sticky bottom-0 pb-1">
        <div className="card flex items-center justify-between gap-4 px-4 py-3 shadow-xl border-brand-600/30 bg-surface-card/95 backdrop-blur">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-slate-100">{visible.length}</span>
            <span className="text-slate-500"> / {invoices.length}</span> invoice{visible.length === 1 ? '' : 's'}
          </div>
          <div className="flex items-center gap-5">
            <div className="text-sm text-slate-300">
              <span className="text-slate-500 uppercase text-xs tracking-wider mr-2">Total</span>
              <span className="font-semibold text-slate-100">{totalsStr}</span>
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
