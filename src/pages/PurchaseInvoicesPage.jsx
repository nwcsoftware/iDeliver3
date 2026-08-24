import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Edit2,
  Power,
  X,
  Check,
  AlertCircle,
  Trash2,
  FileText,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import SearchField from '../components/ui/SearchField'

const STATUSES = ['pending', 'confirmed', 'cancelled']

const STATUS_STYLE = {
  pending:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  confirmed: 'bg-green-500/10  text-green-400  border-green-500/20',
  cancelled: 'bg-red-500/10    text-red-400    border-red-500/20',
}

const EMPTY_INVOICE = {
  invoice_number: '', invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '', currency: 'USD', supplier_id: '', branch_id: '',
  paid_amount: '', status: 'pending', notes: '',
}

const EMPTY_ITEM = { product_id: '', quantity: 1, unit_cost: 0, discount_rate: 0, vat_rate: 0 }

/* ── calculation helpers ─────────────────────────────────── */

function calcLine(it) {
  const base     = (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0)
  const discount = base * (Number(it.discount_rate) || 0) / 100
  const net      = base - discount
  const vat      = net  * (Number(it.vat_rate)      || 0) / 100
  return { base, discount, net, vat, total: net + vat }
}

function calcTotals(items) {
  return items.reduce((acc, it) => {
    const c = calcLine(it)
    return {
      subtotal:        acc.subtotal        + c.base,
      discount_amount: acc.discount_amount + c.discount,
      vat_amount:      acc.vat_amount      + c.vat,
      total_amount:    acc.total_amount    + c.total,
    }
  }, { subtotal: 0, discount_amount: 0, vat_amount: 0, total_amount: 0 })
}

/* ── page ─────────────────────────────────────────────────── */

export default function PurchaseInvoicesPage() {
  const { COMPANY_ID } = useApp()

  const [invoices,  setInvoices]  = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [branches,  setBranches]  = useState([])
  const [products,  setProducts]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [modal,     setModal]     = useState(null)   // null | 'add' | invoice row
  const [form,      setForm]      = useState(EMPTY_INVOICE)
  const [items,     setItems]     = useState([])
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [toggling,  setToggling]  = useState(null)

  /* ── fetch ───────────────────────────────────────────────── */

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('purchase_invoices')
      .select('*, supplier:contacts!supplier_id(id,first_name,last_name), branch:branches(id,name)')
      .order('invoice_date', { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setInvoices(data ?? [])
    setLoading(false)
  }, [COMPANY_ID])

  const fetchLookups = useCallback(async () => {
    const [{ data: sups }, { data: brs }, { data: prods }] = await Promise.all([
      supabase.from('contacts').select('id,first_name,last_name').eq('contact_type', 'supplier'),
      supabase.from('branches').select('id,name').eq('is_active', true),
      supabase.from('products').select('id,name,code,unit_cost').eq('is_active', true),
    ])
    setSuppliers(sups ?? [])
    setBranches(brs  ?? [])
    setProducts(prods ?? [])
  }, [])

  useEffect(() => { fetchInvoices(); fetchLookups() }, [fetchInvoices, fetchLookups])

  /* ── filter ──────────────────────────────────────────────── */

  const visible = invoices.filter(inv => {
    const sup = `${inv.supplier?.first_name ?? ''} ${inv.supplier?.last_name ?? ''}`.toLowerCase()
    const matchSearch = inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) || sup.includes(search.toLowerCase())
    const matchFilter = filter === 'all' || inv.status === filter
    return matchSearch && matchFilter
  })

  /* ── form helpers ────────────────────────────────────────── */

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })); setError('') }

  function openAdd() {
    setForm(EMPTY_INVOICE); setItems([]); setError(''); setModal('add')
  }

  async function openEdit(inv) {
    setForm({ ...EMPTY_INVOICE, ...inv, paid_amount: inv.paid_amount ?? '' })
    const { data } = await supabase
      .from('purchase_invoice_items')
      .select('*, product:products(id,name,code)')
      .eq('purchase_invoice_id', inv.id)
    setItems((data ?? []).map(it => ({
      _id: it.id,
      product_id:    it.product_id,
      quantity:      it.quantity,
      unit_cost:     it.unit_cost,
      discount_rate: it.discount_rate ?? 0,
      vat_rate:      it.vat_rate ?? 0,
    })))
    setError(''); setModal(inv)
  }

  function closeModal() { setModal(null); setForm(EMPTY_INVOICE); setItems([]); setError('') }

  /* ── items helpers ───────────────────────────────────────── */

  function addItem() { setItems(p => [...p, { ...EMPTY_ITEM, _key: Date.now() }]) }

  function removeItem(i) { setItems(p => p.filter((_, idx) => idx !== i)) }

  function setItem(i, k, v) {
    setItems(p => {
      const next = [...p]
      next[i] = { ...next[i], [k]: v }
      if (k === 'product_id') {
        const prod = products.find(x => x.id === v)
        if (prod) next[i].unit_cost = prod.unit_cost ?? 0
      }
      return next
    })
  }

  /* ── save ────────────────────────────────────────────────── */

  async function handleSave() {
    if (!form.supplier_id)            return setError('Supplier is required.')
    if (!form.invoice_number?.trim()) return setError('Invoice number is required.')
    if (!form.invoice_date)           return setError('Invoice date is required.')
    if (items.length === 0)           return setError('Add at least one item.')
    if (items.some(it => !it.product_id)) return setError('Every item must have a product selected.')

    setSaving(true); setError('')
    const t = calcTotals(items)

    const head = {
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      supplier_id:     form.supplier_id,
      branch_id:       form.branch_id   || null,
      invoice_number:  form.invoice_number.trim(),
      invoice_date:    form.invoice_date,
      due_date:        form.due_date    || null,
      currency:        form.currency,
      subtotal:        t.subtotal,
      vat_amount:      t.vat_amount,
      discount_amount: t.discount_amount,
      total_amount:    t.total_amount,
      paid_amount:     Number(form.paid_amount) || 0,
      status:          form.status,
      notes:           form.notes?.trim() || null,
    }

    let invoiceId
    if (modal === 'add') {
      const { data, error: e } = await supabase.from('purchase_invoices').insert([head]).select('id').single()
      if (e) { setError(e.message); setSaving(false); return }
      invoiceId = data.id
    } else {
      const { error: e } = await supabase.from('purchase_invoices').update(head).eq('id', modal.id)
      if (e) { setError(e.message); setSaving(false); return }
      invoiceId = modal.id
      await supabase.from('purchase_invoice_items').delete().eq('purchase_invoice_id', invoiceId)
    }

    const rows = items.map(it => ({
      purchase_invoice_id: invoiceId,
      product_id:          it.product_id,
      quantity:            Number(it.quantity),
      unit_cost:           Number(it.unit_cost),
      discount_rate:       Number(it.discount_rate) || 0,
      vat_rate:            Number(it.vat_rate)      || 0,
      line_total:          calcLine(it).total,
    }))

    const { error: ie } = await supabase.from('purchase_invoice_items').insert(rows)
    if (ie) { setError(ie.message); setSaving(false); return }

    await fetchInvoices(); closeModal(); setSaving(false)
  }

  async function toggleStatus(inv) {
    setToggling(inv.id)
    const next = inv.status === 'cancelled' ? 'pending' : 'cancelled'
    await supabase.from('purchase_invoices').update({ status: next }).eq('id', inv.id)
    await fetchInvoices()
    setToggling(null)
  }

  const totals = calcTotals(items)

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mt-0.5">{invoices.length} total</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search invoice # or supplier…"
            className="input pl-9"
          />
        </div>

        <div className="flex items-center gap-1">
          {['all', ...STATUSES].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
              }`}>{f}</button>
          ))}
        </div>

        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Invoice #', 'Supplier', 'Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No invoices found</td></tr>
            ) : visible.map(inv => {
              const bal = Number(inv.total_amount) - Number(inv.paid_amount)
              return (
                <tr key={inv.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${inv.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-brand-400 bg-brand-600/10 border border-brand-600/20 px-2 py-0.5 rounded">
                      {inv.invoice_number}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-200 text-xs">
                    {inv.supplier ? `${inv.supplier.first_name} ${inv.supplier.last_name}` : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{inv.invoice_date}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{inv.due_date ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-3 text-slate-100 text-xs font-medium">{inv.currency} {Number(inv.total_amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-green-400 text-xs">{inv.currency} {Number(inv.paid_amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className={bal > 0.005 ? 'text-red-400' : 'text-green-400'}>
                      {inv.currency} {bal.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border capitalize ${STATUS_STYLE[inv.status] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(inv)} className="btn-ghost p-1.5 text-slate-500" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleStatus(inv)}
                        disabled={toggling === inv.id}
                        title={inv.status === 'cancelled' ? 'Reactivate' : 'Cancel invoice'}
                        className={`btn-ghost p-1.5 ${inv.status === 'cancelled'
                          ? 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'
                          : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'}`}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Modal ─────────────────────────────────────────────── */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-5xl flex flex-col" style={{ maxHeight: '92vh' }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-400" />
                {modal === 'add' ? 'New Purchase Invoice' : `Edit — ${modal.invoice_number}`}
              </h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {/* ── Header fields ───────────────────────────────── */}
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Invoice Details</p>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Invoice Number *</label>
                    <input className="input font-mono" value={form.invoice_number}
                      onChange={e => fld('invoice_number', e.target.value)} placeholder="INV-001" />
                  </div>
                  <div>
                    <label className="label">Invoice Date *</label>
                    <input type="date" className="input" value={form.invoice_date}
                      onChange={e => fld('invoice_date', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Due Date</label>
                    <input type="date" className="input" value={form.due_date}
                      onChange={e => fld('due_date', e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className="label">Supplier *</label>
                    <select className="input" value={form.supplier_id} onChange={e => fld('supplier_id', e.target.value)}>
                      <option value="">— Select supplier —</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Branch</label>
                    <select className="input" value={form.branch_id} onChange={e => fld('branch_id', e.target.value)}>
                      <option value="">— None —</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Status</label>
                    <select className="input" value={form.status} onChange={e => fld('status', e.target.value)}>
                      {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Amount Paid</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.paid_amount}
                      onChange={e => fld('paid_amount', e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="label">Notes</label>
                    <input className="input" value={form.notes}
                      onChange={e => fld('notes', e.target.value)} placeholder="Optional…" />
                  </div>
                </div>
              </div>

              {/* ── Items ───────────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Items</p>
                  <button onClick={addItem} className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>

                <div className="border border-surface-border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-[32%]">Product</th>
                        <th className="text-left px-3 py-2 w-[11%]">Qty</th>
                        <th className="text-left px-3 py-2 w-[15%]">Unit Cost</th>
                        <th className="text-left px-3 py-2 w-[11%]">Disc %</th>
                        <th className="text-left px-3 py-2 w-[11%]">VAT %</th>
                        <th className="text-right px-3 py-2 w-[16%]">Line Total</th>
                        <th className="w-[4%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-slate-600">
                            No items — click "Add Item" above
                          </td>
                        </tr>
                      ) : items.map((it, idx) => {
                        const c = calcLine(it)
                        return (
                          <tr key={it._id ?? it._key ?? idx} className="border-t border-surface-border/50">
                            <td className="px-3 py-2">
                              <select className="input py-1.5 text-xs" value={it.product_id}
                                onChange={e => setItem(idx, 'product_id', e.target.value)}>
                                <option value="">— Select —</option>
                                {products.map(p => (
                                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" min="0.01" step="0.01" className="input py-1.5 text-xs"
                                value={it.quantity} onChange={e => setItem(idx, 'quantity', e.target.value)} />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" min="0" step="0.01" className="input py-1.5 text-xs"
                                value={it.unit_cost} onChange={e => setItem(idx, 'unit_cost', e.target.value)} />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" min="0" max="100" step="0.01" className="input py-1.5 text-xs"
                                value={it.discount_rate} onChange={e => setItem(idx, 'discount_rate', e.target.value)} />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" min="0" max="100" step="0.01" className="input py-1.5 text-xs"
                                value={it.vat_rate} onChange={e => setItem(idx, 'vat_rate', e.target.value)} />
                            </td>
                            <td className="px-3 py-2 text-right text-slate-100 font-semibold">
                              {c.total.toFixed(2)}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => removeItem(idx)}
                                className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals box */}
                {items.length > 0 && (
                  <div className="flex justify-end">
                    <div className="bg-surface-hover border border-surface-border rounded-xl px-5 py-4 min-w-[260px] space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Subtotal</span>
                        <span className="text-slate-200">{form.currency} {totals.subtotal.toFixed(2)}</span>
                      </div>
                      {totals.discount_amount > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Discount</span>
                          <span className="text-red-400">− {form.currency} {totals.discount_amount.toFixed(2)}</span>
                        </div>
                      )}
                      {totals.vat_amount > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">VAT</span>
                          <span className="text-slate-200">+ {form.currency} {totals.vat_amount.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-bold pt-2 border-t border-surface-border">
                        <span className="text-slate-200">Total</span>
                        <span className="text-slate-100">{form.currency} {totals.total_amount.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-surface-border space-y-3">
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button className="btn-ghost" onClick={closeModal}>Cancel</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                  <Check className="w-4 h-4" />
                  {saving ? 'Saving…' : modal === 'add' ? 'Create Invoice' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
