import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Package, AlertCircle, FileDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../../lib/supabase'
import { fetchOrdersByIds } from '../../lib/packageOrders'
import { isCancelledOrder } from '../../lib/orderStatus'
import { formatAccountNumber } from '../../lib/accountNumber'
import { useApp } from '../../context/AppContext'

/* Read-only list of every delivery package this partner has provided, joined to
   the order it shipped on. Shows price, order number and the delivery reception
   (recipient) name, with per-currency totals at the foot.

   "Delivered" = the package rides on a closed order (same rule the Partner Dues
   page uses). A toggle reveals still-open orders too. */

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}

/* Multi-currency amounts print as "120.00 USD + 2,000,000 LBP". */
function fmtCurMap(map) {
  const parts = CURRENCIES.filter(c => round2(map?.[c] || 0) !== 0).map(c => fmtMoney(map[c], c))
  return parts.join(' + ')
}

export default function ContactPartnerPackages({ contactId, contactName = 'Partner', accountNumber = '' }) {
  const { COMPANY_ID } = useApp()
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [onlyDelivered, setOnlyDelivered] = useState(true)

  const fetchPackages = useCallback(async () => {
    if (!contactId) { setRows([]); setLoading(false); return }
    setLoading(true); setError('')
    // Two-step load + client-side join: PostgREST can't embed
    // delivery_packages → orders, so orders are resolved separately by id.
    let q = supabase
      .from('delivery_packages')
      .select('id, order_id, tracking_number, package_price, currency, paid, quantity, description')
      .eq('provider_id', contactId)
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error: err } = await q
    if (err) { setError(err.message); setRows([]); setLoading(false); return }

    let orderMap
    try {
      orderMap = await fetchOrdersByIds([...new Set((data ?? []).map(p => p.order_id).filter(Boolean))])
    } catch (e) { setError(e.message); setRows([]); setLoading(false); return }

    // Nothing on a cancelled order was ever supplied, so it is not this
    // partner's work and not part of their totals.
    const joined = (data ?? [])
      .map(p => ({ ...p, order: orderMap.get(p.order_id) || null }))
      .filter(p => !isCancelledOrder(p.order))
    // Sort newest first by the order's close/scheduled date.
    joined.sort((a, b) => {
      const da = a.order?.closed_at || a.order?.scheduled_date || ''
      const db = b.order?.closed_at || b.order?.scheduled_date || ''
      return String(db).localeCompare(String(da))
    })
    setRows(joined); setLoading(false)
  }, [contactId, COMPANY_ID])

  useEffect(() => { fetchPackages() }, [fetchPackages])

  const visible = useMemo(
    () => rows.filter(r => !onlyDelivered || r.order?.isclosed),
    [rows, onlyDelivered],
  )

  // Per-currency totals across the visible rows: delivered value, the part paid
  // directly to the partner, and the remaining balance we still owe (delivered −
  // paid). Kept per currency since packages can carry different currencies.
  const totals = useMemo(() => {
    const t = {}
    for (const r of visible) {
      const cur = r.currency || r.order?.currency || 'USD'
      const amt = round2(r.package_price)
      const b = t[cur] || (t[cur] = { delivered: 0, paid: 0, balance: 0 })
      b.delivered = round2(b.delivered + amt)
      if (r.paid) b.paid = round2(b.paid + amt)
    }
    for (const cur of Object.keys(t)) t[cur].balance = round2(t[cur].delivered - t[cur].paid)
    return t
  }, [visible])
  const totalCurs = CURRENCIES.filter(c => totals[c])

  /* ── daily summary of the same packages ─────────────────────
     One line per delivery date: how many package lines and units went out that
     day, what they came to, how much was paid directly to the partner, and the
     day's balance, with a running balance carrying forward. Built from exactly
     the rows on screen, so it follows the Delivered-only / All-orders toggle. */
  const dailySummary = useMemo(() => {
    const byDate = new Map()
    const seenOrders = new Map()          // date → Set(order ids), so an order's
                                          // fee/collections are counted once even
                                          // when it carries several packages
    for (const r of visible) {
      const d = (r.order?.closed_at || r.order?.scheduled_date || r.order?.created_at || '').slice(0, 10) || '—'
      let e = byDate.get(d)
      if (!e) {
        e = { date: d, orders: 0, packages: 0, qty: 0, delivered: {}, fees: {}, collected: {}, paidPartner: {} }
        byDate.set(d, e); seenOrders.set(d, new Set())
      }
      const cur = r.currency || r.order?.currency || 'USD'
      const amt = round2(r.package_price)
      e.packages += 1
      e.qty      += Number(r.quantity) || 1
      e.delivered[cur] = round2((e.delivered[cur] || 0) + amt)
      // "Paid to partner" = packages already settled with the partner.
      if (r.paid) e.paidPartner[cur] = round2((e.paidPartner[cur] || 0) + amt)

      // Order-level figures: delivery fee charged and cash collected from the
      // customer — added once per order, not once per package.
      const oid = r.order?.id
      if (oid && !seenOrders.get(d).has(oid)) {
        seenOrders.get(d).add(oid)
        e.orders += 1
        const ocur = r.order?.currency || 'USD'
        const fee  = round2(r.order?.delivery_fee)
        if (fee) e.fees[ocur] = round2((e.fees[ocur] || 0) + fee)
        for (const pc of (r.order?.payment_collections ?? [])) {
          const pcur = CURRENCIES.includes(pc.currency) ? pc.currency : 'USD'
          const pamt = round2(pc.amount)
          if (pamt) e.collected[pcur] = round2((e.collected[pcur] || 0) + pamt)
        }
      }
    }
    const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    const running = {}
    for (const e of rows) {
      // Balance dues = total packages − paid to partner.
      e.balance = {}
      for (const c of CURRENCIES) {
        const net = round2((e.delivered[c] || 0) - (e.paidPartner[c] || 0))
        if (net !== 0) e.balance[c] = net
        running[c] = round2((running[c] || 0) + net)
      }
      e.runningBalance = { ...running }
    }
    return rows
  }, [visible])

  function exportSummaryPDF() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Partner Packages — Daily Summary', marginX, 16)
    doc.setFontSize(10); doc.setTextColor(40)
    doc.text(contactName, marginX, 23)
    doc.setFontSize(9); doc.setTextColor(110)
    if (accountNumber) doc.text(`Account: ${formatAccountNumber(accountNumber)}`, marginX, 28)
    doc.text(`Generated: ${now.toLocaleString()}   |   ${onlyDelivered ? 'Delivered packages only' : 'All orders (open included)'}`, marginX, 33)

    const totalPkgs = dailySummary.reduce((n, e) => n + e.packages, 0)
    const totalQty  = dailySummary.reduce((n, e) => n + e.qty, 0)

    // Column totals across the whole report.
    const sumOf = key => {
      const t = {}
      for (const e of dailySummary) for (const c of CURRENCIES) {
        const v = round2(e[key]?.[c] || 0)
        if (v) t[c] = round2((t[c] || 0) + v)
      }
      return t
    }

    autoTable(doc, {
      startY: 38,
      head: [['Delivery date', 'Pkgs', 'Qty', 'Total packages', 'Delivery fees',
              'Collected from customer', 'Paid to partner', 'Balance dues']],
      body: dailySummary.map(e => [
        e.date, String(e.packages), String(e.qty),
        fmtCurMap(e.delivered)    || '',
        fmtCurMap(e.fees)         || '',
        fmtCurMap(e.collected)    || '',
        fmtCurMap(e.paidPartner)  || '',
        fmtCurMap(e.balance)      || '',
      ]),
      foot: [[
        'Total', String(totalPkgs), String(totalQty),
        fmtCurMap(sumOf('delivered'))   || '',
        fmtCurMap(sumOf('fees'))        || '',
        fmtCurMap(sumOf('collected'))   || '',
        fmtCurMap(sumOf('paidPartner')) || '',
        fmtCurMap(sumOf('balance'))     || '',
      ]],
      styles: { fontSize: 7.5, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [147, 51, 234], textColor: 255, fontSize: 7 },
      footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: {
        1: { halign: 'center', cellWidth: 11 }, 2: { halign: 'center', cellWidth: 10 },
        3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
      },
    })

    let y = (doc.lastAutoTable?.finalY ?? 38) + 8
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text('Partner balance', marginX, y); y += 6
    doc.setFontSize(9)
    for (const c of totalCurs) {
      doc.text(
        `${c} — Total packages ${fmtMoney(totals[c].delivered, c)}   Paid to partner ${fmtMoney(totals[c].paid, c)}   Balance dues ${fmtMoney(totals[c].balance, c)}`,
        marginX, y)
      y += 5
    }
    doc.save(`partner-packages-daily-${(accountNumber || contactName).toString().replace(/\s+/g, '-')}-${now.toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Delivered Packages
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportSummaryPDF} disabled={visible.length === 0}
            title="Daily summary PDF — delivery date, total packages, delivery fees, collected from customer, paid to partner and balance dues"
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors inline-flex items-center gap-1.5
                       bg-brand-600/20 border-brand-500/40 text-brand-300 hover:bg-brand-600/30 hover:text-brand-200
                       disabled:opacity-40 disabled:cursor-not-allowed">
            <FileDown className="w-3.5 h-3.5" /> Daily Summary PDF
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

      <div className="border border-surface-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[24%]" />
            <col className="w-[31%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/40">
              <th className="px-3 py-2 font-medium">Order #</th>
              <th className="px-3 py-2 font-medium">Reception</th>
              <th className="px-3 py-2 font-medium">Package</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Price</th>
              <th className="px-3 py-2 font-medium text-center">Paid</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                {onlyDelivered ? 'No delivered packages yet.' : 'No packages from this partner yet.'}
              </td></tr>
            ) : visible.map(r => {
              const cur = r.currency || r.order?.currency || 'USD'
              return (
                <tr key={r.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30 align-top">
                  <td className="px-3 py-2 font-mono text-slate-300 whitespace-nowrap">
                    {r.order?.order_number ?? '—'}
                    {!r.order?.isclosed && <span className="ml-1.5 text-[9px] text-amber-400/80">open</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-300 break-words">{r.order?.recipient_name || '—'}</td>
                  <td className="px-3 py-2 text-slate-400 break-words">
                    <div className="text-slate-300">{r.tracking_number || '—'}</div>
                    {r.description && <div className="text-[10px] text-slate-500">{r.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{r.quantity ?? 1}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtMoney(r.package_price, cur)}</td>
                  <td className="px-3 py-2 text-center">
                    {r.paid
                      ? <span className="text-[10px] text-green-400">paid direct</span>
                      : <span className="text-[10px] text-slate-600">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {totalCurs.length > 0 && (
            <tfoot>
              {[
                { key: 'delivered', label: `Total${visible.length ? ` · ${visible.length} pkg${visible.length === 1 ? '' : 's'}` : ''}`, cls: 'text-slate-200', border: 'border-t border-surface-border' },
                { key: 'paid',      label: 'Total paid directly', cls: 'text-green-300',  border: 'border-t border-surface-border/40' },
                { key: 'balance',   label: 'Balance due',         cls: 'text-amber-300',  border: 'border-t border-surface-border/40' },
              ].map(row => (
                <tr key={row.key} className={`${row.border} bg-surface-hover/30`}>
                  <td colSpan={4} className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    {row.label}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {totalCurs.map(c => (
                      <div key={c} className={`tabular-nums font-semibold whitespace-nowrap ${row.cls}`}>{fmtMoney(totals[c][row.key], c)}</div>
                    ))}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
