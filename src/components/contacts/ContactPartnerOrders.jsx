import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { ClipboardList, AlertCircle, FileDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../../lib/supabase'
import { formatAccountNumber } from '../../lib/accountNumber'
import { useApp } from '../../context/AppContext'

/* Orders linked to this partner — orders where they are the customer AND orders
   carrying their packages — summarised per delivery date:

     date · orders · packages · total packages · delivery fees · total order

   with an account summary underneath (total orders, total packages, delivery
   fees, paid to partner, balance). Read-only; the same "Delivered only" rule as
   the Packages tab (an order counts once it is closed). */

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}
/* Multi-currency amounts read as "120.00 USD + 2,000,000 LBP". */
function fmtCurMap(map) {
  const parts = CURRENCIES.filter(c => round2(map?.[c] || 0) !== 0).map(c => fmtMoney(map[c], c))
  return parts.join(' + ')
}
const addTo = (map, cur, amt) => { if (amt) map[cur] = round2((map[cur] || 0) + amt) }

export default function ContactPartnerOrders({ contactId, contactName = 'Partner', accountNumber = '' }) {
  const { COMPANY_ID } = useApp()
  const [rows,    setRows]    = useState([])      // packages joined to their order
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [onlyDelivered, setOnlyDelivered] = useState(true)

  /* An order counts as "linked to this partner" when EITHER
       • the partner is the order's customer (delivery-only orders — the shop
         asks us to deliver to their own client), OR
       • the order carries at least one package the partner provided.
     Both are loaded and merged by order id, so an order that is both isn't
     counted twice. */
  const fetchData = useCallback(async () => {
    if (!contactId) { setRows([]); setLoading(false); return }
    setLoading(true); setError('')

    const ORDER_COLS = 'id, order_number, currency, isclosed, closed_at, scheduled_date, created_at, delivery_fee, total_amount'
    const PKG_COLS   = 'delivery_packages(package_price, currency, paid, quantity, provider_id)'

    // 1. Orders where this contact is the customer.
    let qCustomer = supabase
      .from('delivery_orders')
      .select(`${ORDER_COLS}, ${PKG_COLS}`)
      .eq('customer_id', contactId)
    if (COMPANY_ID) qCustomer = qCustomer.eq('company_id', COMPANY_ID)

    // 2. Orders carrying one of this partner's packages (inner join filters both
    //    the orders and the embedded packages down to this provider).
    let qProvider = supabase
      .from('delivery_orders')
      .select(`${ORDER_COLS}, delivery_packages!inner(package_price, currency, paid, quantity, provider_id)`)
      .eq('delivery_packages.provider_id', contactId)
    if (COMPANY_ID) qProvider = qProvider.eq('company_id', COMPANY_ID)

    const [asCustomer, asProvider] = await Promise.all([qCustomer, qProvider])
    if (asCustomer.error || asProvider.error) {
      setError((asCustomer.error || asProvider.error).message); setRows([]); setLoading(false); return
    }

    const byId = new Map()
    for (const o of [...(asCustomer.data ?? []), ...(asProvider.data ?? [])]) {
      const prev = byId.get(o.id)
      // Keep whichever copy carries the package rows.
      if (!prev || (o.delivery_packages?.length ?? 0) > (prev.delivery_packages?.length ?? 0)) byId.set(o.id, o)
    }
    setRows([...byId.values()])
    setLoading(false)
  }, [contactId, COMPANY_ID])

  useEffect(() => { fetchData() }, [fetchData])

  const visible = useMemo(
    () => rows.filter(o => !onlyDelivered || o.isclosed),
    [rows, onlyDelivered],
  )

  /* One line per delivery date: the orders that day, how many of this partner's
     packages they carried, and the money on them. */
  const days = useMemo(() => {
    const byDate = new Map()
    for (const o of visible) {
      const d = (o.closed_at || o.scheduled_date || o.created_at || '').slice(0, 10) || '—'
      let e = byDate.get(d)
      if (!e) {
        e = { date: d, orders: 0, packages: 0, pkgTotal: {}, fees: {}, orderTotal: {}, paid: {} }
        byDate.set(d, e)
      }
      const ocur = CURRENCIES.includes(o.currency) ? o.currency : 'USD'
      e.orders += 1
      addTo(e.fees, ocur, round2(o.delivery_fee))
      addTo(e.orderTotal, ocur, round2(o.total_amount))

      // Only this partner's packages count towards the package figures.
      for (const pk of (o.delivery_packages ?? [])) {
        if (pk.provider_id !== contactId) continue
        const pcur = CURRENCIES.includes(pk.currency) ? pk.currency : ocur
        e.packages += 1
        addTo(e.pkgTotal, pcur, round2(pk.package_price))
        if (pk.paid) addTo(e.paid, pcur, round2(pk.package_price))
      }
    }
    return [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }, [visible, contactId])

  /* Account summary across the listed days. Balance = total packages − paid to
     partner, matching the Packages tab. */
  const summary = useMemo(() => {
    const s = { orders: 0, packages: 0, pkgTotal: {}, fees: {}, orderTotal: {}, paid: {}, balance: {} }
    for (const e of days) {
      s.orders   += e.orders
      s.packages += e.packages
      for (const key of ['pkgTotal', 'fees', 'orderTotal', 'paid']) {
        for (const c of CURRENCIES) addTo(s[key], c, e[key][c] || 0)
      }
    }
    for (const c of CURRENCIES) {
      const bal = round2((s.pkgTotal[c] || 0) - (s.paid[c] || 0))
      if (bal) s.balance[c] = bal
    }
    return s
  }, [days])

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Partner Orders — Daily Summary', marginX, 16)
    doc.setFontSize(10); doc.setTextColor(40)
    doc.text(contactName, marginX, 23)
    doc.setFontSize(9); doc.setTextColor(110)
    if (accountNumber) doc.text(`Account: ${formatAccountNumber(accountNumber)}`, marginX, 28)
    doc.text(`Generated: ${now.toLocaleString()}   |   ${onlyDelivered ? 'Delivered orders only' : 'All orders (open included)'}`, marginX, 33)

    autoTable(doc, {
      startY: 38,
      head: [['Date', 'Orders', 'Packages', 'Total packages', 'Delivery fees', 'Total order']],
      body: [...days].reverse().map(e => [
        e.date, String(e.orders), String(e.packages),
        fmtCurMap(e.pkgTotal)   || '',
        fmtCurMap(e.fees)       || '',
        fmtCurMap(e.orderTotal) || '',
      ]),
      foot: [[
        'Total', String(summary.orders), String(summary.packages),
        fmtCurMap(summary.pkgTotal)   || '',
        fmtCurMap(summary.fees)       || '',
        fmtCurMap(summary.orderTotal) || '',
      ]],
      styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak' },
      headStyles: { fillColor: [147, 51, 234], textColor: 255 },
      footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 16 }, 2: { halign: 'center', cellWidth: 18 },
        3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      },
    })

    let y = (doc.lastAutoTable?.finalY ?? 38) + 8
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text('Summary', marginX, y); y += 6
    doc.setFontSize(9); doc.setTextColor(40)
    for (const [label, val] of [
      ['Total orders',        String(summary.orders)],
      ['Total packages',      `${summary.packages} pkg — ${fmtCurMap(summary.pkgTotal) || '—'}`],
      ['Total delivery fees', fmtCurMap(summary.fees)    || '—'],
      ['Paid to partner',     fmtCurMap(summary.paid)    || '—'],
      ['Balance',             fmtCurMap(summary.balance) || '—'],
    ]) {
      doc.text(`${label}: ${val}`, marginX, y); y += 5
    }
    doc.save(`partner-orders-${(accountNumber || contactName).toString().replace(/\s+/g, '-')}-${now.toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5" /> Orders linked to this partner
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportPDF} disabled={days.length === 0}
            title="Daily summary PDF — orders, packages, totals and delivery fees per day"
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors inline-flex items-center gap-1.5
                       bg-brand-600/20 border-brand-500/40 text-brand-300 hover:bg-brand-600/30 hover:text-brand-200
                       disabled:opacity-40 disabled:cursor-not-allowed">
            <FileDown className="w-3.5 h-3.5" /> PDF
          </button>
          <button type="button" onClick={() => setOnlyDelivered(o => !o)} aria-pressed={onlyDelivered}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
              onlyDelivered ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                            : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
            {onlyDelivered ? 'Delivered only' : 'All orders'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{error}</span>
        </div>
      )}

      {/* Per-day table */}
      <div className="border border-surface-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/40">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium text-center">Orders</th>
              <th className="px-3 py-2 font-medium text-center">Packages</th>
              <th className="px-3 py-2 font-medium text-right">Total packages</th>
              <th className="px-3 py-2 font-medium text-right">Delivery fees</th>
              <th className="px-3 py-2 font-medium text-right">Total order</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : days.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                {onlyDelivered ? 'No delivered orders yet.' : 'No orders from this partner yet.'}
              </td></tr>
            ) : days.map(e => (
              <tr key={e.date} className="border-t border-surface-border/40 hover:bg-surface-hover/30">
                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{e.date}</td>
                <td className="px-3 py-2 text-center text-slate-300 tabular-nums">{e.orders}</td>
                <td className="px-3 py-2 text-center text-slate-400 tabular-nums">{e.packages}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtCurMap(e.pkgTotal) || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400 whitespace-nowrap">{fmtCurMap(e.fees) || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtCurMap(e.orderTotal) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      {days.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: 'Total orders',   value: String(summary.orders),            cls: 'text-slate-100' },
            { label: 'Total packages', value: `${summary.packages} · ${fmtCurMap(summary.pkgTotal) || '—'}`, cls: 'text-slate-100' },
            { label: 'Delivery fees',  value: fmtCurMap(summary.fees)    || '—', cls: 'text-slate-300' },
            { label: 'Paid to partner',value: fmtCurMap(summary.paid)    || '—', cls: 'text-green-300' },
            { label: 'Balance',        value: fmtCurMap(summary.balance) || '—', cls: 'text-amber-300' },
          ].map(card => (
            <div key={card.label} className="rounded-lg border border-surface-border bg-surface-hover/30 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{card.label}</p>
              <p className={`text-xs font-semibold mt-1 tabular-nums ${card.cls}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
