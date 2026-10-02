import { supabase } from './supabase'

/* HIDDEN RECORDS (fix176) — test accounts the super admin keeps out of sight.

   A hidden login, contact or subscription:
     · is listed for the super admin only (marked hidden), for nobody else;
     · is left out of every total, seat count, due and PDF — for everyone,
       the super admin included;
     · still signs in, if it is a login.

   Every page asks these three questions the same way, through here.
   Enforced by the application, not the database: everyone reaches the
   database through one key, so no row policy can tell the super admin apart. */

export const isHidden = (r) => r?.is_hidden === true

/* For totals, counts and reports: never the hidden ones. */
export const notHidden = (rows = []) => (rows || []).filter(r => !isHidden(r))

/* For a page's list: the super admin sees everything, everyone else not the hidden. */
export const forViewer = (rows = [], isSuperAdmin = false) => (isSuperAdmin ? (rows || []) : notHidden(rows))

/* The super admin hides or shows one. A login takes its subscriptions and its
   contact with it; a contact, its logins and subscriptions. */
export async function setHidden(actorId, kind, id, hidden) {
  const { data, error } = await supabase.rpc('super_admin_set_hidden', {
    p_actor_id: actorId, p_kind: kind, p_id: id, p_hidden: !!hidden,
  })
  if (error) {
    const m = error.message || ''
    if (/super_admin_set_hidden/i.test(m) && /not exist|schema cache/i.test(m)) return { error: 'Hiding needs supabase-fix176.sql.' }
    if (/NOT_AUTHORIZED/.test(m)) return { error: 'Only the super admin can hide or show records.' }
    if (/CANNOT_HIDE_SUPER_ADMIN/.test(m)) return { error: 'The super admin account cannot be hidden.' }
    return { error: m }
  }
  return { count: data, error: null }
}
