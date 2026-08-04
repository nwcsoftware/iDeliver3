import React, { useCallback, useEffect, useState } from 'react'
import {
  Image as ImageIcon, Upload, Trash2, Loader, AlertCircle, Shield, Plus, X,
  CalendarClock, Eye, EyeOff, Pencil, CheckCircle2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  fetchHeaderBackgrounds, saveHeaderBackground, deleteHeaderBackground,
  isCurrent, DEFAULT_OPACITY,
} from '../lib/headerBackground'

const MAX_KB = 900

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = v => (v ? new Date(v).toISOString() : null)

function fmtWhen(ts) {
  if (!ts) return null
  const d = new Date(ts)
  return isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const EMPTY = { name: '', image_url: '', start_at: '', end_at: '', opacity: DEFAULT_OPACITY, is_active: true }

/* Settings → Header Background (super admin).

   Schedules a decorative image for the application header bar. While a banner's
   date window is current, every signed-in user sees it behind the header —
   there is nothing to click, it is display only. */
export default function HeaderBackgroundPage() {
  const { hasRole, currentUser } = useAuth()
  const { COMPANY_ID, refreshHeaderBackground } = useApp()
  const isSuperAdmin = hasRole('super_admin')

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [modal,   setModal]   = useState(null)   // 'add' | row
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: r, error: e } = await fetchHeaderBackgrounds(COMPANY_ID)
    setRows(r); setError(e || ''); setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { if (isSuperAdmin) load() }, [isSuperAdmin, load])

  if (!isSuperAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Super admin only</p>
        <p className="text-slate-500 text-sm">The header background is managed by the developer account.</p>
      </div>
    )
  }

  function openAdd() { setForm(EMPTY); setFormErr(''); setModal('add') }
  function openEdit(r) {
    setForm({
      name: r.name ?? '', image_url: r.image_url ?? '',
      start_at: toLocalInput(r.start_at), end_at: toLocalInput(r.end_at),
      opacity: Number(r.opacity) || DEFAULT_OPACITY, is_active: r.is_active !== false,
    })
    setFormErr(''); setModal(r)
  }
  function closeModal() { setModal(null); setForm(EMPTY); setFormErr('') }

  function onPickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setFormErr('Please choose an image file.'); return }
    if (file.size > MAX_KB * 1024)       { setFormErr(`Image must be under ${MAX_KB} KB.`); return }
    const reader = new FileReader()
    reader.onload = () => { setForm(f => ({ ...f, image_url: String(reader.result || '') })); setFormErr('') }
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!form.image_url) { setFormErr('Choose an image first.'); return }
    if (form.start_at && form.end_at && new Date(form.end_at) <= new Date(form.start_at)) {
      setFormErr('The end date must be after the start date.'); return
    }
    setSaving(true); setFormErr('')
    const err = await saveHeaderBackground({
      id: modal === 'add' ? null : modal.id,
      name: form.name,
      image_url: form.image_url,
      start_at: fromLocalInput(form.start_at),
      end_at:   fromLocalInput(form.end_at),
      opacity:  form.opacity,
      is_active: form.is_active,
    }, { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setSaving(false)
    if (err) {
      setFormErr(/header_backgrounds/i.test(err) && /not exist|schema cache/i.test(err)
        ? 'Header backgrounds aren’t installed yet — run supabase-fix109.sql.'
        : err)
      return
    }
    closeModal(); load(); refreshHeaderBackground?.()
  }

  async function toggleActive(r) {
    setBusyId(r.id)
    const err = await saveHeaderBackground({ ...r, is_active: !(r.is_active !== false) },
      { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setBusyId(null)
    if (err) { setError(err); return }
    load(); refreshHeaderBackground?.()
  }

  async function remove(r) {
    setBusyId(r.id)
    const err = await deleteHeaderBackground(r.id)
    setBusyId(null)
    if (err) { setError(err); return }
    load(); refreshHeaderBackground?.()
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">Header Background</h2>
        </div>
        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> New background
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Schedule a picture for the application header bar. While its date window is current,
        every signed-in user sees it behind the header — it is decoration only, with nothing to click.
        Leave the start empty to begin immediately, or the end empty to run indefinitely.
      </p>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Image', 'Name', 'Shows from', 'Until', 'Opacity', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No header backgrounds yet.</td></tr>
            ) : rows.map(r => {
              const live = isCurrent(r)
              return (
                <tr key={r.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 ${r.is_active === false ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <img src={r.image_url} alt="" className="w-28 h-9 rounded object-cover border border-surface-border" />
                  </td>
                  <td className="px-4 py-3 text-slate-100">{r.name || <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtWhen(r.start_at) || 'Immediately'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmtWhen(r.end_at) || 'No end'}</td>
                  <td className="px-4 py-3 text-slate-400 tabular-nums">{Math.round((Number(r.opacity) || DEFAULT_OPACITY) * 100)}%</td>
                  <td className="px-4 py-3">
                    {r.is_active === false ? (
                      <span className="text-[11px] border rounded px-2 py-0.5 bg-slate-500/10 text-slate-400 border-slate-500/30">Off</span>
                    ) : live ? (
                      <span className="inline-flex items-center gap-1 text-[11px] border rounded px-2 py-0.5 bg-green-500/10 text-green-300 border-green-500/30">
                        <CheckCircle2 className="w-3 h-3" /> Showing now
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] border rounded px-2 py-0.5 bg-amber-500/10 text-amber-300 border-amber-500/30">
                        <CalendarClock className="w-3 h-3" /> Scheduled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(r)} title="Edit"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => toggleActive(r)} disabled={busyId === r.id}
                        title={r.is_active === false ? 'Turn on' : 'Turn off'}
                        className="btn-ghost p-1.5 text-slate-400 hover:text-amber-300 disabled:opacity-40">
                        {busyId === r.id ? <Loader className="w-4 h-4 animate-spin" />
                          : r.is_active === false ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      <button onClick={() => remove(r)} disabled={busyId === r.id} title="Delete"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-40">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Add / edit ─────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">
                {modal === 'add' ? 'New header background' : 'Edit header background'}
              </h3>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="label">Name</label>
                <input className="input" value={form.name} placeholder="e.g. Ramadan, Christmas, National Day"
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              <div>
                <label className="label">Image *</label>
                <div className="flex items-center gap-3">
                  {form.image_url
                    ? <img src={form.image_url} alt="" className="w-40 h-12 rounded object-cover border border-surface-border flex-shrink-0" />
                    : <div className="w-40 h-12 rounded bg-surface-hover border border-surface-border flex items-center justify-center flex-shrink-0">
                        <ImageIcon className="w-5 h-5 text-slate-600" />
                      </div>}
                  <div className="flex flex-col gap-1.5">
                    <label className="btn-ghost px-3 py-1.5 text-xs border border-surface-border rounded-lg cursor-pointer inline-flex items-center gap-1.5 w-max hover:text-slate-100">
                      <Upload className="w-3.5 h-3.5" /> {form.image_url ? 'Change image' : 'Upload image'}
                      <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                    </label>
                    <p className="text-[10px] text-slate-500">Wide images work best (the header is a thin bar). Max {MAX_KB} KB.</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start date</label>
                  <input type="datetime-local" className="input" value={form.start_at}
                    onChange={e => { setForm(f => ({ ...f, start_at: e.target.value })); setFormErr('') }} />
                  <p className="text-[10px] text-slate-500 mt-1">Empty = starts immediately.</p>
                </div>
                <div>
                  <label className="label">End date</label>
                  <input type="datetime-local" className="input" value={form.end_at}
                    onChange={e => { setForm(f => ({ ...f, end_at: e.target.value })); setFormErr('') }} />
                  <p className="text-[10px] text-slate-500 mt-1">Empty = no end.</p>
                </div>
              </div>

              <div>
                <label className="label">Opacity — {Math.round(form.opacity * 100)}%</label>
                <input type="range" min="5" max="100" step="5" className="w-full accent-brand-500"
                  value={Math.round(form.opacity * 100)}
                  onChange={e => setForm(f => ({ ...f, opacity: Number(e.target.value) / 100 }))} />
                {/* Live preview of exactly what the header will look like */}
                {/* Same height as the real header (50px) so the preview is honest */}
                <div className="mt-2 relative h-[50px] rounded-lg border border-surface-border bg-surface-card overflow-hidden">
                  {form.image_url && (<>
                    <div className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url("${form.image_url}")`, opacity: form.opacity }} />
                    <div className="absolute inset-0 bg-gradient-to-r from-surface-card/85 via-surface-card/40 to-surface-card/85" />
                  </>)}
                  <div className="relative h-full flex items-center px-4">
                    <span className="text-sm font-semibold text-slate-100 drop-shadow">Preview — app header</span>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span className="text-sm text-slate-200">Active (uncheck to keep it scheduled but hidden)</span>
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
              <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
