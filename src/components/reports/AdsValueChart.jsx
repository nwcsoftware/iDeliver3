import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Megaphone, Loader2, AlertTriangle } from 'lucide-react'
import { supabase, fetchAllRows } from '../../lib/supabase'

/* What the advertising was worth, over the same window the rest of the page is
   showing.
 *
 * DATED BY WHEN THE ADVERT RUNS, not by the order that sold it. An advert
 * booked in March for a campaign starting in June is June's advertising — the
 * order is only the paperwork, and several of these were typed up weeks after
 * the fact. So the day an ad counts under is `ads.start_at`, and nothing else.
 * (The Cashier Box dates the same advert by the day it was PAID for, because
 * that is when the money moved. Three different questions, three honest
 * answers, and each page says which one it is giving.)
 *
 * CURRENCIES ARE NEVER ADDED TOGETHER. There is no exchange rate anywhere in
 * this application. "All" therefore draws one bar per currency SIDE BY SIDE,
 * never stacked, and each gets its own axis — because LBP 16,000,000 and USD 3
 * on one scale would draw the USD as nothing at all, and putting them on one
 * scale would be claiming a comparison the data cannot make. The shapes over
 * time are what "All" is for: when the LBP work ran against when the USD work
 * did. The heights are not comparable between currencies and the chart says so.
 */

/* One family, so the chart reads as one subject. Ordered by how much of the
   window each currency carries, brightest first. */
const BAR_FAMILY = ['#d946ef', '#f0abfc', '#a21caf', '#c084fc']
const barColour = i => BAR_FAMILY[i % BAR_FAMILY.length]

const ALL = '__all__'

const fmtMoney = (v, c) => `${c} ${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })}`

function compact(n) {
  const v = Number(n) || 0, a = Math.abs(v)
  const cut = (u, s) => `${(v / u).toFixed(a / u >= 10 ? 0 : 1).replace(/\.0$/, '')}${s}`
  if (a >= 1e6) return cut(1e6, 'M')
  if (a >= 1e3) return cut(1e3, 'k')
  return String(Math.round(v))
}

const pad = n => String(n).padStart(2, '0')
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/* Every day (or month) in the window, including the empty ones. A gap is
   information; a chart that silently skips quiet days makes them look busy. */
function buckets(from, to) {
  const a = new Date(`${from}T12:00:00`), b = new Date(`${to}T12:00:00`)
  const days = Math.round((b - a) / 86400000) + 1
  const byMonth = days > 70
  const out = []
  if (byMonth) {
    const d = new Date(a.getFullYear(), a.getMonth(), 1)
    while (d <= b) { out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); d.setMonth(d.getMonth() + 1) }
  } else {
    const d = new Date(a)
    while (d <= b) { out.push(dayKey(d)); d.setDate(d.getDate() + 1) }
  }
  return { keys: out, byMonth }
}

function Tip({ active, payload, label, drawn = [] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  if (!d.count) return null
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] text-slate-400">{label}</p>
      {/* One line per currency, never a sum of them. */}
      {drawn.filter(c => d.per?.[c]).map((c, i) => (
        <p key={c} className="text-xs mt-0.5 tabular-nums" style={{ color: barColour(i) }}>
          {fmtMoney(d.per[c], c)}
        </p>
      ))}
      <p className="text-[11px] text-slate-500">{d.count} advert{d.count === 1 ? '' : 's'} starting</p>
      {d.names?.length > 0 && (
        <p className="text-[10px] text-slate-500 mt-0.5">{d.names.slice(0, 3).join(', ')}{d.names.length > 3 ? '…' : ''}</p>
      )}
    </div>
  )
}

export default function AdsValueChart({ from, to, closedOnly = true, companyId = null }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [cur,     setCur]     = useState(ALL)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: e } = await fetchAllRows(() => {
      let q = supabase.from('ads')
        .select('id, price, currency, start_at, customer_name, order_number, '
          + 'order:delivery_orders(id, isclosed, status)')
        // The window is applied to the AD's own start, which is the whole point.
        .gte('start_at', `${from}T00:00:00`)
        .lte('start_at', `${to}T23:59:59.999`)
        .order('id')
      if (companyId) q = q.eq('company_id', companyId)
      return q
    })
    if (e) { setError(e.message); setRows([]); setLoading(false); return }
    setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [from, to, companyId])

  useEffect(() => { load() }, [load])

  /* Cancelled orders never happened, so their adverts never ran. `closedOnly`
     follows the page's own toggle, so this chart covers exactly the orders the
     table above it covers. */
  const live = useMemo(() => rows.filter(a => {
    const o = a.order
    if (!o) return false
    if (['cancelled', 'failed'].includes(String(o.status || '').toLowerCase())) return false
    return closedOnly ? o.isclosed === true : true
  }), [rows, closedOnly])

  const byCur = useMemo(() => {
    const t = {}
    for (const a of live) t[a.currency || 'USD'] = (t[a.currency || 'USD'] || 0) + (Number(a.price) || 0)
    return t
  }, [live])

  const currencies = useMemo(
    () => Object.keys(byCur).filter(c => byCur[c] > 0).sort((a, b) => byCur[b] - byCur[a]),
    [byCur])

  /* Follow the data: when the chosen currency stops carrying value, fall back
     to All rather than drawing an empty chart. */
  const showAll  = cur === ALL && currencies.length > 1
  const shownCur = showAll ? null : (cur && currencies.includes(cur) ? cur : (currencies[0] || null))
  // The currencies actually drawn, in the order their colours are assigned.
  const drawn    = showAll ? currencies : (shownCur ? [shownCur] : [])

  const series = useMemo(() => {
    const { keys, byMonth } = buckets(from, to)
    const blank = () => {
      const o = { count: 0, names: [], per: {} }
      for (const c of drawn) o[c] = 0
      return o
    }
    const bag = new Map(keys.map(k => [k, { key: k, ...blank() }]))
    for (const a of live) {
      const c = a.currency || 'USD'
      if (!drawn.includes(c)) continue
      const iso = String(a.start_at || '')
      const k = byMonth ? iso.slice(0, 7) : iso.slice(0, 10)
      const slot = bag.get(k)
      if (!slot) continue
      const amt = Number(a.price) || 0
      slot[c] = (slot[c] || 0) + amt
      slot.per[c] = (slot.per[c] || 0) + amt
      slot.count += 1
      if (a.customer_name) slot.names.push(a.customer_name)
    }
    return [...bag.values()].map(s => ({
      ...s,
      label: byMonth ? s.key.slice(2) : s.key.slice(5),
    }))
  }, [live, from, to, drawn.join('|')])

  const free    = live.filter(a => !(Number(a.price) > 0)).length

  if (loading) {
    return (
      <div className="card p-5 flex items-center justify-center gap-2 text-xs text-slate-500 py-10">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading adverts…
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Megaphone className="w-4 h-4 text-fuchsia-400" />
        <h2 className="text-sm font-semibold text-slate-200">Advertising sold</h2>
        <span className="text-xs text-slate-500">
          {live.length} advert{live.length === 1 ? '' : 's'}
          {free > 0 && ` · ${free} with no price`}
        </span>
        {currencies.length > 1 && (
          <div className="flex items-center gap-1 ml-auto">
            <button type="button" onClick={() => setCur(ALL)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                showAll
                  ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40'
                  : 'border-surface-border text-slate-500 hover:text-slate-200'}`}>
              All
            </button>
            {currencies.map((c, i) => (
              <button key={c} type="button" onClick={() => setCur(c)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all inline-flex items-center gap-1.5 ${
                  shownCur === c
                    ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40'
                    : 'border-surface-border text-slate-500 hover:text-slate-200'}`}>
                <span className="w-2 h-2 rounded-sm" style={{ background: barColour(i) }} />
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 mt-0.5 mb-3">
        Dated by the day each advert is scheduled to START, not by the order that sold it — an advert booked in
        one month for a campaign running in another belongs to the month it runs.
      </p>

      {error ? (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{error}</span>
        </div>
      ) : live.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">
          No advert starts in this window{closedOnly ? ' on a closed order' : ''}.
        </p>
      ) : (
        <>
          {/* Side by side, never added: two figures, not one total. */}
          <div className="flex items-baseline gap-4 mb-3 flex-wrap">
            {drawn.map((c, i) => (
              <span key={c} className="text-lg font-semibold tabular-nums" style={{ color: barColour(i) }}>
                {fmtMoney(byCur[c], c)}
              </span>
            ))}
            {currencies.filter(c => !drawn.includes(c)).map(c => (
              <span key={c} className="text-xs text-slate-500 tabular-nums">{fmtMoney(byCur[c], c)}</span>
            ))}
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#2b3a52" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} tickMargin={6} interval="preserveStartEnd" />
                {/* An axis per currency, up to two. LBP 16,000,000 and USD 3 on
                    one scale would draw the USD as nothing, and sharing a scale
                    would imply a comparison no exchange rate here can make. */}
                {drawn.map((c, i) => (
                  <YAxis key={c} yAxisId={i === 1 ? 'right' : 'left'}
                    orientation={i === 1 ? 'right' : 'left'}
                    hide={i > 1}
                    tick={{ fill: barColour(i), fontSize: 10 }} tickFormatter={compact} width={52} />
                ))}
                <Tooltip content={<Tip drawn={drawn} />} cursor={{ fill: 'rgba(217,70,239,0.08)' }} />
                {drawn.map((c, i) => (
                  <Bar key={c} dataKey={c} name={c} yAxisId={i === 1 ? 'right' : 'left'}
                    fill={barColour(i)} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">
            Empty days are shown as empty rather than skipped. Adverts on cancelled orders are left out.
            {free > 0 && ` ${free} advert${free === 1 ? ' carries' : 's carry'} no price and add nothing to the total.`}
            {showAll
              ? ' Each currency is drawn on its own scale and its own axis, so heights are comparable within a currency but never between them — there is no exchange rate in this application.'
              : currencies.length > 1 && ' Currencies are never summed together.'}
          </p>
        </>
      )}
    </div>
  )
}
