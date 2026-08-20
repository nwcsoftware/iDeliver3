import { supabase, fetchAllRows } from './supabase'

/* Stock for 3asari3's own catalog (supabase-fix126.sql).

   Deliberately the same model as the supplier side (lib/shopStock.js), so the
   office and the shops read their inventory the same way:

     on hand = Σ in − Σ out − Σ sold + Σ returned ± adjustments

   A mistake is corrected by posting another movement, never by editing one —
   the ledger is meant to be an account of what happened, not a current guess
   that someone can quietly rewrite. */

export const MOVEMENT_TYPES = [
  { value: 'in',       label: 'Stock in',   sign: +1, hint: 'Goods received — a purchase or a transfer in' },
  { value: 'sold',     label: 'Sold',       sign: -1, hint: 'Handed to a customer on an order' },
  { value: 'out',      label: 'Stock out',  sign: -1, hint: 'Left without a sale — damage, own use, transfer out' },
  { value: 'returned', label: 'Returned',   sign: +1, hint: 'Came back from a customer' },
  { value: 'adjust',   label: 'Adjustment', sign: +1, hint: 'Count correction — the quantity may be negative' },
]

export const movementLabel = (v) =>
  MOVEMENT_TYPES.find(t => t.value === v)?.label ?? (v || '—')

const SIGN = Object.fromEntries(MOVEMENT_TYPES.map(t => [t.value, t.sign]))
const num  = n => Number(n) || 0
const round2 = n => Math.round(num(n) * 100) / 100

export const isMissingLedger = (msg = '') =>
  /product_movements/i.test(msg) && /not exist|schema cache/i.test(msg)

/* Every movement, newest first. One product's history when `productId` is
   given, otherwise the lot — the list page needs them all to total up. */
export async function fetchProductMovements(companyId = null, productId = null) {
  try {
    const { data, error } = await fetchAllRows(() => {
      let q = supabase.from('product_movements').select('*').order('moved_at', { ascending: false })
      if (companyId) q = q.eq('company_id', companyId)
      if (productId) q = q.eq('product_id', productId)
      return q
    })
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load stock movements.' }
  }
}

/* Roll the ledger up per product: what is on hand, and how it got there. */
export function summarise(movements = []) {
  const map = new Map()
  const bucket = (id) => {
    if (!map.has(id)) {
      map.set(id, { in: 0, out: 0, sold: 0, returned: 0, adjust: 0, onHand: 0, moves: 0, lastMovedAt: null })
    }
    return map.get(id)
  }

  for (const m of movements) {
    if (!m?.product_id) continue
    const b = bucket(m.product_id)
    const type = String(m.movement_type || 'in')
    const qty = num(m.quantity)
    if (b[type] != null) b[type] += qty
    b.onHand = round2(b.onHand + qty * (SIGN[type] ?? 1))
    b.moves += 1
    // Rows arrive newest-first, so the first one seen is the latest.
    if (!b.lastMovedAt) b.lastMovedAt = m.moved_at || m.created_at || null
  }
  return map
}

/* What the stock is worth, using each product's own unit_cost. Movements carry
   a cost too, but valuing on hand at today's cost is what the office expects on
   a stock sheet — and it never needs a costing method argument to explain. */
export function stockValue(products = [], byId = new Map()) {
  const totals = {}
  for (const p of products) {
    const onHand = byId.get(p.id)?.onHand || 0
    const cost   = num(p.unit_cost)
    if (!onHand || !cost) continue
    const cur = p.currency || 'USD'
    totals[cur] = round2((totals[cur] || 0) + onHand * cost)
  }
  return totals
}

/* Below its reorder level (and the level is actually set)? */
export const isLow = (product, onHand) =>
  num(product?.reorder_level) > 0 && num(onHand) <= num(product.reorder_level)

/* Record one movement. */
export async function saveProductMovement(row, { companyId = null, userId = null, userName = '' } = {}) {
  const payload = {
    product_id:    row.product_id,
    movement_type: row.movement_type || 'in',
    quantity:      num(row.quantity),
    unit_cost:     row.unit_cost === '' || row.unit_cost == null ? null : num(row.unit_cost),
    currency:      row.currency || 'USD',
    reference:     row.reference?.trim() || null,
    notes:         row.notes?.trim() || null,
    order_id:      row.order_id || null,
    moved_at:      row.moved_at || new Date().toISOString(),
    created_by:    userId,
    created_by_name: userName || null,
    ...(companyId ? { company_id: companyId } : {}),
  }
  try {
    const { error } = await supabase.from('product_movements').insert([payload])
    if (error) {
      return isMissingLedger(error.message)
        ? 'Product stock isn’t installed yet — run supabase-fix126.sql in Supabase.'
        : error.message
    }
    return null
  } catch (e) {
    return e?.message || 'Could not record the movement.'
  }
}

/* Remove a movement. Kept for the super admin only: correcting by posting the
   opposite movement is the honest route, but a row entered against the wrong
   product is noise nobody wants to keep. */
export async function deleteProductMovement(id) {
  const { error } = await supabase.from('product_movements').delete().eq('id', id)
  return error ? error.message : null
}
