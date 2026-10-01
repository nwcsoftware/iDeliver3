import { supabase } from './supabase'
import { SEATS, SUPPLIER_SUBSCRIPTION } from './billing'

/* THE MINIMUM PRICE OF A SUBSCRIPTION (fix169).

   The super admin sets it in App Settings — a partner per year, a supplier per
   month. An admin prices each subscription by hand at or above it; nobody but
   the super admin may save one under it, at 0, or empty. The database refuses
   the same (trg_subscriptions_price_floor), so this file is the explanation on
   screen, not the only lock.

   Free partner seats and a supplier's free trial are free by design and are
   never held to it. */

/* Before fix169 is run there is no table: today's prices are the minimums, so
   nothing changes for anyone until the super admin sets new ones. */
export const DEFAULT_FLOORS = {
  partner:  { role: 'partner',  amount: SEATS.partner.extraRate,                currency: 'USD', period: 'year'  },
  supplier: { role: 'supplier', amount: SUPPLIER_SUBSCRIPTION.plans[0].price,   currency: 'USD', period: 'month' },
}

const missingTable = (msg = '') => /subscription_price_floors/i.test(msg) && /not exist|schema cache/i.test(msg)

/* { floors: { partner, supplier }, installed, error } */
export async function fetchPriceFloors() {
  try {
    const { data, error } = await supabase.from('subscription_price_floors').select('*')
    if (error) return { floors: DEFAULT_FLOORS, installed: false, error: missingTable(error.message) ? null : error.message }
    const floors = { ...DEFAULT_FLOORS }
    for (const r of data ?? []) {
      if (floors[r.role]) floors[r.role] = { ...floors[r.role], ...r, amount: Number(r.amount) || floors[r.role].amount }
    }
    return { floors, installed: true, error: null }
  } catch (e) {
    return { floors: DEFAULT_FLOORS, installed: false, error: e?.message || null }
  }
}

const dayNum = (d) => Math.round(new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime() / 86400000)

/* How many of the floor's periods a row covers — the same arithmetic as the
   database, so the screen and the trigger never disagree about a price:
   a one-year partner row is 1, a 30-day supplier row is 1, 90 days is 3. */
export function periodsCovered(start, end, period) {
  if (!start || !end) return 1
  const days = dayNum(end) - dayNum(start) + 1
  return Math.max(1, Math.round(days / (period === 'year' ? 365 : 30.4375)))
}

/* The least a subscription of this kind over these dates may cost. */
export function minimumPrice(role, start, end, floors = DEFAULT_FLOORS) {
  const f = floors?.[role]
  if (!f) return 0
  return Math.round(f.amount * periodsCovered(start, end, f.period) * 100) / 100
}

/* Why this price may not be saved, or '' when it may.
   `exempt` — a free seat, a trial, or the super admin pricing it. */
export function priceProblem({ role, amount, currency = 'USD', start, end, exempt = false }, floors = DEFAULT_FLOORS) {
  if (exempt || !floors?.[role]) return ''
  const f = floors[role]
  if (currency && currency !== f.currency) return `A ${role} subscription is priced in ${f.currency}.`
  const min = minimumPrice(role, start, end, floors)
  const n = Number(amount)
  if (amount === '' || amount == null || !(n > 0)) return `Enter a price — at least ${fmtFloor(min, f.currency)}.`
  if (n < min) return `The minimum for this ${role} subscription is ${fmtFloor(min, f.currency)} (${fmtPerPeriod(f)}).`
  return ''
}

export const fmtFloor = (v, c = 'USD') => `${(Number(v) || 0).toFixed(2)} ${c}`
export const fmtPerPeriod = (f) => `${fmtFloor(f.amount, f.currency)} a ${f.period}`

/* A supplier plan is never sold under the minimum: if the super admin raises it
   above a plan's own price, the plan costs the minimum. */
export const planPrice = (plan, floors = DEFAULT_FLOORS) =>
  Math.max(Number(plan?.price) || 0, Number(floors?.supplier?.amount) || 0)

/* The super admin sets a minimum. */
export async function setPriceFloor(actorId, role, amount) {
  const { data, error } = await supabase.rpc('super_admin_set_subscription_floor', {
    p_actor_id: actorId, p_role: role, p_amount: Number(amount),
  })
  if (error) {
    return /not exist|schema cache/i.test(error.message)
      ? { error: 'Minimum prices need supabase-fix169.sql.' }
      : { error: /NOT_AUTHORIZED/.test(error.message) ? 'Only the super admin can set the minimum prices.' : error.message }
  }
  return { row: data, error: null }
}

/* A database refusal in words — the trigger's message names the minimum. */
export function explainPriceError(msg = '') {
  const m = String(msg)
  if (/PRICE_BELOW_MINIMUM/.test(m)) return m.replace(/^.*PRICE_BELOW_MINIMUM:\s*/, 'Below the minimum price: ')
  if (/SUBSCRIPTION_CURRENCY/.test(m)) return m.replace(/^.*SUBSCRIPTION_CURRENCY:\s*/, 'Wrong currency: ')
  return m
}
