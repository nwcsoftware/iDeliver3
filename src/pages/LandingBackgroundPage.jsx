import React, { useCallback, useEffect, useState } from 'react'
import {
  Film, Upload, Loader, AlertCircle, Shield, CheckCircle2, Trash2, ExternalLink, Info,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  fetchLandingSettings, saveLandingSettings, uploadLandingMedia, removeLandingMedia,
  BACKGROUND_FIELDS, MAX_IMAGE_KB, MAX_VIDEO_KB, ADVISED_VIDEO_KB, VIDEO_SIZE,
} from '../lib/landingPage'

const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || null

const kb = n => `${(n / 1024).toFixed(0)} MB`

/* Super Admin → Front Page Background.

   The clip that plays behind the public front page, kept with the other
   decorative media the developer account owns — the office Header Background
   and the Customer App Theme both live here for the same reason. A background
   movie is the one setting on that page where a careless choice is expensive
   rather than merely wrong: it is tens of megabytes served to every visitor,
   and it is the slowest thing on the site.

   The WORDS on the front page stay with the admins, under
   Administration → Front Page. Both screens edit the same row, so each writes
   only the columns it owns (see CONTENT_FIELDS / BACKGROUND_FIELDS) — otherwise
   an admin fixing a typo would silently wipe a clip uploaded a minute earlier. */
export default function LandingBackgroundPage() {
  const { hasRole, currentUser } = useAuth()
  const isSuperAdmin = hasRole('super_admin')

  const [videoUrl,     setVideoUrl]     = useState('')
  const [posterUrl,    setPosterUrl]    = useState('')
  const [videoOpacity, setVideoOpacity] = useState(0.45)
  const [settingsId,   setSettingsId]   = useState(null)

  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [upload,  setUpload]  = useState(null)   // { what, pct }
  const [videoKb, setVideoKb] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const { settings, error: e } = await fetchLandingSettings(COMPANY_ID)
    if (settings) {
      setVideoUrl(settings.videoUrl)
      setPosterUrl(settings.posterUrl)
      setVideoOpacity(settings.videoOpacity ?? 0.45)
      setSettingsId(settings.id)
    }
    setError(e || '')
    setLoading(false)
  }, [])

  useEffect(() => { if (isSuperAdmin) load() }, [isSuperAdmin, load])

  /* How big the clip actually is. A HEAD request fetches no body, so asking is
     free even for a very large file. */
  useEffect(() => {
    if (!videoUrl) { setVideoKb(0); return undefined }
    let alive = true
    fetch(videoUrl, { method: 'HEAD' })
      .then(r => { if (alive) setVideoKb(Math.round((Number(r.headers.get('content-length')) || 0) / 1024)) })
      .catch(() => { if (alive) setVideoKb(0) })
    return () => { alive = false }
  }, [videoUrl])

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Shield className="h-10 w-10 text-slate-600" />
        <p className="font-medium text-slate-300">Super admin only</p>
        <p className="max-w-sm text-sm text-slate-500">
          The front page’s background clip is managed by the developer account. Its words, news and
          events are under Administration → Front Page.
        </p>
      </div>
    )
  }

  async function pickMedia(kind, onDone) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = kind === 'video' ? 'video/mp4,video/webm' : 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const capKb = kind === 'video' ? MAX_VIDEO_KB : MAX_IMAGE_KB
      if (file.size > capKb * 1024) {
        setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${kb(capKb)}.`)
        return
      }
      setError('')
      setUpload({ what: kind, pct: 0 })
      const { url, error: e } = await uploadLandingMedia(file, {
        onProgress: pct => setUpload(u => (u ? { ...u, pct: pct ?? u.pct } : u)),
      })
      setUpload(null)
      if (e) { setError(e); return }
      onDone(url)
      setSaved(false)
    }
    input.click()
  }

  async function save() {
    setSaving(true); setError('')
    const { error: e } = await saveLandingSettings(
      { videoUrl, posterUrl, videoOpacity },
      { companyId: COMPANY_ID, userId: currentUser?.user_id, id: settingsId, only: BACKGROUND_FIELDS },
    )
    setSaving(false)
    if (e) { setError(e); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    load()
  }

  async function clearVideo() {
    if (!window.confirm('Remove the background clip? The front page will show the poster instead.')) return
    const old = videoUrl
    setVideoUrl(''); setSaved(false)
    await removeLandingMedia(old)
  }

  const heavy = videoKb > ADVISED_VIDEO_KB

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6">

      <div className="flex items-start gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/5 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-400" />
        <p className="text-xs leading-relaxed text-sky-100/80">
          The clip that plays behind the <span className="font-medium text-sky-100">public front page</span> —
          what a visitor sees before signing in. Kept here with the other decorative media because it is served
          to every visitor and is the heaviest thing on the site.
          <span className="ml-1 text-sky-100/60">
            The page’s words, figures, news and events are under Administration → Front Page.
          </span>
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-400" />
          <p className="text-xs text-rose-200/90">
            {error}
            {/rela|does not exist|schema cache/i.test(error) && (
              <span className="ml-1 text-rose-200/60">Run supabase-fix140.sql, then reload.</span>
            )}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-400">
          <Loader className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="card space-y-5 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Film className="h-4 w-4" /> Background clip
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Plays muted and loops, behind a dark scrim. Landscape, {VIDEO_SIZE.width} × {VIDEO_SIZE.height}.
            </p>
          </div>

          {/* the clip */}
          <div>
            <label className="label">Video</label>
            <div className="flex gap-2">
              <input className="input flex-1" value={videoUrl}
                onChange={e => { setVideoUrl(e.target.value); setSaved(false) }}
                placeholder="Upload a file, or paste a link to one already hosted" />
              <button type="button" className="btn-primary flex-shrink-0 whitespace-nowrap"
                title="Choose an MP4 or WebM file from this computer"
                onClick={() => pickMedia('video', setVideoUrl)}>
                <Upload className="h-4 w-4" /> Upload
              </button>
              {videoUrl && (
                <button type="button" className="btn-ghost flex-shrink-0 text-rose-400"
                  onClick={clearVideo} title="Remove the clip">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              MP4 or WebM. Hard limit {kb(MAX_VIDEO_KB)}; aim for under {kb(ADVISED_VIDEO_KB)}.
            </p>

            {/* A visitor downloads this once and plays it from their own machine
                for ever after — but they still pay for that first copy, often on
                mobile data. Say the number rather than leaving it to be
                discovered by whoever waits. */}
            {heavy && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100/85">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                <span>
                  This clip is <strong className="text-amber-100">{kb(videoKb)}</strong>. It is stored on the
                  visitor’s machine after the first visit and costs nothing thereafter — but that first load is
                  {' '}{kb(videoKb)}, roughly {Math.ceil(videoKb / 1024 / 0.6)}s on a typical 5 Mbps mobile link,
                  with only the poster on screen until it lands. It sits behind a dark scrim, so re-encoding to
                  around {kb(ADVISED_VIDEO_KB)} usually costs nothing anyone can see.
                </span>
              </p>
            )}

            {videoUrl && (
              <video src={videoUrl} muted loop playsInline autoPlay
                className="mt-2 h-40 w-full rounded-lg object-cover" />
            )}
          </div>

          {/* the poster */}
          <div>
            <label className="label">Poster frame</label>
            <div className="flex gap-2">
              <input className="input flex-1" value={posterUrl}
                onChange={e => { setPosterUrl(e.target.value); setSaved(false) }}
                placeholder="Upload a picture, or paste a link" />
              <button type="button" className="btn-primary flex-shrink-0 whitespace-nowrap"
                title="Choose a JPG, PNG or WebP file from this computer"
                onClick={() => pickMedia('image', setPosterUrl)}>
                <Upload className="h-4 w-4" /> Upload
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Held on screen while the clip downloads, and shown <em>instead</em> of it to visitors who ask for
              reduced motion or are on a metered connection. Worth setting even with no clip at all — the heavier
              the clip, the more work the poster does.
            </p>
            {posterUrl && (
              <img src={posterUrl} alt="" className="mt-2 h-40 w-full rounded-lg object-cover" />
            )}
          </div>

          <div>
            <label className="label">
              How strongly the clip shows through ({Math.round((videoOpacity ?? 0.45) * 100)}%)
            </label>
            <input type="range" min="0.1" max="1" step="0.05" className="w-full accent-brand-600"
              value={videoOpacity ?? 0.45}
              onChange={e => { setVideoOpacity(Number(e.target.value)); setSaved(false) }} />
          </div>

          {upload && (
            <p className="flex items-center gap-2 text-xs text-brand-300">
              <Loader className="h-3.5 w-3.5 animate-spin" />
              Uploading the {upload.what}… {upload.pct}%
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-surface-border pt-4">
            <button type="button" onClick={save} disabled={saving || !!upload} className="btn-primary">
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save the background
            </button>
            {saved
              ? <span className="text-xs text-emerald-400">Saved — reload the front page to see it.</span>
              : <span className="text-xs text-slate-500">Uploads aren’t live until you save.</span>}
            {videoUrl && (
              <a href={videoUrl} target="_blank" rel="noreferrer noopener"
                className="ml-auto inline-flex items-center gap-1.5 text-xs text-brand-400 hover:underline">
                <ExternalLink className="h-3 w-3" /> Open the file
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
