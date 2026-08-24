import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Plus,
  X,
  Loader,
  AlertCircle,
  Pencil,
  Trash2,
  PackageOpen,
  ArrowDownCircle,
  ArrowUpCircle,
  ShoppingCart,
  Clock,
  Store,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  MOVEMENT_TYPES, fetchMovements, fetchReservations, summarise,
  saveMovement, deleteMovement,
} from '../lib/shopStock'
import SearchField from '../components/ui/SearchField'

const todayISO = () => new Date().toISOString().slice(0, 10)
const emptyMove = (itemId = '') => ({ item_id: itemId, movement_type: 'in', quantity: '', notes: '', moved_at: todayISO() })
const fmtDate = ts => (ts ? new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—')

/* Supplier portal → Inventory.

   A stock monitor over the supplier's own shop items: what is on hand, what
   customers are currently holding in their carts (reserved) and what has sold.
   The supplier records stock in / out movements; 'sold' rows are written by the
   customer app when an order is placed. */
export default function ShopStockPage({ partyContactId = null }) {
  const { currentUser, hasRole } = useAuth()
  const { COMPANY_ID } = useApp()
  const ownerId = partyContactId || currentUser?.contact_id || null
  const canManage = hasRole('supplier', 'admin', 'super_admin')

  const [items,     setItems]     = useState([])
  const [movements, setMovements] = useState([])
  const [holds,     setHolds]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const [expanded,  setExpanded]  = useState(null)   // item id whose ledger is open

  const [modal,   setModal]   = useState(null)       // 'add' | movement row
  const [form,    setForm]    = useState(emptyMove())
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)

  const load = useCallback(async () => {
    if (!ownerId) { setLoading(false); return }
    setLoading(true)
    // `is_made_to_order` arrives with fix114 — fall back without it so the
    // monitor still lists items on a database where that hasn't been run.
    const loadItems = (cols) => supabase
      .from('shop_inventory')
      .select(cols)
      .eq('owner_contact_id', ownerId)
      .order('name')
    const BASE = 'id, name, category, price, currency, is_displayed, is_active'
    let { data: itemRows, error: itemErr } = await loadItems(`${BASE}, is_made_to_order`)
    if (itemErr && /is_made_to_order/i.test(itemErr.message)) {
      ;({ data: itemRows, error: itemErr } = await loadItems(BASE))
    }
    const [{ rows: moves, error: mErr }, { rows: res }] = await Promise.all([
      fetchMovements(ownerId), fetchReservations(ownerId),
    ])
    setItems(itemRows ?? [])
    setMovements(moves)
    setHolds(res)
    const err = itemErr?.message || mErr || ''
    setError(err && /shop_inventory_movements|shop_reservations/i.test(err) && /not exist|schema cache/i.test(err)
      ? 'Stock tracking isn’t installed yet — run supabase-fix113.sql.'
      : err)
    setLoading(false)
  }, [ownerId])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => summarise(movements, holds), [movements, holds])

  const q = search.trim().toLowerCase()
  const shown = items.filter(it => !q || it.name?.toLowerCase().includes(q) || it.category?.toLowerCase().includes(q))

  const grand = useMemo(() => {
    let onHand = 0, reserved = 0, sold = 0
    for (const it of items) {
      const t = totals.get(it.id)
      if (!t) continue
      // Made-to-order items carry no stock, so they don't add to "on hand".
      if (!it.is_made_to_order) onHand += t.onHand
      reserved += t.reserved; sold += t.sold
    }
    return { onHand, reserved, sold }
  }, [items, totals])

  if (!canManage) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Store className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Suppliers only</p>
        <p className="text-slate-500 text-sm">Stock is tracked for the shop items you stock.</p>
      </div>
    )
  }

  function openAdd(itemId = '') { setForm(emptyMove(itemId)); setFormErr(''); setModal('add') }
  function openEdit(m) {
    setForm({
      item_id: m.item_id, movement_type: m.movement_type, quantity: m.quantity ?? '',
      notes: m.notes ?? '', moved_at: (m.moved_at || '').slice(0, 10) || todayISO(),
    })
    setFormErr(''); setModal(m)
  }
  function closeModal() { setModal(null); setForm(emptyMove()); setFormErr('') }

  async function save() {
    setSaving(true); setFormErr('')
    const err = await saveMovement({
      ...form,
      id: modal === 'add' ? null : modal.id,
      owner_contact_id: ownerId,
      moved_at: form.moved_at ? new Date(`${form.moved_at}T12:00:00`).toISOString() : new Date().toISOString(),
    }, { companyId: COMPANY_ID, user: currentUser })
    setSaving(false)
    if (err) {
      setFormErr(/shop_inventory_movements/i.test(err) && /not exist|schema cache/i.test(err)
        ? 'Stock tracking isn’t installed yet — run supabase-fix113.sql.' : err)
      return
    }
    closeModal(); load()
  }

  async function remove(m) {
    setBusyId(m.id)
    const err = await deleteMovement(m.id)
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  const itemName = id => items.find(i => i.id === id)?.name || 'Item'

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-brand-400" />
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="input pl-9"
          />
        </div>
        <button className="btn-primary ml-auto" onClick={() => openAdd()} disabled={items.length === 0}>
          <Plus className="w-4 h-4" /> New movement
        </button>
      </div>

      {/* Totals across the shop */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'On hand',  value: grand.onHand,   cls: 'text-slate-100', Icon: PackageOpen },
          { label: 'Reserved in carts', value: grand.reserved, cls: 'text-amber-300', Icon: Clock },
          { label: 'Sold',     value: grand.sold,     cls: 'text-green-300', Icon: ShoppingCart },
        ].map(c => (
          <div key={c.label} className="card p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5">
              <c.Icon className="w-3.5 h-3.5" /> {c.label}
            </p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${c.cls}`}>{loading ? '…' : c.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* Item stock table — click a row to see its movements */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Item', 'In', 'Out', 'Sold', 'On hand', 'Reserved', 'Available', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                {items.length === 0 ? 'Add items in My Shop first.' : 'No items match your search.'}
              </td></tr>
            ) : shown.flatMap(it => {
              const t = totals.get(it.id) ?? { in: 0, out: 0, sold: 0, onHand: 0, reserved: 0, available: 0 }
              const open = expanded === it.id
              const ledger = movements.filter(m => m.item_id === it.id)
              const rows = [(
                <tr key={it.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                  <td className="px-4 py-3">
                    <button onClick={() => setExpanded(open ? null : it.id)} className="text-left">
                      <span className="text-slate-100 font-medium">{it.name}</span>
                      {it.category && <span className="text-[11px] text-slate-500 ml-2">{it.category}</span>}
                      {it.is_made_to_order && (
                        <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                          on request
                        </span>
                      )}
                      {it.is_displayed === false && <span className="text-[10px] text-slate-600 ml-2">hidden</span>}
                    </button>
                  </td>
                  {it.is_made_to_order ? (
                    /* Prepared on request (fix114): no stock to count — the
                       useful figure is demand, i.e. how many were ordered. */
                    <>
                      <td className="px-4 py-3 text-center text-slate-600" colSpan={2}>
                        <span className="text-[10px] uppercase tracking-wider">Prepared on request</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-green-300">{t.sold || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-600">—</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-300">{t.reserved || '—'}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-slate-500">made to order</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400">{t.in || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-400">{t.out || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-green-300">{t.sold || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-100 font-semibold">{t.onHand}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-300">{t.reserved || '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${t.available < 0 ? 'text-red-300' : 'text-slate-200'}`}>
                        {t.available}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openAdd(it.id)} title="Add a movement for this item"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-brand-300"><Plus className="w-4 h-4" /></button>
                      <button onClick={() => setExpanded(open ? null : it.id)} title="Show movements"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100 text-[11px]">
                        {ledger.length}
                      </button>
                    </div>
                  </td>
                </tr>
              )]
              if (open) {
                rows.push(
                  <tr key={`${it.id}-ledger`} className="bg-surface-hover/20 border-b border-surface-border/50">
                    <td colSpan={8} className="px-4 py-3">
                      {ledger.length === 0 ? (
                        <p className="text-xs text-slate-500">No movements yet for this item.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                              <th className="text-left py-1">Date</th>
                              <th className="text-left py-1">Type</th>
                              <th className="text-right py-1">Qty</th>
                              <th className="text-left py-1 pl-4">Notes</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {ledger.map(m => (
                              <tr key={m.id} className="border-t border-surface-border/40">
                                <td className="py-1.5 text-slate-400 whitespace-nowrap">{fmtDate(m.moved_at)}</td>
                                <td className="py-1.5">
                                  <span className={`inline-flex items-center gap-1 text-[11px] ${
                                    m.movement_type === 'in' ? 'text-teal-300'
                                      : m.movement_type === 'sold' ? 'text-green-300' : 'text-slate-400'}`}>
                                    {m.movement_type === 'in'
                                      ? <ArrowDownCircle className="w-3 h-3" />
                                      : m.movement_type === 'sold'
                                        ? <ShoppingCart className="w-3 h-3" />
                                        : <ArrowUpCircle className="w-3 h-3" />}
                                    {MOVEMENT_TYPES.find(t2 => t2.value === m.movement_type)?.label ?? m.movement_type}
                                  </span>
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-slate-200">{m.quantity}</td>
                                <td className="py-1.5 pl-4 text-slate-500 truncate max-w-[18rem]">{m.notes || '—'}</td>
                                <td className="py-1.5">
                                  <div className="flex items-center justify-end gap-1">
                                    {/* 'sold' rows come from real orders — they aren't hand-edited. */}
                                    {m.movement_type !== 'sold' && (
                                      <button onClick={() => openEdit(m)} title="Edit"
                                        className="btn-ghost p-1 text-slate-500 hover:text-slate-200"><Pencil className="w-3.5 h-3.5" /></button>
                                    )}
                                    <button onClick={() => remove(m)} disabled={busyId === m.id} title="Delete"
                                      className="btn-ghost p-1 text-slate-500 hover:text-red-400 disabled:opacity-40">
                                      {busyId === m.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )
              }
              return rows
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        On hand = stock in − stock out − sold. Reserved is what customers currently hold in their carts;
        it becomes “sold” when their order is placed. Available = on hand − reserved.
        Items marked <span className="text-amber-300">prepared on request</span> (food and the like) hold no stock —
        they show how many have been ordered instead, and customers can always order them.
      </p>

      {/* ── Movement form ─────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-md flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">
                {modal === 'add' ? 'New stock movement' : `Edit movement — ${itemName(form.item_id)}`}
              </h3>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Item *</label>
                <select className="input" value={form.item_id}
                  onChange={e => { setForm(f => ({ ...f, item_id: e.target.value })); setFormErr('') }}>
                  <option value="">— Select an item —</option>
                  {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Movement *</label>
                  <select className="input" value={form.movement_type}
                    onChange={e => setForm(f => ({ ...f, movement_type: e.target.value }))}>
                    {MOVEMENT_TYPES.filter(t => t.value !== 'sold').map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Quantity *</label>
                  <input type="number" min="0" step="1" className="input" value={form.quantity}
                    onChange={e => { setForm(f => ({ ...f, quantity: e.target.value })); setFormErr('') }} placeholder="0" />
                </div>
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={form.moved_at}
                  onChange={e => setForm(f => ({ ...f, moved_at: e.target.value }))} />
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={form.notes} placeholder="e.g. delivery from supplier, damaged goods…"
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              {formErr && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{formErr}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={closeModal} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
