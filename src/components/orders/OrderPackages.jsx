import React from 'react'
import { Plus, Trash2, Package, Check, Circle } from 'lucide-react'

const CATEGORIES = [
  { value: 'food',                label: 'Food' },
  { value: 'grocery',             label: 'Grocery' },
  { value: 'supermarket_retail',  label: 'Supermarket / Retail' },
  { value: 'electronics',         label: 'Electronics' },
  { value: 'documents',           label: 'Documents' },
  { value: 'clothing',            label: 'Clothing' },
  { value: 'other',               label: 'Other' },
]
const CURRENCIES   = ['USD', 'LBP', 'EUR']
const TYPES        = ['parcel', 'box', 'envelope', 'pallet', 'bag', 'crate']
const SIZES        = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'extra_large', label: 'Extra Large' },
]
const HANDLINGS    = ['regular', 'fragile']
const VEHICLES     = [
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'car',        label: 'Car' },
  { value: 'van',        label: 'Van' },
  { value: 'cargo',      label: 'Cargo Truck' },
]
const PAYMENT_TYPES = [
  { value: 'cash',          label: 'Cash' },
  { value: 'card',          label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'other',         label: 'Other' },
]

export const EMPTY_PACKAGE = {
  tracking_number: '', provider_id: '', category: 'other', type: 'bag', package_size: 'small',
  handling: 'regular', vehicle_type: '', quantity: 1, weight_kg: '',
  description: '',
  base_price: '', package_price: '', currency: 'USD', paid: false, payment_type: '',
}

/* Display name for a provider contact: company name first, else person name. */
function providerName(c) {
  return (c.company_name?.trim())
    || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
    || '—'
}

/**
 * Delivery packages sub-form. The parent owns the array and persists it on save.
 *
 * Props:
 *   packages    - array of package objects
 *   setPackages - state setter (value or updater fn)
 *   onAdd       - optional parent-owned "Add Package" handler (used when the
 *                 Add button lives in the collapsible section header)
 */
export default function OrderPackages({ packages, setPackages, providers = [], customerName = '', embedded = false, onAdd }) {
  const trackingRefs = React.useRef({})        // rowKey -> tracking <input>
  const prevLen      = React.useRef(packages.length)

  // Focus the tracking field of the last package whenever the list grows,
  // regardless of whether it was added here or from the section header.
  React.useEffect(() => {
    if (packages.length > prevLen.current) {
      const last = packages[packages.length - 1]
      const rk = last?._id ?? last?._key
      if (rk != null) trackingRefs.current[rk]?.focus()
    }
    prevLen.current = packages.length
  }, [packages])

  const add = onAdd || (() => setPackages(p => [...p, { ...EMPTY_PACKAGE, _key: Date.now() }]))
  function remove(i)    { setPackages(p => p.filter((_, idx) => idx !== i)) }
  function update(i, k, v) {
    setPackages(p => { const n = [...p]; n[i] = { ...n[i], [k]: v }; return n })
  }

  // From the tracking number, Enter or Tab jumps straight to Description,
  // skipping the pre-filled category/type/size/handling fields.
  function trackingKeyDown(e) {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      const desc = e.currentTarget.closest('[data-package-row]')?.querySelector('[data-package-desc]')
      if (desc) { e.preventDefault(); desc.focus() }
    }
  }

  return (
    <div className="space-y-3">
      {/* When embedded the title + Add button live in the collapsible section header. */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <SectionLabel><Package className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />Delivery Packages</SectionLabel>
          <button type="button" onClick={add} className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
            <Plus className="w-3 h-3" /> Add Package
          </button>
        </div>
      )}

      {packages.length === 0 ? (
        <p className="text-xs text-slate-600 border border-dashed border-surface-border rounded-lg px-3 py-4 text-center">
          No packages yet — click "Add Package".
        </p>
      ) : packages.map((p, i) => {
        const provider = providers.find(pr => pr.id === p.provider_id)
        const paidToName = provider ? providerName(provider) : 'provider'
        return (
        <div key={p._id ?? p._key ?? i} data-package-row className="border border-surface-border rounded-lg p-3 space-y-2 bg-surface-hover/30">
          <div>
            <label className="label text-fuchsia-300">Package provider *</label>
            <select required className="input py-1.5 text-xs" value={p.provider_id || ''}
              onChange={e => update(i, 'provider_id', e.target.value)}>
              <option value="">— Select provider —</option>
              {providers.map(pr => <option key={pr.id} value={pr.id}>{providerName(pr)}</option>)}
            </select>
          </div>

          <div>
            <label className="label text-fuchsia-300">Package reference *</label>
            <div className="flex items-center gap-2">
              <input required className="input flex-1" placeholder="Package reference"
                ref={el => {
                  const rk = p._id ?? p._key ?? i
                  if (el) trackingRefs.current[rk] = el; else delete trackingRefs.current[rk]
                }}
                onKeyDown={trackingKeyDown}
                value={p.tracking_number} onChange={e => update(i, 'tracking_number', e.target.value)} />
              <button type="button" onClick={() => remove(i)} title="Remove package"
                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <OptionButtons label="Category" options={CATEGORIES} value={p.category}     onChange={v => update(i, 'category', v)} />
            <OptionButtons label="Type"     options={TYPES}      value={p.type}         onChange={v => update(i, 'type', v)} />
            <OptionButtons label="Size"     options={SIZES}      value={p.package_size} onChange={v => update(i, 'package_size', v)} />
            <OptionButtons label="Handling" options={HANDLINGS}  value={p.handling}     onChange={v => update(i, 'handling', v)} clearable={false} />
            <div className="w-28">
              <label className="label">Weight (kg)</label>
              <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={p.weight_kg}
                onChange={e => update(i, 'weight_kg', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="label">Qty</label>
              <input type="number" min="1" step="1" className="input py-1.5 text-xs" value={p.quantity}
                onChange={e => update(i, 'quantity', e.target.value)} />
            </div>
            <div className="col-span-3">
              <label className="label">Description</label>
              <input data-package-desc className="input py-1.5 text-xs" value={p.description}
                onChange={e => update(i, 'description', e.target.value)} placeholder="Package contents / notes" />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Package Price</label>
              <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={p.package_price}
                onChange={e => update(i, 'package_price', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input py-1.5 text-xs" value={p.currency || 'USD'}
                onChange={e => update(i, 'currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Payment — paid toggle, then payment type */}
          <div className="flex items-end gap-2 flex-wrap">
            <button type="button" onClick={() => update(i, 'paid', !p.paid)}
              aria-pressed={!!p.paid}
              className={`inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors select-none
                ${p.paid
                  ? 'bg-green-500/15 border-green-500/40 text-green-300'
                  : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'
                }`}>
              {p.paid ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 flex-shrink-0" />}
              Paid directly to {paidToName}
            </button>
            <div className="flex-1 min-w-[140px]">
              <label className="label">Payment Type</label>
              <select className="input py-1.5 text-xs" value={p.payment_type} onChange={e => update(i, 'payment_type', e.target.value)}>
                <option value="">—</option>
                {PAYMENT_TYPES.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
              </select>
            </div>
          </div>
        </div>
        )
      })}
    </div>
  )
}

function SectionLabel({ children }) {
  return <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">{children}</p>
}

/**
 * Quick-tap selector: one button per option instead of a dropdown, so a busy
 * user can pick a value in a single click. Accepts string options or
 * { value, label } objects. tabIndex=-1 keeps these out of the typing flow.
 */
function OptionButtons({ label, options, value, onChange, clearable = true }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-1">
        {options.map(o => {
          const val = typeof o === 'string' ? o : o.value
          const lbl = typeof o === 'string' ? o : o.label
          const active = value === val
          return (
            <button key={val} type="button" tabIndex={-1}
              onClick={() => onChange(clearable && active ? '' : val)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border capitalize transition-colors select-none
                ${active
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-surface-hover text-slate-400 border-surface-border hover:text-slate-100 hover:border-brand-600/50'
                }`}>
              {lbl}
            </button>
          )
        })}
      </div>
    </div>
  )
}
