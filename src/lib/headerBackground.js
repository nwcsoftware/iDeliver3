import { supabase } from './supabase'

/* Scheduled header background images (supabase-fix109.sql).

   The super admin schedules a picture for a date window; while that window is
   current every user's app header shows it behind the title bar. Purely
   decorative — there is nothing to click. */

export const DEFAULT_OPACITY = 0.35

/* The header strip is 1920 × 50 — a very wide, very short band. Anything else
   is cropped to fill it, so a clip authored at that size is the only way to
   control what is seen. */
export const HEADER_MEDIA_SIZE = { width: 1920, height: 50 }

/* Upload ceilings. Every signed-in user downloads the current banner on start,
   so a heavy file is a cost paid by everyone, every session — hence the modest
   video limit and the option to link a hosted file instead. */
export const MAX_IMAGE_KB = 4000
export const MAX_VIDEO_KB = 30000

/* Where uploads go (fix125). Keeping the file OUT of the row is the whole
   point: the row then holds a short URL, the browser streams and caches the
   media straight from storage, and signing in no longer drags a base64 copy of
   the banner down with it. */
export const MEDIA_BUCKET = 'header-media'

/* A file that lives in our bucket, as opposed to a data URL or someone else's
   link — only ours can be tidied up when a banner is deleted. */
export const isStoredUpload = (url = '') =>
  /^https?:\/\//i.test(url) && url.includes(`/${MEDIA_BUCKET}/`)

const extOf = (file) => {
  const fromName = String(file?.name || '').split('.').pop()
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/i.test(fromName)) return fromName.toLowerCase()
  const fromType = String(file?.type || '').split('/').pop()
  return (fromType || 'bin').toLowerCase()
}

/* Upload a banner and hand back its public URL.

   Returns { url, error }. A missing bucket is reported plainly rather than
   silently falling back to a data URL — quietly writing 27 MB into the row is
   exactly what this replaces. */
export async function uploadHeaderMedia(file, { userId = null } = {}) {
  if (!file) return { url: '', error: 'No file chosen.' }
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const rand  = Math.random().toString(36).slice(2, 8)
  const path  = `banners/${stamp}-${rand}.${extOf(file)}`
  try {
    const { error } = await supabase.storage.from(MEDIA_BUCKET)
      .upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type || undefined })
    if (error) {
      const missing = /bucket|not found|does not exist/i.test(error.message || '')
      return {
        url: '',
        error: missing
          ? 'The header-media bucket isn’t there yet — run supabase-fix125.sql in Supabase, then upload again.'
          : (error.message || 'Upload failed.'),
      }
    }
    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)
    return { url: data?.publicUrl || '', error: null }
  } catch (e) {
    return { url: '', error: e?.message || 'Upload failed.' }
  }
}

/* Best-effort tidy-up: drop the stored file when its banner goes. A failure
   here never blocks the delete — an orphaned file is a nuisance, a banner that
   refuses to disappear is a bug. */
export async function removeHeaderMedia(url) {
  if (!isStoredUpload(url)) return
  const path = url.split(`/${MEDIA_BUCKET}/`).pop()?.split('?')[0]
  if (!path) return
  try { await supabase.storage.from(MEDIA_BUCKET).remove([decodeURIComponent(path)]) } catch { /* ignore */ }
}

export const isVideoBanner = (row) => String(row?.media_type || 'image') === 'video'

/* Is this banner the one to show right now? */
export function isCurrent(row, now = Date.now()) {
  if (!row || row.is_active === false || !row.image_url) return false   // image_url holds the media, whatever its type
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
  const base = {
    name:      row.name?.trim() || null,
    image_url: row.image_url,
    start_at:  row.start_at || null,
    end_at:    row.end_at   || null,
    opacity:   Number(row.opacity) || DEFAULT_OPACITY,
    is_active: row.is_active !== false,
    updated_at: new Date().toISOString(),
  }
  // media_type / poster_url arrive with fix124. On a database where it hasn't
  // run, save the banner anyway as a picture rather than losing the whole edit.
  const payload = {
    ...base,
    media_type: isVideoBanner(row) ? 'video' : 'image',
    poster_url: row.poster_url || null,
  }
  const missingCols = (msg = '') => /media_type|poster_url/i.test(msg) && /column|schema cache/i.test(msg)

  const write = async (body) => {
    if (row.id) {
      const { error } = await supabase.from('header_backgrounds').update(body).eq('id', row.id)
      return error ? error.message : null
    }
    const { error } = await supabase.from('header_backgrounds').insert([{
      ...body,
      ...(companyId ? { company_id: companyId } : {}),
      created_by: userId,
    }])
    return error ? error.message : null
  }

  const err = await write(payload)
  if (err && missingCols(err)) {
    const fallback = await write(base)
    return fallback
      || 'Saved as a picture — run supabase-fix124.sql to schedule movies.'
  }
  return err
}

export async function deleteHeaderBackground(id) {
  const { error } = await supabase.from('header_backgrounds').delete().eq('id', id)
  return error ? error.message : null
}
