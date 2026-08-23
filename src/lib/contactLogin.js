import { supabase } from './supabase'

/* A contact's sign-in account, and keeping its ROLE in step with the contact.

   These are two different records: `contacts.contact_types` says what a party
   is to the business, `user_accounts.role` says what their login may see. The
   portal reads the role — it decides the "Partner"/"Supplier" label and whether
   My Shop and Inventory exist at all — so a contact retagged from partner to
   supplier while the login still says partner leaves the two contradicting each
   other, with the person locked out of pages their record says are theirs.

   So whenever a 2nd party's roles are edited, the login follows. Narrowly:
   only logins that already hold a 2nd-party role are touched, never an office
   account that happens to be linked to a contact, and never when the contact
   still holds the role the login has. */

export const LOGIN_ROLES = ['supplier', 'partner']

/* The login linked to a contact, or null. Readable by anon (the sign-in flow
   needs it); writes go through the admin_* RPCs. */
export async function fetchContactLogin(contactId) {
  if (!contactId) return null
  try {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('id, username, email, mobile, role, status, contact_id')
      .eq('contact_id', contactId)
      .maybeSingle()
    return error ? null : (data ?? null)
  } catch {
    return null
  }
}

/* Move the linked login's role onto the contact's 2nd-party type when the two
   have drifted apart. Returns { changed, from, to, error }; `error` is for the
   caller to report, never to undo the contact save over. */
export async function syncLoginRole(contactId, contactTypes = [], { actorId = null } = {}) {
  const none = { changed: false, from: null, to: null, error: null }
  if (!contactId || !actorId) return none

  const login = await fetchContactLogin(contactId)
  if (!login) return none
  // An office account linked to a contact keeps its role: it isn't a 2nd party.
  if (!LOGIN_ROLES.includes(login.role)) return none

  const types = (Array.isArray(contactTypes) ? contactTypes : [contactTypes])
    .filter(t => LOGIN_ROLES.includes(t))
  // Still holds the role it has (including "both") → nothing to do. No 2nd-party
  // role left at all → not our call to guess; leave it to the administrator.
  if (types.length === 0 || types.includes(login.role)) return none

  const to = types[0]
  try {
    const { error } = await supabase.rpc('admin_update_user', {
      p_actor_id:   actorId,
      p_user_id:    login.id,
      p_username:   login.username,
      p_email:      login.email ?? '',
      p_mobile:     login.mobile ?? '',
      p_role:       to,
      p_contact_id: contactId,
    })
    if (error) return { ...none, error: error.message }
    return { changed: true, from: login.role, to, error: null }
  } catch (e) {
    return { ...none, error: e?.message || 'Could not update the login role.' }
  }
}
