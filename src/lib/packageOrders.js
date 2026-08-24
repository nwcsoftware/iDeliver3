import { supabase } from './supabase'

/* Fetch the order rows behind a set of delivery packages, keyed by id.

   PostgREST can't reliably embed delivery_packages → orders (the reverse
   relationship isn't in the schema cache), so the Packages report and the
   partner Packages tab load packages first, then resolve their orders here.

   Ids are queried in chunks to keep the `in.(…)` URL a sane length. Returns a
   Map<order_id, order>.

   `onProgress(done, total)` — optional — is called after each chunk, so a
   caller can show how far along a long load is instead of a bare spinner. */

const CHUNK = 200
// delivery_fee + payment_collections feed the daily-summary report (delivery
// fees charged and cash collected from the customer, per day).
const ORDER_FIELDS = 'id, order_number, recipient_name, delivery_address, currency, isclosed, closed_at, scheduled_date, created_at, delivery_fee, total_amount, payment_collections(amount, currency)'

export async function fetchOrdersByIds(ids = [], onProgress) {
  const map = new Map()
  const clean = [...new Set(ids.filter(Boolean))]
  onProgress?.(0, clean.length)
  for (let i = 0; i < clean.length; i += CHUNK) {
    const slice = clean.slice(i, i + CHUNK)
    const { data, error } = await supabase.from('delivery_orders').select(ORDER_FIELDS).in('id', slice)
    if (error) throw error
    for (const o of data ?? []) map.set(o.id, o)
    onProgress?.(Math.min(i + CHUNK, clean.length), clean.length)
  }
  return map
}
