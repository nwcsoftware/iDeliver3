import { supabase, fetchAllRows } from './supabase'
import { subscriptionStatus, isFreeSeatRow, isTrialSubscription, todayStr } from './subscriptions'
import { isPartnerSubscription } from './subscriptionAccounts'
import { SEAT_BY_ROLE } from './billing'
import { fetchSeatSettings } from './seatSettings'
import { fetchPriceFloors } from './subscriptionPrices'
import { fetchSoftwareSubscriptions, paymentSummary } from './softwareSubscriptions'

/* THE SUBSCRIPTIONS STATUS REPORT — every subscription, from the super admin's
   side: what is owed to them, what is paid, what is pending, and what is free.

   Who owes the super admin, by kind:

     software       the office — the yearly fee (Software Subscriptions record)
     partners       the office — the super admin's share of each partner
                    subscription (vendor_amount, fix172); the partner pays the
                    office the selling price, shown alongside
     suppliers      the supplier itself (fix136: a supplier is invoiced for itself) — after
                    its free trial, its monthly plan
     office seats   the office — each administrator / call-centre seat beyond
                    the free ones (a charge on the login, fix146/fix174)
     driver seats   the office — each driver beyond the free ones (a charge on
                    the driver, fix174)

   WHAT IS LISTED. Everything still current (its period has not ended) and
   everything that still owes money, whenever it ended. A period that ended and
   is paid (or free) is history: counted, not listed. Nothing is dropped
   silently — a row that fits no kind is listed under "Other".

   Money is per currency and never added across currencies. An unknown amount
   is counted as unknown, never as zero. */

const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const OFFICE_ROLES = ['admin', 'senior_call_center', 'call_center']

export const KIND_LABEL = {
  software: 'Software — yearly fee',
  partner:  'Partners',
  supplier: 'Suppliers',
  office:   'Office seats',
  driver:   'Driver seats',
  other:    'Other',
}

/* Which kind a subscription row is. */
export function kindOf(r, loginById = new Map()) {
  const types = r?.contact?.contact_types?.length ? r.contact.contact_types : [r?.contact?.contact_type].filter(Boolean)
  if (types.includes('driver')) return 'driver'
  if (!r?.contact_id && r?.user_account_id && OFFICE_ROLES.includes(loginById.get(r.user_account_id)?.role)) return 'office'
  if (isPartnerSubscription(r)) return 'partner'
  if (r?.subscription_role === 'supplier' || isTrialSubscription(r)) return 'supplier'
  return 'other'
}

/* One row, as the super admin reads it: what they are owed for it and where
   that stands. `state` is free | paid | pending | unknown. */
export function lineOf(r, kind, today = todayStr()) {
  const currency = r.currency || 'USD'
  const ended = !!r.end_date && String(r.end_date) < today
  const access = subscriptionStatus(r, today)
  let owed, owedCurrency = currency, state
  if (kind === 'partner') {
    if (isFreeSeatRow(r)) { owed = 0; state = 'free' }
    else if (r.vendor_amount == null) { owed = null; state = 'unknown' }
    else {
      owed = r2(r.vendor_amount); owedCurrency = r.vendor_currency || currency
      state = owed === 0 ? 'free' : r.vendor_settled_at ? 'paid' : 'pending'
    }
  } else {
    owed = r2(r.amount)
    state = owed === 0 ? 'free' : r.is_paid ? 'paid' : 'pending'
  }
  return {
    id: r.id, kind, row: r, ended, access, owed, owedCurrency, state,
    trial: kind === 'supplier' && isTrialSubscription(r),
    // partners: what the partner pays the office, and whether it has
    sold: kind === 'partner' && !isFreeSeatRow(r) ? r2(r.amount) : null,
    soldCurrency: currency,
    partnerPaid: kind === 'partner' ? !!r.is_paid : null,
    // history: ended and nothing owed — counted, not listed
    history: ended && state !== 'pending' && state !== 'unknown',
  }
}

const money = () => ({ owed: 0, paid: 0, pending: 0, unknown: 0 })
function addMoney(bag, l) {
  if (l.state === 'unknown') { (bag[l.soldCurrency] ||= money()).unknown += 1; return }
  const c = (bag[l.owedCurrency] ||= money())
  c.owed = r2(c.owed + (l.owed || 0))
  if (l.state === 'paid') c.paid = r2(c.paid + l.owed)
  if (l.state === 'pending') c.pending = r2(c.pending + l.owed)
}

/* Everything the report shows, from the raw records. Pure: the PDF and the
   tests both read it. */
export function buildSubscriptionReport({ subs: allSubs = [], users: allUsers = [], drivers: allDrivers = [], seats, software = [], today = todayStr() }) {
  // Hidden (test) logins, contacts and subscriptions are not in the report (fix176).
  const hiddenContacts = new Set([...allDrivers.filter(d => d.is_hidden).map(d => d.id)])
  const subs = allSubs.filter(r => !r.is_hidden && !r.contact?.is_hidden && !hiddenContacts.has(r.contact_id))
  const users = allUsers.filter(u => !u.is_hidden)
  const drivers = allDrivers.filter(d => !d.is_hidden)
  const loginById = new Map(users.map(u => [u.id, u]))
  const lines = subs.map(r => lineOf(r, kindOf(r, loginById), today))
  const kinds = {}
  for (const k of ['partner', 'supplier', 'office', 'driver', 'other']) {
    const all = lines.filter(l => l.kind === k)
    const listed = all.filter(l => !l.history)
    const money_ = {}
    for (const l of listed) addMoney(money_, l)
    kinds[k] = {
      key: k, label: KIND_LABEL[k], listed, historyCount: all.length - listed.length,
      count: listed.length,
      free: listed.filter(l => l.state === 'free').length,
      paid: listed.filter(l => l.state === 'paid').length,
      pending: listed.filter(l => l.state === 'pending').length,
      unknown: listed.filter(l => l.state === 'unknown').length,
      money: money_,
    }
  }

  // Partners: the office's own side too — what partners were charged and paid.
  const pSide = {}
  for (const l of kinds.partner.listed) {
    if (l.sold == null) continue
    const c = (pSide[l.soldCurrency] ||= { charged: 0, received: 0, pending: 0 })
    c.charged = r2(c.charged + l.sold)
    if (l.partnerPaid) c.received = r2(c.received + l.sold); else c.pending = r2(c.pending + l.sold)
  }
  kinds.partner.officeSide = pSide
  kinds.partner.freeSeatsHeld = new Set(kinds.partner.listed.filter(l => isFreeSeatRow(l.row)).map(l => l.row.contact_id)).size
  kinds.partner.freeSeatsIncluded = seats?.partner?.included ?? null
  kinds.supplier.inTrial = kinds.supplier.listed.filter(l => l.trial && !l.ended).length
  // Free but not a trial — a plan the super admin priced at 0 (e.g. "System
  // Reserve"). Counted apart, so the free count above always adds up.
  kinds.supplier.freeOther = kinds.supplier.listed.filter(l => l.state === 'free' && !l.trial)
    .map(l => l.row.description || 'priced at 0')

  // Seats: who is inside the free allowance, who is beyond it, and how many of
  // those beyond carry a charge on record.
  const active = users.filter(u => u.status === 'active')
  const seatUse = ['admin', 'call_center'].map(family => {
    const holders = active.filter(u => SEAT_BY_ROLE[u.role] === family)
    const included = seats?.[family]?.included ?? 0
    const beyond = Math.max(0, holders.length - included)
    const charged = kinds.office.listed.filter(l => SEAT_BY_ROLE[loginById.get(l.row.user_account_id)?.role] === family && !l.ended).length
    return { family, label: family === 'admin' ? 'Administrators' : 'Call centre & Senior Call Center',
             active: holders.length, included, beyond, charged, rate: seats?.[family]?.extraRate, currency: seats?.[family]?.currency || 'USD' }
  })
  const activeDrivers = drivers.filter(d => d.is_active !== false).length
  const driverIncluded = seats?.driver?.included ?? 0
  const driverUse = { active: activeDrivers, included: driverIncluded, beyond: Math.max(0, activeDrivers - driverIncluded),
    charged: kinds.driver.listed.filter(l => !l.ended).length, rate: seats?.driver?.extraRate, currency: seats?.driver?.currency || 'USD' }

  // Software: the yearly fee for the current period, paid when a confirmed
  // payment covers to the end of it.
  const sw = software.map(rec => {
    const p = paymentSummary(rec)
    const paid = !!p.coveredUntil && String(p.coveredUntil) >= String(rec.expiry_date || '')
    return { id: rec.id, name: rec.software_name, start: rec.start_date, end: rec.expiry_date, owed: r2(rec.amount),
             owedCurrency: rec.currency || 'USD', state: paid ? 'paid' : 'pending', paidThrough: p.coveredUntil }
  })
  const swMoney = {}
  for (const s of sw) addMoney(swMoney, s)

  // Everything owed to the super admin, per currency.
  const total = {}
  const fold = (bag) => { for (const [c, m] of Object.entries(bag)) { const t = (total[c] ||= money()); for (const k of ['owed', 'paid', 'pending', 'unknown']) t[k] = r2(t[k] + m[k]) } }
  fold(swMoney)
  for (const k of ['partner', 'supplier', 'office', 'driver', 'other']) fold(kinds[k].money)

  return { today, kinds, software: { lines: sw, money: swMoney }, seatUse, driverUse, total }
}

// Never '*' on user_accounts: it also holds the password hashes.
const LOGIN_COLS = 'id, username, role, status, contact_id, created_at'

/* Read every record the report needs, whole (paged past PostgREST's 1000). */
export async function loadSubscriptionReport({ companyId = null } = {}) {
  const [subsQ, usersQ, driversQ, seatsQ, floorsQ, swQ] = await Promise.all([
    fetchAllRows(() => {
      let q = supabase.from('subscriptions')
        .select('*, contact:contacts!contact_id(*)')
        .order('id')
      if (companyId) q = q.eq('company_id', companyId)
      return q
    }),
    fetchAllRows(() => supabase.from('user_accounts').select(LOGIN_COLS + ', is_hidden').order('id'))
      // Before fix176 there is no is_hidden column: read without it.
      .then(r => (r.error ? fetchAllRows(() => supabase.from('user_accounts').select(LOGIN_COLS).order('id')) : r)),
    fetchAllRows(() => supabase.from('contacts').select('*').eq('contact_type', 'driver').order('id')),
    fetchSeatSettings(),
    fetchPriceFloors(),
    fetchSoftwareSubscriptions(companyId),
  ])
  const error = subsQ.error?.message || usersQ.error?.message || driversQ.error?.message || swQ.error || null
  const partial = !!(subsQ.partial || usersQ.partial || driversQ.partial)
  const report = buildSubscriptionReport({
    subs: subsQ.data ?? [], users: usersQ.data ?? [], drivers: driversQ.data ?? [],
    seats: seatsQ.seats, software: (swQ.rows ?? []).filter(x => x.is_active !== false && x.billing_cycle === 'annual'),
  })
  return { report, floors: floorsQ.floors, seats: seatsQ.seats, users: usersQ.data ?? [], error, partial }
}
