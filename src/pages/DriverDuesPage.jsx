import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, HandCoins, FilterX, FileDown, CheckCircle2, Banknote, X, AlertCircle, History, ChevronRight, ChevronDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { AmountSummaryContent, placeHoverPanel, orderCollectedByCurrency, orderDriverCollectByCurrency } from '../lib/orderAmounts'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* Cash is reconciled per currency. Adding a new currency (it must exist in the
   DB currency_type enum) only needs to be listed here — zero-value currencies
   are hidden automatically. */
const CURRENCIES = ['USD', 'LBP', 'EUR']

/* A fresh per-currency accumulator, e.g. { USD: 0, LBP: 0, EUR: 0 }. */
function emptyCur() { return Object.fromEntries(CURRENCIES.map(c => [c, 0])) }

const EMPTY_FILTERS = {
  driver_id:   '',
  date_from:   '',
  date_to:     '',
  settled:     'outstanding',   // outstanding | settled | all
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}

function driverName(d) {
  if (!d) return '—'
  return `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || (d.name ?? '—')
}

/* Order status "completed" — the status enum stores delivered/returned, which the
   app treats as completed (same mapping as the Deliveries list). */
function isCompleted(o) { return ['completed', 'delivered', 'returned'].includes(o?.status) }
/* Driver collected all the money = the order is fully paid to the office. */
function isFullyCollected(o) { return o?.payment_status === 'paid_to_office' }
/* An order shows up for driver settlement once it's closed, OR once it's both
   completed and fully collected (the driver is holding all the cash). */
function isSettlementEligible(o) { return o?.isclosed === true || (isCompleted(o) && isFullyCollected(o)) }

/* The closing date of an order (else its scheduled date) — what the call-center
   user filters the day's collections by. */
function orderDate(o) {
  const raw = o.closed_at || o.scheduled_date || o.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

/* ── page ─────────────────────────────────────────────────── */

export default function DriverDuesPage() {
  const { orders, drivers, loading } = useApp()
  const { currentUser } = useAuth()

  const [tab,     setTab]     = useState('collect')   // 'collect' (dues to collect) | 'history'
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [search,  setSearch]  = useState('')

  // Completed settlements (history tab).
  const [settlements,    setSettlements]    = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expanded,       setExpanded]       = useState(new Set())   // expanded settlement ids

  const [retailByOrder, setRetailByOrder] = useState({})   // orderId → [retail invoices]
  const [settledIds,    setSettledIds]    = useState(new Set())   // orders already collected from driver
  const [dataLoading,   setDataLoading]   = useState(true)

  const [selected,    setSelected]    = useState(new Set())  // order ids picked for collection
  const [collectRows, setCollectRows] = useState([])         // rows being settled in the modal
  const [paidInput,   setPaidInput]   = useState(() => Object.fromEntries(CURRENCIES.map(c => [c, ''])))  // actual cash handed over
  const [posting,     setPosting]     = useState(false)
  const [postError,   setPostError]   = useState('')

  const confirm = collectRows.length > 0   // settlement confirm modal open
  function openCollect(rows) { setPostError(''); setCollectRows(rows) }
  function closeCollect() { if (!posting) setCollectRows([]) }

  // Amounts summary hover preview — follows the cursor over each row (read-only).
  const [hoverSummary, setHoverSummary] = useState(null)   // { order, x, y }
  const hoverPanelRef = useRef(null)

  /* Orders eligible for driver-cash reconciliation: closed orders, plus orders
     that are completed and fully collected (driver holds all the money). */
  const closedOrders = useMemo(
    () => orders.filter(isSettlementEligible),
    [orders],
  )

  /* ── supplementary fetch: full retail invoices + which orders are settled ─── */

  const fetchSupplementary = useCallback(async () => {
    const ids = closedOrders.map(o => o.id)
    if (ids.length === 0) { setRetailByOrder({}); setSettledIds(new Set()); setDataLoading(false); return }
    setDataLoading(true)

    const [{ data: retail }, { data: settled }] = await Promise.all([
      supabase.from('retail_goods_invoices')
        .select('id, order_id, shop_name, invoice_reference, invoice_date, invoice_value, currency')
        .in('order_id', ids),
      // An order is settled once a driver_settlement_orders line exists for it.
      supabase.from('driver_settlement_orders')
        .select('order_id')
        .in('order_id', ids),
    ])

    const map = {}
    for (const r of retail ?? []) (map[r.order_id] ??= []).push(r)
    setRetailByOrder(map)
    setSettledIds(new Set((settled ?? []).map(r => r.order_id)))
    setDataLoading(false)
  }, [closedOrders])

  useEffect(() => { fetchSupplementary() }, [fetchSupplementary])

  /* ── settlement history (header + per-currency totals + order lines) ─── */

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    const { data } = await supabase
      .from('driver_daily_settlements')
      .select(`
        id, driver_id, settlement_date, total_orders, received_at, status, created_at,
        driver_settlement_currency_totals ( currency, total_collected, amount_paid, difference ),
        driver_settlement_orders ( order_id, currency, collected, retail )
      `)
      .order('settlement_date', { ascending: false })
      .order('created_at',      { ascending: false })
    setSettlements(data ?? [])
    setHistoryLoading(false)
  }, [])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // order_id → order_number, for showing readable order refs in the history lines.
  const orderNumById = useMemo(
    () => Object.fromEntries(orders.map(o => [o.id, o.order_number])),
    [orders],
  )

  function toggleExpand(id) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  /* ── per-order reconciliation rows ───────────────────────── */

  // Collected cash, external retail (petty cash), and the net due from the
  // driver, per order and per currency.
  const allRows = useMemo(() => closedOrders.map(o => {
    // Collected is derived from the order's payments (amount + currency).
    const byCur     = orderCollectedByCurrency(o)
    const collected = emptyCur()
    for (const c of CURRENCIES) collected[c] = round2(byCur[c])
    const retail    = emptyCur()
    const invoices  = retailByOrder[o.id] ?? []
    for (const r of invoices) {
      const cur = CURRENCIES.includes(r.currency) ? r.currency : 'USD'
      retail[cur] += round2(r.invoice_value)
    }
    const net = emptyCur()
    for (const c of CURRENCIES) net[c] = round2(collected[c] - retail[c])
    return {
      order:     o,
      driver:    o.driver,
      collected, retail, net, invoices,
      settled:   settledIds.has(o.id),
      hasCash:   CURRENCIES.some(c => collected[c] > 0 || retail[c] > 0),
    }
  }), [closedOrders, retailByOrder, settledIds])

  /* ── filtering ───────────────────────────────────────────── */

  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setSearch('') }

  const hasActiveFilters = search.trim() !== '' ||
    Object.entries(filters).some(([k, v]) => v !== EMPTY_FILTERS[k])

  const visible = useMemo(() => allRows.filter(({ order: o, driver, settled, hasCash }) => {
    if (!hasCash) return false   // nothing to reconcile

    const d = orderDate(o)
    const s = search.trim().toLowerCase()
    const matchSearch = !s || [
      o.order_number, o.recipient_name, o.main_account,
      driverName(driver),
    ].some(v => String(v ?? '').toLowerCase().includes(s))

    const matchDriver = !filters.driver_id || o.driver_id === filters.driver_id
    const matchFrom   = !filters.date_from || (d && d >= filters.date_from)
    const matchTo     = !filters.date_to   || (d && d <= filters.date_to)
    const matchSettled =
      filters.settled === 'all'        ? true :
      filters.settled === 'settled'    ? settled :
      /* outstanding */                  !settled

    return matchSearch && matchDriver && matchFrom && matchTo && matchSettled
  }), [allRows, search, filters])

  /* ── selection (outstanding rows only) ───────────────────── */

  const outstandingVisible = visible.filter(r => !r.settled)
  // A driver must be picked before cash can be collected (you settle one driver
  // at a time), and there must be outstanding orders in view.
  const canCollect = !!filters.driver_id && outstandingVisible.length > 0

  // Default-select every outstanding order in view whenever the view changes.
  useEffect(() => {
    setSelected(new Set(outstandingVisible.map(r => r.order.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function toggleRow(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected(s => s.size === outstandingVisible.length
      ? new Set()
      : new Set(outstandingVisible.map(r => r.order.id)))
  }

  const selectedRows = outstandingVisible.filter(r => selected.has(r.order.id))

  /* ── totals (per currency) for the visible rows ──────────── */

  function sumRows(rows) {
    const t = { collected: emptyCur(), retail: emptyCur(), net: emptyCur(), driverCollect: emptyCur() }
    for (const r of rows) {
      const dc = orderDriverCollectByCurrency(r.order)   // delivery fees + local retail items
      for (const c of CURRENCIES) {
        t.collected[c] += r.collected[c]
        t.retail[c]    += r.retail[c]
        t.net[c]       += r.net[c]
        t.driverCollect[c] += (dc[c] || 0)
      }
    }
    for (const c of CURRENCIES) {
      t.collected[c] = round2(t.collected[c]); t.retail[c] = round2(t.retail[c]); t.net[c] = round2(t.net[c]); t.driverCollect[c] = round2(t.driverCollect[c])
    }
    return t
  }

  const visibleTotals  = useMemo(() => sumRows(visible),      [visible])
  const collectTotals  = useMemo(() => sumRows(collectRows),  [collectRows])

  // Default the "amount paid" inputs to the expected net (collected − petty cash)
  // whenever a settlement modal is opened. The user may override per currency.
  useEffect(() => {
    if (collectRows.length === 0) return
    setPaidInput(Object.fromEntries(CURRENCIES.map(c => [c, String(collectTotals.net[c])])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectRows])

  // Difference per currency: amount actually paid − expected net (negative = shortfall).
  const paidDiff = useMemo(() => {
    const d = emptyCur()
    for (const c of CURRENCIES) d[c] = round2((Number(paidInput[c]) || 0) - collectTotals.net[c])
    return d
  }, [paidInput, collectTotals])

  // Driver(s) represented by the rows in the modal (each order keeps its own
  // driver, so a single-row collection always settles that order's driver).
  const collectDrivers = useMemo(
    () => [...new Set(collectRows.map(r => r.order.driver_id).filter(Boolean))],
    [collectRows],
  )
  const collectDriverLabel = collectDrivers.length === 1
    ? driverName(drivers.find(d => d.id === collectDrivers[0]) || collectRows[0]?.driver)
    : `${collectDrivers.length} drivers`

  /* ── post the settlement to driver_daily_settlements (+ lines) ─── */

  async function recordCollection() {
    if (collectRows.length === 0) return
    setPosting(true); setPostError('')

    const settleDate = new Date().toISOString().slice(0, 10)

    // Group the rows by driver — each driver gets one daily settlement header.
    const byDriver = new Map()
    for (const r of collectRows) {
      const id = r.order.driver_id
      if (!id) continue
      if (!byDriver.has(id)) byDriver.set(id, [])
      byDriver.get(id).push(r)
    }
    if (byDriver.size === 0) {
      setPostError('Selected orders have no driver assigned.'); setPosting(false); return
    }

    // The actual amount handed over (modal inputs) only applies when settling a
    // single driver; if several drivers are batched, fall back to expected net.
    const singleDriver = byDriver.size === 1

    for (const [driverId, rows] of byDriver) {
      const totals = sumRows(rows)   // { collected, retail, net } per currency
      const paid = {}
      for (const c of CURRENCIES) {
        paid[c] = singleDriver ? round2(Number(paidInput[c]) || 0) : totals.net[c]
      }

      // 1. Daily settlement header (meta only — money lives in the child tables).
      const { data: settlement, error: he } = await supabase
        .from('driver_daily_settlements')
        .insert([{
          driver_id:       driverId,
          settlement_date: settleDate,
          total_orders:    rows.length,
          received_by:     currentUser?.user_id || null,
          received_at:     new Date().toISOString(),
          status:          'completed',
        }])
        .select('id')
        .single()
      if (he) { setPostError(he.message); setPosting(false); return }

      // 2. Header money — one row per currency that has any activity.
      const currencyTotals = CURRENCIES
        .filter(c => totals.collected[c] || totals.retail[c] || paid[c])
        .map(c => ({
          settlement_id:   settlement.id,
          currency:        c,
          total_collected: totals.collected[c],
          amount_paid:     paid[c],
          difference:      round2(paid[c] - totals.net[c]),
        }))
      if (currencyTotals.length > 0) {
        const { error: ce } = await supabase.from('driver_settlement_currency_totals').insert(currencyTotals)
        if (ce) { setPostError(ce.message); setPosting(false); return }
      }

      // 3. Per-order lines — one row per (order, currency) with any activity.
      const lines = []
      for (const r of rows) for (const c of CURRENCIES) {
        if (r.collected[c] || r.retail[c]) lines.push({
          settlement_id: settlement.id,
          order_id:      r.order.id,
          currency:      c,
          collected:     r.collected[c],
          retail:        r.retail[c],
        })
      }
      if (lines.length > 0) {
        const { error: le } = await supabase.from('driver_settlement_orders').insert(lines)
        if (le) { setPostError(le.message); setPosting(false); return }
      }
    }

    await fetchSupplementary()   // refresh settled state → rows drop off "outstanding"
    await fetchHistory()         // new settlement appears in the History tab
    setCollectRows([]); setPosting(false)
  }

  /* ── filter summary (toolbar + PDF) ──────────────────────── */

  const selectedDriverName = filters.driver_id
    ? driverName(drivers.find(d => d.id === filters.driver_id))
    : ''

  function activeFilterSummary() {
    const parts = []
    if (search.trim())          parts.push(`Search: "${search.trim()}"`)
    if (selectedDriverName)     parts.push(`Driver: ${selectedDriverName}`)
    if (filters.date_from)      parts.push(`From: ${filters.date_from}`)
    if (filters.date_to)        parts.push(`To: ${filters.date_to}`)
    parts.push(`Status: ${filters.settled}`)
    return parts.join('   |   ')
  }

  /* ── PDF export — exactly what's currently displayed ─────── */

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Driver Daily Dues — Cash Encashment', marginX, 16)

    doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`Generated: ${now.toLocaleString()}`, marginX, 22)
    doc.text(`Filters — ${activeFilterSummary()}`, marginX, 27)

    autoTable(doc, {
      startY: 32,
      head: [['Date', 'Order #', 'Driver', 'Customer',
        'Collected USD', 'Collected LBP', 'Retail USD', 'Retail LBP', 'Net USD', 'Net LBP', 'Settled']],
      body: visible.map(r => [
        orderDate(r.order) || '—',
        r.order.order_number ?? '—',
        driverName(r.driver),
        r.order.recipient_name ?? '—',
        r.collected.USD.toFixed(2), r.collected.LBP.toFixed(0),
        r.retail.USD.toFixed(2),    r.retail.LBP.toFixed(0),
        r.net.USD.toFixed(2),       r.net.LBP.toFixed(0),
        r.settled ? 'Yes' : 'No',
      ]),
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
    })

    let y = (doc.lastAutoTable?.finalY ?? 32) + 8
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text(`Orders: ${visible.length}`, marginX, y); y += 6
    for (const c of CURRENCIES) {
      if (!visibleTotals.collected[c] && !visibleTotals.retail[c]) continue
      doc.text(
        `${c} — Collected ${fmtMoney(visibleTotals.collected[c], c)}   Petty cash ${fmtMoney(visibleTotals.retail[c], c)}   Net due from driver ${fmtMoney(visibleTotals.net[c], c)}`,
        marginX, y)
      y += 5
    }

    doc.save(`driver-dues-${now.toISOString().slice(0, 10)}.pdf`)
  }

  const busy = loading.orders || dataLoading

  /* ── history filtering (driver / date / search) ──────────── */

  const visibleSettlements = useMemo(() => settlements.filter(s => {
    if (filters.driver_id && s.driver_id !== filters.driver_id) return false
    if (filters.date_from && s.settlement_date < filters.date_from) return false
    if (filters.date_to   && s.settlement_date > filters.date_to)   return false
    const q = search.trim().toLowerCase()
    if (q) {
      const dn = driverName(drivers.find(d => d.id === s.driver_id)).toLowerCase()
      const inOrders = (s.driver_settlement_orders ?? [])
        .some(l => String(orderNumById[l.order_id] ?? '').toLowerCase().includes(q))
      if (!dn.includes(q) && !inOrders) return false
    }
    return true
  }), [settlements, filters, search, drivers, orderNumById])

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <HandCoins className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Driver Settlements</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {tab === 'collect'
                ? `${visible.length} of ${allRows.filter(r => r.hasCash).length} dues shown`
                : `${visibleSettlements.length} settlement${visibleSettlements.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search order #, recipient, account, driver…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-ghost text-xs text-slate-400 hover:text-slate-100">
            <FilterX className="w-4 h-4" /> Clear
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-surface-border">
        {[
          { key: 'collect', label: 'To Collect', icon: HandCoins },
          { key: 'history', label: 'History',    icon: History },
        ].map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-brand-500 text-brand-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Driver</label>
            <select className="input" value={filters.driver_id} onChange={e => setFilter('driver_id', e.target.value)}>
              <option value="">All drivers</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{driverName(d)}</option>)}
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
          {tab === 'collect' && (
            <div>
              <label className="label">Status</label>
              <select className="input" value={filters.settled} onChange={e => setFilter('settled', e.target.value)}>
                <option value="outstanding">Outstanding</option>
                <option value="settled">Settled</option>
                <option value="all">All</option>
              </select>
            </div>
          )}
        </div>
        {tab === 'collect' && !filters.driver_id && (
          <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> Pick a driver to select orders and record a cash collection.
          </p>
        )}
      </div>

      {/* ── To Collect tab ─────────────────────────────────── */}
      {tab === 'collect' && (<>

      {/* List */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="px-3 py-3 w-10">
                {canCollect && (
                  <input type="checkbox"
                    checked={selected.size > 0 && selected.size === outstandingVisible.length}
                    onChange={toggleAll} />
                )}
              </th>
              {['Date', 'Order #', 'Driver', 'Customer', 'Collected', 'Petty cash (retail)', 'Net due', 'Status'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody onMouseLeave={() => setHoverSummary(null)}>
            {busy ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">No driver collections found</td></tr>
            ) : visible.map(r => {
              const o = r.order
              const selectable = !r.settled && !!filters.driver_id
              return (
                <tr key={o.id}
                  onMouseEnter={(e) => setHoverSummary({ order: o, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => placeHoverPanel(hoverPanelRef.current, e.clientX, e.clientY)}
                  className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                  <td className="px-3 py-3">
                    {selectable && (
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleRow(o.id)} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{orderDate(o) || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-brand-400">{o.order_number ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-200 text-xs whitespace-nowrap">{driverName(r.driver)}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{o.recipient_name ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                    {CURRENCIES.filter(c => r.collected[c] > 0).map(c => (
                      <div key={c} className="text-green-400">{fmtMoney(r.collected[c], c)}</div>
                    ))}
                    {r.collected.USD === 0 && r.collected.LBP === 0 && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                    {CURRENCIES.filter(c => r.retail[c] > 0).map(c => (
                      <div key={c} className="text-amber-400">{fmtMoney(r.retail[c], c)}</div>
                    ))}
                    {r.retail.USD === 0 && r.retail.LBP === 0 && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-right whitespace-nowrap font-medium">
                    {CURRENCIES.filter(c => r.net[c] !== 0).map(c => (
                      <div key={c} className="text-slate-100">{fmtMoney(r.net[c], c)}</div>
                    ))}
                    {r.net.USD === 0 && r.net.LBP === 0 && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.settled
                      ? <span className="px-2 py-0.5 rounded text-xs font-medium border bg-green-600/10 text-green-300 border-green-600/20 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Collected</span>
                      : <span className="px-2 py-0.5 rounded text-xs font-medium border bg-amber-600/10 text-amber-300 border-amber-600/20">Outstanding</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!r.settled && (
                        <button className="btn-primary py-1 px-2.5 text-xs" onClick={() => openCollect([r])}>
                          <Banknote className="w-3.5 h-3.5" /> Collect
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Floating summary bar — totals + collect + PDF */}
      <div className="sticky bottom-0 pb-1">
        <div className="card flex items-center justify-between gap-4 px-4 py-3 shadow-xl border-brand-600/30 bg-surface-card/95 backdrop-blur flex-wrap">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-slate-100">{visible.length}</span> order{visible.length === 1 ? '' : 's'}
            {filters.driver_id && (
              <span className="text-slate-500"> · {selected.size} selected</span>
            )}
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap">
              {CURRENCIES.filter(c => visibleTotals.collected[c] || visibleTotals.retail[c] || visibleTotals.driverCollect[c]).map(c => (
                <div key={c} className="text-xs text-slate-300">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold mr-1.5">{c}</span>
                  <span className="text-green-400">Collected {fmtMoney(visibleTotals.collected[c], c)}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="text-amber-400">Petty {fmtMoney(visibleTotals.retail[c], c)}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="font-semibold text-slate-100">Net {fmtMoney(visibleTotals.net[c], c)}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="font-semibold text-[#1dffd5] [text-shadow:0_0_6px_rgba(29,255,213,0.75)]">To collect {fmtMoney(visibleTotals.driverCollect[c], c)}</span>
                </div>
              ))}
              {!CURRENCIES.some(c => visibleTotals.collected[c] || visibleTotals.retail[c] || visibleTotals.driverCollect[c]) && (
                <span className="text-sm text-slate-500">No totals</span>
              )}
            </div>
            <button className="btn-ghost text-slate-300" onClick={exportPDF} disabled={visible.length === 0}>
              <FileDown className="w-4 h-4" /> PDF
            </button>
            <button className="btn-primary" onClick={() => openCollect(selectedRows)}
              disabled={!canCollect || selectedRows.length === 0}>
              <Banknote className="w-4 h-4" /> Record Collection
            </button>
          </div>
        </div>
      </div>

      </>)}

      {/* ── History tab ────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="px-3 py-3 w-8" />
                {['Date', 'Driver', 'Orders', 'Collected', 'Paid', 'Difference', 'Recorded'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
              ) : visibleSettlements.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No settlements recorded yet</td></tr>
              ) : visibleSettlements.map(s => {
                const isOpen  = expanded.has(s.id)
                const totals  = s.driver_settlement_currency_totals ?? []
                const lines   = s.driver_settlement_orders ?? []
                return (
                  <React.Fragment key={s.id}>
                    <tr onClick={() => toggleExpand(s.id)}
                      className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors cursor-pointer">
                      <td className="px-3 py-3 text-slate-500">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{s.settlement_date}</td>
                      <td className="px-4 py-3 text-slate-200 text-xs whitespace-nowrap">{driverName(drivers.find(d => d.id === s.driver_id))}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{s.total_orders}</td>
                      <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                        {totals.filter(t => Number(t.total_collected)).map(t => (
                          <div key={t.currency} className="text-green-400">{fmtMoney(t.total_collected, t.currency)}</div>
                        ))}
                        {!totals.some(t => Number(t.total_collected)) && <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                        {totals.filter(t => Number(t.amount_paid)).map(t => (
                          <div key={t.currency} className="text-slate-100">{fmtMoney(t.amount_paid, t.currency)}</div>
                        ))}
                        {!totals.some(t => Number(t.amount_paid)) && <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                        {totals.filter(t => Number(t.difference)).map(t => (
                          <div key={t.currency} className={Number(t.difference) < 0 ? 'text-red-400' : 'text-green-400'}>
                            {Number(t.difference) < 0 ? 'Short ' : 'Over '}{fmtMoney(Math.abs(Number(t.difference)), t.currency)}
                          </div>
                        ))}
                        {!totals.some(t => Number(t.difference)) && <span className="text-slate-500">Exact</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {s.received_at ? new Date(s.received_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface/40">
                        <td />
                        <td colSpan={7} className="px-4 py-3">
                          <div className="rounded-lg border border-surface-border overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-surface-card/60 text-slate-500">
                                  <th className="text-left px-3 py-2 font-medium">Order #</th>
                                  <th className="text-left px-3 py-2 font-medium">Currency</th>
                                  <th className="text-right px-3 py-2 font-medium">Collected</th>
                                  <th className="text-right px-3 py-2 font-medium">Petty cash (retail)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.length === 0 ? (
                                  <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-500">No order lines</td></tr>
                                ) : lines.map((l, i) => (
                                  <tr key={i} className="border-t border-surface-border/50">
                                    <td className="px-3 py-2 font-mono text-brand-400">{orderNumById[l.order_id] ?? '—'}</td>
                                    <td className="px-3 py-2 text-slate-400">{l.currency}</td>
                                    <td className="px-3 py-2 text-right text-green-400">{fmtMoney(l.collected, l.currency)}</td>
                                    <td className="px-3 py-2 text-right text-amber-400">{fmtMoney(l.retail, l.currency)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Amounts hover preview (follows the cursor; read-only) */}
      {hoverSummary && (
        <div ref={hoverPanelRef}
          className="fixed z-[55] pointer-events-none card border border-surface-border rounded-lg shadow-xl overflow-hidden"
          style={{ left: hoverSummary.x + 16, top: hoverSummary.y + 16, width: 340 }}>
          <AmountSummaryContent order={hoverSummary.order} />
        </div>
      )}

      {/* Confirm settlement modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeCollect}>
          <div className="card w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Banknote className="w-4 h-4 text-brand-400" /> Record cash collection
              </h2>
              <button onClick={closeCollect} className="text-slate-500 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-400">
              Collect cash from <span className="text-slate-100 font-medium">{collectDriverLabel}</span> for{' '}
              <span className="text-slate-100 font-medium">{collectRows.length}</span> order{collectRows.length === 1 ? '' : 's'}.
              This records a driver settlement (with one line per order). Enter the actual
              amount the driver hands over — any shortfall or overage is saved as the difference.
            </p>

            <div className="rounded-lg border border-surface-border divide-y divide-surface-border/60">
              {CURRENCIES.filter(c => collectTotals.collected[c] || collectTotals.retail[c]).map(c => (
                <div key={c} className="px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 uppercase tracking-wider text-xs font-semibold">{c}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-green-400 text-xs">Collected {fmtMoney(collectTotals.collected[c], c)}</span>
                      <span className="text-amber-400 text-xs">Petty {fmtMoney(collectTotals.retail[c], c)}</span>
                      <span className="text-slate-100 font-semibold">Net {fmtMoney(collectTotals.net[c], c)}</span>
                    </div>
                  </div>
                  {collectDrivers.length === 1 ? (
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 whitespace-nowrap">Amount paid ({c})</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          step={c === 'LBP' ? '1' : '0.01'}
                          className="input py-1 px-2 text-sm w-32 text-right"
                          value={paidInput[c]}
                          onChange={e => setPaidInput(p => ({ ...p, [c]: e.target.value }))}
                        />
                        <span className={`text-xs whitespace-nowrap w-28 text-right ${
                          paidDiff[c] === 0 ? 'text-slate-500'
                          : paidDiff[c] < 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {paidDiff[c] === 0
                            ? 'Exact'
                            : `${paidDiff[c] < 0 ? 'Short' : 'Over'} ${fmtMoney(Math.abs(paidDiff[c]), c)}`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Settling {collectDrivers.length} drivers — each is recorded at its expected net (no manual amount).
                    </p>
                  )}
                </div>
              ))}
            </div>

            {postError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {postError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={closeCollect} disabled={posting}>Cancel</button>
              <button className="btn-primary" onClick={recordCollection} disabled={posting}>
                {posting ? 'Posting…' : 'Confirm collection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
