import { supabase, fetchAllRowsKeyset, HEAVY_PAGE_SIZE } from './supabase'

/* The orders the Currency Check reads, for one period only.

   Its own query rather than the app's shared order array: that array holds a
   rolling recent window, and the alternative — asking for the whole history and
   filtering in the browser — is what made this page slow enough to avoid. Here
   the database does the narrowing, and only the money lines are embedded.

   Deliberately NOT the full ORDER_SELECT: this page never shows a driver, a
   zone or a status timeline, and every embed is rows over the wire. */
const MONEY_SELECT = `
  id, order_number, order_source, order_type, status, isclosed,
  scheduled_date, created_at, created_by, created_by_id,
  delivery_fee, currency, discount_amount, discount_currency, vat_amount,
  customer:contacts!customer_id(id, code, first_name, last_name, company_name),
  order_items(parcel_description, line_total, currency, is_deleted),
  delivery_packages(tracking_number, package_price, currency, provider_id),
  order_services(service_fees, service_fees_currency, provider_id),
  retail_goods_invoices(invoice_value, currency, shop_name, invoice_reference, contact_id),
  ads(platform, price, currency),
  payment_collections(amount, currency, collected_by_name, collection_group)
`

/* Every order in the window, by the day it was worked.

   Matched on scheduled_date OR created_at: an order taken on the 31st for the
   1st belongs to the period a person means when they say "this month", and a
   currency slip should not hide in the gap between the two dates. */
export async function fetchOrdersForPeriod(period, companyId = null) {
  if (!period?.from || !period?.to) return { orders: [], error: null }
  const fromTs = `${period.from}T00:00:00`
  const toTs   = `${period.to}T23:59:59`

  const { data, error } = await fetchAllRowsKeyset((cursor) => {
    let q = supabase
      .from('delivery_orders')
      .select(MONEY_SELECT)
      .or(`and(scheduled_date.gte.${period.from},scheduled_date.lte.${period.to}),`
        + `and(created_at.gte.${fromTs},created_at.lte.${toTs})`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    if (companyId) q = q.eq('company_id', companyId)
    // A cancelled order carries no money to check.
    q = q.or('status.is.null,status.neq.cancelled')
    // `lte` rather than `lt` so orders sharing a timestamp are never skipped;
    // the helper drops the duplicates that overlap causes.
    if (cursor) q = q.lte('created_at', cursor)
    return q
  }, { pageSize: HEAVY_PAGE_SIZE })

  return {
    // `data` is present even when a page failed, so a partial answer is shown
    // with its warning rather than an empty page with none.
    orders: data ?? [],
    error: error ? (error.message || 'Could not load every order in this period.') : null,
  }
}
