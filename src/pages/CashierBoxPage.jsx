import React, { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { Wallet, ArrowDownCircle, ArrowUpCircle, Scale, Download, Calendar, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { fmtAmount } from '../lib/orderAmounts'

const CURRENCIES = ['USD', 'LBP', 'EUR']

const tooltipStyle = {
  contentStyle: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8 },
  labelStyle:   { color: '#94a3b8' },
  itemStyle:    { color: '#f1f5f9' },
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const round2   = n => Math.round((Number(n) || 0) * 100) / 100
const norm     = c => (CURRENCIES.includes(c) ? c : 'USD')

// Provider / shop display name for an OUT line.
function partyName(p) {
  if (!p) return ''
  return (p.company_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim()
}

/* Daily Cashier Box — the cash that moved through the office for CLOSED orders.
   IN  = payments collected directly by an office user (collected_by_name set).
   OUT = third-party costs the office paid on the order: external retail invoices,
         delivery packages and order services.
   Only closed orders count, dated by when the order was closed (closed_at). */
export default function CashierBoxPage() {
  const { orders, loading } = useApp()
  const { currentUser } = useAuth()

  const [from, setFrom] = useState(todayStr())
  const [to,   setTo]   = useState(todayStr())

  // Build the statement lines (one row per money movement) from closed orders
  // whose close date falls inside the selected range.
  const lines = useMemo(() => {
    const out = []
    for (const o of orders) {
      if (!o.isclosed) continue
      const day = o.closed_at ? String(o.closed_at).slice(0, 10) : null
      if (!day) continue
      if (from && day < from) continue
      if (to   && day > to)   continue

      // IN — office-collected payments only.
      for (const p of (o.payment_collections ?? [])) {
        if (!p.collected_by_name) continue
        out.push({
          day, order: o.order_number, recipient: o.recipient_name,
          dir: 'in', desc: `Payment collected · ${p.collected_by_name}`,
          cur: norm(p.currency), amount: round2(p.amount),
        })
      }
      // OUT — external retail invoices.
      for (const r of (o.retail_goods_invoices ?? [])) {
        const amt = round2(r.invoice_value)
        if (!amt) continue
        out.push({
          day, order: o.order_number, recipient: o.recipient_name,
          dir: 'out', desc: `Retail purchase${r.shop_name ? ` · ${r.shop_name}` : ''}`,
          cur: norm(r.currency), amount: amt,
        })
      }
      // OUT — delivery packages (cost paid to the provider).
      for (const pk of (o.delivery_packages ?? [])) {
        const amt = round2(pk.package_price)
        if (!amt) continue
        const who = partyName(pk.provider)
        out.push({
          day, order: o.order_number, recipient: o.recipient_name,
          dir: 'out', desc: `Delivery package${who ? ` · ${who}` : ''}`,
          cur: norm(pk.currency), amount: amt,
        })
      }
      // OUT — order services (cost paid to the provider).
      for (const s of (o.order_services ?? [])) {
        const amt = round2(s.service_fees)
        if (!amt) continue
        const who = partyName(s.provider)
        out.push({
          day, order: o.order_number, recipient: o.recipient_name,
          dir: 'out', desc: `Service${who ? ` · ${who}` : ''}`,
          cur: norm(s.service_fees_currency), amount: amt,
        })
      }
    }
    // Newest first, then IN before OUT within the same day for readability.
    out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.dir === b.dir ? 0 : a.dir === 'in' ? -1 : 1))
    return out
  }, [orders, from, to])

  // Per-currency totals: collected (in), spent (out), net (in box).
  const totals = useMemo(() => {
    const t = {}
    for (const c of CURRENCIES) t[c] = { collected: 0, spent: 0, net: 0 }
    for (const l of lines) {
      if (l.dir === 'in') t[l.cur].collected += l.amount
      else                t[l.cur].spent     += l.amount
    }
    for (const c of CURRENCIES) {
      t[c].collected = round2(t[c].collected)
      t[c].spent     = round2(t[c].spent)
      t[c].net       = round2(t[c].collected - t[c].spent)
    }
    return t
  }, [lines])

  // Currencies that actually have any movement (for cards / chart / PDF).
  const activeCurs = CURRENCIES.filter(c => totals[c].collected || totals[c].spent)
  const chartData  = activeCurs.map(c => ({ currency: c, Collected: totals[c].collected, Spent: totals[c].spent }))

  const rangeLabel = from === to ? from : `${from || '…'} → ${to || '…'}`

  function setToday()      { const d = todayStr(); setFrom(d); setTo(d) }
  function setThisMonth()  {
    const now = new Date()
    setFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
    setTo(todayStr())
  }

  /* ── PDF statement ───────────────────────────────────────── */
  function exportPDF() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(15); doc.setTextColor(20)
    doc.text('Daily Cashier Box — Statement', marginX, 16)

    doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`Period: ${rangeLabel}`, marginX, 23)
    doc.text(`Generated: ${now.toLocaleString()}${currentUser ? `  by ${currentUser.first_name ?? ''} ${currentUser.last_name ?? ''}`.trimEnd() : ''}`, marginX, 28)
    doc.text('Closed orders only.  IN = office-collected payments.  OUT = retail invoices + packages + services.', marginX, 33)

    autoTable(doc, {
      startY: 38,
      head: [['Date', 'Order #', 'Description', 'Cur', 'In', 'Out']],
      body: lines.map(l => [
        l.day, l.order ?? '—', l.desc, l.cur,
        l.dir === 'in'  ? fmtAmount(l.amount, l.cur) : '',
        l.dir === 'out' ? fmtAmount(l.amount, l.cur) : '',
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.3 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 4: { halign: 'right', textColor: [22, 130, 70] }, 5: { halign: 'right', textColor: [180, 40, 40] } },
    })

    let y = (doc.lastAutoTable?.finalY ?? 38) + 9
    doc.setFontSize(11); doc.setTextColor(20)
    doc.text('Box Summary', marginX, y); y += 2

    autoTable(doc, {
      startY: y + 2,
      head: [['Currency', 'Collected (In)', 'Spent (Out)', 'Net in Box']],
      body: activeCurs.map(c => [
        c, fmtAmount(totals[c].collected, c), fmtAmount(totals[c].spent, c), fmtAmount(totals[c].net, c),
      ]),
      styles: { fontSize: 9, cellPadding: 1.6 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: marginX },
      tableWidth: 130,
    })

    doc.save(`cashier-box-${from}${from === to ? '' : `_${to}`}.pdf`)
  }

  const busy   = loading?.orders
  const hasData = lines.length > 0

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* ── Header / controls ─────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Daily Cashier Box</h1>
            <p className="text-xs text-slate-500">Money in &amp; out for closed orders</p>
          </div>
        </div>

        <div className="ml-auto flex items-end gap-2 flex-wrap">
          <div>
            <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> From</label>
            <input type="date" className="input py-1.5 text-xs" value={from} max={to || undefined}
              onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> To</label>
            <input type="date" className="input py-1.5 text-xs" value={to} min={from || undefined}
              onChange={e => setTo(e.target.value)} />
          </div>
          <button className="btn-ghost px-2.5 py-1.5 text-xs border border-surface-border rounded-lg" onClick={setToday}>Today</button>
          <button className="btn-ghost px-2.5 py-1.5 text-xs border border-surface-border rounded-lg" onClick={setThisMonth}>This month</button>
          <button className="btn-primary" onClick={exportPDF} disabled={!hasData}>
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading orders…
        </div>
      )}

      {/* ── Summary cards (per currency) ──────────────────────── */}
      {activeCurs.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          No closed-order money movements for <span className="text-slate-300">{rangeLabel}</span>.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${activeCurs.length}, minmax(0, 1fr))` }}>
            {activeCurs.map(c => (
              <div key={c} className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-purple-400 font-semibold">{c}</span>
                  <Scale className="w-4 h-4 text-slate-500" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-green-400"><ArrowDownCircle className="w-4 h-4" /> Collected</span>
                    <span className="font-semibold text-green-300 tabular-nums">{fmtAmount(totals[c].collected, c)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-red-400"><ArrowUpCircle className="w-4 h-4" /> Spent</span>
                    <span className="font-semibold text-red-300 tabular-nums">{fmtAmount(totals[c].spent, c)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm border-t border-surface-border pt-2">
                    <span className="text-slate-300 font-medium">Net in box</span>
                    <span className={`font-bold tabular-nums ${totals[c].net >= 0 ? 'text-[#1dffd5]' : 'text-amber-300'}`}>
                      {fmtAmount(totals[c].net, c)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Chart: collected vs spent ───────────────────────── */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Collected vs Spent</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="currency" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip {...tooltipStyle} formatter={(v, n) => [fmtAmount(v, ''), n]} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                <Legend />
                <Bar dataKey="Collected" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Spent" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Statement table ─────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Statement — {rangeLabel}</h2>
              <span className="text-xs text-slate-500">{lines.length} movement{lines.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-surface-border">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Order #</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 font-medium">Cur</th>
                    <th className="px-4 py-2 font-medium text-right">In</th>
                    <th className="px-4 py-2 font-medium text-right">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-surface-border/50 hover:bg-surface-hover/40">
                      <td className="px-4 py-2 text-slate-400 font-mono text-xs">{l.day}</td>
                      <td className="px-4 py-2 text-brand-400 font-mono text-xs">{l.order ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-300">{l.desc}</td>
                      <td className="px-4 py-2 text-purple-300 text-xs">{l.cur}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-green-300">
                        {l.dir === 'in' ? fmtAmount(l.amount, l.cur) : ''}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-300">
                        {l.dir === 'out' ? fmtAmount(l.amount, l.cur) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {activeCurs.map(c => (
                    <tr key={c} className="border-t border-surface-border bg-surface-hover/30 font-medium">
                      <td className="px-4 py-2 text-slate-500 text-xs" colSpan={3}>
                        Net in box — {c}: <span className={totals[c].net >= 0 ? 'text-[#1dffd5]' : 'text-amber-300'}>{fmtAmount(totals[c].net, c)}</span>
                      </td>
                      <td className="px-4 py-2 text-purple-300 text-xs">{c}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-green-300">{fmtAmount(totals[c].collected, c)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-300">{fmtAmount(totals[c].spent, c)}</td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
