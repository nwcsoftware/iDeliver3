import { supabase } from './supabase'
import { tableLabel, columnLabel } from './userDeletion'

/* Deleting a retired contact for good (supabase-fix151.sql).

   Deactivating hides a contact; this removes it — the card, its account
   number, its subscription, the payouts we made it, its addresses, its login,
   and the orders it placed.

   Only a contact that has ALREADY been deactivated can be deleted, and that is
   not a screen convention: retiring runs a settlement check (open orders,
   unpaid package dues, an uncollected balance) and refuses while any of it
   stands. Routing deletion through deactivation means that check cannot be
   walked around. The database enforces it, not this file.

   The footprint is read from the database first and shown, so the office
   decides with the numbers in front of it rather than after the fact. */

const friendly = (msg = '') =>
  /NOT_AUTHORIZED/i.test(msg)        ? 'Only the super admin can delete a contact.'
  : /CANNOT_DELETE_SELF/i.test(msg)  ? 'You cannot delete the contact linked to the account you are signed in with.'
  : /CONTACT_NOT_FOUND/i.test(msg)   ? 'That contact no longer exists.'
  : /CONTACT_IS_ACTIVE/i.test(msg)
    ? 'That contact is still active. Deactivate it on the Contacts page first — that runs the settlement check.'
  : /ORDERS_NOT_CONFIRMED/i.test(msg)
    ? 'Nothing was deleted — the orders have to be confirmed first, because an order cannot outlive its customer.'
  : /BLOCKED_BY:/i.test(msg)
    ? `Nothing was deleted — ${msg.replace(/^.*BLOCKED_BY:/i, '').trim()}. `
      + 'That table will not give up the reference, so the contact was left exactly as it was.'
  : /admin_contact_references|admin_delete_contact/i.test(msg) && /does not exist|schema cache/i.test(msg)
    ? 'Contact deletion isn’t installed yet — run supabase-fix151.sql.'
  : /failed to fetch|networkerror|load failed/i.test(msg)
    ? 'The request didn’t reach the server. Check the connection and try again — nothing was deleted.'
  : msg

/* What this contact is attached to. Rows of { table_name, column_name,
   rows_found, kind }, where kind is one of:

     own      records that exist only because of this contact — deleted
     orders   the orders it placed — deleted with it, and confirmed first
     account  its login — deleted with it, its stamps cleared
     audit    a mention on somebody else's record — cleared, record kept
     blocking a reference that cannot be emptied — stops the delete */
export async function scanContactReferences(contactId, { actorId } = {}) {
  if (!contactId || !actorId) return { rows: [], error: 'Missing contact.' }
  try {
    const { data, error } = await supabase.rpc('admin_contact_references', {
      p_actor_id:   actorId,
      p_contact_id: contactId,
    })
    if (error) return { rows: [], error: friendly(error.message) }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: friendly(e?.message || '') || 'Could not read the contact’s footprint.' }
  }
}

/* Summary of a scan, for the sentences shown in the review. */
export function summariseContactReferences(rows = []) {
  const of = kind => rows.filter(r => r.kind === kind)
  const total = list => list.reduce((n, r) => n + Number(r.rows_found || 0), 0)

  const own      = of('own')
  const audit    = of('audit')
  const account  = of('account')
  const blocking = of('blocking')
  const orders   = of('orders')

  return {
    own, audit, account, blocking, orders,
    ownRows:      total(own),
    auditRows:    total(audit),
    orderRows:    total(orders),
    blockingRows: total(blocking),
    hasAccount:   account.length > 0,
    tables:       new Set(rows.map(r => r.table_name)).size,
    clean:        rows.length === 0,
  }
}

/* Delete it. `deleteOrders` must be true when the contact has orders — the
   database refuses otherwise, because delivery_orders.customer_id is NOT NULL
   and an order cannot be left without a customer. Returns the database's own
   per-table report, so the office is told what actually happened. */
export async function deleteContact(contactId, { actorId, deleteOrders = false } = {}) {
  if (!contactId || !actorId) return { report: [], error: 'Missing contact.' }
  try {
    const { data, error } = await supabase.rpc('admin_delete_contact', {
      p_actor_id:      actorId,
      p_contact_id:    contactId,
      p_delete_orders: !!deleteOrders,
    })
    if (error) return { report: [], error: friendly(error.message) }
    return { report: data ?? [], error: null }
  } catch (e) {
    return { report: [], error: friendly(e?.message || '') || 'Could not delete the contact.' }
  }
}

/* Plain-language names for the contact-side tables, on top of the shared list
   the user deletion already carries. */
const CONTACT_TABLE_LABELS = {
  delivery_orders:           'Orders they placed',
  delivery_packages:         'Packages they supplied',
  retail_goods_invoices:     'Shop invoices',
  order_items:               'Order lines they supplied',
  returnable_issuances:      'Returnable items issued',
  sub_accounts:              'Account numbers',
  subscriptions:             'Subscriptions',
  partner_payouts:           'Payouts made to them',
  credit_customer_payments:  'Credit settlements',
  shop_inventory:            'Their shop’s stock',
  supplier_settlements:      'Supplier settlements',
  supplier_commissions:      'Commission records',
  contact_addresses:         'Their addresses',
  contacts:                  'The contact card',
  ads:                       'Adverts',
}

export const contactTableLabel = (t) => CONTACT_TABLE_LABELS[t] || tableLabel(t)
export { columnLabel }

/* What each kind means, in a sentence, for the review list. */
export const KIND_TEXT = {
  own:      'Theirs alone — deleted with them',
  orders:   'Their orders — deleted with everything on them',
  account:  'Their portal login — deleted, and its stamps on other records cleared',
  audit:    'A mention on somebody else’s record — the name is cleared, the record kept',
  blocking: 'Cannot be given up — this stops the delete',
}
