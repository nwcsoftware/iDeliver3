import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  AlertTriangle, Banknote, Boxes, Download, Info, Megaphone, PackageCheck, PieChart as PieIcon, Receipt, Truck,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { fmtAmount } from '../lib/orderAmounts'
import { PERIODS, DEFAULT_PERIOD, periodRange } from '../lib/reportPeriods'
import {
  STREAMS, buildClosedOrdersReport, buildMonthlySeries, typeSlices,
  streamTotal, emptyStreams, dayText,
} from '../lib/closedOrdersReport'
import DataLoadingOverlay from '../components/ui/DataLoadingOverlay'

/* Closed Orders report — what finished work was worth, per currency.

   The page is built around one refusal: it never adds two currencies together.
   A figure that mixed $ and LBP at whatever rate the day happened to hold would
   be a number nobody could check and nobody could act on, so every currency
   gets its own card and the charts are read one currency at a time.

   Four streams, in the same order and the same colours throughout:
     Delivery fees          ours outright
     Stories orders         ads sold on Story orders
     Delivered packages     a partner's goods we carried
     Local market invoices  a shop's goods we fetched

   The gate is `isclosed`. An open order is work in progress — its packages may
   still come back and its fee may still be waived — so counting it would make
   last month's total change tomorrow. What the figures MEAN, including how a
   package paid straight to the partner is treated, lives in
   lib/closedOrdersReport; read the header there before trusting a number. */

const SURFACE   = '#1e293b'
const AXIS_TICK = { fill: '#64748b', fontSize: 11 }
const GRID_LINE = '#2b3a52'

const STREAM_ICON = {
  fees:     Truck,
  ads:      Megaphone,
  packages: Boxes,
  invoices: Receipt,
}

/* Axis figures only: 1.2k / 3.4M. Full precision lives in the tooltip, the
   cards and the table — an axis is a ruler, not a statement of account. */
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

const legendText = v => <span className="text-xs text-slate-400">{v}</span>

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

function MonthTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell title={d.title} sub={`${currency} · ${d.orders.toLocaleString()} closed order${d.orders === 1 ? '' : 's'}`}>
      {STREAMS.map(s => (
        <TooltipRow key={s.key} color={s.color} label={s.label} value={fmtAmount(d[s.key], currency)}
          cls={d[s.key] > 0 ? 'text-slate-100' : 'text-slate-600'} />
      ))}
      <TooltipRow label="All four" value={fmtAmount(d.total, currency)} cls="font-semibold text-slate-100" />
    </TooltipShell>
  )
}

function TypeTooltip({ active, payload, currency, grandTotal }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const share = grandTotal > 0 ? Math.round((d.value / grandTotal) * 100) : 0
  return (
    <TooltipShell title={d.label} sub={`${currency} · ${d.orders.toLocaleString()} order${d.orders === 1 ? '' : 's'} · ${share}% of the window`}>
      {STREAMS.map(s => (
        <TooltipRow key={s.key} color={s.color} label={s.label} value={fmtAmount(d.m[s.key], currency)}
          cls={d.m[s.key] > 0 ? 'text-slate-100' : 'text-slate-600'} />
      ))}
      <TooltipRow label="All four" value={fmtAmount(d.value, currency)} cls="font-semibold text-slate-100" />
      {/* "Other" must never be a place figures disappear into — name what went in. */}
      {d.folded?.length > 0 && d.folded.slice(0, 6).map(f => (
        <TooltipRow key={f.label} label={`· ${f.label}`} value={fmtAmount(f.value, currency)} cls="text-slate-500" />
      ))}
    </TooltipShell>
  )
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function ChartCard({ title, note, right, children }) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

/* One currency, read down the four streams — the heart of the report.

   The four figures are shown as a list rather than a chart on purpose: they are
   four headline numbers, and four bars would make the reader measure lengths to
   recover figures that are printed right there. The bar beside each is a share
   of the currency's own total, which is the one comparison a length answers
   faster than arithmetic does. */
function CurrencyCard({ cur, m }) {
  const total = streamTotal(m)
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
        <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10">
          <Banknote className="h-4 w-4 text-brand-300" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-wide text-slate-100">{cur}</h2>
          <p className="text-[11px] text-slate-500">
            {m.orders.toLocaleString()} closed order{m.orders === 1 ? '' : 's'} carried {cur}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-slate-100">{fmtAmount(total, cur)}</p>
          <p className="text-[11px] text-slate-500">all four streams</p>
        </div>
      </div>

      <div className="divide-y divide-surface-border/60">
        {STREAMS.map(s => {
          const v   = m[s.key] || 0
          const pct = total > 0 ? Math.round((v / total) * 100) : 0
          const Icon = STREAM_ICON[s.key]
          return (
            <div key={s.key} className="px-5 py-3">
              <div className="flex items-baseline gap-2.5">
                <Icon className="h-3.5 w-3.5 flex-shrink-0 self-center" style={{ color: s.color }} />
                <span className="min-w-0 flex-1 truncate text-xs uppercase tracking-wider text-slate-400" title={s.note}>
                  Total {s.label}
                </span>
                <span className={`text-sm font-semibold tabular-nums ${v > 0 ? 'text-slate-100' : 'text-slate-600'}`}>
                  {fmtAmount(v, cur)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 pl-6">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(148,163,184,0.16)' }}>
                  <div className="h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${pct}%`, background: s.color }} />
                </div>
                <span className="w-9 text-right text-[10px] tabular-nums text-slate-500">
                  {total > 0 ? `${pct}%` : '—'}
                </span>
              </div>
              {/* The part of this stream that never passed through us. Shown only
                  where it exists, because a zero here is noise. */}
              {s.key === 'packages' && m.pkgDirect > 0 && (
                <p className="mt-1.5 pl-6 text-[10px] text-slate-500">
                  {fmtAmount(m.pkgDirect, cur)} of it settled straight with the partner
                </p>
              )}
              {s.key === 'invoices' && m.invDirect > 0 && (
                <p className="mt-1.5 pl-6 text-[10px] text-slate-500">
                  {fmtAmount(m.invDirect, cur)} of it settled straight with the shop
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function ClosedOrdersReportPage() {
  const { orders, ordersError, ordersFullyLoaded, loadFullOrderHistory } = useApp()

  // Every window here can reach far past the startup window, so pull the lot once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [periodKey,     setPeriodKey]     = useState(DEFAULT_PERIOD)
  const [includeDirect, setIncludeDirect] = useState(true)
  const [currency,      setCurrency]      = useState('')
  const [monthsBack,    setMonthsBack]    = useState(12)

  const period = useMemo(() => periodRange(periodKey), [periodKey])

  const model = useMemo(() => buildClosedOrdersReport({
    orders, from: period.from, to: period.to, includeDirect,
  }), [orders, period.from, period.to, includeDirect])

  /* The monthly bars run on whole calendar months regardless of the chips above,
     so a half-finished month is never drawn as a short one. */
  const series = useMemo(() => buildMonthlySeries({
    orders, monthsBack, includeDirect,
  }), [orders, monthsBack, includeDirect])

  // Keep the chosen currency valid as the window — and so the currency list — moves.
  useEffect(() => {
    if (model.currencies.length && !model.currencies.includes(currency)) setCurrency(model.currencies[0])
  }, [model.currencies, currency])
  const cur = model.currencies.includes(currency) ? currency : (model.currencies[0] || 'USD')

  const hasData = model.orderCount > 0

  /* ── chart data ─────────────────────────────────────────────────────────── */

  const slices     = useMemo(() => typeSlices(model.types, cur), [model.types, cur])
  const sliceTotal = useMemo(() => slices.reduce((s, r) => s + r.value, 0), [slices])

  const monthRows = useMemo(() => series.months.map(b => {
    const m   = b.cur[cur] || emptyStreams()
    const row = { key: b.key, label: b.label, title: b.title, orders: m.orders, total: streamTotal(m) }
    for (const s of STREAMS) row[s.key] = m[s.key] || 0
    return row
  }), [series, cur])

  const monthsWithMoney = monthRows.filter(r => r.total > 0).length

  function downloadCSV() {
    const rows = []
    for (const c of model.currencies) {
      const m = model.totals[c]
      rows.push({
        section: 'window total', period: `${model.from} to ${model.to}`, currency: c, order_type: '', month: '',
        orders: m.orders,
        delivery_fees: m.fees, stories_orders: m.ads, delivered_packages: m.packages, local_market_invoices: m.invoices,
        packages_paid_directly: m.pkgDirect, invoices_paid_directly: m.invDirect,
        all_four_streams: streamTotal(m),
      })
    }
    for (const t of model.types) {
      for (const c of Object.keys(t.cur)) {
        const m = t.cur[c]
        rows.push({
          section: 'by order type', period: `${model.from} to ${model.to}`, currency: c, order_type: t.label, month: '',
          orders: m.orders,
          delivery_fees: m.fees, stories_orders: m.ads, delivered_packages: m.packages, local_market_invoices: m.invoices,
          packages_paid_directly: m.pkgDirect, invoices_paid_directly: m.invDirect,
          all_four_streams: streamTotal(m),
        })
      }
    }
    for (const b of series.months) {
      for (const c of Object.keys(b.cur)) {
        const m = b.cur[c]
        rows.push({
          section: 'by month', period: '', currency: c, order_type: '', month: b.title,
          orders: m.orders,
          delivery_fees: m.fees, stories_orders: m.ads, delivered_packages: m.packages, local_market_invoices: m.invoices,
          packages_paid_directly: m.pkgDirect, invoices_paid_directly: m.invDirect,
          all_four_streams: streamTotal(m),
        })
      }
    }
    exportCSV(rows, `ideliver-closed-orders-${period.key}-${model.to}.csv`)
  }

  /* Hold the page behind the overlay until the FULL history is in — not merely
     until a fetch stops running. The app boots with only the last few days
     loaded, and a "last 3 months" total drawn from a week of orders is not a
     slow answer, it is a wrong one. */
  const busy = !ordersFullyLoaded && !ordersError

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6">
      <DataLoadingOverlay
        open={busy}
        title="Building the closed orders report"
        subtitle="Reading every order the window can reach…"
        steps={[
          { label: 'Loading the order history', done: ordersFullyLoaded },
          { label: 'Totalling by currency and stream', done: false },
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

      {/* Everything here is dated by the ORDER, which is not what a reader
          assumes about a story — so it is said out loud rather than buried in a
          tooltip nobody hovers. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-400" />
        <p className="text-xs text-sky-100/80">
          Figures are dated by the <span className="font-medium text-sky-100">order</span>, not by the line inside it.
          <span className="ml-1 text-sky-100/60">
            A story entered this month on an order opened last month is counted under <em>last</em> month, with the
            order it belongs to. An order is one piece of work, so its money is never split across two periods.
          </span>
        </p>
      </div>

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
          <button type="button" onClick={downloadCSV} disabled={!hasData}
            className="btn-ghost ml-auto text-slate-400 disabled:opacity-40">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-surface-border pt-3">
          <p className="text-xs text-slate-500">
            <span className="text-slate-300">{dayText(model.from)} – {dayText(model.to)}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span className="text-slate-400">closed orders only</span>
            <span className="mx-2 text-slate-600">·</span>
            {model.orderCount.toLocaleString()} counted
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400"
            title="A package flagged paid, or an invoice flagged excluded, was settled by the customer straight with the partner or the shop. The goods still moved — but that money never passed through us. On: what was delivered. Off: what came through our hands.">
            <input
              type="checkbox"
              checked={includeDirect}
              onChange={e => setIncludeDirect(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-surface-border bg-surface-hover accent-brand-600"
            />
            Count what was paid directly to the partner / shop
          </label>

          <span className="text-[11px] text-slate-500">
            {model.storyNoService > 0 && (
              <>
                <span title="Stories money is read from the order-service line that describes itself as a story. These Story orders have no such line, so they add nothing to the Stories figure — whatever else they may carry.">
                  {model.storyNoService.toLocaleString()} Story order{model.storyNoService === 1 ? '' : 's'} with no story service line
                </span>
                <span className="mx-2 text-slate-600">·</span>
              </>
            )}
            {model.openSkipped > 0 && (
              <span title="Still open, so still able to change. They are counted the day they close.">
                {model.openSkipped.toLocaleString()} open order{model.openSkipped === 1 ? '' : 's'} not counted
              </span>
            )}
            {model.openSkipped > 0 && model.freeSkipped > 0 && <span className="mx-2 text-slate-600">·</span>}
            {model.freeSkipped > 0 && (
              <span title="A free order is waived to zero, so it earns nothing. It is left out rather than counted as a fully-discounted sale.">
                {model.freeSkipped.toLocaleString()} free order{model.freeSkipped === 1 ? '' : 's'} excluded
              </span>
            )}
          </span>
        </div>
      </div>

      {!hasData ? (
        <div className="card flex h-64 flex-col items-center justify-center gap-2 text-center">
          <PackageCheck className="h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">No closed orders in {period.label.toLowerCase()}</p>
          <p className="max-w-sm text-xs text-slate-500">
            {model.openSkipped > 0
              ? `${model.openSkipped.toLocaleString()} order${model.openSkipped === 1 ? ' is' : 's are'} still open — they are counted here the day they close. Try a wider window.`
              : 'Nothing was closed in this window. Try a wider one.'}
          </p>
        </div>
      ) : (
        <>
          {/* ── the totals, one card per currency ───────────────────────────
              Never side-by-side arithmetic: two currencies are two separate
              accounts that happen to be shown on one screen. */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {model.currencies.map(c => (
              <CurrencyCard key={c} cur={c} m={model.totals[c]} />
            ))}
          </div>

          {/* ── which currency the two charts are read in ────────────────── */}
          {model.currencies.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Charts in</span>
              {model.currencies.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    cur === c ? 'bg-surface-hover text-slate-100' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {c}
                </button>
              ))}
              <span className="text-[11px] text-slate-600">
                — currencies are never added together, so the charts show one at a time.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
            {/* ── the pie: which order types the money came from ──────────── */}
            <div className="xl:col-span-2">
              <ChartCard
                title={`By order type · ${cur}`}
                note={`Share of the four streams, ${period.label.toLowerCase()}. Past the top five, the rest fold into “Other” — a pie stops being readable beyond about six slices.`}
              >
                {slices.length === 0 ? (
                  <div className="flex h-[320px] flex-col items-center justify-center gap-2 text-center">
                    <PieIcon className="h-7 w-7 text-slate-600" />
                    <p className="text-xs text-slate-500">No {cur} money in this window.</p>
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={230}>
                      <PieChart>
                        <Pie
                          data={slices}
                          dataKey="value"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={52}
                          outerRadius={92}
                          paddingAngle={2}
                          stroke={SURFACE}
                          strokeWidth={2}
                          isAnimationActive={false}
                        >
                          {slices.map(s => <Cell key={s.key} fill={s.color} />)}
                        </Pie>
                        <Tooltip content={<TypeTooltip currency={cur} grandTotal={sliceTotal} />} />
                      </PieChart>
                    </ResponsiveContainer>

                    {/* The legend carries the figures, so nothing on this card is
                        readable by colour alone. */}
                    <dl className="mt-3 space-y-1.5">
                      {slices.map(s => {
                        const pct = sliceTotal > 0 ? Math.round((s.value / sliceTotal) * 100) : 0
                        return (
                          <div key={s.key} className="flex items-center gap-2 text-xs">
                            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-[3px]" style={{ background: s.color }} />
                            <dt className="min-w-0 flex-1 truncate text-slate-400"
                              title={s.folded ? s.folded.map(f => f.label).join(', ') : s.label}>
                              {s.label}
                            </dt>
                            <dd className="tabular-nums text-slate-200">{fmtAmount(s.value, cur)}</dd>
                            <dd className="w-9 text-right tabular-nums text-slate-500">{pct}%</dd>
                          </div>
                        )
                      })}
                    </dl>
                  </>
                )}
              </ChartCard>
            </div>

            {/* ── the bars: whole months, split by stream ─────────────────── */}
            <div className="xl:col-span-3">
              <ChartCard
                title={`By month · ${cur}`}
                note="Whole calendar months, each stacked into the four streams. Independent of the window above, so a part-month is never drawn as a short one."
                right={
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {[6, 12, 24].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setMonthsBack(n)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          monthsBack === n ? 'bg-surface-hover text-slate-100' : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {n}m
                      </button>
                    ))}
                  </div>
                }
              >
                {monthsWithMoney === 0 ? (
                  <div className="flex h-[320px] flex-col items-center justify-center gap-2 text-center">
                    <Boxes className="h-7 w-7 text-slate-600" />
                    <p className="text-xs text-slate-500">
                      No {cur} money closed in the last {monthsBack} months.
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={monthRows} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke={GRID_LINE} vertical={false} />
                      <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={8} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} tickFormatter={compact} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<MonthTooltip currency={cur} />} />
                      <Legend formatter={legendText} iconType="square" iconSize={9} wrapperStyle={{ paddingTop: 8 }} />
                      {STREAMS.map((s, i) => (
                        <Bar key={s.key} dataKey={s.key} name={s.label} stackId="m" fill={s.color}
                          stroke={SURFACE} strokeWidth={2} maxBarSize={46}
                          radius={i === STREAMS.length - 1 ? [4, 4, 0, 0] : undefined} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
          </div>

          {/* ── the same numbers, readable without colour ──────────────────
              Not a nicety: it is what makes every figure above reachable when
              the hues are not (colour blindness, print, a projector). */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-200">Every month, stream by stream</h2>
              <span className="text-xs text-slate-500">{cur} · last {monthsBack} months</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5 text-left font-semibold">Month</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Orders</th>
                    {STREAMS.map(s => (
                      <th key={s.key} className="px-3 py-2.5 text-right font-semibold">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: s.color }} />
                        {s.label}
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-right font-semibold">All four</th>
                  </tr>
                </thead>
                <tbody>
                  {monthRows.map(r => (
                    <tr key={r.key} className="border-b border-surface-border/60 last:border-0 hover:bg-surface-hover/40">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-300">{r.title}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.orders.toLocaleString()}</td>
                      {STREAMS.map(s => (
                        <td key={s.key} className={`px-3 py-2 text-right tabular-nums ${r[s.key] > 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                          {fmtAmount(r[s.key], cur)}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-100">
                        {fmtAmount(r.total, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface-hover/30 text-slate-100">
                    <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {monthRows.reduce((s, r) => s + r.orders, 0).toLocaleString()}
                    </td>
                    {STREAMS.map(s => (
                      <td key={s.key} className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        {fmtAmount(monthRows.reduce((a, r) => a + r[s.key], 0), cur)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                      {fmtAmount(monthRows.reduce((a, r) => a + r.total, 0), cur)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
