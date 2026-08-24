import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  AlertCircle,
  Calendar,
  FilterX,
  FileDown,
  ShieldCheck,
  ArrowRightLeft,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { OrderNumber } from '../components/orders/OrderQuickView'
import DataLoadingOverlay from '../components/ui/DataLoadingOverlay'
import {
  scanCurrencyIssues, limitsFor, DEFAULT_CURRENCY_LIMITS,
} from '../lib/currencyCheck'
import { orderTouchesInactive } from '../lib/contactVisibility'
import { periodRange, DEFAULT_PERIOD } from '../lib/currencyCheckPeriod'
import { fetchOrdersForPeriod } from '../lib/currencyCheckData'
import SearchField from '../components/ui/SearchField'
import { useTableSort, SortTh } from '../components/ui/SortableTable'

const fmt = (v, c) => `${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c}`

const customerName = (c) => (c?.company_name?.trim()
  || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || '—')

/* Currency check — amounts that look like they were typed against the wrong
   currency.

   USD and LBP are three orders of magnitude apart, so a mis-set selector
   produces a figure that is obvious to a person and invisible to the software.
   This lists every one of them in a single place, per money line rather than
   per order, because an order legitimately carries several currencies at once.

   Nothing here is corrected automatically: the page reports, the operator
   decides. Opening the order number gives the full picture before touching it. */
export default function CurrencyCheckPage() {
  const { inactiveContactIds, appSettings, COMPANY_ID } = useApp()
  const { hasRole } = useAuth()
  const isSuperAdmin = hasRole('super_admin')

  /* The bounds come from App Settings, so what counts as suspect is the
     company's own rule rather than a constant compiled into the page. */
  const limits = useMemo(
    () => ({ ...DEFAULT_CURRENCY_LIMITS, ...(appSettings?.currencyLimits || {}) }),
    [appSettings?.currencyLimits])
  const usdMax = limitsFor('USD', limits).max
  const lbpMin = limitsFor('LBP', limits).min

  /* The window to check, from App Settings. The page used to call
     loadFullOrderHistory() and wait for every order ever taken — thousands of
     rows with all their money lines embedded — to flag a handful of amounts.
     Now it fetches the chosen period itself: the setting decides the cost, and
     the page is honest about what it looked at. */
  const period = useMemo(
    () => periodRange(appSettings?.currencyCheckPeriod || DEFAULT_PERIOD),
    [appSettings?.currencyCheckPeriod])

  const [periodOrders, setPeriodOrders] = useState(null)   // null = still loading
  const [loadError,    setLoadError]    = useState('')

  useEffect(() => {
    let cancelled = false
    setPeriodOrders(null); setLoadError('')
    ;(async () => {
      const { orders: rows, error } = await fetchOrdersForPeriod(period, COMPANY_ID)
      if (cancelled) return
      setPeriodOrders(rows)
      setLoadError(error || '')
    })()
    return () => { cancelled = true }
  }, [period, COMPANY_ID])

  /* Orders record WHO raised them as a user id. The names live in
     user_accounts — a dozen rows — so they are fetched once and mapped here
     rather than joined onto every order. */
  const [userNames, setUserNames] = useState(() => new Map())
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('user_accounts').select('id, username')
      if (!cancelled) setUserNames(new Map((data ?? []).map(u => [u.id, u.username])))
    })()
    return () => { cancelled = true }
  }, [])

  /* What to show in "Order created by": where the order came from and who
     keyed it — "Call center\Suhair". The two together answer the question the
     column is really asked, which is "who do I go and speak to about this?"

     An order raised before the user was recorded has no name, so the source
     stands alone in muted italics, labelled as such on hover — nobody should
     read "Call center" as the name of a person. */
  const createdByOf = (r) => {
    /* The name stored on the order wins: it is what was true when the order
       was taken, and it still reads correctly if that account has since been
       renamed or deleted. The id is the fallback for orders raised before the
       name was recorded (fix137). */
    const name   = r.createdByName || (r.createdById ? userNames.get(r.createdById) : null)
    const source = r.source || null
    if (source && name) return { text: `${source}\\${name}`, exact: true }
    if (name)           return { text: name, exact: true }
    if (source)         return { text: source, exact: false }
    return { text: '—', exact: false }
  }

  const [search,   setSearch]   = useState('')
  // Empty = the whole period. The boxes narrow what was loaded; they cannot
  // reach outside it, which is why the period is stated on screen.
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [kind,     setKind]     = useState('')      // '' | 'error' | 'warning'

  const visibleOrders = useMemo(() => {
    const src = periodOrders ?? []
    return isSuperAdmin ? src : src.filter(o => !orderTouchesInactive(o, inactiveContactIds))
  }, [periodOrders, inactiveContactIds, isSuperAdmin])

  const all = useMemo(() => scanCurrencyIssues(visibleOrders, limits), [visibleOrders, limits])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(r => {
      if (kind && r.severity !== kind) return false
      if (dateFrom && r.date && r.date < dateFrom) return false
      if (dateTo   && r.date && r.date > dateTo)   return false
      if (!q) return true
      return [r.orderNumber, r.label, r.ref, r.by, createdByOf(r).text, customerName(r.customer)]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    })
  }, [all, search, kind, dateFrom, dateTo])

  /* What each column sorts BY — not always what it prints. Amount sorts by the
     figure (and by its ABSOLUTE size, since that is what makes a number look
     wrong), severity by how bad it is rather than alphabetically, so one click
     brings the errors to the top. */
  const sortValue = useCallback((r, key) => {
    switch (key) {
      case 'severity': return r.severity === 'error' ? 2 : 1
      case 'order':    return r.orderNumber || ''
      case 'date':     return r.date || ''
      case 'customer': return customerName(r.customer).toLowerCase()
      case 'raised':   return createdByOf(r).text.toLowerCase()
      case 'what':     return `${r.label} ${r.ref || ''}`.toLowerCase()
      case 'by':       return (r.by || '').toLowerCase()
      case 'amount':   return Math.abs(Number(r.amount) || 0)
      case 'suggests': return (r.suggests || '').toLowerCase()
      case 'why':      return (r.note || '').toLowerCase()
      default:         return ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userNames])
  const { sort, cycle, sortRows } = useTableSort(sortValue)
  const visible = useMemo(() => sortRows(rows), [rows, sortRows])

  const counts = useMemo(() => ({
    error:   all.filter(r => r.severity === 'error').length,
    warning: all.filter(r => r.severity === 'warning').length,
    orders:  new Set(all.map(r => r.orderId)).size,
  }), [all])

  function exportCsv() {
    const head = ['Order', 'Date', 'Customer', 'Order created by', 'What', 'Reference', 'Collected by', 'Amount', 'Currency', 'Looks like', 'Note']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = rows.map(r => [
      r.orderNumber, r.date, customerName(r.customer), createdByOf(r).text, r.label, r.ref, r.by || '',
      r.amount, r.currency, r.suggests, r.note,
    ].map(esc).join(','))
    const url = URL.createObjectURL(new Blob([[head.map(esc).join(','), ...body].join('\r\n')],
      { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `currency-check-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const busy = periodOrders === null

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">
      <DataLoadingOverlay
        open={busy}
        title="Checking currencies"
        subtitle={`Reading every amount on every order from ${period.from} to ${period.to}…`}
        steps={[
          { label: `Loading ${period.label.toLowerCase()}`, done: !busy,
            hint: `${(periodOrders?.length ?? 0).toLocaleString()} orders` },
          { label: 'Checking each amount', done: !busy },
        ]}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-amber-400" />
          <span className="text-[11px] text-slate-500">amounts that look like the wrong currency</span>
          {/* The window is a setting, so the page states it rather than leaving
              the reader to assume it covers everything. */}
          <span className="text-[11px] px-2 py-0.5 rounded border border-surface-border text-slate-400 whitespace-nowrap"
            title={`Set in Settings → App Settings → Currency check period (${period.from} → ${period.to})`}>
            {period.label} · {period.days} day{period.days === 1 ? '' : 's'}
            {periodOrders ? ` · ${periodOrders.length.toLocaleString()} orders` : ''}
          </span>
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search order, customer or line…"
            className="input pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <input type="date" className="input py-1.5 text-xs w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="text-slate-600 text-xs">to</span>
          <input type="date" className="input py-1.5 text-xs w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {(search || dateFrom || dateTo || kind) && (
          <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setKind('') }}
            className="h-[34px] px-3 rounded-lg text-xs font-medium border border-surface-border text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5">
            <FilterX className="w-3.5 h-3.5" /> Clear
          </button>
        )}
        <button onClick={exportCsv} disabled={rows.length === 0}
          className="h-[34px] px-3 rounded-lg text-xs font-medium border border-surface-border text-slate-200 hover:bg-surface-hover inline-flex items-center gap-1.5 disabled:opacity-40">
          <FileDown className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {loadError && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">
            {loadError} — the list below may be incomplete.
          </p>
        </div>
      )}

      {/* The two rules, stated — the page should explain itself. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => setKind(kind === 'error' ? '' : 'error')}
          className={`card p-3 text-left transition-colors ${
            kind === 'error' ? 'border-red-500/50 bg-red-500/5' : 'hover:bg-surface-hover/40'}`}>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-xs font-semibold text-slate-100">Very likely wrong</span>
            <span className="ml-auto text-sm font-bold tabular-nums text-red-300">{counts.error}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {usdMax
              ? <>USD over {usdMax.toLocaleString()} — an amount this large is almost always LBP.</>
              : <>No upper limit is set for USD in App Settings.</>}
          </p>
        </button>
        <button onClick={() => setKind(kind === 'warning' ? '' : 'warning')}
          className={`card p-3 text-left transition-colors ${
            kind === 'warning' ? 'border-amber-500/50 bg-amber-500/5' : 'hover:bg-surface-hover/40'}`}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-slate-100">Check the currency</span>
            <span className="ml-auto text-sm font-bold tabular-nums text-amber-300">{counts.warning}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {lbpMin
              ? <>LBP under {lbpMin.toLocaleString()} — an amount this small is usually USD.</>
              : <>No lower limit is set for LBP in App Settings.</>}
          </p>
        </button>
      </div>

      {/* The list */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-surface-border bg-surface-hover/30">
          <span className="text-xs text-slate-400">
            {rows.length} line{rows.length === 1 ? '' : 's'} to look at
            {counts.orders > 0 && <span className="text-slate-500"> · across {counts.orders} order{counts.orders === 1 ? '' : 's'}</span>}
          </span>
        </div>
        {/* The table scrolls inside the card so its header can stay put: this
            list runs to hundreds of lines across a whole history, and the
            column you are reading is otherwise long gone off the top. */}
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="sticky top-0 z-10 bg-surface-card">
              <tr className="border-b border-surface-border">
                {[
                  ['', 'severity'], ['Order #', 'order'], ['Date', 'date'],
                  ['Customer', 'customer'], ['Order created by', 'raised'],
                  ['What', 'what'], ['Collected by', 'by'], ['Amount', 'amount'],
                  ['Looks like', 'suggests'], ['Why', 'why'],
                ].map(([label, key]) => (
                  <SortTh key={key} label={label} sortKey={key} sort={sort} onSort={cycle}
                    className="text-[11px] uppercase tracking-wider text-slate-500 whitespace-nowrap py-2.5" />
                ))}
              </tr>
            </thead>
            <tbody>
              {busy ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500 text-xs">Checking…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center">
                  <ShieldCheck className="w-8 h-8 mx-auto text-green-400/70" />
                  <p className="mt-2 text-sm text-slate-300">Every amount looks plausible.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Nothing falls outside the limits set in App Settings.
                  </p>
                </td></tr>
              ) : visible.map((r, i) => (
                <tr key={`${r.orderId}-${r.kind}-${i}`} className="border-b border-surface-border/50 hover:bg-surface-hover/30">
                  <td className="px-3 py-2">
                    {r.severity === 'error'
                      ? <AlertCircle className="w-4 h-4 text-red-400" title={r.note} />
                      : <AlertTriangle className="w-4 h-4 text-amber-400" title={r.note} />}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <OrderNumber value={r.orderNumber} id={r.orderId} className="text-xs" />
                    {r.closed && <span className="ml-1.5 text-[10px] text-slate-600">closed</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">{r.date || '—'}</td>
                  <td className="px-3 py-2 text-slate-300 text-xs max-w-[12rem] truncate">{customerName(r.customer)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {(() => {
                      const who = createdByOf(r)
                      return (
                        <span className={who.exact ? 'text-slate-300' : 'text-slate-500 italic'}
                          title={who.exact
                            ? 'Where the order came from, and the user who raised it'
                            : 'No user was recorded on this order — showing only where it came from'}>
                          {who.text}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2 text-slate-300 text-xs">
                    {r.label}
                    {r.ref && <span className="block text-[11px] text-slate-500 truncate max-w-[14rem]">{r.ref}</span>}
                  </td>
                  {/* Only a payment has a collector; everything else is a figure
                      on the order rather than money someone handed over. */}
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {r.by
                      ? <span className="text-slate-300">{r.by}</span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  <td className={`px-3 py-2 tabular-nums text-xs font-semibold whitespace-nowrap ${
                    r.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                    {fmt(r.amount, r.currency)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <ArrowRightLeft className="w-3 h-3" /> {r.suggests}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-[11px]">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Nothing is changed here — this only points at amounts worth a second look. Open an order number to see
        it in full, then correct it on the order itself. The limits are set in
        <span className="text-slate-300"> Settings → App Settings → Currency limits</span>.
      </p>
    </div>
  )
}
