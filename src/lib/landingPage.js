import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

/* The public front page (supabase-fix140.sql).

   Everything else in this app is behind a sign-in. This is the one screen a
   stranger sees: a welcome, news, a few figures, galleries of event pictures,
   and a QR code that puts the customer app on their phone.

   ── Where it appears, and where it deliberately does not ────────────────────
   The DESKTOP build never shows it. Someone who has installed and launched the
   Windows app is staff arriving at work, and making them click past a brochure
   every morning would be an insult dressed as marketing — `window.electron`
   exists only there, so the app opens straight on the sign-in box exactly as it
   always has. The web build opens on this page instead, with sign-in one click
   away at #/signin.

   ── It runs before any session exists ───────────────────────────────────────
   There is no AppProvider, no AuthContext and no company scope at this point:
   the page reads with the anon key alone. So every fetch here is written to
   fail soft — a missing table, a blocked policy or a dead connection returns
   empty content and a reason, never a thrown error, because a landing page that
   white-screens is worse than one with nothing on it.

   For the same reason, NOTHING confidential belongs in these tables, published
   or not: `is_published` is a filter this client applies, not a permission the
   database enforces. A draft row is still readable by anyone with the anon key.

   ── Media ───────────────────────────────────────────────────────────────────
   Pictures and the background clip go to the existing `header-media` bucket
   under a `landing/` prefix. The row holds a short URL and the browser streams
   the file from storage, rather than dragging a base64 copy of a 20 MB clip
   into the page load. */

export const MEDIA_BUCKET = 'header-media'
export const MEDIA_FOLDER = 'landing'

/* Caps. The clip is decorative and often watched on a phone over mobile data,
   so the advisory limit sits well below what storage will actually take. */
export const MAX_VIDEO_KB   = 80000
export const ADVISED_VIDEO_KB = 8000
export const MAX_IMAGE_KB   = 4000

/* A landscape clip, authored to be looked past rather than at. */
export const VIDEO_SIZE = { width: 1920, height: 1080 }

export const POST_KINDS = [
  { key: 'news',  label: 'News',  note: 'An announcement. Shown as a card, newest first.' },
  { key: 'event', label: 'Event', note: 'Something that happened on a day. Shown as a dated gallery.' },
]

/* The desktop app, as opposed to the same build served in a browser. Electron's
   preload is the only thing that puts `window.electron` there, so this is a
   fact about the runtime rather than a guess from the user agent. */
export const isDesktopApp = () =>
  typeof window !== 'undefined' && !!window.electron

const trim = v => String(v ?? '').trim()

/* Split a text field into paragraphs on blank lines. No markup is parsed —
   what the admin typed is what appears. */
export const paragraphsOf = (text) =>
  trim(text).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)

export const isStoredUpload = (url = '') =>
  /^https?:\/\//i.test(url) && url.includes(`/${MEDIA_BUCKET}/`)

const extOf = (file) => {
  const fromName = String(file?.name || '').split('.').pop()
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/i.test(fromName)) return fromName.toLowerCase()
  return (String(file?.type || '').split('/').pop() || 'bin').toLowerCase()
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)

/* Upload a picture or a clip; hand back its public URL.

   Sent over XHR rather than the storage client for one reason: a 20 MB clip
   takes real time, and a form that looks frozen for two minutes is a form
   people give up on. XHR reports progress; fetch does not. */
export function uploadLandingMedia(file, { onProgress = null } = {}) {
  if (!file) return Promise.resolve({ url: '', error: 'No file chosen.' })
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const rand  = Math.random().toString(36).slice(2, 8)
  const path  = `${MEDIA_FOLDER}/${stamp}-${rand}.${extOf(file)}`
  const endpoint  = `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`

  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', endpoint, true)
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY)
      xhr.setRequestHeader('authorization', `Bearer ${SUPABASE_ANON_KEY}`)
      xhr.setRequestHeader('x-upsert', 'false')
      xhr.setRequestHeader('cache-control', 'max-age=31536000')
      if (file.type) xhr.setRequestHeader('content-type', file.type)

      xhr.upload.onprogress = (ev) => {
        if (!onProgress) return
        onProgress(ev.lengthComputable ? Math.round((ev.loaded / ev.total) * 100) : null)
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { resolve({ url: publicUrl, error: null }); return }
        let msg = ''
        try { msg = JSON.parse(xhr.responseText || '{}').message || '' } catch { msg = xhr.responseText || '' }
        const lower = msg.toLowerCase()
        resolve({
          url: '',
          error:
            /bucket not found|nosuchbucket/.test(lower)
              ? 'The header-media bucket isn’t there — run supabase-fix133.sql (or fix125), then upload again.'
            : /mime|invalid_mime_type/.test(lower)
              ? `That file type (${file.type || 'unknown'}) isn’t allowed. Use JPG, PNG or WebP for a picture, MP4 or WebM for a clip.`
            : /exceeded|too large|payload/.test(lower)
              ? `The file is ${mb(file.size)} MB — larger than storage will accept.`
            : (msg || `Upload failed (HTTP ${xhr.status}).`),
        })
      }
      xhr.onerror = () => resolve({
        url: '',
        error: `The upload didn’t reach the server (${mb(file.size)} MB). This is usually the connection `
             + 'giving up on a large file — try a smaller one, or paste a link to one already hosted.',
      })
      xhr.ontimeout = () => resolve({ url: '', error: `The upload timed out at ${mb(file.size)} MB.` })
      xhr.onabort   = () => resolve({ url: '', error: 'Upload cancelled.' })
      xhr.send(file)
    } catch (e) {
      resolve({ url: '', error: e?.message || 'Upload failed.' })
    }
  })
}

/* Best-effort tidy-up. An orphaned file is a nuisance; a post that refuses to
   disappear is a bug, so a failure here never blocks a delete. */
export async function removeLandingMedia(url) {
  if (!isStoredUpload(url)) return
  const path = url.split(`/${MEDIA_BUCKET}/`).pop()?.split('?')[0]
  if (!path) return
  try { await supabase.storage.from(MEDIA_BUCKET).remove([decodeURIComponent(path)]) } catch { /* ignore */ }
}

/* ── keeping the clip local ─────────────────────────────────────────────────

   Worth being precise about what was and was not a problem, because two
   different things get called "streaming it again".

   A looping <video> does NOT re-fetch on every loop. The browser holds the
   decoded buffer and replays from it, so a clip that has played once costs
   nothing to play a hundred more times in the same visit. That was never the
   leak.

   What DOES cost: the first download, and every RELOAD. Uploads already carry
   `Cache-Control: max-age=31536000`, which usually lets the HTTP cache serve a
   reload from disk — but "usually" is the problem. Browsers evict large media
   first, and Chrome refuses to put a single very large response in the disk
   cache at all, so a 50 MB clip is precisely the size that quietly re-downloads
   on every visit.

   So the clip is fetched ONCE into the Cache Storage API and played from a blob
   afterwards. From then on it is a local file: no request, no revalidation, no
   dependence on the browser's eviction mood. That is the guarantee the HTTP
   cache cannot give at this size.

   The cost is honest and paid on the first visit only: playback waits for the
   whole file rather than starting after a few seconds of buffer. The poster
   frame covers that wait, which is why the poster matters far more once the
   clip is large. */

export const VIDEO_CACHE = 'ideliver-landing-video-v1'

/* Cache Storage exists only in a secure context (https, or localhost). Without
   it the clip still plays — straight from its URL, as any video would. */
export const canCacheMedia = () =>
  typeof caches !== 'undefined' && typeof window !== 'undefined' && window.isSecureContext === true

/* Someone on a metered or slow connection should not be handed tens of
   megabytes of decoration. They get the poster; the page is not diminished. */
export function prefersLightData() {
  const c = (typeof navigator !== 'undefined' && navigator.connection) || null
  if (!c) return false
  if (c.saveData) return true
  return ['slow-2g', '2g', '3g'].includes(c.effectiveType)
}

/* Anything cached for a clip we no longer use is dead weight in the visitor's
   storage quota — drop it as soon as a new one is stored. */
async function dropStaleVideos(cache, keepUrl) {
  try {
    for (const req of await cache.keys()) {
      if (req.url !== keepUrl) await cache.delete(req)
    }
  } catch { /* best effort */ }
}

/**
 * Hand back a URL the <video> can play, preferring a locally stored copy.
 *
 * @returns { objectUrl, fromCache, stored } — `objectUrl` is a blob: URL when
 *   the clip is held locally and the plain https URL when it is not, so the
 *   caller can always just play it. Revoke a blob: URL when done with it.
 */
export async function loadCachedVideo(url, { onProgress = null, signal = null } = {}) {
  if (!url) return null
  // No cache available: play it straight from storage, as before.
  if (!canCacheMedia()) return { objectUrl: url, fromCache: false, stored: false }

  try {
    const cache = await caches.open(VIDEO_CACHE)

    const hit = await cache.match(url)
    if (hit) {
      const blob = await hit.blob()
      return { objectUrl: URL.createObjectURL(blob), fromCache: true, stored: true }
    }

    const res = await fetch(url, { signal })
    if (!res.ok || !res.body) return { objectUrl: url, fromCache: false, stored: false }

    // Read it through rather than awaiting .blob(), so the wait can be shown as
    // a number instead of a spinner that says nothing.
    const total  = Number(res.headers.get('content-length')) || 0
    const reader = res.body.getReader()
    const chunks = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      onProgress?.(total ? Math.round((loaded / total) * 100) : null, loaded, total)
    }

    const type = res.headers.get('content-type') || 'video/mp4'
    const blob = new Blob(chunks, { type })

    let stored = false
    try {
      await cache.put(url, new Response(blob, { headers: { 'content-type': type } }))
      await dropStaleVideos(cache, url)
      stored = true
    } catch {
      // Over quota, or private browsing. The clip still plays this visit; it
      // simply will not be free next time.
    }
    return { objectUrl: URL.createObjectURL(blob), fromCache: false, stored }
  } catch (e) {
    if (e?.name === 'AbortError') return null
    // Any failure at all falls back to ordinary playback rather than no video.
    return { objectUrl: url, fromCache: false, stored: false }
  }
}

/* ── reading ──────────────────────────────────────────────────────────────── */

const asArray = v => (Array.isArray(v) ? v : [])

/* Normalise one settings row. Every field is optional — a half-filled page is a
   perfectly good page, and the renderer decides what to leave out. */
function normaliseSettings(row) {
  if (!row) return null
  return {
    id:              row.id,
    isPublished:     row.is_published !== false,
    headline:        trim(row.headline),
    tagline:         trim(row.tagline),
    intro:           trim(row.intro),
    videoUrl:        trim(row.video_url),
    posterUrl:       trim(row.poster_url),
    videoOpacity:    Number.isFinite(Number(row.video_opacity)) ? Number(row.video_opacity) : 0.45,
    appDownloadUrl:  trim(row.app_download_url),
    appNote:         trim(row.app_note),
    stats:    asArray(row.stats).filter(s => trim(s?.label) || trim(s?.value)),
    contacts: asArray(row.contacts).filter(c => trim(c?.label) || trim(c?.value)),
  }
}

/* Company scoping, with one deliberate exception: a row whose `company_id` is
   NULL belongs to EVERYONE.

   The front page is the public face of the whole install, and the seed row this
   migration writes cannot know a company id — that value lives in the client's
   own environment, not in the database. Filtering strictly on `company_id`
   therefore matched nothing and quietly sent every visitor to the sign-in box.
   An unscoped row is the shared default; a company's own row still wins over
   it, so a multi-company install can override the shared page. */
const scoped = (q, companyId) =>
  (companyId ? q.or(`company_id.is.null,company_id.eq.${companyId}`) : q)

/* The company's own published row if it has one, else the shared row. Newest
   wins within each; the rest are history. */
export async function fetchLandingSettings(companyId = null) {
  try {
    const q = scoped(
      supabase.from('landing_settings').select('*').order('created_at', { ascending: false }),
      companyId,
    )
    const { data, error } = await q
    if (error) return { settings: null, rows: [], error: error.message }
    const rows = data ?? []
    const published = rows.filter(r => r.is_published !== false)
    const live = (companyId && published.find(r => r.company_id === companyId))
      || published.find(r => !r.company_id)
      || published[0]
      || null
    return { settings: normaliseSettings(live), rows, error: null }
  } catch (e) {
    return { settings: null, rows: [], error: e?.message || 'Could not load the front page.' }
  }
}

/* The day a post is filed under: its own date, else the day it was written. */
export const postDay = p =>
  String(p?.event_date || p?.created_at || '').slice(0, 10)

function normalisePost(row) {
  return {
    id:        row.id,
    kind:      trim(row.kind).toLowerCase() === 'event' ? 'event' : 'news',
    title:     trim(row.title),
    body:      trim(row.body),
    location:  trim(row.location),
    day:       postDay(row),
    sortOrder: Number(row.sort_order) || 0,
    images:    asArray(row.images)
      .map(i => ({ url: trim(i?.url), caption: trim(i?.caption) }))
      .filter(i => i.url),
    isPublished: row.is_published !== false,
    createdAt:   row.created_at,
  }
}

/* Newest first, with pinned posts (sort_order) above the rest. A post with no
   date sorts by when it was written, so it never falls off the bottom. */
export const byNewest = (a, b) =>
  (b.sortOrder - a.sortOrder) ||
  String(b.day).localeCompare(String(a.day)) ||
  String(b.createdAt || '').localeCompare(String(a.createdAt || ''))

export async function fetchLandingPosts({ companyId = null, publishedOnly = true } = {}) {
  try {
    // Same rule as the settings: an unscoped post belongs to everyone. Here
    // both are simply shown together — a shared announcement and a company's
    // own news are both news.
    const q = scoped(supabase.from('landing_posts').select('*'), companyId)
    const { data, error } = await q
    if (error) return { posts: [], error: error.message }
    const posts = (data ?? []).map(normalisePost)
      .filter(p => (publishedOnly ? p.isPublished : true))
      .sort(byNewest)
    return { posts, error: null }
  } catch (e) {
    return { posts: [], error: e?.message || 'Could not load the news.' }
  }
}

/* ── writing (admin only) ─────────────────────────────────────────────────── */

/* Which columns each screen owns. The front page is edited from two places by
   two different people — an admin writes the words, the super admin schedules
   the clip — and they share one row.

   So a save writes only the fields its own screen owns. Without that, whichever
   page saved last would silently overwrite the other's work with whatever stale
   copy it happened to be holding: an admin fixing a typo at the wrong moment
   would wipe a 50 MB clip somebody had just uploaded. */
export const CONTENT_FIELDS    = ['is_published', 'headline', 'tagline', 'intro',
                                  'app_download_url', 'app_note', 'stats', 'contacts']
export const BACKGROUND_FIELDS = ['video_url', 'poster_url', 'video_opacity']

export async function saveLandingSettings(form, { companyId = null, userId = null, id = null, only = null } = {}) {
  const all = {
    is_published:     form.isPublished !== false,
    headline:         trim(form.headline) || null,
    tagline:          trim(form.tagline) || null,
    intro:            trim(form.intro) || null,
    video_url:        trim(form.videoUrl) || null,
    poster_url:       trim(form.posterUrl) || null,
    video_opacity:    Number(form.videoOpacity) || 0.45,
    app_download_url: trim(form.appDownloadUrl) || null,
    app_note:         trim(form.appNote) || null,
    stats:    asArray(form.stats).map(s => ({ label: trim(s.label), value: trim(s.value), note: trim(s.note) }))
      .filter(s => s.label || s.value),
    contacts: asArray(form.contacts).map(c => ({ label: trim(c.label), value: trim(c.value) }))
      .filter(c => c.label || c.value),
  }
  const picked = only
    ? Object.fromEntries(only.filter(k => k in all).map(k => [k, all[k]]))
    : all

  const body = {
    ...picked,
    updated_at: new Date().toISOString(),
    ...(companyId ? { company_id: companyId } : {}),
  }
  try {
    if (id) {
      const { error } = await supabase.from('landing_settings').update(body).eq('id', id)
      return { error: error?.message || null }
    }
    // No row yet: an insert has to carry the whole thing, so the columns this
    // screen does not own take their database defaults rather than nothing.
    const { error } = await supabase.from('landing_settings')
      .insert([{ ...all, ...body, created_by: userId || null }])
    return { error: error?.message || null }
  } catch (e) {
    return { error: e?.message || 'Could not save the front page.' }
  }
}

export async function saveLandingPost(form, { companyId = null, userId = null } = {}) {
  const body = {
    kind:         form.kind === 'event' ? 'event' : 'news',
    title:        trim(form.title) || null,
    body:         trim(form.body) || null,
    location:     trim(form.location) || null,
    event_date:   trim(form.event_date) || null,
    images:       asArray(form.images).map(i => ({ url: trim(i.url), caption: trim(i.caption) })).filter(i => i.url),
    is_published: form.is_published !== false,
    sort_order:   Number(form.sort_order) || 0,
    updated_at:   new Date().toISOString(),
    ...(companyId ? { company_id: companyId } : {}),
  }
  try {
    if (form.id) {
      const { error } = await supabase.from('landing_posts').update(body).eq('id', form.id)
      return { error: error?.message || null }
    }
    const { error } = await supabase.from('landing_posts')
      .insert([{ ...body, created_by: userId || null }])
    return { error: error?.message || null }
  } catch (e) {
    return { error: e?.message || 'Could not save the post.' }
  }
}

/* Deleting a post also drops the pictures it owned — they exist for it alone. */
export async function deleteLandingPost(post) {
  try {
    const { error } = await supabase.from('landing_posts').delete().eq('id', post.id)
    if (error) return { error: error.message }
    for (const img of asArray(post.images)) await removeLandingMedia(img.url)
    return { error: null }
  } catch (e) {
    return { error: e?.message || 'Could not delete the post.' }
  }
}

/* A friendly day: '2026-08-14' → '14 August 2026'. */
export function dayLabel(day) {
  const s = String(day || '').slice(0, 10)
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

/* Group events by the month they happened in, newest month first — the shape
   the page draws its galleries in. */
export function groupByMonth(posts) {
  const out = []
  const seen = new Map()
  for (const p of posts) {
    const key = String(p.day).slice(0, 7) || 'undated'
    if (!seen.has(key)) {
      const [y, m] = key.split('-').map(Number)
      const label = y && m
        ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : 'Undated'
      const group = { key, label, posts: [] }
      seen.set(key, group)
      out.push(group)
    }
    seen.get(key).posts.push(p)
  }
  return out
}
