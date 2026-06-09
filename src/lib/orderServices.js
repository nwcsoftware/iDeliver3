import { supabase } from './supabase'

/* A service row is considered "filled" once it has any meaningful content. */
function isFilled(s) {
  return [s.service_description, s.service_reference, s.service_fees]
    .some(v => String(v ?? '').trim() !== '')
}

/**
 * Persist an order's services to order_services.
 *
 * - Deletes removed rows, updates existing, inserts new.
 * - Skips all DB work when there is nothing to write or delete.
 *
 * Returns an error message string, or null on success.
 */
export async function saveOrderServices({ orderId, services, origIds = [], companyId = null, userId = null }) {
  const valid    = services.filter(isFilled)
  const keepIds  = valid.filter(s => s._id).map(s => s._id)
  const toDelete = origIds.filter(id => !keepIds.includes(id))

  if (valid.length === 0 && toDelete.length === 0) return null

  if (toDelete.length > 0) {
    const { error } = await supabase.from('order_services').delete().in('id', toDelete)
    if (error) return error.message
  }

  for (const s of valid) {
    const fields = {
      // service_date and service_fees are NOT NULL in order_services — default
      // blanks to today / 0 so a part-filled service row never blocks the save.
      service_date:           s.service_date || new Date().toISOString().slice(0, 10),
      service_description:    s.service_description?.trim() || null,
      service_reference:      s.service_reference?.trim() || null,
      quantity:               Number(s.quantity) || 1,
      service_fees:           s.service_fees === '' || s.service_fees == null ? 0 : Number(s.service_fees),
      service_fees_currency:  s.service_fees_currency || 'USD',
      updated_by:             userId,
    }
    if (s._id) {
      const { error } = await supabase.from('order_services').update(fields).eq('id', s._id)
      if (error) return error.message
    } else {
      // order_id and company_id are inherited from the parent order.
      const { error } = await supabase.from('order_services')
        .insert([{ order_id: orderId, company_id: companyId, created_by: userId, ...fields }])
      if (error) return error.message
    }
  }
  return null
}
