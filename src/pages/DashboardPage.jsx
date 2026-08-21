import React from 'react'
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

const PIE_COLORS = ['#6366f1', '#22c55e', '#eab308', '#ef4444', '#f97316', '#94a3b8']

function buildTrend(orders) {
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push({
      name:      d.toLocaleDateString('en', { weekday: 'short' }),
      date:      d.toISOString().slice(0, 10),
      delivered: 0,
      failed:    0,
    })
  }
  orders.forEach(o => {
    const date = o.scheduled_date?.slice(0, 10) || o.delivered_at?.slice(0, 10) || o.created_at?.slice(0, 10)
    const day  = days.find(d => d.date === date)
    if (!day) return
    if (o.status === 'delivered') day.delivered++
    else if (o.status === 'failed') day.failed++
  })
  return days
}

export default function DashboardPage() {
  const { stats, orders, drivers } = useApp()

  const trend   = buildTrend(orders)
  const pieData = [
    { name: 'In Transit', value: stats.inTransit },
    { name: 'Delivered',  value: stats.delivered },
    { name: 'Pending',    value: stats.pendingOrders },
    { name: 'Failed',     value: stats.failed },
    { name: 'Cancelled',  value: stats.cancelled },
  ].filter(d => d.value > 0)

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
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Delivery Trend (Last 7 Days)</h2>
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
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
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
