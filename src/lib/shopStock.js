import { supabase } from './supabase'

/* Supplier stock: movements (in / out / sold) and cart reservations
   (supabase-fix113.sql).

     on hand   = Σ in − Σ out − Σ sold
     reserved  = live cart reservations (not yet expired)
     available = on hand − reserved

   The customer app writes reservations as items go in and out of a cart, and
   turns them into 'sold' movements when the order is placed. */

export const MOVEMENT_TYPES = [
  { value: 'in',   label: 'Stock in',  sign: +1 },
  { value: 'out',  label: 'Stock out', sign: -1 },
  { value: 'sold', label: 'Sold',      sign: -1 },
]
const SIGN = Object.fromEntries(MOVEMENT_TYPES.map(t => [t.value, t.sign]))

const num = n => Number(n) || 0

/* Movements for a shop owner (optionally one item), newest first. */
export async function fetchMovements(ownerContactId, itemId = null) {
  if (!ownerContactId) return { rows: [], error: null }
  try {
    let q = supabase
      .from('shop_inventory_movements')
      .select('*')
      .eq('owner_contact_id', ownerContactId)
      .order('moved_at', { ascending: false })
    if (itemId) q = q.eq('item_id', itemId)
    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load stock movements.' }
  }
}

/* Live (unexpired) reservations for a shop owner. */
export async function fetchReservations(ownerContactId) {
  if (!ownerContactId) return { rows: [], error: null }
  try {
    const { data, error } = await supabase
      .from('shop_reservations')
      .select('*')
      .eq('owner_contact_id', ownerContactId)
      .gt('expires_at', new Date().toISOString())
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load reservations.' }
  }
}

/* Roll movements + reservations up per item id. */
export function summarise(movements = [], reservations = []) {
  const map = new Map()
  const bucket = id => {
    if (!map.has(id)) map.set(id, { in: 0, out: 0, sold: 0, reserved: 0 })
    return map.get(id)
  }
  for (const m of movements) {
    const b = bucket(m.item_id)
    if (m.movement_type === 'in')        b.in   += num(m.quantity)
    else if (m.movement_type === 'out')  b.out  += num(m.quantity)
    else if (m.movement_type === 'sold') b.sold += num(m.quantity)
  }
  for (const r of reservations) bucket(r.item_id).reserved += num(r.quantity)
  for (const b of map.values()) {
    b.onHand    = b.in - b.out - b.sold
    b.available = b.onHand - b.reserved
  }
  return map
}

export async function saveMovement(row, { companyId = null, user = null } = {}) {
  const payload = {
    item_id:          row.item_id,
    owner_contact_id: row.owner_contact_id,
    movement_type:    row.movement_type || 'in',
    quantity:         Math.abs(num(row.quantity)),
    notes:            row.notes?.trim() || null,
    moved_at:         row.moved_at || new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  }
  if (!payload.item_id)  return 'Choose an item.'
  if (!payload.quantity) return 'Enter a quantity.'

  if (row.id) {
    const { error } = await supabase.from('shop_inventory_movements').update(payload).eq('id', row.id)
    return error ? error.message : null
  }
  const { error } = await supabase.from('shop_inventory_movements').insert([{
    ...payload,
    ...(companyId ? { company_id: companyId } : {}),
    created_by: user?.user_id ?? null,
    created_by_name: `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || user?.username || null,
  }])
  return error ? error.message : null
}

export async function deleteMovement(id) {
  const { error } = await supabase.from('shop_inventory_movements').delete().eq('id', id)
  return error ? error.message : null
}

/* ── customer-app side ───────────────────────────────────────────────────── */

/* Hold stock for one cart line. Called as the line is added or its quantity
   changes; silently does nothing when the tables aren't installed yet, so the
   shop keeps working without fix113. */
export async function reserveCartLine({ itemId, ownerContactId, customerId, cartLineKey, variantLabel, quantity, companyId = null }) {
  if (!itemId || !cartLineKey) return
  try {
    await supabase.from('shop_reservations').upsert({
      item_id: itemId,
      owner_contact_id: ownerContactId ?? null,
      customer_id: customerId ?? null,
      cart_line_key: cartLineKey,
      variant_label: variantLabel ?? null,
      quantity: Math.max(0, num(quantity)),
      expires_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      ...(companyId ? { company_id: companyId } : {}),
    }, { onConflict: 'customer_id,cart_line_key' })
  } catch { /* reservations are best-effort */ }
}

/* Drop one held line (removed from the cart, or quantity set to zero). */
export async function releaseCartLine({ customerId, cartLineKey }) {
  if (!cartLineKey) return
  try {
    let q = supabase.from('shop_reservations').delete().eq('cart_line_key', cartLineKey)
    if (customerId) q = q.eq('customer_id', customerId)
    await q
  } catch { /* best-effort */ }
}

/* Order placed: every held line becomes a 'sold' movement and the holds go. */
export async function convertReservationsToSales({ customerId, orderId, cart = [], companyId = null }) {
  try {
    const rows = cart
      .filter(it => it.shop_item_id || it.id)
      .map(it => ({
        item_id:          it.shop_item_id || it.id,
        owner_contact_id: it.owner_contact_id ?? null,
        movement_type:    'sold',
        quantity:         Math.abs(num(it.qty)) || 1,
        notes:            it.variant_label ? `${it.name} (${it.variant_label})` : it.name,
        order_id:         orderId ?? null,
        moved_at:         new Date().toISOString(),
        ...(companyId ? { company_id: companyId } : {}),
      }))
    if (rows.length) await supabase.from('shop_inventory_movements').insert(rows)
    if (customerId) await supabase.from('shop_reservations').delete().eq('customer_id', customerId)
  } catch { /* the order itself is already saved */ }
}
