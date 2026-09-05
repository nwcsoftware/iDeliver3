import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  LogIn, MapPin, CalendarDays, X, ChevronLeft, ChevronRight, Smartphone,
  Loader, ArrowDown, Apple, Bot, TrendingUp,
} from 'lucide-react'
import {
  APP_NAME, APP_VERSION, PRODUCT_TITLE, BRAND_MARK, VENDOR_MARK, VENDOR_GROUP,
  OWNER, RIGHTS_NOTICE, copyrightLine,
} from '../lib/appVersion'
import {
  fetchLandingSettings, fetchLandingPosts, paragraphsOf, dayLabel, groupByMonth,
  cachedVideoUrl, storeVideo, prefersLightData, fetchLandingTrends,
} from '../lib/landingPage'

/* Bundled rather than fetched from storage: the welcome is the first thing a
   visitor sees, and it should not wait on a round trip to Supabase — nor go
   blank if that bucket is ever reorganised. The artwork is composed for this
   job, dark and empty down its left side where the copy goes and the team over
   on the right, so it is used as the card's ground rather than sat beside it. */
import headerArt from '../assets/3asari3-header.png'
/* The white-and-blue cut of the mark, the one drawn for a dark ground. Used
   exactly as supplied — no tint, no mask, no rounding: a logo is the one thing
   on a page that must not be redrawn to suit its surroundings. */
import brandLogo from '../assets/3asari3-logo-white.png'

const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || null

/* Where the two codes point. The listings do not exist yet, so these are the
   stores' own search pages — stand-ins, not fabrications: the codes are real
   and scannable, and someone who scans one lands somewhere true rather than on
   a dead link or a page pretending to be a listing that is not there. Replace
   these two lines with the real listing URLs when the app is published; nothing
   else on the page has to change. */
const APPLE_APP_URL   = 'https://apps.apple.com/search?term=3asari3'
const ANDROID_APP_URL = 'https://play.google.com/store/search?q=3asari3&c=apps'

/* The public front page — the one screen in this app a stranger sees.

   No header, no sidebar: those belong to the signed-in application, and a
   visitor has nothing to navigate yet. What they get is a clip playing behind
   the words, a welcome, whatever news and events the admin has published, and
   a QR code that puts the customer app on their phone. Sign-in is one button,
   top right.

   ── The clip is background, and behaves like it ─────────────────────────────
   Muted, looping, `playsInline`, and never a reason to wait: the poster frame
   is painted first and the video fades in over it once it can actually play, so
   a slow connection sees a still photograph rather than a black rectangle.

   A visitor who has asked their system for reduced motion gets the same picture
   standing still — the element is rendered, but it never plays. It used to get
   nothing at all, which is only defensible when a poster frame is configured to
   take its place; with none set, "no motion" silently became "black screen",
   and there was no way to tell that apart from a broken page.

   ── Reading, not scrolling through a spinner ────────────────────────────────
   The content loads with the anon key before any session exists, and every
   fetch fails soft. If the tables are missing or a policy blocks them, the page
   still renders its welcome and its sign-in button; it simply has less to say.
   That is deliberate — the sign-in route must never be unreachable because a
   marketing table is misconfigured. */

/* ── the background clip ───────────────────────────────────────────────────── */

/* Several independent things can leave this page with no clip on it — no URL
   configured, a connection the browser calls metered, a file it cannot decode —
   and on a black background they look identical to each other and to a bug. In
   development each one now names itself, so "the video is not showing" has an
   answer rather than a guess. Silent in a build: a visitor is owed a working
   page, not an explanation of one. */
const explain = why => {
  if (import.meta.env.DEV) console.info('%c[landing backdrop]', 'color:#38bdf8', why)
}

function Backdrop({ videoUrl, posterUrl, opacity }) {
  const videoRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [src,   setSrc]   = useState('')     // blob: when held locally, https when not
  // Whether `src` is the streamed original. Only that case has a copy to fill in
  // behind it; a blob is already the copy.
  const [streaming, setStreaming] = useState(false)

  /* Asked for reduced motion → the same frame, held still. Not nothing: see
     the note at the top of the file. */
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return undefined
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  /* Play the local copy if there is one; otherwise play the original and be
     quick about it. The lookup never touches the network, so this settles in a
     tick either way and the screen is never held waiting on a download.

     Reduced motion is deliberately NOT a reason to skip this: it decides
     whether the clip moves, not whether there is one. */
  useEffect(() => {
    if (!videoUrl) {
      explain('no video_url on the published landing_settings row')
      setSrc('')
      setStreaming(false)
      return undefined
    }
    if (prefersLightData()) {
      explain('navigator.connection asked for light data (Save-Data, or a 2g estimate)')
      setSrc('')
      setStreaming(false)
      return undefined
    }
    let alive = true
    let objectUrl = ''

    cachedVideoUrl(videoUrl).then(blobUrl => {
      if (!alive) {
        // Resolved after we were torn down: nobody will play it, so let it go
        // here or it pins the whole file in memory for the life of the tab.
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        return
      }
      objectUrl = blobUrl || ''
      setSrc(blobUrl || videoUrl)
      setStreaming(!blobUrl)
    })

    return () => {
      alive = false
      // A blob URL pins the whole file in memory until it is let go.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [videoUrl])

  /* Fill in the local copy for next time — deliberately not until the clip is
     playing. Started any earlier it would compete with the stream for the same
     connection and stall the very picture it exists to speed up. The playing
     copy is left alone when it lands: swapping the source mid-visit would
     restart the clip to no visible benefit. */
  useEffect(() => {
    if (!streaming || !ready || !videoUrl || reduced) return undefined
    const ac = new AbortController()
    storeVideo(videoUrl, { signal: ac.signal })
    return () => ac.abort()
  }, [streaming, ready, videoUrl, reduced])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    // Always muted, and not by preference: autoplay is granted to a muted clip
    // and to nothing else. A control to unmute it would only ever be a control
    // to stop it playing, so there isn't one — this is wallpaper, not media.
    el.muted = true
    if (!reduced) el.play?.().catch(() => {})

    /* `canplay` is a transition, not a state: an element that already holds
       enough data has fired it and will never fire it again. Since the clip is
       shown by fading `ready` in, anything that resets that flag without also
       changing the source — a hot reload in development, a remount — leaves the
       clip playing at opacity 0: running, decoded, and invisible, until the
       page is loaded from scratch. So ask the element what it has rather than
       waiting for it to announce it again. */
    if (el.readyState >= 2) setReady(true)
  }, [reduced, src])

  const showVideo = !!src

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-slate-950">
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity }}
        />
      )}
      {showVideo && (
        <video
          ref={videoRef}
          src={src}
          poster={posterUrl || undefined}
          /* The only two things reduced motion changes: it does not start, and
             it does not repeat. The frame is still painted. */
          autoPlay={!reduced}
          loop={!reduced}
          muted
          playsInline
          preload="auto"
          onError={() => explain('the browser could not load or decode the clip')}
          onCanPlay={() => setReady(true)}
          onLoadedData={() => setReady(true)}
          onPlaying={() => setReady(true)}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000"
          style={{ opacity: ready ? opacity : 0 }}
        />
      )}
      {/* The scrim. Text sits on this, not on the footage — without it every
          paragraph would be legible only where the clip happened to be dark. */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/75 to-slate-950/95" />
    </div>
  )
}

/* ── the welcome, word by word ─────────────────────────────────────────────── */

/* Most of the welcome is plain white in the page's own face at the page's own
   size. Roughly one word in three is lifted out of it — and a lifted word is
   the ONLY thing that changes size or weight. Colour, size and weight travel
   together, so the emphasis reads as one decision per word rather than three
   competing ones, and the paragraph still scans as a paragraph.

   One family throughout: whatever the app is set in. The lifted words differ
   in weight and slant, not in typeface.

   ── Scattered, but not random ───────────────────────────────────────────────
   Which words lift is decided by a hash of the word and its position, not by a
   counter — so there is no rhythm to spot, no every-third-word pattern, and the
   two blues fall unevenly. It is deliberately NOT Math.random: this component
   re-renders whenever anything else on the page changes state (the clip loading,
   the graph arriving), and a genuinely random choice would reshuffle the whole
   paragraph each time, making the text visibly twitch. A hash gives the same
   scatter every pass. To have it re-scatter on each visit instead, seed the
   hash with a number drawn once per mount rather than with the position. */

/* FNV-1a, 32-bit. Small, fast, and it moves a lot for a one-character change,
   which is what stops neighbouring words landing on the same answer. */
function hashOf(word, position) {
  let h = 2166136261 ^ position
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const PLAIN = 'text-white text-base font-normal'

/* Baby blue and blue, each in two treatments. Whole class names, because
   Tailwind reads the source as text and never generates a class it can only
   see assembled at runtime. */
const LIFTED = [
  'text-sky-300 text-lg font-semibold',
  'text-sky-300 text-xl italic font-medium',
  'text-blue-400 text-xl font-semibold',
  'text-blue-400 text-lg italic font-medium',
]

/* One word in three, near enough — `% 3` over a well-mixed hash, so the count
   drifts a little from paragraph to paragraph instead of landing exactly. */
const LIFT_ODDS = 3

/* `offset` continues the scatter across a paragraph break, so no two positions
   in the welcome share a seed. Spaces are their own text nodes: a word wrapped
   in a span carries no trailing space, and without them the paragraph sets as
   one unbreakable run. */
function FancyWords({ text, offset = 0 }) {
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <>
      {words.map((w, i) => {
        const n = offset + i
        const h = hashOf(w, n)
        const cls = h % LIFT_ODDS === 0 ? LIFTED[(h >>> 5) % LIFTED.length] : PLAIN
        return (
          <React.Fragment key={`${n}-${w}`}>
            <span className={cls}>{w}</span>
            {i < words.length - 1 ? ' ' : null}
          </React.Fragment>
        )
      })}
    </>
  )
}

const wordCount = t => t.split(/\s+/).filter(Boolean).length

/* ── the app, and the two ways to get it ───────────────────────────────────── */

/* Drawn as an SVG rather than fetched as a picture: it must work with no
   network beyond the page itself, scale to any screen without going soft, and
   never send the link to a third-party image service to be rendered. */
function StoreQr({ url, platform, label, note, Icon }) {
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    if (!url) { setSvg(''); return undefined }
    QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then(x => { if (alive) { setSvg(x); setErr('') } })
      .catch(e => { if (alive) setErr(e?.message || 'Could not draw the code.') })
    return () => { alive = false }
  }, [url])

  if (!url) return null

  return (
    <div className="flex flex-col items-center gap-5 border border-white/10 bg-white/[0.06] p-6 backdrop-blur-md sm:flex-row">
      {/* The code keeps its white quiet zone. A QR drawn straight onto a dark
          ground is a QR most phone cameras decline to read. */}
      <div className="flex h-36 w-36 flex-shrink-0 items-center justify-center bg-white p-2">
        {svg
          ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          : <Loader className="h-6 w-6 animate-spin text-slate-400" />}
      </div>
      <div className="min-w-0 text-center sm:text-left">
        <p className="flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-brand-300/80 sm:justify-start">
          <Icon className="h-4 w-4" /> {platform}
        </p>
        <p className="mt-1 text-lg font-semibold text-white">{label}</p>
        <p className="mt-1 text-sm text-slate-300">{note}</p>
        {/* The same destination as a link, for anyone already reading this on
            the phone they would otherwise have scanned it with. */}
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-400/40 bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-brand-200 transition-colors hover:bg-brand-500/25"
        >
          Open the store page
        </a>
        {err && <p className="mt-2 text-xs text-amber-300/80">{err}</p>}
      </div>
    </div>
  )
}

/* ── the activity graph ────────────────────────────────────────────────────── */

const GRID = 'rgba(148,163,184,0.14)'
const TICK = { fill: '#94a3b8', fontSize: 11 }
const SERIES = [
  { key: 'orders',   name: 'Orders delivered',   colour: '#38bdf8' },
  { key: 'packages', name: 'Packages delivered', colour: '#34d399' },
  { key: 'ads',      name: 'Advertisements',     colour: '#fbbf24' },
]

const compact = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-white/10 bg-slate-950/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 font-medium text-slate-200">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-400">
          <span className="h-2 w-2 flex-shrink-0" style={{ background: p.color }} />
          {p.name}
          <span className="ml-auto pl-4 tabular-nums text-slate-200">
            {Number(p.value).toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  )
}

/* Nothing is drawn until there is something to draw. An empty chart with three
   flat lines along the axis says less than no chart at all, and this page is
   written so a missing table costs a section rather than the whole screen. */
function ActivityGraph({ rows }) {
  if (!rows.some(r => r.orders || r.packages || r.ads)) return null

  return (
    <section className="mt-12 border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md sm:p-8">
      <h2 className="flex items-center gap-2 text-2xl font-semibold text-white">
        <TrendingUp className="h-5 w-5 text-brand-300" /> Twelve months of work
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Orders delivered, packages carried and advertisements run, month by month.
      </p>

      {/* A fixed height, because ResponsiveContainer resolves its own height
          against the parent — and a percentage of an auto-height box is zero. */}
      <div className="mt-6 h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} minTickGap={14} />
            {/* One shared axis: all three series count things of the same kind,
                and comparing their heights is the whole point of the graph. */}
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={54} tickFormatter={compact} />
            <Tooltip cursor={{ stroke: GRID, strokeWidth: 1 }} content={<TrendTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} iconType="plainline" />
            {SERIES.map(sr => (
              <Line
                key={sr.key}
                type="monotone"
                dataKey={sr.key}
                name={sr.name}
                stroke={sr.colour}
                strokeWidth={2}
                dot={{ r: 2.5, fill: sr.colour, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: sr.colour, stroke: '#020617', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

/* ── the gallery ───────────────────────────────────────────────────────────── */

/* A picture opened full size, with its caption and the arrows to walk the set.
   Escape closes, ← → move — a gallery that traps the keyboard is a gallery
   people leave the page to escape. */
function Lightbox({ images, index, onClose, onMove }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowRight') onMove(1)
      if (e.key === 'ArrowLeft')  onMove(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, onMove])

  const img = images[index]
  if (!img) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={img.caption || 'Photograph'}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full border border-white/15 bg-black/50 p-2 text-slate-300 hover:text-white"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onMove(-1) }}
            className="absolute left-2 rounded-full border border-white/15 bg-black/50 p-2.5 text-slate-300 hover:text-white sm:left-6"
            aria-label="Previous picture"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onMove(1) }}
            className="absolute right-2 rounded-full border border-white/15 bg-black/50 p-2.5 text-slate-300 hover:text-white sm:right-6"
            aria-label="Next picture"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      <figure className="flex max-h-full max-w-5xl flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
        <img
          src={img.url}
          alt={img.caption || ''}
          className="max-h-[76vh] w-auto max-w-full rounded-xl object-contain shadow-2xl"
        />
        <figcaption className="text-center text-sm text-slate-300">
          {img.caption}
          {images.length > 1 && (
            <span className="ml-2 text-xs text-slate-500">{index + 1} / {images.length}</span>
          )}
        </figcaption>
      </figure>
    </div>
  )
}

/* One event: its context on the left, its pictures beside it. The first picture
   is given the room — an event usually has one photograph worth looking at and
   several worth glancing over, and a uniform grid flattens that distinction.

   `wide` is for the card that would otherwise sit alone on the last row of the
   two-column grid: a month with one event, or the odd one out of three. Rather
   than leave half the row as empty background, that card takes the whole row
   and turns side-on — picture beside the words instead of above them, which is
   the shape the paragraph above always described. Below lg the grid is one
   column and every card is already full width, so `wide` changes nothing. */
function EventCard({ post, onOpen, wide = false }) {
  const [hero, ...rest] = post.images
  return (
    <article
      className={
        'overflow-hidden border border-white/10 bg-white/[0.04] backdrop-blur-md' +
        (wide ? ' lg:col-span-2 lg:flex lg:min-h-[22rem]' : '')
      }
    >
      {/* A flex item stretches to the row's height on its own; side-on, the
          picture is taken out of flow so it fills that height rather than
          setting it — the words beside it say how tall the card is. */}
      {hero && (
        <button
          type="button"
          onClick={() => onOpen(post, 0)}
          className={
            'group relative block w-full overflow-hidden' +
            (wide ? ' lg:w-[52%] lg:shrink-0' : '')
          }
        >
          <img
            src={hero.url}
            alt={hero.caption || post.title}
            loading="lazy"
            className={
              'h-56 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-72' +
              (wide ? ' lg:absolute lg:inset-0 lg:h-full' : '')
            }
          />
          {/* The scrim follows the picture: up from the foot when the words are
              underneath, across to the words when they are beside it. */}
          <span
            className={
              'absolute inset-0 bg-gradient-to-t from-slate-950/70 to-transparent' +
              (wide ? ' lg:bg-gradient-to-r lg:from-transparent lg:to-slate-950/50' : '')
            }
          />
        </button>
      )}
      <div className={'space-y-3 p-5' + (wide ? ' lg:flex-1 lg:self-center lg:p-8' : '')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-wider text-brand-300/80">
          {post.day && (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" /> {dayLabel(post.day)}
            </span>
          )}
          {post.location && (
            <span className="flex items-center gap-1.5 text-slate-400">
              <MapPin className="h-3.5 w-3.5" /> {post.location}
            </span>
          )}
        </div>

        {post.title && <h3 className="text-lg font-semibold text-white">{post.title}</h3>}

        {paragraphsOf(post.body).map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-slate-300">{p}</p>
        ))}

        {rest.length > 0 && (
          <div className="grid grid-cols-4 gap-2 pt-1">
            {rest.slice(0, 4).map((img, i) => (
              <button
                key={img.url + i}
                type="button"
                onClick={() => onOpen(post, i + 1)}
                className="relative overflow-hidden"
                title={img.caption || 'Open picture'}
              >
                <img
                  src={img.url}
                  alt={img.caption || ''}
                  loading="lazy"
                  className="h-16 w-full object-cover transition-transform duration-300 hover:scale-110"
                />
                {/* The last tile carries the overflow count rather than hiding it. */}
                {i === 3 && rest.length > 4 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-xs font-semibold text-white">
                    +{rest.length - 4}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/* ── the page ──────────────────────────────────────────────────────────────── */

export default function LandingPage({ onSignIn }) {
  const [settings, setSettings] = useState(null)
  const [posts,    setPosts]    = useState([])
  const [trends,   setTrends]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [box,      setBox]      = useState(null)   // { images, index }

  useEffect(() => {
    let alive = true
    ;(async () => {
      /* All three together. The graph is the slowest of them by a distance —
         a count per month per series — but it is also the one the page can most
         afford to be missing, so it is never allowed to hold up the rest. */
      const [s, p, t] = await Promise.all([
        fetchLandingSettings(COMPANY_ID),
        fetchLandingPosts({ companyId: COMPANY_ID, publishedOnly: true }),
        fetchLandingTrends({ companyId: COMPANY_ID, months: 12 }),
      ])
      if (!alive) return
      setSettings(s.settings)
      setPosts(p.posts)
      setTrends(t.rows)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const news   = useMemo(() => posts.filter(p => p.kind === 'news'),  [posts])
  const events = useMemo(() => posts.filter(p => p.kind === 'event'), [posts])
  const months = useMemo(() => groupByMonth(events), [events])

  const openBox = useCallback((post, index) => setBox({ images: post.images, index }), [])
  const moveBox = useCallback((step) => setBox(b => {
    if (!b) return b
    const n = b.images.length
    return { ...b, index: ((b.index + step) % n + n) % n }
  }), [])

  const headline = settings?.headline || 'Welcome to 3asari3'
  const tagline  = settings?.tagline  || ''
  const intro    = paragraphsOf(settings?.intro)
  const stats    = settings?.stats ?? []

  return (
    <div className="relative min-h-screen overflow-x-hidden text-slate-100">
      <Backdrop
        videoUrl={settings?.videoUrl}
        posterUrl={settings?.posterUrl}
        opacity={settings?.videoOpacity ?? 0.45}
      />

      {/* A bar, not a header: the app's Header component belongs to the
          signed-in shell and knows nothing about a visitor.

          Pinned to the top of the window, on the same bargain as the footer:
          the way in should not be something a visitor has to scroll back up to
          find once they are three months deep in the events. Fixed rather than
          sticky, because the wrapper above sets overflow-x-hidden — which makes
          it a scroll container of its own, and a sticky child of one of those
          never sticks. The height is fixed at h-16 so the padding that main
          reserves below can be exactly that and nothing is trapped underneath. */}
      <div className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-4 px-5 sm:px-8 lg:h-28">
          {/* The company's mark, standing where its name was. Sized by height
              alone so the artwork's own 16:9 sets the width and nothing is
              squashed; `as supplied` means the file decides how it looks. The
              alt text is the word it replaces, so a screen reader and a broken
              image both still say 3asari3. */}
          <img
            src={brandLogo}
            alt="3asari3"
            width={2142}
            height={1204}
            /* Double height on a desktop screen, where there is room for the
               mark to be read as a mark. A phone keeps the compact size: the
               bar is fixed, and every pixel of it is taken from the page for
               the whole visit. */
            className="h-11 w-auto sm:h-12 lg:h-24"
          />
          <button
            type="button"
            onClick={onSignIn}
            className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-brand-400/40 bg-brand-500/20 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-brand-500/35"
          >
            <LogIn className="h-4 w-4" /> Signin to iDeliver III
          </button>
        </div>
      </div>

      {/* The column grows with the window rather than staying a fixed 6xl strip
          in the middle of it: on a maximised screen that cap turned every card
          into half of 1152px with empty margin either side, so the cards looked
          smaller the larger the window got. Capped only where a line of body
          text would otherwise run too far to read comfortably.

          pt-16 clears the fixed bar above and pb- the fixed footer below: the
          first heading and the last card must never sit under either. */}
      <main className="mx-auto max-w-[1680px] px-5 pb-32 pt-16 sm:px-8 sm:pb-36 lg:pt-28">

        {/* ── welcome ─────────────────────────────────────────────────────── */}
        {/* The artwork is the card's ground, not a picture beside the words.

            object-cover is what makes it "always fit": the picture is scaled
            until it covers the rectangle in both directions and whatever hangs
            over the edge is cropped. So there is never a gap and never a
            stretched face, whatever shape the card ends up — wide on a
            maximised window, nearly square on a phone. The alternative,
            contain, would fit the whole picture in and leave bars of empty
            card around it, which is the thing this is replacing.

            The copy sits on the artwork's own dark left side. But cover slides
            the picture around as the card changes shape, so what ends up
            behind the words cannot be relied on: the scrim below is what keeps
            them legible, and it is heaviest on the left where they are. */}
        <section className="relative mt-8 overflow-hidden border border-white/10">
          <img
            src={headerArt}
            alt="The 3asari3 delivery team"
            width={2171}
            height={724}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/85 to-slate-950/45 lg:via-slate-950/70 lg:to-slate-950/10" />

          {/* Sits above the two absolute layers by document order alone — no
              z-index needed, and none to keep in step with the rest of the page. */}
          <div className="relative flex min-h-[20rem] flex-col justify-center p-6 sm:p-10 lg:min-h-[26rem] lg:w-[58%] lg:py-14">
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
              {headline}
            </h1>
            {tagline && (
              <p className="mt-4 max-w-2xl text-lg text-brand-200/90 sm:text-xl">{tagline}</p>
            )}
            {intro.length > 0 && (
              /* leading-relaxed on the block, not the words: mixed sizes on one
                 line take the tallest line box anyway, and setting it per word
                 would give the paragraph a ragged, uneven rhythm. */
              <div className="mt-6 max-w-2xl space-y-4 leading-relaxed">
                {intro.map((p, i) => (
                  <p key={i}>
                    <FancyWords
                      text={p}
                      offset={intro.slice(0, i).reduce((a, t) => a + wordCount(t), 0)}
                    />
                  </p>
                ))}
              </div>
            )}

            {/* Straight to the events. If a page is published with news but
                no events yet the anchor would point at nothing, so it falls back
                to the news heading rather than jumping nowhere. */}
            {(news.length > 0 || events.length > 0) && (
              <a
                href={events.length > 0 ? '#front-events' : '#front-news'}
                className="mt-8 inline-flex items-center gap-2 self-start text-sm text-purple-400 transition-colors hover:text-white"
              >
                <ArrowDown className="h-4 w-4" /> See what’s happening
              </a>
            )}
          </div>
        </section>

        {/* ── the figures ─────────────────────────────────────────────────── */}
        {stats.length > 0 && (
          <section className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {stats.map((s, i) => (
              <div key={i} className="border border-white/10 bg-white/[0.05] p-5 backdrop-blur-md">
                <p className="text-3xl font-bold tabular-nums text-white">{s.value}</p>
                <p className="mt-1 text-sm font-medium text-slate-300">{s.label}</p>
                {s.note && <p className="mt-0.5 text-xs text-slate-500">{s.note}</p>}
              </div>
            ))}
          </section>
        )}

        {/* ── the graph ───────────────────────────────────────────────────── */}
        <ActivityGraph rows={trends} />

        {/* ── the app ─────────────────────────────────────────────────────── */}
        {/* Two sectors rather than one link, because "get the app" means two
            different journeys and a visitor already knows which of them is
            theirs. Each carries its own code, so neither has to read a page of
            instructions to find out that the other one was not for them. */}
        <section className="mt-12">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-white">
            <Smartphone className="h-5 w-5 text-brand-300" /> 3asari3 application
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {settings?.appNote || 'Point your phone camera at the code for your device to install the customer app.'}
          </p>
          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <StoreQr
              url={APPLE_APP_URL}
              platform="iPhone & iPad"
              label="Download on the App Store"
              note="Requires iOS 15 or later."
              Icon={Apple}
            />
            <StoreQr
              url={ANDROID_APP_URL}
              platform="Android"
              label="Get it on Google Play"
              note="Requires Android 8.0 or later."
              Icon={Bot}
            />
          </div>
        </section>

        {loading && (
          <div className="mt-16 flex items-center justify-center gap-3 text-sm text-slate-400">
            <Loader className="h-4 w-4 animate-spin" /> Loading the latest…
          </div>
        )}

        {/* ── news ────────────────────────────────────────────────────────── */}
        {/* scroll-mt clears the fixed bar: at scroll-mt-8 the "See what's
            happening" jump landed this heading underneath it. */}
        {news.length > 0 && (
          <section id="front-news" className="mt-16 scroll-mt-24 lg:scroll-mt-36">
            <h2 className="text-2xl font-semibold text-white">News</h2>
            {/* Same rule as the events below: the odd card out takes the whole
                row and turns side-on rather than leaving half a row blank. */}
            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              {news.map((p, n) => {
                const wide = news.length % 2 === 1 && n === news.length - 1
                return (
                  <article
                    key={p.id}
                    className={
                      'overflow-hidden border border-white/10 bg-white/[0.04] backdrop-blur-md' +
                      (wide ? ' md:col-span-2 md:flex md:min-h-[16rem]' : '')
                    }
                  >
                    {p.images[0] && (
                      <button
                        type="button"
                        onClick={() => openBox(p, 0)}
                        className={
                          'group relative block w-full overflow-hidden' +
                          (wide ? ' md:w-[45%] md:shrink-0' : '')
                        }
                      >
                        <img
                          src={p.images[0].url}
                          alt={p.images[0].caption || p.title}
                          loading="lazy"
                          className={
                            'h-44 w-full object-cover transition-transform duration-500 group-hover:scale-105' +
                            (wide ? ' md:absolute md:inset-0 md:h-full' : '')
                          }
                        />
                      </button>
                    )}
                    <div className={'space-y-2 p-5' + (wide ? ' md:flex-1 md:self-center md:p-8' : '')}>
                      {p.day && (
                        <p className="text-[11px] uppercase tracking-wider text-brand-300/80">{dayLabel(p.day)}</p>
                      )}
                      {p.title && <h3 className="text-lg font-semibold text-white">{p.title}</h3>}
                      {paragraphsOf(p.body).map((t, i) => (
                        <p key={i} className="text-sm leading-relaxed text-slate-300">{t}</p>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )}

        {/* ── events, newest month first ──────────────────────────────────── */}
        {months.length > 0 && (
          <section id="front-events" className="mt-16 scroll-mt-24 lg:scroll-mt-36">
            <h2 className="text-2xl font-semibold text-white">Events</h2>
            <p className="mt-1 text-sm text-slate-400">Newest first. Click any picture to see it full size.</p>
            {months.map(group => (
              <div key={group.key} className="mt-8">
                <h3 className="mb-4 flex items-center gap-3 text-sm font-medium uppercase tracking-wider text-slate-400">
                  {group.label}
                  <span className="h-px flex-1 bg-white/10" />
                </h3>
                {/* An odd count leaves the last card alone on its row. It is
                    given the whole row instead of half of one, so the month
                    never ends in a rectangle of empty background. */}
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  {group.posts.map((p, i) => (
                    <EventCard
                      key={p.id}
                      post={p}
                      onOpen={openBox}
                      wide={group.posts.length % 2 === 1 && i === group.posts.length - 1}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Nothing published yet: say so plainly rather than leaving a gap the
            visitor reads as a broken page. */}
        {!loading && news.length === 0 && events.length === 0 && (
          <section className="mt-16 border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur-md">
            <p className="text-sm text-slate-400">There’s no news posted just yet — check back soon.</p>
          </section>
        )}

        {/* ── contact ─────────────────────────────────────────────────────── */}
        {(settings?.contacts?.length ?? 0) > 0 && (
          <section className="mt-16 flex flex-wrap items-center gap-x-8 gap-y-3 border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md">
            {settings.contacts.map((c, i) => (
              <div key={i}>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">{c.label}</p>
                <p className="text-sm text-slate-200">{c.value}</p>
              </div>
            ))}
          </section>
        )}
      </main>

      {/* Pinned to the bottom of the window rather than to the end of the page:
          the notice below is a standing claim, and a standing claim that has to
          be scrolled to is one most visitors never see.

          Laid out on one line where there is room and stacked where there is
          not — a fixed bar earns its place only by staying shallow, since every
          pixel of it is taken from the page for the whole visit. The content
          above reserves the same height in padding, so nothing is ever trapped
          underneath it. Every string comes from lib/appVersion, so this and the
          About popup can never make two different claims. */}
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] flex-col items-center gap-x-3 gap-y-1 px-5 py-2.5 text-center sm:px-8 lg:flex-row lg:justify-between lg:text-left">
          <p className="text-[11px] font-medium text-slate-400">
            {copyrightLine(BRAND_MARK)}
            <span className="ml-2 font-normal text-slate-600">
              {APP_NAME} · {PRODUCT_TITLE} · v{APP_VERSION}
            </span>
          </p>

          <p className="text-[11px] text-slate-500">
            Powered by <span className="font-semibold text-slate-400">{VENDOR_MARK}</span> — {VENDOR_GROUP}
            <span className="ml-2 text-slate-600">owned by {OWNER}</span>
          </p>
        </div>
        {/* The reservation of rights in full. Kept off the smallest screens,
            where it would double the height of the bar for the sake of text
            nobody can read at that size — the © line above still stands. */}
        <p className="hidden border-t border-white/5 px-5 py-1.5 text-center text-[10px] leading-relaxed text-slate-700 sm:block sm:px-8">
          {RIGHTS_NOTICE}
        </p>
      </footer>

      {box && (
        <Lightbox
          images={box.images}
          index={box.index}
          onClose={() => setBox(null)}
          onMove={moveBox}
        />
      )}
    </div>
  )
}
