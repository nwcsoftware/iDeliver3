import React from 'react'

export default function StatCard({ icon: Icon, label, value, sub, color = 'brand' }) {
  const colorMap = {
    brand:  'bg-brand-500/15  text-brand-400',
    green:  'bg-green-500/15  text-green-400',
    yellow: 'bg-yellow-500/15 text-yellow-400',
    red:    'bg-red-500/15    text-red-400',
    slate:  'bg-slate-500/15  text-slate-400',
  }
  const cls = colorMap[color] ?? colorMap.brand

  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cls}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-slate-100 mt-0.5">{value}</p>
        {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
