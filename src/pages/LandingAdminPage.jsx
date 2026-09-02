import React, { useCallback, useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Plus, Trash2, Loader, AlertCircle, Shield, X, Pencil, Eye, EyeOff, Upload,
  Image as ImageIcon, Film, CheckCircle2, GripVertical, ExternalLink, Newspaper,
  CalendarDays, Star, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  fetchLandingSettings, fetchLandingPosts, saveLandingSettings, saveLandingPost,
  deleteLandingPost, uploadLandingMedia, removeLandingMedia,
  POST_KINDS, CONTENT_FIELDS, MAX_IMAGE_KB, dayLabel,
} from '../lib/landingPage'

const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || null

const EMPTY_POST = {
  id: null, kind: 'event', title: '', body: '', location: '',
  event_date: '', images: [], is_published: true, sort_order: 0,
}

const EMPTY_SETTINGS = {
  isPublished: true, headline: '', tagline: '', intro: '',
  videoUrl: '', posterUrl: '', videoOpacity: 0.45,
  appDownloadUrl: '', appNote: '', stats: [], contacts: [],
}

const kb = n => `${(n / 1024).toFixed(0)} MB`

/* Settings → Front Page (admin).

   Everything the public landing page shows is written here: the welcome, the
   background clip, the figures, the app link behind the QR code, and the news
   and event galleries.

   The page is PUBLIC — it renders for anyone who opens the web address, signed
   in or not. So the warning at the top is not decoration: `is_published` is a
   filter the front page applies, not a permission the database enforces, and a
   draft row is still readable by anyone who looks for it. Nothing confidential
   belongs on this screen. */
export default function LandingAdminPage() {
  const { hasRole, currentUser } = useAuth()
  const isAdmin = hasRole('admin', 'super_admin')
  const isSuperAdmin = hasRole('super_admin')

  const [settings,   setSettings]   = useState(EMPTY_SETTINGS)
  const [settingsId, setSettingsId] = useState(null)
  const [posts,      setPosts]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [savingS,    setSavingS]    = useState(false)
  const [savedS,     setSavedS]     = useState(false)


  const [modal,   setModal]   = useState(null)     // 'add' | post
  const [form,    setForm]    = useState(EMPTY_POST)
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)
  const [upload,  setUpload]  = useState(null)     // { what, pct }

  const load = useCallback(async () => {
    setLoading(true)
    const [s, p] = await Promise.all([
      fetchLandingSettings(COMPANY_ID),
      fetchLandingPosts({ companyId: COMPANY_ID, publishedOnly: false }),
    ])
    if (s.settings) {
      setSettings({ ...EMPTY_SETTINGS, ...s.settings })
      setSettingsId(s.settings.id)
    }
    setPosts(p.posts)
    setError(s.error || p.error || '')
    setLoading(false)
  }, [])

  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])


  if (!isAdmin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Shield className="h-10 w-10 text-slate-600" />
        <p className="font-medium text-slate-300">Admins only</p>
        <p className="text-sm text-slate-500">The public front page is managed by an administrator.</p>
      </div>
    )
  }

  const setS = (k, v) => { setSettings(s => ({ ...s, [k]: v })); setSavedS(false) }

  async function saveSettings() {
    setSavingS(true); setError('')
    // Only the columns this screen owns. The clip is edited elsewhere, and a
    // full write from here would overwrite it with whatever stale copy this
    // page happens to be holding.
    const { error: e } = await saveLandingSettings(settings, {
      companyId: COMPANY_ID, userId: currentUser?.user_id, id: settingsId, only: CONTENT_FIELDS,
    })
    setSavingS(false)
    if (e) { setError(e); return }
    setSavedS(true)
    setTimeout(() => setSavedS(false), 2500)
    load()
  }

  /* ── media ──────────────────────────────────────────────────────────────── */

  /* Pictures only — the background clip is the super admin's, on its own page. */
  async function pickMedia(kind, onDone) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const capKb = MAX_IMAGE_KB
      if (file.size > capKb * 1024) {
        setFormErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${kb(capKb)}.`)
        return
      }
      setFormErr('')
      setUpload({ what: kind, pct: 0 })
      const { url, error: e } = await uploadLandingMedia(file, {
        onProgress: pct => setUpload(u => (u ? { ...u, pct: pct ?? u.pct } : u)),
      })
      setUpload(null)
      if (e) { setFormErr(e); return }
      onDone(url)
    }
    input.click()
  }

  /* ── posts ──────────────────────────────────────────────────────────────── */

  function openAdd(kind = 'event') { setForm({ ...EMPTY_POST, kind }); setFormErr(''); setModal('add') }
  function openEdit(p) {
    setForm({
      id: p.id, kind: p.kind, title: p.title, body: p.body, location: p.location,
      event_date: p.day || '', images: p.images, is_published: p.isPublished, sort_order: p.sortOrder,
    })
    setFormErr('')
    setModal(p)
  }

  async function savePost() {
    if (!form.title.trim() && form.images.length === 0) {
      setFormErr('Give it a title, or at least one picture — otherwise there is nothing to show.')
      return
    }
    setSaving(true)
    const { error: e } = await saveLandingPost(form, { companyId: COMPANY_ID, userId: currentUser?.user_id })
    setSaving(false)
    if (e) { setFormErr(e); return }
    setModal(null); setForm(EMPTY_POST); load()
  }

  async function removePost(p) {
    if (!window.confirm(`Delete “${p.title || 'this post'}” and its ${p.images.length} picture(s)? This cannot be undone.`)) return
    setBusyId(p.id)
    const { error: e } = await deleteLandingPost(p)
    setBusyId(null)
    if (e) { setError(e); return }
    load()
  }

  async function togglePublished(p) {
    setBusyId(p.id)
    await saveLandingPost({
      id: p.id, kind: p.kind, title: p.title, body: p.body, location: p.location,
      event_date: p.day || '', images: p.images, sort_order: p.sortOrder,
      is_published: !p.isPublished,
    }, { companyId: COMPANY_ID, userId: currentUser?.user_id })
    setBusyId(null)
    load()
  }

  const addImage    = (url) => setForm(f => ({ ...f, images: [...f.images, { url, caption: '' }] }))
  const setCaption  = (i, v) => setForm(f => ({ ...f, images: f.images.map((im, n) => (n === i ? { ...im, caption: v } : im)) }))
  const moveImage   = (i, step) => setForm(f => {
    const next = [...f.images]
    const j = i + step
    if (j < 0 || j >= next.length) return f
    ;[next[i], next[j]] = [next[j], next[i]]
    return { ...f, images: next }
  })
  const dropImage   = async (i) => {
    const img = form.images[i]
    setForm(f => ({ ...f, images: f.images.filter((_, n) => n !== i) }))
    if (img?.url) await removeLandingMedia(img.url)
  }

  const rowsFor = kind => posts.filter(p => p.kind === kind)

  /* ── list rows ──────────────────────────────────────────────────────────── */

  const PostRow = ({ p }) => (
    <div className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface-hover/20 p-3">
      {p.images[0]
        ? <img src={p.images[0].url} alt="" className="h-16 w-24 flex-shrink-0 rounded-lg object-cover" />
        : <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-surface-hover">
            <ImageIcon className="h-5 w-5 text-slate-600" />
          </div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-slate-100">{p.title || <span className="text-slate-500">Untitled</span>}</p>
          {!p.isPublished && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
              Draft
            </span>
          )}
          {p.sortOrder > 0 && (
            <span className="flex items-center gap-1 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-300">
              <Star className="h-2.5 w-2.5" /> Pinned
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {p.day ? dayLabel(p.day) : 'No date'}
          {p.location && <> · {p.location}</>}
          {p.images.length > 0 && <> · {p.images.length} picture{p.images.length === 1 ? '' : 's'}</>}
        </p>
        {p.body && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{p.body}</p>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button type="button" onClick={() => togglePublished(p)} disabled={busyId === p.id}
          className="btn-ghost p-2 text-slate-400" title={p.isPublished ? 'Unpublish' : 'Publish'}>
          {p.isPublished ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => openEdit(p)} className="btn-ghost p-2 text-slate-400" title="Edit">
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => removePost(p)} disabled={busyId === p.id}
          className="btn-ghost p-2 text-rose-400" title="Delete">
          {busyId === p.id ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6">

      {/* This page publishes to the open internet. Say so before anything else. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-100/85">
          <span className="font-medium text-amber-100">Everything here is public.</span> The front page is what
          visitors see before they sign in — anyone with the web address can read it. “Draft” hides a post from
          the page, but it does not hide the row from the internet, so never stage anything confidential here.
          {' '}The desktop app is unaffected: it opens straight on the sign-in window as it always has.
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
          <Loader className="h-4 w-4 animate-spin" /> Loading the front page…
        </div>
      ) : (
        <>
          {/* ── the page itself ──────────────────────────────────────────── */}
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">The welcome</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  The words at the top of the page, and the clip behind them.
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400"
                title="Off hides the whole front page — the web address then opens on the sign-in box, exactly as it did before this page existed.">
                <input type="checkbox" checked={settings.isPublished !== false}
                  onChange={e => setS('isPublished', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-surface-border bg-surface-hover accent-brand-600" />
                Show the front page to visitors
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="label">Headline</label>
                <input className="input" value={settings.headline}
                  onChange={e => setS('headline', e.target.value)} placeholder="Welcome to 3asari3" />
              </div>
              <div>
                <label className="label">Tagline</label>
                <input className="input" value={settings.tagline}
                  onChange={e => setS('tagline', e.target.value)}
                  placeholder="Deliveries, shops and stories — across Lebanon." />
              </div>
            </div>

            <div>
              <label className="label">Welcome note</label>
              <textarea className="input min-h-[110px]" value={settings.intro}
                onChange={e => setS('intro', e.target.value)}
                placeholder="A paragraph about 3asari3…" />
              <p className="mt-1 text-[11px] text-slate-500">Leave a blank line between paragraphs.</p>
            </div>

            {/* The background clip is NOT edited here. It lives with the other
                decorative media the developer account owns (the office Header
                Background, the Customer App Theme), because it is tens of
                megabytes served to every visitor and the slowest thing on the
                site. Named rather than hidden, so nobody hunts for it. */}
            {isSuperAdmin ? (
              <NavLink
                to="/settings/front-page-background"
                className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface-hover/20 p-4 transition-colors hover:border-brand-500/40"
              >
                <Film className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Background clip
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {settings.videoUrl ? 'A clip is set.' : 'No clip set.'} Managed under Super Admin → Front Page Background.
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-500" />
              </NavLink>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface-hover/20 p-4">
                <Film className="h-4 w-4 flex-shrink-0 text-slate-600" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Background clip
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {settings.videoUrl ? 'A clip is set.' : 'No clip set.'} Changed by the developer account —
                    ask a super admin.
                  </span>
                </span>
              </div>
            )}

            {/* the app link behind the QR */}
            <div className="rounded-xl border border-surface-border bg-surface-hover/20 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Mobile app — the QR code
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Download link</label>
                  <input className="input" value={settings.appDownloadUrl}
                    onChange={e => setS('appDownloadUrl', e.target.value)}
                    placeholder="https://… (store page or APK)" />
                  <p className="mt-1 text-[11px] text-slate-500">
                    The QR code is drawn from this. Leave it empty and the whole block is hidden.
                  </p>
                </div>
                <div>
                  <label className="label">Words beside the code</label>
                  <input className="input" value={settings.appNote}
                    onChange={e => setS('appNote', e.target.value)}
                    placeholder="Scan to install the 3asari3 customer app." />
                </div>
              </div>
              {settings.appDownloadUrl && (
                <a href={settings.appDownloadUrl} target="_blank" rel="noreferrer noopener"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand-400 hover:underline">
                  <ExternalLink className="h-3 w-3" /> Test the link
                </a>
              )}
            </div>

            {/* figures + contacts, both simple label/value lists */}
            <PairList
              title="Headline figures"
              note="Three read best. Shown as cards under the welcome."
              rows={settings.stats}
              fields={['label', 'value', 'note']}
              placeholders={['Deliveries completed', '48,000', 'since 2024']}
              onChange={rows => setS('stats', rows)}
            />
            <PairList
              title="Contact details"
              note="A short line at the foot of the page. Optional."
              rows={settings.contacts}
              fields={['label', 'value']}
              placeholders={['Call us', '+961 …']}
              onChange={rows => setS('contacts', rows)}
            />

            <div className="flex flex-wrap items-center gap-3 border-t border-surface-border pt-4">
              <button type="button" onClick={saveSettings} disabled={savingS || !!upload} className="btn-primary">
                {savingS ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save the welcome
              </button>
              {/* Uploading a file puts it in storage and fills the box above; it is
                  not on the front page until this button is pressed. Easy to miss,
                  so it is said here rather than left to be discovered. */}
              {savedS
                ? <span className="text-xs text-emerald-400">Saved — reload the front page to see it.</span>
                : <span className="text-xs text-slate-500">Uploads aren’t live until you save.</span>}
            </div>
          </div>

          {/* ── news & events ────────────────────────────────────────────── */}
          {POST_KINDS.map(kind => (
            <div key={kind.key} className="card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                    {kind.key === 'news' ? <Newspaper className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                    {kind.label}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">{kind.note}</p>
                </div>
                <button type="button" className="btn-primary" onClick={() => openAdd(kind.key)}>
                  <Plus className="h-4 w-4" /> Add {kind.label.toLowerCase()}
                </button>
              </div>
              {rowsFor(kind.key).length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Nothing here yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {rowsFor(kind.key).map(p => <PostRow key={p.id} p={p} />)}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ── the post editor ────────────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div className="card my-8 w-full max-w-2xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">
                {form.id ? 'Edit' : 'Add'} {form.kind === 'event' ? 'event' : 'news'}
              </h2>
              <button type="button" onClick={() => setModal(null)} className="btn-ghost p-2 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Kind</label>
                  <select className="input" value={form.kind}
                    onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                    {POST_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={form.event_date}
                    onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
                  <p className="mt-1 text-[11px] text-slate-500">What the page sorts on, newest first.</p>
                </div>
              </div>

              <div>
                <label className="label">Title</label>
                <input className="input" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>

              {form.kind === 'event' && (
                <div>
                  <label className="label">Where</label>
                  <input className="input" value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Beirut" />
                </div>
              )}

              <div>
                <label className="label">Context</label>
                <textarea className="input min-h-[100px]" value={form.body}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="What happened, and why it mattered…" />
                <p className="mt-1 text-[11px] text-slate-500">Leave a blank line between paragraphs.</p>
              </div>

              {/* pictures */}
              <div className="rounded-xl border border-surface-border bg-surface-hover/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Pictures ({form.images.length})
                  </h3>
                  <button type="button" className="btn-ghost text-xs text-slate-400"
                    onClick={() => pickMedia('image', addImage)}>
                    <Upload className="h-3.5 w-3.5" /> Add picture
                  </button>
                </div>
                {upload?.what === 'image' && (
                  <p className="mb-2 flex items-center gap-2 text-xs text-brand-300">
                    <Loader className="h-3.5 w-3.5 animate-spin" /> Uploading… {upload.pct}%
                  </p>
                )}
                {form.images.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    No pictures yet. The first one becomes the header of the card.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.images.map((img, i) => (
                      <div key={img.url + i} className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <button type="button" className="btn-ghost px-1 py-0 text-slate-500"
                            onClick={() => moveImage(i, -1)} disabled={i === 0} title="Move up">▲</button>
                          <button type="button" className="btn-ghost px-1 py-0 text-slate-500"
                            onClick={() => moveImage(i, 1)} disabled={i === form.images.length - 1} title="Move down">▼</button>
                        </div>
                        <img src={img.url} alt="" className="h-12 w-16 flex-shrink-0 rounded object-cover" />
                        <input className="input flex-1 text-xs" value={img.caption}
                          onChange={e => setCaption(i, e.target.value)} placeholder="Caption (optional)" />
                        <button type="button" className="btn-ghost p-1.5 text-rose-400"
                          onClick={() => dropImage(i)} title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <p className="text-[11px] text-slate-500">
                      The first picture leads the card; the rest sit beneath it as a strip.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={form.is_published !== false}
                    onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-surface-border bg-surface-hover accent-brand-600" />
                  Published
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400"
                  title="Pins this above the rest regardless of its date.">
                  <input type="checkbox" checked={(form.sort_order || 0) > 0}
                    onChange={e => setForm(f => ({ ...f, sort_order: e.target.checked ? 1 : 0 }))}
                    className="h-3.5 w-3.5 rounded border-surface-border bg-surface-hover accent-brand-600" />
                  Pin to the top
                </label>
              </div>

              {formErr && (
                <p className="flex items-start gap-2 text-xs text-rose-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {formErr}
                </p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-surface-border pt-4">
              <button type="button" className="btn-ghost text-slate-400" onClick={() => setModal(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={savePost} disabled={saving || !!upload}>
                {saving && <Loader className="h-4 w-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* A small editable list of label/value rows — the figures and the contact
   line are the same shape, so they are the same component. */
function PairList({ title, note, rows, fields, placeholders, onChange }) {
  const set = (i, k, v) => onChange(rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)))
  const add = () => onChange([...rows, Object.fromEntries(fields.map(f => [f, '']))])
  const del = (i) => onChange(rows.filter((_, n) => n !== i))
  return (
    <div className="rounded-xl border border-surface-border bg-surface-hover/20 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
          {note && <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>}
        </div>
        <button type="button" className="btn-ghost text-xs text-slate-400" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">None — the section is hidden.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-600" />
              {fields.map((f, n) => (
                <input key={f} className="input flex-1 text-xs" value={r[f] ?? ''}
                  placeholder={placeholders[n]} onChange={e => set(i, f, e.target.value)} />
              ))}
              <button type="button" className="btn-ghost p-1.5 text-rose-400" onClick={() => del(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
