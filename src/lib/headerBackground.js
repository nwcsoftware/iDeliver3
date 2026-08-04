import { supabase } from './supabase'

/* Scheduled header background images (supabase-fix109.sql).

   The super admin schedules a picture for a date window; while that window is
   current every user's app header shows it behind the title bar. Purely
   decorative — there is nothing to click. */

export const DEFAULT_OPACITY = 0.35

/* Is this banner the one to show right now? */
export function isCurrent(row, now = Date.now()) {
  if (!row || row.is_active === false || !row.image_url) return false
  const from = row.start_at ? new Date(row.start_at).getTime() : null
  const to   = row.end_at   ? new Date(row.end_at).getTime()   : null
  if (from != null && !isNaN(from) && now < from) return false
  if (to   != null && !isNaN(to)   && now > to)   return false
  return true
}

/* The banner to display, or null. Newest scheduled one wins when windows
   overlap. Never throws — a missing table just means "no banner". */
export function pickCurrent(rows, now = Date.now()) {
  const live = (rows ?? []).filter(r => isCurrent(r, now))
  if (live.length === 0) return null
  return live.slice().sort((a, b) =>
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]
}

/* All banners (admin list + the app's own lookup). */
export async function fetchHeaderBackgrounds(companyId = null) {
  try {
    let q = supabase.from('header_backgrounds').select('*').order('created_at', { ascending: false })
    if (companyId) q = q.eq('company_id', companyId)
    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load header backgrounds.' }
  }
}

export async function saveHeaderBackground(row, { companyId = null, userId = null } = {}) {
  const payload = {
    name:      row.name?.trim() || null,
    image_url: row.image_url,
    start_at:  row.start_at || null,
    end_at:    row.end_at   || null,
    opacity:   Number(row.opacity) || DEFAULT_OPACITY,
    is_active: row.is_active !== false,
    updated_at: new Date().toISOString(),
  }
  if (row.id) {
    const { error } = await supabase.from('header_backgrounds').update(payload).eq('id', row.id)
    return error ? error.message : null
  }
  const { error } = await supabase.from('header_backgrounds').insert([{
    ...payload,
    ...(companyId ? { company_id: companyId } : {}),
    created_by: userId,
  }])
  return error ? error.message : null
}

export async function deleteHeaderBackground(id) {
  const { error } = await supabase.from('header_backgrounds').delete().eq('id', id)
  return error ? error.message : null
}
