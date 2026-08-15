import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Package, Search, FilterX, AlertCircle, Calendar } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { fetchOrdersByIds } from '../lib/packageOrders'
import { useApp } from '../context/AppContext'

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
  const { COMPANY_ID, loadFullOrderHistory } = useApp()
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
      if (r.provider_id && !map.has(r.provider_id)) map.set(r.provider_id, providerName(r.provider))
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const r = recipient.trim().toLowerCase()
    return rows.filter(pk => {
      if (onlyDelivered && !pk.order?.isclosed) return false
      if (partnerId && String(pk.provider_id) !== String(partnerId)) return false
      const day = deliveryDay(pk)
      if (dateFrom && (!day || day < dateFrom)) return false
      if (dateTo   && (!day || day > dateTo))   return false
      if (r && !String(pk.order?.recipient_name ?? '').toLowerCase().includes(r)) return false
      if (q) {
        const hay = [
          pk.tracking_number, pk.order?.order_number, pk.order?.recipient_name,
          pk.order?.delivery_address, providerName(pk.provider),
        ].map(v => String(v ?? '').toLowerCase()).join(' ')
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, partnerId, recipient, dateFrom, dateTo, onlyDelivered])

  // Sort by delivery date, newest first.
  const sorted = useMemo(
    () => filtered.slice().sort((a, b) => deliveryDay(b).localeCompare(deliveryDay(a))),
    [filtered],
  )

  // Per-currency grand totals across the filtered rows: full package value, the
  // part paid directly to the partner, and the remaining balance (value − paid).
  const totals = useMemo(() => {
    const t = {}
    for (const pk of filtered) {
      const cur = pk.currency || pk.order?.currency || 'USD'
      const amt = round2(pk.package_price)
      const b = t[cur] || (t[cur] = { total: 0, paid: 0, balance: 0 })
      b.total = round2(b.total + amt)
      if (pk.paid) b.paid = round2(b.paid + amt)
    }
    for (const cur of Object.keys(t)) t[cur].balance = round2(t[cur].total - t[cur].paid)
    return t
  }, [filtered])
  const totalCurs = CURRENCIES.filter(c => totals[c])

  const hasFilters = search || partnerId || recipient || dateFrom || dateTo
  function clearFilters() {
    setSearch(''); setPartnerId(''); setRecipient(''); setDateFrom(''); setDateTo('')
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
              placeholder="Reference, order #, reception, address, partner…" />
          </div>
        </div>
        <div className="min-w-[160px]">
          <label className="label">Partner</label>
          <select className="input py-1.5 text-xs" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
            <option value="">All partners</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
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
        <div className="card p-4 grid gap-3 sm:grid-cols-3">
          {[
            { key: 'total',   label: 'Total packages price', cls: 'text-brand-300' },
            { key: 'paid',    label: 'Total paid directly',  cls: 'text-green-400' },
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
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/40">
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Reception</th>
              <th className="px-3 py-2 font-medium">Order #</th>
              <th className="px-3 py-2 font-medium">Partner</th>
              <th className="px-3 py-2 font-medium">Delivery date</th>
              <th className="px-3 py-2 font-medium">Delivery address</th>
              <th className="px-3 py-2 font-medium text-right">Price</th>
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
                  <td className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">{pk.order?.order_number ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{providerName(pk.provider)}</td>
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
  )
}
