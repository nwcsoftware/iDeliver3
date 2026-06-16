import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Search, Edit2, Power, X, Check, AlertCircle,
  Tag, DollarSign, Package, Barcode, Circle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

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
  is_deliverable: true, is_retail: true, is_returnable: false,
  category_id: '',
}

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

  function openAdd()    { setForm(EMPTY_FORM); setError(''); setModal('add'); setAddingCat(false); setNewCatName('') }
  function openEdit(p)  { setForm({ ...EMPTY_FORM, ...p, category_id: p.category_id ?? '' }); setError(''); setModal(p); setAddingCat(false); setNewCatName('') }
  function closeModal() { setModal(null); setForm(EMPTY_FORM); setError(''); setAddingCat(false); setNewCatName('') }

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
    if (!form.code.trim()) return setError('Product code is required.')
    if (!form.name.trim()) return setError('Product name is required.')
    setSaving(true)
    setError('')

    const payload = {
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      code:             form.code.trim().toUpperCase(),
      name:             form.name.trim(),
      description:      form.description?.trim()  || null,
      barcode:          form.barcode?.trim()       || null,
      unit_of_measure:  form.unit_of_measure       || 'pcs',
      unit_cost:        Number(form.unit_cost)     || 0,
      unit_price:       Number(form.unit_price)    || 0,
      currency:         form.currency              || 'USD',
      reorder_level:    Number(form.reorder_level) || 0,
      reorder_quantity: Number(form.reorder_quantity) || 0,
      is_deliverable:   form.is_deliverable,
      is_retail:        form.is_retail,
      is_returnable:    form.is_returnable,
      category_id:      form.category_id           || null,
    }

    const { error: err } = modal === 'add'
      ? await supabase.from('products').insert([payload])
      : await supabase.from('products').update(payload).eq('id', modal.id)

    if (err) {
      setError(err.message.includes('unique') ? 'Product code already exists.' : err.message)
    } else {
      await fetchProducts()
      closeModal()
    }
    setSaving(false)
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
            <h1 className="text-base font-semibold text-slate-100 leading-none">Products</h1>
            <p className="text-xs text-slate-500 mt-0.5">{products.length} total</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search by name, code or barcode…"
            value={search} onChange={e => setSearch(e.target.value)} />
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
                    {p.is_retail     && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">Retail</span>}
                    {p.is_deliverable && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Delivery</span>}
                    {p.is_returnable && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Returnable</span>}
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
                  <input className="input font-mono uppercase" value={form.code}
                    onChange={e => fld('code', e.target.value)} placeholder="PRD-001" />
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

              {/* Flags — toggle buttons */}
              <div>
                <label className="label">Flags</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <FlagToggle active={form.is_retail}      onClick={() => fld('is_retail', !form.is_retail)}           color="purple">Retail item</FlagToggle>
                  <FlagToggle active={form.is_deliverable} onClick={() => fld('is_deliverable', !form.is_deliverable)} color="cyan">Deliverable</FlagToggle>
                  <FlagToggle active={form.is_returnable}  onClick={() => fld('is_returnable', !form.is_returnable)}    color="amber">Returnable</FlagToggle>
                </div>
                {form.is_returnable && (
                  <p className="text-[10px] text-amber-300/80 mt-1">Tracked in the Returnable Items page (e.g. shisha, gas cylinders).</p>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}
                disabled={saving || !form.code.trim() || !form.name.trim()}>
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : modal === 'add' ? 'Add Product' : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
