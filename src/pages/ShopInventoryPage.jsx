import React, { useCallback, useEffect, useState } from 'react'
import {
  Store, Plus, Search, X, Loader, AlertCircle, Pencil, Trash2, Eye, EyeOff, PackageOpen, Upload, Image as ImageIcon,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import ShopWorkingHours from '../components/ShopWorkingHours'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { fetchShopCategoryNames } from '../lib/shopCategories'

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100
// `categories` is the tag list (multiple per item); it is chosen from the
// admin-managed product_categories lookup — suppliers can't invent new ones.
// Up to MAX_IMAGES photos per item, stored as data URLs in `images`.
const MAX_IMAGES = 3
// Optional variants (fix106): colours carry an optional swatch photo, sizes are
// free-form labels (35.5, XL…). Empty lists = item has no variants.
const MAX_COLORS = 8
const EMPTY = {
  name: '', description: '', price: '', currency: 'USD', images: [], stock_qty: '',
  categories: [], colors: [], sizes: [], is_displayed: true, is_made_to_order: false,
}

/* Per-partner/supplier shop inventory. Owners see and manage ONLY their own items
   (scoped by owner_contact_id) and choose which ones appear in the customer app. */
export default function ShopInventoryPage({ partyContactId = null }) {
  const { currentUser, hasRole } = useAuth()
  const { COMPANY_ID } = useApp()
  const ownerId = partyContactId || currentUser?.contact_id || null
  // Stocking the shop is a supplier job; partners never add items. Admins keep
  // access for support. The route itself is unmounted for partners — this is a
  // second line of defence.
  const canManage = hasRole('supplier', 'admin', 'super_admin')

  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [search,  setSearch]  = useState('')

  const [modal,   setModal]   = useState(null)   // 'add' | item (edit)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)
  // Allowed category tags — the curated shop_categories list (see
  // src/lib/shopCategories.js); suppliers can't create new ones.
  const [catOptions, setCatOptions] = useState([])
  const [catQuery,   setCatQuery]   = useState('')   // search inside the add-category box
  const [catFocus,   setCatFocus]   = useState(false)
  const [sizeInput,  setSizeInput]  = useState('')   // size being typed

  useEffect(() => {
    ;(async () => {
      setCatOptions(await fetchShopCategoryNames(COMPANY_ID))
    })()
  }, [COMPANY_ID])

  const fetchItems = useCallback(async () => {
    if (!ownerId) { setItems([]); setLoading(false); return }
    setLoading(true)
    const { data, error: e } = await supabase
      .from('shop_inventory')
      .select('*')
      .eq('owner_contact_id', ownerId)
      .order('created_at', { ascending: false })
    if (e) setError(e.message)
    else   { setItems(data ?? []); setError('') }
    setLoading(false)
  }, [ownerId])

  useEffect(() => { fetchItems() }, [fetchItems])

  if (!canManage) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Store className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Suppliers only</p>
        <p className="text-slate-500 text-sm">Shop items are stocked by suppliers.</p>
      </div>
    )
  }

  // Photos on an item, tolerating rows saved before fix105 (single image_url).
  const itemImages = it => (
    Array.isArray(it.images) && it.images.length
      ? it.images.filter(Boolean).slice(0, MAX_IMAGES)
      : (it.image_url ? [it.image_url] : []))

  // Tags on an item, tolerating rows saved before fix103 (single `category`).
  const itemCategories = it => (
    Array.isArray(it.categories) && it.categories.length
      ? it.categories
      : (it.category ? [it.category] : []))

  const q = search.trim().toLowerCase()
  const filtered = items.filter(it =>
    !q || it.name?.toLowerCase().includes(q) || it.description?.toLowerCase().includes(q)
    || itemCategories(it).some(c => c.toLowerCase().includes(q)))

  // Categories still available to add, narrowed by the search box.
  const catQ = catQuery.trim().toLowerCase()
  const catMatches = catOptions.filter(c =>
    !form.categories.includes(c) && (!catQ || c.toLowerCase().includes(catQ)))

  function addCategory(c) {
    setForm(f => (f.categories.includes(c) ? f : { ...f, categories: [...f.categories, c] }))
    setCatQuery('')
  }

  function openAdd()  { setForm(EMPTY); setFormErr(''); setCatQuery(''); setSizeInput(''); setModal('add') }
  function openEdit(it) {
    setForm({
      name: it.name ?? '', description: it.description ?? '',
      price: it.price ?? '', currency: it.currency ?? 'USD',
      images: itemImages(it), stock_qty: it.stock_qty ?? '',
      categories: itemCategories(it), is_displayed: !!it.is_displayed,
      is_made_to_order: !!it.is_made_to_order,
      colors: Array.isArray(it.colors) ? it.colors : [],
      sizes:  Array.isArray(it.sizes)  ? it.sizes  : [],
    })
    setFormErr(''); setCatQuery(''); setSizeInput(''); setModal(it)
  }
  function closeModal() { setModal(null); setForm(EMPTY); setFormErr('') }

  // Photos are read as data URLs and appended to `images` (same approach the
  // customer app uses for profile photos). Several can be picked at once.
  function onPickImage(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (files.length === 0) return

    const room = MAX_IMAGES - form.images.length
    if (room <= 0) { setFormErr(`Up to ${MAX_IMAGES} photos per item.`); return }
    const chosen = files.slice(0, room)
    if (files.length > room) setFormErr(`Only ${room} more photo${room === 1 ? '' : 's'} could be added (max ${MAX_IMAGES}).`)
    else setFormErr('')

    for (const file of chosen) {
      if (!file.type.startsWith('image/')) { setFormErr('Please choose image files only.'); continue }
      if (file.size > 750 * 1024)          { setFormErr('Each image must be under 750 KB.'); continue }
      const reader = new FileReader()
      reader.onload = () => setForm(f => (
        f.images.length >= MAX_IMAGES ? f : { ...f, images: [...f.images, String(reader.result || '')] }))
      reader.readAsDataURL(file)
    }
  }

  /* ── variants ─────────────────────────────────────────────── */

  function addColor() {
    setForm(f => (f.colors.length >= MAX_COLORS ? f : { ...f, colors: [...f.colors, { name: '', image: null }] }))
  }
  function setColor(i, patch) {
    setForm(f => ({ ...f, colors: f.colors.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }))
  }
  function removeColor(i) {
    setForm(f => ({ ...f, colors: f.colors.filter((_, idx) => idx !== i) }))
  }
  // Small swatch photo for a colour, stored as a data URL like the item photos.
  function onPickColorImage(i, e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setFormErr('Please choose an image file.'); return }
    if (file.size > 400 * 1024) { setFormErr('Colour photo must be under 400 KB.'); return }
    const reader = new FileReader()
    reader.onload = () => { setColor(i, { image: String(reader.result || '') }); setFormErr('') }
    reader.readAsDataURL(file)
  }

  function addSize() {
    const s = sizeInput.trim()
    if (!s) return
    setForm(f => (f.sizes.some(x => x.toLowerCase() === s.toLowerCase()) ? f : { ...f, sizes: [...f.sizes, s] }))
    setSizeInput('')
  }
  function removeSize(s) {
    setForm(f => ({ ...f, sizes: f.sizes.filter(x => x !== s) }))
  }

  function removeImage(i) {
    setForm(f => ({ ...f, images: f.images.filter((_, idx) => idx !== i) }))
  }
  // The first photo is the cover — shown on the card in the customer app.
  function makeCover(i) {
    setForm(f => (i === 0 ? f : { ...f, images: [f.images[i], ...f.images.filter((_, idx) => idx !== i)] }))
  }

  async function saveItem() {
    if (!ownerId) { setFormErr('Your login isn’t linked to a shop contact.'); return }
    if (!form.name.trim()) { setFormErr('Item name is required.'); return }
    setSaving(true); setFormErr('')
    const payload = {
      owner_contact_id: ownerId,
      company_id:       currentUser?.company_id ?? null,
      name:             form.name.trim(),
      description:      form.description.trim() || null,
      price:            round2(form.price),
      currency:         form.currency || 'USD',
      images:           form.images,
      // First photo mirrored into the old single-image column for back-compat.
      image_url:        form.images[0] || null,
      stock_qty:        form.stock_qty === '' ? null : Number(form.stock_qty),
      categories:       form.categories,
      // Kept in sync with the first tag so anything still reading the old
      // single-value column keeps working.
      category:         form.categories[0] || null,
      // Variants — colours need a name to be usable; blank rows are dropped.
      colors:           form.colors.filter(c => c.name?.trim()).map(c => ({ name: c.name.trim(), image: c.image || null })),
      sizes:            form.sizes,
      is_displayed:     !!form.is_displayed,
      // Food & co: prepared on request, so it carries no stock (fix114).
      is_made_to_order: !!form.is_made_to_order,
      updated_at:       new Date().toISOString(),
    }
    // A column the DB doesn't have yet (its migration hasn't been run) is
    // reported by PostgREST as "Could not find the 'x' column …". Drop that key
    // and save the rest rather than blocking the supplier — they keep the cover
    // photo / first category via the legacy columns.
    const missingColumn = (msg, col) =>
      new RegExp(`(could not find|column).*['"\`]?${col}['"\`]?`, 'i').test(msg)

    const send = p => (modal === 'add'
      ? supabase.from('shop_inventory').insert([p])
      : supabase.from('shop_inventory').update(p).eq('id', modal.id))

    let res = await send(payload)
    const degraded = []
    for (const col of ['images', 'categories', 'colors', 'sizes', 'is_made_to_order']) {
      if (!res.error || !missingColumn(res.error.message, col)) continue
      degraded.push(col)
      delete payload[col]                     // retry without the missing column
      res = await send(payload)
    }

    setSaving(false)
    if (res.error) {
      const msg = res.error.message
      const hint = /shop_inventory/i.test(msg) && /not exist|schema cache/i.test(msg)
        ? 'Shop inventory isn’t installed yet — run supabase-fix98.sql.'
        : msg
      setFormErr(hint)
      return
    }
    if (degraded.length) {
      const fixes = { images: 'fix105 (extra photos)', categories: 'fix103 (category tags)', colors: 'fix106 (colours)', sizes: 'fix106 (sizes)', is_made_to_order: 'fix114 (prepared on request)' }
      setError(`Item saved, but ${degraded.map(c => fixes[c]).join(' and ')} could not be stored — run the matching supabase migration.`)
    }
    closeModal(); fetchItems()
  }

  async function toggleDisplay(it) {
    setBusyId(it.id)
    const { error: e } = await supabase.from('shop_inventory')
      .update({ is_displayed: !it.is_displayed, updated_at: new Date().toISOString() }).eq('id', it.id)
    setBusyId(null)
    if (e) { setError(e.message); return }
    setError(''); fetchItems()
  }

  async function removeItem(it) {
    if (!window.confirm(`Delete “${it.name}” from your shop? This cannot be undone.`)) return
    setBusyId(it.id)
    const { error: e } = await supabase.from('shop_inventory').delete().eq('id', it.id)
    setBusyId(null)
    if (e) { setError(e.message); return }
    setError(''); fetchItems()
  }

  const fmt = (v, c) => `${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c}`

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-slate-100">My Shop Inventory</h2>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary ml-auto" onClick={openAdd} disabled={!ownerId}>
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {/* When the shop takes orders — drives Open/Closed in the customer app. */}
      {ownerId && <ShopWorkingHours contactId={ownerId} />}

      {!ownerId && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200 text-xs">Your login isn’t linked to a shop contact yet — ask an administrator to link it.</p>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs">{error}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border text-left text-slate-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3">In customer app</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                <PackageOpen className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                No items yet. Click “Add Item” to build your shop.
              </td></tr>
            ) : filtered.map(it => (
              <tr key={it.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 ${it.is_active === false ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {itemImages(it)[0]
                      ? <div className="relative flex-shrink-0">
                          <img src={itemImages(it)[0]} alt="" className="w-10 h-10 rounded-md object-cover border border-surface-border" />
                          {itemImages(it).length > 1 && (
                            <span className="absolute -bottom-1 -right-1 text-[9px] px-1 rounded bg-slate-900 border border-surface-border text-slate-300">
                              +{itemImages(it).length - 1}
                            </span>
                          )}
                        </div>
                      : <div className="w-10 h-10 rounded-md bg-surface-hover border border-surface-border flex items-center justify-center flex-shrink-0"><PackageOpen className="w-4 h-4 text-slate-600" /></div>}
                    <div className="min-w-0">
                      <p className="text-slate-100 font-medium truncate">{it.name}</p>
                      {it.description && <p className="text-slate-500 text-xs truncate max-w-[16rem]">{it.description}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {itemCategories(it).length === 0 ? <span className="text-slate-600">—</span> : (
                    <div className="flex flex-wrap gap-1">
                      {itemCategories(it).map(c => (
                        <span key={c} className="text-[11px] rounded px-1.5 py-0.5 bg-brand-500/10 text-brand-300 border border-brand-500/30">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-200 tabular-nums whitespace-nowrap">{fmt(it.price, it.currency)}</td>
                <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{it.stock_qty ?? '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleDisplay(it)} disabled={busyId === it.id}
                    title={it.is_displayed ? 'Shown to customers — click to hide' : 'Hidden — click to show'}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2.5 py-1 transition-colors ${
                      it.is_displayed
                        ? 'bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15'
                        : 'bg-slate-500/10 border-slate-500/30 text-slate-400 hover:bg-slate-500/15'}`}>
                    {busyId === it.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : (it.is_displayed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />)}
                    {it.is_displayed ? 'Displayed' : 'Hidden'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(it)} title="Edit" className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => removeItem(it)} title="Delete" className="btn-ghost p-1.5 text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">{modal === 'add' ? 'Add Item' : `Edit ${modal.name}`}</h3>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="label">Item name *</label>
                <input className="input" value={form.name} autoFocus
                  onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setFormErr('') }} placeholder="e.g. Margherita Pizza" />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input resize-none" rows={2} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description shown to customers" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Price</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Stock qty</label>
                  <input type="number" min="0" step="1" className="input" value={form.stock_qty}
                    onChange={e => setForm(f => ({ ...f, stock_qty: e.target.value }))} placeholder="—" />
                </div>
              </div>
              {/* Categories as tags — several per item, all picked from the
                  admin's list. Nothing new can be typed in here. */}
              <div>
                <label className="label">Categories</label>
                <div className="input min-h-[2.5rem] flex flex-wrap items-center gap-1.5 py-1.5">
                  {form.categories.length === 0 && (
                    <span className="text-slate-500 text-sm">No categories yet — pick from the list below</span>
                  )}
                  {form.categories.map(c => (
                    <span key={c}
                      className="inline-flex items-center gap-1 text-xs rounded-md px-2 py-1 bg-brand-500/15 text-brand-200 border border-brand-500/30">
                      {c}
                      <button type="button" title={`Remove ${c}`}
                        onClick={() => setForm(f => ({ ...f, categories: f.categories.filter(x => x !== c) }))}
                        className="text-brand-300/70 hover:text-brand-100">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                {/* Type to narrow the list, click to tag. Rendered inline (not
                    absolutely) so it can't be clipped by the modal's scroll. */}
                <div className="mt-2 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input className="input pl-9" value={catQuery} placeholder="Search categories to add…"
                    onFocus={() => setCatFocus(true)}
                    onBlur={() => setCatFocus(false)}
                    onChange={e => setCatQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setCatQuery(''); e.currentTarget.blur() }
                      if (e.key === 'Enter' && catMatches.length > 0) { e.preventDefault(); addCategory(catMatches[0]) }
                    }} />
                </div>
                {(catFocus || catQuery.trim()) && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-surface-border bg-surface-card p-1">
                    {catMatches.length === 0 ? (
                      <p className="px-2 py-3 text-center text-[11px] text-slate-500">
                        {catOptions.length === 0 ? 'No categories available yet.' : 'No matching category'}
                      </p>
                    ) : catMatches.map(c => (
                      <button key={c} type="button"
                        onMouseDown={e => e.preventDefault()}   // keep focus so the list stays open
                        onClick={() => addCategory(c)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-surface-hover text-left">
                        <Plus className="w-3.5 h-3.5 flex-shrink-0 text-brand-400" />
                        <span className="truncate">{c}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-slate-500 mt-1">
                  {catOptions.length === 0
                    ? 'No categories available yet — ask an administrator to add them.'
                    : 'Add as many as apply. Categories are managed by the administrator and can’t be created here.'}
                </p>
              </div>
              <div>
                <label className="label">Photos</label>
                <div className="flex items-start gap-3 flex-wrap">
                  {form.images.map((src, i) => (
                    <div key={i} className="relative w-20 h-20 flex-shrink-0 group">
                      <img src={src} alt="" className="w-20 h-20 rounded-md object-cover border border-surface-border" />
                      <button type="button" onClick={() => removeImage(i)} title="Remove photo"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500/90 text-white flex items-center justify-center hover:bg-red-500">
                        <X className="w-3 h-3" />
                      </button>
                      {i === 0 ? (
                        <span className="absolute bottom-0 inset-x-0 text-[9px] text-center bg-brand-600/80 text-white rounded-b-md py-0.5">Cover</span>
                      ) : (
                        <button type="button" onClick={() => makeCover(i)} title="Use as cover photo"
                          className="absolute bottom-0 inset-x-0 text-[9px] text-center bg-slate-900/80 text-slate-300 rounded-b-md py-0.5 hover:text-white">
                          Make cover
                        </button>
                      )}
                    </div>
                  ))}
                  {form.images.length < MAX_IMAGES && (
                    <label className="w-20 h-20 flex-shrink-0 rounded-md bg-surface-hover border border-dashed border-surface-border flex flex-col items-center justify-center gap-1 cursor-pointer text-slate-500 hover:text-slate-300">
                      <Upload className="w-4 h-4" />
                      <span className="text-[10px]">Add photo</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={onPickImage} />
                    </label>
                  )}
                  {form.images.length === 0 && (
                    <div className="w-20 h-20 rounded-md bg-surface-hover border border-surface-border flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="w-5 h-5 text-slate-600" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  Up to {MAX_IMAGES} photos per item, max 750 KB each. The first one is the cover
                  shown in the customer app.
                </p>
              </div>
              {/* ── Colours (optional) ─────────────────────────── */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="label">Colours <span className="text-slate-600 normal-case">(optional)</span></label>
                  {form.colors.length < MAX_COLORS && (
                    <button type="button" onClick={addColor}
                      className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                      <Plus className="w-3 h-3" /> Add colour
                    </button>
                  )}
                </div>
                {form.colors.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No colours — the item is sold as-is.</p>
                ) : (
                  <div className="space-y-2">
                    {form.colors.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <label className="w-12 h-12 flex-shrink-0 rounded-md border border-surface-border bg-surface-hover overflow-hidden cursor-pointer flex items-center justify-center"
                          title="Colour photo (optional)">
                          {c.image
                            ? <img src={c.image} alt="" className="w-full h-full object-cover" />
                            : <ImageIcon className="w-4 h-4 text-slate-600" />}
                          <input type="file" accept="image/*" className="hidden" onChange={e => onPickColorImage(i, e)} />
                        </label>
                        <input className="input flex-1" value={c.name} placeholder="e.g. Black, Red, Navy Blue"
                          onChange={e => setColor(i, { name: e.target.value })} />
                        {c.image && (
                          <button type="button" onClick={() => setColor(i, { image: null })} title="Remove colour photo"
                            className="btn-ghost p-1.5 text-slate-500 hover:text-slate-300 text-[11px]">clear</button>
                        )}
                        <button type="button" onClick={() => removeColor(i)} title="Remove colour"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <p className="text-[10px] text-slate-500">
                      A colour photo is optional (max 400 KB) — customers see it as a swatch tile.
                    </p>
                  </div>
                )}
              </div>

              {/* ── Sizes (optional) ───────────────────────────── */}
              <div>
                <label className="label">Sizes <span className="text-slate-600 normal-case">(optional)</span></label>
                {form.sizes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.sizes.map(s => (
                      <span key={s} className="inline-flex items-center gap-1 text-xs rounded-md px-2 py-1 bg-brand-500/15 text-brand-200 border border-brand-500/30">
                        {s}
                        <button type="button" onClick={() => removeSize(s)} title={`Remove ${s}`}
                          className="text-brand-300/70 hover:text-brand-100"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input className="input flex-1" value={sizeInput} placeholder="e.g. 42 or XL — press Enter to add"
                    onChange={e => setSizeInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSize() } }} />
                  <button type="button" onClick={addSize} disabled={!sizeInput.trim()}
                    className="btn-ghost px-3 py-2 text-xs border border-surface-border disabled:opacity-40">Add</button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Add each size the item comes in. Customers must pick one before adding to their cart.
                </p>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-emerald-500 mt-0.5" checked={form.is_made_to_order}
                  onChange={e => setForm(f => ({ ...f, is_made_to_order: e.target.checked }))} />
                <span className="text-sm text-slate-200">
                  Prepared on request (no stock)
                  <span className="block text-[11px] text-slate-500">
                    For food and made-to-order items — customers see how many were ordered instead of a stock level.
                  </span>
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={form.is_displayed}
                  onChange={e => setForm(f => ({ ...f, is_displayed: e.target.checked }))} />
                <span className="text-sm text-slate-200">Show this item in the customer app</span>
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
              <button onClick={saveItem} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : (modal === 'add' ? 'Add Item' : 'Save Changes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
