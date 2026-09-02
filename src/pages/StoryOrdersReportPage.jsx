import React, { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Dot,
} from 'recharts'
import {
  AlertTriangle, CalendarClock, Download, Info, Megaphone, TrendingUp,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { fmtAmount } from '../lib/orderAmounts'
import {
  PERIODS, DEFAULT_PERIOD, periodWindow, buildStoryReport, buildStoryByAdStart, dayText,
} from '../lib/storyOrdersReport'
import DataLoadingOverlay from '../components/ui/DataLoadingOverlay'

/* Story Orders report — advertising sold, over time, per currency.

   Story work is a different business from delivery: sold time rather than
   carried goods, on its own rhythm. So it gets a page rather than a slice of a
   delivery report, and a line — the form for "how is this moving" — rather than
   the bars that answer "how does this month compare".

   Two rules the figures depend on, both stated on screen because a reader would
   otherwise reasonably assume the opposite:

     · Money is read from the order-service line that says it is a story.
       Nothing else on the order counts, and a Story order without such a line
       contributes nothing (the page says how many it saw).

     · The day is the ORDER's day, never the story's own service_date. A story
       entered this month on an order opened last month is last month's money.

   The arithmetic lives in lib/storyOrdersReport — read its header before
   trusting a number. */

const SURFACE   = '#1e293b'
const AXIS_TICK = { fill: '#64748b', fontSize: 11 }
const GRID_LINE = '#2b3a52'
/* The same orange the Closed Orders report gives the Stories stream: a colour
   learned on one page must not mean something else on the next. Validated for
   this dark card surface (contrast 3.3:1). */
const STORY = '#d95926'

/* Axis figures only: 1.2k / 3.4M. Full precision lives in the tooltip and the
   table — an axis is a ruler, not a statement of account. */
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

function StoryTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] text-slate-400">{d.title}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-slate-100">
        {fmtAmount(d.amount, currency)} <span className="text-[11px] font-normal text-slate-500">{currency}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {d.stories.toLocaleString()} story {d.stories === 1 ? 'sale' : 'sales'}
        {d.orders > 0 && ` · ${d.orders.toLocaleString()} order${d.orders === 1 ? '' : 's'}`}
      </p>
    </div>
  )
}

/* A point is drawn only where something was actually sold. A zero week is real
   and the line must pass through it, but marking every empty week with a dot
   turns a quiet stretch into a row of full stops. */
function SoldDot(props) {
  const { cx, cy, payload } = props
  if (!payload?.stories) return null
  return <Dot cx={cx} cy={cy} r={4} fill={STORY} stroke={SURFACE} strokeWidth={2} />
}

/* One currency's line, drawn at the same size and on the same x-axis as its
   neighbours — small multiples.

   Deliberately NOT one chart with a line per currency. 12,000,000 LBP and 50
   USD share no scale: on one axis the dollars flatten onto the floor and read
   as "nothing sold", and a second y-axis for them would invite a comparison
   between two currencies that has no meaning. Separate panels let every
   currency keep its own scale and its own shape, which is the thing actually
   worth comparing.

   Every panel wears the same orange for the same reason: the colour means
   "story sales" here, and the heading carries the currency. */
function CurrencyPanel({ cur, rows, total, stories, grainWord }) {
  const peak = rows.reduce((best, r) => (r.amount > (best?.amount ?? 0) ? r : best), null)
  return (
    <div className="rounded-xl border border-surface-border/70 bg-surface-hover/10 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STORY }} />
          <h3 className="text-sm font-bold tracking-wide text-slate-100">{cur}</h3>
          <span className="text-[11px] text-slate-500">
            {stories.toLocaleString()} {stories === 1 ? 'sale' : 'sales'}
          </span>
        </div>
        <p className="text-sm font-semibold tabular-nums text-slate-100">{fmtAmount(total, cur)}</p>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={rows} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={GRID_LINE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={18} />
          {/* Each panel scales to its OWN currency. Sharing one axis is exactly
              the comparison this layout exists to prevent. */}
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={compact} />
          <Tooltip cursor={{ stroke: GRID_LINE, strokeWidth: 1 }} content={<StoryTooltip currency={cur} />} />
          <Line
            type="monotone"
            dataKey="amount"
            name={`Story sales · ${cur}`}
            stroke={STORY}
            strokeWidth={2}
            dot={<SoldDot />}
            activeDot={{ r: 6, fill: STORY, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {peak?.amount > 0 && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          Best {grainWord}: <span className="text-slate-400">{peak.title}</span>
          <span className="mx-1.5 text-slate-600">·</span>
          <span className="tabular-nums text-slate-400">{fmtAmount(peak.amount, cur)}</span>
        </p>
      )}
    </div>
  )
}

export default function StoryOrdersReportPage() {
  const { orders, ordersError, ordersFullyLoaded, loadFullOrderHistory } = useApp()

  // "Current year" reaches far past the startup window, so pull the lot once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  const [currency,  setCurrency]  = useState('')

  const period = useMemo(() => periodWindow(periodKey), [periodKey])
  const model  = useMemo(() => buildStoryReport({ orders, from: period.from, to: period.to }),
    [orders, period.from, period.to])
  /* The same sales read the other way — filed under ads.start_at, the day the
     advertising goes live, instead of the order's day. Same period chips, same
     closed-Story-order gate. */
  const byAdStart = useMemo(() => buildStoryByAdStart({ orders, from: period.from, to: period.to }),
    [orders, period.from, period.to])

  // Keep the chosen currency valid as the window — and so the currency list — moves.
  useEffect(() => {
    if (model.currencies.length && !model.currencies.includes(currency)) setCurrency(model.currencies[0])
  }, [model.currencies, currency])
  const cur = model.currencies.includes(currency) ? currency : (model.currencies[0] || 'USD')

  const chartRows = useMemo(() => model.series.map(b => {
    const m = b.cur[cur] || { amount: 0, stories: 0, orders: 0 }
    return { key: b.key, label: b.label, title: b.title, amount: m.amount, stories: m.stories, orders: m.orders }
  }), [model, cur])

  const curRows = useMemo(() => model.rows.filter(r => r.cur === cur), [model.rows, cur])
  const hasData = model.storyCount > 0

  /* One row-set per currency for the small multiples, all sharing the window's
     buckets so the panels line up horizontally and can be read across. */
  const adRowsByCur = useMemo(() => {
    const out = {}
    for (const c of byAdStart.currencies) {
      out[c] = byAdStart.series.map(b => {
        const m = b.cur[c] || { amount: 0, stories: 0, orders: 0 }
        return { key: b.key, label: b.label, title: b.title, amount: m.amount, stories: m.stories, orders: m.orders }
      })
    }
    return out
  }, [byAdStart])

  const adGrainWord = byAdStart.grain === 'month' ? 'month' : byAdStart.grain === 'week' ? 'week' : 'day'
  const moneyText = m => Object.entries(m).map(([c, v]) => `${fmtAmount(v, c)} ${c}`).join(' · ')
  const missingAdText = moneyText(byAdStart.missingAdMoney)
  const waitingText   = moneyText(byAdStart.waitingMoney)

  const grainWord = model.grain === 'month' ? 'month' : model.grain === 'week' ? 'week' : 'day'
  const peak = useMemo(() => chartRows.reduce((best, r) => (r.amount > (best?.amount ?? 0) ? r : best), null), [chartRows])

  function downloadCSV() {
    exportCSV(model.rows.map(r => ({
      counted_under:      r.bucketTitle,
      order_day:          r.day,
      order_number:       r.orderNumber,
      customer:           r.customer,
      currency:           r.cur,
      amount:             r.amount,
      story_service_date: r.serviceDate,
      dated_by_order_not_story: r.drifted ? 'yes' : '',
    })), `ideliver-story-orders-${period.key}-${model.to}.csv`)
  }

  const busy = !ordersFullyLoaded && !ordersError

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6">
      <DataLoadingOverlay
        open={busy}
        title="Building the Story orders report"
        subtitle="Reading every Story order the window can reach…"
        steps={[
          { label: 'Loading the order history', done: ordersFullyLoaded },
          { label: 'Totalling story sales by currency', done: false },
        ]}
      />

      {ordersError && !ordersFullyLoaded && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200/90">
            Not every order could be loaded — the totals below are incomplete.
            <span className="ml-1 text-amber-200/60">{ordersError}</span>
          </p>
        </div>
      )}

      {/* The dating rule, said out loud. A reader looking at a story report
          assumes the story's own date; it is the order's, and that difference
          moves money between months. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-400" />
        <p className="text-xs text-sky-100/80">
          Counted by the <span className="font-medium text-sky-100">order’s</span> date, not the story’s.
          <span className="ml-1 text-sky-100/60">
            A story entered this month on an order opened last month is counted under <em>last</em> month, with the order
            it belongs to — an order is one piece of work, so its money is never split across two periods.
            Money is read from the order-service line described as “story”.
          </span>
          {model.serviceDateDrift > 0 && (
            <span className="ml-1 text-sky-100">
              {model.serviceDateDrift} story {model.serviceDateDrift === 1 ? 'sale sits' : 'sales sit'} in a different
              month from its order in this window.
            </span>
          )}
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
            by {grainWord}
            <span className="mx-2 text-slate-600">·</span>
            <span className="text-slate-400">closed Story orders only</span>
            <span className="mx-2 text-slate-600">·</span>
            {model.storyCount.toLocaleString()} story {model.storyCount === 1 ? 'sale' : 'sales'}
          </p>

          <span className="text-[11px] text-slate-500">
            {model.noServiceLine > 0 && (
              <span title="These Story orders are closed but carry no order-service line describing a story, so there is nothing here to count. Add the service line on the order to bring them in.">
                {model.noServiceLine.toLocaleString()} Story order{model.noServiceLine === 1 ? '' : 's'} with no story service line
              </span>
            )}
            {model.noServiceLine > 0 && model.openSkipped > 0 && <span className="mx-2 text-slate-600">·</span>}
            {model.openSkipped > 0 && (
              <span title="Still open, so still able to change. They are counted the day they close.">
                {model.openSkipped.toLocaleString()} still open
              </span>
            )}
          </span>

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
          <Megaphone className="h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">No story sales in {period.label.toLowerCase()}</p>
          <p className="max-w-md text-xs text-slate-500">
            {model.noServiceLine > 0
              ? `${model.noServiceLine} closed Story order${model.noServiceLine === 1 ? '' : 's'} fall in this window but carry no order-service line described as “story”, which is where the money is read from.`
              : model.openSkipped > 0
                ? `${model.openSkipped} Story order${model.openSkipped === 1 ? ' is' : 's are'} still open — they are counted here the day they close.`
                : 'No Story orders were closed in this window. Try a wider one.'}
          </p>
        </div>
      ) : (
        <>
          {/* ── what was sold, one card per currency ───────────────────────── */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {model.currencies.map(c => {
              const m = model.totals[c]
              return (
                <div key={c} className="card p-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: 'rgba(217,89,38,0.12)', border: '1px solid rgba(217,89,38,0.3)' }}>
                      <Megaphone className="h-4 w-4" style={{ color: STORY }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold tracking-wide text-slate-100">{c}</h2>
                      <p className="text-[11px] text-slate-500">
                        {m.stories.toLocaleString()} story {m.stories === 1 ? 'sale' : 'sales'} across{' '}
                        {m.orders.toLocaleString()} order{m.orders === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-xl font-bold tabular-nums text-slate-100">{fmtAmount(m.amount, c)}</p>
                      <p className="text-[11px] text-slate-500">total sold</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── the line: how story sales are moving ───────────────────────── */}
          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-200">
                  Story sales by {grainWord} · {cur}
                  <span className="ml-2 font-normal text-[11px] text-slate-500">dated by the order</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {period.label}, {dayText(model.from)} – {dayText(model.to)}. Quiet periods are kept at zero rather
                  than skipped, so the line never draws over a week nothing was sold.
                </p>
              </div>
              {peak?.amount > 0 && (
                <p className="flex-shrink-0 text-right text-xs text-slate-500">
                  <span className="flex items-center justify-end gap-1.5 text-slate-300">
                    <TrendingUp className="h-3.5 w-3.5" style={{ color: STORY }} />
                    {fmtAmount(peak.amount, cur)}
                  </span>
                  best {grainWord} · {peak.title}
                </p>
              )}
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartRows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={GRID_LINE} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={14} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} tickFormatter={compact} />
                <Tooltip cursor={{ stroke: GRID_LINE, strokeWidth: 1 }} content={<StoryTooltip currency={cur} />} />
                {/* One series, so no legend box — the title names it. */}
                <Line
                  type="monotone"
                  dataKey="amount"
                  name="Story sales"
                  stroke={STORY}
                  strokeWidth={2}
                  dot={<SoldDot />}
                  activeDot={{ r: 6, fill: STORY, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── the same sales, dated by when the advertising runs ─────────── */}
          <div className="card p-5">
            <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-200">
                  Ads running by {adGrainWord} · every currency
                  <span className="ml-2 font-normal text-[11px] text-slate-500">from the ads table</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Every currency at once, one panel each — {period.label.toLowerCase()}.
                </p>
              </div>
              <p className="flex-shrink-0 text-right text-[11px] text-slate-500">
                {byAdStart.adCount.toLocaleString()} confirmed {byAdStart.adCount === 1 ? 'ad' : 'ads'}
                {byAdStart.currencies.length > 0 && (
                  <span className="block text-slate-600">{byAdStart.currencies.join(' · ')}</span>
                )}
              </p>
            </div>

            {/* This chart is dated DIFFERENTLY from everything above it. Said
                beside the chart, not only at the top of the page, because this
                is where the reader is standing when the number surprises them. */}
            <div className="mb-4 mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5">
              <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
              <p className="text-[11px] leading-relaxed text-amber-100/80">
                <span className="font-medium text-amber-100">A different book from the chart above — it will not
                match, and is not meant to.</span> This chart reads the <span className="font-mono text-amber-100/90">ads</span>{' '}
                table on its own terms: the money is <span className="font-mono text-amber-100/90">ads.price</span> and
                the day is <span className="font-mono text-amber-100/90">ads.start_at</span>, so it shows what is
                <em> running</em> and when. The chart above shows what was <em>billed</em> — the story service lines,
                filed under the order’s day. A campaign sold last month to run this month sits in <em>this</em> month
                here and <em>last</em> month above.
                <span className="ml-1 text-amber-100/70">
                  Only confirmed ads count — an unconfirmed one is a plan, not a campaign — and only on closed orders,
                  like everything else on this page.
                </span>
                {byAdStart.movedPeriod > 0 && (
                  <span className="ml-1 text-amber-100">
                    {byAdStart.movedPeriod} {byAdStart.movedPeriod === 1 ? 'ad starts' : 'ads start'} in a different
                    {' '}{adGrainWord} from its order.
                  </span>
                )}
                {byAdStart.zeroPriced > 0 && (
                  <span className="ml-1 text-amber-100/70">
                    {byAdStart.zeroPriced} of them {byAdStart.zeroPriced === 1 ? 'is' : 'are'} priced at zero, so they
                    are counted but add nothing.
                  </span>
                )}
              </p>
            </div>

            {/* The two things this chart is waiting on. Naming them, with their
                money, is the difference between "nothing is running" and
                "the orders holding these ads were never closed". */}
            {(byAdStart.notClosedAds > 0 || byAdStart.ordersMissingAd > 0) && (
              <div className="mb-4 space-y-2">
                {byAdStart.notClosedAds > 0 && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3.5 py-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-400" />
                    <p className="text-[11px] leading-relaxed text-rose-100/80">
                      <span className="font-medium text-rose-100">
                        {byAdStart.notClosedAds.toLocaleString()} confirmed ad
                        {byAdStart.notClosedAds === 1 ? '' : 's'} in this window
                        {byAdStart.notClosedAds === 1 ? ' is' : ' are'} not shown
                      </span>
                      {waitingText && <span className="text-rose-100"> ({waitingText})</span>} — the Story
                      order{byAdStart.notClosedAds === 1 ? '' : 's'} holding them {byAdStart.notClosedAds === 1 ? 'is' : 'are'}{' '}
                      not closed yet, and this page counts closed orders only.
                      <span className="ml-1 text-rose-100/60">
                        Close those orders and they appear here automatically.
                      </span>
                    </p>
                  </div>
                )}
                {byAdStart.ordersMissingAd > 0 && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-slate-500/25 bg-slate-500/5 px-3.5 py-2.5">
                    <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      <span className="font-medium text-slate-300">
                        {byAdStart.ordersMissingAd.toLocaleString()} closed Story order
                        {byAdStart.ordersMissingAd === 1 ? '' : 's'} billed story money with no confirmed ad
                      </span>
                      {missingAdText && <span className="text-slate-300"> ({missingAdText})</span>} — that money is in
                      the chart above but has no campaign here, because no ad row was ever added to those orders.
                    </p>
                  </div>
                )}
              </div>
            )}

            {byAdStart.currencies.length === 0 ? (
              <div className="flex h-[190px] flex-col items-center justify-center gap-2 text-center">
                <Megaphone className="h-7 w-7 text-slate-600" />
                <p className="max-w-md text-xs text-slate-500">
                  No confirmed ad starts inside {period.label.toLowerCase()} on a closed Story order.
                </p>
              </div>
            ) : (
              <div className={`grid grid-cols-1 gap-4 ${byAdStart.currencies.length > 1 ? 'xl:grid-cols-2' : ''}`}>
                {byAdStart.currencies.map(c => (
                  <CurrencyPanel
                    key={c}
                    cur={c}
                    rows={adRowsByCur[c]}
                    total={byAdStart.totals[c].amount}
                    stories={byAdStart.totals[c].stories}
                    grainWord={adGrainWord}
                  />
                ))}
              </div>
            )}

            <p className="mt-3 text-[11px] text-slate-600">
              Each panel keeps its own scale. Currencies are never drawn on one axis — a thousand dollars beside a
              million lira would flatten the dollars onto the floor and read as nothing sold.
            </p>
          </div>

          {/* ── every sale, readable without colour ────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-200">Every story sale</h2>
              <span className="text-xs text-slate-500">
                {cur} · {curRows.length.toLocaleString()} {curRows.length === 1 ? 'sale' : 'sales'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5 text-left font-semibold">Counted under</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Order day</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Order #</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Customer</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Story date</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {curRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                      Nothing in {cur} for this window.
                    </td></tr>
                  ) : curRows.map((r, i) => (
                    <tr key={`${r.orderNumber}-${i}`} className="border-b border-surface-border/60 last:border-0 hover:bg-surface-hover/40">
                      <td className="whitespace-nowrap px-4 py-2 text-slate-300">{r.bucketTitle}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{dayText(r.day)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-400">{r.orderNumber}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-400" title={r.customer}>{r.customer}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {r.serviceDate ? dayText(r.serviceDate) : '—'}
                        {/* The case the notice above describes, marked where it
                            actually happens rather than left as a warning. */}
                        {r.drifted && (
                          <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] text-sky-300"
                            style={{ background: 'rgba(56,189,248,0.12)' }}
                            title="This story's own date falls in a different month from the order it belongs to. It is counted under the order's month.">
                            other month
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-100">
                        {fmtAmount(r.amount, r.cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-surface-border bg-surface-hover/30">
                    <td colSpan={5} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Total · {cur}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-100">
                      {fmtAmount(model.totals[cur]?.amount || 0, cur)}
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
