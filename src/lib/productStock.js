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
/* WHO MAY DELETE A STOCK MOVEMENT, and which ones.

   A movement typed on the Inventory page — a stock in, a stock out, a count
   correction — is somebody's entry, and a wrong one is best removed. An
   administrator may.

   A movement that came from an ORDER is not an entry, it is a consequence: the
   order was closed, so the goods left. Deleting it would make the shelf
   disagree with the orders that emptied it, and the next time that order is
   saved syncOrderStock would put it back anyway — so it is not even a lasting
   change, just a confusing one. An administrator may not. The way to undo it
   is to reopen or amend the order, which is where the fact actually lives.

   A super admin may delete either, because somebody has to be able to fix the
   ledger when it is wrong in a way the rules did not anticipate.

   A Senior Call Center user may delete nothing at all. */
export const movementIsFromOrder = (m) =>
  !!m?.order_id || String(m?.movement_type || '') === 'sold'

export function movementDeleteRight(movement, { isSuperAdmin, isStrictAdmin }) {
  if (isSuperAdmin) return { allowed: true, reason: '' }
  if (!isStrictAdmin) {
    return { allowed: false, reason: 'Only an administrator can delete a stock movement.' }
  }
  if (movementIsFromOrder(movement)) {
    return { allowed: false,
      reason: 'This movement came from an order being closed, so it is not an entry to delete — '
            + 'reopen or amend the order instead, and the shelf follows.' }
  }
  return { allowed: true, reason: '' }
}

export async function deleteProductMovement(id) {
  const { error } = await supabase.from('product_movements').delete().eq('id', id)
  return error ? error.message : null
}

/* ── an order's stock, kept in step with the order itself ─────────────────
 *
 * Selling used to move no stock at all: order_items was written and this ledger
 * was never touched, so "sold" and "out" stayed at zero however much went out
 * of the door, and on-hand was only ever what somebody typed by hand.
 *
 * WHEN. Stock moves when the order is CLOSED, not when the line is typed. A
 * line on an open order is an intention; the goods leave when the order is
 * finished. Reopen it and the movement is withdrawn again.
 *
 * WHAT. Retail products only. A service and an advert are not goods and carry
 * no stock; a RETURNABLE has its own cycle — it goes out and comes back — and
 * is handled on the Returnable Items page rather than here, so it is left
 * alone on purpose.
 *
 * HOW — and this is the part that matters. Rather than trying to catch every
 * event (closed, edited, a line changed from 3 to 2, a line deleted, cancelled,
 * reopened) and post the difference, this recomputes what the order SHOULD have
 * posted and makes the ledger match. Deltas drift the first time an event is
 * missed and never recover; a function that can be run twice and change nothing
 * the second time cannot drift. It is safe to call after any save.
 */
export async function syncOrderStock(orderId, { companyId = null, userId = null, userName = '' } = {}) {
  if (!orderId) return null
  try {
    const { data: order, error: oe } = await supabase
      .from('delivery_orders')
      .select('id, order_number, isclosed, status, closed_at, scheduled_date')
      .eq('id', orderId).maybeSingle()
    if (oe || !order) return oe?.message || null

    /* A cancelled order never happened, so it moves nothing even if it somehow
       carries the closed flag. */
    const shouldPost = order.isclosed === true && !['cancelled', 'failed'].includes(order.status)

    let wanted = []
    if (shouldPost) {
      const { data: lines, error: le } = await supabase
        .from('order_items')
        .select('product_id, quantity, unit_price, currency, is_deleted')
        .eq('order_id', orderId)
      if (le) return le.message
      const live = (lines ?? []).filter(l => !l.is_deleted && l.product_id)
      if (live.length) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, is_retail, is_returnable, is_service, is_advertisement')
          .in('id', [...new Set(live.map(l => l.product_id))])
        const stocked = new Map((prods ?? [])
          .filter(p => p.is_retail && !p.is_returnable && !p.is_service && !p.is_advertisement)
          .map(p => [p.id, p]))

        /* Several lines of the same product on one order become ONE movement:
           the ledger records what left, not how it was typed. */
        const byProduct = new Map()
        for (const l of live) {
          if (!stocked.has(l.product_id)) continue
          const cur = byProduct.get(l.product_id) || { qty: 0, currency: l.currency || 'USD', unit: null }
          cur.qty += num(l.quantity)
          if (cur.unit == null) cur.unit = num(l.unit_price)
          byProduct.set(l.product_id, cur)
        }
        const when = order.closed_at
          || (order.scheduled_date ? `${String(order.scheduled_date).slice(0, 10)}T12:00:00Z` : new Date().toISOString())
        wanted = [...byProduct.entries()]
          .filter(([, v]) => v.qty > 0)
          .map(([product_id, v]) => ({
            product_id,
            movement_type: 'sold',
            quantity:  round2(v.qty),
            unit_cost: v.unit,
            currency:  v.currency,
            reference: order.order_number || null,
            notes:     'Posted automatically when the order was closed',
            order_id:  orderId,
            moved_at:  when,
          }))
      }
    }

    // What this order has already posted. Only its own 'sold' rows are touched:
    // a hand-posted adjustment against the same product is somebody's decision.
    const { data: existing, error: ee } = await supabase
      .from('product_movements')
      .select('id, product_id, quantity, moved_at')
      .eq('order_id', orderId).eq('movement_type', 'sold')
    if (ee) return isMissingLedger(ee.message) ? null : ee.message

    const same = (a, b) => a.product_id === b.product_id && round2(a.quantity) === round2(b.quantity)
    const toDelete = (existing ?? []).filter(e => !wanted.some(w => same(e, w)))
    const toInsert = wanted.filter(w => !(existing ?? []).some(e => same(e, w)))

    if (toDelete.length) {
      const { error } = await supabase.from('product_movements')
        .delete().in('id', toDelete.map(r => r.id))
      if (error) return error.message
    }
    for (const row of toInsert) {
      const err = await saveProductMovement(row, { companyId, userId, userName })
      if (err) return err
    }
    return null
  } catch (e) {
    return e?.message || 'Could not update stock for this order.'
  }
}
