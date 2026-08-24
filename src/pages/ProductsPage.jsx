import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Edit2,
  Power,
  X,
  Check,
  AlertCircle,
  Tag,
  DollarSign,
  Package,
  Barcode,
  Circle,
  Loader2,
  RefreshCw,
  Wrench,
  Upload,
  Image as ImageIcon,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import ItemOptionsEditor from '../components/shop/ItemOptionsEditor'
import { itemOptions, legacyMirror, choiceGroups } from '../lib/shopOptions'
import { useApp } from '../context/AppContext'
import {
  generateProductCode, insertProductWithUniqueCode,
  productKind, codePrefix, codeMatchesPrefix, kindFlags, isStockedKind,
  PRODUCT_KINDS, PRODUCT_CODE_PREFIXES,
} from '../lib/productCode'
import SearchField from '../components/ui/SearchField'

const UNITS = ['pcs', 'kg', 'g', 'liter', 'ml', 'box', 'bag', 'meter', 'pair', 'set']

const FLAG_COLORS = {
  purple: 'bg-purple-500/15 border-purple-500/40 text-purple-300',
  cyan:   'bg-cyan-500/15 border-cyan-500/40 text-cyan-300',
  amber:  'bg-amber-500/15 border-amber-500/40 text-amber-300',
}

// On/off toggle button used for the product flags.
function FlagToggle({ active, onClick, color = 'cyan', children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border transition-colors select-none
        ${active ? FLAG_COLORS[color] : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
      {active ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 flex-shrink-0" />}
      {children}
    </button>
  )
}

const EMPTY_FORM = {
  code: '', name: '', description: '', barcode: '',
  unit_of_measure: 'pcs', unit_cost: '', unit_price: '',
  currency: 'USD', reorder_level: '', reorder_quantity: '',
  // Kind is a single choice — exactly one of these is ever true. New items
  // start as Retail, the common case.
  is_retail: true, is_returnable: false, is_service: false, is_advertisement: false,
  category_id: '',
  // Presentation in the customer app, mirroring the supplier's shop item form:
  // up to MAX_IMAGES photos (first = cover), and the options the catalog item
  // is sold in — named by the office, each value able to run out (fix131).
  images: [], options: [], combos: [], is_displayed: false,
}

const MAX_IMAGES = 3

export default function ProductsPage() {
  const { COMPANY_ID } = useApp()

  const [products,    setProducts]    = useState([])
  const [categories,  setCategories]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [filter,      setFilter]      = useState('active')   // 'active' | 'inactive' | 'all'
  const [modal,       setModal]       = useState(null)        // null | 'add' | product row
  const [form,        setForm]        = useState(EMPTY_FORM)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [toggling,    setToggling]    = useState(null)
  // Save progress popup: { state: 'busy'|'done'|'error', text }. Keeps the user
  // informed (and off the button) while the code is generated and checked.
  const [progress,    setProgress]    = useState(null)
  const [codeBusy,    setCodeBusy]    = useState(false)
  // Inline "create new category" inside the product form.
  const [addingCat,   setAddingCat]   = useState(false)
  const [newCatName,  setNewCatName]  = useState('')
  const [catBusy,     setCatBusy]     = useState(false)

  /* ── data ─────────────────────────────────────────────────── */

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('products')
      .select('*, category:product_categories(id, name)')
      .order('name')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setProducts(data ?? [])
    setLoading(false)
  }, [COMPANY_ID])

  const fetchCategories = useCallback(async () => {
    let q = supabase.from('product_categories').select('id, name').eq('is_active', true).order('name')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setCategories(data ?? [])
  }, [COMPANY_ID])

  useEffect(() => { fetchProducts(); fetchCategories() }, [fetchProducts, fetchCategories])

  /* ── filtering ─────────────────────────────────────────────── */

  const visible = products.filter(p => {
    const matchSearch =
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.code?.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all' ? true :
      filter === 'active' ? p.is_active :
      !p.is_active
    return matchSearch && matchFilter
  })

  /* ── handlers ──────────────────────────────────────────────── */

  function fld(key, val) { setForm(f => ({ ...f, [key]: val })); setError('') }

  /* Kind is one choice, so picking one clears the rest. On a NEW item this
     re-issues the code under the right prefix; an existing item keeps the code it
     was created with, since codes are printed on price lists and shown app-wide. */
  function setKind(kind) {
    setForm(f => ({ ...f, ...kindFlags(kind) }))
    setError('')
  }

  /* Issue the next serial code for the form's current kind. */
  const issueCode = useCallback(async (formLike) => {
    setCodeBusy(true)
    try {
      const code = await generateProductCode(productKind(formLike))
      setForm(f => ({ ...f, code }))
    } catch (e) {
      setError(`Could not generate a code: ${e.message}`)
    }
    setCodeBusy(false)
  }, [])

  /* On ADD, keep the code in step with the kind. A code that already carries the
     right prefix is left alone; one auto-issued under a different prefix is
     re-issued; anything the user typed by hand is never overwritten. */
  useEffect(() => {
    if (modal !== 'add') return
    const want = codePrefix(form)
    if (codeMatchesPrefix(form.code, want)) return
    const autoIssued = Object.values(PRODUCT_CODE_PREFIXES).some(p => codeMatchesPrefix(form.code, p))
    if (form.code && !autoIssued) return
    issueCode(form)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, form.is_retail, form.is_returnable, form.is_service, form.is_advertisement])

  function openAdd()    { setForm(EMPTY_FORM); setError(''); setProgress(null); setModal('add'); setAddingCat(false); setNewCatName('') }
  function openEdit(p)  {
    setForm({
      ...EMPTY_FORM, ...p,
      category_id: p.category_id ?? '',
      // Tolerate rows saved before fix116 (single image_url, no variants).
      images: Array.isArray(p.images) && p.images.length ? p.images.filter(Boolean).slice(0, MAX_IMAGES)
            : (p.image_url ? [p.image_url] : []),
      // Reads the new columns, and pre-fix131 colour/size rows just the same.
      options: itemOptions(p),
      combos:  Array.isArray(p.combos) ? p.combos : [],
    })
    setError(''); setProgress(null); setModal(p); setAddingCat(false); setNewCatName(''); setSizeInput('')
  }
  function closeModal() { setModal(null); setForm(EMPTY_FORM); setError(''); setProgress(null); setAddingCat(false); setNewCatName('') }

  /* Photos, colours and sizes — the same rules as the supplier's shop items, so
     a product presents identically wherever it is sold. */

  function onPickImage(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (files.length === 0) return
    const room = MAX_IMAGES - form.images.length
    if (room <= 0) { setError(`Up to ${MAX_IMAGES} photos per product.`); return }
    const chosen = files.slice(0, room)
    if (files.length > room) setError(`Only ${room} more photo${room === 1 ? '' : 's'} could be added (max ${MAX_IMAGES}).`)
    else setError('')
    for (const file of chosen) {
      if (!file.type.startsWith('image/')) { setError('Please choose image files only.'); continue }
      if (file.size > 750 * 1024)          { setError('Each image must be under 750 KB.'); continue }
      const reader = new FileReader()
      reader.onload = () => setForm(f => (
        f.images.length >= MAX_IMAGES ? f : { ...f, images: [...f.images, String(reader.result || '')] }))
      reader.readAsDataURL(file)
    }
  }
  const removeImage = i => setForm(f => ({ ...f, images: f.images.filter((_, idx) => idx !== i) }))
  // The first photo is the cover shown on the customer app's card.
  const makeCover = i => setForm(f => (i === 0 ? f : { ...f, images: [f.images[i], ...f.images.filter((_, idx) => idx !== i)] }))

  /* Create a new product category inline and select it for this product. */
  async function createCategory() {
    const name = newCatName.trim()
    if (!name) return
    setCatBusy(true)
    const { data, error: e } = await supabase
      .from('product_categories')
      .insert([{ name, is_active: true, ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}) }])
      .select('id, name')
      .single()
    setCatBusy(false)
    if (e) { setError(e.message); return }
    setCategories(cs => [...cs, data].sort((a, b) => a.name.localeCompare(b.name)))
    fld('category_id', data.id)
    setAddingCat(false); setNewCatName('')
  }

  async function handleSave() {
    if (saving) return                                   // guard against double-clicks
    if (!form.name.trim()) return setError('Product name is required.')

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
    const optionLabels = cleanOptions.map(g => g.label.toLowerCase())
    const dupeLabel = optionLabels.find((l, i) => optionLabels.indexOf(l) !== i)
    if (dupeLabel) return setError(`Two options are both called “${dupeLabel}”. Give each one its own name.`)

    const mirror = legacyMirror(cleanOptions)

    /* Combinations naming an option or value that no longer exists are dropped:
       a rule about a size the catalog has deleted would sit in the row forever,
       invisible and occasionally wrong. */
    const byLabel = new Map(choiceGroups(cleanOptions).map(g => [g.label, new Set(g.values.map(v => v.name))]))
    const cleanCombos = (form.combos || []).filter(c =>
      c?.picks && Object.keys(c.picks).length > 0
      && Object.entries(c.picks).every(([label, v]) => byLabel.get(label)?.has(v)))
    const kind = productKind(form)
    setSaving(true)
    setError('')
    setProgress({ state: 'busy', text: 'Checking code…' })

    const stocked = isStockedKind(kind)   // only Retail + Returnable carry stock
    const payload = {
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      name:             form.name.trim(),
      description:      form.description?.trim()  || null,
      barcode:          form.barcode?.trim()       || null,
      unit_of_measure:  form.unit_of_measure       || 'pcs',
      unit_cost:        Number(form.unit_cost)     || 0,
      unit_price:       Number(form.unit_price)    || 0,
      currency:         form.currency              || 'USD',
      // Services and adverts aren't stocked, so reorder thresholds are meaningless.
      reorder_level:    stocked ? (Number(form.reorder_level) || 0)    : 0,
      reorder_quantity: stocked ? (Number(form.reorder_quantity) || 0) : 0,
      // Kind is a single choice — write all four flags from it so an edited row
      // can never keep a stale second kind.
      ...kindFlags(kind),
      category_id:      form.category_id           || null,
      images:           form.images,
      // Cover mirrored into the original single-image column.
      image_url:        form.images[0] || null,
      options:          cleanOptions,
      combos:           cleanCombos,
      // Mirrored into the old two columns so anything still reading them — and
      // an install without fix131 — keeps seeing the choices on offer.
      colors:           mirror.colors,
      sizes:            mirror.sizes,
      // Whether customers see it in the 3asari3 shop (fix115).
      is_displayed:     !!form.is_displayed,
    }

    let err = null
    if (modal === 'add') {
      // Code is issued + collision-checked here; a clash regenerates and retries.
      const res = await insertProductWithUniqueCode(
        { ...payload, code: form.code?.trim().toUpperCase() || null },
        kind,
        { onProgress: text => setProgress({ state: 'busy', text }) },
      )
      err = res.error
      if (!err && res.data?.code) setProgress({ state: 'done', text: `Saved as ${res.data.code}` })
    } else {
      setProgress({ state: 'busy', text: `Saving ${modal.code}…` })
      const res = await supabase.from('products').update(payload).eq('id', modal.id)
      err = res.error
      if (!err) setProgress({ state: 'done', text: `Saved ${modal.code}` })
    }

    /* fix131 may not have been run yet. PostgREST reports the missing column by
       name; drop it and save the rest rather than blocking the catalog — the
       product keeps its colours and sizes through the legacy columns. */
    for (const col of ['options', 'combos']) {
      if (!err || !new RegExp(`(could not find|column).*['"\`]?${col}['"\`]?`, 'i').test(err.message || '')) continue
      delete payload[col]
      const retry = modal === 'add'
        ? await insertProductWithUniqueCode(
            { ...payload, code: form.code?.trim().toUpperCase() || null }, kind,
            { onProgress: text => setProgress({ state: 'busy', text }) })
        : await supabase.from('products').update(payload).eq('id', modal.id)
      err = retry.error
      if (!err) setError('Product saved, but its options could not be stored — run supabase-fix131.sql.')
    }

    if (err) {
      const hint = /duplicate key|unique/i.test(err.message || '')
        ? 'That code is already taken — try saving again to get the next free one.'
        : (err.message || 'Unknown error')
      setError(hint)
      setProgress({ state: 'error', text: hint })
      setSaving(false)
      return
    }

    await fetchProducts()
    setSaving(false)
    // Let the "Saved as PRD-0009" tick land before the modal closes.
    setTimeout(() => { setProgress(null); closeModal() }, 900)
  }

  async function toggleActive(p) {
    setToggling(p.id)
    await supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id)
    await fetchProducts()
    setToggling(null)
  }

  /* ── render ─────────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Tag className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mt-0.5">{products.length} total</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, code or barcode…"
            className="input pl-9"
          />
        </div>

        <div className="flex items-center gap-1">
          {['active', 'inactive', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
              }`}>
              {f}
            </button>
          ))}
        </div>

        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> Add Product
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Product', 'Category', 'Unit', 'Cost', 'Price', 'Flags', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No products found</td></tr>
            ) : visible.map(p => (
              <tr key={p.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${!p.is_active ? 'opacity-50' : ''}`}>

                {/* Product */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-hover border border-surface-border flex items-center justify-center flex-shrink-0">
                      <Package className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-slate-100 font-medium">{p.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono text-brand-400">{p.code}</span>
                        {p.barcode && <span className="text-xs text-slate-500 flex items-center gap-1"><Barcode className="w-3 h-3" />{p.barcode}</span>}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Category */}
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {p.category?.name ?? <span className="text-slate-600">—</span>}
                </td>

                {/* Unit */}
                <td className="px-4 py-3 text-slate-400 text-xs">{p.unit_of_measure}</td>

                {/* Cost */}
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {p.unit_cost > 0 ? `${p.currency} ${Number(p.unit_cost).toFixed(2)}` : <span className="text-slate-600">—</span>}
                </td>

                {/* Price */}
                <td className="px-4 py-3 text-slate-100 text-xs font-medium">
                  {p.unit_price > 0 ? `${p.currency} ${Number(p.unit_price).toFixed(2)}` : <span className="text-slate-600">—</span>}
                </td>

                {/* Flags */}
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {(() => {
                      const k = PRODUCT_KINDS.find(x => x.value === productKind(p)) || PRODUCT_KINDS[0]
                      const cls = k.color === 'amber' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : k.color === 'cyan'          ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                        :                               'bg-purple-500/10 text-purple-400 border-purple-500/20'
                      return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>{k.label}</span>
                    })()}
                  </div>
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    p.is_active
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                  }`}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(p)} className="btn-ghost p-1.5 text-slate-500" title="Edit">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleActive(p)}
                      disabled={toggling === p.id}
                      className={`btn-ghost p-1.5 ${p.is_active
                        ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'
                        : 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'}`}
                      title={p.is_active ? 'Deactivate' : 'Activate'}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg p-6 space-y-4 overflow-y-auto max-h-[90vh]">

            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">
                {modal === 'add' ? 'Add Product' : 'Edit Product'}
              </h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3">
              {/* Code + Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-fuchsia-300">Code *</label>
                  <div className="relative">
                    <input className="input font-mono uppercase pr-16 disabled:opacity-70" value={form.code}
                      disabled readOnly
                      placeholder={codeBusy ? 'Generating…' : `${codePrefix(form)}-0000`} />
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {codeBusy && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />}
                      {modal === 'add' && !codeBusy && (
                        <button type="button" onClick={() => issueCode(form)} title="Get the next free code"
                          className="p-1 rounded text-slate-500 hover:text-slate-200">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {modal === 'add'
                      ? 'Issued automatically and checked for duplicates when you save.'
                      : 'Codes are fixed once created.'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label">Category</label>
                    {!addingCat && (
                      <button type="button" onClick={() => { setAddingCat(true); setNewCatName('') }}
                        className="text-[11px] text-brand-400 hover:text-brand-300 mb-1">
                        <Plus className="w-3 h-3 inline -mt-0.5" /> New
                      </button>
                    )}
                  </div>
                  {addingCat ? (
                    <div className="flex items-center gap-1.5">
                      <input autoFocus className="input" value={newCatName}
                        onChange={e => setNewCatName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createCategory() } }}
                        placeholder="New category name" />
                      <button type="button" onClick={createCategory} disabled={catBusy || !newCatName.trim()}
                        className="btn-primary px-2 py-2 disabled:opacity-50" title="Create category">
                        <Check className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => { setAddingCat(false); setNewCatName('') }}
                        className="btn-ghost p-2 text-slate-500" title="Cancel">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <select className="input" value={form.category_id} onChange={e => fld('category_id', e.target.value)}>
                      <option value="">— None —</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="label text-fuchsia-300">Product Name *</label>
                <input className="input" value={form.name}
                  onChange={e => fld('name', e.target.value)} placeholder="Product name" />
              </div>

              <div>
                <label className="label">Description</label>
                <textarea className="input resize-none" rows={2} value={form.description}
                  onChange={e => fld('description', e.target.value)} placeholder="Optional description…" />
              </div>

              <div>
                <label className="label">Barcode</label>
                <input className="input font-mono" value={form.barcode}
                  onChange={e => fld('barcode', e.target.value)} placeholder="1234567890123" />
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Unit</label>
                  <select className="input" value={form.unit_of_measure} onChange={e => fld('unit_of_measure', e.target.value)}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Currency</label>
                  <select className="input" value={form.currency} onChange={e => fld('currency', e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="LBP">LBP</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div /> {/* spacer */}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label flex items-center gap-1"><DollarSign className="w-3 h-3" />Cost Price</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.unit_cost}
                    onChange={e => fld('unit_cost', e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="label flex items-center gap-1"><DollarSign className="w-3 h-3" />Selling Price</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.unit_price}
                    onChange={e => fld('unit_price', e.target.value)} placeholder="0.00" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Reorder Level</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.reorder_level}
                    onChange={e => fld('reorder_level', e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="label">Reorder Qty</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.reorder_quantity}
                    onChange={e => fld('reorder_quantity', e.target.value)} placeholder="0" />
                </div>
              </div>

              {/* Photos — the first is the cover shown in the customer app */}
              <div>
                <label className="label">Photos</label>
                <div className="flex items-start gap-3 flex-wrap">
                  {form.images.map((src, i) => (
                    <div key={i} className="relative w-20 h-20 flex-shrink-0">
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
                  Up to {MAX_IMAGES} photos, max 750 KB each. The first one is the cover shown in the customer app.
                </p>
              </div>

              {/* Options, sold-out values and the combinations grid — the same
                  editor the supplier's My Shop uses, so a 3asari3 product and a
                  partner's product offer the customer exactly the same things. */}
              <ItemOptionsEditor
                options={form.options}
                combos={form.combos}
                currency={form.currency}
                onChange={({ options, combos }) => setForm(f => ({ ...f, options, combos }))}
                onError={setError}
              />

              {/* Customer-app visibility */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-emerald-500 mt-0.5" checked={!!form.is_displayed}
                  onChange={e => fld('is_displayed', e.target.checked)} />
                <span className="text-sm text-slate-200">
                  Show this item in the customer app
                  <span className="block text-[11px] text-slate-500">
                    Lists it in the customer app’s 3asari3 shop. Off keeps it internal.
                  </span>
                </span>
              </label>

              {/* Kind — one choice only; it drives the code prefix. */}
              <div>
                <label className="label">Kind</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRODUCT_KINDS.map(k => (
                    <FlagToggle key={k.value} active={productKind(form) === k.value}
                      onClick={() => setKind(k.value)} color={k.color}>
                      {k.label}
                    </FlagToggle>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  An item is one kind only — it sets the code prefix ({PRODUCT_CODE_PREFIXES[productKind(form)]}-0000).
                </p>
                {!isStockedKind(productKind(form)) && (
                  <p className="text-[10px] text-cyan-300/80 mt-1 flex items-center gap-1">
                    <Wrench className="w-3 h-3 flex-shrink-0" />
                    {form.is_service
                      ? 'A service isn’t stored — it never carries stock.'
                      : 'An advert isn’t goods — it never carries stock.'}
                  </p>
                )}
                {form.is_retail && (
                  <p className="text-[10px] text-purple-300/80 mt-1">Stock moves in when purchased and out when sold.</p>
                )}
                {form.is_returnable && (
                  <p className="text-[10px] text-amber-300/80 mt-1">Stock moves out when issued and back in when returned. Tracked in the Returnable Items page (e.g. shisha, gas cylinders).</p>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Save progress — tells the user what's happening so they don't
                keep clicking. Clears itself on success; on failure it stays put
                with the reason. */}
            {progress && (
              <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${
                progress.state === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : progress.state === 'done' ? 'bg-green-500/10 border-green-500/30 text-green-300'
                : 'bg-surface-hover border-surface-border text-slate-300'}`}>
                {progress.state === 'busy'  && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
                {progress.state === 'done'  && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                {progress.state === 'error' && <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                <span>{progress.text}</span>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={closeModal} disabled={saving}>Cancel</button>
              <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleSave}
                disabled={saving || codeBusy || !form.name.trim()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {saving ? 'Saving…' : modal === 'add' ? 'Add Product' : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
