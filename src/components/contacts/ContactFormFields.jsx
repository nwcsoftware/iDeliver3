import React, { useState } from 'react'
import { Plus, Check, X } from 'lucide-react'
import { formatAccountNumber } from '../../lib/accountNumber'
import MobileInput from '../MobileInput'

/* A <select> whose list can be extended inline. Picking "+ Add new…" reveals a
   text input; the typed value is persisted via onAddOption and then selected. */
function AddableSelect({ value, options, placeholder, addPlaceholder = 'New value', onChange, onAddOption }) {
  const [adding, setAdding] = useState(false)
  const [text,   setText]   = useState('')
  const [busy,   setBusy]   = useState(false)

  async function confirm() {
    const name = text.trim()
    if (!name) return
    setBusy(true)
    const saved = await onAddOption(name)
    setBusy(false)
    if (saved == null) return            // insert failed — keep the input open
    onChange(saved)
    setAdding(false); setText('')
  }

  if (adding) {
    return (
      <div className="flex items-center gap-1.5">
        <input className="input" autoFocus value={text} placeholder={addPlaceholder}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm() } }} />
        <button type="button" onClick={confirm} disabled={busy || !text.trim()}
          className="btn-ghost p-2 text-green-400 disabled:opacity-40" title="Add">
          <Check className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => { setAdding(false); setText('') }}
          className="btn-ghost p-2 text-slate-500" title="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <select className="input" value={value ?? ''}
      onChange={e => { e.target.value === '__add__' ? setAdding(true) : onChange(e.target.value) }}>
      <option value="">{placeholder || '— Select —'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__add__">+ Add new…</option>
    </select>
  )
}

/* Contact types that get a system-generated account number on creation. */
export const ACCOUNT_NUMBER_TYPES = ['customer', 'supplier', 'partner']

/* The roles a contact can hold. A contact can have several at once (tags), e.g.
   someone who is both a Customer and a Partner. Order here drives chip order. */
export const CONTACT_ROLES = [
  { value: 'customer', label: 'Customer', cls: 'bg-cyan-600/20 text-cyan-300 border-cyan-600/40' },
  { value: 'partner',  label: 'Partner',  cls: 'bg-purple-600/20 text-purple-300 border-purple-600/40' },
  { value: 'supplier', label: 'Supplier', cls: 'bg-orange-600/20 text-orange-300 border-orange-600/40' },
]

// User-editable fields. Once any of these has a value, the entity-type toggle
// locks — the user must Cancel and start a new entry to change Individual/Company.
export const ENTRY_FIELDS = [
  'company_name', 'commercial_registration',
  'first_name', 'last_name', 'mobile', 'whatsapp_number',
  'email', 'city', 'address', 'notes',
  'supplier_code', 'payment_terms', 'partner_percentage',
]

/**
 * Shared field layout for creating/editing a contact (customer, supplier,
 * partner). Used both on the Contacts page and in the quick "New Customer"
 * popup inside the New Order form, so the two forms stay exactly identical.
 *
 * Props:
 *   type        - 'customer' | 'supplier' | 'partner'
 *   form        - the values object
 *   setField    - (key, value) => void
 *   mode        - 'add' | 'edit'
 *   extraFields - type-specific extra fields ([] for none)
 *   showRoles   - render the multi-role (Customer/Partner/Supplier) tag selector
 */
export default function ContactFormFields({ type, form, setField, mode, extraFields = [], showRoles = false }) {
  const isCompany    = form.entity_type === 'company'
  // Toggle locks once data entry begins, or whenever editing an existing contact.
  const hasEntryData = ENTRY_FIELDS.some(k => String(form[k] ?? '').trim() !== '')
  const typeLocked   = mode !== 'add' || hasEntryData

  // Roles this contact holds. Falls back to the single primary type so the
  // selector still reflects reality even before contact_types has been set.
  const roles = (Array.isArray(form.contact_types) && form.contact_types.length)
    ? form.contact_types
    : [form.contact_type || type].filter(Boolean)
  // Toggle a role on/off, never letting the list become empty.
  function toggleRole(r) {
    const has = roles.includes(r)
    if (has && roles.length === 1) return            // keep at least one role
    setField('contact_types', has ? roles.filter(x => x !== r) : [...roles, r])
  }

  return (
    <div className="space-y-3">
      {/* Contact code — system-generated, read-only, shown above everything */}
      <div>
        <label className="label">Contact Code</label>
        <input
          className="input font-mono tracking-wider text-slate-300 cursor-not-allowed opacity-90"
          value={form.code ?? ''}
          placeholder={mode === 'add' ? 'Auto-generated on save' : '—'}
          readOnly
        />
      </div>

      {/* Individual / Company — locks once data entry begins */}
      <div>
        <label className="label">Type</label>
        <div className="grid grid-cols-2 gap-2">
          {['individual', 'company'].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => !typeLocked && setField('entity_type', t)}
              disabled={typeLocked && form.entity_type !== t}
              className={`px-3 py-2 rounded-lg text-sm font-medium border capitalize transition-colors
                ${form.entity_type === t
                  ? 'bg-brand-600/20 text-brand-300 border-brand-600/40'
                  : 'text-slate-400 border-surface-border hover:text-slate-100 hover:bg-surface-hover'}
                ${typeLocked && form.entity_type !== t ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
        {typeLocked && mode === 'add' && (
          <p className="text-[11px] text-slate-500 mt-1">
            Type is locked once you start entering data. Cancel to switch to a different type.
          </p>
        )}
      </div>

      {/* Contact roles — a contact can be several at once (e.g. Customer + Partner) */}
      {showRoles && (
        <div>
          <label className="label">Roles</label>
          <div className="flex flex-wrap gap-2">
            {CONTACT_ROLES.map(r => {
              const active = roles.includes(r.value)
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => toggleRole(r.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                    ${active ? r.cls : 'text-slate-400 border-surface-border hover:text-slate-100 hover:bg-surface-hover'}`}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Tap to add or remove roles. A contact can hold several at once and will
            appear on each matching page. At least one role is required.
          </p>
        </div>
      )}

      {/* Account number (customers, suppliers & partners) — system-generated, read-only */}
      {ACCOUNT_NUMBER_TYPES.includes(type) && (
        <div>
          <label className="label">Account Number</label>
          <input
            className="input font-mono tracking-wider text-slate-300 cursor-not-allowed opacity-90"
            value={form.account_number ? formatAccountNumber(form.account_number) : ''}
            placeholder={mode === 'add' ? 'Generating…' : '—'}
            readOnly
          />
        </div>
      )}

      {/* Company details — only when the contact is a company */}
      {isCompany && (
        <>
          <div>
            <label className="label text-fuchsia-300">Company Name *</label>
            <input className="input" value={form.company_name}
              onChange={e => setField('company_name', e.target.value)} placeholder="Acme Trading SARL" />
          </div>
          <div>
            <label className="label">Commercial Registration</label>
            <input className="input" value={form.commercial_registration}
              onChange={e => setField('commercial_registration', e.target.value)} placeholder="Optional — e.g. CR 123456" />
          </div>
        </>
      )}

      {/* Name */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label text-fuchsia-300">{isCompany ? 'Contact First Name *' : 'First Name *'}</label>
          <input className="input" value={form.first_name} onChange={e => setField('first_name', e.target.value)} placeholder="John" />
        </div>
        <div>
          <label className="label text-fuchsia-300">{isCompany ? 'Contact Last Name *' : 'Last Name *'}</label>
          <input className="input" value={form.last_name} onChange={e => setField('last_name', e.target.value)} placeholder="Doe" />
        </div>
      </div>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label text-fuchsia-300">Mobile *</label>
          <MobileInput value={form.mobile} onChange={v => setField('mobile', v)} />
        </div>
        <div>
          <label className="label">WhatsApp</label>
          <MobileInput value={form.whatsapp_number} onChange={v => setField('whatsapp_number', v)} placeholder="If different" />
        </div>
      </div>

      <div>
        <label className="label">Email</label>
        <input className="input" type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="email@example.com" />
      </div>

      {/* Location */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">City</label>
          <input className="input" value={form.city} onChange={e => setField('city', e.target.value)} placeholder="Beirut" />
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" value={form.address} onChange={e => setField('address', e.target.value)} placeholder="Street address" />
        </div>
      </div>

      {/* Type-specific extras */}
      {extraFields.length > 0 && (
        <div className={`grid grid-cols-${extraFields.length > 1 ? 2 : 1} gap-3`}>
          {extraFields.map(ef => (
            <div key={ef.key}>
              <label className="label">{ef.label}</label>
              {ef.type === 'select' && ef.addable ? (
                <AddableSelect value={form[ef.key]} options={ef.options} placeholder={ef.placeholder}
                  addPlaceholder={ef.addPlaceholder}
                  onChange={v => setField(ef.key, v)} onAddOption={ef.onAddOption} />
              ) : ef.type === 'select' ? (
                <select className="input" value={form[ef.key] ?? ''}
                  onChange={e => setField(ef.key, e.target.value)}>
                  <option value="">{ef.placeholder || '— Select —'}</option>
                  {ef.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={ef.type} className="input" value={form[ef.key] ?? ''}
                  onChange={e => setField(ef.key, e.target.value)} placeholder={ef.placeholder} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Credit/Debit allowed — lets this contact close orders with an unpaid balance. */}
      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
        <input type="checkbox" className="accent-brand-500 w-4 h-4"
          checked={!!form.credit_debit_allowed}
          onChange={e => setField('credit_debit_allowed', e.target.checked)} />
        Credit / Debit allowed (may owe a balance)
      </label>

      <div>
        <label className="label">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes}
          onChange={e => setField('notes', e.target.value)} placeholder="Optional notes…" />
      </div>
    </div>
  )
}
