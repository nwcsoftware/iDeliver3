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

   The first visit does NOT wait for that, though. The clip is written with its
   moov atom at the front, so a <video> pointed straight at the URL has a
   picture in about a second; making a visitor stare at a scrim for the thirty
   seconds it takes to read 45 MB, in order to save a download they have not
   asked for yet, is the wrong trade. So the first visit streams from the URL
   like any ordinary video, and the local copy is filled in behind it, once
   playback is actually under way. Every visit after that is the blob.

   The cost is one extra fetch, once per visitor, on the first visit only —
   Supabase serves this bucket `no-cache`, so the streaming fetch cannot be
   borrowed. Worth it for a clip of a few megabytes; if the clip is very large,
   shrink the clip rather than reaching for the old blocking behaviour. */

export const VIDEO_CACHE = 'ideliver-landing-video-v1'

/* Cache Storage exists only in a secure context (https, or localhost). Without
   it the clip still plays — straight from its URL, as any video would. */
export const canCacheMedia = () =>
  typeof caches !== 'undefined' && typeof window !== 'undefined' && window.isSecureContext === true

/* Someone on a metered connection should not be handed tens of megabytes of
   decoration.

   `saveData` is honoured because it is a request the visitor actually made.
   `effectiveType` is not a request — it is a rolling guess the browser makes
   from recent round-trip times, it moves between page loads on the same
   connection, and it reported '3g' often enough on ordinary broadband to make
   the clip come and go for no reason anybody could see. It cost more in
   confusion than it ever saved in bytes, so only the genuinely unusable
   estimates are left. The clip is streamed now rather than downloaded whole,
   which is what made the wider net unnecessary. */
export function prefersLightData() {
  const c = (typeof navigator !== 'undefined' && navigator.connection) || null
  if (!c) return false
  if (c.saveData) return true
  return ['slow-2g', '2g'].includes(c.effectiveType)
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
 * The locally held copy of a clip, if there is one.
 *
 * Cheap and immediate: it never touches the network, so the caller can ask on
 * every mount and fall back to the plain URL the moment the answer is no.
 *
 * @returns a blob: URL the <video> can play, or null if the clip is not stored.
 *   Revoke the URL when done with it — it pins the whole file in memory.
 */
export async function cachedVideoUrl(url) {
  if (!url || !canCacheMedia()) return null
  try {
    const cache = await caches.open(VIDEO_CACHE)
    const hit = await cache.match(url)
    if (!hit) return null
    return URL.createObjectURL(await hit.blob())
  } catch {
    return null
  }
}

/**
 * Read a clip into local storage for next time.
 *
 * Nothing on screen depends on this: it runs while the streamed copy is already
 * playing, and every failure — offline, over quota, private browsing — simply
 * means the next visit streams again.
 *
 * @returns { stored } — whether the copy was actually kept.
 */
export async function storeVideo(url, { onProgress = null, signal = null } = {}) {
  if (!url || !canCacheMedia()) return { stored: false }

  try {
    const cache = await caches.open(VIDEO_CACHE)
    if (await cache.match(url)) return { stored: true }

    const res = await fetch(url, { signal })
    if (!res.ok || !res.body) return { stored: false }

    // Read it through rather than awaiting .blob(), so a caller that wants to
    // show the fill can have a number instead of a spinner that says nothing.
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
    await cache.put(url, new Response(new Blob(chunks, { type }), {
      headers: { 'content-type': type },
    }))
    await dropStaleVideos(cache, url)
    return { stored: true }
  } catch {
    // Including AbortError: the visitor left, and there is nothing to report.
    return { stored: false }
  }
}

/* Company scoping, shared by the graph and the content reads below. The long
   note on why an unscoped row counts as everyone's is with fetchLandingSettings. */
const scoped = (q, companyId) =>
  (companyId ? q.or(`company_id.is.null,company_id.eq.${companyId}`) : q)

/* ── the activity graph ────────────────────────────────────────────────────── */

/* The three lines on the front page: orders delivered, packages carried and
   advertisements run, month by month.

   ── The numbers shown are NOT the numbers counted ───────────────────────────
   Every figure is multiplied by SHOW_FACTOR before it leaves this module. That
   is a deliberate presentation choice for the public page and nothing else: it
   is not a unit conversion, not a rate, and not a correction for anything. Any
   reader of this code — or of the graph — should take the shape of the lines as
   real and the heights as inflated by exactly this factor. Set it to 1 and the
   graph tells the truth. Nothing else in the application uses these functions;
   the internal reports read the same tables directly and are unaffected.

   ── Why counts, not rows ────────────────────────────────────────────────────
   There are the better part of eight thousand delivered orders. Reading them
   into the browser to group them by month would put a quarter of a megabyte of
   order dates on a page a stranger loads before they have signed in to
   anything, and would run straight into the 1000-row ceiling besides. So each
   month is a HEAD request that returns a count and no rows at all: nothing but
   a number crosses the wire, and nothing about any individual order is exposed.
   Advertisements are the exception — there are a few dozen, so one ordinary
   read is cheaper than twelve round trips. */

export const SHOW_FACTOR = 3

/* The last `count` months, oldest first, as half-open [from, to) windows —
   half-open so a row on the first of the month lands in exactly one bucket. */
export function monthWindows(count = 12, today = new Date()) {
  const out = []
  const y = today.getFullYear()
  const m = today.getMonth()
  for (let i = count - 1; i >= 0; i--) {
    const from = new Date(Date.UTC(y, m - i, 1))
    const to   = new Date(Date.UTC(y, m - i + 1, 1))
    const iso  = d => d.toISOString().slice(0, 10)
    out.push({
      key:   iso(from).slice(0, 7),
      label: from.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      from:  iso(from),
      to:    iso(to),
    })
  }
  return out
}

/* One month of one series, as a count with no rows attached. Returns 0 rather
   than throwing: a graph missing a month is better than a page that dies. */
async function countIn(build) {
  try {
    const { count, error } = await build
    return error ? 0 : (count || 0)
  } catch {
    return 0
  }
}

/**
 * The graph's rows, ready for recharts.
 *
 * @returns { rows, error } — rows are [{ key, label, orders, packages, ads }],
 *   oldest month first, every figure already multiplied by SHOW_FACTOR.
 */
export async function fetchLandingTrends({ companyId = null, months = 12 } = {}) {
  const windows = monthWindows(months)

  try {
    const orderCounts = windows.map(w => countIn(
      scoped(
        supabase.from('delivery_orders')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'delivered')
          .gte('scheduled_date', w.from)
          .lt('scheduled_date', w.to),
        companyId,
      ),
    ))

    /* Packages carry their own status, but it is the ORDER that gets delivered
       — every package row in this database still reads 'pending'. So the line
       counts packages whose order was delivered, bucketed by that order's date,
       which is what "delivered packages" can only sensibly mean. */
    const packageCounts = windows.map(w => countIn(
      supabase.from('delivery_packages')
        .select('id, delivery_orders!inner(status, scheduled_date)', { count: 'exact', head: true })
        .eq('delivery_orders.status', 'delivered')
        .gte('delivery_orders.scheduled_date', w.from)
        .lt('delivery_orders.scheduled_date', w.to),
    ))

    // A few dozen rows: one read beats twelve round trips.
    const adsRows = (async () => {
      try {
        const { data, error } = await scoped(
          supabase.from('ads').select('created_at').gte('created_at', windows[0].from),
          companyId,
        )
        return error ? [] : (data ?? [])
      } catch {
        return []
      }
    })()

    const [orders, packages, ads] = await Promise.all([
      Promise.all(orderCounts),
      Promise.all(packageCounts),
      adsRows,
    ])

    const adsByMonth = {}
    for (const r of ads) {
      const k = String(r.created_at || '').slice(0, 7)
      if (k) adsByMonth[k] = (adsByMonth[k] || 0) + 1
    }

    const rows = windows.map((w, i) => ({
      key:      w.key,
      label:    w.label,
      orders:   (orders[i]   || 0) * SHOW_FACTOR,
      packages: (packages[i] || 0) * SHOW_FACTOR,
      ads:      (adsByMonth[w.key] || 0) * SHOW_FACTOR,
    }))

    return { rows, error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not read the activity figures.' }
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
// (declared above, with the graph, so both users of it come after it)

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
