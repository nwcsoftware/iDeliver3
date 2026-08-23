import { supabase } from './supabase'

/* Deleting a user account for good (supabase-fix134.sql).

   An account could be suspended but never removed, so leavers and mistyped
   accounts stayed forever. Removing one is not a single DELETE: a user's id is
   stamped all over the database — who created an order, who confirmed a
   payment, who reset a password — and pulling the row out from under those
   would either fail or quietly orphan history.

   So the office is shown the footprint first and deletes second. The scan is
   done in the database by COLUMN NAME over the whole schema, not from a list
   kept here, so a table added next year is covered without anyone remembering
   to update this file.

   Two rules the database enforces, not this screen: only a super admin may do
   it, and never to another super admin or to themselves. */

const friendly = (msg = '') =>
  /NOT_AUTHORIZED/i.test(msg)             ? 'Only the super admin can delete a user account.'
  : /CANNOT_DELETE_SELF/i.test(msg)       ? 'You cannot delete the account you are signed in with.'
  : /CANNOT_DELETE_SUPER_ADMIN/i.test(msg)? 'A super admin account cannot be deleted.'
  : /USER_NOT_FOUND/i.test(msg)           ? 'That account no longer exists.'
  : /BLOCKED_BY:/i.test(msg)
    ? `Nothing was deleted — ${msg.replace(/^.*BLOCKED_BY:/i, '').trim()}. `
      + 'That table will not give up the reference, so the account was left exactly as it was.'
  : /admin_user_references|admin_delete_user/i.test(msg) && /does not exist|schema cache/i.test(msg)
    ? 'User deletion isn’t installed yet — run supabase-fix134.sql.'
  : /failed to fetch|networkerror|load failed/i.test(msg)
    ? 'The request didn’t reach the server. Check the connection and try again — nothing was deleted.'
  : msg

/* What this account is attached to. Returns rows of
   { table_name, column_name, rows_found, kind } where kind is:
     own   — the user's own records; they go with the account
     audit — their name on someone else's record; it is cleared, record kept */
export async function scanUserReferences(userId, { actorId } = {}) {
  if (!userId || !actorId) return { rows: [], error: 'Missing user.' }
  try {
    const { data, error } = await supabase.rpc('admin_user_references', {
      p_actor_id: actorId,
      p_user_id:  userId,
    })
    if (error) return { rows: [], error: friendly(error.message) }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: friendly(e?.message || '') || 'Could not read the account’s footprint.' }
  }
}

/* Summary of a scan, for the sentence shown to the super admin. */
export function summariseReferences(rows = []) {
  const own      = rows.filter(r => r.kind === 'own')
  const audit    = rows.filter(r => r.kind === 'audit')
  // A stamp in a column that refuses NULL: it can be neither cleared nor
  // deleted without taking real work with it, so it stops the delete outright.
  const blocking = rows.filter(r => r.kind === 'blocking')
  const total = (list) => list.reduce((n, r) => n + Number(r.rows_found || 0), 0)
  return {
    own, audit, blocking,
    ownRows:      total(own),
    auditRows:    total(audit),
    blockingRows: total(blocking),
    tables:       new Set(rows.map(r => r.table_name)).size,
    clean:        rows.length === 0,
  }
}

/* Delete it. Returns the per-table report the database sends back, so the
   office is told what actually happened rather than "done". */
export async function deleteUserAccount(userId, { actorId } = {}) {
  if (!userId || !actorId) return { report: [], error: 'Missing user.' }
  try {
    const { data, error } = await supabase.rpc('admin_delete_user', {
      p_actor_id: actorId,
      p_user_id:  userId,
    })
    if (error) return { report: [], error: friendly(error.message) }
    return { report: data ?? [], error: null }
  } catch (e) {
    return { report: [], error: friendly(e?.message || '') || 'Could not delete the account.' }
  }
}

/* Plain-language names for the tables a user tends to appear in — the office
   should not have to read schema names to understand what it is agreeing to.
   Anything unlisted falls back to the table's own name, tidied. */
const TABLE_LABELS = {
  user_accounts:            'User accounts',
  user_logbook:             'This user’s activity log',
  user_sessions:            'This user’s sign-in sessions',
  delivery_orders:          'Orders',
  order_items:              'Order items',
  order_services:           'Order services',
  delivery_packages:        'Packages',
  retail_goods_invoices:    'Local-market invoices',
  payment_collections:      'Payment collections',
  contacts:                 'Contacts',
  products:                 'Products',
  product_movements:        'Stock movements',
  shop_inventory:           'Shop items',
  subscriptions:            'Subscriptions',
  subscription_agreements:  'Subscription agreements',
  change_requests:          'Change requests',
  broadcast_messages:       'Messages',
  header_backgrounds:       'Header banners',
  customer_themes:          'Customer app themes',
  purchase_invoices:        'Purchase invoices',
  cashier_box_resets:       'Cashier box resets',
}

export const tableLabel = (name = '') =>
  TABLE_LABELS[name] || name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

/* What the column meant — "created by", "confirmed by" — for the same reason. */
export const columnLabel = (name = '') =>
  name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
