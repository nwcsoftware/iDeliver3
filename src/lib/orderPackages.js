import { supabase } from './supabase'

/* Package tracking number — YYYYMMDD-HHMMSS-mmm, e.g.

     20260812-140709-482

   Self-contained, so it can be issued the moment a package row is added: it
   needs neither the order (which may not have a number yet) nor the partner.
   The milliseconds make it unique; `taken` guards the (vanishingly rare) case
   of two rows landing on the same millisecond. */
export function buildTrackingNumber(taken = [], now = new Date()) {
  const pad  = (n, w = 2) => String(n).padStart(w, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const base = `${date}-${time}-${pad(now.getMilliseconds(), 3)}`

  const used = new Set((taken || []).filter(Boolean).map(String))
  if (!used.has(base)) return base
  for (let i = 1; i < 100; i++) {
    const candidate = `${base}-${pad(i)}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString().slice(-4)}`
}

/* A package row is considered "filled" once it has any meaningful content. */
function isFilled(p) {
  return [p.tracking_number, p.provider_id, p.category, p.type, p.package_size, p.vehicle_type,
          p.description, p.base_price, p.package_price]
    .some(v => String(v ?? '').trim() !== '')
}

/**
 * Persist an order's delivery packages to delivery_packages.
 *
 * - Deletes removed rows, updates existing, inserts new.
 * - Copies contactCode onto every package (inherited from the order's contact).
 * - Skips all DB work when there is nothing to write or delete, so orders
 *   without packages don't depend on the delivery_packages table existing.
 *
 * Returns an error message string, or null on success.
 */
export async function saveOrderPackages({ orderId, packages, origIds = [], companyId = null, contactCode = null, userId = null }) {
  const valid    = packages.filter(isFilled)
  // Safety net: anything that still has no tracking number gets one here, so a
  // package can never reach the database without one.
  const issued = valid.map(p => p.tracking_number?.trim()).filter(Boolean)
  for (const p of valid) {
    if (!p.tracking_number?.trim()) {
      p.tracking_number = buildTrackingNumber(issued)
      issued.push(p.tracking_number)
    }
  }
  const keepIds  = valid.filter(p => p._id).map(p => p._id)
  const toDelete = origIds.filter(id => !keepIds.includes(id))

  if (valid.length === 0 && toDelete.length === 0) return null

  if (toDelete.length > 0) {
    const { error } = await supabase.from('delivery_packages').delete().in('id', toDelete)
    if (error) return error.message
  }

  for (const p of valid) {
    const fields = {
      contact_code:    contactCode,
      provider_id:     p.provider_id || null,
      tracking_number: p.tracking_number?.trim() || null,
      category:        p.category   || null,
      type:            p.type       || null,
      package_size:    p.package_size || null,
      handling:        p.handling   || 'regular',
      vehicle_type:    p.vehicle_type || null,
      quantity:        Number(p.quantity) || 1,
      weight_kg:       p.weight_kg === '' || p.weight_kg == null ? null : Number(p.weight_kg),
      description:     p.description?.trim() || null,
      notes:           p.notes?.trim() || null,
      base_price:      p.base_price === '' || p.base_price == null ? null : Number(p.base_price),
      package_price:   p.package_price === '' || p.package_price == null ? null : Number(p.package_price),
      currency:        p.currency || 'USD',
      paid:            !!p.paid,
      payment_type:    p.payment_type || null,
      updated_by:      userId,
    }
    if (p._id) {
      const { error } = await supabase.from('delivery_packages').update(fields).eq('id', p._id)
      if (error) return error.message
    } else {
      const { error } = await supabase.from('delivery_packages')
        .insert([{ order_id: orderId, created_by: userId, ...(companyId ? { company_id: companyId } : {}), ...fields }])
      if (error) return error.message
    }
  }
  return null
}
