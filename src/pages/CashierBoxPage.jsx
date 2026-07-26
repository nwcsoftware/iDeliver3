import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { Wallet, ArrowDownCircle, ArrowUpCircle, Scale, Download, Calendar, RefreshCw, UserCheck, Handshake, Store, ChevronDown, ChevronRight, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { fmtAmount } from '../lib/orderAmounts'
import { buildPartnerDues, partnerName as partnerDisplayName } from '../lib/partnerDues'

const CURRENCIES = ['USD', 'LBP', 'EUR']

// Day after a 'YYYY-MM-DD' date. Used to turn the reset checkpoint (which hides
// movements ON or before it) into an inclusive "from".
function nextDay(d) {
  const t = new Date(`${d}T12:00:00`)
  t.setDate(t.getDate() + 1)
  return t.toISOString().slice(0, 10)
}
function prevDay(d) {
  const t = new Date(`${d}T12:00:00`)
  t.setDate(t.getDate() - 1)
  return t.toISOString().slice(0, 10)
}

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

// Which party type an order belongs to, from its customer contact — used to split
// the day's cash into Customers / Partners / Suppliers.
function partyCategory(o) {
  const types = Array.isArray(o?.customer?.contact_types) ? o.customer.contact_types : []
  if (types.includes('partner'))  return 'partner'
  if (types.includes('supplier')) return 'supplier'
  return 'customer'
}
// Display order + styling for the party-type breakdown cards.
const PARTY_CATS = [
  { key: 'customer', label: 'Customers', Icon: UserCheck, cls: 'text-brand-400' },
  { key: 'partner',  label: 'Partners',  Icon: Handshake, cls: 'text-purple-400' },
  { key: 'supplier', label: 'Suppliers', Icon: Store,     cls: 'text-amber-400' },
]

/* Daily Cashier Box — the cash that moved through the office for CLOSED orders.
   IN  = payments collected directly by an office user (collected_by_name set).
   OUT = third-party costs the office paid on the order: external retail invoices,
         delivery packages and order services.
   Only closed orders count, dated by when the order was closed (closed_at). */
export default function CashierBoxPage() {
  const { orders, loading, COMPANY_ID, loadFullOrderHistory } = useApp()
  const { currentUser } = useAuth()

  // Balances span the whole history, so pull every order (beyond the recent window).
  useEffect(() => { loadFullOrderHistory() }, [loadFullOrderHistory])

  const [from, setFrom] = useState(todayStr())
  const [to,   setTo]   = useState(todayStr())
  // Active "reset as of" checkpoint (latest reset_through) — movements dated on or
  // before it are hidden from the box (set via the Reset Cashier Box tool).
  const [resetThrough, setResetThrough] = useState(null)
  // Payouts to partners (fix82). These — not the packages themselves — are the
  // cash the box actually spends on a partner.
  const [payouts, setPayouts] = useState([])
  // Which detailed-breakdown categories are expanded (all collapsed by default).
  const [openCats, setOpenCats] = useState(() => new Set())
  const toggleCat = (key) => setOpenCats(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  // Load the active reset checkpoint. Remounting the page (navigating back after a
  // reset) refetches it, so a fresh reset is reflected immediately.
  useEffect(() => {
    let alive = true
    ;(async () => {
      let q = supabase.from('cashier_box_resets').select('reset_through').order('reset_through', { ascending: false }).limit(1)
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      const { data } = await q
      if (alive) setResetThrough(data?.[0]?.reset_through ? String(data[0].reset_through).slice(0, 10) : null)
    })()
    return () => { alive = false }
  }, [COMPANY_ID])

  // Partner payouts, with the partner's name for the OUT line's description.
  useEffect(() => {
    let alive = true
    ;(async () => {
      let q = supabase.from('partner_payouts')
        .select('*, partner:contacts!partner_id(id, code, company_name, first_name, last_name)')
        .order('paid_at', { ascending: false })
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      const { data } = await q
      if (alive) setPayouts(data ?? [])
    })()
    return () => { alive = false }
  }, [COMPANY_ID])

  /* Every money movement, WITHOUT the from/to window — the window is applied
     below. Movements hidden by an active reset checkpoint are dropped for good.

     A partner's delivery package is deliberately NOT a movement here. The office
     doesn't pay the partner when the order closes; it collects the customer's
     money and holds it until the partner is actually paid (a partner_payouts row
     from the Partner Dues page). Booking the package as "spent" on the close date
     double-counted it: the cash was still in the box. So a package only ever
     shows up as a DUE, and the payout is the cash OUT. A package flagged
     "Paid directly to <partner>" never touches the box at all — the customer
     settled with the partner, so that money was never ours. */
  const allLines = useMemo(() => {
    const out = []
    for (const o of orders) {
      if (!o.isclosed) continue
      const day = o.closed_at ? String(o.closed_at).slice(0, 10) : null
      if (!day) continue
      // Hidden by an active reset checkpoint (movements on/before reset_through).
      if (resetThrough && day <= resetThrough) continue

      const cat      = partyCategory(o)   // Customers / Partners / Suppliers
      const partyNm  = partyName(o.customer) || o.main_account || '—'
      const partyId  = o.customer?.id || o.customer_id || partyNm

      // IN — payments with a collector name. A named payment by anyone other than
      // the order's own driver is a call-center / office collection; that portion
      // is tracked separately on each line (office) for the breakdown.
      for (const p of (o.payment_collections ?? [])) {
        if (!p.collected_by_name) continue
        const amt = round2(p.amount)
        const byOfficeUser = !(o.driver_id && p.collected_by === o.driver_id)
        out.push({
          day, order: o.order_number, recipient: o.recipient_name, cat, partyId, party: partyNm,
          dir: 'in', desc: `Payment collected · ${p.collected_by_name}`,
          cur: norm(p.currency), amount: amt, office: byOfficeUser ? amt : 0,
        })
      }
      // OUT — external retail invoices.
      for (const r of (o.retail_goods_invoices ?? [])) {
        const amt = round2(r.invoice_value)
        if (!amt) continue
        out.push({
          day, order: o.order_number, recipient: o.recipient_name, cat, partyId, party: partyNm,
          dir: 'out', desc: `Retail purchase${r.shop_name ? ` · ${r.shop_name}` : ''}`,
          cur: norm(r.currency), amount: amt,
        })
      }
      // OUT — order services (cost paid to the provider).
      for (const s of (o.order_services ?? [])) {
        const amt = round2(s.service_fees)
        if (!amt) continue
        const who = partyName(s.provider)
        out.push({
          day, order: o.order_number, recipient: o.recipient_name, cat, partyId, party: partyNm,
          dir: 'out', desc: `Service${who ? ` · ${who}` : ''}`,
          cur: norm(s.service_fees_currency), amount: amt,
        })
      }
    }

    // IN — commission collected from a shop on "we bought" invoices (Retail Goods
    // Invoices → Collect Commission). Booked as partner income, dated by when it
    // was collected (commission_collected_at), independent of the order's close.
    for (const o of orders) {
      for (const r of (o.retail_goods_invoices ?? [])) {
        if (!r.commission_collected) continue
        const amt = round2(r.commission_amount)
        if (!amt) continue
        const day = r.commission_collected_at ? String(r.commission_collected_at).slice(0, 10) : null
        if (!day) continue
        if (resetThrough && day <= resetThrough) continue
        out.push({
          day, order: o.order_number, recipient: o.recipient_name,
          cat: 'partner', partyId: r.contact_id || r.shop_name || 'commission', party: r.shop_name || '—',
          dir: 'in', desc: `Commission collected${r.shop_name ? ` · ${r.shop_name}` : ''}`,
          cur: norm(r.currency), amount: amt,
        })
      }
    }

    // OUT — money actually handed to a partner (Partner Dues → Pay). Dated by the
    // payout, not by any order, since a payout can settle many orders at once.
    for (const p of payouts) {
      const day = p.paid_at ? String(p.paid_at).slice(0, 10) : null
      if (!day) continue
      if (resetThrough && day <= resetThrough) continue
      const amt = round2(p.amount)
      if (!amt) continue
      const who = partnerDisplayName(p.partner)
      out.push({
        day, order: null, recipient: null, cat: 'partner',
        partyId: p.partner_id, party: who,
        dir: 'out', desc: `Paid to ${who}${p.method ? ` · ${String(p.method).replace('_', ' ')}` : ''}`,
        cur: norm(p.currency), amount: amt,
      })
    }

    // Newest first, then IN before OUT within the same day for readability.
    out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.dir === b.dir ? 0 : a.dir === 'in' ? -1 : 1))
    return out
  }, [orders, resetThrough, payouts])

  // The selected window.
  const lines = useMemo(
    () => allLines.filter(l => (!from || l.day >= from) && (!to || l.day <= to)),
    [allLines, from, to],
  )

  /* The reset checkpoint hides movements on/before it, so partner history starts
     the day after it (or at the beginning of time when there's no checkpoint).
     The window itself starts at whichever of `from` / that boundary is later. */
  const resetStart = resetThrough ? nextDay(resetThrough) : ''
  const effFrom    = resetStart && (!from || resetStart > from) ? resetStart : from

  /* Partner money brought forward = dues raised BEFORE this window that still
     haven't been paid out. We collected the customer's cash on an earlier day and
     never handed it to the partner, so it is still in the box when today opens.

     This is deliberately NOT "every movement ever, summed". The app records only
     some of the office's outflows (invoices, services, partner payouts) — it has no
     concept of deposits, wages or drawings — so a cumulative all-time net would
     claim the box holds far more cash than it really does. What legitimately rolls
     over is the partner liability, which is fully recorded on both sides. */
  const carriedIn = useMemo(() => {
    const t = Object.fromEntries(CURRENCIES.map(c => [c, 0]))
    if (!from) return t
    // Everything from the start of partner history up to the day before the window.
    const prior = buildPartnerDues({ orders, payouts, from: resetStart, to: prevDay(from) })
    for (const p of prior) for (const c of p.curs) {
      t[c] += p.cur[c].delivered - p.cur[c].paidDirect - p.cur[c].paidOut
    }
    for (const c of CURRENCIES) t[c] = round2(t[c])
    return t
  }, [orders, payouts, resetStart, from])

  /* Partner package accounting for the window, keyed by the package's PROVIDER
     (not the order's customer): the dues belong to whoever supplied the package.
     Shares buildPartnerDues with the Partner Dues page so the two always agree. */
  const partnerDues = useMemo(
    () => buildPartnerDues({ orders, payouts, from: effFrom, to }),
    [orders, payouts, effFrom, to],
  )
  const partnerDuesTotals = useMemo(() => {
    const t = Object.fromEntries(CURRENCIES.map(c => [c, { delivered: 0, collectedDrivers: 0, collectedOffice: 0, paidOut: 0, balance: 0 }]))
    for (const p of partnerDues) for (const c of p.curs) {
      t[c].delivered        += p.cur[c].delivered - p.cur[c].paidDirect   // paid-direct never enters the box
      t[c].collectedDrivers += p.cur[c].collectedDrivers
      t[c].collectedOffice  += p.cur[c].collectedOffice
      t[c].paidOut          += p.cur[c].paidOut
    }
    for (const c of CURRENCIES) {
      t[c].delivered = round2(t[c].delivered); t[c].paidOut = round2(t[c].paidOut)
      t[c].collectedDrivers = round2(t[c].collectedDrivers); t[c].collectedOffice = round2(t[c].collectedOffice)
      t[c].balance   = round2(t[c].delivered - t[c].paidOut)
    }
    return t
  }, [partnerDues])

  // Per-currency totals: collected (in), spent (out), net (movement this period).
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
      /* Partner money the box is sitting on. Brought forward from earlier days,
         plus what this period raised, less what this period paid out. This is the
         figure that must still be there at the next close. */
      t[c].partnerIn  = carriedIn[c]
      t[c].partnerOut = round2(carriedIn[c] + partnerDuesTotals[c].balance)
    }
    return t
  }, [lines, carriedIn, partnerDuesTotals])

  // Per-party-type totals (Customers / Partners / Suppliers) × currency.
  const byParty = useMemo(() => {
    const m = {}
    for (const cat of PARTY_CATS) {
      m[cat.key] = {}
      for (const c of CURRENCIES) m[cat.key][c] = { collected: 0, office: 0, spent: 0, net: 0 }
    }
    for (const l of lines) {
      const cat = m[l.cat] ? l.cat : 'customer'
      if (l.dir === 'in') { m[cat][l.cur].collected += l.amount; m[cat][l.cur].office += (l.office || 0) }
      else                m[cat][l.cur].spent     += l.amount
    }
    for (const cat of PARTY_CATS) for (const c of CURRENCIES) {
      const g = m[cat.key][c]
      g.collected = round2(g.collected); g.office = round2(g.office); g.spent = round2(g.spent); g.net = round2(g.collected - g.spent)
    }
    return m
  }, [lines])

  // Per-individual-party breakdown within each category — one entry per specific
  // customer / partner / supplier, with their own per-currency totals.
  const partyBreakdown = useMemo(() => {
    const cats = { customer: {}, partner: {}, supplier: {} }
    for (const l of lines) {
      const catKey = cats[l.cat] ? l.cat : 'customer'
      const bucket = cats[catKey]
      const key    = l.partyId || l.party || 'unknown'
      const entry  = (bucket[key] ||= { name: l.party || '—', cur: {} })
      const g      = (entry.cur[l.cur] ||= { collected: 0, office: 0, spent: 0 })
      if (l.dir === 'in') { g.collected += l.amount; g.office += (l.office || 0) }
      else                g.spent     += l.amount
    }
    const result = {}
    for (const catKey of Object.keys(cats)) {
      result[catKey] = Object.entries(cats[catKey]).map(([id, e]) => {
        const curs = CURRENCIES.filter(c => e.cur[c] && (e.cur[c].collected || e.cur[c].spent))
        const cur = {}
        for (const c of curs) cur[c] = {
          collected: round2(e.cur[c].collected), office: round2(e.cur[c].office), spent: round2(e.cur[c].spent),
          net: round2(e.cur[c].collected - e.cur[c].spent),
        }
        return { id, name: e.name, curs, cur }
      }).filter(p => p.curs.length).sort((a, b) => a.name.localeCompare(b.name))
    }
    return result
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
    doc.text('Closed orders only.  IN = office-collected payments.  OUT = retail invoices + services + payouts to partners.', marginX, 33)
    doc.text('Partner packages are a due, not a spend, until the partner is paid; unpaid dues stay in the box and carry forward.', marginX, 36.5)

    autoTable(doc, {
      startY: 41,
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
      head: [['Currency', 'Collected (In)', 'Spent (Out)', 'Net in Box', 'Partner Money Held']],
      body: activeCurs.map(c => [
        c, fmtAmount(totals[c].collected, c), fmtAmount(totals[c].spent, c),
        fmtAmount(totals[c].net, c), fmtAmount(totals[c].partnerOut, c),
      ]),
      styles: { fontSize: 9, cellPadding: 1.6 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: marginX },
      tableWidth: 130,
    })

    doc.save(`cashier-box-${from}${from === to ? '' : `_${to}`}.pdf`)
  }

  const busy   = loading?.orders
  const hasData = lines.length > 0
  // Partner packages are no longer cash movements, so a period can carry dues
  // without a single line. Don't call that "nothing to show".
  const hasPartnerDues = partnerDues.length > 0

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

      {resetThrough && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs text-amber-300">
          <EyeOff className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            Cashier Box reset is active — movements on or before{' '}
            <span className="font-semibold">{resetThrough}</span> are hidden. Nothing was deleted; remove the reset in
            Settings → Reset Cashier Box to bring them back.
          </span>
        </div>
      )}

      {/* ── Summary cards (per currency) ──────────────────────── */}
      {activeCurs.length === 0 && !hasPartnerDues ? (
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
                    <span className="flex items-center gap-1.5 text-red-400" title="Cash actually paid out: retail invoices, services, and payouts to partners">
                      <ArrowUpCircle className="w-4 h-4" /> Spent
                    </span>
                    <span className="font-semibold text-red-300 tabular-nums">{fmtAmount(totals[c].spent, c)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm border-t border-surface-border pt-2">
                    <span className="text-slate-300 font-medium">Net in box</span>
                    <span className={`font-bold tabular-nums ${totals[c].net >= 0 ? 'text-[#1dffd5]' : 'text-amber-300'}`}>
                      {fmtAmount(totals[c].net, c)}
                    </span>
                  </div>

                  {/* Partner money the box is holding — brought forward, and what
                      still has to be there at the next close. */}
                  {(totals[c].partnerIn || totals[c].partnerOut) ? (
                    <div className="space-y-1 border-t border-surface-border pt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500" title="Partner dues raised on earlier days that are still unpaid — this money opened the box today">
                          Partner money brought forward
                        </span>
                        <span className="tabular-nums text-slate-400">{fmtAmount(totals[c].partnerIn, c)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-amber-400/80" title="Brought forward + dues raised this period − paid out. Still in the box at the next close.">
                          Partner money still held
                        </span>
                        <span className="tabular-nums font-semibold text-amber-300">{fmtAmount(totals[c].partnerOut, c)}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* ── Cash by party type — totals (above the chart) ────── */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Cash by party type — {rangeLabel}</h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${PARTY_CATS.length}, minmax(0, 1fr))` }}>
              {PARTY_CATS.map(cat => {
                const Icon = cat.Icon
                const curs = activeCurs.filter(c => byParty[cat.key][c].collected || byParty[cat.key][c].spent)
                return (
                  <div key={cat.key} className="rounded-lg border border-surface-border p-3 space-y-2.5">
                    <div className="flex items-center gap-2 border-b border-surface-border/60 pb-2">
                      <Icon className={`w-4 h-4 ${cat.cls}`} />
                      <span className="text-sm font-medium text-slate-200">{cat.label}</span>
                    </div>
                    {curs.length === 0 ? (
                      <p className="text-xs text-slate-600 py-1">No cash movement</p>
                    ) : curs.map(c => (
                      <div key={c} className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">{c}</div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-green-400">Collected</span>
                          <span className="tabular-nums text-green-300">{fmtAmount(byParty[cat.key][c].collected, c)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-red-400">Spent</span>
                          <span className="tabular-nums text-red-300">{fmtAmount(byParty[cat.key][c].spent, c)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs border-t border-surface-border/50 pt-1">
                          <span className="text-slate-300 font-medium">Net</span>
                          <span className={`tabular-nums font-semibold ${byParty[cat.key][c].net >= 0 ? 'text-[#1dffd5]' : 'text-amber-300'}`}>
                            {fmtAmount(byParty[cat.key][c].net, c)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Detailed breakdown by party (collapsible) ────────── */}
          <div className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">
              Detailed breakdown by party — {rangeLabel}
              <span className="text-slate-500 text-xs font-normal ml-2">
                (customers &amp; suppliers: collected / by call center / spent / net · partners: dues / collected by drivers / by call center / paid / balance · click a row to expand)
              </span>
            </h2>
            {PARTY_CATS.map(cat => {
              const Icon = cat.Icon
              const single = cat.label.replace(/s$/, '')
              const open = openCats.has(cat.key)

              /* Partners are a balance, not a cash flow: what we owe them for their
                 packages, what we've paid them, and what's left. Rendered from
                 partnerDues (keyed by package provider) rather than byParty. */
              if (cat.key === 'partner') {
                const pcurs = CURRENCIES.filter(c =>
                  partnerDuesTotals[c].delivered || partnerDuesTotals[c].paidOut)
                return (
                  <div key={cat.key} className="rounded-lg border border-surface-border overflow-hidden">
                    <button type="button" onClick={() => toggleCat(cat.key)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-hover/40 transition-colors flex-wrap">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                        <Icon className={`w-4 h-4 ${cat.cls}`} />
                        <span className="text-sm font-medium text-slate-200">{cat.label}</span>
                        <span className="text-xs text-slate-500">· {partnerDues.length}</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs ml-auto">
                        {pcurs.length === 0 ? <span className="text-slate-600">No partner packages</span> : pcurs.map(c => (
                          <span key={c} className="tabular-nums whitespace-nowrap">
                            <span className="text-slate-500 mr-1.5">{c}</span>
                            <span className="text-amber-300" title="Partners dues">{fmtAmount(partnerDuesTotals[c].delivered, c)}</span>
                            <span className="text-slate-600 mx-1">/</span>
                            <span className="text-green-300" title="Collected by drivers from the customer">{fmtAmount(partnerDuesTotals[c].collectedDrivers, c)}</span>
                            <span className="text-slate-600 mx-1">/</span>
                            <span className="text-teal-300" title="Collected by call center from the customer">{fmtAmount(partnerDuesTotals[c].collectedOffice, c)}</span>
                            <span className="text-slate-600 mx-1">/</span>
                            <span className="text-purple-300" title="Paid to partner">{fmtAmount(partnerDuesTotals[c].paidOut, c)}</span>
                            <span className="text-slate-600 mx-1">/</span>
                            <span className={partnerDuesTotals[c].balance > 0 ? 'text-amber-300' : 'text-[#1dffd5]'} title="Balance still owed">
                              {fmtAmount(partnerDuesTotals[c].balance, c)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </button>
                    {open && (
                      partnerDues.length === 0 ? (
                        <p className="text-xs text-slate-600 px-3 py-2 border-t border-surface-border/60">No partner packages</p>
                      ) : (
                        <div className="overflow-x-auto border-t border-surface-border/60">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/30">
                                <th className="px-3 py-1.5 font-medium">Partner</th>
                                <th className="px-3 py-1.5 font-medium text-right">Partners dues</th>
                                <th className="px-3 py-1.5 font-medium text-right" title="Package money the driver collected from the customer (packages paid directly to the partner are excluded)">
                                  Collected by drivers
                                </th>
                                <th className="px-3 py-1.5 font-medium text-right" title="Package money the call center / office collected from the customer">
                                  Collected by call center
                                </th>
                                <th className="px-3 py-1.5 font-medium text-right">Paid to partner</th>
                                <th className="px-3 py-1.5 font-medium text-right">Balance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {partnerDues.map(p => {
                                // Paid-direct packages never entered the box, so they're
                                // out of the dues here too.
                                const due = c => round2(p.cur[c].delivered - p.cur[c].paidDirect)
                                const rows = p.curs.filter(c => due(c) || p.cur[c].paidOut)
                                if (!rows.length) return null
                                return (
                                  <tr key={p.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30">
                                    <td className="px-3 py-1.5 text-slate-300">{p.name}</td>
                                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                      {rows.map(c => <div key={c} className="text-amber-300 tabular-nums">{fmtAmount(due(c), c)} <span className="text-slate-600">{c}</span></div>)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                      {rows.map(c => <div key={c} className="text-green-300 tabular-nums">{fmtAmount(p.cur[c].collectedDrivers, c)} <span className="text-slate-600">{c}</span></div>)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                      {rows.map(c => <div key={c} className="text-teal-300 tabular-nums">{fmtAmount(p.cur[c].collectedOffice, c)} <span className="text-slate-600">{c}</span></div>)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                      {rows.map(c => <div key={c} className="text-purple-300 tabular-nums">{fmtAmount(p.cur[c].paidOut, c)} <span className="text-slate-600">{c}</span></div>)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                      {rows.map(c => {
                                        const bal = round2(due(c) - p.cur[c].paidOut)
                                        return <div key={c} className={`tabular-nums font-medium ${bal > 0 ? 'text-amber-300' : 'text-[#1dffd5]'}`}>{fmtAmount(bal, c)} <span className="text-slate-600">{c}</span></div>
                                      })}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    )}
                  </div>
                )
              }

              const list = partyBreakdown[cat.key]
              const curs = activeCurs.filter(c => byParty[cat.key][c].collected || byParty[cat.key][c].spent)
              return (
                <div key={cat.key} className="rounded-lg border border-surface-border overflow-hidden">
                  {/* Clickable header — totals always visible; body expands below */}
                  <button type="button" onClick={() => toggleCat(cat.key)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-hover/40 transition-colors flex-wrap">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      <Icon className={`w-4 h-4 ${cat.cls}`} />
                      <span className="text-sm font-medium text-slate-200">{cat.label}</span>
                      <span className="text-xs text-slate-500">· {list.length}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs ml-auto">
                      {curs.length === 0 ? <span className="text-slate-600">No cash movement</span> : curs.map(c => (
                        <span key={c} className="tabular-nums whitespace-nowrap">
                          <span className="text-slate-500 mr-1.5">{c}</span>
                          <span className="text-green-300" title="Collected (total)">{fmtAmount(byParty[cat.key][c].collected, c)}</span>
                          <span className="text-slate-600 mx-1">/</span>
                          <span className="text-teal-300" title="Collected by call center (office)">{fmtAmount(byParty[cat.key][c].office, c)}</span>
                          <span className="text-slate-600 mx-1">/</span>
                          <span className="text-red-300" title="Spent">{fmtAmount(byParty[cat.key][c].spent, c)}</span>
                          <span className="text-slate-600 mx-1">/</span>
                          <span className={byParty[cat.key][c].net >= 0 ? 'text-[#1dffd5]' : 'text-amber-300'} title="Net">{fmtAmount(byParty[cat.key][c].net, c)}</span>
                        </span>
                      ))}
                    </div>
                  </button>
                  {/* Per-party list — only rendered when expanded */}
                  {open && (
                    list.length === 0 ? (
                      <p className="text-xs text-slate-600 px-3 py-2 border-t border-surface-border/60">No {single.toLowerCase()} cash movement</p>
                    ) : (
                      <div className="overflow-x-auto border-t border-surface-border/60">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/30">
                              <th className="px-3 py-1.5 font-medium">{single}</th>
                              <th className="px-3 py-1.5 font-medium text-right">Collected</th>
                              <th className="px-3 py-1.5 font-medium text-right" title="Portion collected by the call center / office">Collected by call center</th>
                              <th className="px-3 py-1.5 font-medium text-right">Spent</th>
                              <th className="px-3 py-1.5 font-medium text-right">Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map(p => (
                              <tr key={p.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30">
                                <td className="px-3 py-1.5 text-slate-300">{p.name}</td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                  {p.curs.map(c => <div key={c} className="text-green-300 tabular-nums">{fmtAmount(p.cur[c].collected, c)} <span className="text-slate-600">{c}</span></div>)}
                                </td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                  {p.curs.map(c => <div key={c} className="text-teal-300 tabular-nums">{fmtAmount(p.cur[c].office, c)} <span className="text-slate-600">{c}</span></div>)}
                                </td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                  {p.curs.map(c => <div key={c} className="text-red-300 tabular-nums">{fmtAmount(p.cur[c].spent, c)} <span className="text-slate-600">{c}</span></div>)}
                                </td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                  {p.curs.map(c => <div key={c} className={`tabular-nums font-medium ${p.cur[c].net >= 0 ? 'text-[#1dffd5]' : 'text-amber-300'}`}>{fmtAmount(p.cur[c].net, c)} <span className="text-slate-600">{c}</span></div>)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}
                </div>
              )
            })}
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
