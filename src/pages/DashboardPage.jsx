import React, { useState, useEffect, useMemo } from 'react'
import { OrderNumber } from '../components/orders/OrderQuickView'
import { Package, Users, Truck, CheckCircle } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { useApp } from '../context/AppContext'
import { formatMobile } from '../lib/phone'
import StatCard from '../components/ui/StatCard'
import Badge from '../components/ui/Badge'

/* The status breakdown speaks the same four-step vocabulary as the Deliveries
   list — Scheduled → In Progress → Completed, plus the two ways an order ends
   without arriving — rather than the raw enum, which spread one lifecycle over
   half a dozen names. Each slice keeps a fixed colour so the same status is the
   same colour every visit, however many slices happen to be non-empty. */
const STATUS_SLICES = [
  { key: 'scheduled',  name: 'Scheduled',   color: '#eab308' },
  { key: 'inProgress', name: 'In Progress', color: '#6366f1' },
  { key: 'completed',  name: 'Completed',   color: '#22c55e' },
  { key: 'failed',     name: 'Failed',      color: '#ef4444' },
  { key: 'cancelled',  name: 'Cancelled',   color: '#94a3b8' },
]

/* Raw order_status → the lifecycle step shown on the charts. Mirrors
   normalizeStatus on the Deliveries page. */
function lifecycleStep(status) {
  const s = String(status ?? '').trim().toLowerCase()
  if (s === 'cancelled') return 'cancelled'
  if (s === 'failed')    return 'failed'
  if (['delivered', 'returned', 'completed'].includes(s))                        return 'completed'
  if (['assigned', 'picked_up', 'in_transit', 'return_requested'].includes(s))   return 'inProgress'
  return 'scheduled'   // pending, confirmed, scheduled, or anything unknown
}

/* The day an order belongs to: when it was meant to happen, else when it did,
   else when it was raised. */
const orderDay = o =>
  o.scheduled_date?.slice(0, 10) || o.delivered_at?.slice(0, 10) || o.created_at?.slice(0, 10)

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/* The last seven days, or every day of a month.
 *
 * `compareMonth` adds a second delivered line from another month of the same
 * year, aligned by DAY OF THE MONTH — the 3rd against the 3rd — which is the
 * only alignment that lets two months of different lengths be read together.
 * Months are of different lengths, so the shorter one simply stops; its line
 * ends rather than being stretched to fit, because a 30-day month has no 31st
 * and pretending otherwise would invent a day.
 */
function buildTrend(orders, { mode = '7d', month = null, compareMonth = null, year = new Date().getFullYear() } = {}) {
  const buckets = []
  const byDate = new Map()

  if (mode === '7d') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const row = { name: d.toLocaleDateString('en', { weekday: 'short' }), date: ymd(d),
        delivered: 0, failed: 0, cancelled: 0 }
      buckets.push(row); byDate.set(row.date, row)
    }
  } else {
    const m = month ?? new Date().getMonth()
    const last = new Date(year, m + 1, 0).getDate()
    for (let day = 1; day <= last; day++) {
      const row = { name: String(day), date: ymd(new Date(year, m, day)),
        delivered: 0, failed: 0, cancelled: 0 }
      buckets.push(row); byDate.set(row.date, row)
    }
  }

  // The comparison month, indexed by day number so it can sit beside the main one.
  const compare = new Map()
  if (mode === 'month' && compareMonth != null) {
    const last = new Date(year, compareMonth + 1, 0).getDate()
    for (let day = 1; day <= last; day++) compare.set(ymd(new Date(year, compareMonth, day)), day)
  }

  for (const o of orders) {
    const date = orderDay(o)
    if (!date) continue
    const step = lifecycleStep(o.status)

    const row = byDate.get(date)
    if (row) {
      if (step === 'completed')      row.delivered++
      else if (step === 'failed')    row.failed++
      else if (step === 'cancelled') row.cancelled++
    }
    const dayNo = compare.get(date)
    if (dayNo && step === 'completed') {
      const slot = buckets[dayNo - 1]
      if (slot) slot.compared = (slot.compared || 0) + 1
    }
  }

  // A day the comparison month does not have stays undefined rather than zero,
  // so its line ends there instead of dropping to the floor.
  if (compare.size) {
    for (const b of buckets) if (b.compared == null && compare.size >= Number(b.name)) b.compared = 0
  }
  return buckets
}

export default function DashboardPage() {
  /* `orders` is the live set — cancelled orders are held apart deliberately
     (see lib/orderStatus.js). The dashboard is one of the few screens allowed to
     show them, and it counts them as their own category rather than folding them
     into any figure: the stat cards, the Recent Orders table and every other page
     stay live-only. */
  const { stats, orders, cancelledOrders, drivers, loadFullOrderHistory, ordersFullyLoaded } = useApp()

  const [trendMode, setTrendMode] = useState('7d')      // '7d' | 'month'
  const [compareMonth, setCompareMonth] = useState('')  // '' | '0'..'11', same year
  const thisYear  = new Date().getFullYear()
  const thisMonth = new Date().getMonth()

  /* The shared order load only reaches back a few days (ordersWindowDays), which
     is enough for seven days and nowhere near enough for a month — let alone a
     month earlier in the year. Asking for a month therefore asks for the whole
     history first, the same way the financial pages do. Seven days costs
     nothing extra. */
  useEffect(() => {
    if (trendMode === 'month' || compareMonth !== '') loadFullOrderHistory?.()
  }, [trendMode, compareMonth, loadFullOrderHistory])

  const trend = useMemo(
    () => buildTrend([...orders, ...cancelledOrders], {
      mode: trendMode,
      month: thisMonth,
      compareMonth: compareMonth === '' ? null : Number(compareMonth),
      year: thisYear,
    }),
    [orders, cancelledOrders, trendMode, compareMonth, thisMonth, thisYear])

  const loadingMonth = trendMode === 'month' && !ordersFullyLoaded

  const counts = { scheduled: 0, inProgress: 0, completed: 0, failed: 0, cancelled: 0 }
  for (const o of orders) counts[lifecycleStep(o.status)]++
  counts.cancelled = cancelledOrders.length

  const pieData = STATUS_SLICES
    .map(slice => ({ ...slice, value: counts[slice.key] }))
    .filter(d => d.value > 0)

  const recentOrders = orders.slice(0, 6)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users}       label="Total Drivers"   value={stats.totalDrivers}  sub={`${stats.activeDrivers} available/on duty`} color="brand"  />
        <StatCard icon={Package}     label="Total Orders"    value={stats.totalOrders}   sub="all time"                                    color="slate"  />
        <StatCard icon={Truck}       label="In Transit"      value={stats.inTransit}     sub="currently active"                            color="brand"  />
        <StatCard icon={CheckCircle} label="Delivered"       value={stats.delivered}     sub="completed successfully"                      color="green"  />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend chart */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <h2 className="text-sm font-semibold text-slate-200">
              Delivery Trend {trendMode === '7d' ? '(Last 7 Days)' : `(${MONTH_NAMES[thisMonth]} ${thisYear})`}
            </h2>

            <div className="flex items-center gap-1 ml-auto">
              {[['7d', 'Last 7 days'], ['month', 'This month']].map(([k, label]) => (
                <button key={k} type="button"
                  onClick={() => { setTrendMode(k); if (k === '7d') setCompareMonth('') }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    trendMode === k ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                                    : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Compare against another month of the same year. Only offered on
                the month view: seven days and a whole month have no common
                x-axis, so there is nothing to lay one over the other. */}
            {trendMode === 'month' && (
              <select className="input py-1 text-[11px] w-auto" value={compareMonth}
                onChange={e => setCompareMonth(e.target.value)}>
                <option value="">Compare with…</option>
                {MONTH_NAMES.map((m, i) => i === thisMonth ? null : (
                  <option key={m} value={i}>{m} {thisYear}</option>
                ))}
              </select>
            )}

            {loadingMonth && <span className="text-[11px] text-slate-500">loading the year…</span>}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="deliveredGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cancelledGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#f1f5f9' }}
              />
              <Area type="monotone" dataKey="delivered" stroke="#6366f1" fill="url(#deliveredGrad)" strokeWidth={2} name="Delivered" />
              <Area type="monotone" dataKey="failed"    stroke="#ef4444" fill="url(#failedGrad)"    strokeWidth={2} name="Failed"    />
              <Area type="monotone" dataKey="cancelled" stroke="#94a3b8" fill="url(#cancelledGrad)" strokeWidth={2} name="Cancelled" />
              {/* The month being compared against: delivered only, drawn as a
                  dashed line with no fill so it reads as a reference behind this
                  month rather than a fourth thing that happened. */}
              {trendMode === 'month' && compareMonth !== '' && (
                <Area type="monotone" dataKey="compared" stroke="#f59e0b" fill="none"
                  strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false}
                  name={`${MONTH_NAMES[Number(compareMonth)]} delivered`} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Status pie */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Status Breakdown</h2>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                  {pieData.map(d => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  itemStyle={{ color: '#f1f5f9' }}
                />
                <Legend formatter={v => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">No order data yet</div>
          )}
        </div>
      </div>

      {/* Recent orders */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Recent Orders</h2>
          <span className="text-xs text-slate-500">{orders.length} total</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Order #', 'Recipient', 'Driver', 'Destination', 'Status', 'Payment'].map(h => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentOrders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">No orders yet</td>
              </tr>
            ) : recentOrders.map(o => (
              <tr key={o.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-5 py-3 text-xs"><OrderNumber value={o.order_number} id={o.id} className="text-xs" /></td>
                <td className="px-5 py-3">
                  <p className="text-slate-200">{o.recipient_name}</p>
                  <p className="text-slate-500 text-xs">{formatMobile(o.recipient_mobile)}</p>
                </td>
                <td className="px-5 py-3 text-slate-400">
                  {o.driver ? `${o.driver.first_name} ${o.driver.last_name}` : <span className="text-slate-600">Unassigned</span>}
                </td>
                <td className="px-5 py-3 text-slate-400 max-w-[160px] truncate">{o.delivery_address}</td>
                <td className="px-5 py-3"><Badge status={o.status} /></td>
                <td className="px-5 py-3"><Badge status={o.payment_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
