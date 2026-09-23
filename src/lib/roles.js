/* What each role is allowed to be, in one place.
 *
 * ── SENIOR USER ──────────────────────────────────────────────────────────────
 * A rank between admin and call centre (fix156). Today it can do everything an
 * administrator can; a list of exceptions is coming, and this file is where
 * they will be subtracted.
 *
 * It is done as INHERITANCE rather than by editing every check in the app.
 * There are 57 role checks across these pages, 15 of them asking for
 * "super_admin or admin"; going through them by hand to add a third name would
 * have missed some, and a missed one is a screen that silently refuses
 * somebody who could use it yesterday. Instead `hasRole('admin')` answers yes
 * for a senior user, here, once.
 *
 * WHEN THE EXCEPTIONS ARRIVE they go in as explicit checks at the few places
 * that need them — `hasRole('super_admin', 'admin')` written as an exact test,
 * or a named capability below. Each exception is then one visible removal, and
 * the default stays "a senior user works like an administrator" rather than
 * drifting into a half-defined role nobody can describe.
 */

/* Roles that inherit another role's permissions. Asking for the key grants the
   value as well — never the other way round: a senior user counts as an admin,
   an admin is not a senior user. */
const INHERITS = {
  admin: ['senior_user'],
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

/** Exactly this role, ignoring inheritance — for a permission a senior user
 *  must NOT get by virtue of being admin-like. */
export const roleIsExactly = (role, ...asked) => asked.includes(role)

/* Display names. `user_role` stores snake_case; nothing should be shown to a
   person that way. */
export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  senior_user: 'Senior User',
  call_center: 'Call Center',
  driver:      'Driver',
  customer:    'Customer',
  supplier:    'Supplier',
  partner:     'Partner',
}

export const roleLabel = (r) => ROLE_LABELS[r] || String(r || '').replace(/_/g, ' ')
