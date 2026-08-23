import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  AlertCircle,
  Loader,
  Plus,
  X,
  History,
  TrendingDown,
  Package,
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
  Calendar,
  Coins,
  Filter,
} from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  MOVEMENT_TYPES, movementLabel, fetchProductMovements, summarise, stockValue,
  isLow, saveProductMovement, deleteProductMovement, isMissingLedger,
} from '../lib/productStock'
import SearchField from '../components/ui/SearchField'

const num = n => Number(n) || 0
const fmtQty = n => Number(num(n).toFixed(2)).toLocaleString()
const fmtMoney = (v, c) => `${num(v).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`
const fmtWhen = ts => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const bagText = (bag) => {
  const parts = Object.entries(bag || {}).filter(([, v]) => num(v) !== 0).map(([c, v]) => fmtMoney(v, c))
  return parts.length ? parts.join('  +  ') : '—'
}

const TONE = {
  in:       'bg-green-500/10 text-green-300 border-green-500/30',
  returned: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
  sold:     'bg-brand-500/10 text-brand-300 border-brand-500/30',
  out:      'bg-amber-500/10 text-amber-300 border-amber-500/30',
  adjust:   'bg-slate-500/10 text-slate-300 border-slate-500/30',
}

const emptyMove = (product) => ({
  product_id: product?.id || '',
  movement_type: 'in',
  quantity: '',
  unit_cost: product?.unit_cost ?? '',
  currency: product?.currency || 'USD',
  reference: '',
  notes: '',
  moved_at: '',
})

/* Inventory for 3asari3's own catalog (fix126).

   The office had a price list but no stock: `products` said what we sell and at
   what price, never how many are held. This page adds the missing half — what
   is on hand, what is running low, what it is worth, and the movement history
   behind every figure.

   Suppliers keep their own stock in shop_inventory; this covers the house
   catalog only, which is what the call centre is asked about. */
export default function ProductInventoryPage() {
  const { hasRole, currentUser } = useAuth()
  const { COMPANY_ID } = useApp()
  const canPost = hasRole('super_admin', 'admin', 'call_center')
  const isSuperAdmin = hasRole('super_admin')

  const [products,  setProducts]  = useState([])
  const [movements, setMovements] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const [onlyLow,   setOnlyLow]   = useState(false)
  const [history,   setHistory]   = useState(null)   // product whose ledger is open
  const [moveFor,   setMoveFor]   = useState(null)   // product being moved
  const [draft,     setDraft]     = useState(emptyMove())
  const [saving,    setSaving]    = useState(false)
  const [formErr,   setFormErr]   = useState('')
  const [busyId,    setBusyId]    = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Only stocked kinds: a service or an advertisement has nothing to count.
    const { data, error: pe } = await fetchAllRows(() => {
      let q = supabase.from('products')
        .select('id, code, name, unit_price, unit_cost, currency, unit_of_measure, is_active, is_service, is_advertisement, reorder_level, reorder_quantity, category:product_categories(name)')
        .eq('is_service', false)
        .eq('is_advertisement', false)
        .order('name')
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    })
    if (pe) { setError(pe.message); setLoading(false); return }

    const { rows, error: me } = await fetchProductMovements(COMPANY_ID)
    setProducts(data ?? [])
    setMovements(rows)
    setError(isMissingLedger(me)
      ? 'Product stock isn’t installed yet — run supabase-fix126.sql in Supabase. The catalog is listed below with no quantities.'
      : (me || ''))
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { load() }, [load])

  const byId = useMemo(() => summarise(movements), [movements])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .map(p => ({ ...p, stock: byId.get(p.id) || { onHand: 0, in: 0, out: 0, sold: 0, returned: 0, moves: 0, lastMovedAt: null } }))
      .filter(p => {
        if (onlyLow && !isLow(p, p.stock.onHand)) return false
        if (!q) return true
        return [p.name, p.code, p.category?.name].some(v => String(v ?? '').toLowerCase().includes(q))
      })
  }, [products, byId, search, onlyLow])

  const totals = useMemo(() => {
    const lowCount = products.filter(p => isLow(p, byId.get(p.id)?.onHand || 0)).length
    const outCount = products.filter(p => (byId.get(p.id)?.onHand || 0) <= 0).length
    const units = products.reduce((s, p) => s + num(byId.get(p.id)?.onHand), 0)
    return { lowCount, outCount, units, value: stockValue(products, byId) }
  }, [products, byId])

  const productMoves = useMemo(
    () => (history ? movements.filter(m => m.product_id === history.id) : []),
    [movements, history])

  function openMove(product, type = 'in') {
    setDraft({ ...emptyMove(product), movement_type: type })
    setFormErr('')
    setMoveFor(product)
  }

  async function postMovement() {
    if (!num(draft.quantity)) { setFormErr('Enter a quantity.'); return }
    if (draft.movement_type !== 'adjust' && num(draft.quantity) < 0) {
      setFormErr('Only an adjustment may be negative — use Stock out to take goods away.'); return
    }
    setSaving(true); setFormErr('')
    const err = await saveProductMovement(draft, {
      companyId: COMPANY_ID,
      userId: currentUser?.user_id ?? null,
      userName: `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || '',
    })
    setSaving(false)
    if (err) { setFormErr(err); return }
    setMoveFor(null); load()
  }

  async function removeMovement(m) {
    setBusyId(m.id)
    const err = await deleteProductMovement(m.id)
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">Inventory</h2>
          <span className="text-[11px] text-slate-500">3asari3 products</span>
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search product, code or category…"
            className="input pl-9"
          />
        </div>
        <button onClick={() => setOnlyLow(v => !v)}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border transition-colors ${
            onlyLow ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'border-surface-border text-slate-400 hover:bg-surface-hover'}`}>
          <Filter className="w-3.5 h-3.5" /> Low stock only
          {totals.lowCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-200">{totals.lowCount}</span>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* Headline figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Products stocked
          </p>
          <p className="mt-1.5 text-sm font-semibold text-slate-100 tabular-nums">{products.length}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5" /> Units on hand
          </p>
          <p className="mt-1.5 text-sm font-semibold text-slate-100 tabular-nums">{fmtQty(totals.units)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" /> Low / out of stock
          </p>
          <p className="mt-1.5 text-sm font-semibold text-amber-300 tabular-nums">
            {totals.lowCount} <span className="text-slate-500 font-normal">low</span>
            <span className="text-slate-600"> · </span>
            <span className="text-red-300">{totals.outCount}</span> <span className="text-slate-500 font-normal">out</span>
          </p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5" /> Stock value at cost
          </p>
          <p className="mt-1.5 text-sm font-semibold text-slate-100 tabular-nums">{bagText(totals.value)}</p>
        </div>
      </div>

      {/* The stock sheet */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-surface-border">
                {['Code', 'Product', 'Category', 'On hand', 'In', 'Out', 'Sold', 'Reorder at', 'Last movement', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-slate-500 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500 text-xs">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500 text-xs">
                  {onlyLow ? 'Nothing is below its reorder level.' : 'No products found.'}
                </td></tr>
              ) : rows.map(p => {
                const low  = isLow(p, p.stock.onHand)
                const zero = p.stock.onHand <= 0
                return (
                  <tr key={p.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/30 ${p.is_active === false ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400 whitespace-nowrap">{p.code || '—'}</td>
                    <td className="px-3 py-2 text-slate-100">{p.name}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{p.category?.name || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 tabular-nums font-semibold ${
                        zero ? 'text-red-300' : low ? 'text-amber-300' : 'text-slate-100'}`}>
                        {fmtQty(p.stock.onHand)}
                        <span className="text-[10px] font-normal text-slate-500">{p.unit_of_measure || ''}</span>
                      </span>
                      {zero && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/30">out</span>}
                      {!zero && low && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">low</span>}
                    </td>
                    <td className="px-3 py-2 text-green-300/80 tabular-nums text-xs">{fmtQty(p.stock.in + p.stock.returned)}</td>
                    <td className="px-3 py-2 text-amber-300/80 tabular-nums text-xs">{fmtQty(p.stock.out)}</td>
                    <td className="px-3 py-2 text-brand-300/80 tabular-nums text-xs">{fmtQty(p.stock.sold)}</td>
                    <td className="px-3 py-2 text-slate-400 tabular-nums text-xs">{num(p.reorder_level) || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">{fmtWhen(p.stock.lastMovedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setHistory(p)} title="Movement history"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><History className="w-4 h-4" /></button>
                        {canPost && (
                          <>
                            <button onClick={() => openMove(p, 'in')} title="Stock in"
                              className="btn-ghost p-1.5 text-green-400 hover:text-green-300"><ArrowDownRight className="w-4 h-4" /></button>
                            <button onClick={() => openMove(p, 'out')} title="Stock out"
                              className="btn-ghost p-1.5 text-amber-400 hover:text-amber-300"><ArrowUpRight className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Movement history for one product ─────────────────────── */}
      {history && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4"
          onClick={() => setHistory(null)}>
          <div className="card w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border">
              <History className="w-4 h-4 text-brand-300" />
              <span className="text-sm font-medium text-slate-100">{history.name}</span>
              <span className="font-mono text-[11px] text-slate-500">{history.code}</span>
              <span className="ml-auto text-xs text-slate-400 tabular-nums">
                On hand <b className="text-slate-100">{fmtQty(byId.get(history.id)?.onHand || 0)}</b>
              </span>
              {canPost && (
                <button onClick={() => { setHistory(null); openMove(history, 'in') }}
                  className="btn-primary ml-2 py-1.5 text-xs"><Plus className="w-3.5 h-3.5" /> Movement</button>
              )}
              <button onClick={() => setHistory(null)} className="btn-ghost p-1.5 text-slate-500 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border sticky top-0 bg-surface-card">
                    {['When', 'Type', 'Qty', 'Reference', 'By', 'Notes', ...(isSuperAdmin ? [''] : [])].map((h, i) => (
                      <th key={i} className="text-left px-4 py-2 text-slate-500 text-[11px] font-medium uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productMoves.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500 text-xs">
                      Nothing recorded for this product yet.
                    </td></tr>
                  ) : productMoves.map(m => (
                    <tr key={m.id} className="border-b border-surface-border/40 hover:bg-surface-hover/30">
                      <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{fmtWhen(m.moved_at)}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE[m.movement_type] || TONE.adjust}`}>
                          {movementLabel(m.movement_type)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-100 tabular-nums text-xs">{fmtQty(m.quantity)}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{m.reference || '—'}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">{m.created_by_name || '—'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs max-w-[16rem] truncate">{m.notes || ''}</td>
                      {isSuperAdmin && (
                        <td className="px-4 py-2">
                          <button onClick={() => removeMovement(m)} disabled={busyId === m.id}
                            title="Delete this movement (correcting by posting the opposite is usually better)"
                            className="btn-ghost p-1.5 text-slate-500 hover:text-red-400 disabled:opacity-40">
                            {busyId === m.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Record a movement ────────────────────────────────────── */}
      {moveFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[75] p-4">
          <div className="card w-full max-w-md flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-100 truncate">{moveFor.name}</h3>
                <p className="text-[11px] text-slate-500">
                  On hand {fmtQty(byId.get(moveFor.id)?.onHand || 0)} {moveFor.unit_of_measure || ''}
                </p>
              </div>
              <button onClick={() => setMoveFor(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="label">Movement</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {MOVEMENT_TYPES.map(t => (
                    <button key={t.value} type="button"
                      onClick={() => setDraft(d => ({ ...d, movement_type: t.value }))}
                      className={`px-2.5 py-2 rounded-lg text-xs font-medium border text-left transition-colors ${
                        draft.movement_type === t.value
                          ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                          : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {MOVEMENT_TYPES.find(t => t.value === draft.movement_type)?.hint}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Quantity *</label>
                  <input type="number" step="0.01" className="input" autoFocus value={draft.quantity}
                    onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Unit cost</label>
                  <input type="number" min="0" step="0.01" className="input" value={draft.unit_cost ?? ''}
                    onChange={e => setDraft(d => ({ ...d, unit_cost: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Reference</label>
                  <input className="input" placeholder="Invoice, order, count sheet…" value={draft.reference}
                    onChange={e => setDraft(d => ({ ...d, reference: e.target.value }))} />
                </div>
                <div>
                  <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> Date</label>
                  <input type="datetime-local" className="input" value={draft.moved_at ? draft.moved_at.slice(0, 16) : ''}
                    onChange={e => setDraft(d => ({ ...d, moved_at: e.target.value ? new Date(e.target.value).toISOString() : '' }))} />
                  <p className="text-[11px] text-slate-500 mt-1">Empty = now.</p>
                </div>
              </div>

              <div>
                <label className="label">Notes</label>
                <input className="input" value={draft.notes}
                  onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
              </div>

              {formErr && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{formErr}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={() => setMoveFor(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={postMovement} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
