import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, AlertCircle, Search, Calendar, FilterX, FileDown, ShieldCheck, ArrowRightLeft,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { OrderNumber } from '../components/orders/OrderQuickView'
import DataLoadingOverlay from '../components/ui/DataLoadingOverlay'
import {
  scanCurrencyIssues, limitsFor, DEFAULT_CURRENCY_LIMITS,
} from '../lib/currencyCheck'
import { orderTouchesInactive } from '../lib/contactVisibility'

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
  const { orders, loading, loadFullOrderHistory, ordersFullyLoaded, inactiveContactIds, appSettings } = useApp()
  const { hasRole } = useAuth()
  const isSuperAdmin = hasRole('super_admin')

  /* The bounds come from App Settings, so what counts as suspect is the
     company's own rule rather than a constant compiled into the page. */
  const limits = useMemo(
    () => ({ ...DEFAULT_CURRENCY_LIMITS, ...(appSettings?.currencyLimits || {}) }),
    [appSettings?.currencyLimits])
  const usdMax = limitsFor('USD', limits).max
  const lbpMin = limitsFor('LBP', limits).min

  // A currency slip from three months ago is still wrong today.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [search,   setSearch]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [kind,     setKind]     = useState('')      // '' | 'error' | 'warning'

  const visibleOrders = useMemo(
    () => (isSuperAdmin ? orders : orders.filter(o => !orderTouchesInactive(o, inactiveContactIds))),
    [orders, inactiveContactIds, isSuperAdmin])

  const all = useMemo(() => scanCurrencyIssues(visibleOrders, limits), [visibleOrders, limits])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(r => {
      if (kind && r.severity !== kind) return false
      if (dateFrom && r.date && r.date < dateFrom) return false
      if (dateTo   && r.date && r.date > dateTo)   return false
      if (!q) return true
      return [r.orderNumber, r.label, r.ref, customerName(r.customer)]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    })
  }, [all, search, kind, dateFrom, dateTo])

  const counts = useMemo(() => ({
    error:   all.filter(r => r.severity === 'error').length,
    warning: all.filter(r => r.severity === 'warning').length,
    orders:  new Set(all.map(r => r.orderId)).size,
  }), [all])

  function exportCsv() {
    const head = ['Order', 'Date', 'Customer', 'What', 'Reference', 'Amount', 'Currency', 'Looks like', 'Note']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = rows.map(r => [
      r.orderNumber, r.date, customerName(r.customer), r.label, r.ref,
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

  const busy = !ordersFullyLoaded || !!loading?.orders

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <DataLoadingOverlay
        open={busy}
        title="Checking currencies"
        subtitle="Reading every amount on every order…"
        steps={[
          { label: 'Loading order history', done: !busy, hint: `${orders.length.toLocaleString()} orders` },
          { label: 'Checking each amount', done: !busy },
        ]}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-amber-400" />
          <h2 className="text-base font-semibold text-slate-100">Currency Check</h2>
          <span className="text-[11px] text-slate-500">amounts that look like the wrong currency</span>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search order, customer or line…"
            value={search} onChange={e => setSearch(e.target.value)} />
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
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-border bg-surface-hover/30">
          <span className="text-xs text-slate-400">
            {rows.length} line{rows.length === 1 ? '' : 's'} to look at
            {counts.orders > 0 && <span className="text-slate-500"> · across {counts.orders} order{counts.orders === 1 ? '' : 's'}</span>}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-surface-border">
                {['', 'Order #', 'Date', 'Customer', 'What', 'Amount', 'Looks like', 'Why'].map((h, i) => (
                  <th key={i} className="text-left px-3 py-2.5 text-slate-500 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {busy ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500 text-xs">Checking…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center">
                  <ShieldCheck className="w-8 h-8 mx-auto text-green-400/70" />
                  <p className="mt-2 text-sm text-slate-300">Every amount looks plausible.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Nothing falls outside the limits set in App Settings.
                  </p>
                </td></tr>
              ) : rows.map((r, i) => (
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
                  <td className="px-3 py-2 text-slate-300 text-xs">
                    {r.label}
                    {r.ref && <span className="block text-[11px] text-slate-500 truncate max-w-[14rem]">{r.ref}</span>}
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
