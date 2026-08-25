import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, LabelList,
} from 'recharts'
import { Download, FileDown, Loader2, Banknote, Boxes, Package, Receipt, HandCoins, Wallet, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { fmtAmount } from '../lib/orderAmounts'
import { PERIODS, DEFAULT_PERIOD, periodRange, parseDay } from '../lib/reportPeriods'
import {
  orderFact, buildReport, emptyBucket, EMPTY_MONEY,
  MONEY_SERIES, COUNT_SERIES, compact,
} from '../lib/performanceReport'
import { buildPerformancePdf, performancePdfName } from '../lib/performanceReportPdf'
import DataLoadingOverlay from '../components/ui/DataLoadingOverlay'

/* Performance report — what the business earned and moved over a window, drawn
   rather than listed.

   Six windows (this week, last 2 weeks, this month, last month, last 3 months,
   till date), each split into day / week / month buckets according to how wide
   it is, with the money broken down into the same categories the order amounts
   popup uses — so a figure here and a figure on an order agree by construction
   rather than by luck: both come from orderAmountBreakdown.

   Money is never summed across currencies: USD 40 and LBP 300,000 measure
   nothing in common. The charts show ONE currency at a time, chosen at the top;
   the counts (orders, packages, invoices) are currency-free and always whole.

   A note on the date an order counts under: its CLOSE date, falling back to the
   scheduled date — the same "delivery day" the Packages report and the Daily
   Collection use, so the three never disagree about which week a delivery
   landed in. */

/* Series definitions (and their colours) live in lib/performanceReport so the
   screen, the CSV and the PDF cannot drift apart — see the palette note there
   for why the colours may not be edited one slot at a time. SURFACE is the app's
   card colour, used as the hairline gap between stacked segments. */
const SURFACE   = '#1e293b'
const AXIS_TICK = { fill: '#64748b', fontSize: 11 }
const GRID_LINE = '#2b3a52'
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

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

function TooltipShell({ title, children }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="mb-1.5 text-[11px] text-slate-400">{title}</p>
      <div className="grid grid-cols-[10px_1fr_auto] items-center gap-x-2 gap-y-1 text-xs">{children}</div>
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

function MoneyTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const shown = MONEY_SERIES.filter(s => Number(d[s.key]) !== 0)
  const gross = shown.reduce((sum, s) => sum + Number(d[s.key] || 0), 0)
  return (
    <TooltipShell title={d.title}>
      {shown.length === 0 && <TooltipRow label="No revenue" value="—" cls="text-slate-500" />}
      {shown.map(s => (
        <TooltipRow key={s.key} color={s.color} label={s.label} value={fmtAmount(d[s.key], currency)} />
      ))}
      {shown.length > 1 && <TooltipRow label="Gross" value={fmtAmount(gross, currency)} />}
      {d.discount > 0 && <TooltipRow label="Discount" value={`−${fmtAmount(d.discount, currency)}`} cls="text-rose-300/90" />}
      {d.vat > 0 && <TooltipRow label="VAT" value={fmtAmount(d.vat, currency)} />}
      {(d.discount > 0 || d.vat > 0) && <TooltipRow label="Net total" value={fmtAmount(d.total, currency)} />}
      <TooltipRow label="Collected" value={fmtAmount(d.collected, currency)} cls="text-emerald-300/90" />
    </TooltipShell>
  )
}

function CountTooltip({ active, payload, labels }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell title={d.title}>
      {COUNT_SERIES.map(s => (
        <TooltipRow key={s.key} color={s.color} label={labels[s.key]} value={Number(d[s.key] || 0).toLocaleString()} />
      ))}
      <TooltipRow label="Retail invoices" value={Number(d.invoiceCount || 0).toLocaleString()} />
    </TooltipShell>
  )
}

function MixTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <TooltipShell title={d.label}>
      <TooltipRow color={d.color} label={`${d.share}% of gross`} value={fmtAmount(d.value, currency)} />
    </TooltipShell>
  )
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

/* A headline figure. Identity is carried by the icon beside it, never by the
   colour of the number — values stay in text ink so they read the same to
   everyone. The hero uses proportional figures: equal-width digits make a big
   number look loose at that size. */
function Tile({ icon: Icon, label, value, sub, hero = false, accent = '#3987e5' }) {
  return (
    <div className={`card flex items-start gap-3 p-4 ${hero ? 'sm:col-span-2' : ''}`}>
      <span
        className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${accent}26`, color: accent }}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`mt-0.5 font-bold text-slate-100 ${hero ? 'text-3xl' : 'text-xl tabular-nums'}`}>{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-500" title={sub}>{sub}</p>}
      </div>
    </div>
  )
}

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

const legendText = v => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function PerformanceReportPage() {
  const { orders, ordersError, ordersFullyLoaded, loadFullOrderHistory } = useApp()
  const { currentUser } = useAuth()

  // Every window here can reach past the startup window, so pull the lot once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [periodKey,  setPeriodKey]  = useState(DEFAULT_PERIOD)
  const [closedOnly, setClosedOnly] = useState(true)
  const [currency,   setCurrency]   = useState('')
  const [pdfBusy,    setPdfBusy]    = useState(false)
  const [pdfError,   setPdfError]   = useState('')

  /* The company letterhead for the PDF. Fetched once and allowed to fail — a
     missing companies row costs the report a name, not the report. */
  const [company, setCompany] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.from('companies').select('name, address, phone, email').limit(1).maybeSingle()
        if (alive) setCompany(data ?? null)
      } catch { /* letterhead falls back to the product name */ }
    })()
    return () => { alive = false }
  }, [])

  const period = useMemo(() => periodRange(periodKey), [periodKey])

  // Reducing an order to its figures is the expensive half, and it does not
  // depend on the window — so it is memoised on the orders alone and a period
  // change only re-buckets what has already been computed.
  const facts = useMemo(() => orders.map(orderFact), [orders])

  const scoped = useMemo(
    () => facts.filter(f => f.day && (!closedOnly || f.closed)),
    [facts, closedOnly],
  )

  const model = useMemo(() => buildReport(scoped, period), [scoped, period])

  // Keep the chosen currency valid as the window — and so the currency list — moves.
  useEffect(() => {
    if (model.currencies.length && !model.currencies.includes(currency)) {
      setCurrency(model.currencies[0])
    }
  }, [model.currencies, currency])
  const cur = model.currencies.includes(currency) ? currency : (model.currencies[0] || 'USD')

  const totalMoney = model.totals.cur[cur] || EMPTY_MONEY()

  /* Per-bucket rows, shared by both time charts and the table so the three can
     never drift apart. Empty buckets are kept: a closed Sunday is a fact about
     the week, not a gap to draw straight over. */
  const rows = useMemo(() => model.buckets.map(b => {
    const slot = model.map.get(b.key) || emptyBucket()
    const m    = slot.cur[cur] || EMPTY_MONEY()
    return {
      key: b.key, label: b.label, title: b.title,
      orderCount: slot.orderCount, packageCount: slot.packageCount, invoiceCount: slot.invoiceCount,
      ...m,
    }
  }), [model, cur])

  // Only categories with something in them take a slot in the chart. Because
  // colour is bound to the category, dropping an empty one never recolours the rest.
  const activeMoney = MONEY_SERIES.filter(s => rows.some(r => Number(r[s.key]) !== 0))
  const topKey      = activeMoney.length ? activeMoney[activeMoney.length - 1].key : null

  const grossTotal = activeMoney.reduce((sum, s) => sum + totalMoney[s.key], 0)
  const mix = MONEY_SERIES
    .map(s => ({
      // `print` travels with the row so the PDF paints the same category the
      // same hue, re-stepped for paper.
      key: s.key, label: s.label, color: s.color, print: s.print,
      value: round2(totalMoney[s.key]),
      share: grossTotal ? Math.round((totalMoney[s.key] / grossTotal) * 100) : 0,
    }))
    .filter(d => d.value !== 0)
    .sort((a, b) => b.value - a.value)

  const countLabels = closedOnly
    ? { orderCount: 'Orders delivered', packageCount: 'Packages delivered' }
    : { orderCount: 'Orders',           packageCount: 'Packages' }

  const grainWord = model.grain === 'month' ? 'month' : model.grain === 'week' ? 'week' : 'day'
  const dayText   = d => parseDay(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
  const hasData   = model.totals.orderCount > 0

  /* Hold the whole page behind the overlay until the FULL history is in, not
     merely until a fetch stops running: the app boots with only the last few
     days loaded, and a "till date" total drawn from a week of orders is not a
     slow answer, it is a wrong one. If the load fails outright, show what we
     have with the warning below rather than spinning forever. */
  const busy = !ordersFullyLoaded && !ordersError

  function downloadCSV() {
    exportCSV(rows.map(r => ({
      period:                   r.title,
      orders:                   r.orderCount,
      packages:                 r.packageCount,
      retail_invoices:          r.invoiceCount,
      currency:                 cur,
      delivery_fees:            r.fees,
      delivery_packages_value:  r.packages,
      local_retail_items:       r.localRetail,
      external_retail_invoices: r.externalRetail,
      order_services:           r.services,
      ads:                      r.ads,
      discount:                 r.discount,
      vat:                      r.vat,
      net_total:                r.total,
      collected:                r.collected,
    })), `ideliver-performance-${period.key}-${cur}-${model.to}.csv`)
  }

  /* The PDF is the screen you are looking at, on paper: same window, same
     currency, same delivered-only choice, same figures. It is built from `rows`
     and `model` rather than re-queried, so what you export is exactly what you
     were reading — never a second calculation that might disagree. */
  async function downloadPDF() {
    setPdfBusy(true); setPdfError('')
    try {
      const doc = await buildPerformancePdf({
        rows, totals: model.totals, totalMoney, mix, grossTotal,
        period, from: model.from, to: model.to, grain: model.grain,
        currency: cur, closedOnly,
        otherCurrencies: model.currencies.filter(c => c !== cur),
        company,
        generatedBy: `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
          || currentUser?.username || '',
      })
      doc.save(performancePdfName(period, cur, model.to))
    } catch (e) {
      setPdfError(e?.message || 'Could not build the PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6">
      <DataLoadingOverlay
        open={busy}
        title="Building the performance report"
        subtitle="Reading every order the window can reach…"
        steps={[
          { label: 'Loading the order history', done: ordersFullyLoaded },
          { label: 'Totalling by period',       done: false },
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
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={downloadCSV}
              disabled={!hasData}
              className="btn-ghost text-slate-400 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> CSV
            </button>
            <button
              type="button"
              onClick={downloadPDF}
              disabled={!hasData || pdfBusy}
              title="Download this report — the window, currency and scope you are looking at — as a PDF"
              className="btn-primary disabled:opacity-40"
            >
              {pdfBusy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <FileDown className="h-4 w-4" />}
              {pdfBusy ? 'Building…' : 'PDF'}
            </button>
          </div>
        </div>

        {pdfError && (
          <p className="text-xs text-rose-300">Could not build the PDF — {pdfError}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-surface-border pt-3">
          <p className="text-xs text-slate-500">
            <span className="text-slate-300">{dayText(model.from)} – {dayText(model.to)}</span>
            <span className="mx-2 text-slate-600">·</span>
            by {grainWord}
            <span className="mx-2 text-slate-600">·</span>
            {closedOnly ? 'delivered (closed) orders' : 'all orders'}
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={closedOnly}
              onChange={e => setClosedOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-surface-border bg-surface-hover accent-brand-600"
            />
            Delivered only
          </label>

          {model.currencies.length > 1 && (
            <div className="ml-auto flex items-center gap-1">
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
        </div>
      </div>

      {!hasData ? (
        <div className="card flex h-64 flex-col items-center justify-center gap-2 text-center">
          <Boxes className="h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">Nothing to report for {period.label.toLowerCase()}</p>
          <p className="max-w-sm text-xs text-slate-500">
            {closedOnly
              ? 'No orders were closed in this window. Untick “Delivered only” to count open ones too.'
              : 'No orders fall in this window.'}
          </p>
        </div>
      ) : (
        <>
          {/* ── the headline figures ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Tile
              hero icon={Banknote} accent="#3987e5"
              label={`Total revenue · ${cur}`}
              value={fmtAmount(totalMoney.total, cur)}
              sub={totalMoney.discount || totalMoney.vat
                ? `gross ${fmtAmount(grossTotal, cur)} · discount ${fmtAmount(totalMoney.discount, cur)} · VAT ${fmtAmount(totalMoney.vat, cur)}`
                : `across ${model.totals.orderCount.toLocaleString()} orders`}
            />
            <Tile
              icon={HandCoins} accent="#3987e5" label="Delivery fees"
              value={fmtAmount(totalMoney.fees, cur)}
              sub={grossTotal ? `${Math.round((totalMoney.fees / grossTotal) * 100)}% of gross revenue` : null}
            />
            <Tile
              icon={Boxes} accent="#d95926" label={closedOnly ? 'Packages delivered' : 'Packages'}
              value={model.totals.packageCount.toLocaleString()}
              sub={`${cur} ${fmtAmount(totalMoney.packages, cur)} of package value`}
            />
            <Tile
              icon={Package} accent="#3987e5" label={closedOnly ? 'Orders delivered' : 'Orders'}
              value={model.totals.orderCount.toLocaleString()}
              sub={`≈ ${(model.totals.packageCount / Math.max(model.totals.orderCount, 1)).toFixed(1)} packages each`}
            />
            <Tile
              icon={Receipt} accent="#c98500" label="Retail invoices"
              value={model.totals.invoiceCount.toLocaleString()}
              sub={`${cur} ${fmtAmount(totalMoney.externalRetail, cur)} invoiced`}
            />
            <Tile
              icon={Receipt} accent="#199e70" label="Local retail items"
              value={fmtAmount(totalMoney.localRetail, cur)}
              sub={`own-catalogue sales, ${cur}`}
            />
            <Tile
              icon={Wallet} accent="#199e70" label="Collected"
              value={fmtAmount(totalMoney.collected, cur)}
              sub={`${cur} ${fmtAmount(round2(totalMoney.total - totalMoney.collected), cur)} still outstanding`}
            />
          </div>

          {/* ── revenue over time ────────────────────────────────────────── */}
          <ChartCard
            title={`Revenue by ${grainWord} · ${cur}`}
            note="Gross revenue, stacked by what earned it. Discount, VAT and the net total are in the tooltip and the table below."
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rows} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID_LINE} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} tickFormatter={compact} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<MoneyTooltip currency={cur} />} />
                <Legend formatter={legendText} iconType="square" iconSize={9} wrapperStyle={{ paddingTop: 8 }} />
                {activeMoney.map(s => (
                  /* maxBarSize, because a two-day window would otherwise stretch
                     each bar across half the card — a saturated block that reads
                     as a slab rather than a measurement. */
                  <Bar
                    key={s.key} dataKey={s.key} name={s.label} stackId="rev" fill={s.color}
                    stroke={SURFACE} strokeWidth={2} maxBarSize={54}
                    radius={s.key === topKey ? [4, 4, 0, 0] : 0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* ── volume over time ───────────────────────────────────────── */}
            <div className="lg:col-span-2">
              <ChartCard title={`Volume by ${grainWord}`} note="Counts, not money — orders and the packages inside them.">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={rows} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={GRID_LINE} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} allowDecimals={false} />
                    <Tooltip cursor={{ stroke: '#475569', strokeWidth: 1 }} content={<CountTooltip labels={countLabels} />} />
                    <Legend formatter={legendText} iconType="square" iconSize={9} wrapperStyle={{ paddingTop: 8 }} />
                    {COUNT_SERIES.map(s => (
                      <Line
                        key={s.key} type="monotone" dataKey={s.key} name={countLabels[s.key]}
                        stroke={s.color} strokeWidth={2}
                        dot={{ r: 3, fill: s.color, stroke: SURFACE, strokeWidth: 2 }}
                        activeDot={{ r: 5, fill: s.color, stroke: SURFACE, strokeWidth: 2 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── what the money came from ───────────────────────────────── */}
            <ChartCard title="Where the revenue came from" note={`Window total, ${cur}.`}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={mix} layout="vertical" margin={{ top: 0, right: 52, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_LINE} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compact} />
                  <YAxis
                    type="category" dataKey="label" width={124}
                    tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false}
                  />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<MixTooltip currency={cur} />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                    {mix.map(d => <Cell key={d.key} fill={d.color} />)}
                    <LabelList
                      dataKey="value" position="right" offset={8}
                      formatter={compact} style={{ fill: '#cbd5e1', fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* ── the same numbers, readable without colour ──────────────────
              Not a nicety: it is what makes every figure above reachable when
              the hues are not (colour blindness, print, a projector). */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-200">Every figure, by {grainWord}</h2>
              <span className="text-xs text-slate-500">{cur} · {rows.length} {grainWord}s</span>
            </div>
            <div className="overflow-x-auto">
              {/* Fifteen columns of money will not fit a laptop, so the card
                  scrolls sideways rather than squeezing the headers into
                  unreadable stumps. */}
              <table className="w-full min-w-[1240px] text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5 text-left font-semibold">Period</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Orders</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Packages</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Invoices</th>
                    {MONEY_SERIES.map(s => (
                      <th key={s.key} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: s.color }} />
                        {s.label}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-semibold">Net total</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} className="border-b border-surface-border/60 last:border-0 hover:bg-surface-hover/40">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-300">{r.title}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.orderCount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.packageCount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.invoiceCount.toLocaleString()}</td>
                      {MONEY_SERIES.map(s => (
                        <td key={s.key} className={`px-3 py-2 text-right tabular-nums ${r[s.key] ? 'text-slate-300' : 'text-slate-600'}`}>
                          {fmtAmount(r[s.key], cur)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-100">{fmtAmount(r.total, cur)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-300/90">{fmtAmount(r.collected, cur)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface-hover/30 text-slate-100">
                    <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{period.label}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{model.totals.orderCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{model.totals.packageCount.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{model.totals.invoiceCount.toLocaleString()}</td>
                    {MONEY_SERIES.map(s => (
                      <td key={s.key} className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(totalMoney[s.key], cur)}</td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(totalMoney.total, cur)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-300/90">{fmtAmount(totalMoney.collected, cur)}</td>
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
