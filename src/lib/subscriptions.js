import { supabase } from './supabase'
import {
  SEATS, SUPPLIER_SUBSCRIPTION, rateFor, perMonth, CURRENCY, UNPAID_GRACE_DAYS,
  DAYS_PER_MONTH, RATE_TOLERANCE,
} from './billing'

/* Supplier / partner subscriptions (supabase-fix110.sql).

   A 2nd party may only sign in while they have a subscription that is active,
   paid, and inside its date window — the super admin flips `is_paid` once the
   money is confirmed and `is_active` to let them in. */

/* Local YYYY-MM-DD (dates are stored as DATE, i.e. day-precision, no timezone). */
export function todayStr(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* ── who has to subscribe ─────────────────────────────────────────────────

   Not every 2nd party pays. Suppliers always do. Partners are the company's
   own recruitment: the first ten came in free, and only the ELEVENTH onward
   subscribes.

   "First ten" is by the order they were created, counted over the partners who
   actually HOLD A SEAT — live contacts with a login. A partner contact nobody
   can sign in as consumes nothing: it has no subscription (fix136) and no
   access, so counting it would push a real partner out of the ten included in
   the annual package and start billing for it.

   Ten slots, held by the ten longest-standing partners with an ACTIVE login:
   retire one — a duplicate, or a shop that has left — or remove or DEACTIVATE
   its login, and the slot passes to the next in line rather than being spent
   forever on a contact nobody deals with any more.

   Active, not merely existing. A deactivated login cannot sign in at all —
   verify_login refuses status 'inactive' before the password is looked at —
   so it gives nobody anything. It used to keep its free seat regardless: Cesar
   The Shopper's login was deactivated seven minutes after it was made, never
   used once, and still held seat #10 while Bellagio, next in line, was billed.
   User Accounts already said deactivating hands the seat back; this makes the
   ranking, the sign-in check and the billing check say the same. */

/* Which logins hold a seat. ONE definition, used by every place that ranks
   partners — the Subscriptions and User Accounts pages, the sign-in check and
   the type-change billing check — so they cannot disagree about who is #10. */
export const SEAT_LOGIN_STATUS = 'active'
export const holdsSeatLogin = (u) => !!u?.contact_id && u.status === SEAT_LOGIN_STATUS
export const seatHolderIds  = (users = []) =>
  new Set((users ?? []).filter(holdsSeatLogin).map(u => u.contact_id))

/* A contact tagged as both supplier and partner is a supplier: it sells to us,
   which is the side that pays. */

export const PARTNER_FREE_LIMIT = SEATS.partner.included

const typesOf = (c) => {
  const list = Array.isArray(c?.contact_types) ? c.contact_types : []
  return list.length ? list : (c?.contact_type ? [c.contact_type] : [])
}
export const isSupplierContact = (c) => typesOf(c).includes('supplier')
export const isPartnerContact  = (c) => typesOf(c).includes('partner')

export const SCOPE = {
  supplier:     'supplier',      // a supplier login: always subscribes
  partnerFree:  'partner-free',  // a partner login whose partner holds an active free seat
  partnerPaid:  'partner-paid',  // a partner login without one: pays for its seat
  notParty:     'not-party',     // neither — nothing to subscribe to
  unknown:      'unknown',       // the lookup failed; treated as exempt
}

/* FREE PARTNER SEATS (fix163).

   A free seat is not a place in a queue; it is a record. It is a subscription
   row marked is_free_seat — 0 USD, one year — held by the PARTNER: every
   partner login of that partner gets its own free row for the same year. The
   seat stays theirs for the whole year whatever happens to their logins, and
   only when the year ends is it free again, for an administrator to assign to
   a partner by hand (assign_free_partner_seat).

   This replaced "the first ten partners by creation date", which moved a seat
   the moment somebody older left, was deactivated or was retyped.

   Two questions, answered from the same rows:
     HELD    in date — counts against the ten, even if switched off
     ACTIVE  in date AND switched on — lets that partner's logins in free */
export const isFreeSeatRow = (r) =>
  !!r && (r.is_free_seat === true
    || (r.is_free_seat == null && Number(r.amount) === 0 && /^Included partner seat/i.test(r.description || '')))

/* contact_id → { start, end, active } for every partner holding an in-date seat. */
export function freeSeatMap(rows = [], today = todayStr()) {
  const map = new Map()
  for (const r of rows || []) {
    if (!isFreeSeatRow(r) || !r.contact_id) continue
    if (!(String(r.start_date) <= today && today <= String(r.end_date))) continue
    const cur = map.get(r.contact_id)
    const seat = { start: r.start_date, end: r.end_date, active: !!r.is_active || !!cur?.active }
    if (!cur || String(r.end_date) > String(cur.end)) map.set(r.contact_id, seat)
    else if (r.is_active) cur.active = true
  }
  return map
}

/* A login's scope: its ROLE decides what it subscribes to, and for a partner
   login, whether its partner holds an active free seat. `seat` is the entry
   from freeSeatMap() for this contact, or null. When no role is given, the
   contact's own type answers (supplier first, as before). */
export function scopeFor(contact, seat = null, role = null) {
  const kind = role === 'supplier' || role === 'partner' ? role
    : isSupplierContact(contact) ? 'supplier'
    : isPartnerContact(contact) ? 'partner' : null
  if (!kind) return { subject: false, scope: SCOPE.notParty, seat: null }
  if (kind === 'supplier') return { subject: true, scope: SCOPE.supplier, seat: null }
  if (seat?.active) return { subject: false, scope: SCOPE.partnerFree, seat }
  return { subject: true, scope: SCOPE.partnerPaid, seat: seat || null }
}

/* The whole answer for one contact and login role. Fails OPEN — an unanswerable
   question must not invent a bill or lock someone out. */
export async function subscriptionScope(contactId, role = null) {
  if (!contactId) return { subject: false, scope: SCOPE.notParty, seat: null, contact: null }
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, code, contact_type, contact_types, created_at')
      .eq('id', contactId)
      .maybeSingle()
    if (error || !data) return { subject: false, scope: SCOPE.unknown, seat: null, contact: null }
    const { data: seatRows } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('contact_id', contactId)
    const seat = freeSeatMap(seatRows ?? []).get(contactId) || null
    return { ...scopeFor(data, seat, role), contact: data }
  } catch {
    return { subject: false, scope: SCOPE.unknown, seat: null, contact: null }
  }
}

/* How many of the ten free seats are held today, and when the next one frees. */
export function freeSeatsSummary(rows = [], today = todayStr()) {
  const map = freeSeatMap(rows, today)
  const ends = [...map.values()].map(v => String(v.end)).sort()
  return { inUse: map.size, limit: PARTNER_FREE_LIMIT, available: Math.max(0, PARTNER_FREE_LIMIT - map.size),
           nextFreesOn: ends[0] || null, map }
}

/* ── what each party type pays ────────────────────────────────────────────

   A partner and a supplier are not the same customer to us, and they are not
   billed the same. The rate is therefore a property of WHAT SOMEONE IS, not of
   the row they happen to hold — which is what makes a change of type a billing
   event rather than a piece of paperwork.

   Change a partner into a supplier and their subscription is instantly worth
   less than it needs to be: they are paying the partner rate for a supplier's
   access. The difference is due for whatever is left of the period, and until
   it is settled the account does not open. Nobody — the party, the admin who
   made the change — can step around that, because the check is run on every
   sign-in, on every session rehydrate, and every five minutes while the portal
   is open, from the CURRENT contact type and the CURRENT subscription. */

export const RATE_CURRENCY = CURRENCY

/* What a party of this kind is charged, and over what period. The two are not
   the same arrangement and never should be flattened together:

     partner   USD 10 a YEAR, and only from the eleventh — the first ten are
               seats already paid for inside the annual package
     supplier  USD 10/18/25 a MONTH depending on the plan they renewed onto,
               outside the annual package entirely

   `planKey` is the plan the supplier accepted; without one the entry plan is
   assumed, which is the least the software may ask for. */
export function rateForScope(scope, { planKey = null } = {}) {
  if (!scope?.subject) return { amount: 0, period: 'month', monthly: 0, yearly: 0 }
  return scope.scope === SCOPE.supplier
    ? rateFor('supplier', { planKey })
    : rateFor('partner')
}

/* Everything downstream compares monthly figures, because a subscription row
   is measured in days and the shorter period is the honest common ground. */
export function requiredMonthlyRate(scope, opts = {}) {
  return rateForScope(scope, opts).monthly
}

const DAY = 86400000
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

/* Whole days a subscription still has to run, from today. */
export function daysRemaining(row, today = todayStr()) {
  const left = daysUntilDate(row?.end_date, today)
  return left == null ? 0 : Math.max(0, left)
}

/* What a row actually charges per month. A period is measured in 30-day
   months, so a 90-day subscription at 30 USD is 10 USD a month. A free trial
   charges nothing — and is left alone by the upgrade rule below. */
export function monthlyRateOf(row) {
  const amount = Number(row?.amount) || 0
  if (amount === 0) return 0
  const start = row?.start_date, end = row?.end_date
  if (!start || !end) return amount
  const days = Math.max(1, Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / DAY))
  return round2(amount / (days / DAYS_PER_MONTH))
}

/* Is what they hold enough for who they now are?

   Returns { ok, required, paying, perMonth, days, due }. `due` is the
   difference for the REMAINING days — the 8 USD in "partner 2, supplier 10,
   change today with 24 days left" is charged for those 24 days, not for a
   month nobody is getting.

   A free trial is deliberately never short: a supplier gets a free trial too,
   so converting during one changes nothing until it ends. */
export function subscriptionShortfall(row, scope, today = todayStr(), opts = {}) {
  const rate     = rateForScope(scope, opts)
  const required = rate.monthly
  const paying   = monthlyRateOf(row)
  const days     = daysRemaining(row, today)
  const free     = Number(row?.amount) === 0
  if (!row || required <= 0 || free || paying >= required - RATE_TOLERANCE) {
    return { ok: true, required, paying, perMonth: 0, days, due: 0, rate }
  }
  const short = round2(required - paying)
  return { ok: false, required, paying, perMonth: short, days, due: round2(short * (days / DAYS_PER_MONTH)), rate }
}

/* Status of one subscription row, as shown in the list. */
export function subscriptionStatus(row, today = todayStr()) {
  if (!row) return 'none'
  /* UNPAID IS TESTED FIRST, AND THE ORDER MATTERS.

     A seat placed and awaiting payment is written is_paid = false AND
     is_active = false — not paid, and not switched on because it has not been
     paid. Asking about is_active first called every one of those "deactivated",
     so the Unpaid filter on the Subscriptions page could never match a single
     row while six seats sat there owing money, and the partner was told their
     subscription "is not active" rather than that it is waiting to be paid.

     Money owed is the more useful fact and the more actionable one, so it wins.
     "Deactivated" now means what it sounds like: a subscription that WAS paid
     and has since been switched off.

     Access is unchanged either way — isSubscriptionActive() admits only
     'active', and neither of these is. */
  if (!row.is_paid) {
    /* ACTIVATED ON CREDIT (fix159). The super admin switched it on for its
       whole period with the money still due. Unlike trust there is no clock:
       it runs to its end date like a paid one — but it keeps saying the
       payment is due, and sits on the Due Payments report, until the payment
       is recorded with its reference. Past its end date it is simply expired. */
    if (row.is_active && row.credit_granted_at) {
      if (row.start_date && today < row.start_date) return 'scheduled'
      if (row.end_date   && today > row.end_date)   return 'expired'
      return 'credit'
    }
    /* ACTIVATED ON TRUST. A super admin may switch an unpaid subscription on so
       the party can work while a payment is in flight (fix149) — but on a clock.
       While it runs the row is treated as live; when it lapses the door closes
       again, without anybody having to remember to close it. The row goes on
       saying UNPAID throughout, because it is. */
    if (row.is_active && row.grace_started_on) {
      return graceDaysLeft(row, today) > 0 ? 'grace' : 'grace_over'
    }
    return 'unpaid'
  }
  if (row.is_active === false) return 'deactivated'
  if (row.start_date && today < row.start_date) return 'scheduled'
  if (row.end_date   && today > row.end_date)   return 'expired'
  return 'active'
}

/* Days left on an indulgence — positive while it runs, 0 or less once it has
   lapsed. Counted in whole days from the day it was granted. */
export function graceDaysLeft(row, today = todayStr()) {
  if (!row?.grace_started_on) return 0
  const start = new Date(`${String(row.grace_started_on).slice(0, 10)}T00:00:00`)
  const now   = new Date(`${today}T00:00:00`)
  const used  = Math.floor((now - start) / 86400000)
  return UNPAID_GRACE_DAYS - used
}

/* A subscription admits its party while it is genuinely active OR inside an
   indulgence. Those are the only two ways in. */
export const isSubscriptionActive = (row, today = todayStr()) =>
  ['active', 'grace', 'credit'].includes(subscriptionStatus(row, today))

export const STATUS_STYLES = {
  active:      { label: 'Active',       cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
  scheduled:   { label: 'Scheduled',    cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  expired:     { label: 'Expired',      cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  unpaid:      { label: 'Unpaid',       cls: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30' },
  grace:       { label: 'Unpaid — on trust', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  grace_over:  { label: 'Trust expired', cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  credit:      { label: 'Active — payment due', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  deactivated: { label: 'Deactivated',  cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
}

/* WHO A SUBSCRIPTION ROW BELONGS TO (fix160).

   A partner may hold several logins, and each login carries its own
   subscription. A row names the contact (whose business it is) and the login
   (who it lets in). A row with no login yet is the contact's unassigned one —
   placed before anybody could sign in — and it is handed to the first login
   created for that contact rather than a second charge being raised. */
export const ownerKey = (r) => r?.user_account_id || r?.contact_id || null

/* The rows that decide what ONE login may do: its own, plus any of the
   contact's rows not yet given to a login. */
export const rowsForLogin = (rows = [], userId = null) =>
  (rows || []).filter(r => !r?.user_account_id || (userId && r.user_account_id === userId))

/* How a subscription can be paid, offered when the super admin records it. */
export const PAYMENT_METHODS = ['Cash', 'OMT', 'Whish', 'Bank transfer', 'Cheque', 'Other']

/* Money still owed on a subscription row — not paid, and not zero. */
export const isAmountDue = (row) => !!row && !row.is_paid && Number(row.amount) > 0

/* All subscriptions with their contact, newest first. */
export async function fetchSubscriptions(companyId = null) {
  try {
    let q = supabase
      .from('subscriptions')
      .select('*, contact:contacts!contact_id(id,first_name,last_name,company_name,code,contact_types,mobile)')
      .order('created_at', { ascending: false })
    if (companyId) q = q.eq('company_id', companyId)
    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load subscriptions.' }
  }
}

/* One 2nd party's own subscriptions (their "My Subscription" screen), newest
   period first. */
export async function fetchSubscriptionsForContact(contactId) {
  if (!contactId) return { rows: [], error: null }
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('contact_id', contactId)
      .order('end_date', { ascending: false })
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load your subscription.' }
  }
}

/* Whole days left until a subscription ends (0 on the last day, negative once
   it has passed). */
export function daysLeft(endDate, today = todayStr()) {
  if (!endDate) return null
  const ms = new Date(`${endDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()
  return Math.round(ms / 86400000)
}

/* Does this contact have a subscription letting them in right now?
   Returns { allowed, reason }. When the table doesn't exist yet (migration not
   run) access is ALLOWED, so installing the app doesn't lock out every partner
   before the super admin has entered any subscription. */
export async function checkSubscriptionAccess(contactId, role = null, userId = null) {
  if (!contactId) return { allowed: false, reason: 'no-contact', row: null }
  try {
    const scope = await subscriptionScope(contactId, role)

    /* THE LOGIN'S ROLE MUST STILL MATCH WHAT THE CONTACT IS.

       This is the hole Kitchefia fell through. Its contact was changed to
       `customer` while its login kept role `partner`. scopeFor then answered
       "not a party" — subject: false — and the branch below let it in as
       EXEMPT: a partner portal opened for a contact that was no longer a
       partner, with no subscription and no seat.

       So the role is checked against the contact first. A login that says
       partner or supplier is only allowed while its contact still carries that
       type; change the contact back to a customer and the door closes, which is
       what changing it was supposed to mean. */
    if (role === 'partner' || role === 'supplier') {
      const holds = role === 'supplier' ? isSupplierContact(scope.contact) : isPartnerContact(scope.contact)
      if (scope.contact && !holds) {
        return { allowed: false, reason: 'role-mismatch', row: null, scope: scope.scope, role }
      }
    }

    /* A partner login whose partner holds an ACTIVE free seat is let in: the
       seat is the partner's, so every one of its partner logins is free for
       that year (fix163). A supplier login never is — a free partner seat does
       not buy supplier access. */
    if (!scope.subject) {
      return { allowed: true, reason: 'exempt', row: null, scope: scope.scope, rank: scope.rank }
    }
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')   // every column: status needs grace_started_on and credit_granted_at,
                     // and naming columns here once left trust unreadable at sign-in
      .eq('contact_id', contactId)
    if (error) {
      if (/subscriptions/i.test(error.message) && /not exist|schema cache/i.test(error.message)) {
        return { allowed: true, reason: 'not-installed', row: null }
      }
      return { allowed: true, reason: 'lookup-failed', row: null }   // never lock someone out on a network blip
    }
    /* This LOGIN's rows: a partner with three logins holds three
       subscriptions, and one of them being paid must not open the other two. */
    const rows = rowsForLogin(data ?? [], userId)
    if (rows.length === 0) return { allowed: false, reason: 'none', row: null }

    const active = rows.find(r => isSubscriptionActive(r))
    if (active) {
      /* The row is live — but is it the right row for who they are TODAY? A
         partner promoted to supplier keeps a subscription that no longer buys
         what they now have access to. */
      const short = subscriptionShortfall(active, scope)
      if (!short.ok) {
        return { allowed: false, reason: 'upgrade-required', row: active, scope: scope.scope, shortfall: short }
      }
      return { allowed: true, reason: 'active', row: active, scope: scope.scope }
    }

    // Nothing lets them in — report on the most relevant blocked subscription
    // (the one that ran/runs latest) so the message can name real dates.
    const byEnd = rows.slice().sort((a, b) => String(b.end_date || '').localeCompare(String(a.end_date || '')))
    const pick = st => byEnd.find(r => subscriptionStatus(r) === st)
    for (const st of ['grace_over', 'unpaid', 'scheduled', 'expired', 'deactivated']) {
      const row = pick(st)
      if (row) return { allowed: false, reason: st, row }
    }
    return { allowed: false, reason: 'deactivated', row: byEnd[0] ?? null }
  } catch {
    return { allowed: true, reason: 'lookup-failed', row: null }
  }
}

export const ACCESS_MESSAGES = {
  'upgrade-required': 'Your account type changed, and your subscription no longer covers it. Please contact the administrator to settle the difference.',
  none:        'Your subscription hasn’t been set up yet. Please contact the administrator.',
  unpaid:      'Your subscription is awaiting payment confirmation. Please contact the administrator.',
  scheduled:   'Your subscription hasn’t started yet. Please contact the administrator.',
  expired:     'Your subscription has expired. Please contact the administrator to renew it.',
  grace_over:  'Your subscription was opened while payment was still outstanding, and that period has ended. '
               + 'Please contact the administrator to settle it.',
  deactivated: 'Your subscription is not active. Please contact the administrator.',
  'no-contact': 'Your login isn’t linked to a supplier/partner contact. Please contact the administrator.',
  'role-mismatch': 'Your contact is no longer registered as a partner or supplier, so this portal is closed to you. Please contact the administrator.',
}

const money = (v, c) => `${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`

const dmy = (d) => {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : String(d)
}

/* The sign-in refusal shown to a supplier/partner: why they're blocked, plus
   the details of the subscription it refers to (or that none exists). */
const money2 = (v) => (Number(v) || 0).toFixed(2)

export function accessDeniedMessage(reason, row, extra = null) {
  const base = ACCESS_MESSAGES[reason] || ACCESS_MESSAGES.deactivated
  if (!row) {
    return reason === 'none'
      ? 'You don’t have a subscription yet, so sign-in is not allowed. Please contact the administrator to set one up.'
      : base
  }
  const label  = row.description ? `“${row.description}”` : 'Your subscription'
  const period = `${dmy(row.start_date)} → ${dmy(row.end_date)}`
  const amount = Number(row.amount) > 0 ? ` · ${money(row.amount, row.currency)}` : ''
  const detail = `${label}: ${period}${amount}`

  switch (reason) {
    case 'upgrade-required': {
      const s = extra?.shortfall
      const money = s ? `${money2(s.due)} ${RATE_CURRENCY}` : 'the difference'
      return `Your account is now a ${extra?.scope === SCOPE.supplier ? 'supplier' : 'partner'} account, `
        + `which subscribes at ${money2(s?.required)} ${RATE_CURRENCY} a month — you are on `
        + `${money2(s?.paying)} ${RATE_CURRENCY}.\n${detail}\n`
        + `${money} is due for the ${s?.days ?? 0} day${s?.days === 1 ? '' : 's'} left on this period. `
        + 'Please contact the administrator to settle it; your account opens as soon as it is confirmed.'
    }
    case 'expired':
      return `Your subscription expired on ${dmy(row.end_date)}.\n${detail}\nPlease contact the administrator to renew it.`
    case 'unpaid':
      return `Your subscription is awaiting payment confirmation.\n${detail}\nIt will be activated once the administrator confirms the payment.`
    case 'scheduled':
      return `Your subscription starts on ${dmy(row.start_date)}.\n${detail}\nYou can sign in from that date.`
    case 'deactivated':
      return `Your subscription has been deactivated by the administrator.\n${detail}\nPlease contact them to reactivate it.`
    default:
      return `${base}\n${detail}`
  }
}

export async function saveSubscription(row, { companyId = null, userId = null } = {}) {
  const payload = {
    contact_id:   row.contact_id,
    description:  row.description?.trim() || null,
    start_date:   row.start_date,
    end_date:     row.end_date,
    amount:       Number(row.amount) || 0,
    currency:     row.currency || 'USD',
    is_paid:      !!row.is_paid,
    paid_at:      row.is_paid ? (row.paid_at || new Date().toISOString()) : null,
    paid_by_note: row.paid_by_note?.trim() || null,
    is_active:    !!row.is_active,
    updated_at:   new Date().toISOString(),
  }
  /* The trust, credit and payment-detail columns are written whenever the row
     CARRIES them — and left alone when it does not, so saving the edit form
     (which knows nothing of them) never wipes a recorded reference, and a
     database without fix159 is not sent columns it lacks.

     Before this, none of them were written at all: “activate on trust” sent
     grace_started_on and it was silently dropped here, so the 15-day clock
     never started and the row read as plain Unpaid — at sign-in too. */
  for (const k of ['user_account_id', 'grace_started_on', 'grace_granted_by', 'credit_granted_at', 'credit_granted_by',
                   'payment_method', 'payment_reference', 'paid_recorded_by']) {
    if (row[k] !== undefined) payload[k] = row[k] === '' ? null : row[k]
  }
  if (row.id) {
    const { error } = await supabase.from('subscriptions').update(payload).eq('id', row.id)
    return error ? error.message : null
  }
  const { error } = await supabase.from('subscriptions').insert([{
    ...payload,
    ...(companyId ? { company_id: companyId } : {}),
    created_by: userId,
  }])
  return error ? error.message : null
}

export async function deleteSubscription(id) {
  const { error } = await supabase.from('subscriptions').delete().eq('id', id)
  return error ? error.message : null
}

/* Display name for a subscription's contact. */
export function contactLabel(c) {
  if (!c) return 'Unknown contact'
  const name = (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unnamed'
  return c.code ? `${name} (${c.code})` : name
}

/* ── expiry notice (the bar in the portal header) ───────────────────────── */

export const SUBSCRIPTION_NOTICE_DAYS = 30

/* Whole days from `today` to `dateStr`; negative once the date has passed. */
export function daysUntilDate(dateStr, today = todayStr()) {
  if (!dateStr) return null
  const a = new Date(`${today}T00:00:00`)
  const b = new Date(`${dateStr}T00:00:00`)
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

/* What a 2nd party should be warned about, from their own subscription rows.

   Only a subscription that is PAID and ACTIVE counts as cover, so the notice
   follows the same rule that lets them sign in. The furthest such end date is
   their real expiry — a renewal already paid and activated therefore clears the
   notice by itself. A later row that is not yet paid/activated does not count
   as cover, but is reported as a pending renewal so the wording can say so.

   Returns null when there is nothing to say. */
export function subscriptionNotice(rows, today = todayStr(), withinDays = SUBSCRIPTION_NOTICE_DAYS) {
  const list = rows ?? []
  const covering = list.filter(r => r.is_paid && r.is_active && r.end_date)
  const current  = covering.sort((a, b) => String(a.end_date).localeCompare(String(b.end_date))).pop() || null

  // Anything dated past the cover that hasn't been paid/activated yet.
  const pendingRenewal = list.some(r =>
    r.end_date && (!current || r.end_date > current.end_date) && !(r.is_paid && r.is_active))

  if (!current) return { row: null, days: null, expired: true, pendingRenewal, none: true }

  const days = daysUntilDate(current.end_date, today)
  if (days == null || days > withinDays) return null
  return { row: current, days, expired: days < 0, pendingRenewal, none: false }
}

/* ── renewal stage (the four steps shown in the Subscriptions list) ────────

   The status column answers "does this let them in today?"; this answers "when
   does it need renewing?", which is a different question and the one the super
   admin plans around. Four steps, by days left on the end date:

     ok       more than 30 days  — nothing to do
     due      30 days or less    — needs attention
     urgent   15 days or less    — needs attention now
     expired  the date has passed and nothing has replaced it

   A row whose date has passed but which a later paid-and-active period covers
   is 'renewed', not expired: the money came in, this one simply had its turn.
   That distinction is why the list can strike out only what really lapsed. */

export const RENEWAL_WARN_DAYS   = 30
export const RENEWAL_URGENT_DAYS = 15

export const RENEWAL_STAGES = {
  ok:      { label: 'Active',   cls: 'text-green-300  bg-green-500/10  border-green-500/30' },
  due:     { label: 'Due soon', cls: 'text-amber-300  bg-amber-500/10  border-amber-500/30' },
  urgent:  { label: 'Urgent',   cls: 'text-red-300    bg-red-500/10    border-red-500/30' },
  expired: { label: 'Expired',  cls: 'text-red-400    bg-red-500/15    border-red-500/40' },
  renewed: { label: 'Renewed',  cls: 'text-slate-400  bg-slate-500/10  border-slate-500/30' },
  idle:    { label: 'Not in force', cls: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
  unknown: { label: 'No end date', cls: 'text-slate-500 bg-slate-500/10 border-slate-500/20' },
}

/* Contacts that hold cover reaching today or beyond — i.e. someone whose older
   periods have been renewed rather than left to lapse. Paid AND active only,
   because that is what actually lets them sign in. */
export function coveredContactIds(rows = [], today = todayStr()) {
  const ids = new Set()
  for (const r of rows) {
    if (r?.is_paid && r?.is_active && r?.end_date && r.end_date >= today) ids.add(ownerKey(r))
  }
  return ids
}

/* One row's renewal stage. `covered` = this contact has later cover in place. */
export function renewalStage(row, today = todayStr(), covered = false) {
  const days = daysUntilDate(row?.end_date, today)
  if (days == null) return { stage: 'unknown', days: null }
  if (days < 0)                      return { stage: covered ? 'renewed' : 'expired', days }
  if (days <= RENEWAL_URGENT_DAYS)   return { stage: 'urgent',  days }
  if (days <= RENEWAL_WARN_DAYS)     return { stage: 'due',     days }
  return { stage: 'ok', days }
}

/* "12 days", "today", "3 days ago" — the days column reads as a sentence. */
export function daysLeftLabel(days) {
  if (days == null) return '—'
  if (days === 0)   return 'ends today'
  if (days < 0)     return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  return `${days} day${days === 1 ? '' : 's'}`
}

/* Everything the super admin's summary strip shows, in one pass over the list.

   Money is kept per currency and never added across them: a total that mixed
   USD and LBP would be a number with no meaning. */
export function subscriptionsSummary(rows = [], today = todayStr()) {
  const covered = coveredContactIds(rows, today)
  const out = {
    total: rows.length,
    active: 0, unpaid: 0, scheduled: 0, expired: 0, deactivated: 0,
    credit: 0,                               // activated with the money still due (fix159)
    renewed: 0,                              // ran out, but a newer period covers them
    due: 0, urgent: 0,                       // renewals coming up (still in date)
    value: {}, activeValue: {}, expiredValue: {},   // { USD: n, LBP: n, … }
    parties: new Set(),
  }
  const add = (bucket, cur, amt) => {
    const c = String(cur || 'USD').toUpperCase()
    bucket[c] = (bucket[c] || 0) + (Number(amt) || 0)
  }
  for (const r of rows) {
    const st = subscriptionStatus(r, today)
    const { stage } = renewalStage(r, today, covered.has(ownerKey(r)))
    if (r.contact_id) out.parties.add(r.contact_id)

    // 'expired' counts what actually lapsed. A period that ended and was then
    // renewed is history, not a hole — counting it as expired would keep the
    // figure climbing for customers who never missed a day.
    if (st === 'expired') { if (stage === 'renewed') out.renewed += 1; else out.expired += 1 }
    else if (out[st] != null) out[st] += 1

    add(out.value, r.currency, r.amount)
    if (st === 'active')                            add(out.activeValue,  r.currency, r.amount)
    if (st === 'expired' && stage === 'expired')    add(out.expiredValue, r.currency, r.amount)

    // Only a live subscription can be "coming up for renewal".
    if (st === 'active') {
      if (stage === 'due')    out.due    += 1
      if (stage === 'urgent') out.urgent += 1
    }
  }
  out.partyCount = out.parties.size
  return out
}

/* ── the free introductory subscription ────────────────────────────────────

   A supplier or partner cannot sign in without a subscription, so a brand-new
   one would be created and immediately locked out until the super admin got
   round to entering a period by hand. Instead the system issues a free 90-day
   subscription the moment the contact is created: paid (there is nothing to
   pay), activated, starting today.

   After that it is manual — only the super admin renews it, on the
   Subscriptions page, which is where the countdown and the renewal warnings
   already live.

   Deliberately narrow: it fires only for supplier/partner contacts, and only
   when that contact has NO subscription row at all, so it can never issue a
   second trial, extend an expired one, or overwrite a paid period. That makes
   it safe to call after any contact save. */

export const TRIAL_DAYS = SUPPLIER_SUBSCRIPTION.trialDays
export const TRIAL_DESCRIPTION = `Free ${TRIAL_DAYS}-day introductory subscription`

/* Who is invoiced for a subscription (fix136).

   A partner does not pay us — 3asari3 is billed for its partners, ten inside
   the annual package and USD 10 a year for each one beyond. A supplier pays
   for itself, monthly. Same table, two payers. */
export const BILLED_TO = { company: 'company', party: 'party' }
export const billedToFor = (scope) =>
  scope?.scope === SCOPE.supplier ? BILLED_TO.party : BILLED_TO.company

/* YYYY-MM-DD, `days` after the given day. */
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return dateStr
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

export const isTrialSubscription = (row) =>
  Number(row?.amount) === 0 && /introductory|trial/i.test(String(row?.description || ''))

/* Give a newly created 2nd party their free period. Returns
   { created, row, error }; `error` is for logging only — the contact itself is
   already saved and must not be rolled back over this. */
/* The login attached to a contact, if any. Kept here rather than imported from
   contactLogin.js so this module has no dependency on the office pages. */
/* Every login of a contact, oldest first (fix160 — a partner may have several). */
export async function fetchLoginsForContact(contactId) {
  if (!contactId) return []
  try {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('id, username, role, status, mobile, email, last_login_at, created_at, must_change_password')
      .eq('contact_id', contactId)
      .order('created_at')
    return error ? [] : (data ?? [])
  } catch {
    return []
  }
}

/* The first login of a contact. Kept for callers that only ask "does it have
   one"; it no longer breaks when there are several — maybeSingle() did, and
   answered "none" for a partner with two logins. */
export async function fetchLoginForContact(contactId) {
  const all = await fetchLoginsForContact(contactId)
  return all[0] ?? null
}

/* OPEN THE SUBSCRIPTION FOR ONE NEW LOGIN, by the LOGIN'S role (fix163).

     partner login   its partner holds an in-date free seat → a free row for the
                     same year (the seat is the partner's, so all its logins are
                     free). Otherwise a payable partner seat, unpaid and switched
                     off, until the super admin activates it or records payment.
                     A row placed on the contact before any login existed is
                     given to this login instead of raising a second charge.
     supplier login  a supplier that is ALSO a partner pays for supplier access
                     from the first day — a free partner seat never buys it.
                     A supplier and nothing else gets the free trial, as before.

   Returns { created, attached, exempt, row, error }. */
export async function ensureLoginSubscription(contactId, loginId, role, { companyId = null, userId = null, contactTypes = null } = {}) {
  if (!contactId || !loginId || !['partner', 'supplier'].includes(role)) {
    return { created: false, row: null, error: null }
  }
  try {
    const { data: rows, error: readErr } = await supabase
      .from('subscriptions').select('*').eq('contact_id', contactId)
    if (readErr) {
      const missing = /subscriptions/i.test(readErr.message) && /not exist|schema cache/i.test(readErr.message)
      return { created: false, row: null, error: missing ? null : readErr.message }
    }
    const all = rows ?? []
    if (all.some(r => r.user_account_id === loginId)) return { created: false, row: null, error: null }

    const start = todayStr()
    let seed

    if (role === 'partner') {
      const seat = freeSeatMap(all).get(contactId)
      if (seat) {
        seed = {
          description:  'Included partner seat — inside the annual package (A5A)',
          start_date:   seat.start, end_date: seat.end,
          amount: 0, is_paid: true, paid_at: new Date().toISOString(),
          paid_by_note: 'Free partner seat held by this partner', is_active: !!seat.active, is_free_seat: true,
        }
      } else {
        // A row waiting on the contact (placed before any login) becomes this login's.
        const waiting = all.find(r => !r.user_account_id && !isFreeSeatRow(r))
        if (waiting) {
          const { error: attErr } = await supabase.from('subscriptions')
            .update({ user_account_id: loginId, updated_at: new Date().toISOString() }).eq('id', waiting.id)
          return { created: false, attached: !attErr, row: waiting, error: attErr ? attErr.message : null }
        }
        seed = {
          description:  `Annual partner seat — ${start.slice(0, 4)} — awaiting payment`,
          start_date:   start, end_date: addDays(start, 364),
          amount: SEATS.partner.extraRate, is_paid: false, paid_at: null,
          paid_by_note: 'Partner login without a free seat — payable before the portal opens', is_active: false,
        }
      }
    } else {
      let types = contactTypes
      if (!types) {
        const { data: c } = await supabase.from('contacts').select('contact_types, contact_type').eq('id', contactId).maybeSingle()
        types = c?.contact_types?.length ? c.contact_types : (c?.contact_type ? [c.contact_type] : [])
      }
      const alsoPartner = (types || []).includes('partner')
      const plan = SUPPLIER_SUBSCRIPTION.plans[0]
      seed = alsoPartner
        ? {
            description:  `Supplier ${plan.name} plan — awaiting payment`,
            start_date:   start, end_date: addDays(start, 29),
            amount: plan.price, is_paid: false, paid_at: null,
            paid_by_note: 'A partner adding supplier access pays for it — the free partner seat does not cover it',
            is_active: false,
          }
        : {
            description:  TRIAL_DESCRIPTION,
            start_date:   start, end_date: addDays(start, TRIAL_DAYS),
            amount: 0, is_paid: true, paid_at: new Date().toISOString(),
            paid_by_note: 'Issued automatically when the login was created', is_active: true,
          }
    }

    const { data, error } = await supabase.from('subscriptions').insert([{
      contact_id: contactId, user_account_id: loginId, currency: 'USD',
      ...seed,
      ...(companyId ? { company_id: companyId } : {}),
      created_by: userId,
    }]).select('*').single()
    if (error) return { created: false, row: null, error: error.message }
    return { created: true, row: data, exempt: !!seed.is_free_seat, error: null }
  } catch (e) {
    return { created: false, row: null, error: e?.message || 'Could not open the subscription.' }
  }
}
