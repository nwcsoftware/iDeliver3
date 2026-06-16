import { supabase } from './supabase'

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
