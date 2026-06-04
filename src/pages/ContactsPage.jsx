import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Search, Edit2, Power, X, Check, AlertCircle,
  Phone, Mail, MapPin, Building, UserCheck, Handshake,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { generateAccountNumber, formatAccountNumber } from '../lib/accountNumber'
import ContactFormFields, { ACCOUNT_NUMBER_TYPES } from '../components/contacts/ContactFormFields'
import ContactAddresses from '../components/contacts/ContactAddresses'
import { saveContactAddresses } from '../lib/contactAddresses'

/* ── type config ─────────────────────────────────────────── */

const TYPE_CONFIG = {
  supplier: {
    title:       'Suppliers',
    contactType: 'supplier',
    Icon:        Building,
    color:       'text-orange-400',
    bg:          'bg-orange-600/20 border-orange-600/30',
    extraFields: [
      { key: 'supplier_code', label: 'Supplier Code', type: 'text', placeholder: 'SUP-001' },
      { key: 'payment_terms', label: 'Payment Terms (days)', type: 'number', placeholder: '30' },
    ],
  },
  customer: {
    title:       'Customers',
    contactType: 'customer',
    Icon:        UserCheck,
    color:       'text-cyan-400',
    bg:          'bg-cyan-600/20 border-cyan-600/30',
    extraFields: [],
  },
  partner: {
    title:       'Partners',
    contactType: 'partner',
    Icon:        Handshake,
    color:       'text-purple-400',
    bg:          'bg-purple-600/20 border-purple-600/30',
    extraFields: [
      { key: 'partner_percentage', label: 'Commission %', type: 'number', placeholder: '10' },
    ],
  },
}

const BASE_FORM = {
  entity_type: 'individual',
  company_name: '', commercial_registration: '',
  first_name: '', last_name: '', mobile: '', whatsapp_number: '',
  email: '', city: '', address: '', notes: '',
  account_number: '',
  // supplier extras
  supplier_code: '', payment_terms: '',
  // partner extras
  partner_percentage: '',
}

export default function ContactsPage({ type }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.customer
  const { COMPANY_ID } = useApp()
  const { currentUser } = useAuth()

  const [contacts,  setContacts]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('active')
  const [modal,     setModal]     = useState(null)
  const [form,      setForm]      = useState(BASE_FORM)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [toggling,  setToggling]  = useState(null)
  const [addresses,      setAddresses]      = useState([])
  const [origAddressIds, setOrigAddressIds] = useState([])

  /* ── fetch ───────────────────────────────────────────────── */

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('contacts')
      .select('*')
      .eq('contact_type', cfg.contactType)
      .order('first_name')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setContacts(data ?? [])
    setLoading(false)
  }, [cfg.contactType, COMPANY_ID])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  /* ── filter ──────────────────────────────────────────────── */

  const visible = contacts.filter(c => {
    const matchSearch =
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      c.company_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.mobile?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'active'   ? c.is_active :
      !c.is_active
    return matchSearch && matchFilter
  })

  /* ── handlers ────────────────────────────────────────────── */

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })); setError('') }

  function openAdd() {
    setForm(BASE_FORM); setAddresses([]); setOrigAddressIds([]); setError(''); setModal('add')
    if (ACCOUNT_NUMBER_TYPES.includes(type)) {
      generateAccountNumber(cfg.contactType)
        .then(acct => setForm(f => ({ ...f, account_number: acct })))
        .catch(() => {})
    }
  }
  async function openEdit(c) {
    setForm({ ...BASE_FORM, ...c, entity_type: c.entity_type || 'individual' })
    setAddresses([]); setOrigAddressIds([]); setError(''); setModal(c)
    const { data } = await supabase
      .from('contact_addresses')
      .select('*')
      .eq('contact_id', c.id)
      .order('is_primary', { ascending: false })
      .order('created_at')
    const rows = (data ?? []).map(a => ({
      _id: a.id,
      address_name: a.address_name ?? '', reference: a.reference ?? '',
      address_line: a.address_line ?? '', city: a.city ?? '', phone: a.phone ?? '',
      is_primary: !!a.is_primary, notes: a.notes ?? '',
      latitude: a.latitude, longitude: a.longitude,
    }))
    setAddresses(rows)
    setOrigAddressIds(rows.map(r => r._id))
  }
  function closeModal() { setModal(null); setForm(BASE_FORM); setAddresses([]); setOrigAddressIds([]); setError('') }

  async function handleSave() {
    const isCompany = form.entity_type === 'company'
    if (isCompany && !form.company_name.trim()) return setError('Company name is required.')
    if (!form.first_name.trim()) return setError(`${isCompany ? 'Contact first' : 'First'} name is required.`)
    if (!form.last_name.trim())  return setError(`${isCompany ? 'Contact last' : 'Last'} name is required.`)
    if (!form.mobile.trim())     return setError('Mobile number is required.')
    setSaving(true); setError('')

    // For new customers/suppliers, ensure an account number is generated before saving.
    const usesAccountNumber = ACCOUNT_NUMBER_TYPES.includes(type)
    let accountNumber = form.account_number
    if (modal === 'add' && usesAccountNumber && !accountNumber) {
      try { accountNumber = await generateAccountNumber(cfg.contactType) } catch { /* leave blank */ }
    }

    const payload = {
      contact_type:   cfg.contactType,
      // Company-only columns are sent only for companies, so individuals don't
      // depend on the entity_type/company_name/commercial_registration columns.
      ...(isCompany ? {
        entity_type:             'company',
        company_name:            form.company_name.trim(),
        commercial_registration: form.commercial_registration?.trim() || null,
      } : {}),
      first_name:     form.first_name.trim(),
      last_name:      form.last_name.trim(),
      mobile:         form.mobile.trim(),
      whatsapp_number: form.whatsapp_number?.trim() || null,
      email:          form.email?.trim()     || null,
      city:           form.city?.trim()      || null,
      address:        form.address?.trim()   || null,
      notes:          form.notes?.trim()     || null,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      // type-specific
      ...(type === 'supplier' ? {
        supplier_code: form.supplier_code?.trim() || null,
        payment_terms: Number(form.payment_terms) || null,
      } : {}),
      ...(type === 'partner' ? {
        partner_percentage: Number(form.partner_percentage) || null,
      } : {}),
      // audit / branch — account_number is generated client-side for customers & suppliers
      ...(modal === 'add'
        ? {
            branch_id:  currentUser?.branch_id || null,
            created_by: currentUser?.user_id   || null,
            ...(usesAccountNumber ? { account_number: accountNumber || null } : {}),
          }
        : {
            updated_by: currentUser?.user_id   || null,
            updated_at: new Date().toISOString(),
          }),
    }

    let contactId = modal === 'add' ? null : modal.id
    if (modal === 'add') {
      const { data, error: err } = await supabase.from('contacts').insert([payload]).select('id').single()
      if (err) { setError(err.message); setSaving(false); return }
      contactId = data.id
    } else {
      const { error: err } = await supabase.from('contacts').update(payload).eq('id', modal.id)
      if (err) { setError(err.message); setSaving(false); return }
    }

    const addrErr = await saveContactAddresses({
      contactId, addresses, origIds: origAddressIds,
      companyId: COMPANY_ID, userId: currentUser?.user_id || null,
    })
    if (addrErr) { setError(addrErr); setSaving(false); return }

    await fetchContacts(); closeModal()
    setSaving(false)
  }

  async function toggleActive(c) {
    setToggling(c.id)
    await supabase.from('contacts').update({ is_active: !c.is_active }).eq('id', c.id)
    await fetchContacts()
    setToggling(null)
  }

  const { Icon, title, color, bg } = cfg

  // Entity type (Individual / Company) of the open form — used by the save button.
  const isCompany = form.entity_type === 'company'

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${bg}`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">{title}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{contacts.length} total</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder={`Search ${title.toLowerCase()}…`}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="flex items-center gap-1">
          {['active', 'inactive', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
              }`}>{f}</button>
          ))}
        </div>

        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> Add {title.slice(0, -1)}
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Name', 'Contact', 'Location', ...(cfg.extraFields.map(f => f.label)), 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">No {title.toLowerCase()} found</td></tr>
            ) : visible.map(c => (
              <tr key={c.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${!c.is_active ? 'opacity-50' : ''}`}>

                {/* Name */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 text-xs font-bold ${bg} ${color}`}>
                      {c.first_name?.[0]?.toUpperCase()}{c.last_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      {c.entity_type === 'company' && c.company_name ? (
                        <>
                          <p className="text-slate-100 font-medium">{c.company_name}</p>
                          <p className="text-slate-400 text-xs">{c.first_name} {c.last_name}</p>
                        </>
                      ) : (
                        <p className="text-slate-100 font-medium">{c.first_name} {c.last_name}</p>
                      )}
                      {c.code && <p className="text-slate-500 text-xs font-mono">{c.code}</p>}
                      {c.account_number && <p className="text-slate-500 text-xs font-mono tracking-wider">{formatAccountNumber(c.account_number)}</p>}
                    </div>
                  </div>
                </td>

                {/* Contact */}
                <td className="px-4 py-3 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400"><Phone className="w-3 h-3" />{c.mobile}</div>
                  {c.email && <div className="flex items-center gap-1.5 text-xs text-slate-500"><Mail className="w-3 h-3" />{c.email}</div>}
                </td>

                {/* Location */}
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {c.city ? <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.city}</div> : <span className="text-slate-600">—</span>}
                </td>

                {/* Extra fields */}
                {cfg.extraFields.map(ef => (
                  <td key={ef.key} className="px-4 py-3 text-slate-400 text-xs">
                    {c[ef.key] ?? <span className="text-slate-600">—</span>}
                  </td>
                ))}

                {/* Status */}
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${c.is_active ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-slate-500/10 text-slate-500 border-slate-500/20'}`}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(c)} className="btn-ghost p-1.5 text-slate-500" title="Edit">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleActive(c)} disabled={toggling === c.id}
                      title={c.is_active ? 'Deactivate' : 'Activate'}
                      className={`btn-ghost p-1.5 ${c.is_active ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'}`}>
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
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Icon className={`w-4 h-4 ${color}`} />
                {modal === 'add' ? `Add ${title.slice(0, -1)}` : `Edit ${title.slice(0, -1)}`}
              </h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <ContactFormFields
              type={type}
              form={form}
              setField={fld}
              mode={modal === 'add' ? 'add' : 'edit'}
              extraFields={cfg.extraFields}
            />

            <ContactAddresses addresses={addresses} setAddresses={setAddresses} />

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave}
                disabled={saving || (isCompany && !form.company_name.trim()) || !form.first_name.trim() || !form.last_name.trim() || !form.mobile.trim()}>
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : modal === 'add' ? `Add ${title.slice(0, -1)}` : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
