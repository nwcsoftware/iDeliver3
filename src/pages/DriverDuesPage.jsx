import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { HandCoins, FilterX, FileDown, CheckCircle2, Banknote, X, AlertCircle, History, ChevronRight, ChevronDown, Lock, Unlock, Handshake, Store, CreditCard, Calendar, Trash2 } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { AmountSummaryContent, placeHoverPanel, orderDriverCollectedByCurrency, orderOfficeCollectedByCurrency, orderCollectedByCurrency, orderDriverCollectByCurrency, orderTotalsByCurrency } from '../lib/orderAmounts'
import { useApp } from '../context/AppContext'
import { isCancelledOrder } from '../lib/orderStatus'
import { useAuth } from '../context/AuthContext'
import SearchField from '../components/ui/SearchField'
import { useTableSort, SortTh } from '../components/ui/SortableTable'

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

const todayStr = () => new Date().toISOString().slice(0, 10)

/* Whether the filter panel is open — remembered per device, so someone who
   works with it folded away isn't folding it away again every visit. */
const FILTERS_KEY = 'ideliver:driverDuesFiltersOpen'

/* Money columns hold several currencies at once and there is no exchange rate
   on this page, so they cannot simply be added up. A row therefore ranks by
   its USD figure first and its LBP figure only settles ties — the order
   someone reading the column expects, without inventing a rate. LBP is clamped
   so it can never overtake a single dollar. */
const LBP_CAP = 1e9 - 1
const moneyRank = (m = {}) =>
  (Number(m.USD) || 0) * 1e9 + Math.max(-LBP_CAP, Math.min(LBP_CAP, Number(m.LBP) || 0))
/* The same, for the [currency, amount] pairs the history rows carry. */
const pairsRank = (pairs = []) => moneyRank(Object.fromEntries(pairs))

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

// Display name for an order's customer (company first, else person).
function customerLabel(c) {
  if (!c) return '—'
  return (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'
}

// Type markers for a customer contact — partner / supplier / credit — as icons.
function customerBadges(c) {
  if (!c) return []
  const types = Array.isArray(c.contact_types) ? c.contact_types : []
  const b = []
  if (types.includes('partner'))       b.push({ Icon: Handshake,  label: 'Partner',         cls: 'text-purple-400' })
  if (types.includes('supplier'))      b.push({ Icon: Store,      label: 'Supplier',        cls: 'text-amber-400' })
  if (c.credit_debit_allowed === true) b.push({ Icon: CreditCard, label: 'Credit customer', cls: 'text-cyan-400' })
  return b
}

/* Delivery completed — the driver has handed the goods to the customer. */
function isDelivered(o) { return o?.delivery_status === 'Delivered' }
/* Order marked Completed (the order_status enum stores this as 'delivered'). */
function isCompleted(o) { return o?.status === 'delivered' }
/* The customer's cash is accounted for and ready to reconcile with the driver:
   either the driver is holding it ("With Driver" = collected_by_driver / money
   collected by the driver) or it's already fully with the office (paid_to_office). */
function isReconcilable(o) { return ['collected_by_driver', 'paid_to_office'].includes(o?.payment_status) }
/* An order is ready for driver settlement (and to be closed from here) once it's
   Delivered, marked Completed, and its money is with the driver or the office —
   i.e. every order the driver can hand cash over for. Already-closed orders stay
   (historical). Credit-customer orders are excluded entirely — the driver collects
   no cash on them; the customer settles their account later on the Credit
   Customers page. Free orders are excluded too — they're waived to zero, so the
   driver carries no cash for them and they must not show under a driver or add to
   the driver's order count. */
function isSettlementEligible(o) {
  /* A cancelled order is never settled: no cash was carried, no order was
     worked, and the driver is not answerable for it. useApp().orders already
     holds it back, so this is belt and braces — but the two branches below
     would each let one through on their own (a super admin can force-close any
     row, and the credit branch tests only for collected cash), and that is
     exactly the kind of thing this guard is for. */
  if (isCancelledOrder(o)) return false
  if (o?.is_free_order === true) return false
  // Credit-customer orders carry no cash by default, but if the driver actually
  // collected from the customer, that cash must still be reconciled here — so the
  // call center can see whatever the driver holds regardless of the customer type.
  // Include a credit order only when the driver genuinely collected something.
  if (o?.customer?.credit_debit_allowed === true) {
    const dc = orderDriverCollectedByCurrency(o)
    return CURRENCIES.some(c => round2(dc[c]) > 0)
  }
  return o?.isclosed === true
    || (isDelivered(o) && isCompleted(o) && isReconcilable(o))
}

/* The closing date of an order (else its scheduled date) — what the call-center
   user filters the day's collections by. */
function orderDate(o) {
  const raw = o.closed_at || o.scheduled_date || o.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

/* ── page ─────────────────────────────────────────────────── */

export default function DriverDuesPage() {
  const { orders, drivers, loading, fetchOrders, showSummary, loadFullOrderHistory } = useApp()
  const { currentUser, hasRole } = useAuth()

  // Driver balances span the whole history, so pull every order (beyond the window).
  useEffect(() => { loadFullOrderHistory() }, [loadFullOrderHistory])
  const isSuperAdmin = hasRole('super_admin')
  // Name recorded as the one who locked (closed) an order, for the lock indicator.
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || null
  // Who may back-/forward-date the "Collect & close as of" settlement date.
  // Admins get this alongside super admins; everyone else settles as of today.
  const canBackdateSettlement = hasRole('super_admin', 'admin')

  const [tab,     setTab]     = useState('collect')   // 'collect' (dues to collect) | 'history'
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // The filter panel folds away: four boxes are a lot of height above a list
  // that is read line by line, and most of the day they are already set.
  const [filtersOpen, setFiltersOpen] = useState(() => {
    try { return localStorage.getItem(FILTERS_KEY) !== '0' } catch { return true }
  })
  const toggleFilters = () => setFiltersOpen(o => {
    const next = !o
    try { localStorage.setItem(FILTERS_KEY, next ? '1' : '0') } catch { /* private mode — just don't remember */ }
    return next
  })
  const [search,  setSearch]  = useState('')

  // Completed settlements (history tab).
  const [settlements,    setSettlements]    = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expanded,       setExpanded]       = useState(new Set())   // expanded settlement ids
  const [selectedSettlements, setSelectedSettlements] = useState(new Set())  // for bulk delete (super admin)
  const [deletingSettlements, setDeletingSettlements] = useState(false)

  const [settledIds,    setSettledIds]    = useState(new Set())   // orders already collected from driver
  const [dataLoading,   setDataLoading]   = useState(true)

  const [selected,    setSelected]    = useState(new Set())  // order ids picked for collection
  const [collectRows, setCollectRows] = useState([])         // rows being settled in the modal
  const [paidInput,   setPaidInput]   = useState(() => Object.fromEntries(CURRENCIES.map(c => [c, ''])))  // actual cash handed over
  const [posting,     setPosting]     = useState(false)
  const [postError,   setPostError]   = useState('')
  // Full-page progress overlay while collecting/closing + refreshing. Keeping it
  // up (opaquely) through the post-settlement refetches stops the list behind
  // from flickering as loading states toggle. null = hidden.
  // { pct: 0-100, label: string, phase: 'run' | 'done' }
  const [progress,    setProgress]    = useState(null)
  // "As of" date the collection is recorded and the orders are closed on. Super
  // admin can back-/forward-date the settlement; everyone else settles as of today.
  const [settleAsOf,  setSettleAsOf]  = useState(todayStr())

  const confirm = collectRows.length > 0   // settlement confirm modal open
  const [duesInfo, setDuesInfo] = useState(null)   // "no dues to collect" info modal (order)
  // Default the "as of" date to the "Date From" filter (the day being settled),
  // falling back to today when that filter isn't set.
  function openCollect(rows) { setPostError(''); setSettleAsOf(filters.date_from || todayStr()); setCollectRows(rows) }
  function closeCollect() { if (!posting) setCollectRows([]) }
  // Guarded collect: an order (or selection) with no driver dues AND no money paid
  // to the office has nothing to settle, so explain that instead of opening the
  // cash-collection modal. Paid-to-office orders are allowed through — they carry
  // no driver cash but are still closed as part of the settlement.
  function tryOpenCollect(rows) {
    if (rows.length > 0 && !rows.some(r => r.hasDues || r.paidToOffice)) { setDuesInfo(rows[0].order); return }
    openCollect(rows)
  }

  // Amounts summary hover preview — follows the cursor over each row (read-only).
  const [hoverSummary, setHoverSummary] = useState(null)   // { order, x, y }
  const hoverPanelRef = useRef(null)

  /* Orders eligible for driver-cash reconciliation: closed orders, plus orders
     that are completed and fully collected (driver holds all the money). */
  const closedOrders = useMemo(
    () => orders.filter(isSettlementEligible),
    [orders],
  )

  /* ── supplementary fetch: which orders are already settled ───
     Retail invoices come from the order's own nested data (petty cash is summed
     from o.retail_goods_invoices), so we only need the settled-order set here.
     The id list can be thousands long, so it's queried in chunks — a single
     .in(...) with every id would blow past the URL length limit and silently
     return nothing (which is what made petty cash and settled state come back
     empty). */
  const fetchSupplementary = useCallback(async () => {
    const ids = closedOrders.map(o => o.id)
    if (ids.length === 0) { setSettledIds(new Set()); setDataLoading(false); return }
    setDataLoading(true)

    // Chunk the id list (a single .in(...) with thousands of ids exceeds the URL
    // limit) but fire the chunks in PARALLEL — sequential awaits made the page
    // wait on ~14 back-to-back round-trips.
    const CHUNK = 300
    const slices = []
    for (let i = 0; i < ids.length; i += CHUNK) slices.push(ids.slice(i, i + CHUNK))
    const results = await Promise.all(
      slices.map(slice => supabase.from('driver_settlement_orders').select('order_id').in('order_id', slice)),
    )
    const settledSet = new Set()
    for (const { data } of results) for (const r of data ?? []) settledSet.add(r.order_id)
    setSettledIds(settledSet)
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
        driver:contacts!driver_id ( id, first_name, last_name, company_name ),
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
  // order_id → its settlement date, so closing an already-settled order (via the
  // Lock button) stamps closed_at with the day the cash was actually settled — the
  // date the money reaches the Cashier Box — not the day the button is clicked.
  // Settlements are fetched newest-first, so the first hit is the latest one.
  const settlementDateByOrder = useMemo(() => {
    const m = {}
    for (const s of settlements) {
      for (const l of (s.driver_settlement_orders ?? [])) {
        if (!(l.order_id in m)) m[l.order_id] = s.settlement_date
      }
    }
    return m
  }, [settlements])
  // order_id → order, for the customer name + type icons in the history lines.
  const orderById = useMemo(
    () => Object.fromEntries(orders.map(o => [o.id, o])),
    [orders],
  )

  function toggleExpand(id) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  /* ── delete settlements (super admin) ────────────────────────
     Removes the settlement record and its child rows (currency totals + order
     lines). The orders themselves stay closed — a super admin can reopen any of
     them from the To Collect tab (Unlock) to re-settle. */
  function toggleSettlement(id) {
    setSelectedSettlements(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function deleteSettlements(ids) {
    if (!isSuperAdmin || ids.length === 0) return
    if (!window.confirm(
      `Delete ${ids.length} settlement${ids.length === 1 ? '' : 's'}?\n\n` +
      'This removes the settlement record and its lines. The orders stay closed — ' +
      'reopen them from the To Collect tab (Unlock) if you need to re-settle. This cannot be undone.'
    )) return
    setDeletingSettlements(true)
    const e1 = (await supabase.from('driver_settlement_orders').delete().in('settlement_id', ids)).error
    const e2 = (await supabase.from('driver_settlement_currency_totals').delete().in('settlement_id', ids)).error
    const e3 = (await supabase.from('driver_daily_settlements').delete().in('id', ids)).error
    setDeletingSettlements(false)
    if (e1 || e2 || e3) { window.alert(`Could not delete: ${(e1 || e2 || e3).message}`); return }
    setSelectedSettlements(new Set())
    await Promise.all([fetchHistory(), fetchSupplementary()])
  }
  function toggleAllSettlements() {
    setSelectedSettlements(s => s.size === visibleSettlements.length
      ? new Set()
      : new Set(visibleSettlements.map(x => x.id)))
  }

  /* ── per-order reconciliation rows ───────────────────────── */

  // Collected cash, external retail (petty cash), and the net due from the
  // driver, per order and per currency.
  const allRows = useMemo(() => closedOrders.map(o => {
    // Driver dues are the cash the driver collected from the customer. Payments
    // taken directly by an office user (paid to office) are excluded — the driver
    // never handled that money, so it isn't part of their settlement.
    const byCur     = orderDriverCollectedByCurrency(o)
    const collected = emptyCur()
    for (const c of CURRENCIES) collected[c] = round2(byCur[c])
    // Money the customer paid directly to the office (an office user recorded it),
    // shown in its own column. The driver never handled it, so it isn't part of
    // their dues — it's here so the user sees the full picture of the order.
    const officeCur = orderOfficeCollectedByCurrency(o)
    const office    = emptyCur()
    for (const c of CURRENCIES) office[c] = round2(officeCur[c])
    // Petty cash used = total of the order's external retail invoices
    // (retail_goods_invoices), summed per currency from the order's own data.
    // An invoice flagged "Paid" (exclude_calculation) was settled directly by the
    // customer with the shop — the driver never spent petty cash on it, so it must
    // NOT reduce the outstanding amount owed by the driver and is skipped here.
    const retail    = emptyCur()
    const invoices  = o.retail_goods_invoices ?? []
    for (const r of invoices) {
      if (r.exclude_calculation) continue
      const cur = CURRENCIES.includes(r.currency) ? r.currency : 'USD'
      retail[cur] += round2(r.invoice_value)
    }
    // Balance the driver owes = cash collected from customers − what he paid out
    // of his own petty cash (retail_goods_invoices he bought for the orders). Can
    // go negative when he spent more petty cash than he collected — the office
    // then owes him the difference.
    const net = emptyCur()
    for (const c of CURRENCIES) net[c] = round2(collected[c] - retail[c])
    // Order total (full order value) — shown alongside collected so the user can
    // confirm the order is fully paid (collected ≈ total).
    const totalCur = orderTotalsByCurrency(o)
    const total    = emptyCur()
    for (const c of CURRENCIES) total[c] = round2(totalCur[c])
    return {
      order:     o,
      driver:    o.driver,
      collected, office, retail, net, total, invoices,
      settled:      settledIds.has(o.id),
      hasDues:      CURRENCIES.some(c => Math.abs(net[c]) > 0),
      paidToOffice: CURRENCIES.some(c => office[c] > 0),
    }
  }), [closedOrders, settledIds])

  // Orders still ready to collect (outstanding: not yet settled and not closed),
  // per driver — shown next to each driver in the picker. '' key = grand total.
  // The counts honour the Date From / Date To filters so each driver's number
  // matches the orders scheduled/closed in the selected date (or date range),
  // not their all-time outstanding total.
  const readyByDriver = useMemo(() => {
    const m = { '': 0 }
    for (const r of allRows) {
      if (r.settled || r.order.isclosed) continue
      const id = r.order.driver_id
      if (!id) continue
      const d = orderDate(r.order)
      if (filters.date_from && (!d || d < filters.date_from)) continue
      if (filters.date_to   && (!d || d > filters.date_to))   continue
      m[id] = (m[id] || 0) + 1
      m[''] += 1
    }
    return m
  }, [allRows, filters.date_from, filters.date_to])

  /* ── filtering ───────────────────────────────────────────── */

  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setSearch('') }

  const hasActiveFilters = search.trim() !== '' ||
    Object.entries(filters).some(([k, v]) => v !== EMPTY_FILTERS[k])

  const visible = useMemo(() => allRows.filter(({ order: o, driver, settled }) => {
    // Every row here is already fully paid or closed (isSettlementEligible), so
    // there's no "nothing to reconcile" gate — orders with zero driver dues still
    // show (their Collect button explains why there's nothing to encash).
    const d = orderDate(o)
    const s = search.trim().toLowerCase()
    const matchSearch = !s || [
      o.order_number, o.recipient_name, o.main_account,
      driverName(driver),
    ].some(v => String(v ?? '').toLowerCase().includes(s))

    const matchDriver = !filters.driver_id || o.driver_id === filters.driver_id
    const matchFrom   = !filters.date_from || (d && d >= filters.date_from)
    const matchTo     = !filters.date_to   || (d && d <= filters.date_to)
    // "Outstanding" = still to collect: not yet settled AND not already closed.
    // Orders closed/settled in a previous session are done, so they drop off the
    // To Collect list (they remain visible under Settled / All and in History).
    const matchSettled =
      filters.settled === 'all'        ? true :
      filters.settled === 'settled'    ? (settled || o.isclosed) :
      /* outstanding */                  (!settled && !o.isclosed)

    return matchSearch && matchDriver && matchFrom && matchTo && matchSettled
  }), [allRows, search, filters])

  /* ── selection (outstanding rows only) ───────────────────── */

  // Rows that can still be collected & closed: not settled and not already closed.
  // (Under the "All" filter a closed order can be visible — it must never be
  // selectable or counted toward a new collection.)
  const outstandingVisible = visible.filter(r => !r.settled && !r.order.isclosed)
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

  // Why the "Collect & Close" button is inactive, so the UI can explain it
  // instead of silently ignoring the click.
  const collectDisabledReason =
    !filters.driver_id            ? 'Pick a driver first'
    : outstandingVisible.length === 0 ? 'No outstanding orders to collect for this driver'
    : selectedRows.length === 0   ? 'Select at least one order'
    : ''

  /* ── totals (per currency) for the visible rows ──────────── */

  function sumRows(rows) {
    const t = { collected: emptyCur(), office: emptyCur(), retail: emptyCur(), net: emptyCur(), driverCollect: emptyCur() }
    for (const r of rows) {
      const dc = orderDriverCollectByCurrency(r.order)   // delivery fees + local retail items
      for (const c of CURRENCIES) {
        t.collected[c] += r.collected[c]
        t.office[c]    += r.office[c]
        t.retail[c]    += r.retail[c]
        t.net[c]       += r.net[c]
        t.driverCollect[c] += (dc[c] || 0)
      }
    }
    for (const c of CURRENCIES) {
      t.collected[c] = round2(t.collected[c]); t.office[c] = round2(t.office[c]); t.retail[c] = round2(t.retail[c]); t.net[c] = round2(t.net[c]); t.driverCollect[c] = round2(t.driverCollect[c])
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
    // Clearing the overlay on failure reveals the modal (which keeps its own
    // error message) so the user sees exactly what went wrong.
    const fail = (msg) => { setPostError(msg); setProgress(null); setPosting(false) }
    setProgress({ pct: 4, label: 'Preparing settlement…', phase: 'run' })

    // Effective date of this settlement — chosen "as of" date (super admin / admin) or today.
    // Timestamps derived from it use midday to avoid timezone date-shifting.
    const settleDate = settleAsOf || todayStr()
    const settleAt   = `${settleDate}T12:00:00`

    // Group the rows by driver — each driver gets one daily settlement header.
    const byDriver = new Map()
    for (const r of collectRows) {
      const id = r.order.driver_id
      if (!id) continue
      if (!byDriver.has(id)) byDriver.set(id, [])
      byDriver.get(id).push(r)
    }
    if (byDriver.size === 0) {
      fail('Selected orders have no driver assigned.'); return
    }

    // The actual amount handed over (modal inputs) only applies when settling a
    // single driver; if several drivers are batched, fall back to expected net.
    const singleDriver = byDriver.size === 1

    // Recording the settlements spans 5% → 55% of the bar, one slice per driver.
    const driverEntries = [...byDriver]
    for (let i = 0; i < driverEntries.length; i++) {
      const [driverId, rows] = driverEntries[i]
      setProgress({
        pct:   5 + Math.round((i / driverEntries.length) * 50),
        label: driverEntries.length === 1
          ? 'Recording settlement…'
          : `Recording settlement ${i + 1} of ${driverEntries.length}…`,
        phase: 'run',
      })
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
          received_at:     settleAt,
          status:          'completed',
        }])
        .select('id')
        .single()
      if (he) { fail(he.message); return }

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
        if (ce) { fail(ce.message); return }
      }

      // 3. Per-order lines — one row per (order, currency) with any activity.
      const lines = []
      for (const r of rows) {
        let emitted = false
        for (const c of CURRENCIES) {
          if (r.collected[c] || r.retail[c]) {
            lines.push({ settlement_id: settlement.id, order_id: r.order.id, currency: c, collected: r.collected[c], retail: r.retail[c] })
            emitted = true
          }
        }
        // Paid-to-office (or otherwise cashless) orders carry no driver money, but
        // still need a line so they register as settled and drop off the outstanding
        // list instead of lingering there forever.
        if (!emitted) {
          const cur = CURRENCIES.find(c => r.office[c] > 0) || 'USD'
          lines.push({ settlement_id: settlement.id, order_id: r.order.id, currency: cur, collected: 0, retail: 0 })
        }
      }
      if (lines.length > 0) {
        const { error: le } = await supabase.from('driver_settlement_orders').insert(lines)
        if (le) { fail(le.message); return }
      }
    }

    // Collecting the cash from the driver closes the orders in the same click —
    // money is now in the call center, so each order is locked via isclosed and
    // can no longer be edited (same flag the Deliveries list uses). The cash has
    // moved from the driver to the office, so payment_status becomes paid_to_office.
    setProgress({ pct: 60, label: 'Closing orders…', phase: 'run' })
    const closedIds = collectRows.map(r => r.order.id)
    if (closedIds.length > 0) {
      const { error: ue } = await supabase
        .from('delivery_orders')
        .update({
          isclosed:       true,
          closed_at:      settleAt,
          closed_by:      currentUser?.user_id || null,
          closed_by_name: currentUserName,
          payment_status: 'paid_to_office',
        })
        .in('id', closedIds)
      if (ue) { fail(ue.message); return }
    }

    // Refresh in place while the overlay stays up, so the underlying list's
    // loading toggles never flash on screen.
    setProgress({ pct: 72, label: 'Refreshing settlements…', phase: 'run' })
    await fetchSupplementary()   // refresh settled state → rows drop off "outstanding"
    setProgress({ pct: 86, label: 'Refreshing orders…', phase: 'run' })
    await fetchOrders()          // closed flag reflects in the list immediately
    setProgress({ pct: 95, label: 'Updating history…', phase: 'run' })
    await fetchHistory()         // new settlement appears in the History tab

    // Hold the completed bar briefly so the user registers success, then tear
    // down the modal and overlay together.
    setProgress({ pct: 100, label: 'Done', phase: 'done' })
    await new Promise(r => setTimeout(r, 650))
    setCollectRows([]); setPosting(false); setProgress(null)
  }

  /* ── mark an order as closed ─────────────────────────────────
     Only allowed once the cash has been collected from the driver (a settlement
     line exists) and nothing is pending — i.e. the order balance is zero. Locks
     the order via the same isclosed flag the Deliveries list uses. */
  const [closingId, setClosingId] = useState(null)

  async function markClosed(orderId) {
    setClosingId(orderId)
    // Close as of the settlement date (money-in-box date), not the click date, so
    // the order surfaces in the Cashier Box on the day it was actually settled.
    const day      = settlementDateByOrder[orderId] || todayStr()
    const closedAt = `${day}T12:00:00`
    const { error } = await supabase
      .from('delivery_orders')
      .update({ isclosed: true, closed_at: closedAt, closed_by: currentUser?.user_id || null, closed_by_name: currentUserName })
      .eq('id', orderId)
    setClosingId(null)
    if (!error) await fetchOrders()
  }

  // Super-admin only: reopen a closed order (clears the isclosed lock) so it can be
  // edited or re-settled.
  async function reopenClosed(orderId) {
    if (!isSuperAdmin) return
    setClosingId(orderId)
    const { error } = await supabase
      .from('delivery_orders')
      .update({ isclosed: false, closed_at: null, closed_by: null, closed_by_name: null })
      .eq('id', orderId)
    setClosingId(null)
    if (!error) await fetchOrders()
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
        'Total USD', 'Total LBP', 'Collected USD', 'Collected LBP', 'Petty USD', 'Petty LBP', 'To office USD', 'To office LBP', 'Balance USD', 'Balance LBP', 'Settled']],
      body: visible.map(r => [
        orderDate(r.order) || '—',
        r.order.order_number ?? '—',
        driverName(r.driver),
        r.order.recipient_name ?? '—',
        r.total.USD.toFixed(2),     r.total.LBP.toFixed(0),
        r.collected.USD.toFixed(2), r.collected.LBP.toFixed(0),
        r.retail.USD.toFixed(2),    r.retail.LBP.toFixed(0),
        r.office.USD.toFixed(2),    r.office.LBP.toFixed(0),
        r.net.USD.toFixed(2),       r.net.LBP.toFixed(0),
        r.settled ? 'Yes' : 'No',
      ]),
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' }, 13: { halign: 'right' } },
    })

    let y = (doc.lastAutoTable?.finalY ?? 32) + 8
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text(`Orders: ${visible.length}`, marginX, y); y += 6
    for (const c of CURRENCIES) {
      if (!visibleTotals.collected[c] && !visibleTotals.office[c] && !visibleTotals.retail[c]) continue
      const pettyPart  = visibleTotals.retail[c] ? `   Petty cash ${fmtMoney(visibleTotals.retail[c], c)}` : ''
      const officePart = visibleTotals.office[c] ? `   Paid to office ${fmtMoney(visibleTotals.office[c], c)}` : ''
      doc.text(
        `${c} — Collected ${fmtMoney(visibleTotals.collected[c], c)}${pettyPart}${officePart}   Balance pending from driver ${fmtMoney(visibleTotals.net[c], c)}`,
        marginX, y)
      y += 5
    }

    doc.save(`driver-dues-${now.toISOString().slice(0, 10)}.pdf`)
  }

  /* Per-settlement money figures (mirrors the History table's own logic), so the
     PDF shows exactly what's on screen — including the fallback to what customers
     paid when a settlement stored no currency totals. */
  function settlementMoney(s) {
    const totals = s.driver_settlement_currency_totals ?? []
    const lines  = s.driver_settlement_orders ?? []
    const hasStored = totals.some(t => Number(t.total_collected) || Number(t.amount_paid) || Number(t.difference))
    const fallback = {}
    if (!hasStored) {
      for (const oid of [...new Set(lines.map(l => l.order_id))]) {
        const o = orderById[oid]; if (!o) continue
        for (const [cur, amt] of Object.entries(orderCollectedByCurrency(o))) fallback[cur] = round2((fallback[cur] || 0) + amt)
      }
    }
    const fallbackEntries = Object.entries(fallback).filter(([, amt]) => amt)
    return {
      collectedRows: hasStored ? totals.filter(t => Number(t.total_collected)).map(t => [t.currency, Number(t.total_collected)]) : fallbackEntries,
      receivedRows:  hasStored ? totals.filter(t => Number(t.amount_paid)).map(t => [t.currency, Number(t.amount_paid)]) : fallbackEntries,
      diffRows:      hasStored ? totals.filter(t => Number(t.difference)).map(t => [t.currency, Number(t.difference)]) : [],
    }
  }

  /* ── PDF export — the History tab as currently filtered ──── */
  function exportHistoryPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Driver Settlements — History', marginX, 16)
    doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`Generated: ${now.toLocaleString()}`, marginX, 22)
    doc.text(`Filters — ${activeFilterSummary()}`, marginX, 27)

    const joinRows = rows => rows.length ? rows.map(([cur, amt]) => fmtMoney(amt, cur)).join('  ') : '—'
    const joinDiff = rows => rows.length
      ? rows.map(([cur, d]) => `${d < 0 ? 'Short' : 'Over'} ${fmtMoney(Math.abs(d), cur)}`).join('  ')
      : 'Exact'

    autoTable(doc, {
      startY: 32,
      head: [['Date', 'Driver', 'Orders', 'Collected from customers', 'Received from driver', 'Difference', 'Recorded']],
      body: visibleSettlements.map(s => {
        const { collectedRows, receivedRows, diffRows } = settlementMoney(s)
        return [
          s.settlement_date ?? '—',
          driverName(s.driver || drivers.find(d => d.id === s.driver_id)),
          String(s.total_orders ?? ''),
          joinRows(collectedRows),
          joinRows(receivedRows),
          joinDiff(diffRows),
          s.received_at ? new Date(s.received_at).toLocaleString() : '—',
        ]
      }),
      styles: { fontSize: 8, cellPadding: 1.3 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    })

    // ── Summary of totals across the (filtered) settlements ──
    const sumBy = key => {
      const t = {}
      for (const s of visibleSettlements) {
        for (const [cur, amt] of settlementMoney(s)[key]) t[cur] = round2((t[cur] || 0) + amt)
      }
      return t
    }
    const totCollected = sumBy('collectedRows')
    const totReceived  = sumBy('receivedRows')
    const totDiff      = sumBy('diffRows')
    const totalOrders  = visibleSettlements.reduce((n, s) => n + (Number(s.total_orders) || 0), 0)
    const curLine = map => CURRENCIES.filter(c => map[c]).map(c => fmtMoney(map[c], c)).join('   ') || '—'

    let y = (doc.lastAutoTable?.finalY ?? 32) + 8
    doc.setFontSize(11); doc.setTextColor(20)
    doc.text('Summary', marginX, y); y += 6
    doc.setFontSize(9); doc.setTextColor(40)
    doc.text(`Settlements: ${visibleSettlements.length}     Orders: ${totalOrders}`, marginX, y); y += 5
    doc.text(`Total collected from customers:  ${curLine(totCollected)}`, marginX, y); y += 5
    doc.text(`Total received from driver:      ${curLine(totReceived)}`, marginX, y); y += 5
    doc.text(`Total difference:                ${curLine(totDiff)}`, marginX, y); y += 5

    doc.save(`driver-settlements-history-${now.toISOString().slice(0, 10)}.pdf`)
  }

  const busy = loading.orders || dataLoading
  // Columns in the History table: chevron + 7 data cols, plus (super admin) a
  // leading select checkbox and a trailing actions cell.
  const historyColSpan = 8 + (isSuperAdmin ? 2 : 0)

  /* ── history filtering (driver / date / search) ──────────── */

  const visibleSettlements = useMemo(() => settlements.filter(s => {
    if (filters.driver_id && s.driver_id !== filters.driver_id) return false
    if (filters.date_from && s.settlement_date < filters.date_from) return false
    if (filters.date_to   && s.settlement_date > filters.date_to)   return false
    const q = search.trim().toLowerCase()
    if (q) {
      const dn = driverName(s.driver || drivers.find(d => d.id === s.driver_id)).toLowerCase()
      const inOrders = (s.driver_settlement_orders ?? [])
        .some(l => String(orderNumById[l.order_id] ?? '').toLowerCase().includes(q))
      if (!dn.includes(q) && !inOrders) return false
    }
    return true
  }), [settlements, filters, search, drivers, orderNumById])

  /* ── render ──────────────────────────────────────────────── */

  /* What a settlement's three money columns hold. Pulled out of the row so the
     column can be SORTED by the same figures it displays — including the
     fallback for settlements that stored no currency totals (paid-to-office and
     cashless ones), which would otherwise all sort as zero. */
  const settlementFigures = useCallback((sr) => {
    const totals = sr.driver_settlement_currency_totals ?? []
    const lines  = sr.driver_settlement_orders ?? []
    const hasStored = totals.some(t => Number(t.total_collected) || Number(t.amount_paid) || Number(t.difference))
    const fallback = {}
    if (!hasStored) {
      for (const oid of [...new Set(lines.map(l => l.order_id))]) {
        const o = orderById[oid]; if (!o) continue
        for (const [cur, amt] of Object.entries(orderCollectedByCurrency(o))) fallback[cur] = round2((fallback[cur] || 0) + amt)
      }
    }
    const fallbackEntries = Object.entries(fallback).filter(([, amt]) => amt)
    return {
      lines,
      collectedRows: hasStored
        ? totals.filter(t => Number(t.total_collected)).map(t => [t.currency, Number(t.total_collected)])
        : fallbackEntries,
      receivedRows: hasStored
        ? totals.filter(t => Number(t.amount_paid)).map(t => [t.currency, Number(t.amount_paid)])
        : fallbackEntries,   // paid to office = money already accounted for
      diffRows: hasStored ? totals.filter(t => Number(t.difference)).map(t => [t.currency, Number(t.difference)]) : [],
    }
  }, [orderById])

  /* ── sorting ─────────────────────────────────────────────────
     Both lists sort by what a column MEANS, not by the text in it: a date by
     its day, an amount by its figure. Clicking a third time returns to the
     order the query gave, which for these lists is the meaningful one. */
  const collectSortValue = useCallback((r, key) => {
    const o = r.order || {}
    switch (key) {
      case 'date':      return orderDate(o) || ''
      case 'order':     return o.order_number ?? ''
      case 'customer':  return o.recipient_name ?? ''
      case 'value':     return moneyRank(r.total)
      case 'collected': return moneyRank(r.collected)
      case 'retail':    return moneyRank(r.retail)
      case 'net':       return moneyRank(r.net)
      default:          return null
    }
  }, [])
  const { sort: collectSort, cycle: cycleCollect, sortRows: sortCollect } = useTableSort(collectSortValue)
  // Sorting reorders the list; it never changes what is in it, so the totals,
  // the selection and the collect button all keep reading `visible`.
  const visibleSorted = useMemo(() => sortCollect(visible), [sortCollect, visible])

  const historySortValue = useCallback((sr, key) => {
    switch (key) {
      case 'date':       return sr.settlement_date || ''
      case 'driver':     return driverName(sr.driver || drivers.find(d => d.id === sr.driver_id))
      case 'orders':     return Number(sr.total_orders) || 0
      case 'collected':  return pairsRank(settlementFigures(sr).collectedRows)
      case 'received':   return pairsRank(settlementFigures(sr).receivedRows)
      case 'difference': return pairsRank(settlementFigures(sr).diffRows)
      case 'recorded':   return sr.received_at || ''
      default:           return null
    }
  }, [drivers, settlementFigures])
  const { sort: historySort, cycle: cycleHistory, sortRows: sortHistory } = useTableSort(historySortValue)
  const settlementsSorted = useMemo(() => sortHistory(visibleSettlements), [sortHistory, visibleSettlements])

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* No page icon or row count here: the header already names the page. */}
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order #, recipient, account, driver…"
            className="input pl-9"
          />
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
        <button type="button" onClick={toggleFilters} aria-expanded={filtersOpen}
          className={`flex w-full items-center gap-1.5 text-left text-[11px] uppercase tracking-wider font-semibold text-slate-500 hover:text-slate-300 transition-colors ${filtersOpen ? 'mb-3' : ''}`}>
          {filtersOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Filters
          {/* Folded away, it still says what is being filtered — a hidden
              filter that silently shortens the list is how a page comes to
              look wrong for no visible reason. */}
          {!filtersOpen && (
            <span className="ml-1.5 normal-case tracking-normal text-slate-400 truncate">
              {[selectedDriverName || 'All drivers',
                filters.date_from ? `from ${filters.date_from}` : null,
                filters.date_to   ? `to ${filters.date_to}`     : null,
                tab === 'collect' ? filters.settled : null,
              ].filter(Boolean).join(' · ')}
            </span>
          )}
        </button>
        <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${filtersOpen ? '' : 'hidden'}`}>
          <div>
            <label className="label">Driver</label>
            <select className="input" value={filters.driver_id} onChange={e => setFilter('driver_id', e.target.value)}>
              <option value="">All drivers{readyByDriver[''] ? ` (${readyByDriver['']} to collect)` : ''}</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>
                  {driverName(d)}{readyByDriver[d.id] ? ` (${readyByDriver[d.id]})` : ''}
                </option>
              ))}
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
        {filtersOpen && tab === 'collect' && !filters.driver_id && (
          <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> Pick a driver to select orders and record a cash collection.
          </p>
        )}
      </div>

      {/* ── To Collect tab ─────────────────────────────────── */}
      {tab === 'collect' && (<>

      {/* Selected driver name — shown only when a specific driver is filtered
          (nothing when "All drivers" is selected). */}
      {filters.driver_id && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs uppercase tracking-wider text-slate-500">Driver</span>
          <span className="text-sm font-semibold text-slate-100">{selectedDriverName}</span>
        </div>
      )}

      {/* List. The table scrolls inside the card so its header can stay put —
          a driver's day runs to dozens of orders and seven money columns, and
          a figure means nothing once its heading has scrolled away. */}
      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="sticky top-0 z-10 bg-surface-card">
            <tr className="border-b border-surface-border">
              <th className="px-3 py-3 w-10 bg-surface-card">
                {canCollect && (
                  <input type="checkbox"
                    checked={selected.size > 0 && selected.size === outstandingVisible.length}
                    onChange={toggleAll} />
                )}
              </th>
              <SortTh label="Date"                           sortKey="date"      sort={collectSort} onSort={cycleCollect} className="text-slate-500 text-xs whitespace-nowrap" />
              <SortTh label="Order #"                        sortKey="order"     sort={collectSort} onSort={cycleCollect} className="text-slate-500 text-xs whitespace-nowrap" />
              <SortTh label="Customer"                       sortKey="customer"  sort={collectSort} onSort={cycleCollect} className="text-slate-500 text-xs whitespace-nowrap" />
              <SortTh label="Order value"                    sortKey="value"     sort={collectSort} onSort={cycleCollect} className="text-slate-500 text-xs whitespace-nowrap" align="right" />
              <SortTh label="Collected from customer"        sortKey="collected" sort={collectSort} onSort={cycleCollect} className="text-slate-500 text-xs whitespace-nowrap" align="right" />
              <SortTh label="Petty cash used"                sortKey="retail"    sort={collectSort} onSort={cycleCollect} className="text-slate-500 text-xs whitespace-nowrap" align="right" />
              <SortTh label="Outstanding amount from driver" sortKey="net"       sort={collectSort} onSort={cycleCollect} className="text-slate-500 text-xs whitespace-nowrap" align="right" />
              <th className="px-4 py-3 bg-surface-card" />
            </tr>
          </thead>
          <tbody onMouseLeave={() => setHoverSummary(null)}>
            {busy ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No driver collections found</td></tr>
            ) : visibleSorted.map(r => {
              const o = r.order
              const selectable = !r.settled && !o.isclosed && !!filters.driver_id
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
                  <td className="px-4 py-3 text-slate-300 text-xs">{o.recipient_name ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                    {CURRENCIES.filter(c => r.total[c] > 0).map(c => (
                      <div key={c} className="text-slate-200">{fmtMoney(r.total[c], c)}</div>
                    ))}
                    {!CURRENCIES.some(c => r.total[c] > 0) && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                    {CURRENCIES.filter(c => r.collected[c] > 0).map(c => (
                      <div key={c} className="text-green-400">{fmtMoney(r.collected[c], c)}</div>
                    ))}
                    {!CURRENCIES.some(c => r.collected[c] > 0) && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                    {CURRENCIES.filter(c => r.retail[c] > 0).map(c => (
                      <div key={c} className="text-amber-400">{fmtMoney(r.retail[c], c)}</div>
                    ))}
                    {!CURRENCIES.some(c => r.retail[c] > 0) && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-right whitespace-nowrap font-medium">
                    {CURRENCIES.filter(c => r.net[c] !== 0).map(c => (
                      <div key={c} className="text-slate-100">{fmtMoney(r.net[c], c)}</div>
                    ))}
                    {r.net.USD === 0 && r.net.LBP === 0 && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!r.settled && !o.isclosed && (
                        <button className="btn-primary py-1 px-2.5 text-xs" onClick={() => tryOpenCollect([r])}>
                          <Banknote className="w-3.5 h-3.5" /> Collect
                        </button>
                      )}
                      {!o.isclosed && (
                        <button
                          onClick={() => markClosed(o.id)}
                          disabled={!r.settled || closingId === o.id}
                          title={r.settled
                            ? 'Mark as closed'
                            : 'Collect the cash from the driver first — balance must be zero'}
                          className="btn-ghost p-1.5 text-slate-500 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                          <Lock className="w-4 h-4" />
                        </button>
                      )}
                      {o.isclosed && isSuperAdmin && (
                        <button
                          onClick={() => reopenClosed(o.id)}
                          disabled={closingId === o.id}
                          title="Reopen — unmark as closed (super admin)"
                          className="btn-ghost p-1.5 text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                          <Unlock className="w-4 h-4" />
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
              {CURRENCIES.filter(c => visibleTotals.collected[c] || visibleTotals.retail[c]).map(c => (
                <div key={c} className="text-xs text-slate-300">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold mr-1.5">{c}</span>
                  <span className="text-green-400">Collected from customer {fmtMoney(visibleTotals.collected[c], c)}</span>
                  {visibleTotals.retail[c] > 0 && (<>
                    <span className="text-slate-600 mx-1">·</span>
                    <span className="text-amber-400">Petty cash used {fmtMoney(visibleTotals.retail[c], c)}</span>
                  </>)}
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="font-semibold text-[#1dffd5] [text-shadow:0_0_6px_rgba(29,255,213,0.75)]">Balance pending {fmtMoney(visibleTotals.net[c], c)}</span>
                </div>
              ))}
              {!CURRENCIES.some(c => visibleTotals.collected[c] || visibleTotals.retail[c]) && (
                <span className="text-sm text-slate-500">No totals</span>
              )}
            </div>
            <button className="btn-ghost text-slate-300" onClick={exportPDF} disabled={visible.length === 0}>
              <FileDown className="w-4 h-4" /> PDF
            </button>
            <div className="flex items-center gap-2">
              {collectDisabledReason && (
                <span className="text-xs text-amber-400/90 flex items-center gap-1 whitespace-nowrap">
                  <AlertCircle className="w-3.5 h-3.5" /> {collectDisabledReason}
                </span>
              )}
              <button className="btn-primary" onClick={() => tryOpenCollect(selectedRows)}
                disabled={!!collectDisabledReason}
                title={collectDisabledReason || 'Record cash collection and close the selected orders'}>
                <Banknote className="w-4 h-4" /> Collect &amp; Close
              </button>
            </div>
          </div>
        </div>
      </div>

      </>)}

      {/* ── History tab ────────────────────────────────────── */}
      {tab === 'history' && (<>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-slate-500">
            {visibleSettlements.length} settlement{visibleSettlements.length === 1 ? '' : 's'}{hasActiveFilters ? ' (filtered)' : ''}
            {isSuperAdmin && selectedSettlements.size > 0 && <span className="text-slate-400"> · {selectedSettlements.size} selected</span>}
          </span>
          <div className="flex items-center gap-2">
            {isSuperAdmin && selectedSettlements.size > 0 && (
              <button className="btn-ghost text-red-400 hover:text-red-300" disabled={deletingSettlements}
                onClick={() => deleteSettlements([...selectedSettlements])}>
                <Trash2 className="w-4 h-4" /> {deletingSettlements ? 'Deleting…' : `Delete selected (${selectedSettlements.size})`}
              </button>
            )}
            <button className="btn-ghost text-slate-300" onClick={exportHistoryPDF} disabled={visibleSettlements.length === 0}>
              <FileDown className="w-4 h-4" /> Export PDF
            </button>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="sticky top-0 z-10 bg-surface-card">
              <tr className="border-b border-surface-border">
                {isSuperAdmin && (
                  <th className="px-3 py-3 w-8 bg-surface-card">
                    <input type="checkbox"
                      checked={selectedSettlements.size > 0 && selectedSettlements.size === visibleSettlements.length}
                      onChange={toggleAllSettlements} title="Select all" />
                  </th>
                )}
                <th className="px-3 py-3 w-8 bg-surface-card" />
                <SortTh label="Date"                           sortKey="date"       sort={historySort} onSort={cycleHistory} className="text-slate-500 text-xs whitespace-nowrap" />
                <SortTh label="Driver"                         sortKey="driver"     sort={historySort} onSort={cycleHistory} className="text-slate-500 text-xs whitespace-nowrap" />
                <SortTh label="Orders"                         sortKey="orders"     sort={historySort} onSort={cycleHistory} className="text-slate-500 text-xs whitespace-nowrap" />
                <SortTh label="Total collected from customers" sortKey="collected"  sort={historySort} onSort={cycleHistory} className="text-slate-500 text-xs whitespace-nowrap" align="right" />
                <SortTh label="Total received from driver"     sortKey="received"   sort={historySort} onSort={cycleHistory} className="text-slate-500 text-xs whitespace-nowrap" align="right" />
                <SortTh label="Difference"                     sortKey="difference" sort={historySort} onSort={cycleHistory} className="text-slate-500 text-xs whitespace-nowrap" align="right" />
                <SortTh label="Recorded"                       sortKey="recorded"   sort={historySort} onSort={cycleHistory} className="text-slate-500 text-xs whitespace-nowrap" />
                {isSuperAdmin && <th className="px-4 py-3 bg-surface-card" />}
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr><td colSpan={historyColSpan} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
              ) : visibleSettlements.length === 0 ? (
                <tr><td colSpan={historyColSpan} className="px-4 py-10 text-center text-slate-500">No settlements recorded yet</td></tr>
              ) : settlementsSorted.map(s => {
                const isOpen = expanded.has(s.id)
                // The same figures the columns sort by — including the fallback
                // for settlements that stored no currency totals (paid-to-office
                // and cashless ones).
                const { lines, collectedRows, receivedRows, diffRows } = settlementFigures(s)
                return (
                  <React.Fragment key={s.id}>
                    <tr onClick={() => toggleExpand(s.id)}
                      className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors cursor-pointer ${selectedSettlements.has(s.id) ? 'bg-red-500/5' : ''}`}>
                      {isSuperAdmin && (
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedSettlements.has(s.id)} onChange={() => toggleSettlement(s.id)} />
                        </td>
                      )}
                      <td className="px-3 py-3 text-slate-500">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{s.settlement_date}</td>
                      <td className="px-4 py-3 text-slate-200 text-xs whitespace-nowrap">{driverName(s.driver || drivers.find(d => d.id === s.driver_id))}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{s.total_orders}</td>
                      <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                        {collectedRows.map(([cur, amt]) => (
                          <div key={cur} className="text-green-400">{fmtMoney(amt, cur)}</div>
                        ))}
                        {collectedRows.length === 0 && <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                        {receivedRows.map(([cur, amt]) => (
                          <div key={cur} className="text-slate-100">{fmtMoney(amt, cur)}</div>
                        ))}
                        {receivedRows.length === 0 && <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-right whitespace-nowrap">
                        {diffRows.map(([cur, diff]) => (
                          <div key={cur} className={diff < 0 ? 'text-red-400' : 'text-green-400'}>
                            {diff < 0 ? 'Short ' : 'Over '}{fmtMoney(Math.abs(diff), cur)}
                          </div>
                        ))}
                        {diffRows.length === 0 && <span className="text-slate-500">Exact</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {s.received_at ? new Date(s.received_at).toLocaleString() : '—'}
                      </td>
                      {isSuperAdmin && (
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <button onClick={() => deleteSettlements([s.id])} disabled={deletingSettlements}
                            title="Delete this settlement (super admin)"
                            className="btn-ghost p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface/40">
                        <td colSpan={historyColSpan} className="px-4 py-3">
                          <div className="rounded-lg border border-surface-border overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-surface-card/60 text-slate-500">
                                  <th className="text-left px-3 py-2 font-medium">Order #</th>
                                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                                  <th className="text-left px-3 py-2 font-medium">Currency</th>
                                  <th className="text-right px-3 py-2 font-medium">Collected</th>
                                  <th className="text-right px-3 py-2 font-medium">Petty cash (retail)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.length === 0 ? (
                                  <tr><td colSpan={5} className="px-3 py-3 text-center text-slate-500">No order lines</td></tr>
                                ) : lines.map((l, i) => {
                                  const ord    = orderById[l.order_id]
                                  const cust   = ord?.customer
                                  const badges = customerBadges(cust)
                                  // Show the order's actual collected for this currency when the
                                  // stored line has none (paid-to-office / cashless settlements).
                                  const lineCollected = Number(l.collected) || (ord ? orderCollectedByCurrency(ord)[l.currency] || 0 : 0)
                                  return (
                                  <tr key={i} className="border-t border-surface-border/50">
                                    <td className="px-3 py-2 font-mono text-brand-400">{orderNumById[l.order_id] ?? '—'}</td>
                                    <td className="px-3 py-2 text-slate-300">
                                      <span className="inline-flex items-center gap-1.5">
                                        {badges.map((b, bi) => { const I = b.Icon; return <I key={bi} className={`w-3.5 h-3.5 flex-shrink-0 ${b.cls}`} title={b.label} /> })}
                                        <span>{customerLabel(cust)}</span>
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-slate-400">{l.currency}</td>
                                    <td className="px-3 py-2 text-right text-green-400">{fmtMoney(lineCollected, l.currency)}</td>
                                    <td className="px-3 py-2 text-right text-amber-400">{fmtMoney(l.retail, l.currency)}</td>
                                  </tr>
                                  )
                                })}
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
        </div>
      </>)}

      {/* "No dues to collect" info — shown when Collect is clicked on an order whose
          driver dues are zero (nothing was collected by the driver). */}
      {duesInfo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setDuesInfo(null)}>
          <div className="card w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 p-4 border-b border-surface-border bg-amber-500/10">
              <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-slate-100 font-semibold">
                  Nothing to encash on order {duesInfo.order_number}
                </h3>
                <p className="text-slate-400 text-xs mt-1">Total dues for this order are zero.</p>
              </div>
            </div>
            <div className="p-4 space-y-3 text-sm text-slate-300">
              <p>This order has no driver transaction yet. Either:</p>
              <ul className="space-y-2 text-xs text-slate-400">
                <li className="flex items-start gap-2">
                  <span className="text-brand-400 mt-0.5">1.</span>
                  <span>The <span className="text-slate-200">driver must confirm the collection from his application</span>, or</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-brand-400 mt-0.5">2.</span>
                  <span>If the customer <span className="text-slate-200">paid the call center directly</span>, create a payment transaction from the <span className="text-slate-200">order form</span> or the <span className="text-slate-200">daily order list</span> ("Record payment").</span>
                </li>
              </ul>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-surface-border">
              <button type="button" onClick={() => setDuesInfo(null)}
                className="btn-primary py-1.5 px-4 text-sm">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Amounts hover preview (follows the cursor; read-only) */}
      {showSummary && hoverSummary && (
        <div ref={hoverPanelRef}
          className="fixed z-[55] pointer-events-none card border border-surface-border rounded-lg shadow-xl overflow-hidden"
          style={{ left: hoverSummary.x + 16, top: hoverSummary.y + 16, width: 340 }}>
          <AmountSummaryContent order={hoverSummary.order} />
        </div>
      )}

      {/* Progress overlay — covers the page while collecting/closing + refreshing.
          Opaque enough to hide the list re-rendering behind it (no flicker) and
          pointer-events block every other control until it's done. */}
      {progress && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="card w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center gap-2">
              {progress.phase === 'done'
                ? <CheckCircle2 className="w-5 h-5 text-green-400" />
                : <Banknote className="w-5 h-5 text-brand-400 animate-pulse" />}
              <h3 className="text-sm font-semibold text-slate-100">
                {progress.phase === 'done' ? 'Settlement complete' : 'Collecting & closing…'}
              </h3>
              <span className="ml-auto text-xs tabular-nums text-slate-400">{progress.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  progress.phase === 'done' ? 'bg-green-500' : 'bg-brand-500'}`}
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">{progress.label}</p>
          </div>
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

            {(() => {
              const officeRows = collectRows.filter(r => r.paidToOffice)
              const duesRows   = collectRows.filter(r => r.hasDues)
              const hasOffice  = officeRows.length > 0
              const hasDues    = CURRENCIES.some(c => collectTotals.collected[c])
              return (<>
            <p className="text-sm text-slate-400">
              Settling <span className="text-slate-100 font-medium">{collectRows.length}</span> order{collectRows.length === 1 ? '' : 's'} for{' '}
              <span className="text-slate-100 font-medium">{collectDriverLabel}</span>.
              {hasDues && <> Collect the cash the driver holds{hasOffice ? ',' : ' and'} record the settlement</>}
              {hasOffice && <> {hasDues ? 'and close the' : 'Close the'} <span className="text-sky-300 font-medium">{officeRows.length}</span> order{officeRows.length === 1 ? '' : 's'} already paid to the office</>}
              . <span className="text-slate-200 font-medium">All selected orders are closed</span> and locked once done.
              {hasDues && <> Enter the actual amount the driver hands over — any shortfall or overage is saved as the difference.</>}
            </p>

            {/* Paid-to-office summary: money that reached the office directly, so the
                driver owes nothing on these — they're just closed with the batch. */}
            {hasOffice && (
              <div className="rounded-lg border border-sky-600/30 bg-sky-600/5 overflow-hidden">
                <div className="px-3 py-2 border-b border-sky-600/20 flex items-center justify-between">
                  <span className="text-xs font-semibold text-sky-300">Paid directly to office · {officeRows.length} order{officeRows.length === 1 ? '' : 's'}</span>
                  <span className="text-[11px] text-slate-500">no cash to collect from driver</span>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-surface-border/40">
                  {officeRows.map(r => (
                    <div key={r.order.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="font-mono text-brand-400">{r.order.order_number}</span>
                      <span className="text-slate-400 truncate mx-2 flex-1">{r.order.recipient_name}</span>
                      <span className="text-right whitespace-nowrap">
                        {CURRENCIES.filter(c => r.office[c] > 0).map(c => (
                          <span key={c} className="text-sky-400 ml-2">{fmtMoney(r.office[c], c)}</span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 border-t border-sky-600/20 flex items-center justify-end gap-4 text-xs">
                  <span className="text-slate-500">Total to office</span>
                  {CURRENCIES.filter(c => collectTotals.office[c]).map(c => (
                    <span key={c} className="text-sky-300 font-semibold">{fmtMoney(collectTotals.office[c], c)}</span>
                  ))}
                </div>
              </div>
            )}

            {hasDues && (
            <div className="rounded-lg border border-surface-border divide-y divide-surface-border/60">
              {CURRENCIES.filter(c => collectTotals.collected[c] || collectTotals.retail[c]).map(c => (
                <div key={c} className="px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 uppercase tracking-wider text-xs font-semibold">{c}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-green-400 text-xs">Collected {fmtMoney(collectTotals.collected[c], c)}</span>
                      {collectTotals.retail[c] > 0 && (
                        <span className="text-amber-400 text-xs">Petty cash {fmtMoney(collectTotals.retail[c], c)}</span>
                      )}
                      <span className="text-slate-100 font-semibold">Balance pending {fmtMoney(collectTotals.net[c], c)}</span>
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
            )}
              </>)
            })()}

            {/* "As of" date — super admin & admin can back-/forward-date the
                settlement and the order closing. Everyone else settles as of today. */}
            {canBackdateSettlement ? (
              <div className="rounded-lg border border-surface-border px-3 py-2.5 flex items-center justify-between gap-3">
                <label htmlFor="settle-as-of" className="text-xs text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                  <Calendar className="w-3.5 h-3.5" /> Collect &amp; close as of
                </label>
                <input
                  id="settle-as-of"
                  type="date"
                  className="input py-1 px-2 text-sm w-40"
                  value={settleAsOf}
                  onChange={e => setSettleAsOf(e.target.value)}
                  disabled={posting}
                />
              </div>
            ) : (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Settled as of {settleAsOf}.
              </p>
            )}

            <div className="flex items-center gap-2 rounded-lg border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs text-amber-300">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                <span className="font-semibold">{collectRows.length}</span> order{collectRows.length === 1 ? '' : 's'} will be
                closed and locked — this can't be undone from here.
              </span>
            </div>

            {postError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {postError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={closeCollect} disabled={posting}>Cancel</button>
              <button className="btn-primary" onClick={recordCollection} disabled={posting}>
                {posting ? 'Posting…' : `Collect & close ${collectRows.length} order${collectRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
