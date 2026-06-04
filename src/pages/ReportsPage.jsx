import React, { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Download } from 'lucide-react'
import { useApp } from '../context/AppContext'

const COLORS = ['#22c55e', '#ef4444', '#eab308', '#6366f1', '#f97316', '#94a3b8']

function exportCSV(rows, filename) {
  if (!rows.length) return
  const headers = Object.keys(rows[0]).join(',')
  const body    = rows.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(',')).join('\n')
  const blob    = new Blob([headers + '\n' + body], { type: 'text/csv' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const tooltipStyle = {
  contentStyle: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8 },
  labelStyle:   { color: '#94a3b8' },
  itemStyle:    { color: '#f1f5f9' },
}

export default function ReportsPage() {
  const { orders, drivers } = useApp()
  const [range, setRange]   = useState(30)

  const now   = new Date()
  const since = new Date(now.getTime() - range * 24 * 60 * 60 * 1000)
  const inRange = orders.filter(o => new Date(o.created_at) >= since)

  // Daily bar chart data
  const dailyCounts = useMemo(() => {
    const map = {}
    for (let i = range - 1; i >= 0; i--) {
      const d   = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      map[key]  = { date: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), delivered: 0, failed: 0, pending: 0, in_transit: 0 }
    }
    inRange.forEach(o => {
      const key = o.created_at?.slice(0, 10)
      if (!map[key]) return
      const s = o.status
      if (s === 'delivered') map[key].delivered++
      else if (s === 'failed' || s === 'cancelled') map[key].failed++
      else if (s === 'in_transit' || s === 'picked_up') map[key].in_transit++
      else map[key].pending++
    })
    return Object.values(map)
  }, [inRange, range])

  // Per-driver stats
  const driverStats = useMemo(() => {
    return drivers
      .map(dr => {
        const driverOrders = inRange.filter(o => o.driver_id === dr.id)
        return {
          name:      `${dr.first_name} ${dr.last_name}`,
          total:     driverOrders.length,
          delivered: driverOrders.filter(o => o.status === 'delivered').length,
          failed:    driverOrders.filter(o => o.status === 'failed').length,
        }
      })
      .filter(d => d.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [inRange, drivers])

  // Payment status breakdown
  const paymentBreakdown = useMemo(() => {
    const counts = {}
    inRange.forEach(o => { counts[o.payment_status] = (counts[o.payment_status] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
  }, [inRange])

  // Order status breakdown
  const statusBreakdown = useMemo(() => {
    const counts = {}
    inRange.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
  }, [inRange])

  const delivered   = inRange.filter(o => o.status === 'delivered').length
  const failed      = inRange.filter(o => o.status === 'failed').length
  const successRate = inRange.length ? Math.round((delivered / inRange.length) * 100) : 0
  const totalRevenue = inRange.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Toolbar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                range === d ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
              }`}
            >
              Last {d}d
            </button>
          ))}
        </div>
        <button
          className="btn-ghost ml-auto text-slate-400"
          onClick={() => exportCSV(inRange.map(o => ({
            order_number:    o.order_number,
            recipient:       o.recipient_name,
            mobile:          o.recipient_mobile,
            driver:          o.driver ? `${o.driver.first_name} ${o.driver.last_name}` : '',
            status:          o.status,
            payment_status:  o.payment_status,
            total_amount:    o.total_amount,
            currency:        o.currency,
            delivery_address: o.delivery_address,
            created_at:      o.created_at,
          })), `ideliver-report-${range}d.csv`)}
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Orders',  value: inRange.length,          cls: 'text-slate-100'  },
          { label: 'Delivered',     value: delivered,               cls: 'text-green-400'  },
          { label: 'Failed',        value: failed,                  cls: 'text-red-400'    },
          { label: 'Success Rate',  value: `${successRate}%`,       cls: 'text-brand-400'  },
        ].map(kpi => (
          <div key={kpi.label} className="card p-5">
            <p className="text-slate-500 text-xs uppercase tracking-wider">{kpi.label}</p>
            <p className={`text-3xl font-bold mt-1 ${kpi.cls}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Daily volume */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Daily Order Volume</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyCounts} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip {...tooltipStyle} />
            <Legend formatter={v => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v}</span>} />
            <Bar dataKey="delivered"  name="Delivered"   fill="#22c55e" radius={[4,4,0,0]} />
            <Bar dataKey="in_transit" name="In Transit"  fill="#6366f1" radius={[4,4,0,0]} />
            <Bar dataKey="failed"     name="Failed/Cancel" fill="#ef4444" radius={[4,4,0,0]} />
            <Bar dataKey="pending"    name="Pending"     fill="#eab308" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Driver performance */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Driver Performance</h2>
          {driverStats.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={driverStats} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={120} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="delivered" name="Delivered" fill="#6366f1" radius={[0,4,4,0]} />
                <Bar dataKey="failed"    name="Failed"    fill="#ef4444" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-500 text-sm">No driver data</div>
          )}
        </div>

        {/* Payment status */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Payment Status</h2>
          {paymentBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={paymentBreakdown}
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {paymentBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend formatter={v => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-500 text-sm">No data</div>
          )}
        </div>
      </div>
    </div>
  )
}
