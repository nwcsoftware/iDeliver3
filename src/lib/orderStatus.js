/* The one place that decides what "cancelled" means.

   A cancelled order is not a lighter kind of order — it is an order that never
   happened. It earns nothing, it is owed nothing, no driver carries it and no
   statement mentions it. Everything that counts, totals, settles or reports
   must therefore skip it, and the only screens allowed to show one are the
   Cancelled Orders page (where it is reviewed and can be brought back), the
   Deliveries list (locked and greyed, so the office can still find it), the
   dashboard's status breakdown, and a customer's own order history in the
   mobile app — none of which add it to a figure.

   Before this rule existed, cancellation worked by gutting the order: the
   office cancel deletes its packages, services, invoices and payments, so most
   totals came out zero by consequence rather than by intent. That left real
   holes — VAT and discount are not cleared by a cancel, and a customer-app
   cancel deletes no lines at all — so a cancelled order could still post a
   charge. Filtering on the status closes those regardless of what rows survive.

   In PostgREST, `status.neq.cancelled` is NULL (and therefore false) for a row
   whose status was never written, which would silently drop those orders. Every
   query filter here spells out the NULL case instead. */

export const CANCELLED = 'cancelled'

/* Is this order cancelled? Tolerant of casing and stray whitespace, both of
   which exist in older rows. */
export function isCancelledOrder(o) {
  return String(o?.status ?? '').trim().toLowerCase() === CANCELLED
}

/* The live orders — everything the business still counts. */
export function excludeCancelled(orders) {
  return (orders ?? []).filter(o => !isCancelledOrder(o))
}

/* Only the cancelled ones, for the page that reviews them. */
export function onlyCancelled(orders) {
  return (orders ?? []).filter(isCancelledOrder)
}

/* Add "not cancelled" to a PostgREST query on delivery_orders. */
export function queryExcludeCancelled(q) {
  return q.or(`status.is.null,status.neq.${CANCELLED}`)
}

/* The same, for a query on a child table (packages, invoices, transactions)
   that embeds its order under `alias`. The embed must be an INNER join
   (`!inner`) for this to drop the child row too — on an outer join PostgREST
   would keep the child and merely null the order out. */
export function queryExcludeCancelledOn(q, alias) {
  return q.or(`status.is.null,status.neq.${CANCELLED}`, { referencedTable: alias })
}
