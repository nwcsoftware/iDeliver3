import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Banknote, Search, FilterX, AlertCircle, Calendar, X, Shield, AlertTriangle } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { orderTotalsByCurrency, orderCollectedByCurrency } from '../lib/orderAmounts'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/* Daily Collection — every recorded payment (payment_collections) with the order
   it belongs to. Shows the delivery date, order number, amount, driver, source,
   who collected it and the collection group (Driver / Call center). Free-text
   search matches any column, including the amount. Super-admin only. Clicking an
   order number opens a popup with the full order data. */

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Full order shape for the order-details popup.
const DETAIL_SELECT = `
  *,
  customer:contacts!customer_id(first_name, last_name, company_name, mobile, account_number),
  driver:contacts!driver_id(first_name, last_name, mobile),
  zone:delivery_zones(name),
  order_items(quantity, unit_price, line_total, currency, is_deleted, product:products(name, code)),
  delivery_packages(tracking_number, package_price, currency, paid, provider:contacts!provider_id(company_name, first_name, last_name)),
  order_services(service_fees, service_fees_currency, provider:contacts!provider_id(company_name, first_name, last_name)),
  retail_goods_invoices(shop_name, invoice_reference, invoice_value, currency, exclude_calculation),
  payment_collections(amount, currency, collected_at, collected_by_name, collection_group)
`

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}
function fmtCurMap(map) {
  const parts = CURRENCIES.filter(c => round2(map[c]) !== 0).map(c => fmtMoney(map[c], c))
  return parts.length ? parts.join(' · ') : '—'
}
function personName(c) {
  if (!c) return '—'
  return (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '—'
}
function driverName(d) {
  if (!d) return '—'
  return `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || '—'
}

/* Fetch the orders behind a set of collections, keyed by id — PostgREST can't
   reliably embed payment_collections → delivery_orders, so we resolve them here
   in parallel chunks. */
async function fetchOrders(ids) {
  const map = new Map()
  const clean = [...new Set(ids.filter(Boolean))]
  const CHUNK = 200
  const slices = []
  for (let i = 0; i < clean.length; i += CHUNK) slices.push(clean.slice(i, i + CHUNK))
  // Amount fields are included so we can compare the order total (packages &
  // external retail only when their paid flag is false — orderTotalsByCurrency
  // handles that) against everything collected on the order.
  const results = await Promise.all(slices.map(slice =>
    supabase.from('delivery_orders')
      .select(`
        id, order_number, order_source, closed_at, scheduled_date,
        currency, delivery_fee, discount_amount, discount_currency, vat_amount, is_free_order,
        driver:contacts!driver_id(first_name, last_name),
        order_items(line_total, currency, is_deleted),
        delivery_packages(package_price, paid, currency),
        order_services(service_fees, service_fees_currency),
        retail_goods_invoices(invoice_value, exclude_calculation, currency),
        payment_collections(amount, currency)
      `)
      .in('id', slice)))
  for (const { data } of results) for (const o of data ?? []) map.set(o.id, o)
  return map
}

/* An order needs attention when what was collected doesn't match the order total
   (in any currency). Total counts packages / external retail only when paid=false. */
function orderMismatch(o) {
  if (!o) return false
  const total     = orderTotalsByCurrency(o)
  const collected = orderCollectedByCurrency(o)
  const curs = new Set([...Object.keys(total), ...Object.keys(collected)])
  for (const c of curs) if (round2(total[c] || 0) !== round2(collected[c] || 0)) return true
  return false
}

export default function DailyCollectionPage() {
  const { COMPANY_ID, loadFullOrderHistory } = useApp()
  // The startup fetch only covers the last few days; this page reads
  // further back, so it asks for the full history once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])
  const { hasRole } = useAuth()
  const isSuperAdmin = hasRole('super_admin')

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [search,   setSearch]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  // Order-details popup.
  const [detailOpen,    setDetailOpen]    = useState(false)
  const [detail,        setDetail]        = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr,     setDetailErr]     = useState('')

  const fetchCollections = useCallback(async () => {
    if (!isSuperAdmin) { setLoading(false); return }
    setLoading(true); setError('')
    const { data: pcs, error: err } = await fetchAllRows(() =>
      supabase.from('payment_collections')
        .select('id, order_id, amount, currency, collected_at, collected_by_name, collection_group, collection_type')
        .order('collected_at', { ascending: false }))
    if (err) { setError(err.message); setRows([]); setLoading(false); return }

    let orderMap
    try { orderMap = await fetchOrders((pcs ?? []).map(p => p.order_id)) }
    catch (e) { setError(e.message); setRows([]); setLoading(false); return }

    const joined = (pcs ?? []).map(p => {
      const o = orderMap.get(p.order_id) || null
      const deliveryDate = (o?.closed_at || o?.scheduled_date || p.collected_at || '').slice(0, 10)
      const mismatch = orderMismatch(o)
      return {
        id: p.id,
        orderId:      p.order_id,
        deliveryDate,
        orderNumber:  o?.order_number ?? '—',
        amount:       round2(p.amount),
        currency:     p.currency || 'USD',
        driver:       driverName(o?.driver),
        source:       o?.order_source ?? '—',
        collectedBy:  p.collected_by_name || '—',
        group:        p.collection_group || '—',
        mismatch,
        orderTotal:     o ? fmtCurMap(orderTotalsByCurrency(o))   : '—',
        orderCollected: o ? fmtCurMap(orderCollectedByCurrency(o)): '—',
      }
    })
    setRows(joined); setLoading(false)
  }, [isSuperAdmin])

  useEffect(() => { fetchCollections() }, [fetchCollections])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (dateFrom && (!r.deliveryDate || r.deliveryDate < dateFrom)) return false
      if (dateTo   && (!r.deliveryDate || r.deliveryDate > dateTo))   return false
      if (!q) return true
      const hay = [
        r.deliveryDate, r.orderNumber, r.amount, fmtMoney(r.amount, r.currency),
        r.driver, r.source, r.collectedBy, r.group,
      ].map(v => String(v ?? '').toLowerCase()).join(' ')
      return hay.includes(q)
    })
  }, [rows, search, dateFrom, dateTo])

  // Per-currency total of the filtered collections.
  const totals = useMemo(() => {
    const t = {}
    for (const r of filtered) t[r.currency] = round2((t[r.currency] || 0) + r.amount)
    return t
  }, [filtered])
  const totalCurs = CURRENCIES.filter(c => totals[c])

  const hasFilters = search || dateFrom || dateTo
  function clearFilters() { setSearch(''); setDateFrom(''); setDateTo('') }

  /* ── order details popup ─────────────────────────────────── */
  async function openDetail(orderId) {
    if (!orderId) return
    setDetail(null); setDetailErr(''); setDetailLoading(true); setDetailOpen(true)
    const { data, error: err } = await supabase.from('delivery_orders').select(DETAIL_SELECT).eq('id', orderId).single()
    setDetailLoading(false)
    if (err) { setDetailErr(err.message); return }
    setDetail(data)
  }
  function closeDetail() { setDetailOpen(false); setDetail(null); setDetailErr('') }

  /* ── access gate ─────────────────────────────────────────── */
  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Super administrators only</p>
        <p className="text-slate-500 text-sm">You don’t have permission to view the daily collection.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-green-600/20 border-green-600/30">
          <Banknote className="w-4 h-4 text-green-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-slate-100 leading-none">Daily Collection</h1>
          <p className="text-xs text-slate-500 mt-0.5">{filtered.length} collection{filtered.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{error}</span>
        </div>
      )}

      {/* ── filters ────────────────────────────────────────── */}
      <div className="card p-3 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Search</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input className="input py-1.5 text-xs pl-8" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Amount, order #, driver, source, collector, group…" />
          </div>
        </div>
        <div>
          <label className="label">Date from</label>
          <input type="date" className="input py-1.5 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Date to</label>
          <input type="date" className="input py-1.5 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {hasFilters && (
          <button type="button" onClick={clearFilters}
            className="h-[34px] px-3 rounded-lg text-xs font-medium border border-surface-border text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5">
            <FilterX className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── totals ─────────────────────────────────────────── */}
      {totalCurs.length > 0 && (
        <div className="card p-4 flex items-center gap-6 flex-wrap">
          <span className="text-sm font-semibold text-slate-200">Total collected</span>
          {totalCurs.map(c => (
            <span key={c} className="tabular-nums text-base font-semibold text-green-300">{fmtMoney(totals[c], c)}</span>
          ))}
          <span className="text-xs text-slate-500 ml-auto">{filtered.length} collection{filtered.length === 1 ? '' : 's'}</span>
        </div>
      )}

      {/* ── table ──────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/40">
              <th className="px-3 py-2 font-medium">Delivery date</th>
              <th className="px-3 py-2 font-medium">Order #</th>
              <th className="px-3 py-2 font-medium text-right">Collected amount</th>
              <th className="px-3 py-2 font-medium">Driver</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Collected by</th>
              <th className="px-3 py-2 font-medium">Collection group</th>
              <th className="px-3 py-2 font-medium text-center">Warning</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-600">No collections match these filters.</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30">
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                  {r.deliveryDate ? <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3 text-slate-600" />{r.deliveryDate}</span> : '—'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.orderNumber === '—' ? <span className="text-slate-600">—</span> : (
                    <button type="button" onClick={() => openDetail(r.orderId)}
                      className="font-mono text-brand-400 hover:text-brand-300 hover:underline" title="View full order">
                      {r.orderNumber}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-green-300 whitespace-nowrap">{fmtMoney(r.amount, r.currency)}</td>
                <td className="px-3 py-2 text-slate-300">{r.driver}</td>
                <td className="px-3 py-2 text-slate-400">{r.source}</td>
                <td className="px-3 py-2 text-slate-300">{r.collectedBy}</td>
                <td className="px-3 py-2">
                  {r.group === '—' ? <span className="text-slate-600">—</span> : (
                    <span className={`text-[11px] font-medium border rounded px-2 py-0.5 whitespace-nowrap ${
                      /driver/i.test(r.group) ? 'bg-green-500/10 text-green-300 border-green-500/30'
                                              : 'bg-sky-500/10 text-sky-300 border-sky-500/30'}`}>
                      {r.group}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.mismatch ? (
                    <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse inline-block"
                      title={`Payment ≠ order total — Total ${r.orderTotal} · Collected ${r.orderCollected}`} />
                  ) : (
                    <span className="text-slate-700">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {totalCurs.length > 0 && (
            <tfoot>
              <tr className="border-t border-surface-border bg-surface-hover/30">
                <td colSpan={2} className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total</td>
                <td className="px-3 py-2 text-right">
                  {totalCurs.map(c => (
                    <div key={c} className="tabular-nums font-semibold text-green-300 whitespace-nowrap">{fmtMoney(totals[c], c)}</div>
                  ))}
                </td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── order details popup ─────────────────────────────── */}
      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={closeDetail}>
          <div className="card w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Banknote className="w-4 h-4 text-brand-400" />
                Order {detail?.order_number ?? ''}
              </h3>
              <button onClick={closeDetail} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {detailLoading ? (
                <p className="text-center text-slate-500 text-sm py-6">Loading order…</p>
              ) : detailErr ? (
                <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{detailErr}</span>
                </div>
              ) : detail ? (
                <OrderDetail order={detail} />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* Read-only summary of a full order for the popup. */
function OrderDetail({ order: o }) {
  const items    = (o.order_items ?? []).filter(i => !i.is_deleted)
  const packages = o.delivery_packages ?? []
  const services = o.order_services ?? []
  const invoices = o.retail_goods_invoices ?? []
  const payments = o.payment_collections ?? []
  const total     = orderTotalsByCurrency(o)
  const collected = orderCollectedByCurrency(o)

  const Field = ({ label, value }) => (
    <div className="flex justify-between gap-3 text-xs py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right">{value ?? '—'}</span>
    </div>
  )
  const Section = ({ title, children }) => (
    <div className="rounded-lg border border-surface-border p-3 space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{title}</p>
      {children}
    </div>
  )

  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <Section title="Order">
          <Field label="Number" value={o.order_number} />
          <Field label="Status" value={o.status} />
          <Field label="Delivery status" value={o.delivery_status} />
          <Field label="Source" value={o.order_source} />
          <Field label="Confirmed" value={o.order_confirmed ? 'Yes' : 'No'} />
          <Field label="Closed" value={o.isclosed ? 'Yes' : 'No'} />
          <Field label="Scheduled" value={o.scheduled_date ? String(o.scheduled_date).slice(0, 10) : '—'} />
          <Field label="Closed at" value={o.closed_at ? String(o.closed_at).slice(0, 10) : '—'} />
        </Section>
        <Section title="Parties">
          <Field label="Customer" value={personName(o.customer)} />
          {o.customer?.account_number && <Field label="Account" value={o.customer.account_number} />}
          <Field label="Recipient" value={o.recipient_name} />
          <Field label="Recipient mobile" value={o.recipient_mobile} />
          <Field label="Driver" value={driverName(o.driver)} />
          <Field label="Zone" value={o.zone?.name} />
          <Field label="Delivery address" value={o.delivery_address} />
        </Section>
      </div>

      <Section title="Amounts">
        <Field label="Order total" value={fmtCurMap(total)} />
        <Field label="Collected" value={fmtCurMap(collected)} />
        <Field label="Delivery fee" value={o.delivery_fee ? fmtMoney(o.delivery_fee, o.currency || 'USD') : '—'} />
      </Section>

      {packages.length > 0 && (
        <Section title={`Delivery packages (${packages.length})`}>
          {packages.map((p, i) => (
            <div key={i} className="flex justify-between gap-3 text-xs py-0.5">
              <span className="text-slate-400 truncate">{p.tracking_number || '—'} · {personName(p.provider)}{p.paid ? ' · paid' : ''}</span>
              <span className="text-slate-200 whitespace-nowrap">{fmtMoney(p.package_price, p.currency || 'USD')}</span>
            </div>
          ))}
        </Section>
      )}

      {invoices.length > 0 && (
        <Section title={`Retail invoices (${invoices.length})`}>
          {invoices.map((r, i) => (
            <div key={i} className="flex justify-between gap-3 text-xs py-0.5">
              <span className="text-slate-400 truncate">{r.shop_name || 'Invoice'}{r.invoice_reference ? ` · ${r.invoice_reference}` : ''}{r.exclude_calculation ? ' · excluded' : ''}</span>
              <span className="text-slate-200 whitespace-nowrap">{fmtMoney(r.invoice_value, r.currency || 'USD')}</span>
            </div>
          ))}
        </Section>
      )}

      {services.length > 0 && (
        <Section title={`Order services (${services.length})`}>
          {services.map((s, i) => (
            <div key={i} className="flex justify-between gap-3 text-xs py-0.5">
              <span className="text-slate-400 truncate">{personName(s.provider)}</span>
              <span className="text-slate-200 whitespace-nowrap">{fmtMoney(s.service_fees, s.service_fees_currency || 'USD')}</span>
            </div>
          ))}
        </Section>
      )}

      {items.length > 0 && (
        <Section title={`Items (${items.length})`}>
          {items.map((it, i) => (
            <div key={i} className="flex justify-between gap-3 text-xs py-0.5">
              <span className="text-slate-400 truncate">{it.product?.name || 'Item'} × {it.quantity}</span>
              <span className="text-slate-200 whitespace-nowrap">{fmtMoney(it.line_total, it.currency || 'USD')}</span>
            </div>
          ))}
        </Section>
      )}

      {payments.length > 0 && (
        <Section title={`Payments (${payments.length})`}>
          {payments.map((p, i) => (
            <div key={i} className="flex justify-between gap-3 text-xs py-0.5">
              <span className="text-slate-400 truncate">
                {(p.collected_at || '').slice(0, 10)} · {p.collected_by_name || '—'}{p.collection_group ? ` · ${p.collection_group}` : ''}
              </span>
              <span className="text-green-300 whitespace-nowrap">{fmtMoney(p.amount, p.currency || 'USD')}</span>
            </div>
          ))}
        </Section>
      )}
    </>
  )
}
