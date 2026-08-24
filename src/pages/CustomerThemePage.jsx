import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Palette, Plus, X, Loader, AlertCircle, Trash2, Pencil, Upload, Film,
  CalendarRange, Shield, Eye, EyeOff, Smartphone, CheckCircle2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  CUSTOMER_THEMES, DEFAULT_THEME, themeByKey, themeSwatches, themeVariables,
  THEME_MEDIA_SIZE, MAX_VIDEO_KB, MAX_POSTER_KB, ADVISED_VIDEO_KB,
  fetchCustomerThemes, saveCustomerTheme, deleteCustomerTheme,
  uploadThemeMedia, removeThemeMedia, pickCurrent, isCurrent,
} from '../lib/customerThemes'

const todayStr = () => new Date().toISOString().slice(0, 10)
const dmy = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : String(d)
}

const emptyForm = () => ({
  theme_key: 'ocean_blue', name: '', media_url: '', poster_url: '',
  starts_on: todayStr(), ends_on: '', overlay: 0.55, is_active: true,
})

/* Settings → Customer App Theme.

   The super admin dresses the customer's phone for the season: a theme repaints
   the app through its role colours, and an optional clip plays behind it. Both
   are scheduled by date, so Ramadan or Christmas arrives on its own and leaves
   again without anyone remembering to switch it off.

   The clip is uploaded to storage and referenced by URL — the same lesson the
   office banner learned in fix125: a movie inside the row is a movie every
   phone downloads, base64-inflated, on every start. */
export default function CustomerThemePage() {
  const { currentUser, hasRole } = useAuth()
  const { COMPANY_ID } = useApp()
  const isSuperAdmin = hasRole('super_admin')

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [missing, setMissing] = useState(false)

  const [modal,   setModal]   = useState(null)     // 'add' | row
  const [form,    setForm]    = useState(emptyForm())
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)
  const [uploading, setUploading] = useState('')   // 'video' | 'poster' | ''
  const [progress,  setProgress]  = useState(0)    // % of the current upload
  const [notice,    setNotice]    = useState('')   // a warning that isn't an error
  const [confirmDelete, setConfirmDelete] = useState(null)
  const videoInput  = useRef(null)
  const posterInput = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: r, missing: m, error: e } = await fetchCustomerThemes(COMPANY_ID)
    setRows(r); setMissing(!!m)
    setError(m ? '' : (e || ''))
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { if (isSuperAdmin) load() }, [isSuperAdmin, load])

  const live = useMemo(() => pickCurrent(rows), [rows])

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Super admin only</p>
        <p className="text-slate-500 text-sm">The customer app’s theme is set by the super admin.</p>
      </div>
    )
  }

  function openAdd() { setForm(emptyForm()); setFormErr(''); setModal('add') }
  function openEdit(r) {
    setForm({
      theme_key: r.theme_key || 'ocean_blue',
      name: r.name ?? '',
      media_url: r.media_url ?? '',
      poster_url: r.poster_url ?? '',
      starts_on: r.starts_on ?? '',
      ends_on: r.ends_on ?? '',
      overlay: Number(r.overlay ?? 0.55),
      is_active: r.is_active !== false,
    })
    setFormErr(''); setModal(r)
  }
  function closeModal() { setModal(null); setForm(emptyForm()); setFormErr('') }

  async function pickFile(kind, e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isVideo = kind === 'video'
    const capKb = isVideo ? MAX_VIDEO_KB : MAX_POSTER_KB
    if (isVideo && !file.type.startsWith('video/')) { setFormErr('Choose a video file (mp4 or webm).'); return }
    if (!isVideo && !file.type.startsWith('image/')) { setFormErr('Choose an image file for the poster.'); return }
    if (file.size > capKb * 1024) {
      setFormErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${(capKb / 1024).toFixed(0)} MB.`)
      return
    }
    // Not a refusal — a clip this size is a slow upload here and a slow first
    // frame on a phone, and the person deserves to know before they wait.
    setNotice(isVideo && file.size > ADVISED_VIDEO_KB * 1024
      ? `That clip is ${(file.size / 1024 / 1024).toFixed(1)} MB. Under ${(ADVISED_VIDEO_KB / 1024).toFixed(0)} MB uploads faster here and starts faster on a phone.`
      : '')

    setUploading(kind); setFormErr(''); setProgress(0)
    const { url, error: e2 } = await uploadThemeMedia(file, { onProgress: pct => setProgress(pct ?? 0) })
    setUploading(''); setProgress(0)
    if (e2) { setFormErr(e2); return }
    setForm(f => (isVideo ? { ...f, media_url: url } : { ...f, poster_url: url }))
  }

  async function save() {
    if (!form.theme_key) { setFormErr('Choose a theme.'); return }
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) {
      setFormErr('The end date must be on or after the start date.'); return
    }
    setSaving(true); setFormErr('')
    const err = await saveCustomerTheme(
      { ...form, id: modal === 'add' ? null : modal.id },
      { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setSaving(false)
    if (err) {
      setFormErr(/customer_themes/i.test(err) && /not exist|schema cache/i.test(err)
        ? 'Customer themes aren’t installed yet — run supabase-fix133.sql.' : err)
      return
    }
    closeModal(); load()
  }

  async function toggleActive(r) {
    setBusyId(r.id)
    const err = await saveCustomerTheme({ ...r, is_active: !(r.is_active !== false) },
      { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  async function remove(r) {
    setBusyId(r.id)
    const err = await deleteCustomerTheme(r.id)
    if (!err) await removeThemeMedia(r.media_url)     // tidy the stored clip
    setBusyId(null); setConfirmDelete(null)
    if (err) { setError(err); return }
    load()
  }

  const chosen = themeByKey(form.theme_key)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-brand-400" />
          <span className="text-[11px] text-slate-500">colours and a background movie, by date</span>
        </div>
        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> Schedule a theme
        </button>
      </div>

      {missing && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200 text-xs leading-relaxed">
            Customer themes aren’t installed yet — run <span className="font-mono">supabase-fix133.sql</span>.
            Until then the customer app keeps its everyday look.
          </p>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* What the customer sees right now */}
      <div className="card p-4 flex items-center gap-4 flex-wrap">
        <Smartphone className="w-5 h-5 text-slate-400" />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">On the phone today</p>
          <p className="text-sm font-semibold text-slate-100">
            {live ? themeByKey(live.theme_key).name : `${DEFAULT_THEME.name} — nothing scheduled`}
          </p>
        </div>
        <ThemeSwatches themeKey={live?.theme_key || DEFAULT_THEME.key} />
        {live?.media_url && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 border border-surface-border rounded-lg px-2 py-1">
            <Film className="w-3.5 h-3.5" /> background movie
          </span>
        )}
      </div>

      {/* The schedule */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Theme', 'Colours', 'Movie', 'From', 'To', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center">
                <Palette className="w-8 h-8 mx-auto text-slate-600" />
                <p className="mt-2 text-sm text-slate-300">Nothing scheduled</p>
                <p className="mt-1 text-xs text-slate-500">
                  The customer app is showing {DEFAULT_THEME.name}. Schedule a theme to dress it for the season.
                </p>
              </td></tr>
            ) : rows.map(r => {
              const t = themeByKey(r.theme_key)
              const showing = live?.id === r.id
              return (
                <tr key={r.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-100 font-medium">{t.name}</span>
                      {showing && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-300">
                          live now
                        </span>
                      )}
                    </div>
                    {r.name && <p className="text-[11px] text-slate-500">{r.name}</p>}
                  </td>
                  <td className="px-4 py-3"><ThemeSwatches themeKey={r.theme_key} /></td>
                  <td className="px-4 py-3">
                    {r.media_url
                      ? <a href={r.media_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-[11px] text-brand-300 hover:text-brand-200">
                          <Film className="w-3.5 h-3.5" /> view
                        </a>
                      : <span className="text-slate-600 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{dmy(r.starts_on)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{dmy(r.ends_on)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${
                      r.is_active === false ? 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                        : isCurrent(r) ? 'bg-green-500/10 text-green-300 border-green-500/30'
                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
                      {r.is_active === false ? 'Off' : isCurrent(r) ? 'In date' : 'Scheduled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => toggleActive(r)} disabled={busyId === r.id}
                        title={r.is_active === false ? 'Turn on' : 'Turn off'}
                        className={`btn-ghost p-1.5 ${r.is_active === false ? 'text-slate-400 hover:text-green-400' : 'text-green-400 hover:text-slate-300'}`}>
                        {busyId === r.id ? <Loader className="w-4 h-4 animate-spin" />
                          : r.is_active === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button onClick={() => openEdit(r)} title="Edit"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmDelete(r)} title="Delete"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Windows may overlap — the app shows the most specific one, so a dated occasion beats a theme left
        running all year. A clip should be authored at {THEME_MEDIA_SIZE.width} × {THEME_MEDIA_SIZE.height}
        (a phone held upright); anything else is cropped to fill. It is stored as a file and streamed, so keep
        it short and under {(MAX_VIDEO_KB / 1024).toFixed(0)} MB.
      </p>

      {/* ── Add / edit ─────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-2xl flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">
                {modal === 'add' ? 'Schedule a theme' : `Edit — ${themeByKey(modal.theme_key).name}`}
              </h3>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* The themes */}
              <div>
                <label className="label">Theme</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CUSTOMER_THEMES.map(t => {
                    const on = form.theme_key === t.key
                    return (
                      <button key={t.key} type="button"
                        onClick={() => setForm(f => ({ ...f, theme_key: t.key }))}
                        className={`text-left rounded-lg border p-3 transition-colors ${
                          on ? 'border-brand-500/50 bg-brand-500/5' : 'border-surface-border hover:bg-surface-hover/40'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-100">{t.name}</span>
                          {t.key === 'default' && <span className="text-[10px] text-slate-500">everyday</span>}
                          {on && <CheckCircle2 className="w-3.5 h-3.5 text-brand-300 ml-auto" />}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{t.note}</p>
                        <div className="mt-2"><ThemeSwatches themeKey={t.key} /></div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* What it will look like */}
              <ThemePreview themeKey={form.theme_key} mediaUrl={form.media_url}
                posterUrl={form.poster_url} overlay={form.overlay} />

              <div>
                <label className="label">Label <span className="text-slate-600 normal-case">(optional, for your own list)</span></label>
                <input className="input" value={form.name} placeholder={`e.g. ${chosen.name} 2026`}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              {/* The movie */}
              <div className="rounded-lg border border-surface-border p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" /> Background movie
                    <span className="text-slate-600 normal-case">(optional)</span>
                  </p>
                  <span className="text-[10px] text-slate-500">
                    {THEME_MEDIA_SIZE.width} × {THEME_MEDIA_SIZE.height} · best under {(ADVISED_VIDEO_KB / 1024).toFixed(0)} MB
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => videoInput.current?.click()} disabled={!!uploading}
                    className="btn-ghost px-3 py-2 text-xs border border-surface-border text-slate-200 disabled:opacity-50">
                    {uploading === 'video' ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : <><Upload className="w-3.5 h-3.5" /> Upload clip</>}
                  </button>
                  <input ref={videoInput} type="file" accept="video/*" className="hidden" onChange={e => pickFile('video', e)} />

                  <button type="button" onClick={() => posterInput.current?.click()} disabled={!!uploading}
                    className="btn-ghost px-3 py-2 text-xs border border-surface-border text-slate-300 disabled:opacity-50">
                    {uploading === 'poster' ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : <><Upload className="w-3.5 h-3.5" /> Poster still</>}
                  </button>
                  <input ref={posterInput} type="file" accept="image/*" className="hidden" onChange={e => pickFile('poster', e)} />

                  {form.media_url && (
                    <button type="button" onClick={() => setForm(f => ({ ...f, media_url: '' }))}
                      className="btn-ghost px-2 py-2 text-xs text-slate-400 hover:text-red-300">remove clip</button>
                  )}
                </div>

                {!!uploading && (
                  <div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                      <div className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
                        style={{ width: `${Math.max(progress, 3)}%` }} />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Uploading {uploading === 'video' ? 'the clip' : 'the poster'} — {progress}%. Large files take a while;
                      leave this open until it finishes.
                    </p>
                  </div>
                )}

                {notice && (
                  <p className="text-[11px] text-amber-300/90">{notice}</p>
                )}

                <input className="input font-mono text-xs" value={form.media_url} placeholder="…or paste a link to a hosted clip"
                  onChange={e => setForm(f => ({ ...f, media_url: e.target.value }))} />

                <div>
                  <label className="label flex items-center justify-between">
                    <span>Dim the movie</span>
                    <span className="text-slate-400 normal-case tabular-nums">{Math.round((form.overlay ?? 0.55) * 100)}%</span>
                  </label>
                  <input type="range" min="0" max="0.9" step="0.05" className="w-full accent-brand-500"
                    value={form.overlay ?? 0.55}
                    onChange={e => setForm(f => ({ ...f, overlay: Number(e.target.value) }))} />
                  <p className="text-[10px] text-slate-500">
                    The app’s own background sits over the clip at this strength, so prices and buttons stay readable.
                  </p>
                </div>
              </div>

              {/* When */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label flex items-center gap-1"><CalendarRange className="w-3 h-3" /> From</label>
                  <input type="date" className="input" value={form.starts_on}
                    onChange={e => setForm(f => ({ ...f, starts_on: e.target.value }))} />
                </div>
                <div>
                  <label className="label flex items-center gap-1"><CalendarRange className="w-3 h-3" /> To</label>
                  <input type="date" className="input" value={form.ends_on}
                    onChange={e => setForm(f => ({ ...f, ends_on: e.target.value }))} />
                </div>
              </div>
              <p className="text-[10px] text-slate-500">
                Leave both empty for an everyday theme with no end. Dates are inclusive — a theme ending 25/12
                still shows on Christmas Day.
              </p>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span className="text-sm text-slate-200">On — show it while it is in date</span>
              </label>

              {formErr && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{formErr}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={closeModal} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={save} disabled={saving || !!uploading} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-sm p-5 space-y-4">
            <p className="text-sm text-slate-200">
              Delete the <span className="font-semibold">{themeByKey(confirmDelete.theme_key).name}</span> schedule?
            </p>
            <p className="text-xs text-slate-500">
              Its uploaded clip is removed too. The customer app falls back to whatever else is scheduled,
              or to {DEFAULT_THEME.name}.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={() => remove(confirmDelete)} disabled={busyId === confirmDelete.id}
                className="px-4 py-2 text-sm rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-60">
                {busyId === confirmDelete.id ? <Loader className="w-4 h-4 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* The four colours that carry a theme, as chips. */
function ThemeSwatches({ themeKey }) {
  return (
    <div className="flex items-center gap-1">
      {themeSwatches(themeKey).map((hex, i) => (
        <span key={i} title={hex}
          className="w-5 h-5 rounded-full border border-black/20"
          style={{ background: hex }} />
      ))}
    </div>
  )
}

/* A phone-shaped preview, painted with the theme's own variables so what is
   shown here is what the customer's app will look like — not an impression of
   it drawn by hand. */
function ThemePreview({ themeKey, mediaUrl, posterUrl, overlay = 0.55 }) {
  const vars = useMemo(() => {
    const v = themeVariables(themeKey)
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val]))
  }, [themeKey])

  const rgb = (name) => `rgb(${vars[name]})`
  return (
    <div className="flex items-start gap-4">
      <div className="relative w-[132px] h-[264px] rounded-[18px] border-4 border-slate-700 overflow-hidden flex-shrink-0"
        style={{ background: rgb('--app-ground') }}>
        {mediaUrl && (
          <video src={mediaUrl} poster={posterUrl || undefined}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay loop muted playsInline />
        )}
        <div className="absolute inset-0" style={{ background: rgb('--app-ground'), opacity: mediaUrl ? overlay : 1 }} />
        <div className="relative p-2 space-y-1.5">
          <div className="h-6 rounded-md" style={{ background: rgb('--shop-600') }} />
          <div className="h-10 rounded-md" style={{ background: rgb('--shop-100') }} />
          <div className="flex gap-1">
            <div className="h-4 w-10 rounded-full" style={{ background: rgb('--shop-600') }} />
            <div className="h-4 w-8 rounded-full" style={{ background: rgb('--accent-500') }} />
            <div className="h-4 w-8 rounded-full" style={{ background: rgb('--fresh-600') }} />
          </div>
          <div className="h-12 rounded-md" style={{ background: rgb('--shop-50') }} />
          <div className="h-3 w-16 rounded" style={{ background: rgb('--fresh-600') }} />
        </div>
      </div>
      <div className="text-[11px] text-slate-500 leading-relaxed">
        <p className="text-slate-300 font-medium text-xs">{themeByKey(themeKey).name}</p>
        <p className="mt-1">{themeByKey(themeKey).note}</p>
        <p className="mt-2">
          The buttons, chips and confirmations take these colours automatically — every screen of the customer
          app follows, with nothing to change page by page.
        </p>
        {mediaUrl && <p className="mt-2 text-slate-400">The clip loops silently behind everything, dimmed to {Math.round(overlay * 100)}%.</p>}
      </div>
    </div>
  )
}
