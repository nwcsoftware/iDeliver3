import React, { useCallback, useEffect, useState } from 'react'
import {
  Store, Plus, Search, X, Loader, AlertCircle, Pencil, Trash2, Eye, EyeOff, PackageOpen, Upload, Image as ImageIcon,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import ShopWorkingHours from '../components/ShopWorkingHours'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { fetchShopCategoryNames } from '../lib/shopCategories'
import ItemOptionsEditor from '../components/shop/ItemOptionsEditor'
import { itemOptions, inStockValues, legacyMirror, choiceGroups } from '../lib/shopOptions'
import SearchField from '../components/ui/SearchField'

const CURRENCIES = ['USD', 'LBP', 'EUR']
const round2 = n => Math.round((Number(n) || 0) * 100) / 100
// `categories` is the tag list (multiple per item); it is chosen from the
// admin-managed product_categories lookup — suppliers can't invent new ones.
// Up to MAX_IMAGES photos per item, stored as data URLs in `images`.
const MAX_IMAGES = 3
/* Options (fix129): the shop names them — Size, Color, Flavor, Weight — and
   each value can be marked sold out on its own, so 43 can be finished while 44
   is still on the shelf. Empty list = the item is sold as it is. */
const EMPTY = {
  name: '', description: '', price: '', currency: 'USD', images: [], stock_qty: '',
  categories: [], options: [], combos: [], is_displayed: true, is_made_to_order: false,
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

  function openAdd()  { setForm(EMPTY); setFormErr(''); setCatQuery(''); setModal('add') }
  function openEdit(it) {
    setForm({
      name: it.name ?? '', description: it.description ?? '',
      price: it.price ?? '', currency: it.currency ?? 'USD',
      images: itemImages(it), stock_qty: it.stock_qty ?? '',
      categories: itemCategories(it), is_displayed: !!it.is_displayed,
      is_made_to_order: !!it.is_made_to_order,
      // Reads the new columns, and old colour/size rows just the same.
      options: itemOptions(it),
      combos:  Array.isArray(it.combos) ? it.combos : [],
    })
    setFormErr(''); setCatQuery(''); setModal(it)
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

    const cleanOptions = form.options
      .map(g => {
        const kind = g.kind === 'extra' ? 'extra' : 'choice'
        return {
          label: g.label.trim() || 'Options',
          kind,
          style: g.style === 'swatch' ? 'swatch' : 'chip',
          values: g.values
            .filter(v => v.name.trim())
            .map(v => ({
              name: v.name.trim(),
              image: v.image || null,
              sold_out: !!v.sold_out,
              // Only an extra charges anything; a size is part of the price.
              price_delta: kind === 'extra' ? (Number(v.price_delta) || 0) : 0,
            })),
        }
      })
      .filter(g => g.values.length > 0)

    /* Two options with the same name would be one option to the customer app,
       which keys every choice by its label — the second would silently
       overwrite the first in the cart. */
    const labels = cleanOptions.map(g => g.label.toLowerCase())
    const dupe = labels.find((l, i) => labels.indexOf(l) !== i)
    if (dupe) {
      setSaving(false)
      setFormErr(`Two options are both called “${dupe}”. Give each one its own name.`)
      return
    }
    const mirror = legacyMirror(cleanOptions)

    /* Combinations that name an option or a value that no longer exists are
       dropped: a rule about a size the shop has deleted would sit in the row
       forever, invisible and occasionally wrong. */
    const byLabel = new Map(choiceGroups(cleanOptions).map(g => [g.label, new Set(g.values.map(v => v.name))]))
    const cleanCombos = (form.combos || []).filter(c =>
      c?.picks && Object.keys(c.picks).length > 0
      && Object.entries(c.picks).every(([label, v]) => byLabel.get(label)?.has(v)))

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
      // Options — blank rows and unnamed groups are dropped; an option with no
      // values would be a question the customer cannot answer.
      options:          cleanOptions,
      // Per-combination exceptions: black comes in 43, white doesn't (fix130).
      combos:           cleanCombos,
      // Mirrored into the old two columns so anything still reading them — and
      // an install without fix129 — keeps seeing the choices on offer.
      colors:           mirror.colors,
      sizes:            mirror.sizes,
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
    for (const col of ['images', 'categories', 'options', 'combos', 'colors', 'sizes', 'is_made_to_order']) {
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
      const fixes = { images: 'fix105 (extra photos)', categories: 'fix103 (category tags)', options: 'fix129 (named options)', combos: 'fix130 (combinations)', colors: 'fix106 (colours)', sizes: 'fix106 (sizes)', is_made_to_order: 'fix114 (prepared on request)' }
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
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="input pl-9"
          />
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
                      {/* What this product offers, and what of it is finished —
                          visible without opening each item in turn. */}
                      {itemOptions(it).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {itemOptions(it).map(g => {
                            const open = inStockValues(g).length
                            const gone = g.values.length - open
                            return (
                              <span key={g.label}
                                title={g.values.map(v => v.name + (v.sold_out ? ' (sold out)' : '')).join(', ')}
                                className={`text-[10px] rounded px-1.5 py-0.5 border ${
                                  g.kind === 'extra'
                                    ? 'bg-violet-500/10 text-violet-300 border-violet-500/30'
                                    : open === 0
                                      ? 'bg-red-500/10 text-red-300 border-red-500/30'
                                      : 'bg-surface-hover text-slate-400 border-surface-border'}`}>
                                {g.label}: {open}
                                {gone > 0 && <span className="text-red-300/80"> (−{gone})</span>}
                              </span>
                            )
                          })}
                          {(it.combos?.length ?? 0) > 0 && (
                            <span title="Some combinations are sold out or not sold"
                              className="text-[10px] rounded px-1.5 py-0.5 border bg-amber-500/10 text-amber-300 border-amber-500/30">
                              {it.combos.length} combination{it.combos.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      )}
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
              {/* Options, sold-out values and the combinations grid — the same
                  editor the office Products catalog uses, so both sides of the
                  shop offer the customer exactly the same things. */}
              <ItemOptionsEditor
                options={form.options}
                combos={form.combos}
                currency={form.currency}
                onChange={({ options, combos }) => setForm(f => ({ ...f, options, combos }))}
                onError={setFormErr}
              />

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
