/* Seats, at the moment a login is created.
 *
 * Every role that draws on the annual package has an allowance: 10 partners,
 * 6 call-centre users, 4 administrators. Up to the allowance a seat is included
 * and costs nothing. Beyond it the seat is CHARGEABLE, and only the super admin
 * may take one — an administrator is stopped, told what the next seat would
 * cost, and left to ask.
 *
 * Why the check lives here rather than in the page: the same question is asked
 * in two places that must not disagree — the User Accounts form, where a login
 * is created, and the Contacts form, where changing a contact to `partner` can
 * turn an existing login into a partner seat. One answer, one file.
 *
 * WHAT THIS IS NOT. It is not the sign-in gate. A partner beyond the tenth is
 * refused entry by checkSubscriptionAccess() until a subscription exists, and
 * that rule is in lib/subscriptions.js where it belongs. This file only decides
 * whether the NEXT seat of a given role is included or has to be paid for — the
 * question the administrator is standing in front of.
 *
 * The super admin holds no seat and is bound by no allowance: the account that
 * administers the licence cannot be locked out by it.
 */

import { SEATS, SEAT_BY_ROLE, CURRENCY } from './billing'
import { isSubscriptionActive, subscriptionStatus, STATUS_STYLES, rowsForLogin } from './subscriptions'

/** Roles that hold no seat: nothing to run out of, nothing to charge. */
export const UNSEATED_ROLES = ['super_admin', 'customer', 'driver']

/**
 * Where the next login of `role` would land.
 *
 * `users`     every user_accounts row the page has loaded
 * `excludeId` the row being edited, so changing someone's email does not make
 *             them collide with themselves
 *
 * Returns null when the role holds no seat — including `supplier`, which is not
 * on the package at all: a supplier subscribes on its own monthly plan from the
 * first day, so it has no free allowance to exceed.
 */
export function seatPosition({ users = [], role, excludeId = null }) {
  /* A partner's seat is not a count of partner logins: free partner seats are
     assigned records held for a year (fix163), and every other partner login
     pays for itself. Only office seats are positional. */
  if (role === 'partner' || role === 'supplier') return null
  const family = SEAT_BY_ROLE[role]
  if (!family) return null
  const seat = SEATS[family]
  if (!seat) return null

  /* Only ACTIVE logins hold a seat — deactivating one hands its seat back.
     Counted over the seat FAMILY, not the exact role: a senior call centre
     login draws an administrator seat (SEAT_BY_ROLE), so counting only its own
     rank let admins and seniors each believe they had all four. */
  const used = users.filter(u =>
    SEAT_BY_ROLE[u.role] === family && u.status === 'active' && u.id !== excludeId).length
  const next = used + 1

  return {
    role,
    family,
    label:       seat.label,
    included:    seat.included,
    used,
    next,
    free:        next <= seat.included,
    remaining:   Math.max(0, seat.included - used),
    rate:        seat.extraRate,
    currency:    CURRENCY,
    period:      seat.period,
    /* True where the allowance is an operating agreement rather than an article
       of the licence — today, the administrator seat. Worth saying out loud on
       screen so nobody quotes it back as a contractual figure. */
    provisional: !!seat.provisional,
  }
}

/** "USD 15 / year" — the price of one seat beyond the allowance. */
export const seatPrice = (pos) =>
  pos ? `${pos.currency} ${pos.rate} / ${pos.period}` : ''

/**
 * May this actor take the seat, and what should they be told?
 *
 * `{ ok, chargeable, message }` — `ok` false stops the save. A chargeable seat
 * is allowed only for a super admin, and even then the message says what it
 * costs, because a seat taken without knowing the price is how an invoice
 * becomes an argument.
 */
export function checkSeat({ users = [], role, excludeId = null, isSuperAdmin = false }) {
  const pos = seatPosition({ users, role, excludeId })
  if (!pos || pos.free) return { ok: true, chargeable: false, pos, message: null }

  if (!isSuperAdmin) {
    return {
      ok: false,
      chargeable: true,
      pos,
      message: `${pos.label}: all ${pos.included} included seats are in use. `
        + `Seat ${pos.next} is outside the annual package and is charged at ${seatPrice(pos)}. `
        + 'Only a super admin can add it — or deactivate an existing account to free a seat.',
    }
  }
  return {
    ok: true,
    chargeable: true,
    pos,
    message: `This is ${pos.label.toLowerCase()} seat ${pos.next} — beyond the ${pos.included} included, `
      + `so it is charged at ${seatPrice(pos)} and will be recorded as a chargeable seat.`,
  }
}

/* ── what a login's seat is costing, for the User Accounts list ───────────
 *
 * Four answers, and the distinction that matters is between the first three
 * (the account works) and the fourth (it does not):
 *
 *   included  inside the allowance — no charge, and no row is needed
 *   trial     a free period that RUNS OUT, so it is not the same as included
 *   paid      a subscription costing money and currently in date
 *   none      subject to a subscription and holding none — sign-in is refused
 *   na        a role that holds no seat at all (super admin, driver, customer)
 *
 * `included` and `trial` are deliberately not merged. Both are free today; only
 * one of them is free next month, and a list that showed them alike would hide
 * every partner about to be locked out.
 */
export const SEAT_STATUS = {
  included: { key: 'included', label: 'Included',  note: 'Inside the annual package — no charge' },
  trial:    { key: 'trial',    label: 'Free trial', note: 'Free period — ends on the date shown' },
  paid:     { key: 'paid',     label: 'Paid',      note: 'Paid subscription, in date' },
  due:      { key: 'due',      label: 'Payment due', note: 'Open while unpaid — activated by the super admin for the full term or on trust' },
  none:     { key: 'none',     label: 'None',      note: 'Subject to a subscription and has none — sign-in is refused' },
  na:       { key: 'na',       label: '—',         note: 'This role holds no seat' },
}

/* Live = what the sign-in gate lets through (isSubscriptionActive): paid and in
   date, OR switched on unpaid by the super admin — for the full term (fix159)
   or on trust. Testing is_paid here instead called those partners “None —
   sign-in is refused” while they were signing in. */
const inDate = (r, today) => !!r && isSubscriptionActive(r, today)

/**
 * The seat status of one login.
 *
 * `freeSeats`      contact_id -> { start, end, active }, from freeSeatMap() in
 *                  lib/subscriptions: which partners hold a free seat, and until
 *                  when. The same map the sign-in gate reads (fix163).
 * `subsByContact`  subscription rows keyed by contact_id
 * `subsByUser`     subscription rows keyed by user_account_id (office seats)
 * `users`          every login, so an office seat can find its own position
 */
export function seatStatus(user, { freeSeats = new Map(), subsByContact = new Map(), subsByUser = new Map(), users = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const role = user?.role
  if (!SEAT_BY_ROLE[role] && role !== 'supplier') return { ...SEAT_STATUS.na, row: null }

  const fromRows = (rows) => {
    const live = (rows || []).find(r => inDate(r, today))
    if (!live) return { ...SEAT_STATUS.none, row: (rows || [])[0] ?? null }
    if (!live.is_paid) return { ...SEAT_STATUS.due, row: live }
    return Number(live.amount) > 0
      ? { ...SEAT_STATUS.paid,  row: live }
      : { ...SEAT_STATUS.trial, row: live }
  }

  if (role === 'partner' || role === 'supplier') {
    if (!user.contact_id) return { ...SEAT_STATUS.none, row: null }
    if (role === 'partner') {
      /* The partner holds an active free seat: every partner login of it is
         free for that year, whatever rows this login carries. */
      const seat = freeSeats.get(user.contact_id)
      if (seat?.active) {
        return { ...SEAT_STATUS.included, row: rowsForLogin(subsByContact.get(user.contact_id), user.id)[0] ?? null,
                 until: seat.end }
      }
    }
    // This login's rows only: a partner's other logins hold their own (fix160).
    return fromRows(rowsForLogin(subsByContact.get(user.contact_id), user.id))
  }

  /* Office seats: position among active logins of the same role, oldest first,
     so the people who were here first hold the included seats. */
  const family = SEAT_BY_ROLE[role]
  const peers = users
    .filter(u => SEAT_BY_ROLE[u.role] === family && u.status === 'active')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const idx = peers.findIndex(u => u.id === user.id)
  const position = idx === -1 ? peers.length + 1 : idx + 1
  if (position <= SEATS[family].included) return { ...SEAT_STATUS.included, row: null }
  return fromRows(subsByUser.get(user.id))
}


/* ── what a login IS, for the printed account list ───────────────────────
 *
 * For a partner or supplier: the subscription it holds — which one, for what
 * period, how much, and where it stands (paid, payment due, unpaid…), or that
 * it sits inside the ten free partner seats.
 *
 * For an office login: its level — the rank, and which seat of that rank's
 * allowance it occupies: included in the annual package, or chargeable beyond
 * it. Worked out by the same position rule seatStatus uses (active logins of
 * the role, oldest first), so the paper and the billing agree about who is
 * seat 7.
 *
 * Returns { level, detail }. */
const RANK_TEXT = {
  super_admin:        'Owner — full control',
  admin:              'Administration',
  senior_call_center: 'Senior call centre',
  call_center:        'Call centre',
}

const fmtAmt = (n, cur) =>
  `${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || ''}`.trim()

/* The subscription row that describes the account today: the live one, else
   the most recent by end date. */
function currentRow(rows, today) {
  const list = rows || []
  return list.find(r => isSubscriptionActive(r, today))
    || list.slice().sort((a, b) => String(b.end_date || '').localeCompare(String(a.end_date || '')))[0]
    || null
}

function describeRow(r, today) {
  if (!r) return null
  const st  = subscriptionStatus(r, today)
  const lbl = STATUS_STYLES[st]?.label || st
  const amt = Number(r.amount) > 0 ? fmtAmt(r.amount, r.currency) : 'free'
  return `${r.description || 'Subscription'} · ${r.start_date || '?'} to ${r.end_date || '?'} · ${amt} · ${lbl}`
}

export function accountLevel(user, { freeSeats = new Map(), subsByContact = new Map(), subsByUser = new Map(),
                                     users = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const role = user?.role
  if (role === 'super_admin') return { level: RANK_TEXT.super_admin, detail: 'Holds no seat' }

  if (role === 'partner' || role === 'supplier') {
    if (!user.contact_id) return { level: 'No linked contact', detail: 'No subscription can apply' }
    const row = currentRow(rowsForLogin(subsByContact.get(user.contact_id), user.id), today)
    if (role === 'partner') {
      const seat = freeSeats.get(user.contact_id)
      if (seat?.active) {
        // A charge raised before the seat was assigned is not owed any more.
        const stale = row && !row.is_paid && Number(row.amount) > 0
        return { level: `Free partner seat — until ${seat.end}`,
                 detail: row ? describeRow(row, today) + (stale ? ' — not due, free seat' : '')
                             : 'Held by this partner for the year — no subscription needed' }
      }
      if (seat && !seat.active) {
        return { level: 'Free partner seat — switched off', detail: `Held until ${seat.end}; sign-in refused while it is off` }
      }
      if (user.status !== 'active') {
        return { level: 'Partner — login inactive', detail: describeRow(row, today) || 'No subscription on file' }
      }
      return { level: 'Partner — subscribes', detail: describeRow(row, today) || 'No subscription on file' }
    }
    return { level: 'Supplier — own plan', detail: describeRow(row, today) || 'No subscription on file' }
  }

  const family = SEAT_BY_ROLE[role]
  if (!family) return { level: role || '—', detail: 'This role holds no seat' }
  const seat = SEATS[family]
  const rank = RANK_TEXT[role] || role
  if (user.status !== 'active') return { level: rank, detail: 'Inactive — holds no seat' }

  const peers = users
    .filter(u => SEAT_BY_ROLE[u.role] === family && u.status === 'active')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const idx = peers.findIndex(u => u.id === user.id)
  const pos = idx === -1 ? peers.length + 1 : idx + 1
  if (pos <= seat.included) {
    return { level: rank, detail: `Included seat ${pos} of ${seat.included} — ${seat.label.toLowerCase()}, annual package` }
  }
  const row = currentRow(subsByUser.get(user.id), today)
  return { level: rank,
           detail: `Chargeable seat ${pos} (beyond ${seat.included}) — ${fmtAmt(seat.extraRate, CURRENCY)} per ${seat.period}`
             + (row ? ` · ${STATUS_STYLES[subscriptionStatus(row, today)]?.label || ''}` : ' · not yet invoiced') }
}
