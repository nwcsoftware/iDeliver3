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
import { isSubscriptionActive } from './subscriptions'

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
  const family = SEAT_BY_ROLE[role]
  if (!family) return null
  const seat = SEATS[family]
  if (!seat) return null

  // Only ACTIVE logins hold a seat — deactivating one hands its seat back.
  const used = users.filter(u =>
    u.role === role && u.status === 'active' && u.id !== excludeId).length
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
 * `partnerRanks`   contact_id -> rank, from rankPartners() in lib/subscriptions.
 *                  Passed in rather than worked out here: the ranking counts
 *                  only partners who are not also suppliers and who hold a
 *                  login, and a second implementation of that would be a second
 *                  chance to disagree with the sign-in gate.
 * `subsByContact`  subscription rows keyed by contact_id
 * `subsByUser`     subscription rows keyed by user_account_id (office seats)
 * `users`          every login, so an office seat can find its own position
 */
export function seatStatus(user, { partnerRanks = new Map(), subsByContact = new Map(), subsByUser = new Map(), users = [], today = new Date().toISOString().slice(0, 10) } = {}) {
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
      /* Inside the first ten the seat is included whether or not a row exists —
         the sign-in gate exempts them, so a missing row is not a problem to
         report. */
      const rank = partnerRanks.get(user.contact_id)
      if (rank && rank <= SEATS.partner.included) {
        return { ...SEAT_STATUS.included, row: (subsByContact.get(user.contact_id) || [])[0] ?? null }
      }
    }
    return fromRows(subsByContact.get(user.contact_id))
  }

  /* Office seats: position among active logins of the same role, oldest first,
     so the people who were here first hold the included seats. */
  const family = SEAT_BY_ROLE[role]
  const peers = users
    .filter(u => u.role === role && u.status === 'active')
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const idx = peers.findIndex(u => u.id === user.id)
  const position = idx === -1 ? peers.length + 1 : idx + 1
  if (position <= SEATS[family].included) return { ...SEAT_STATUS.included, row: null }
  return fromRows(subsByUser.get(user.id))
}
