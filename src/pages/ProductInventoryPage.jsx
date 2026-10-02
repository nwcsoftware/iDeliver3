import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  Lock,
  Calendar,
  Coins,
  Filter,
  RefreshCcw,
  ClipboardCheck,
  Pencil,
} from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import ProductMonthlySales from '../components/products/ProductMonthlySales'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  MOVEMENT_TYPES, movementLabel, fetchProductMovements, summarise, stockValue,
  isLow, saveProductMovement, deleteProductMovement, isMissingLedger,
  movementDeleteRight, isRefillable, handMovementTypes, stockFigures,
  updateProductMovement, movementFollowsOrder, isFutureMoment,
} from '../lib/productStock'
import { isStrictAdmin, canEditProducts, canManageEmpties, canRefillEmpties } from '../lib/roles'
import SearchField from '../components/ui/SearchField'
import { useTableSort, SortTh } from '../components/ui/SortableTable'

const num = n => Number(n) || 0
const fmtQty = n => Number(num(n).toFixed(2)).toLocaleString()
const fmtMoney = (v, c) => `${num(v).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`
const fmtWhen = ts => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')
/* A stored moment as a date-and-time field shows it: in LOCAL time. Slicing
   the ISO string showed UTC instead — a time picked as 10:00 came back as
   07:00 in Beirut, and an edited movement opened three hours off. */
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const bagText = (bag) => {
  const parts = Object.entries(bag || {}).filter(([, v]) => num(v) !== 0).map(([c, v]) => fmtMoney(v, c))
  return parts.length ? parts.join('  +  ') : '—'
}

/* What each stock column means, on hover — "On hand" changes meaning for a
   refillable, and the header is where somebody looks when a number surprises. */
const COLUMN_HINT = {
  'On hand':  'Everything owned. For a returnable (shisha, gas, water) that includes what customers hold — it changes only with stock in, stock out and adjustments, never with a sale or a return.',
  Available:  'On the shelf and ready to go out now. A sale takes it, a return brings it back. Low and out are judged on this.',
  Empty:     'Back from customers, waiting to be refilled.',
  'With customers': 'Returnables out with customers and not back yet: On hand − Available − Empty.',
}

function StockFlag({ zero, low }) {
  if (zero) return <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/30">out</span>
  if (low)  return <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">low</span>
  return null
}

const TONE = {
  in:       'bg-green-500/10 text-green-300 border-green-500/30',
  returned: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
  sold:     'bg-brand-500/10 text-brand-300 border-brand-500/30',
  out:      'bg-amber-500/10 text-amber-300 border-amber-500/30',
  adjust:   'bg-slate-500/10 text-slate-300 border-slate-500/30',
  returned_empty: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  refill:         'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  empty_adjust:   'bg-slate-500/10 text-cyan-200 border-cyan-500/20',
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

/* The empties form: refill some, or correct the count. A count is entered as
   the number COUNTED, not a signed difference — "there are 15 empties in the
   back" is what somebody actually knows, and the arithmetic is ours to do. */
const newEmptiesDraft = (mode = 'refill') => ({
  mode, quantity: '', counted: '', unit_cost: '', reference: '', notes: '', moved_at: '',
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
  // Refilling and counting empties: administrators only (lib/roles).
  const canEmpties = canManageEmpties(currentUser?.role)    // correct the empty count: administrators
  const canRefill  = canRefillEmpties(currentUser?.role)    // refill: administrators and Senior Call Center
  /* Deleting a movement: an administrator may remove a hand-typed one, a super
     admin may remove any, and a Senior Call Center user may remove none. The
     column itself only appears for somebody who could delete something. */
  const isSuperAdmin  = hasRole('super_admin')
  const strictAdmin   = isStrictAdmin(currentUser?.role)
  const canDeleteAny  = isSuperAdmin || strictAdmin
  const navigate = useNavigate()
  // The product form itself decides what this user may change (lib/roles);
  // here it only names the click honestly.
  const canEditProduct = canEditProducts(currentUser?.role)

  const [products,  setProducts]  = useState([])
  const [movements, setMovements] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const [onlyLow,   setOnlyLow]   = useState(false)
  const [history,   setHistory]   = useState(null)   // product whose ledger is open
  const [moveFor,   setMoveFor]   = useState(null)   // product being moved
  const [editMove,  setEditMove]  = useState(null)   // the movement being edited (super admin), or null for a new one
  const [draft,     setDraft]     = useState(emptyMove())
  const [saving,    setSaving]    = useState(false)
  const [formErr,   setFormErr]   = useState('')
  const [busyId,    setBusyId]    = useState(null)
  const [moveTypeFilter, setMoveTypeFilter] = useState('')   // '' = every kind
  const [emptyFor,   setEmptyFor]   = useState(null)   // refillable whose empties are open
  /* Returnables still out according to their ORDERS — closed, not failed, not
     marked returned. Set beside the stock ledger's own figure: a difference is
     a sale or a return that never reached the ledger (an order closed, or an
     item marked returned, by a screen that did not post stock). */
  const [ordersOut, setOrdersOut] = useState(() => new Map())
  const [emptyDraft, setEmptyDraft] = useState(newEmptiesDraft())

  const load = useCallback(async () => {
    setLoading(true)
    // Only stocked kinds: a service or an advertisement has nothing to count.
    const { data, error: pe } = await fetchAllRows(() => {
      let q = supabase.from('products')
        // Every column: is_refillable arrives with fix166, and naming it
        // would fail the whole read on a database without it.
        .select('*, category:product_categories(name)')
        .eq('is_service', false)
        .eq('is_advertisement', false)
        .order('name')
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    })
    if (pe) { setError(pe.message); setLoading(false); return }

    const { rows, error: me } = await fetchProductMovements(COMPANY_ID)

    const retIds = (data ?? []).filter(p => p.is_returnable).map(p => p.id)
    const out = new Map()
    if (retIds.length) {
      const { data: lines } = await fetchAllRows(() => supabase.from('order_items')
        .select('id, product_id, quantity, is_returned, order:delivery_orders(isclosed, status)')
        .in('product_id', retIds).eq('is_deleted', false).order('id'))
      for (const l of lines ?? []) {
        const o = l.order
        if (!o?.isclosed || ['cancelled', 'failed'].includes(o.status) || l.is_returned) continue
        out.set(l.product_id, (out.get(l.product_id) || 0) + num(l.quantity))
      }
    }
    setOrdersOut(out)
    setProducts(data ?? [])
    setMovements(rows)
    setError(isMissingLedger(me)
      ? 'Product stock isn’t installed yet — run supabase-fix126.sql in Supabase. The catalog is listed below with no quantities.'
      : (me || ''))
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { load() }, [load])

  const byId = useMemo(() => summarise(movements), [movements])

  /* Where an adjustment starts from and where it would land — read live off
     the ledger for the product being moved, so the guidance below the field is
     this shelf's arithmetic rather than a worked example about somebody else's. */
  const adjustFrom = moveFor ? (byId.get(moveFor.id)?.onHand || 0) : 0
  const adjustTo   = Math.round((adjustFrom + num(draft.quantity)) * 100) / 100

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .map(p => {
        const stock = byId.get(p.id) || { onHand: 0, empty: 0, in: 0, out: 0, sold: 0, returned: 0, refill: 0, adjust: 0, empty_adjust: 0, returned_empty: 0, moves: 0, lastMovedAt: null }
        return { ...p, stock, fig: stockFigures(p, stock) }
      })
      .filter(p => {
        if (onlyLow && !isLow(p, p.stock.onHand)) return false
        if (!q) return true
        return [p.name, p.code, p.category?.name].some(v => String(v ?? '').toLowerCase().includes(q))
      })
  }, [products, byId, search, onlyLow])

  /* What each column sorts BY: the number the cell shows, not its text, so 9
     sorts before 10. A product with no empties or no reorder level has a blank,
     and blanks sink to the bottom whichever way the column is sorted. */
  const sortValue = useCallback((p, key) => {
    const refill = isRefillable(p)
    switch (key) {
      case 'code':      return (p.code || '').toLowerCase()
      case 'product':   return (p.name || '').toLowerCase()
      case 'category':  return p.category?.name ? p.category.name.toLowerCase() : null
      case 'onHand':    return p.fig.onHand
      case 'available': return p.fig.available
      case 'empty':     return refill ? p.fig.empty : null
      case 'withCustomers': return p.fig.asset ? p.fig.withCustomers : null
      case 'in':        return p.stock.in + p.stock.returned + p.stock.refill
      case 'out':       return p.stock.out
      case 'sold':      return p.stock.sold
      case 'reorder':   return num(p.reorder_level) || null
      case 'last':      return p.stock.lastMovedAt || null
      default:          return null
    }
  }, [])
  const { sort, cycle, sortRows } = useTableSort(sortValue)
  const shown = useMemo(() => sortRows(rows), [sortRows, rows])

  const totals = useMemo(() => {
    const lowCount = products.filter(p => isLow(p, byId.get(p.id)?.onHand || 0)).length
    const outCount = products.filter(p => (byId.get(p.id)?.onHand || 0) <= 0).length
    const empties = products.filter(isRefillable).reduce((s, p) => s + num(byId.get(p.id)?.empty), 0)
    // Same as the On hand column: what is owned, a returnable at a customer's too.
    const units = products.reduce((s, p) => s + num(stockFigures(p, byId.get(p.id)).onHand), 0)
    return { lowCount, outCount, units, empties, value: stockValue(products, byId) }
  }, [products, byId])

  /* Every movement for the product whose ledger is open, and the filtered view
     of it. Both are needed: the chips count from the whole list, the table
     shows the chosen kind. */
  const allProductMoves = useMemo(
    () => (history ? movements.filter(m => m.product_id === history.id) : []),
    [movements, history])
  const productMoves = useMemo(
    () => (moveTypeFilter ? allProductMoves.filter(m => m.movement_type === moveTypeFilter) : allProductMoves),
    [allProductMoves, moveTypeFilter])

  function openMove(product, type = 'in') {
    setDraft({ ...emptyMove(product), movement_type: type })
    setFormErr('')
    setEditMove(null)
    setMoveTypeFilter('')      // a fresh ledger shows everything
    setMoveFor(product)
  }

  /* The super admin opens a movement from its history in the same form, filled
     in. The history stays open underneath, to come back to. */
  function openEditMove(m) {
    if (!isSuperAdmin || !history) return
    setDraft({
      product_id: m.product_id, movement_type: m.movement_type, quantity: String(m.quantity ?? ''),
      unit_cost: m.unit_cost ?? '', currency: m.currency || history.currency || 'USD',
      reference: m.reference || '', notes: m.notes || '', moved_at: m.moved_at || '',
    })
    setFormErr('')
    setEditMove(m)
    setMoveFor(history)
  }
  const closeMoveForm = () => { setMoveFor(null); setEditMove(null) }

  async function postMovement() {
    if (!num(draft.quantity)) { setFormErr('Enter a quantity.'); return }
    if (!['adjust', 'empty_adjust'].includes(draft.movement_type) && num(draft.quantity) < 0) {
      setFormErr('Only an adjustment may be negative — use Stock out to take goods away, '
        + 'or switch to Adjustment if you are correcting a count.'); return
    }
    if (isFutureMoment(draft.moved_at)) {
      setFormErr(`That date is in the future (${fmtWhen(draft.moved_at)}). Enter when it actually happened.`); return
    }
    setSaving(true); setFormErr('')
    const userName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || ''
    const err = editMove
      ? (isSuperAdmin ? await updateProductMovement(editMove, draft, { userName }) : 'Only the super admin can edit a movement.')
      : await saveProductMovement(draft, { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null, userName })
    setSaving(false)
    if (err) { setFormErr(err); return }
    closeMoveForm(); load()
  }

  /* ── empties: refill some, or correct the count ── */
  const emptyNow  = emptyFor ? (byId.get(emptyFor.id)?.empty  || 0) : 0
  const filledNow = emptyFor ? (byId.get(emptyFor.id)?.onHand || 0) : 0
  const countDiff = Math.round((num(emptyDraft.counted) - emptyNow) * 100) / 100

  // Who may open which side of the empties form (lib/roles).
  const mayEmpties = (mode) => (mode === 'count' ? canEmpties : canRefill)

  function openEmpties(product, mode = 'refill') {
    if (!mayEmpties(mode)) return
    // Nothing to refill: the refill button is greyed out, and this refuses too.
    if (mode === 'refill' && (byId.get(product.id)?.empty || 0) <= 0) return
    setEmptyDraft(newEmptiesDraft(mode))
    setFormErr('')
    setEmptyFor(product)
  }

  async function postEmpties() {
    if (!mayEmpties(emptyDraft.mode)) return
    if (isFutureMoment(emptyDraft.moved_at)) {
      setFormErr(`That date is in the future (${fmtWhen(emptyDraft.moved_at)}). Enter when it actually happened.`); return
    }
    const refill = emptyDraft.mode === 'refill'
    let quantity
    if (refill) {
      quantity = num(emptyDraft.quantity)
      if (quantity <= 0) { setFormErr('Enter how many were refilled.'); return }
      /* Refilling more than the empties on record would leave a negative
         number of empty bottles, which only means the empty count was never
         entered. Correct it first — it is the other tab of this same form. */
      if (quantity > emptyNow) {
        setFormErr(`Only ${fmtQty(emptyNow)} empty on record. If there are more, correct the empty count first `
          + '(Correct empty count, above), then refill.'); return
      }
    } else {
      if (emptyDraft.counted === '' || num(emptyDraft.counted) < 0) { setFormErr('Enter how many empties you counted.'); return }
      if (!countDiff) { setFormErr('That is what the system already shows — nothing to correct.'); return }
      quantity = countDiff
    }
    setSaving(true); setFormErr('')
    const err = await saveProductMovement({
      product_id:    emptyFor.id,
      movement_type: refill ? 'refill' : 'empty_adjust',
      quantity,
      unit_cost:     refill ? emptyDraft.unit_cost : null,
      currency:      emptyFor.currency || 'USD',
      reference:     emptyDraft.reference,
      notes:         emptyDraft.notes || (refill ? '' : `Counted ${fmtQty(num(emptyDraft.counted))} empty (system had ${fmtQty(emptyNow)})`),
      moved_at:      emptyDraft.moved_at,
    }, {
      companyId: COMPANY_ID,
      userId: currentUser?.user_id ?? null,
      userName: `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || '',
    })
    setSaving(false)
    if (err) { setFormErr(err); return }
    setEmptyFor(null); load()
  }

  async function removeMovement(m) {
    /* The rule lives in productStock.js, and it is checked HERE as well as on
       the button: a disabled button is a suggestion, and this function is what
       reaches the database. */
    const right = movementDeleteRight(m, { isSuperAdmin, isStrictAdmin: strictAdmin })
    if (!right.allowed) { setError(right.reason); return }
    setBusyId(m.id)
    const err = await deleteProductMovement(m.id)
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  return (
    /* The page itself does not scroll: the stock sheet does, inside its card,
       so its header stays in place while a long list is read. */
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
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
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex-shrink-0">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* Headline figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
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
          <p className="mt-1.5 text-sm font-semibold text-slate-100 tabular-nums">
            {fmtQty(totals.units)}
            {totals.empties !== 0 && (
              <span className="text-cyan-300 font-normal text-xs"> · {fmtQty(totals.empties)} empty</span>
            )}
          </p>
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
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="sticky top-0 z-10 bg-surface-card">
              <tr className="border-b border-surface-border">
                {[
                  ['Code', 'code'], ['Product', 'product'], ['Category', 'category'],
                  ['On hand', 'onHand'], ['Available', 'available'], ['Empty', 'empty'],
                  ['With customers', 'withCustomers'],
                  ['In', 'in'], ['Out', 'out'], ['Sold', 'sold'],
                  ['Reorder at', 'reorder'], ['Last movement', 'last'], ['', null],
                ].map(([label, key]) => (
                  <SortTh key={label || 'actions'} label={label} sortKey={key} sort={sort} onSort={cycle}
                    hint={COLUMN_HINT[label]}
                    className="py-2.5 text-slate-500 text-[11px] uppercase tracking-wider whitespace-nowrap" />
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500 text-xs">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500 text-xs">
                  {onlyLow ? 'Nothing is below its reorder level.' : 'No products found.'}
                </td></tr>
              ) : shown.map(p => {
                const low  = isLow(p, p.stock.onHand)
                const zero = p.stock.onHand <= 0
                const refillable = isRefillable(p)
                return (
                  <tr key={p.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/30 ${p.is_active === false ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {/* The code is what everyone points at, so it opens the
                          product itself — the same form as the Products page,
                          with the same rules for who may change it — and closing
                          it comes back here. Movements and monthly sales stay on
                          the clock button at the end of the row. */}
                      <button type="button" onClick={() => navigate(`/products?open=${p.id}&from=inventory`)}
                        title={`${p.name} — ${canEditProduct ? 'open the product to view or edit' : 'view the product'}`}
                        className="font-mono text-xs text-slate-400 hover:text-brand-300 hover:underline transition-colors">
                        {p.code || '—'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-100">{p.name}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{p.category?.name || '—'}</td>
                    {/* ON HAND is what is owned; AVAILABLE is what can go out
                        today. For most products they are the same number. A
                        returnable is an asset: a sale moves it to the customer
                        and a return brings it back, but it is owned all along,
                        so only stock in, stock out and adjustments change On
                        hand (stockFigures). The out / low flags always sit on
                        Available, in the same column for every row. */}
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 tabular-nums font-semibold text-slate-100">
                        {fmtQty(p.fig.onHand)}
                        <span className="text-[10px] font-normal text-slate-500">{p.unit_of_measure || ''}</span>
                      </span>
                      {p.fig.asset && <span className="block text-[10px] text-slate-500">owned</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`tabular-nums font-semibold ${
                        zero ? 'text-red-300' : low ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {fmtQty(p.fig.available)}
                      </span>
                      <StockFlag zero={zero} low={low} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {refillable ? (
                        <span className="inline-flex items-center gap-1">
                          <span className={`tabular-nums text-xs font-semibold ${
                            p.stock.empty < 0 ? 'text-rose-300' : p.stock.empty > 0 ? 'text-cyan-300' : 'text-slate-500'}`}>
                            {fmtQty(p.stock.empty)}
                          </span>
                          {/* REFILL needs empties to refill, so it is off at 0 or
                              below. The COUNT button is never off: an empty
                              count of 0 (or less) is exactly when somebody has
                              to be able to say "there are 12 in the back". */}
                          {canRefill && (
                            <button onClick={() => openEmpties(p, 'refill')} disabled={p.stock.empty <= 0}
                              title={p.stock.empty > 0 ? 'Refill empty bottles' : 'Nothing to refill — no empty bottles on record'}
                              className="btn-ghost p-1 text-cyan-400 hover:text-cyan-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-cyan-400">
                              <RefreshCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canEmpties && (
                            <button onClick={() => openEmpties(p, 'count')}
                              title="Correct the empty count — enter how many empties you counted"
                              className="btn-ghost p-1 text-slate-500 hover:text-cyan-200">
                              <ClipboardCheck className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      ) : <span className="text-slate-700 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.fig.asset ? (() => {
                        const byOrders = ordersOut.get(p.id) || 0
                        const off = Math.round((p.fig.withCustomers - byOrders) * 100) / 100
                        return (
                          <span className="inline-flex items-center gap-1">
                            <span className={`tabular-nums text-xs font-semibold ${
                              p.fig.withCustomers < 0 ? 'text-rose-300' : p.fig.withCustomers > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                              {fmtQty(p.fig.withCustomers)}
                            </span>
                            {off !== 0 && (
                              <span className="inline-flex text-amber-400 cursor-help"
                                title={`The orders say ${fmtQty(byOrders)} still out; the stock ledger says ${fmtQty(p.fig.withCustomers)} (${off > 0 ? '+' : ''}${fmtQty(off)}). `
                                  + 'A sale or a return did not reach the stock ledger — an order closed, or an item marked returned, '
                                  + 'without posting stock. Open the item\u2019s movements to compare.'}>
                                <AlertCircle className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </span>
                        )
                      })() : <span className="text-slate-700 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2 text-green-300/80 tabular-nums text-xs">{fmtQty(p.stock.in + p.stock.returned + p.stock.refill)}</td>
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
          <div className="card w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border">
              <History className="w-4 h-4 text-brand-300" />
              <span className="text-sm font-medium text-slate-100">{history.name}</span>
              <span className="font-mono text-[11px] text-slate-500">{history.code}</span>
              <span className="ml-auto text-xs text-slate-400 tabular-nums">
                {(() => {
                  const f = stockFigures(history, byId.get(history.id))
                  if (!f.asset) return <>On hand <b className="text-slate-100">{fmtQty(f.onHand)}</b></>
                  return (
                    <>
                      On hand <b className="text-slate-100">{fmtQty(f.onHand)}</b>
                      {' · '}Available <b className="text-emerald-300">{fmtQty(f.available)}</b>
                      {isRefillable(history) && <>{' · '}Empty <b className="text-cyan-300">{fmtQty(f.empty)}</b></>}
                      {' · '}With customers <b className="text-amber-300">{fmtQty(f.withCustomers)}</b>
                    </>
                  )
                })()}
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
              {/* How much of it moves, before the list of every time it moved. */}
              <div className="p-4 pb-0">
                <ProductMonthlySales product={history} />
              </div>
              <div className="flex items-center gap-2 flex-wrap px-4 pt-4 pb-1">
                <h3 className="text-xs font-semibold text-slate-300">Movements</h3>
                {/* A product that sells daily buries its stock-ins and
                    corrections under hundreds of sold rows, in date order. The
                    filter is how you find the one you came for without
                    scrolling past every sale of the year. */}
                <div className="flex items-center gap-1 ml-auto flex-wrap">
                  {[{ v: '', label: 'All' }, ...MOVEMENT_TYPES.map(t => ({ v: t.value, label: t.label }))]
                    .map(({ v, label }) => {
                      const count = v ? allProductMoves.filter(m => m.movement_type === v).length
                                      : allProductMoves.length
                      if (v && count === 0) return null
                      const on = moveTypeFilter === v
                      return (
                        <button key={v || 'all'} type="button" onClick={() => setMoveTypeFilter(v)}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all ${
                            on ? 'bg-brand-500/15 text-brand-300 border-brand-500/40'
                               : 'border-surface-border text-slate-500 hover:text-slate-200'}`}>
                          {label} <span className="opacity-60">{count}</span>
                        </button>
                      )
                    })}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border sticky top-0 bg-surface-card">
                    {['When', 'Type', 'Qty', 'Reference', 'By', 'Notes', ...(canDeleteAny ? [''] : [])].map((h, i) => (
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
                      <td className="px-4 py-2 text-slate-400 text-xs max-w-[16rem] truncate" title={m.notes || undefined}>{m.notes || ''}</td>
                      {canDeleteAny && (() => {
                        const right = movementDeleteRight(m, { isSuperAdmin, isStrictAdmin: strictAdmin })
                        return (
                          <td className="px-4 py-2 whitespace-nowrap">
                            {isSuperAdmin && (
                              <button onClick={() => openEditMove(m)}
                                title={movementFollowsOrder(m)
                                  ? 'Edit this movement — its date, reference, cost and notes (type and quantity follow the order)'
                                  : 'Edit this movement'}
                                className="btn-ghost p-1.5 text-slate-500 hover:text-brand-300">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {right.allowed ? (
                              <button onClick={() => removeMovement(m)} disabled={busyId === m.id}
                                title="Delete this movement (correcting by posting the opposite is usually better)"
                                className="btn-ghost p-1.5 text-slate-500 hover:text-red-400 disabled:opacity-40">
                                {busyId === m.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            ) : (
                              /* Not disabled and silent — says why, because "the
                                 button is grey" is not an explanation. */
                              <span title={right.reason} className="inline-flex p-1.5 text-slate-700 cursor-help">
                                <Lock className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </td>
                        )
                      })()}
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
                <h3 className="text-sm font-semibold text-slate-100 truncate">
                  {editMove ? `Edit movement — ${moveFor.name}` : moveFor.name}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {(() => {
                    const f = stockFigures(moveFor, byId.get(moveFor.id))
                    return f.asset
                      ? <>On hand {fmtQty(f.onHand)} · Available {fmtQty(f.available)}{isRefillable(moveFor) ? ` · Empty ${fmtQty(f.empty)}` : ''}</>
                      : <>On hand {fmtQty(f.onHand)}</>
                  })()} {moveFor.unit_of_measure || ''}
                </p>
              </div>
              <button onClick={closeMoveForm} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-3">
              {editMove && movementFollowsOrder(editMove) && (
                <p className="text-[11px] text-amber-200 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                  This movement came from order <span className="font-mono">{editMove.reference || '—'}</span>. Its type
                  and quantity follow the order — amend the order to change them. The date, reference, cost and notes
                  can be corrected here.
                </p>
              )}
              <div>
                <label className="label">Movement</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(() => {
                    /* The kinds on offer. A new entry: what a person posts. An
                       edit: the same family as the row — an empties row stays
                       an empties row — and never another kind for one an order
                       made. The row's own kind is always there. */
                    if (!editMove) return handMovementTypes(moveFor)
                    if (movementFollowsOrder(editMove)) return MOVEMENT_TYPES.filter(t => t.value === editMove.movement_type)
                    const own = MOVEMENT_TYPES.find(t => t.value === editMove.movement_type)
                    const family = own?.refill
                      ? MOVEMENT_TYPES.filter(t => t.value === 'refill' || t.value === 'empty_adjust')
                      : handMovementTypes(moveFor)
                    return family.some(t => t.value === own?.value) || !own ? family : [...family, own]
                  })().map(t => (
                    <button key={t.value} type="button" disabled={!!editMove && movementFollowsOrder(editMove)}
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
                {/* The mistake this prevents: recording a refill as Stock in.
                    It would add filled bottles but leave the empties where
                    they were, so the empties would never go down. */}
                {isRefillable(moveFor) && draft.movement_type === 'in' && (
                  <p className="text-[11px] text-cyan-300/90 mt-1.5">
                    Stock in is for bottles bought new, full.{' '}
                    {canRefill
                      ? <>Refilling your own empties is the
                          <RefreshCcw className="inline w-3 h-3 mx-1 align-[-2px]" />button in the Empty column.</>
                      : <>Refilling your own empties is recorded by an administrator, from the Empty column.</>}
                  </p>
                )}

                {/* An adjustment is the only entry where the SIGN is the whole
                    meaning, and the only one that can read as the opposite of
                    what was meant. Rather than explain the convention, show
                    the arithmetic: the count it starts from, the count it
                    lands on, and the sentence in between. */}
                {draft.movement_type === 'adjust' && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1.5">
                    <p className="text-[11px] text-amber-200">
                      An adjustment is the <span className="font-semibold">difference</span>, with a sign — not the
                      new total.
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Counted <span className="text-emerald-300 font-semibold">more</span> than the system says? Enter
                      it positive — <span className="font-mono text-slate-300">3</span>.
                      Counted <span className="text-rose-300 font-semibold">fewer</span>? Enter it negative —
                      <span className="font-mono text-slate-300"> -2</span>.
                    </p>
                    {/* Where it lands is shown for a new entry only: an edited
                        row is already inside the figure it would start from. */}
                    {!editMove && <p className="text-[11px] text-slate-300 tabular-nums">
                      {(() => {
                        /* A returnable's count moves what is owned AND what is
                           on the shelf: the one counted is the shelf. */
                        const f = stockFigures(moveFor, byId.get(moveFor.id))
                        const q = num(draft.quantity)
                        if (!q) return <>{f.asset ? 'Available' : 'On hand'} {fmtQty(adjustFrom)}<span className="text-slate-500"> — enter a difference to see where it lands</span></>
                        const land = (from) => (
                          <>{fmtQty(from)}{' → '}<span className={from + q < 0 ? 'text-rose-300 font-semibold' : 'text-brand-300 font-semibold'}>{fmtQty(Math.round((from + q) * 100) / 100)}</span></>
                        )
                        return (
                          <>
                            {f.asset ? <>Available {land(f.available)} · On hand {land(f.onHand)}</> : <>On hand {land(adjustFrom)}</>}
                            <span className="text-slate-500"> ({q > 0 ? '+' : ''}{fmtQty(q)})</span>
                          </>
                        )
                      })()}
                    </p>}
                    {!editMove && adjustTo < 0 && num(draft.quantity) ? (
                      <p className="text-[11px] text-rose-300">
                        That would leave the shelf below zero. Check the sign.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Quantity *</label>
                  <input type="number" step="0.01" className="input" autoFocus value={draft.quantity}
                    disabled={!!editMove && movementFollowsOrder(editMove)}
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
                  <input type="datetime-local" className="input" value={toLocalInput(draft.moved_at)}
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
              <button onClick={closeMoveForm} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={postMovement} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <Loader className="w-4 h-4 animate-spin" /> : editMove ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {editMove ? 'Save changes' : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty bottles: refill, or correct the count ──────────── */}
      {emptyFor && (() => {
        const refill = emptyDraft.mode === 'refill'
        const q = num(emptyDraft.quantity)
        return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[75] p-4">
          <div className="card w-full max-w-md flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-100 truncate">{emptyFor.name} — empties</h3>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  Available {fmtQty(filledNow)} · <span className="text-cyan-300">Empty {fmtQty(emptyNow)}</span> {emptyFor.unit_of_measure || ''}
                </p>
              </div>
              <button onClick={() => setEmptyFor(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-3">
              {/* Only the sides this user may use; with one, no tab bar at all. */}
              {canRefill && canEmpties && <div className="grid grid-cols-2 gap-1.5">
                {[
                  { v: 'refill', label: 'Refill empties', Icon: RefreshCcw },
                  { v: 'count',  label: 'Correct empty count', Icon: ClipboardCheck },
                ].map(({ v, label, Icon }) => (
                  <button key={v} type="button" disabled={v === 'refill' && emptyNow <= 0}
                    title={v === 'refill' && emptyNow <= 0 ? 'Nothing to refill — no empty bottles on record' : undefined}
                    onClick={() => { setEmptyDraft(d => ({ ...d, mode: v })); setFormErr('') }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      emptyDraft.mode === v
                        ? 'bg-cyan-500/15 text-cyan-200 border-cyan-500/30'
                        : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" /> {label}
                  </button>
                ))}
              </div>}

              {refill ? (
                <>
                  <p className="text-[11px] text-slate-500">
                    Empties sent to be refilled and back full — they leave the empties and are ready to sell again.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Quantity refilled *</label>
                      <input type="number" min="0" step="1" className="input" autoFocus value={emptyDraft.quantity}
                        onChange={e => setEmptyDraft(d => ({ ...d, quantity: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Refill cost / unit</label>
                      <div className="relative">
                        <input type="number" min="0" step="0.01" className="input pr-12" value={emptyDraft.unit_cost}
                          onChange={e => setEmptyDraft(d => ({ ...d, unit_cost: e.target.value }))} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">{emptyFor.currency || 'USD'}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] tabular-nums text-slate-300">
                    {q > 0 ? (
                      <>
                        Empty {fmtQty(emptyNow)} → <span className={emptyNow - q < 0 ? 'text-rose-300 font-semibold' : 'text-cyan-300 font-semibold'}>{fmtQty(emptyNow - q)}</span>
                        <span className="text-slate-600"> · </span>
                        Available {fmtQty(filledNow)} → <span className="text-brand-300 font-semibold">{fmtQty(filledNow + q)}</span>
                      </>
                    ) : <span className="text-slate-500">Enter a quantity to see where it lands.</span>}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500">
                    Count the empty bottles and enter the number you counted — not the difference. The
                    system records the correction. Available stock is not touched.
                  </p>
                  <div>
                    <label className="label">Empties counted *</label>
                    <input type="number" min="0" step="1" className="input" autoFocus value={emptyDraft.counted}
                      onChange={e => setEmptyDraft(d => ({ ...d, counted: e.target.value }))} />
                  </div>
                  <p className="text-[11px] tabular-nums text-slate-300">
                    {emptyDraft.counted !== '' ? (
                      <>
                        The system says {fmtQty(emptyNow)} → you counted <span className="text-cyan-300 font-semibold">{fmtQty(num(emptyDraft.counted))}</span>
                        <span className="text-slate-500"> ({countDiff > 0 ? '+' : ''}{fmtQty(countDiff)})</span>
                      </>
                    ) : <span className="text-slate-500">The system says {fmtQty(emptyNow)}.</span>}
                  </p>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{refill ? 'Invoice / reference' : 'Reference'}</label>
                  <input className="input" placeholder={refill ? 'Refill invoice no.' : 'Count sheet…'} value={emptyDraft.reference}
                    onChange={e => setEmptyDraft(d => ({ ...d, reference: e.target.value }))} />
                </div>
                <div>
                  <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> Date</label>
                  <input type="datetime-local" className="input" value={toLocalInput(emptyDraft.moved_at)}
                    onChange={e => setEmptyDraft(d => ({ ...d, moved_at: e.target.value ? new Date(e.target.value).toISOString() : '' }))} />
                  <p className="text-[11px] text-slate-500 mt-1">Empty = now.</p>
                </div>
              </div>

              <div>
                <label className="label">Notes</label>
                <input className="input" placeholder={refill ? 'Supplier or station, anything worth keeping' : ''} value={emptyDraft.notes}
                  onChange={e => setEmptyDraft(d => ({ ...d, notes: e.target.value }))} />
              </div>

              {formErr && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{formErr}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={() => setEmptyFor(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={postEmpties} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <Loader className="w-4 h-4 animate-spin" />
                  : refill ? <RefreshCcw className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4" />}
                {refill ? 'Record refill' : 'Record count'}
              </button>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
