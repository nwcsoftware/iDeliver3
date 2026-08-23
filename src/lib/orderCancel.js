import { supabase } from './supabase'

/* A customer cancelling their own order from the mobile app.

   The rule the office asked for: a placed order can no longer be edited, but
   it CAN be called off — until the call centre confirms it. After that the
   order is being worked on, so it is theirs to unwind, and the customer is
   asked to ring instead.

   Cancelling marks the order rather than deleting it. The office needs to know
   an order existed and was called off — a row that simply vanishes is a
   customer asking "what happened to my delivery?" with nothing to answer from.
   It is the same shape the office's own cancel writes, so a cancelled order
   reads identically wherever it is opened. */

export const SUPPORT_PHONE = '+961 81 585 255'

/* Confirmed by the call centre = out of the customer's hands. */
export const canCustomerCancel = (order) =>
  !!order
  && order.order_confirmed !== true
  && !['cancelled', 'failed', 'completed'].includes(String(order.status || '').toLowerCase())
  && order.isclosed !== true

export const CANCEL_REFUSED = {
  confirmed: 'confirmed',   // the call centre already took it
  gone:      'gone',        // already cancelled, closed or completed
  failed:    'failed',      // the write itself did not go through
}

/* Cancel one order on the customer's behalf.

   The order is re-read first: the list in their hand may be seconds old, and
   the call centre may have confirmed it in the meantime. Deciding on the fresh
   row is what stops a customer cancelling an order a driver is already
   carrying. Returns { ok } or { ok: false, reason, error }. */
export async function cancelOwnOrder(orderId, { note = null, customerName = null } = {}) {
  if (!orderId) return { ok: false, reason: CANCEL_REFUSED.failed, error: 'No order.' }
  try {
    const { data: fresh, error: readErr } = await supabase
      .from('delivery_orders')
      .select('id, status, order_confirmed, isclosed')
      .eq('id', orderId)
      .maybeSingle()
    if (readErr) return { ok: false, reason: CANCEL_REFUSED.failed, error: readErr.message }
    if (!fresh)  return { ok: false, reason: CANCEL_REFUSED.gone, error: null }
    if (fresh.order_confirmed === true) return { ok: false, reason: CANCEL_REFUSED.confirmed, error: null }
    if (!canCustomerCancel(fresh))      return { ok: false, reason: CANCEL_REFUSED.gone, error: null }

    const who = customerName ? ` (${customerName})` : ''
    const reason = [`Cancelled by the customer in the app${who}`, note?.trim()]
      .filter(Boolean).join(' — ')

    /* Guarded on the same condition in the WHERE clause, so two taps — or a
       confirmation landing between the read and the write — cannot both win. */
    const { data, error } = await supabase
      .from('delivery_orders')
      .update({
        status:                    'cancelled',
        delivery_fee:              0,
        payment_status:            'unpaid',
        cancellation_reason:       reason,
        cancellation_requested_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      // NOT `neq(true)`: in SQL that is NULL for a NULL flag, so an order whose
      // column was never written would never match and could never be cancelled.
      .or('order_confirmed.is.null,order_confirmed.eq.false')
      .select('id')

    if (error) return { ok: false, reason: CANCEL_REFUSED.failed, error: error.message }
    if (!data || data.length === 0) return { ok: false, reason: CANCEL_REFUSED.confirmed, error: null }
    return { ok: true, reason: null, error: null }
  } catch (e) {
    return { ok: false, reason: CANCEL_REFUSED.failed, error: e?.message || 'Could not cancel the order.' }
  }
}
