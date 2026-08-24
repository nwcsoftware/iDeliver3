import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Receipt, FilterX, FileDown, HandCoins, X, Loader, AlertCircle, CheckCircle2, Pin, PinOff, ChevronRight } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import SearchField from '../components/ui/SearchField'
import { OrderNumber } from '../components/orders/OrderQuickView'
import { useTableSort, SortTh } from '../components/ui/SortableTable'

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
  commission:   'all',   // 'all' | 'collected' | 'outstanding'
}

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toFixed(currency === 'LBP' ? 0 : 2)}`
}

/* A "we bought" invoice carries commission we earn from the shop. It's eligible
   to collect only when it actually has a commission amount and hasn't been
   collected yet. */
function commissionAmount(inv) {
  return inv.is_procurement ? round2(inv.commission_amount) : 0
}
function isCollectable(inv) {
  return commissionAmount(inv) > 0 && !inv.commission_collected
}

/* ── page ─────────────────────────────────────────────────── */

export default function RetailInvoicesPage() {
  const { COMPANY_ID } = useApp()
  const { currentUser } = useAuth()

  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filters,  setFilters]  = useState(EMPTY_FILTERS)

  /* The filter panel folds away — eight boxes take a third of the screen
     before a single invoice is visible — and can be pinned open for anyone who
     works from it all day. Both remembered per device: a preference about this
     screen, not something the office has to agree on. */
  const PANEL_KEY = 'ideliver_retail_filters'
  const [panel, setPanel] = useState(() => {
    try { return { open: true, pinned: false, ...(JSON.parse(localStorage.getItem(PANEL_KEY) || '{}')) } }
    catch { return { open: true, pinned: false } }
  })
  const savePanel = (next) => {
    setPanel(next)
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(next)) } catch { /* a preference, not data */ }
  }
  // Pinned means always shown, so pinning opens it; unpinning leaves it as is.
  const togglePin  = () => savePanel({ ...panel, pinned: !panel.pinned, open: panel.pinned ? panel.open : true })
  const toggleOpen = () => { if (!panel.pinned) savePanel({ ...panel, open: !panel.open }) }
  const panelOpen  = panel.open || panel.pinned

  // Which filters are actually narrowing the list, for the folded-away summary.
  const activeFilterNames = Object.entries(filters)
    .filter(([k, v]) => v !== EMPTY_FILTERS[k])
    .map(([k]) => k.replace(/_/g, ' '))

  // Commission collection: which invoice ids are ticked, the confirmation modal,
  // and the in-flight save.
  const [selected,   setSelected]   = useState(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collectErr, setCollectErr] = useState('')

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
    const matchPaid  = filters.paid === 'all' || (filters.paid === 'paid' ? inv.exclude_calculation === true : inv.exclude_calculation !== true)
    const matchComm  = filters.commission === 'all'
      || (filters.commission === 'collected'   ? inv.commission_collected === true
      : /* outstanding */                          isCollectable(inv))

    return matchSearch && matchCode && matchOrder && matchShop && matchType && matchFrom && matchTo && matchPaid && matchComm
  })

  /* What each column sorts BY. Value and Commission sort by CURRENCY first and
     then by the figure, so USD groups with USD rather than ranking LBP 300,000
     above USD 40 — two numbers that measure nothing in common. Paid and
     Collected sort by their state, so all the outstanding ones come together. */
  const moneySortKey = (amount, currency) =>
    `${currency || 'USD'}|${String(Math.round(Math.abs(Number(amount) || 0) * 100)).padStart(14, '0')}`

  const sortValue = useCallback((inv, key) => {
    switch (key) {
      case 'order':      return (inv.order?.order_number || '').toLowerCase()
      case 'code':       return (inv.contact_code || '').toLowerCase()
      case 'shop':       return (inv.shop_name || '').toLowerCase()
      case 'type':       return (inv.shop_type || '').toLowerCase()
      case 'source':     return inv.is_procurement ? 1 : 0
      case 'ref':        return (inv.invoice_reference || '').toLowerCase()
      case 'date':       return inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : ''
      case 'value':      return moneySortKey(inv.invoice_value, inv.currency)
      case 'currency':   return inv.currency || ''
      case 'paid':       return inv.exclude_calculation === true ? 1 : 0
      case 'commission': return moneySortKey(commissionAmount(inv), inv.currency)
      case 'collected':  return inv.commission_collected === true ? 1 : 0
      default:           return ''
    }
  }, [])
  const { sort, cycle, sortRows } = useTableSort(sortValue)
  const sortedVisible = useMemo(() => sortRows(visible), [visible, sortRows])

  // Per-currency totals for the visible rows: full value, the part already paid,
  // and the outstanding balance (value − paid). Paid invoices count fully as paid.
  const totalsByCurrency = visible.reduce((acc, inv) => {
    const cur = inv.currency || 'USD'
    const val = Number(inv.invoice_value) || 0
    const b = acc[cur] || (acc[cur] = { total: 0, paid: 0, balance: 0 })
    b.total += val
    if (inv.exclude_calculation) b.paid += val
    else                         b.balance += val
    return acc
  }, {})

  const curEntries = Object.entries(totalsByCurrency)
  const totalsStr   = curEntries.map(([c, v]) => fmtMoney(v.total,   c)).join('   •   ') || '—'
  const paidStr     = curEntries.map(([c, v]) => fmtMoney(v.paid,    c)).join('   •   ') || '—'
  const balanceStr  = curEntries.map(([c, v]) => fmtMoney(v.balance, c)).join('   •   ') || '—'

  // Per-currency commission across the visible rows: already collected vs still
  // outstanding (eligible to collect).
  const commByCurrency = visible.reduce((acc, inv) => {
    const amt = commissionAmount(inv)
    if (!amt) return acc
    const cur = inv.currency || 'USD'
    const b = acc[cur] || (acc[cur] = { collected: 0, outstanding: 0 })
    if (inv.commission_collected) b.collected   = round2(b.collected + amt)
    else                          b.outstanding = round2(b.outstanding + amt)
    return acc
  }, {})
  const commEntries      = Object.entries(commByCurrency)
  const commCollectedStr = commEntries.map(([c, v]) => fmtMoney(v.collected,   c)).join('   •   ') || '—'
  const commOutstandStr  = commEntries.map(([c, v]) => fmtMoney(v.outstanding, c)).join('   •   ') || '—'

  /* ── commission selection ────────────────────────────────── */

  // Only rows currently visible AND collectable can be ticked.
  const collectableVisible = visible.filter(isCollectable)
  const selectedInvoices   = collectableVisible.filter(inv => selected.has(inv.id))
  const allVisibleSelected = collectableVisible.length > 0 && selectedInvoices.length === collectableVisible.length

  function toggleOne(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllVisible() {
    setSelected(s => {
      const n = new Set(s)
      if (allVisibleSelected) collectableVisible.forEach(inv => n.delete(inv.id))
      else                    collectableVisible.forEach(inv => n.add(inv.id))
      return n
    })
  }

  // The selected commission, grouped by shop (partner) and currency, for the
  // confirmation popup — "each partner's collected commission value".
  const selectionByPartner = useMemo(() => {
    const map = new Map()
    for (const inv of selectedInvoices) {
      const key  = inv.contact_id || inv.shop_name || 'unknown'
      const name = inv.shop_name || inv.contact_code || 'Unknown shop'
      const cur  = inv.currency || 'USD'
      const entry = map.get(key) || { name, count: 0, cur: {} }
      entry.count += 1
      entry.cur[cur] = round2((entry.cur[cur] || 0) + commissionAmount(inv))
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [selectedInvoices])

  // Grand total of the selection, per currency.
  const selectionTotals = useMemo(() => {
    const t = {}
    for (const inv of selectedInvoices) {
      const cur = inv.currency || 'USD'
      t[cur] = round2((t[cur] || 0) + commissionAmount(inv))
    }
    return t
  }, [selectedInvoices])
  const selectionTotalsStr = Object.entries(selectionTotals).map(([c, v]) => fmtMoney(v, c)).join('   •   ') || '—'

  /* Mark every selected invoice's commission as collected, stamping who/when.
     The cashier box reads these rows and books each as partner income on the
     collection date. */
  async function collectCommission() {
    const ids = selectedInvoices.map(inv => inv.id)
    if (ids.length === 0) { setConfirmOpen(false); return }
    setCollecting(true); setCollectErr('')
    const { error } = await supabase
      .from('retail_goods_invoices')
      .update({
        commission_collected:    true,
        commission_collected_at: new Date().toISOString(),
        commission_collected_by: currentUser?.user_id || null,
      })
      .in('id', ids)
    setCollecting(false)
    if (error) { setCollectErr(error.message); return }
    setConfirmOpen(false); setSelected(new Set())
    fetchInvoices()
  }

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
      head: [['Order #', 'Contact Code', 'Shop', 'Business Type', 'Source', 'Invoice Ref', 'Date', 'Value', 'Currency', 'Paid']],
      body: visible.map(inv => [
        inv.order?.order_number ?? '—',
        inv.contact_code ?? '—',
        inv.shop_name ?? '—',
        inv.shop_type ?? '—',
        inv.is_procurement ? 'We bought' : 'Shop-sent',
        inv.invoice_reference ?? '—',
        inv.invoice_date ?? '—',
        (Number(inv.invoice_value) || 0).toFixed((inv.currency || 'USD') === 'LBP' ? 0 : 2),
        inv.currency ?? 'USD',
        inv.exclude_calculation ? 'Paid' : 'Unpaid',
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 7: { halign: 'right' } },
    })

    const finalY = doc.lastAutoTable?.finalY ?? 32
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text(`Invoices: ${visible.length}`, marginX, finalY + 8)
    doc.text(`Total: ${totalsStr}`, marginX, finalY + 14)
    doc.text(`Paid: ${paidStr}`, marginX, finalY + 20)
    doc.text(`Balance: ${balanceStr}`, marginX, finalY + 26)

    doc.save(`retail-invoices-${now.toISOString().slice(0, 10)}.pdf`)
  }

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mt-0.5">{visible.length} of {invoices.length} shown</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order #, code, shop, type, ref…"
            className="input pl-9"
          />
        </div>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-ghost text-xs text-slate-400 hover:text-slate-100">
            <FilterX className="w-4 h-4" /> Clear
          </button>
        )}

        <button onClick={() => { setCollectErr(''); setConfirmOpen(true) }}
          disabled={selectedInvoices.length === 0}
          className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-green-500/10 border-green-500/40 text-green-300 hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
          <HandCoins className="w-4 h-4" />
          Collect Commission{selectedInvoices.length > 0 ? ` (${selectedInvoices.length})` : ''}
        </button>
      </div>

      {/* Filters — folded away or pinned open. The search box and Collect
          Commission stay outside: they are how you get anywhere on this page. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={toggleOpen} disabled={panel.pinned}
          title={panel.pinned ? 'Pinned open — unpin to fold it away'
            : (panelOpen ? 'Hide the filters' : 'Show the filters')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            panel.pinned
              ? 'border-surface-border text-slate-500 cursor-default'
              : 'border-surface-border text-slate-300 hover:bg-surface-hover'}`}>
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${panelOpen ? 'rotate-90' : ''}`} />
          Filters
        </button>

        <button onClick={togglePin}
          title={panel.pinned ? 'Unpin — let it fold away' : 'Pin — keep it open on this device'}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            panel.pinned
              ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
              : 'border-surface-border text-slate-400 hover:bg-surface-hover'}`}>
          {panel.pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
          {panel.pinned ? 'Pinned' : 'Pin'}
        </button>

        {/* Folded away, the filters must still announce themselves — a hidden
            filter is the reason a list looks short for no apparent reason. */}
        {!panelOpen && activeFilterNames.length > 0 && (
          <span className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-amber-500/10 text-amber-300 border-amber-500/30">
            {activeFilterNames.length} filter{activeFilterNames.length === 1 ? '' : 's'} on — {activeFilterNames.join(', ')}
          </span>
        )}
      </div>

      {panelOpen && (
      <div className="card p-4 flex-shrink-0">
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
          <div>
            <label className="label">Commission</label>
            <select className="input" value={filters.commission} onChange={e => setFilter('commission', e.target.value)}>
              <option value="all">All</option>
              <option value="collected">Collected</option>
              <option value="outstanding">Outstanding</option>
            </select>
          </div>
        </div>
      </div>
      )}

      {/* List */}
      {/* The table scrolls inside the card so its header — and the select-all
          box with it — stays put on a list that runs to hundreds of invoices. */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-card">
            <tr className="border-b border-surface-border">
              <th className="px-4 py-3 w-8 bg-surface-card">
                <input type="checkbox" className="accent-green-500 w-4 h-4 align-middle"
                  checked={allVisibleSelected} disabled={collectableVisible.length === 0}
                  onChange={toggleAllVisible}
                  title={collectableVisible.length === 0 ? 'No collectable commission in view' : 'Select all collectable in view'} />
              </th>
              {[
                ['Order #', 'order'], ['Contact Code', 'code'], ['Shop', 'shop'],
                ['Business Type', 'type'], ['Source', 'source'], ['Invoice Ref', 'ref'],
                ['Date', 'date'], ['Value', 'value'], ['Currency', 'currency'],
                ['Paid', 'paid'], ['Commission', 'commission'], ['Collected', 'collected'],
              ].map(([label, key]) => (
                <SortTh key={key} label={label} sortKey={key} sort={sort} onSort={cycle}
                  className="px-4 py-3 text-slate-500 text-xs uppercase tracking-wider whitespace-nowrap" />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : sortedVisible.length === 0 ? (
              <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500">No invoices found</td></tr>
            ) : sortedVisible.map(inv => (
              <tr key={inv.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${selected.has(inv.id) ? 'bg-green-500/5' : ''}`}>
                <td className="px-4 py-3">
                  {isCollectable(inv) ? (
                    <input type="checkbox" className="accent-green-500 w-4 h-4 align-middle"
                      checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)} />
                  ) : (
                    <span className="inline-block w-4" />
                  )}
                </td>
                <td className="px-4 py-3">
                  {/* The same quick view every other list opens — an invoice
                      only makes sense against the order it was raised on. */}
                  {inv.order?.order_number
                    ? <OrderNumber value={inv.order.order_number} id={inv.order_id}
                        className="text-xs bg-brand-600/10 border border-brand-600/20 px-2 py-0.5 rounded" />
                    : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300">{inv.contact_code ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-200 text-xs">{inv.shop_name ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs capitalize">{inv.shop_type ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3">
                  {inv.is_procurement ? (
                    <span className="text-[11px] font-medium border rounded px-2 py-0.5 bg-purple-500/10 text-purple-300 border-purple-500/30 whitespace-nowrap">We bought</span>
                  ) : (
                    <span className="text-[11px] font-medium border rounded px-2 py-0.5 bg-sky-500/10 text-sky-300 border-sky-500/30 whitespace-nowrap">Shop-sent</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{inv.invoice_reference ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{inv.invoice_date ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-100 text-xs font-medium">{fmtMoney(inv.invoice_value, inv.currency || 'USD')}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{inv.currency ?? 'USD'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${inv.exclude_calculation
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'}`}>
                    {inv.exclude_calculation ? 'Paid' : 'Unpaid'}
                  </span>
                </td>
                {/* Commission — only meaningful on "we bought" invoices with an amount */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {commissionAmount(inv) > 0 ? (
                    inv.commission_collected ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-400"
                        title={inv.commission_collected_at ? `Collected ${new Date(inv.commission_collected_at).toLocaleString()}` : 'Collected'}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {fmtMoney(commissionAmount(inv), inv.currency || 'USD')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300" title="Commission not collected yet">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        {fmtMoney(commissionAmount(inv), inv.currency || 'USD')}
                      </span>
                    )
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
                {/* Collected — commission collection status */}
                <td className="px-4 py-3">
                  {commissionAmount(inv) > 0 ? (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border whitespace-nowrap ${inv.commission_collected
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                      {inv.commission_collected ? 'Collected' : 'Not collected'}
                    </span>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
            <div className="text-sm text-slate-300">
              <span className="text-slate-500 uppercase text-xs tracking-wider mr-2">Paid</span>
              <span className="font-semibold text-green-400">{paidStr}</span>
            </div>
            <div className="text-sm text-slate-300">
              <span className="text-slate-500 uppercase text-xs tracking-wider mr-2">Balance</span>
              <span className="font-semibold text-amber-400">{balanceStr}</span>
            </div>
            <div className="text-sm text-slate-300" title="Commission already collected / still outstanding on 'we bought' invoices">
              <span className="text-slate-500 uppercase text-xs tracking-wider mr-2">Comm.</span>
              <span className="font-semibold text-green-400">{commCollectedStr}</span>
              <span className="text-slate-600 mx-1.5">/</span>
              <span className="font-semibold text-amber-400">{commOutstandStr}</span>
            </div>
            <button className="btn-primary" onClick={exportPDF} disabled={visible.length === 0}>
              <FileDown className="w-4 h-4" /> Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* ── Collect Commission confirmation ─────────────────────── */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={() => !collecting && setConfirmOpen(false)}>
          <div className="card w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <HandCoins className="w-4 h-4 text-green-400" /> Collect Commission
              </h3>
              <button onClick={() => !collecting && setConfirmOpen(false)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <p className="text-xs text-slate-400">
                You are collecting commission on <span className="text-slate-200 font-medium">{selectedInvoices.length}</span> invoice{selectedInvoices.length === 1 ? '' : 's'}.
                They will be marked <span className="text-green-300">collected</span> and the amount will post to <span className="text-slate-200">today’s Cashier Box</span> as partner income.
              </p>

              {/* Per-partner breakdown */}
              <div className="border border-surface-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/40">
                      <th className="px-3 py-2 font-medium">Partner / Shop</th>
                      <th className="px-3 py-2 font-medium text-center">Invoices</th>
                      <th className="px-3 py-2 font-medium text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectionByPartner.map((p, i) => (
                      <tr key={i} className="border-t border-surface-border/40">
                        <td className="px-3 py-2 text-slate-200">{p.name}</td>
                        <td className="px-3 py-2 text-center text-slate-400 tabular-nums">{p.count}</td>
                        <td className="px-3 py-2 text-right">
                          {Object.entries(p.cur).map(([c, v]) => (
                            <div key={c} className="tabular-nums text-green-300 whitespace-nowrap">{fmtMoney(v, c)}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-surface-border bg-surface-hover/30">
                      <td className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-slate-500 font-semibold" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-right">
                        {Object.entries(selectionTotals).map(([c, v]) => (
                          <div key={c} className="tabular-nums font-semibold text-green-300 whitespace-nowrap">{fmtMoney(v, c)}</div>
                        ))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {collectErr && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed">{collectErr}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={() => setConfirmOpen(false)} disabled={collecting}
                className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={collectCommission} disabled={collecting || selectedInvoices.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border bg-green-500/15 border-green-500/40 text-green-200 hover:bg-green-500/25 disabled:opacity-50">
                {collecting ? <><Loader className="w-4 h-4 animate-spin" /> Collecting…</> : <><HandCoins className="w-4 h-4" /> Confirm — {selectionTotalsStr}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
