import { supabase } from './supabase'

/* One order, fetched on demand for the quick-view popup.

   Deliberately its own query rather than a lookup in the app's `orders` array:
   the array holds a rolling window (and on some pages a filtered subset), so a
   number clicked in a statement or a report may not be in it. Asking for the
   single row is both certain and cheap. */

const QUICK_SELECT = `
  *,
  driver:contacts!driver_id(id, first_name, last_name, mobile),
  customer:contacts!customer_id(id, code, first_name, last_name, company_name, mobile, account_number),
  zone:delivery_zones(id, name),
  order_items(id, parcel_description, quantity, unit_price, line_total, currency, is_deleted, supplier_name),
  delivery_packages(id, tracking_number, package_price, currency, paid, provider:contacts!provider_id(code, company_name, first_name, last_name)),
  order_services(id, service_fees, service_fees_currency, provider:contacts!provider_id(company_name, first_name, last_name)),
  retail_goods_invoices(id, shop_name, invoice_value, currency, exclude_calculation, invoice_reference),
  payment_collections(id, amount, currency, collected_by_name, collection_group, collected_at),
  ads(id, platform, price, currency, start_at, end_at, confirmed_ads)
`

/* Accepts an id (uuid) or an order number — pages hold one or the other. */
export async function fetchOrderForQuickView(idOrNumber) {
  const key = String(idOrNumber ?? '').trim()
  if (!key) return { order: null, error: 'No order given.' }
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  try {
    const { data, error } = await supabase
      .from('delivery_orders')
      .select(QUICK_SELECT)
      .eq(isUuid ? 'id' : 'order_number', key)
      .maybeSingle()
    if (error) return { order: null, error: error.message }
    if (!data)  return { order: null, error: `Order ${key} was not found.` }
    return { order: data, error: null }
  } catch (e) {
    return { order: null, error: e?.message || 'Could not load the order.' }
  }
}
