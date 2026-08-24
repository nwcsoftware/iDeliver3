import { supabase } from './supabase'
import { tableLabel, columnLabel } from './userDeletion'

/* Deleting a driver for good (supabase-fix138.sql).

   A driver is a contact, and that contact is referenced from everywhere: the
   orders they carried, their petty cash, their vehicle assignments, their
   settlements, their GPS trail, and — when they have a login — a user account
   that is itself stamped across the schema. Deleting the row on its own fails
   on a foreign key or orphans history, which is why drivers could only ever be
   deactivated before.

   So the super admin is shown the footprint first and deletes second, exactly
   like the user deletion this is modelled on. The scan is done in the database
   from the schema itself (every foreign key that points at contacts), not from
   a list kept here, so a table added next year is covered on its own.

   Two rules the database enforces, not this screen: only a super admin may do
   it, and only to a contact whose type is 'driver'. */

const friendly = (msg = '') =>
  /NOT_AUTHORIZED/i.test(msg)        ? 'Only the super admin can delete a driver.'
  : /CANNOT_DELETE_SELF/i.test(msg)  ? 'You cannot delete the driver linked to the account you are signed in with.'
  : /DRIVER_NOT_FOUND/i.test(msg)    ? 'That driver no longer exists.'
  : /NOT_A_DRIVER/i.test(msg)
    ? 'That contact is not a driver. Only a contact whose type is “driver” can be removed here.'
  : /BLOCKED_BY:/i.test(msg)
    ? `Nothing was deleted — ${msg.replace(/^.*BLOCKED_BY:/i, '').trim()}. `
      + 'That table will not give up the reference, so the driver was left exactly as they were.'
  : /admin_driver_references|admin_delete_driver/i.test(msg) && /does not exist|schema cache/i.test(msg)
    ? 'Driver deletion isn’t installed yet — run supabase-fix138.sql.'
  : /failed to fetch|networkerror|load failed/i.test(msg)
    ? 'The request didn’t reach the server. Check the connection and try again — nothing was deleted.'
  : msg

/* What this driver is attached to. Rows of { table_name, column_name,
   rows_found, kind }, where kind is one of:

     own      records that exist only because of this driver — deleted
     orders   the orders they carried — the caller chooses their fate
     account  their login — deleted with them, its stamps cleared
     audit    a reference on somebody else's record — cleared, record kept
     blocking a reference that cannot be emptied — stops the delete */
export async function scanDriverReferences(driverId, { actorId } = {}) {
  if (!driverId || !actorId) return { rows: [], error: 'Missing driver.' }
  try {
    const { data, error } = await supabase.rpc('admin_driver_references', {
      p_actor_id:  actorId,
      p_driver_id: driverId,
    })
    if (error) return { rows: [], error: friendly(error.message) }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: friendly(e?.message || '') || 'Could not read the driver’s footprint.' }
  }
}

/* Summary of a scan, for the sentences shown in the review. */
export function summariseDriverReferences(rows = []) {
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

/* Delete them. `deleteOrders` decides what happens to the orders they carried:
   true removes each order and everything on it, false keeps the orders and
   only takes the driver's name off them. Returns the database's own per-table
   report, so the office is told what actually happened rather than "done". */
export async function deleteDriver(driverId, { actorId, deleteOrders = false } = {}) {
  if (!driverId || !actorId) return { report: [], error: 'Missing driver.' }
  try {
    const { data, error } = await supabase.rpc('admin_delete_driver', {
      p_actor_id:      actorId,
      p_driver_id:     driverId,
      p_delete_orders: !!deleteOrders,
    })
    if (error) return { report: [], error: friendly(error.message) }
    return { report: data ?? [], error: null }
  } catch (e) {
    return { report: [], error: friendly(e?.message || '') || 'Could not delete the driver.' }
  }
}

/* Plain-language names for the driver-side tables, on top of the shared list
   the user deletion already carries. */
const DRIVER_TABLE_LABELS = {
  driver_petty_cash:          'Petty cash held by the driver',
  driver_daily_settlements:   'Daily settlements',
  driver_settlements:         'Settlements',
  driver_settlement_orders:   'Settled orders',
  driver_vehicle_assignments: 'Vehicle assignments',
  driver_locations:           'GPS trail',
  driver_collections:         'Driver collections',
  contact_addresses:          'Their addresses',
  contact_documents:          'Their documents',
  vehicle_fuel_logs:          'Fuel logs',
  vehicle_mileage_logs:       'Mileage logs',
  returnable_issuances:       'Returnable items issued',
  salary_records:             'Payslips',
  payroll_periods:            'Payroll periods',
  audit_logs:                 'Audit log entries',
}

export const driverTableLabel = (name = '') => DRIVER_TABLE_LABELS[name] || tableLabel(name)
export { columnLabel }

/* What the review shows in the "on delete" column, per kind. */
export const KIND_TEXT = {
  own:      'deleted with the driver',
  orders:   'see the choice below',
  account:  'their login is deleted',
  audit:    'reference cleared, record kept',
  blocking: 'blocks the delete',
}
