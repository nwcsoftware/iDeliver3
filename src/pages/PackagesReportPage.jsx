import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { OrderNumber } from '../components/orders/OrderQuickView'
import { Package, Search, FilterX, AlertCircle, Calendar, X } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import ContactCombobox from '../components/orders/ContactCombobox'
import { fetchOrdersByIds } from '../lib/packageOrders'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useTableSort, SortTh } from '../components/ui/SortableTable'

/* Packages report — every delivery package across all orders, with its reference,
   reception (recipient) name, order number, delivery date, delivery address and
   price. Searchable and filterable by partner (provider), recipient and a date
   range on the delivery date, with a per-currency grand total at the foot.

   Delivery date = the order's close date, falling back to its scheduled date. */

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}

function providerName(c) {
  if (!c) return '—'
  return (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'
}

/* The date a package "delivered" on. */
function deliveryDay(pk) {
  const raw = pk.order?.closed_at || pk.order?.scheduled_date || ''
  return raw ? String(raw).slice(0, 10) : ''
}

export default function PackagesReportPage() {
  const { COMPANY_ID, loadFullOrderHistory, inactiveContactIds } = useApp()
  const { hasRole } = useAuth()
  const canSeeRetired = hasRole('super_admin')
  // The startup fetch only covers the last few days; this page reads
  // further back, so it asks for the full history once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [search,      setSearch]      = useState('')
  const [partnerId,   setPartnerId]   = useState('')   // filter by provider
  const [recipient,   setRecipient]   = useState('')   // filter by reception name
  const [dateFrom,    setDateFrom]     = useState('')
  const [dateTo,      setDateTo]       = useState('')
  const [onlyDelivered, setOnlyDelivered] = useState(true)
  // What we have already handed to partners (partner_payouts, fix82) — the
  // third figure the balance needs. Packages alone only say what was owed.
  const [payouts, setPayouts] = useState([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      let q = supabase.from('partner_payouts').select('partner_id, amount, currency, paid_at')
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      const { data } = await q
      if (alive && data) setPayouts(data)
    })()
    return () => { alive = false }
  }, [COMPANY_ID])

  const fetchPackages = useCallback(async () => {
    setLoading(true); setError('')
    // Two-step load + client-side join: PostgREST can't always embed
    // delivery_packages → orders, so we fetch the orders separately by id.
    const { data: pkgs, error: err } = await fetchAllRows(() => {
      let q = supabase
        .from('delivery_packages')
        .select(`
          id, order_id, tracking_number, package_price, currency, quantity, paid, provider_id,
          provider:contacts!provider_id(id, code, company_name, first_name, last_name)
        `)
        .order('id', { ascending: false })
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    })
    if (err) { setError(err.message); setRows([]); setLoading(false); return }

    const orderMap = await fetchOrdersByIds([...new Set((pkgs ?? []).map(p => p.order_id).filter(Boolean))])
    setRows((pkgs ?? []).map(p => ({ ...p, order: orderMap.get(p.order_id) || null })))
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { fetchPackages() }, [fetchPackages])

  // Partner dropdown — distinct providers present in the data, sorted by name.
  const partners = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      // Keep the whole contact: the picker searches its name, code and mobile,
      // and shows the code beside each result.
      if (r.provider_id && !map.has(r.provider_id)) map.set(r.provider_id, r.provider || { id: r.provider_id })
    }
    return [...map.values()].sort((a, b) => providerName(a).localeCompare(providerName(b)))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const r = recipient.trim().toLowerCase()
    return rows.filter(pk => {
      // Packages of a retired partner follow the partner out of sight.
      if (!canSeeRetired && pk.provider_id && inactiveContactIds?.has(pk.provider_id)) return false
      if (onlyDelivered && !pk.order?.isclosed) return false
      if (partnerId && String(pk.provider_id) !== String(partnerId)) return false
      const day = deliveryDay(pk)
      if (dateFrom && (!day || day < dateFrom)) return false
      if (dateTo   && (!day || day > dateTo))   return false
      if (r && !String(pk.order?.recipient_name ?? '').toLowerCase().includes(r)) return false
      if (q) {
        const fields = [
          pk.tracking_number, pk.order?.order_number, pk.order?.recipient_name,
          pk.order?.delivery_address, providerName(pk.provider),
          pk.provider?.code,          // PTN-000004, shown under the partner name
        ].map(v => String(v ?? '').toLowerCase())
        // Matched as typed, and again with punctuation stripped from both
        // sides, so "PTN-000004", "ptn000004" and "000004" all find the row.
        const qDigits = q.replace(/\D/g, '')
        const hit = fields.some(t => t.includes(q))
          || (qDigits.length >= 3 && fields.some(t => {
            const d = t.replace(/\D/g, '')
            return d.length > 0 && d.includes(qDigits)
          }))
        if (!hit) return false
      }
      return true
    })
  }, [rows, search, partnerId, recipient, dateFrom, dateTo, onlyDelivered, inactiveContactIds, canSeeRetired])

  // Newest delivery first — the order the list returns to when a column sort
  // is cycled off.
  const byDate = useMemo(
    () => filtered.slice().sort((a, b) => deliveryDay(b).localeCompare(deliveryDay(a))),
    [filtered],
  )

  /* What each column sorts BY. Price sorts by the figure and by CURRENCY first,
     so USD groups with USD instead of ranking LBP 300,000 above USD 40 — two
     numbers that measure nothing in common. */
  const sortValue = useCallback((pk, key) => {
    switch (key) {
      case 'ref':       return (pk.tracking_number || '').toLowerCase()
      case 'reception': return (pk.order?.recipient_name || '').toLowerCase()
      case 'order':     return (pk.order?.order_number || '').toLowerCase()
      case 'partner':   return providerName(pk.provider).toLowerCase()
      case 'date':      return deliveryDay(pk) || ''
      case 'address':   return (pk.order?.delivery_address || '').toLowerCase()
      case 'price':     return `${pk.currency || 'USD'}|`
        + String(Math.round(Math.abs(Number(pk.package_price) || 0) * 100)).padStart(14, '0')
      default:          return ''
    }
  }, [])
  const { sort, cycle, sortRows } = useTableSort(sortValue)
  const sorted = useMemo(() => sortRows(byDate), [byDate, sortRows])

  // Per-currency grand totals across the filtered rows: full package value, the
  // part paid directly to the partner, and the remaining balance (value − paid).
  const totals = useMemo(() => {
    const t = {}
    for (const pk of filtered) {
      const cur = pk.currency || pk.order?.currency || 'USD'
      const amt = round2(pk.package_price)
      const b = t[cur] || (t[cur] = { total: 0, paid: 0, paidOut: 0, balance: 0 })
      b.total = round2(b.total + amt)
      if (pk.paid) b.paid = round2(b.paid + amt)
    }
    /* What has been paid out to the partners in view.

       Payouts are not attached to a package — they settle a partner's account
       as a whole — so they are matched by partner, and by the date range when
       one is set. Without a partner filter this sums the payouts of every
       partner appearing in the list, which is what makes the balance below add
       up to the same figure Partner Dues shows. */
    const partnerIds = new Set(filtered.map(pk => pk.provider_id).filter(Boolean))
    for (const po of payouts) {
      if (!partnerIds.has(po.partner_id)) continue
      const day = String(po.paid_at || '').slice(0, 10)
      if (dateFrom && day && day < dateFrom) continue
      if (dateTo   && day && day > dateTo)   continue
      const cur = po.currency || 'USD'
      const b = t[cur] || (t[cur] = { total: 0, paid: 0, paidOut: 0, balance: 0 })
      b.paidOut = round2((b.paidOut || 0) + round2(po.amount))
    }

    // Owed − settled directly with the partner − already paid out to them.
    for (const cur of Object.keys(t)) {
      t[cur].paidOut = round2(t[cur].paidOut || 0)
      t[cur].balance = round2(t[cur].total - t[cur].paid - t[cur].paidOut)
    }
    return t
  }, [filtered, payouts, dateFrom, dateTo])
  const totalCurs = CURRENCIES.filter(c => totals[c])

  const hasFilters = search || partnerId || recipient || dateFrom || dateTo
  function clearFilters() {
    setSearch(''); setPartnerId(''); setRecipient(''); setDateFrom(''); setDateTo('')
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-brand-600/20 border-brand-600/30">
          <Package className="w-4 h-4 text-brand-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-slate-100 leading-none">Packages</h1>
          <p className="text-xs text-slate-500 mt-0.5">{sorted.length} package{sorted.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{error}</span>
        </div>
      )}

      {/* ── filters ────────────────────────────────────────── */}
      <div className="card p-3 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Search</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input className="input py-1.5 text-xs pl-8" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Reference, order #, reception, address, partner or code…" />
          </div>
        </div>
        <div className="min-w-[220px]">
          <label className="label">Partner</label>
          {/* Type to find a partner by name, code or mobile — the same picker
              the order form uses, so it behaves the way people already know. */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <ContactCombobox
                value={partnerId}
                options={partners}
                compact
                placeholder="All partners — type a name or code…"
                onSelect={c => setPartnerId(c?.id || '')}
              />
            </div>
            {partnerId && (
              <button type="button" onClick={() => setPartnerId('')} title="Show every partner"
                className="h-[30px] w-[30px] flex-shrink-0 rounded-lg border border-surface-border text-slate-500 hover:text-slate-200 inline-flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="min-w-[150px]">
          <label className="label">Reception</label>
          <input className="input py-1.5 text-xs" value={recipient} onChange={e => setRecipient(e.target.value)}
            placeholder="Recipient name" />
        </div>
        <div>
          <label className="label">Delivered from</label>
          <input type="date" className="input py-1.5 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Delivered to</label>
          <input type="date" className="input py-1.5 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <button type="button" onClick={() => setOnlyDelivered(o => !o)} aria-pressed={onlyDelivered}
          className={`h-[34px] px-3 rounded-lg text-xs font-medium border transition-colors ${
            onlyDelivered ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                          : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
          {onlyDelivered ? 'Delivered only' : 'All orders'}
        </button>
        {hasFilters && (
          <button type="button" onClick={clearFilters}
            className="h-[34px] px-3 rounded-lg text-xs font-medium border border-surface-border text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5">
            <FilterX className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── totals ─────────────────────────────────────────── */}
      {totalCurs.length > 0 && (
        <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { key: 'total',   label: 'Total packages price', cls: 'text-brand-300' },
            { key: 'paid',    label: 'Total paid directly',  cls: 'text-green-400' },
            { key: 'paidOut', label: 'Paid to partner',      cls: 'text-teal-300' },
            { key: 'balance', label: 'Balance due',          cls: 'text-amber-400' },
          ].map(row => (
            <div key={row.key} className="rounded-lg border border-surface-border p-3 space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{row.label}</div>
              {totalCurs.map(c => (
                <div key={c} className={`tabular-nums text-base font-semibold ${row.cls}`}>{fmtMoney(totals[c][row.key], c)}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── table ──────────────────────────────────────────── */}
      {/* The table scrolls inside the card so its header can stay put — this
          list runs to hundreds of packages across a date range. */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface-card">
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <SortTh label="Reference"        sortKey="ref"       sort={sort} onSort={cycle} />
              <SortTh label="Reception"        sortKey="reception" sort={sort} onSort={cycle} />
              <SortTh label="Order #"          sortKey="order"     sort={sort} onSort={cycle} />
              <SortTh label="Partner"          sortKey="partner"   sort={sort} onSort={cycle} />
              <SortTh label="Delivery date"    sortKey="date"      sort={sort} onSort={cycle} />
              <SortTh label="Delivery address" sortKey="address"   sort={sort} onSort={cycle} />
              <SortTh label="Price"            sortKey="price"     sort={sort} onSort={cycle} align="right" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-600">No packages match these filters.</td></tr>
            ) : sorted.map(pk => {
              const cur = pk.currency || pk.order?.currency || 'USD'
              const day = deliveryDay(pk)
              return (
                <tr key={pk.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30 align-top">
                  <td className="px-3 py-2 font-mono text-slate-300 whitespace-nowrap">
                    {pk.tracking_number || '—'}
                    {!pk.order?.isclosed && <span className="ml-1.5 text-[9px] text-amber-400/80">open</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{pk.order?.recipient_name || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <OrderNumber value={pk.order?.order_number} id={pk.order_id} className="text-xs" />
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    <div>{providerName(pk.provider)}</div>
                    {/* The contact code (PTN-000004) — the reference partners
                        quote on statements and over the phone. */}
                    {pk.provider?.code && (
                      <div className="text-slate-500 text-[11px] font-mono tracking-wider">{pk.provider.code}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                    {day ? <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3 text-slate-600" />{day}</span> : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-400 max-w-[240px]">{pk.order?.delivery_address || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtMoney(pk.package_price, cur)}</td>
                </tr>
              )
            })}
          </tbody>
          {totalCurs.length > 0 && (
            <tfoot>
              {[
                { key: 'total',   label: 'Total',       cls: 'text-brand-300',  border: 'border-t border-surface-border' },
                { key: 'paid',    label: 'Paid directly', cls: 'text-green-400', border: 'border-t border-surface-border/40' },
                { key: 'balance', label: 'Balance due', cls: 'text-amber-400',  border: 'border-t border-surface-border/40' },
              ].map(row => (
                <tr key={row.key} className={`${row.border} bg-surface-hover/30`}>
                  <td colSpan={6} className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{row.label}</td>
                  <td className="px-3 py-2 text-right">
                    {totalCurs.map(c => (
                      <div key={c} className={`tabular-nums font-semibold whitespace-nowrap ${row.cls}`}>{fmtMoney(totals[c][row.key], c)}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
        </div>
      </div>
    </div>
  )
}
