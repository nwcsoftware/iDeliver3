/* What each role is allowed to be, in one place.
 *
 * ── SENIOR CALL CENTER ───────────────────────────────────────────────────────
 * AN UPGRADED CALL-CENTRE USER, NOT A MEMBER OF ADMINISTRATION. It sits above
 * call centre and below admin: super admin → admin → senior call center →
 * call centre. Nothing about the rank is administrative, and it should not be
 * designed as "an admin with restrictions" — that is backwards, and designing
 * from it would keep handing the rank things it was never meant to have.
 *
 * The code below says the opposite, for now. Inheritance was the way to
 * introduce the rank without anybody losing work overnight, and it makes each
 * exception a deliberate, visible removal instead of a guess about what was
 * never granted. It is scaffolding while the list arrives, not the intent.
 *
 * SO: when a new feature is administrative, do not let the inheritance decide
 * it. Ask. The answer is usually no.
 *
 * It is done as INHERITANCE rather than by editing every check in the app.
 * There are 57 role checks across these pages, 15 of them asking for
 * "super_admin or admin"; going through them by hand to add a third name would
 * have missed some, and a missed one is a screen that silently refuses
 * somebody who could use it yesterday. Instead `hasRole('admin')` answers yes
 * for a senior call centre user, here, once.
 *
 * WHEN THE EXCEPTIONS ARRIVE they go in as explicit checks at the few places
 * that need them — `hasRole('super_admin', 'admin')` written as an exact test,
 * or a named capability below. Each exception is then one visible removal, and
 * the default stays "a senior call centre user works like an administrator"
 * rather than drifting into a half-defined role nobody can describe.
 */

/* Roles that inherit another role's permissions. Asking for the key grants the
   value as well — never the other way round: a senior call centre user counts
   as an admin, an admin is not a senior call centre user.

   This entry is the scaffolding described above. As exceptions are named it
   shrinks in effect, and if the list ever covers everything administrative it
   should be removed and the rank given its own permissions outright. */
const INHERITS = {
  admin: ['senior_call_center'],
}

/* Expand a list of asked-for roles into every role that satisfies it. */
export function rolesSatisfying(asked = []) {
  const out = new Set()
  for (const r of asked) {
    if (!r) continue
    out.add(r)
    for (const extra of (INHERITS[r] || [])) out.add(extra)
  }
  return out
}

/** Does `role` satisfy a request for any of `asked`? */
export function roleSatisfies(role, asked = []) {
  return rolesSatisfying(asked).has(role)
}

/** Exactly this role, ignoring inheritance — for a permission a senior call
 *  centre user must NOT get by virtue of being admin-like. */
export const roleIsExactly = (role, ...asked) => asked.includes(role)

/* ── THE EXCEPTIONS ──────────────────────────────────────────────────────────
   What a Senior Call Center user does NOT get, despite the inheritance above.
   Each is a deliberate, named removal, and this list is the whole of the
   difference between that rank and an administrator — readable in one place
   rather than scattered across whichever screens implement it.

     Reports        the Reports menu and all six pages under it. They carry
                    costs, margins and company-wide money.

     Deleting an    any order, open or closed. Removing an order takes its
     order          items, payments, packages and ledger lines with it, and it
                    cannot be undone.

     Reopening a    and therefore editing one. A closed order's money has been
     closed order   counted, its stock moved and its partner credited; undoing
                    that is an administrator's decision.

   CLOSING an order is NOT on this list. A senior call centre user may close an
   eligible order, as an ordinary call centre user may — the rank is an upgrade
   of that job, not a restriction of it. */
export const isStrictAdmin = (role) => roleIsExactly(role, 'super_admin', 'admin')

/* Named for the two order powers above, so a call site says what it is asking
   about rather than repeating a role list that would drift. */
export const canDeleteOrders      = (role) => isStrictAdmin(role)
export const canReopenClosedOrder = (role) => isStrictAdmin(role)

/* Display names. `user_role` stores snake_case; nothing should be shown to a
   person that way. */
export const ROLE_LABELS = {
  super_admin:        'Super Admin',
  admin:              'Admin',
  senior_call_center: 'Senior Call Center',
  call_center:        'Call Center',
  driver:             'Driver',
  customer:           'Customer',
  supplier:           'Supplier',
  partner:            'Partner',
}

export const roleLabel = (r) => ROLE_LABELS[r] || String(r || '').replace(/_/g, ' ')
