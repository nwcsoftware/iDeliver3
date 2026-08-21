import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Receipt, X, Loader, AlertCircle, User, MapPin, Truck, Package, Calendar,
  Coins, HandCoins, Megaphone, Store, FileText, Copy, Check,
} from 'lucide-react'
import { fetchOrderForQuickView } from '../../lib/orderQuickView'
import { orderTotalsByCurrency, orderCollectedByCurrency } from '../../lib/orderAmounts'

/* Quick view: click an order number anywhere and read the order without
   leaving the page you are on.

   One provider at the top of the app owns the popup, so every page opens the
   same thing and nobody re-implements it. Pages just render <OrderNumber> (or
   call useOrderQuickView().open) instead of printing the number as text. */

const Ctx = createContext({ open: () => {} })
export const useOrderQuickView = () => useContext(Ctx)

const num = n => Number(n) || 0
const money = (v, c) => `${num(v).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`
const bag = (b) => {
  const parts = Object.entries(b || {}).filter(([, v]) => Math.round(num(v) * 100) !== 0).map(([c, v]) => money(v, c))
  return parts.length ? parts.join('  +  ') : '—'
}
const when = (ts, withTime = true) => (ts
  ? new Date(ts).toLocaleString(undefined, withTime
      ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
  : '—')
const nameOf = (c) => (c?.company_name?.trim()
  || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || '—')

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2.5">
      {Icon ? <Icon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" /> : <span className="w-3.5" />}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
        <div className="text-xs text-slate-200 mt-0.5 break-words">{children}</div>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, count, children }) {
  return (
    <div className="rounded-lg border border-surface-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-hover/40">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[11px] font-semibold text-slate-200 uppercase tracking-wider">{title}</span>
        {count != null && <span className="ml-auto text-[11px] text-slate-500">{count}</span>}
      </div>
      <div className="p-3 space-y-1.5">{children}</div>
    </div>
  )
}

export function OrderQuickViewProvider({ children }) {
  const [key,     setKey]     = useState(null)   // id or order number being shown
  const [order,   setOrder]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [copied,  setCopied]  = useState(false)

  const open  = useCallback((idOrNumber) => { if (idOrNumber) setKey(String(idOrNumber)) }, [])
  const close = useCallback(() => { setKey(null); setOrder(null); setError(''); setCopied(false) }, [])

  useEffect(() => {
    if (!key) return undefined
    let alive = true
    setLoading(true); setOrder(null); setError('')
    ;(async () => {
      const { order: o, error: e } = await fetchOrderForQuickView(key)
      if (!alive) return
      setOrder(o); setError(e || ''); setLoading(false)
    })()
    return () => { alive = false }
  }, [key])

  // Escape closes it, as every popup in the app does.
  useEffect(() => {
    if (!key) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, close])

  const items    = (order?.order_items ?? []).filter(i => !i.is_deleted)
  const packages = order?.delivery_packages ?? []
  const services = order?.order_services ?? []
  const invoices = order?.retail_goods_invoices ?? []
  const ads      = order?.ads ?? []
  const payments = order?.payment_collections ?? []
  const totals    = order ? orderTotalsByCurrency(order) : {}
  const collected = order ? orderCollectedByCurrency(order) : {}
  const balance = Object.fromEntries(
    [...new Set([...Object.keys(totals), ...Object.keys(collected)])]
      .map(c => [c, Math.round(((totals[c] || 0) - (collected[c] || 0)) * 100) / 100]))

  return (
    <Ctx.Provider value={{ open }}>
      {children}

      {/* Rendered into <body> so it is never clipped or painted over by the
          page it was opened from. */}
      {key && createPortal(
        <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-slate-950/70 backdrop-blur-sm p-4 sm:p-8"
          onClick={close}>
          <div className="card w-full max-w-2xl my-auto shadow-2xl" onClick={e => e.stopPropagation()}>

            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border">
              <Receipt className="w-4 h-4 text-brand-300 flex-shrink-0" />
              <span className="font-mono text-sm text-brand-300">{order?.order_number || key}</span>
              {order?.order_number && (
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(order.order_number)
                    setCopied(true); setTimeout(() => setCopied(false), 1500)
                  }}
                  title="Copy the order number"
                  className="btn-ghost p-1 text-slate-500 hover:text-slate-200">
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
              {order && (
                <span className="flex items-center gap-1.5 ml-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    order.isclosed ? 'bg-slate-500/10 text-slate-300 border-slate-500/30'
                                   : 'bg-brand-500/10 text-brand-300 border-brand-500/30'}`}>
                    {order.isclosed ? 'Closed' : (order.status || 'pending')}
                  </span>
                  {order.delivery_status && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-surface-hover text-slate-300 border-surface-border">
                      {order.delivery_status}
                    </span>
                  )}
                  {order.order_confirmed !== true && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30">
                      Unconfirmed
                    </span>
                  )}
                </span>
              )}
              <button onClick={close} className="btn-ghost p-1.5 ml-auto text-slate-500 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            {loading ? (
              <p className="px-4 py-12 text-center text-xs text-slate-500">
                <Loader className="w-4 h-4 animate-spin inline mr-2" /> Loading the order…
              </p>
            ) : error ? (
              <div className="m-4 flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-xs">{error}</p>
              </div>
            ) : order && (
              <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Row icon={User} label="Customer">
                    {nameOf(order.customer)}
                    {order.customer?.code && (
                      <span className="block text-[11px] font-mono text-slate-500">{order.customer.code}</span>
                    )}
                    {order.customer?.mobile && (
                      <span className="block text-[11px] text-slate-400">{order.customer.mobile}</span>
                    )}
                  </Row>
                  <Row icon={User} label="Recipient">
                    {order.recipient_name || '—'}
                    {order.recipient_mobile && (
                      <span className="block text-[11px] text-slate-400">{order.recipient_mobile}</span>
                    )}
                  </Row>
                  <Row icon={Calendar} label="Scheduled">
                    {order.scheduled_date || '—'}
                    {(order.scheduled_time_from || order.scheduled_time_to) && (
                      <span className="block text-[11px] text-slate-400">
                        {String(order.scheduled_time_from || '').slice(0, 5)} – {String(order.scheduled_time_to || '').slice(0, 5)}
                      </span>
                    )}
                  </Row>
                  <Row icon={Truck} label="Driver">
                    {order.driver ? nameOf(order.driver) : <span className="text-slate-500">Not assigned</span>}
                    {order.driver?.mobile && (
                      <span className="block text-[11px] text-slate-400">{order.driver.mobile}</span>
                    )}
                  </Row>
                  {(order.pickup_address || order.delivery_address) && (
                    <div className="sm:col-span-2">
                      <Row icon={MapPin} label="Route">
                        {order.pickup_address && <span className="block">From: {order.pickup_address}</span>}
                        {order.delivery_address && <span className="block">To: {order.delivery_address}</span>}
                      </Row>
                    </div>
                  )}
                </div>

                {/* What is on the order — only the parts that exist. */}
                {packages.length > 0 && (
                  <Section icon={Package} title="Packages" count={packages.length}>
                    {packages.map(p => (
                      <div key={p.id} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-[11px] text-slate-500">{p.tracking_number || '—'}</span>
                        <span className="text-slate-400 truncate">{nameOf(p.provider)}</span>
                        <span className="ml-auto tabular-nums text-slate-200">{money(p.package_price, p.currency)}</span>
                        {p.paid && <span className="text-[10px] text-green-300">paid direct</span>}
                      </div>
                    ))}
                  </Section>
                )}

                {items.length > 0 && (
                  <Section icon={Store} title="Items" count={items.length}>
                    {items.map(i => (
                      <div key={i.id} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-300 truncate">{i.parcel_description || '—'}</span>
                        {i.supplier_name && <span className="text-[10px] text-slate-500 truncate">· {i.supplier_name}</span>}
                        <span className="ml-auto tabular-nums text-slate-400">{num(i.quantity)} ×</span>
                        <span className="tabular-nums text-slate-200">{money(i.line_total, i.currency)}</span>
                      </div>
                    ))}
                  </Section>
                )}

                {invoices.length > 0 && (
                  <Section icon={FileText} title="Local market invoices" count={invoices.length}>
                    {invoices.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-300 truncate">{r.shop_name || '—'}</span>
                        {r.invoice_reference && <span className="text-[10px] text-slate-500">· {r.invoice_reference}</span>}
                        <span className="ml-auto tabular-nums text-slate-200">{money(r.invoice_value, r.currency)}</span>
                        {r.exclude_calculation && <span className="text-[10px] text-green-300">paid direct</span>}
                      </div>
                    ))}
                  </Section>
                )}

                {services.length > 0 && (
                  <Section icon={HandCoins} title="Services" count={services.length}>
                    {services.map(sv => (
                      <div key={sv.id} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-300 truncate">{nameOf(sv.provider)}</span>
                        <span className="ml-auto tabular-nums text-slate-200">{money(sv.service_fees, sv.service_fees_currency)}</span>
                      </div>
                    ))}
                  </Section>
                )}

                {ads.length > 0 && (
                  <Section icon={Megaphone} title="Ads" count={ads.length}>
                    {ads.map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-300">{a.platform || 'Ad'}</span>
                        <span className="text-[10px] text-slate-500">{when(a.start_at, false)} → {when(a.end_at, false)}</span>
                        <span className="ml-auto tabular-nums text-slate-200">{money(a.price, a.currency)}</span>
                      </div>
                    ))}
                  </Section>
                )}

                {payments.length > 0 && (
                  <Section icon={Coins} title="Payments" count={payments.length}>
                    {payments.map(pc => (
                      <div key={pc.id} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-400">{when(pc.collected_at, false)}</span>
                        <span className="text-slate-500 truncate">{pc.collected_by_name || pc.collection_group || '—'}</span>
                        <span className="ml-auto tabular-nums text-green-300">{money(pc.amount, pc.currency)}</span>
                      </div>
                    ))}
                  </Section>
                )}

                {/* The money, last — it is the summary of everything above. */}
                <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Delivery fee</span>
                    <span className="ml-auto tabular-nums text-slate-200">{money(order.delivery_fee, order.currency)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Order total</span>
                    <span className="ml-auto tabular-nums font-semibold text-slate-100">{bag(totals)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Collected</span>
                    <span className="ml-auto tabular-nums text-green-300">{bag(collected)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs border-t border-surface-border/60 pt-1.5">
                    <span className="text-slate-300 font-medium">Balance</span>
                    <span className="ml-auto tabular-nums font-semibold text-amber-300">{bag(balance)}</span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  Raised {when(order.created_at)}
                  {order.order_source ? ` · ${order.order_source}` : ''}
                  {order.isclosed && order.closed_at ? ` · closed ${when(order.closed_at)}` : ''}
                  {order.closed_by_name ? ` by ${order.closed_by_name}` : ''}
                </p>
              </div>
            )}
          </div>
        </div>,
        document.body)}
    </Ctx.Provider>
  )
}

/**
 * An order number that opens the quick view. Drop-in replacement for printing
 * the number as text:  <OrderNumber value={o.order_number} />
 */
export function OrderNumber({ value, id, className = '', children }) {
  const { open } = useOrderQuickView()
  const key = id || value
  if (!key) return <span className="text-slate-600">—</span>
  return (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); open(key) }}
      title="Open a quick view of this order"
      className={`font-mono text-brand-300 hover:text-brand-200 hover:underline ${className}`}>
      {children || value}
    </button>
  )
}
