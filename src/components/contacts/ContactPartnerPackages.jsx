import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Package, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchOrdersByIds } from '../../lib/packageOrders'
import { useApp } from '../../context/AppContext'

/* Read-only list of every delivery package this partner has provided, joined to
   the order it shipped on. Shows price, order number and the delivery reception
   (recipient) name, with per-currency totals at the foot.

   "Delivered" = the package rides on a closed order (same rule the Partner Dues
   page uses). A toggle reveals still-open orders too. */

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function fmtMoney(value, currency) {
  const n = Number(value) || 0
  return `${currency} ${n.toLocaleString(undefined, {
    minimumFractionDigits: currency === 'LBP' ? 0 : 2,
    maximumFractionDigits: currency === 'LBP' ? 0 : 2,
  })}`
}

export default function ContactPartnerPackages({ contactId }) {
  const { COMPANY_ID } = useApp()
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [onlyDelivered, setOnlyDelivered] = useState(true)

  const fetchPackages = useCallback(async () => {
    if (!contactId) { setRows([]); setLoading(false); return }
    setLoading(true); setError('')
    // Two-step load + client-side join: PostgREST can't embed
    // delivery_packages → orders, so orders are resolved separately by id.
    let q = supabase
      .from('delivery_packages')
      .select('id, order_id, tracking_number, package_price, currency, paid, quantity, description')
      .eq('provider_id', contactId)
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error: err } = await q
    if (err) { setError(err.message); setRows([]); setLoading(false); return }

    let orderMap
    try {
      orderMap = await fetchOrdersByIds([...new Set((data ?? []).map(p => p.order_id).filter(Boolean))])
    } catch (e) { setError(e.message); setRows([]); setLoading(false); return }

    const joined = (data ?? []).map(p => ({ ...p, order: orderMap.get(p.order_id) || null }))
    // Sort newest first by the order's close/scheduled date.
    joined.sort((a, b) => {
      const da = a.order?.closed_at || a.order?.scheduled_date || ''
      const db = b.order?.closed_at || b.order?.scheduled_date || ''
      return String(db).localeCompare(String(da))
    })
    setRows(joined); setLoading(false)
  }, [contactId, COMPANY_ID])

  useEffect(() => { fetchPackages() }, [fetchPackages])

  const visible = useMemo(
    () => rows.filter(r => !onlyDelivered || r.order?.isclosed),
    [rows, onlyDelivered],
  )

  // Per-currency totals across the visible rows: delivered value, the part paid
  // directly to the partner, and the remaining balance we still owe (delivered −
  // paid). Kept per currency since packages can carry different currencies.
  const totals = useMemo(() => {
    const t = {}
    for (const r of visible) {
      const cur = r.currency || r.order?.currency || 'USD'
      const amt = round2(r.package_price)
      const b = t[cur] || (t[cur] = { delivered: 0, paid: 0, balance: 0 })
      b.delivered = round2(b.delivered + amt)
      if (r.paid) b.paid = round2(b.paid + amt)
    }
    for (const cur of Object.keys(t)) t[cur].balance = round2(t[cur].delivered - t[cur].paid)
    return t
  }, [visible])
  const totalCurs = CURRENCIES.filter(c => totals[c])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Delivered Packages
        </p>
        <button type="button" onClick={() => setOnlyDelivered(o => !o)} aria-pressed={onlyDelivered}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
            onlyDelivered ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                          : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
          {onlyDelivered ? 'Delivered only' : 'All orders'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{error}</span>
        </div>
      )}

      <div className="border border-surface-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[24%]" />
            <col className="w-[31%]" />
            <col className="w-[8%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-surface-hover/40">
              <th className="px-3 py-2 font-medium">Order #</th>
              <th className="px-3 py-2 font-medium">Reception</th>
              <th className="px-3 py-2 font-medium">Package</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Price</th>
              <th className="px-3 py-2 font-medium text-center">Paid</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                {onlyDelivered ? 'No delivered packages yet.' : 'No packages from this partner yet.'}
              </td></tr>
            ) : visible.map(r => {
              const cur = r.currency || r.order?.currency || 'USD'
              return (
                <tr key={r.id} className="border-t border-surface-border/40 hover:bg-surface-hover/30 align-top">
                  <td className="px-3 py-2 font-mono text-slate-300 whitespace-nowrap">
                    {r.order?.order_number ?? '—'}
                    {!r.order?.isclosed && <span className="ml-1.5 text-[9px] text-amber-400/80">open</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-300 break-words">{r.order?.recipient_name || '—'}</td>
                  <td className="px-3 py-2 text-slate-400 break-words">
                    <div className="text-slate-300">{r.tracking_number || '—'}</div>
                    {r.description && <div className="text-[10px] text-slate-500">{r.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{r.quantity ?? 1}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtMoney(r.package_price, cur)}</td>
                  <td className="px-3 py-2 text-center">
                    {r.paid
                      ? <span className="text-[10px] text-green-400">paid direct</span>
                      : <span className="text-[10px] text-slate-600">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {totalCurs.length > 0 && (
            <tfoot>
              {[
                { key: 'delivered', label: `Total${visible.length ? ` · ${visible.length} pkg${visible.length === 1 ? '' : 's'}` : ''}`, cls: 'text-slate-200', border: 'border-t border-surface-border' },
                { key: 'paid',      label: 'Total paid directly', cls: 'text-green-300',  border: 'border-t border-surface-border/40' },
                { key: 'balance',   label: 'Balance due',         cls: 'text-amber-300',  border: 'border-t border-surface-border/40' },
              ].map(row => (
                <tr key={row.key} className={`${row.border} bg-surface-hover/30`}>
                  <td colSpan={4} className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    {row.label}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {totalCurs.map(c => (
                      <div key={c} className={`tabular-nums font-semibold whitespace-nowrap ${row.cls}`}>{fmtMoney(totals[c][row.key], c)}</div>
                    ))}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
