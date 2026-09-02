import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  LogIn, MapPin, CalendarDays, X, ChevronLeft, ChevronRight, Smartphone,
  Loader, ArrowDown,
} from 'lucide-react'
import {
  APP_NAME, APP_VERSION, PRODUCT_TITLE, BRAND_MARK, VENDOR_MARK, VENDOR_GROUP,
  OWNER, RIGHTS_NOTICE, copyrightLine,
} from '../lib/appVersion'
import {
  fetchLandingSettings, fetchLandingPosts, paragraphsOf, dayLabel, groupByMonth,
  loadCachedVideo, prefersLightData,
} from '../lib/landingPage'

const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || null

/* The public front page — the one screen in this app a stranger sees.

   No header, no sidebar: those belong to the signed-in application, and a
   visitor has nothing to navigate yet. What they get is a clip playing behind
   the words, a welcome, whatever news and events the admin has published, and
   a QR code that puts the customer app on their phone. Sign-in is one button,
   top right.

   ── The clip is background, and behaves like it ─────────────────────────────
   Muted, looping, `playsInline`, and never a reason to wait: the poster frame
   is painted first and the video fades in over it once it can actually play, so
   a slow connection sees a still photograph rather than a black rectangle. A
   visitor who has asked their system for reduced motion is given the poster and
   no clip at all — the page is decorative, and decoration is not worth making
   someone unwell for.

   ── Reading, not scrolling through a spinner ────────────────────────────────
   The content loads with the anon key before any session exists, and every
   fetch fails soft. If the tables are missing or a policy blocks them, the page
   still renders its welcome and its sign-in button; it simply has less to say.
   That is deliberate — the sign-in route must never be unreachable because a
   marketing table is misconfigured. */

/* ── the background clip ───────────────────────────────────────────────────── */

function Backdrop({ videoUrl, posterUrl, opacity }) {
  const videoRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [src,   setSrc]   = useState('')     // blob: once local, https until then
  const [pct,   setPct]   = useState(null)   // first-visit download, % or null

  // Asked for reduced motion → the poster, and nothing that moves. Nothing is
  // downloaded either: a clip that will never play is pure waste.
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return undefined
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  /* Fetch the clip once into Cache Storage, then play it from the local copy.
     A cached clip resolves immediately and costs nothing; an uncached one is
     read through with a progress figure while the poster holds the screen. */
  useEffect(() => {
    if (!videoUrl || reduced || prefersLightData()) { setSrc(''); return undefined }
    let alive = true
    let objectUrl = ''
    const ac = new AbortController()

    loadCachedVideo(videoUrl, {
      signal: ac.signal,
      onProgress: p => { if (alive) setPct(p) },
    }).then(result => {
      if (!alive || !result) return
      objectUrl = result.objectUrl.startsWith('blob:') ? result.objectUrl : ''
      setSrc(result.objectUrl)
      setPct(null)
    })

    return () => {
      alive = false
      ac.abort()
      // A blob URL pins the whole file in memory until it is let go.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [videoUrl, reduced])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    // Always muted, and not by preference: autoplay is granted to a muted clip
    // and to nothing else. A control to unmute it would only ever be a control
    // to stop it playing, so there isn't one — this is wallpaper, not media.
    el.muted = true
    if (!reduced) el.play?.().catch(() => {})
  }, [reduced, src])

  const showVideo = !!src && !reduced

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
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onCanPlay={() => setReady(true)}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000"
          style={{ opacity: ready ? opacity : 0 }}
        />
      )}
      {/* First visit only, and only once past a tenth — a bar that appears for
          a fast clip is noise. Deliberately faint: it is the wallpaper loading,
          not the page. */}
      {pct != null && pct > 10 && !ready && (
        <div className="absolute bottom-0 left-0 h-0.5 bg-brand-500/60 transition-[width] duration-300"
          style={{ width: `${pct}%` }} />
      )}
      {/* The scrim. Text sits on this, not on the footage — without it every
          paragraph would be legible only where the clip happened to be dark. */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/75 to-slate-950/95" />
    </div>
  )
}

/* ── the QR code ───────────────────────────────────────────────────────────── */

/* Drawn as an SVG rather than fetched as a picture: it must work with no
   network beyond the page itself, scale to any screen without going soft, and
   never send the link to a third-party image service to be rendered. */
function AppQr({ url, note }) {
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
      .then(s => { if (alive) { setSvg(s); setErr('') } })
      .catch(e => { if (alive) setErr(e?.message || 'Could not draw the code.') })
    return () => { alive = false }
  }, [url])

  if (!url) return null

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-6 backdrop-blur-md sm:flex-row sm:items-center sm:gap-6">
      <div className="flex h-36 w-36 flex-shrink-0 items-center justify-center rounded-xl bg-white p-2">
        {svg
          ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          : <Loader className="h-6 w-6 animate-spin text-slate-400" />}
      </div>
      <div className="min-w-0 text-center sm:text-left">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-white sm:justify-start">
          <Smartphone className="h-4 w-4 text-brand-300" />
          Get the app
        </p>
        <p className="mt-1 text-sm text-slate-300">
          {note || 'Scan this with your phone camera to install the customer app.'}
        </p>
        {/* The same destination as a link, for anyone already reading this on
            the phone they would have scanned it with. */}
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand-400/40 bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-brand-200 transition-colors hover:bg-brand-500/25"
        >
          Open the download link
        </a>
        {err && <p className="mt-2 text-xs text-amber-300/80">{err}</p>}
      </div>
    </div>
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
   several worth glancing over, and a uniform grid flattens that distinction. */
function EventCard({ post, onOpen }) {
  const [hero, ...rest] = post.images
  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md">
      {hero && (
        <button
          type="button"
          onClick={() => onOpen(post, 0)}
          className="group relative block w-full overflow-hidden"
        >
          <img
            src={hero.url}
            alt={hero.caption || post.title}
            loading="lazy"
            className="h-56 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-72"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-slate-950/70 to-transparent" />
        </button>
      )}
      <div className="space-y-3 p-5">
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
                className="relative overflow-hidden rounded-lg"
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
  const [loading,  setLoading]  = useState(true)
  const [box,      setBox]      = useState(null)   // { images, index }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, p] = await Promise.all([
        fetchLandingSettings(COMPANY_ID),
        fetchLandingPosts({ companyId: COMPANY_ID, publishedOnly: true }),
      ])
      if (!alive) return
      setSettings(s.settings)
      setPosts(p.posts)
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
          signed-in shell and knows nothing about a visitor. */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        {/* The name alone. The application's own mark belongs to the signed-in
            app, not to the public face of the company. */}
        <span className="text-xl font-semibold tracking-wide text-white">3asari3</span>
        <button
          type="button"
          onClick={onSignIn}
          className="flex items-center gap-2 rounded-xl border border-brand-400/40 bg-brand-500/20 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-brand-500/35"
        >
          <LogIn className="h-4 w-4" /> Sign in
        </button>
      </div>

      {/* pb- clears the fixed footer: the last card must never sit under it. */}
      <main className="mx-auto max-w-6xl px-5 pb-32 sm:px-8 sm:pb-36">

        {/* ── welcome ─────────────────────────────────────────────────────── */}
        <section className="pt-10 sm:pt-20">
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
            {headline}
          </h1>
          {tagline && (
            <p className="mt-4 max-w-2xl text-lg text-brand-200/90 sm:text-xl">{tagline}</p>
          )}
          {intro.length > 0 && (
            <div className="mt-6 max-w-2xl space-y-4">
              {intro.map((p, i) => (
                <p key={i} className="text-base leading-relaxed text-slate-300">{p}</p>
              ))}
            </div>
          )}

          {(news.length > 0 || events.length > 0) && (
            <a
              href="#front-news"
              className="mt-8 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"
            >
              <ArrowDown className="h-4 w-4" /> See what’s happening
            </a>
          )}
        </section>

        {/* ── the figures ─────────────────────────────────────────────────── */}
        {stats.length > 0 && (
          <section className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {stats.map((s, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-md">
                <p className="text-3xl font-bold tabular-nums text-white">{s.value}</p>
                <p className="mt-1 text-sm font-medium text-slate-300">{s.label}</p>
                {s.note && <p className="mt-0.5 text-xs text-slate-500">{s.note}</p>}
              </div>
            ))}
          </section>
        )}

        {/* ── the app ─────────────────────────────────────────────────────── */}
        {settings?.appDownloadUrl && (
          <section className="mt-12">
            <AppQr url={settings.appDownloadUrl} note={settings.appNote} />
          </section>
        )}

        {loading && (
          <div className="mt-16 flex items-center justify-center gap-3 text-sm text-slate-400">
            <Loader className="h-4 w-4 animate-spin" /> Loading the latest…
          </div>
        )}

        {/* ── news ────────────────────────────────────────────────────────── */}
        {news.length > 0 && (
          <section id="front-news" className="mt-16 scroll-mt-8">
            <h2 className="text-2xl font-semibold text-white">News</h2>
            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              {news.map(p => (
                <article
                  key={p.id}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md"
                >
                  {p.images[0] && (
                    <button type="button" onClick={() => openBox(p, 0)} className="group block w-full overflow-hidden">
                      <img
                        src={p.images[0].url}
                        alt={p.images[0].caption || p.title}
                        loading="lazy"
                        className="h-44 w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </button>
                  )}
                  <div className="space-y-2 p-5">
                    {p.day && (
                      <p className="text-[11px] uppercase tracking-wider text-brand-300/80">{dayLabel(p.day)}</p>
                    )}
                    {p.title && <h3 className="text-lg font-semibold text-white">{p.title}</h3>}
                    {paragraphsOf(p.body).map((t, i) => (
                      <p key={i} className="text-sm leading-relaxed text-slate-300">{t}</p>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ── events, newest month first ──────────────────────────────────── */}
        {months.length > 0 && (
          <section className="mt-16">
            <h2 className="text-2xl font-semibold text-white">Events</h2>
            <p className="mt-1 text-sm text-slate-400">Newest first. Click any picture to see it full size.</p>
            {months.map(group => (
              <div key={group.key} className="mt-8">
                <h3 className="mb-4 flex items-center gap-3 text-sm font-medium uppercase tracking-wider text-slate-400">
                  {group.label}
                  <span className="h-px flex-1 bg-white/10" />
                </h3>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  {group.posts.map(p => <EventCard key={p.id} post={p} onOpen={openBox} />)}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Nothing published yet: say so plainly rather than leaving a gap the
            visitor reads as a broken page. */}
        {!loading && news.length === 0 && events.length === 0 && (
          <section className="mt-16 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur-md">
            <p className="text-sm text-slate-400">There’s no news posted just yet — check back soon.</p>
          </section>
        )}

        {/* ── contact ─────────────────────────────────────────────────────── */}
        {(settings?.contacts?.length ?? 0) > 0 && (
          <section className="mt-16 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md">
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
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-x-3 gap-y-1 px-5 py-2.5 text-center sm:px-8 lg:flex-row lg:justify-between lg:text-left">
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
