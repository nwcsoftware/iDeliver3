import React, { useState, useEffect, useCallback } from 'react'
import {
  Building2, Plus, Edit2, Power, X, Check, AlertCircle,
  Phone, Mail, Globe, MapPin, Hash, Save,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const EMPTY_COMPANY = {
  code: '', name: '', name_ar: '', cr_number: '', vat_number: '',
  tax_id: '', address: '', city: '', country: 'Lebanon',
  phone: '', email: '', website: '', currency_default: 'USD',
}

const EMPTY_BRANCH = {
  code: '', name: '', name_ar: '', address: '', city: '', phone: '', email: '',
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function ReadRow({ label, value, icon: Icon }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2 text-sm">
      {Icon && <Icon className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />}
      <div>
        <span className="text-slate-500 text-xs uppercase tracking-wide">{label} </span>
        <span className="text-slate-200">{value}</span>
      </div>
    </div>
  )
}

export default function CompanyPage() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('super_admin', 'admin')

  const [company,        setCompany]        = useState(null)
  const [branches,       setBranches]       = useState([])
  const [loadingCo,      setLoadingCo]      = useState(true)
  const [loadingBr,      setLoadingBr]      = useState(false)
  const [editingCo,      setEditingCo]      = useState(false)
  const [coForm,         setCoForm]         = useState(EMPTY_COMPANY)
  const [savingCo,       setSavingCo]       = useState(false)
  const [coError,        setCoError]        = useState('')
  const [branchModal,    setBranchModal]    = useState(null)   // null | 'add' | branch row
  const [branchForm,     setBranchForm]     = useState(EMPTY_BRANCH)
  const [savingBr,       setSavingBr]       = useState(false)
  const [branchError,    setBranchError]    = useState('')
  const [togglingBranch, setTogglingBranch] = useState(null)

  /* ── data fetching ─────────────────────────────────────────── */

  const fetchCompany = useCallback(async () => {
    setLoadingCo(true)
    const { data } = await supabase.from('companies').select('*').limit(1).maybeSingle()
    setCompany(data ?? null)
    setCoForm(data ? { ...EMPTY_COMPANY, ...data } : EMPTY_COMPANY)
    setLoadingCo(false)
  }, [])

  const fetchBranches = useCallback(async (companyId) => {
    if (!companyId) return
    setLoadingBr(true)
    const { data } = await supabase
      .from('branches').select('*')
      .eq('company_id', companyId)
      .order('code')
    setBranches(data ?? [])
    setLoadingBr(false)
  }, [])

  useEffect(() => { fetchCompany() }, [fetchCompany])
  useEffect(() => { if (company?.id) fetchBranches(company.id) }, [company?.id, fetchBranches])

  /* ── company form handlers ─────────────────────────────────── */

  function cf(key, val) { setCoForm(f => ({ ...f, [key]: val })); setCoError('') }

  function startEditCompany() {
    setCoForm(company ? { ...EMPTY_COMPANY, ...company } : EMPTY_COMPANY)
    setCoError('')
    setEditingCo(true)
  }

  function cancelEditCompany() {
    setCoForm(company ? { ...EMPTY_COMPANY, ...company } : EMPTY_COMPANY)
    setCoError('')
    setEditingCo(false)
  }

  async function saveCompany() {
    if (!coForm.code.trim()) return setCoError('Company code is required.')
    if (!coForm.name.trim()) return setCoError('Company name is required.')
    setSavingCo(true)
    setCoError('')

    const payload = {
      code:             coForm.code.trim().toUpperCase(),
      name:             coForm.name.trim(),
      name_ar:          coForm.name_ar?.trim()     || null,
      cr_number:        coForm.cr_number?.trim()   || null,
      vat_number:       coForm.vat_number?.trim()  || null,
      tax_id:           coForm.tax_id?.trim()      || null,
      address:          coForm.address?.trim()     || null,
      city:             coForm.city?.trim()        || null,
      country:          coForm.country?.trim()     || 'Lebanon',
      phone:            coForm.phone?.trim()       || null,
      email:            coForm.email?.trim()       || null,
      website:          coForm.website?.trim()     || null,
      currency_default: coForm.currency_default,
    }

    const { error } = company
      ? await supabase.from('companies').update(payload).eq('id', company.id)
      : await supabase.from('companies').insert([payload])

    if (error) {
      setCoError(error.message)
    } else {
      await fetchCompany()
      setEditingCo(false)
    }
    setSavingCo(false)
  }

  /* ── branch handlers ────────────────────────────────────────── */

  function bf(key, val) { setBranchForm(f => ({ ...f, [key]: val })); setBranchError('') }

  function openAddBranch()   { setBranchForm(EMPTY_BRANCH); setBranchError(''); setBranchModal('add') }
  function openEditBranch(b) { setBranchForm({ ...EMPTY_BRANCH, ...b }); setBranchError(''); setBranchModal(b) }
  function closeBranchModal(){ setBranchModal(null); setBranchForm(EMPTY_BRANCH); setBranchError('') }

  async function saveBranch() {
    if (!branchForm.code.trim()) return setBranchError('Branch code is required.')
    if (!branchForm.name.trim()) return setBranchError('Branch name is required.')
    setSavingBr(true)
    setBranchError('')

    const payload = {
      company_id: company.id,
      code:       branchForm.code.trim().toUpperCase(),
      name:       branchForm.name.trim(),
      name_ar:    branchForm.name_ar?.trim()  || null,
      address:    branchForm.address?.trim()  || null,
      city:       branchForm.city?.trim()     || null,
      phone:      branchForm.phone?.trim()    || null,
      email:      branchForm.email?.trim()    || null,
    }

    const { error } = branchModal === 'add'
      ? await supabase.from('branches').insert([payload])
      : await supabase.from('branches').update(payload).eq('id', branchModal.id)

    if (error) {
      setBranchError(error.message.includes('unique') ? 'Branch code already exists.' : error.message)
    } else {
      await fetchBranches(company.id)
      closeBranchModal()
    }
    setSavingBr(false)
  }

  async function toggleBranchActive(b) {
    setTogglingBranch(b.id)
    await supabase.from('branches').update({ is_active: !b.is_active }).eq('id', b.id)
    await fetchBranches(company.id)
    setTogglingBranch(null)
  }

  /* ── render ─────────────────────────────────────────────────── */

  if (loadingCo) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Loading company profile…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Company Profile</h1>
            <p className="text-xs text-slate-500">Manage company information and branches</p>
          </div>
        </div>
        {canEdit && !editingCo && (
          <button className="btn-primary" onClick={company ? startEditCompany : startEditCompany}>
            {company ? <><Edit2 className="w-4 h-4" /> Edit Profile</> : <><Plus className="w-4 h-4" /> Create Company</>}
          </button>
        )}
      </div>

      {/* ── Company card ─────────────────────────────────────── */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-surface-border pb-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Company Information
          </h2>
          {!company && !editingCo && (
            <span className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-1 rounded-lg">
              No company created yet
            </span>
          )}
        </div>

        {/* View mode */}
        {!editingCo && company && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-brand-600/20 border border-brand-600/30 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-7 h-7 text-brand-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-slate-100">{company.name}</p>
                {company.name_ar && <p className="text-sm text-slate-400 mt-0.5" dir="rtl">{company.name_ar}</p>}
                <p className="text-xs font-mono text-brand-400 mt-1">{company.code}</p>
              </div>
              <span className={`ml-auto px-2 py-1 rounded-lg text-xs font-medium border ${
                company.is_active
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20'
              }`}>
                {company.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-2 pt-2">
              <ReadRow label="Country"        value={company.country}       icon={MapPin}  />
              <ReadRow label="City"           value={company.city}          icon={MapPin}  />
              <ReadRow label="Phone"          value={company.phone}         icon={Phone}   />
              <ReadRow label="Email"          value={company.email}         icon={Mail}    />
              <ReadRow label="Website"        value={company.website}       icon={Globe}   />
              <ReadRow label="Currency"       value={company.currency_default} icon={Hash} />
              <ReadRow label="CR Number"      value={company.cr_number}     icon={Hash}    />
              <ReadRow label="VAT Number"     value={company.vat_number}    icon={Hash}    />
              <ReadRow label="Tax ID"         value={company.tax_id}        icon={Hash}    />
              {company.address && (
                <div className="col-span-2 flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-slate-500 text-xs uppercase tracking-wide">Address </span>
                    <span className="text-slate-200">{company.address}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edit / Create form */}
        {(editingCo || !company) && (
          <div className="space-y-4">
            {/* Basic */}
            <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Basic Info</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company Code *">
                <input className="input font-mono uppercase" value={coForm.code}
                  onChange={e => cf('code', e.target.value)} placeholder="ID3-MAIN" />
              </Field>
              <Field label="Default Currency">
                <select className="input" value={coForm.currency_default} onChange={e => cf('currency_default', e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="LBP">LBP</option>
                  <option value="EUR">EUR</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company Name (EN) *">
                <input className="input" value={coForm.name} onChange={e => cf('name', e.target.value)} placeholder="My Company LLC" />
              </Field>
              <Field label="Company Name (AR)">
                <input className="input text-right" dir="rtl" value={coForm.name_ar} onChange={e => cf('name_ar', e.target.value)} placeholder="اسم الشركة" />
              </Field>
            </div>

            {/* Legal */}
            <p className="text-xs text-slate-500 uppercase tracking-wider font-medium pt-1">Legal</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="CR Number">
                <input className="input" value={coForm.cr_number} onChange={e => cf('cr_number', e.target.value)} placeholder="CR-00000" />
              </Field>
              <Field label="VAT Number">
                <input className="input" value={coForm.vat_number} onChange={e => cf('vat_number', e.target.value)} placeholder="VAT-00000" />
              </Field>
              <Field label="Tax ID">
                <input className="input" value={coForm.tax_id} onChange={e => cf('tax_id', e.target.value)} placeholder="TAX-00000" />
              </Field>
            </div>

            {/* Contact */}
            <p className="text-xs text-slate-500 uppercase tracking-wider font-medium pt-1">Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input className="input" value={coForm.phone} onChange={e => cf('phone', e.target.value)} placeholder="+961 1 000 000" />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={coForm.email} onChange={e => cf('email', e.target.value)} placeholder="info@company.com" />
              </Field>
              <Field label="Website">
                <input className="input" value={coForm.website} onChange={e => cf('website', e.target.value)} placeholder="https://company.com" />
              </Field>
            </div>

            {/* Location */}
            <p className="text-xs text-slate-500 uppercase tracking-wider font-medium pt-1">Location</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <input className="input" value={coForm.city} onChange={e => cf('city', e.target.value)} placeholder="Beirut" />
              </Field>
              <Field label="Country">
                <input className="input" value={coForm.country} onChange={e => cf('country', e.target.value)} placeholder="Lebanon" />
              </Field>
            </div>
            <Field label="Address">
              <textarea className="input resize-none" rows={2} value={coForm.address}
                onChange={e => cf('address', e.target.value)} placeholder="Full address…" />
            </Field>

            {coError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {coError}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              {company && (
                <button className="btn-ghost" onClick={cancelEditCompany}>Cancel</button>
              )}
              <button className="btn-primary" onClick={saveCompany}
                disabled={savingCo || !coForm.code.trim() || !coForm.name.trim()}>
                <Save className="w-4 h-4" />
                {savingCo ? 'Saving…' : company ? 'Save Changes' : 'Create Company'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Branches section ─────────────────────────────────── */}
      {company && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Branches</h2>
              <p className="text-xs text-slate-500 mt-0.5">{branches.length} branch{branches.length !== 1 ? 'es' : ''}</p>
            </div>
            {canEdit && (
              <button className="btn-primary" onClick={openAddBranch}>
                <Plus className="w-4 h-4" /> Add Branch
              </button>
            )}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border">
                {['Code', 'Name', 'City', 'Phone', 'Email', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingBr ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">Loading…</td></tr>
              ) : branches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center">
                    <p className="text-slate-500">No branches yet</p>
                    {canEdit && (
                      <button className="mt-3 btn-ghost text-brand-400" onClick={openAddBranch}>
                        <Plus className="w-4 h-4" /> Add the first branch
                      </button>
                    )}
                  </td>
                </tr>
              ) : branches.map(b => (
                <tr key={b.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs text-brand-400 bg-brand-600/10 border border-brand-600/20 px-2 py-0.5 rounded">{b.code}</span>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-slate-100 font-medium">{b.name}</p>
                    {b.name_ar && <p className="text-slate-500 text-xs" dir="rtl">{b.name_ar}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {[b.city, b.address].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-5 py-3">
                    {b.phone
                      ? <span className="text-slate-400 flex items-center gap-1 text-xs"><Phone className="w-3 h-3" />{b.phone}</span>
                      : <span className="text-slate-600 text-xs">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    {b.email
                      ? <span className="text-slate-400 flex items-center gap-1 text-xs"><Mail className="w-3 h-3" />{b.email}</span>
                      : <span className="text-slate-600 text-xs">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                      b.is_active
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                    }`}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEditBranch(b)}
                          className="btn-ghost p-1.5 text-slate-500" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleBranchActive(b)}
                          disabled={togglingBranch === b.id}
                          className={`btn-ghost p-1.5 ${b.is_active ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'}`}
                          title={b.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Branch modal ─────────────────────────────────────── */}
      {branchModal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg p-6 space-y-4 overflow-y-auto max-h-[90vh]">

            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">
                {branchModal === 'add' ? 'Add Branch' : 'Edit Branch'}
              </h2>
              <button onClick={closeBranchModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Branch Code *">
                  <input className="input font-mono uppercase" value={branchForm.code}
                    onChange={e => bf('code', e.target.value)} placeholder="HQ" />
                </Field>
                <Field label="Branch Name (EN) *">
                  <input className="input" value={branchForm.name}
                    onChange={e => bf('name', e.target.value)} placeholder="Headquarters" />
                </Field>
              </div>
              <Field label="Branch Name (AR)">
                <input className="input text-right" dir="rtl" value={branchForm.name_ar}
                  onChange={e => bf('name_ar', e.target.value)} placeholder="المركز الرئيسي" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City">
                  <input className="input" value={branchForm.city}
                    onChange={e => bf('city', e.target.value)} placeholder="Beirut" />
                </Field>
                <Field label="Phone">
                  <input className="input" value={branchForm.phone}
                    onChange={e => bf('phone', e.target.value)} placeholder="+961 1 000 000" />
                </Field>
              </div>
              <Field label="Email">
                <input className="input" type="email" value={branchForm.email}
                  onChange={e => bf('email', e.target.value)} placeholder="branch@company.com" />
              </Field>
              <Field label="Address">
                <textarea className="input resize-none" rows={2} value={branchForm.address}
                  onChange={e => bf('address', e.target.value)} placeholder="Street address…" />
              </Field>
            </div>

            {branchError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {branchError}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={closeBranchModal}>Cancel</button>
              <button className="btn-primary" onClick={saveBranch}
                disabled={savingBr || !branchForm.code.trim() || !branchForm.name.trim()}>
                <Check className="w-4 h-4" />
                {savingBr ? 'Saving…' : branchModal === 'add' ? 'Add Branch' : 'Save Branch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
