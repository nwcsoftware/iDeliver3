import React, { useState, useEffect, useCallback } from 'react'
import { Store, AlertCircle, CreditCard, Percent, ShoppingCart, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

/* Month-end settlement per shop (supermarket / warehouse), sourced from the
   v_supplier_settlements view: what we purchased, the commission we earned on
   procurement orders, what we paid, and the balance we still owe a credit shop. */

const CURRENCIES = ['USD', 'LBP', 'EUR']
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }
function fmtMoney(v, c) {
  const n = Number(v) || 0
  return `${c} ${n.toLocaleString(undefined, {
    minimumFractionDigits: c === 'LBP' ? 0 : 2,
    maximumFractionDigits: c === 'LBP' ? 0 : 2,
  })}`
}
function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export default function SupplierSettlementsPage() {
  const { COMPANY_ID, loadFullOrderHistory } = useApp()
  // The startup fetch only covers the last few days; this page reads
  // further back, so it asks for the full history once.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])
  const [month,   setMonth]   = useState(thisMonth)
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    let q = supabase.from('v_supplier_settlements').select('*').eq('month', `${month}-01`)
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error: e } = await q
    if (e) setError(e.message)
    else   setRows(data ?? [])
    setLoading(false)
  }, [month, COMPANY_ID])

  useEffect(() => { fetchData() }, [fetchData])

  // Group the (shop, currency) rows into one entry per shop.
  const bySupplier = {}
  for (const r of rows) {
    const s = (bySupplier[r.supplier_id] ||= {
      id: r.supplier_id, name: r.supplier_name || '—', code: r.supplier_code,
      credit: r.is_credit_shop, cur: {},
    })
    const cur = (s.cur[r.currency] ||= { purchases: 0, commission: 0, paid: 0, unpaid: 0 })
    cur.purchases  += Number(r.purchases_total)  || 0
    cur.commission += Number(r.commission_total) || 0
    cur.paid       += Number(r.paid_total)       || 0
    cur.unpaid     += Number(r.unpaid_total)     || 0
  }
  const list = Object.values(bySupplier).sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  // Render a shop's per-currency amount for one field.
  const curField = (cur, key) => {
    const parts = CURRENCIES.filter(c => cur[c] && round2(cur[c][key]) !== 0).map(c => fmtMoney(cur[c][key], c))
    return parts.length ? parts.join(' · ') : <span className="text-slate-600">—</span>
  }

  // Grand totals per currency (for the summary bar).
  const totals = Object.fromEntries(CURRENCIES.map(c => [c, { purchases: 0, commission: 0, unpaid: 0 }]))
  for (const s of list) for (const c of CURRENCIES) {
    if (!s.cur[c]) continue
    totals[c].purchases  += s.cur[c].purchases
    totals[c].commission += s.cur[c].commission
    totals[c].unpaid     += s.cur[c].unpaid
  }
  const totalLine = (key) => {
    const parts = CURRENCIES.filter(c => round2(totals[c][key]) !== 0).map(c => fmtMoney(totals[c][key], c))
    return parts.length ? parts.join(' · ') : '—'
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5 text-brand-400" />
          <div>
            <p className="text-xs text-slate-500 mt-0.5">{monthLabel(month)} · {list.length} shop{list.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-slate-500">Month</label>
          <input type="month" className="input w-44" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5"><ShoppingCart className="w-3.5 h-3.5" /> Purchases</p>
          <p className="text-lg font-bold text-slate-100 mt-1">{totalLine('purchases')}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5"><Percent className="w-3.5 h-3.5 text-green-400" /> Commission earned</p>
          <p className="text-lg font-bold text-green-300 mt-1">{totalLine('commission')}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-amber-400" /> Owed to shops</p>
          <p className="text-lg font-bold text-amber-300 mt-1">{totalLine('unpaid')}</p>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Shop', 'Purchases', 'Commission earned', 'Paid', 'Owed'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No shop invoices for {monthLabel(month)}</td></tr>
            ) : list.map(s => (
              <tr key={s.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-slate-100 font-medium flex items-center gap-1.5">
                    {s.name}
                    {s.credit && <CreditCard className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" title="Credit shop — settled at month-end" />}
                  </p>
                  {s.code && <p className="text-slate-500 text-xs font-mono">{s.code}</p>}
                </td>
                <td className="px-4 py-3 text-slate-300">{curField(s.cur, 'purchases')}</td>
                <td className="px-4 py-3 text-green-300 font-medium">{curField(s.cur, 'commission')}</td>
                <td className="px-4 py-3 text-slate-400">{curField(s.cur, 'paid')}</td>
                <td className="px-4 py-3 text-amber-300 font-medium">{curField(s.cur, 'unpaid')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-600">
        Commission is recorded only on orders marked “we purchased these goods”, using each shop’s Commission % from its contact. “Owed” is the sum of unpaid shop invoices for the month (what you settle with credit shops).
      </p>
    </div>
  )
}
