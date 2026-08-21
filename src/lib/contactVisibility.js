import { supabase, fetchAllRows } from './supabase'

/* Deactivated contacts, and who may see them.

   A contact with `is_active = false` is retired: the super admin can still see
   it (and its history, and delete it), but for admins, the call centre and
   every other user it is GONE — out of the lists, out of every picker, and its
   orders out of the order lists too. Half-hiding it is worse than not hiding
   it: a name that appears in a dropdown but nowhere else invites orders being
   booked against a dead contact.

   Two deliberate exceptions, because hiding there would corrupt records rather
   than tidy them:

     • Stock movements keep showing who took the goods, deactivated or not. An
       inventory ledger that drops rows stops adding up, and "who has it" is
       exactly what the history is for.
     • Money already recorded (payouts, collections, cashier box) is history and
       is never rewritten by a contact being retired.

   Deactivation itself is guarded — see `contactSettlement` — so a contact can
   only be retired once nothing is owed in either direction. */

/* Only the super admin sees retired contacts. */
export const canSeeInactive = (hasRole) => !!hasRole?.('super_admin')

/* Is this row hidden from the current user? */
export const isHiddenContact = (c, seeInactive) => !seeInactive && c?.is_active === false

/* Filter any list of contacts (or embedded `contact` objects) for the viewer. */
export const visibleContacts = (list = [], seeInactive) =>
  (seeInactive ? list : list.filter(c => c?.is_active !== false))

/* The ids of every retired contact, for filtering rows that only carry an id.

   Loaded once and shared: the orders list, the pickers and the reports all ask
   the same question, and a contact table scan per page would be wasteful. */
export async function fetchInactiveContactIds(companyId = null) {
  try {
    const { data, error } = await fetchAllRows(() => {
      let q = supabase.from('contacts').select('id').eq('is_active', false)
      if (companyId) q = q.eq('company_id', companyId)
      return q
    })
    if (error) return { ids: new Set(), error: error.message }
    return { ids: new Set((data ?? []).map(r => r.id)), error: null }
  } catch (e) {
    return { ids: new Set(), error: e?.message || '' }
  }
}

/* Does this order belong to a retired contact?

   "Belongs to" is read widely on purpose: the customer, a package provider, a
   retail invoice's shop or a sold shop item. Any of them makes the order part
   of that contact's history, and hiding the contact while leaving its orders on
   the daily list would defeat the point. */
export function orderTouchesInactive(order, inactiveIds) {
  if (!order || !inactiveIds || inactiveIds.size === 0) return false
  if (order.customer_id && inactiveIds.has(order.customer_id)) return true
  for (const p of order.delivery_packages ?? []) if (p.provider_id && inactiveIds.has(p.provider_id)) return true
  for (const r of order.retail_goods_invoices ?? []) if (r.contact_id && inactiveIds.has(r.contact_id)) return true
  for (const it of order.order_items ?? []) if (it.supplier_id && inactiveIds.has(it.supplier_id)) return true
  return false
}

/* ── what must be settled before a contact can be retired ───────────────── */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const nonZero = (bag) => Object.entries(bag || {})
  .filter(([, v]) => Math.abs(round2(v)) >= 0.01)
  .map(([cur, v]) => ({ cur, amount: round2(v) }))

/**
 * Everything still open against a contact, so deactivation can be refused with
 * a reason rather than a shrug.
 *
 * Checks, in the order an operator would ask them:
 *   1. orders still open        — work in progress cannot be retired
 *   2. money owed TO the shop   — packages delivered but not paid out
 *   3. money owed BY the party  — an unpaid customer balance
 *
 * @returns { blocked, reasons: [{ key, label, detail }], counts }
 */
export async function contactSettlement(contactId, { orders = [], payouts = [] } = {}) {
  const reasons = []
  if (!contactId) return { blocked: false, reasons }

  /* 1 ── orders that are still running. */
  const open = orders.filter(o =>
    !o.isclosed
    && !['cancelled', 'failed'].includes(String(o.status || '').toLowerCase())
    && (o.customer_id === contactId
        || (o.delivery_packages ?? []).some(p => p.provider_id === contactId)
        || (o.retail_goods_invoices ?? []).some(r => r.contact_id === contactId)
        || (o.order_items ?? []).some(i => i.supplier_id === contactId)))
  if (open.length) {
    reasons.push({
      key: 'open_orders',
      label: `${open.length} order${open.length === 1 ? '' : 's'} still open`,
      detail: open.slice(0, 6).map(o => o.order_number).filter(Boolean).join(', ')
        + (open.length > 6 ? ` and ${open.length - 6} more` : ''),
    })
  }

  /* 2 ── packages delivered for them, less what we have paid out. */
  const owedToParty = {}
  for (const o of orders) {
    if (!o.isclosed) continue
    for (const p of o.delivery_packages ?? []) {
      if (p.provider_id !== contactId || p.paid) continue
      const cur = p.currency || o.currency || 'USD'
      owedToParty[cur] = round2((owedToParty[cur] || 0) + (Number(p.package_price) || 0))
    }
  }
  for (const po of payouts) {
    if (po.partner_id !== contactId) continue
    const cur = po.currency || 'USD'
    owedToParty[cur] = round2((owedToParty[cur] || 0) - (Number(po.amount) || 0))
  }
  const dues = nonZero(owedToParty)
  if (dues.length) {
    reasons.push({
      key: 'partner_dues',
      label: 'Unsettled package dues',
      detail: dues.map(d => `${d.cur} ${d.amount.toLocaleString()}`).join('  +  ')
        + (dues.some(d => d.amount < 0) ? ' (negative = overpaid)' : ''),
    })
  }

  /* 3 ── their own orders that are not fully collected. */
  const owedByParty = {}
  for (const o of orders) {
    if (o.customer_id !== contactId) continue
    if (['cancelled', 'failed'].includes(String(o.status || '').toLowerCase())) continue
    const cur = o.currency || 'USD'
    const total = Number(o.total_amount) || 0
    const paid = (o.payment_collections ?? []).reduce((s, pc) =>
      s + ((pc.currency || 'USD') === cur ? (Number(pc.amount) || 0) : 0), 0)
    const left = round2(total - paid)
    if (left > 0) owedByParty[cur] = round2((owedByParty[cur] || 0) + left)
  }
  const balances = nonZero(owedByParty)
  if (balances.length) {
    reasons.push({
      key: 'customer_balance',
      label: 'Outstanding customer balance',
      detail: balances.map(b => `${b.cur} ${b.amount.toLocaleString()}`).join('  +  '),
    })
  }

  return { blocked: reasons.length > 0, reasons, counts: { openOrders: open.length } }
}
