import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList,
} from 'recharts'
import {
  AlertTriangle, Banknote, Boxes, CreditCard, Download, FilterX, HandCoins,
  Receipt, Users, Wallet,
} from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { fmtAmount } from '../lib/orderAmounts'
import { formatAccountNumber } from '../lib/accountNumber'
import {
  CATEGORIES, CATEGORY_KEYS, STREAMS, PERIODS, DEFAULT_PERIOD,
  periodWindow, buildCategoryReport, groupMoney, contactName, categoryOf, dayText, ZERO,
} from '../lib/customerCategoryReport'
import ContactCombobox from '../components/orders/ContactCombobox'
import DataLoadingOverlay from '../components/ui/DataLoadingOverlay'

/* Customer Categories report — the same three money streams read twice, once
   for customers who may run a balance and once for everybody else.

   Credit and regular customers are not two slices of one business; they are two
   different promises. A regular order is money that should already be in the
   drawer, so anything outstanding on it is a problem today. A credit order is
   money we agreed to wait for, so the same figure is a plan. Totalling the two
   together hides both, which is why this report never adds them up — and never
   adds two currencies together either.

   Each category is read down three streams:
     Delivery fees  — ours outright: charged, collected, pending.
     Packages       — a partner's goods we carried: what they were worth, what
                      we collected for them, what we have handed over, what we
                      still owe (identical to the Partner Dues page).
     Invoices       — a shop's goods: the same four, less the commission we keep
                      (identical to the Shop Statements page).

   Free orders are waived to zero and are left out entirely rather than counted
   as fully-discounted sales; the count of what was skipped is shown so the
   omission is visible rather than silent.

   The arithmetic — including how an order-level payment is apportioned across
   its lines, and how a partner payout is spread over the lines it settles —
   lives in lib/customerCategoryReport so the figures can be checked on their
   own. Read the header there before trusting a number. */

const SURFACE   = '#1e293b'
const AXIS_TICK = { fill: '#64748b', fontSize: 11 }
const GRID_LINE = '#2b3a52'
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

/* Axis figures only: 1.2k / 3.4M. Full precision lives in the tooltip, the
   panels and the table — an axis is a ruler, not a statement of account. */
function compact(n) {
  const v = Number(n) || 0
  const a = Math.abs(v)
  const cut = (unit, suffix) => `${(v / unit).toFixed(a / unit >= 10 ? 0 : 1).replace(/\.0$/, '')}${suffix}`
  if (a >= 1e9) return cut(1e9, 'B')
  if (a >= 1e6) return cut(1e6, 'M')
  if (a >= 1e3) return cut(1e3, 'k')
  return String(Math.round(v))
}

function exportCSV(rows, filename) {
  if (!rows.length) return
  const headers = Object.keys(rows[0]).join(',')
  const body    = rows.map(r => Object.values(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob    = new Blob([headers + '\n' + body], { type: 'text/csv;charset=utf-8' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

/* ── tooltips ─────────────────────────────────────────────────────────────── */

function TooltipShell({ title, sub, children }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] text-slate-400">{title}</p>
      {sub && <p className="mb-1 text-[10px] text-slate-500">{sub}</p>}
      <div className="mt-1.5 grid grid-cols-[10px_1fr_auto] items-center gap-x-2 gap-y-1 text-xs">{children}</div>
    </div>
  )
}

function TooltipRow({ color, label, value, cls = 'text-slate-100' }) {
  return (
    <>
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color || 'transparent' }} />
      <span className="whitespace-nowrap text-slate-400">{label}</span>
      <span className={`text-right tabular-nums ${cls}`}>{value}</span>
    </>
  )
}

function StreamTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell title={d.stream} sub={`${currency} · settled vs still out`}>
      {CATEGORIES.map(c => (
        <React.Fragment key={c.key}>
          <TooltipRow color={c.color} label={`${c.short} · collected`} value={fmtAmount(d[`${c.key}_collected`], currency)} />
          <TooltipRow color={c.faded} label={`${c.short} · outstanding`} value={fmtAmount(d[`${c.key}_out`], currency)}
            cls={d[`${c.key}_out`] > 0 ? 'text-amber-300' : 'text-slate-500'} />
          <TooltipRow label={`${c.short} · total`} value={fmtAmount(d[`${c.key}_total`], currency)} />
        </React.Fragment>
      ))}
    </TooltipShell>
  )
}

function TimeTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell title={d.title} sub={`${currency} · billed`}>
      {CATEGORIES.map(c => (
        <React.Fragment key={c.key}>
          <TooltipRow color={c.color} label={`${c.short} (${d[`${c.key}_orders`]} orders)`} value={fmtAmount(d[c.key], currency)} />
          {STREAMS.map(s => (
            <TooltipRow key={s.key} label={`   ${s.label}`} value={fmtAmount(d[`${c.key}_${s.key}`], currency)} cls="text-slate-400" />
          ))}
        </React.Fragment>
      ))}
    </TooltipShell>
  )
}

function OwedTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell title={d.label} sub={d.note}>
      {CATEGORIES.map(c => (
        <TooltipRow key={c.key} color={c.color} label={c.short} value={fmtAmount(d[c.key], currency)} />
      ))}
    </TooltipShell>
  )
}

const legendText = v => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>

/* ── pieces ───────────────────────────────────────────────────────────────── */

function ChartCard({ title, note, children }) {
  return (
    <div className="card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </div>
  )
}

/* One figure inside a category panel. The value never wears the category
   colour — identity is carried by the panel it sits in, so the numbers stay in
   text ink and read the same to everyone. */
function Figure({ label, value, tone = 'plain', hint, strong = false }) {
  const cls = {
    plain: 'text-slate-200',
    good:  'text-emerald-300/90',
    warn:  'text-amber-300',
    muted: 'text-slate-500',
  }[tone]
  return (
    <>
      <dt className={`min-w-0 truncate text-slate-500 ${strong ? 'font-medium text-slate-400' : ''}`} title={hint || label}>
        {label}
      </dt>
      <dd className={`text-right tabular-nums ${cls} ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </>
  )
}

/* How much of a stream has been settled. The bar repeats what the two numbers
   above it already say — deliberately: a share is read faster as a length than
   as a subtraction, and the numbers stay there for whoever needs the exact one. */
function Meter({ part, whole, color }) {
  const pct = whole > 0 ? Math.round(Math.min(1, Math.max(0, part / whole)) * 100) : 0
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(148,163,184,0.16)' }}>
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-9 text-right text-[10px] tabular-nums text-slate-500">{whole > 0 ? `${pct}%` : '—'}</span>
    </div>
  )
}

function Block({ icon: Icon, title, color, children, meter }) {
  return (
    <div className="rounded-lg border border-surface-border/70 bg-surface-hover/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">{children}</dl>
      {meter}
    </div>
  )
}

/* One category, read down the three streams. */
function CategoryPanel({ cat, group, cur }) {
  const m = groupMoney(group, cur) || ZERO()
  const orders = group?.orders ?? 0
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
        <span className="mt-1 h-3 w-3 flex-shrink-0 rounded-[4px]" style={{ background: cat.color }} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-100">{cat.label}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{cat.note}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-slate-100">{fmtAmount(m.billed, cur)}</p>
          <p className="text-[11px] text-slate-500">
            {cur} billed · {orders.toLocaleString()} order{orders === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <Block
          icon={HandCoins} title="Delivery fees" color={cat.color}
          meter={<Meter part={m.feesCollected} whole={m.fees} color={cat.color} />}
        >
          <Figure strong label="Total delivery fees" value={fmtAmount(m.fees, cur)} />
          <Figure label="Collected" value={fmtAmount(m.feesCollected, cur)} tone="good" />
          <Figure label="Pending" value={fmtAmount(m.feesPending, cur)} tone={m.feesPending > 0 ? 'warn' : 'muted'} />
        </Block>

        <Block
          icon={Boxes} title="Packages" color={cat.color}
          meter={<Meter part={m.pkgCollected} whole={round2(m.pkgTotal - m.pkgDirect)} color={cat.color} />}
        >
          <Figure strong label="Total package prices" value={fmtAmount(m.pkgTotal, cur)} />
          <Figure label="Collected from customers" value={fmtAmount(m.pkgCollected, cur)} tone="good"
            hint="The share of customer payments that landed on package lines. Packages the customer settled with the partner directly are not ours to collect." />
          <Figure label="Paid to partners" value={fmtAmount(m.paidToPartner, cur)}
            hint="Payouts we handed over, plus packages the customer paid the partner directly." />
          {m.pkgDirect > 0 && (
            <Figure label="…of which paid directly" value={fmtAmount(m.pkgDirect, cur)} tone="muted"
              hint="The customer settled with the partner — we never held this money." />
          )}
          <Figure strong label="Partner dues" value={fmtAmount(m.partnerDues, cur)}
            tone={m.partnerDues > 0 ? 'warn' : 'muted'}
            hint="Packages − paid directly to the partner − paid out. What we still owe partners for this window." />
        </Block>

        <Block
          icon={Receipt} title="Shop invoices" color={cat.color}
          meter={<Meter part={m.invCollected} whole={round2(m.invTotal - m.invDirect)} color={cat.color} />}
        >
          <Figure strong label="Total invoices" value={fmtAmount(m.invTotal, cur)} />
          <Figure label="Collected from customers" value={fmtAmount(m.invCollected, cur)} tone="good"
            hint="The share of customer payments that landed on invoice lines. Invoices the customer settled with the shop directly are not ours to collect." />
          <Figure label="Paid to supplier" value={fmtAmount(m.paidToSupplier, cur)}
            hint="Payouts we handed over, plus invoices the customer paid the shop directly." />
          {m.invCommission > 0 && (
            <Figure label="…less commission earned" value={fmtAmount(m.invCommission, cur)} tone="muted"
              hint="Commission we keep on goods we purchased — deducted from what we owe the shop." />
          )}
          <Figure strong label="Pending to supplier" value={fmtAmount(m.supplierPending, cur)}
            tone={m.supplierPending > 0 ? 'warn' : 'muted'}
            hint="Invoices − paid directly to the shop − commission − paid out. What we still owe shops for this window." />
        </Block>
      </div>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function CustomerCategoryReportPage() {
  const { orders, ordersError, ordersFullyLoaded, loadFullOrderHistory, COMPANY_ID } = useApp()

  // Every window here can reach past the startup window, so pull the lot once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [periodKey,  setPeriodKey]  = useState(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [closedOnly, setClosedOnly] = useState(true)
  const [currency,   setCurrency]   = useState('')
  const [customerId, setCustomerId] = useState('')

  /* Payouts: the only record of money actually handed to a partner or a shop.
     partner_payouts (fix82) carries both — a shop payment is a payout to that
     contact, same table. Paged, because a plain select silently stops at 1000
     rows and a missing payout would read as an unpaid due. */
  const [payouts,     setPayouts]     = useState([])
  const [payoutError, setPayoutError] = useState('')
  const [payoutsIn,   setPayoutsIn]   = useState(false)

  const fetchPayouts = useCallback(async () => {
    setPayoutError('')
    const { data, error, partial } = await fetchAllRows(() => {
      let q = supabase.from('partner_payouts').select('id, partner_id, amount, currency, paid_at, created_at')
        .order('paid_at', { ascending: true })
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    })
    if (error) setPayoutError(partial
      ? `Only part of the payout history could be read — ${error.message}`
      : error.message)
    setPayouts(data ?? [])
    setPayoutsIn(true)
  }, [COMPANY_ID])

  useEffect(() => { fetchPayouts() }, [fetchPayouts])

  const period = useMemo(
    () => periodWindow(periodKey, { customFrom, customTo }),
    [periodKey, customFrom, customTo],
  )

  const model = useMemo(() => buildCategoryReport({
    orders, payouts, from: period.from, to: period.to, closedOnly, customerId,
  }), [orders, payouts, period.from, period.to, closedOnly, customerId])

  // Keep the chosen currency valid as the window — and so the currency list — moves.
  useEffect(() => {
    if (model.currencies.length && !model.currencies.includes(currency)) setCurrency(model.currencies[0])
  }, [model.currencies, currency])
  const cur = model.currencies.includes(currency) ? currency : (model.currencies[0] || 'USD')

  /* Every customer the loaded orders know about, for the picker. Deliberately
     NOT narrowed to the window: someone searching for a customer wants to find
     them and see zeros, not be told they do not exist. */
  const customers = useMemo(() => {
    const m = new Map()
    for (const o of orders) {
      const c = o.customer
      if (c?.id && !m.has(c.id)) m.set(c.id, c)
    }
    return [...m.values()].sort((a, b) => contactName(a).localeCompare(contactName(b)))
  }, [orders])
  const chosenCustomer = customerId ? customers.find(c => c.id === customerId) : null

  const totalsFor = k => groupMoney(model.totals[k], cur) || ZERO()
  const hasData   = model.orderCount > 0

  /* ── chart data ─────────────────────────────────────────────────────────── */

  // 1. Each stream, per category, split into what came in and what is still out.
  const streamRows = useMemo(() => STREAMS.map(s => {
    const row = { stream: s.label, key: s.key }
    for (const c of CATEGORIES) {
      const m = totalsFor(c.key)
      const total     = m[s.totalKey]
      const collected = m[s.collectedKey]
      row[`${c.key}_total`]     = total
      row[`${c.key}_collected`] = collected
      // Packages and invoices settled directly with the partner or shop were
      // never ours to collect, so they are neither collected nor outstanding.
      const notOurs = s.key === 'packages' ? m.pkgDirect : s.key === 'invoices' ? m.invDirect : 0
      row[`${c.key}_out`] = Math.max(0, round2(total - notOurs - collected))
    }
    return row
  }), [model, cur])

  // 2. Billed over time, one bar per category, the streams inside the tooltip.
  const timeRows = useMemo(() => model.series.map(b => {
    const row = { key: b.key, label: b.label, title: b.title }
    for (const c of CATEGORIES) {
      const g = b.groups[c.key]
      const m = groupMoney(g, cur) || ZERO()
      row[c.key]              = m.billed
      row[`${c.key}_orders`]  = g?.orders ?? 0
      row[`${c.key}_fees`]     = m.fees
      row[`${c.key}_packages`] = m.pkgTotal
      row[`${c.key}_invoices`] = m.invTotal
    }
    return row
  }), [model, cur])

  // 3. What is still out at the end of the window, in both directions.
  const owedRows = useMemo(() => {
    const spec = [
      { key: 'customers', label: 'Owed by customers', note: 'Billed but not yet collected.',
        pick: m => round2(m.billed - m.pkgDirect - m.invDirect - m.collected) },
      { key: 'partners',  label: 'Owed to partners',  note: 'Package money we hold on their behalf.',
        pick: m => m.partnerDues },
      { key: 'shops',     label: 'Owed to shops',     note: 'Invoice value less commission and payouts.',
        pick: m => m.supplierPending },
    ]
    return spec.map(s => {
      const row = { key: s.key, label: s.label, note: s.note }
      for (const c of CATEGORIES) row[c.key] = Math.max(0, s.pick(totalsFor(c.key)))
      return row
    }).filter(r => CATEGORY_KEYS.some(k => r[k] > 0))
  }, [model, cur])

  /* ── the table & the CSV, from one set of rows so they cannot disagree ──── */
  const tableRows = useMemo(() => {
    const out = []
    for (const b of model.series) {
      for (const c of CATEGORIES) {
        const g = b.groups[c.key]
        const m = groupMoney(g, cur)
        if (!m && !(g?.orders)) continue
        out.push({ bucket: b, cat: c, orders: g?.orders ?? 0, m: m || ZERO() })
      }
    }
    return out
  }, [model, cur])

  function downloadCSV() {
    exportCSV(tableRows.map(r => ({
      period:                    r.bucket.title,
      category:                  r.cat.label,
      currency:                  cur,
      orders:                    r.orders,
      delivery_fees:             r.m.fees,
      delivery_fees_collected:   r.m.feesCollected,
      delivery_fees_pending:     r.m.feesPending,
      packages_total:            r.m.pkgTotal,
      packages_collected:        r.m.pkgCollected,
      packages_paid_to_partners: r.m.paidToPartner,
      partner_dues:              r.m.partnerDues,
      invoices_total:            r.m.invTotal,
      invoices_collected:        r.m.invCollected,
      invoices_paid_to_supplier: r.m.paidToSupplier,
      invoices_commission:       r.m.invCommission,
      invoices_pending_supplier: r.m.supplierPending,
    })), `ideliver-customer-categories-${period.key}-${cur}-${model.to}.csv`)
  }

  /* Hold the page behind the overlay until the FULL history and the payouts are
     in — not merely until a fetch stops running. The app boots with only the
     last few days loaded, and a "last 2 months" total drawn from a week of
     orders is not a slow answer, it is a wrong one. */
  const busy = (!ordersFullyLoaded && !ordersError) || !payoutsIn

  const grainWord   = model.grain === 'month' ? 'month' : model.grain === 'week' ? 'week' : 'day'
  const unmatched   = Object.entries(model.unmatchedPayouts).filter(([, v]) => v > 0)

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6">
      <DataLoadingOverlay
        open={busy}
        title="Building the customer categories report"
        subtitle="Reading every order the window can reach, and every payout made…"
        steps={[
          { label: 'Loading the order history', done: ordersFullyLoaded },
          { label: 'Loading partner & shop payouts', done: payoutsIn },
          { label: 'Totalling by category', done: false },
        ]}
      />

      {/* Figures built on a part-loaded history are worse than no figures,
          because they look exactly like real ones. Say so. */}
      {ordersError && !ordersFullyLoaded && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200/90">
            Not every order could be loaded — the totals below are incomplete.
            <span className="ml-1 text-amber-200/60">{ordersError}</span>
          </p>
        </div>
      )}
      {payoutError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200/90">
            Payouts could not be read, so “paid to partners / supplier” is understated and the dues are overstated.
            <span className="ml-1 text-amber-200/60">{payoutError}</span>
          </p>
        </div>
      )}

      {/* ── one filter row, above everything it scopes ─────────────────────── */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriodKey(p.key)}
              title={p.note}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                period.key === p.key
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:bg-surface-hover hover:text-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="ml-auto">
            <button type="button" onClick={downloadCSV} disabled={!hasData}
              className="btn-ghost text-slate-400 disabled:opacity-40">
              <Download className="h-4 w-4" /> CSV
            </button>
          </div>
        </div>

        {period.key === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">Between</span>
            <input type="date" className="input w-40" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-xs text-slate-600">and</span>
            <input type="date" className="input w-40" value={customTo} onChange={e => setCustomTo(e.target.value)} />
            {(customFrom || customTo) && (
              <button type="button" className="btn-ghost text-xs text-slate-500"
                onClick={() => { setCustomFrom(''); setCustomTo('') }}>
                <FilterX className="h-3.5 w-3.5" /> Clear
              </button>
            )}
            {!customFrom && !customTo && (
              <span className="text-xs text-slate-500">Pick two days — until then this shows the current month.</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-surface-border pt-3">
          <p className="text-xs text-slate-500">
            <span className="text-slate-300">{dayText(model.from)} – {dayText(model.to)}</span>
            <span className="mx-2 text-slate-600">·</span>
            by {grainWord}
            <span className="mx-2 text-slate-600">·</span>
            {closedOnly ? 'delivered (closed) orders' : 'all orders'}
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400"
            title="Dues only become real once an order is delivered — this is what makes the figures here agree with the Partner Dues and Shop Statements pages.">
            <input
              type="checkbox"
              checked={closedOnly}
              onChange={e => setClosedOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-surface-border bg-surface-hover accent-brand-600"
            />
            Delivered only
          </label>

          {model.currencies.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-500">Currency</span>
              {model.currencies.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    cur === c ? 'bg-surface-hover text-slate-100' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* One box, three ways in: type a name, a contact code, or an account
              number. Whichever the user has to hand is the one that works. */}
          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <span className="whitespace-nowrap text-[11px] uppercase tracking-wider text-slate-500">Customer</span>
            <div className="w-full sm:w-72">
              <ContactCombobox
                value={customerId}
                options={customers}
                onSelect={c => setCustomerId(c?.id || '')}
                placeholder="Name, code or account number…"
                compact
              />
            </div>
            {customerId && (
              <button type="button" className="btn-ghost text-xs text-slate-500" onClick={() => setCustomerId('')}>
                <FilterX className="h-3.5 w-3.5" /> All
              </button>
            )}
          </div>
        </div>

        {chosenCustomer && (
          <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3 text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Users className="h-3.5 w-3.5" /> {contactName(chosenCustomer)}
            </span>
            {chosenCustomer.code && <span className="font-mono text-slate-500">{chosenCustomer.code}</span>}
            {chosenCustomer.account_number && (
              <span className="font-mono text-slate-500">{formatAccountNumber(chosenCustomer.account_number)}</span>
            )}
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
              style={{
                color: categoryOf({ customer: chosenCustomer }) === 'credit' ? CATEGORIES[0].color : CATEGORIES[1].color,
                background: categoryOf({ customer: chosenCustomer }) === 'credit' ? CATEGORIES[0].faded : CATEGORIES[1].faded,
              }}
            >
              <CreditCard className="h-3 w-3" />
              {categoryOf({ customer: chosenCustomer }) === 'credit' ? 'Credit' : 'Regular'}
            </span>
            <span className="text-slate-600">
              — only this customer’s orders are counted below.
            </span>
          </div>
        )}

        {(model.freeSkipped > 0 || unmatched.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-border pt-3 text-[11px] text-slate-500">
            {model.freeSkipped > 0 && (
              <span title="A free order is waived to zero, so it earns nothing and owes nothing. It is left out rather than counted as a fully-discounted sale.">
                {model.freeSkipped} free order{model.freeSkipped === 1 ? '' : 's'} excluded
              </span>
            )}
            {unmatched.length > 0 && (
              <span title="Money paid to a partner or shop that has no delivery in this window — it is settling older ones, so it is not deducted from the dues above.">
                Payouts settling earlier windows:{' '}
                {unmatched.map(([c, v]) => `${fmtAmount(v, c)} ${c}`).join(' · ')}
              </span>
            )}
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="card flex h-64 flex-col items-center justify-center gap-2 text-center">
          <Boxes className="h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">Nothing to report for {period.label.toLowerCase()}</p>
          <p className="max-w-sm text-xs text-slate-500">
            {customerId
              ? 'This customer has no orders in the window. Clear the customer filter, or widen the dates.'
              : closedOnly
                ? `No orders were delivered in this window${model.openSkipped ? ` (${model.openSkipped} still open)` : ''}. Untick “Delivered only” to count open ones too.`
                : 'No orders fall in this window.'}
          </p>
        </div>
      ) : (
        <>
          {/* ── the two categories, side by side ─────────────────────────── */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {CATEGORIES.map(c => (
              <CategoryPanel key={c.key} cat={c} group={model.totals[c.key]} cur={cur} />
            ))}
          </div>

          {/* ── each stream, settled against outstanding ─────────────────── */}
          <ChartCard
            title={`Each stream, collected against outstanding · ${cur}`}
            note="Two bars per stream — credit customers and regular ones. The solid part is money in; the faded part above it is still out. Money the customer settled straight with the partner or shop is not shown: it was never ours to collect."
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={streamRows} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID_LINE} vertical={false} />
                <XAxis dataKey="stream" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} tickFormatter={compact} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<StreamTooltip currency={cur} />} />
                <Legend formatter={legendText} iconType="square" iconSize={9} wrapperStyle={{ paddingTop: 8 }} />
                {/* flatMap, not a nested map: Recharts reads its series off its
                    own children, and an array of arrays is not reliably one. */}
                {CATEGORIES.flatMap(c => ([
                  <Bar key={`${c.key}-c`} dataKey={`${c.key}_collected`} name={`${c.short} · collected`}
                    stackId={c.key} fill={c.color} stroke={SURFACE} strokeWidth={2} maxBarSize={64} />,
                  <Bar key={`${c.key}-o`} dataKey={`${c.key}_out`} name={`${c.short} · outstanding`}
                    stackId={c.key} fill={c.faded} stroke={SURFACE} strokeWidth={2} maxBarSize={64}
                    radius={[4, 4, 0, 0]} />,
                ]))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* ── billed over time ───────────────────────────────────────── */}
            <div className="lg:col-span-2">
              <ChartCard
                title={`Billed by ${grainWord} · ${cur}`}
                note="Delivery fees plus packages plus invoices. Hover a bar for the three streams behind it."
              >
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={timeRows} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={GRID_LINE} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} tickFormatter={compact} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<TimeTooltip currency={cur} />} />
                    <Legend formatter={legendText} iconType="square" iconSize={9} wrapperStyle={{ paddingTop: 8 }} />
                    {CATEGORIES.map(c => (
                      <Bar key={c.key} dataKey={c.key} name={c.label} fill={c.color}
                        stroke={SURFACE} strokeWidth={2} maxBarSize={40} radius={[4, 4, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── what is still out, in both directions ──────────────────── */}
            <ChartCard title="Still to settle" note={`Window close, ${cur}.`}>
              {owedRows.length === 0 ? (
                <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
                  <Wallet className="h-7 w-7 text-slate-600" />
                  <p className="text-xs text-slate-500">Everything in this window is settled both ways.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={owedRows} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={GRID_LINE} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compact} />
                    <YAxis type="category" dataKey="label" width={124}
                      tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<OwedTooltip currency={cur} />} />
                    <Legend formatter={legendText} iconType="square" iconSize={9} wrapperStyle={{ paddingTop: 8 }} />
                    {CATEGORIES.map(c => (
                      <Bar key={c.key} dataKey={c.key} name={c.label} fill={c.color}
                        stroke={SURFACE} strokeWidth={2} radius={[0, 4, 4, 0]} barSize={13}>
                        <LabelList dataKey={c.key} position="right" offset={6}
                          formatter={v => (v ? compact(v) : '')} style={{ fill: '#cbd5e1', fontSize: 10 }} />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* ── the same numbers, readable without colour ──────────────────
              Not a nicety: it is what makes every figure above reachable when
              the hues are not (colour blindness, print, a projector). */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-200">Every figure, by {grainWord} and category</h2>
              <span className="text-xs text-slate-500">{cur} · {model.buckets.length} {grainWord}s</span>
            </div>
            <div className="overflow-x-auto">
              {/* Thirteen columns of money will not fit a laptop, so the card
                  scrolls sideways rather than squeezing the headers into
                  unreadable stumps. */}
              <table className="w-full min-w-[1420px] text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5 text-left font-semibold">Period</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Category</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Orders</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Fees</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Fees collected</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Fees pending</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Packages</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Pkg collected</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Paid to partners</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Partner dues</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Invoices</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Inv collected</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Paid to supplier</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Supplier pending</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr><td colSpan={14} className="px-4 py-10 text-center text-sm text-slate-500">
                      Nothing in {cur} for this window.
                    </td></tr>
                  ) : tableRows.map(r => (
                    <tr key={`${r.bucket.key}-${r.cat.key}`} className="border-b border-surface-border/60 last:border-0 hover:bg-surface-hover/40">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-300">{r.bucket.title}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: r.cat.color }} />
                        {r.cat.short}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.orders.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmtAmount(r.m.fees, cur)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-300/90">{fmtAmount(r.m.feesCollected, cur)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.m.feesPending > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{fmtAmount(r.m.feesPending, cur)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmtAmount(r.m.pkgTotal, cur)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-300/90">{fmtAmount(r.m.pkgCollected, cur)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmtAmount(r.m.paidToPartner, cur)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.m.partnerDues > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{fmtAmount(r.m.partnerDues, cur)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmtAmount(r.m.invTotal, cur)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-300/90">{fmtAmount(r.m.invCollected, cur)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{fmtAmount(r.m.paidToSupplier, cur)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${r.m.supplierPending > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{fmtAmount(r.m.supplierPending, cur)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {CATEGORIES.map(c => {
                    const m = totalsFor(c.key)
                    return (
                      <tr key={c.key} className="border-t border-surface-border bg-surface-hover/30 text-slate-100">
                        <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{period.label}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: c.color }} />
                          {c.short}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{(model.totals[c.key].orders || 0).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.fees, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-300/90">{fmtAmount(m.feesCollected, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.feesPending, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.pkgTotal, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-300/90">{fmtAmount(m.pkgCollected, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.paidToPartner, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.partnerDues, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.invTotal, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-300/90">{fmtAmount(m.invCollected, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.paidToSupplier, cur)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(m.supplierPending, cur)}</td>
                      </tr>
                    )
                  })}
                </tfoot>
              </table>
            </div>
            <p className="border-t border-surface-border px-5 py-3 text-[11px] leading-relaxed text-slate-500">
              <Banknote className="mr-1.5 inline h-3 w-3 align-[-1px]" />
              A payment is taken against the whole order, so each line is credited at the order’s own settled rate — an
              order half paid reads half collected on every line. A payout is one payment to a partner or shop with no
              order attached, so it is spread across that party’s own lines in proportion to what each one owes them.
              Both are exact wherever the order is paid in full and the party is paid what they were owed.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
