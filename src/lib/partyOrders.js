import { supabase, fetchAllRows } from './supabase'

/* Which orders belong to a supplier / partner.

   A 2nd party's portal shows their own work and nothing else, so the question
   "is this order theirs?" has to be answered somewhere. It used to be answered
   in the deliveries page with two lookups — their packages and their retail
   invoices — which missed the two ways an order most often reaches them now:

     • a customer buys their shop product in the app  → order_items.supplier_id
     • the call centre raises an order FOR their shop → delivery_orders.customer_id

   Both were invisible in the portal while the money for the first already
   appeared in their statement. So the rule lives here, once, and covers every
   way an order can name them:

     delivery_packages.provider_id      a parcel they handed us to deliver
     retail_goods_invoices.contact_id   goods bought from their shop
     order_items.supplier_id            their product sold in the customer app
     order_services.provider_id         a service they performed
     delivery_orders.customer_id        the order was raised for them

   The first four need a lookup (the order row doesn't carry them); the last is
   on the order itself and is checked in `partyOwnsOrder`. */

const idsFrom = (rows, key) => {
  const out = []
  for (const r of rows ?? []) if (r?.order_id) out.push(r.order_id)
  return out
}

/* Every order id that references this contact through a line. Paged, because a
   busy shop passes the 1000-row cap on its packages alone and a truncated set
   would quietly hide their oldest work. */
export async function fetchPartyOrderIds(contactId) {
  if (!contactId) return { ids: new Set(), error: null }
  const sources = [
    ['delivery_packages',      'provider_id'],
    ['retail_goods_invoices',  'contact_id'],
    ['order_items',            'supplier_id'],
    ['order_services',         'provider_id'],
  ]
  const ids = new Set()
  let error = null
  await Promise.all(sources.map(async ([table, column]) => {
    const { data, error: e } = await fetchAllRows(() =>
      supabase.from(table).select('order_id').eq(column, contactId))
    // A table this install doesn't have yet must not empty the whole list.
    if (e) { error = error || e.message; return }
    for (const id of idsFrom(data)) ids.add(id)
  }))
  return { ids, error }
}

/* Is this order theirs? `ids` is what fetchPartyOrderIds returned; the customer
   check needs no lookup because it is on the order row already. */
export function partyOwnsOrder(order, contactId, ids) {
  if (!contactId) return true                       // office view: everything
  if (!order) return false
  if (order.customer_id && order.customer_id === contactId) return true
  return !!ids && ids.has(order.id)
}

/* The line tables the portal watches, so an order that becomes theirs a moment
   after it was created — the items are inserted after the order row — shows up
   without waiting for a reload. Needs those tables in the realtime publication
   (supabase-fix132.sql); without it the periodic refresh still catches them. */
export const PARTY_LINE_TABLES = [
  ['delivery_packages',     'provider_id'],
  ['retail_goods_invoices', 'contact_id'],
  ['order_items',           'supplier_id'],
  ['order_services',        'provider_id'],
]
