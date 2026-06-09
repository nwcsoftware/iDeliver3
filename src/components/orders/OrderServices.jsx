import React, { useEffect, useRef } from 'react'
import { Plus, Trash2, Check, AlertCircle } from 'lucide-react'

const CURRENCIES = ['USD', 'LBP', 'EUR']

export const EMPTY_SERVICE = {
  service_date: '',
  service_description: '',
  service_reference: '',
  quantity: 1,
  service_fees: '',
  service_fees_currency: 'USD',
}

/**
 * Order services sub-form. The parent owns the array and persists it on save.
 *
 * Props:
 *   services     - array of service objects
 *   setServices  - state setter
 *   onAdd        - optional parent-owned "Add Service" handler
 */
export default function OrderServices({ services, setServices, embedded = false, onAdd }) {
  const referenceRefs = useRef({})
  const prevLen = useRef(services.length)

  useEffect(() => {
    if (services.length > prevLen.current) {
      const last = services[services.length - 1]
      const rk = last?._id ?? last?._key
      if (rk != null) referenceRefs.current[rk]?.focus()
    }
    prevLen.current = services.length
  }, [services])

  const add = onAdd || (() => setServices(s => [...s, { ...EMPTY_SERVICE, _key: Date.now() }]))
  function remove(i) { setServices(s => s.filter((_, idx) => idx !== i)) }
  function update(i, k, v) {
    setServices(s => { const n = [...s]; n[i] = { ...n[i], [k]: v }; return n })
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-3">
      {!embedded && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Order Services</h3>
          <button type="button" onClick={add} className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
            <Plus className="w-3 h-3" /> Add Service
          </button>
        </div>
      )}

      {services.length === 0 ? (
        <p className="text-xs text-slate-600 border border-dashed border-surface-border rounded-lg px-3 py-4 text-center">
          No services yet — click "Add Service".
        </p>
      ) : (
        <div className="border border-surface-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                <th className="text-left px-3 py-2 w-36">Date</th>
                <th className="text-left px-3 py-2">Reference</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-center px-2 py-2 w-20">Qty</th>
                <th className="text-right px-3 py-2 w-24">Fees</th>
                <th className="text-center px-2 py-2 w-20">Currency</th>
                <th className="text-right px-2 py-2 w-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s, i) => (
                <tr key={s._id ?? s._key ?? i} className="border-t border-surface-border/50 hover:bg-surface-hover/20 transition-colors">
                  <td className="px-3 py-2">
                    <input type="date" className="input text-xs" value={s.service_date || today}
                      onChange={e => update(i, 'service_date', e.target.value)} max={today} />
                  </td>
                  <td className="px-3 py-2">
                    <input className="input text-xs font-mono" placeholder="REF-001"
                      value={s.service_reference || ''}
                      onChange={e => update(i, 'service_reference', e.target.value)}
                      ref={el => { referenceRefs.current[s._id ?? s._key ?? i] = el }} />
                  </td>
                  <td className="px-3 py-2">
                    <input className="input text-xs" placeholder="Service description"
                      value={s.service_description || ''}
                      onChange={e => update(i, 'service_description', e.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" className="input text-xs text-center px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" min="1" value={s.quantity || 1}
                      onChange={e => update(i, 'quantity', Math.max(1, parseInt(e.target.value) || 1))} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" className="input text-xs text-right" step="0.01" min="0" 
                      placeholder="0.00" value={s.service_fees || ''}
                      onChange={e => update(i, 'service_fees', e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input text-xs text-center" value={s.service_fees_currency || 'USD'}
                      onChange={e => update(i, 'service_fees_currency', e.target.value)}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(i)} className="btn-ghost p-1 text-slate-500 hover:text-red-400" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
