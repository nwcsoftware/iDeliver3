import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, Edit2, Power, X, Check, AlertCircle,
  Phone, Mail, MapPin, Building, UserCheck, Handshake, ChevronRight, KeyRound, Copy, Eye, EyeOff, CreditCard, UserPlus,
} from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { generateAccountNumber, ensureUniqueAccountNumber, insertContactWithUniqueCode, formatAccountNumber } from '../lib/accountNumber'
import { formatMobile } from '../lib/phone'
import ContactFormFields, { ACCOUNT_NUMBER_TYPES, CONTACT_ROLES } from '../components/contacts/ContactFormFields'
import ContactAddresses from '../components/contacts/ContactAddresses'
import ContactSubAccounts from '../components/contacts/ContactSubAccounts'
import { saveContactAddresses } from '../lib/contactAddresses'
import { loadSubAccounts, saveSubAccounts, ensurePrimarySubAccount } from '../lib/subAccounts'

/* ── type config ─────────────────────────────────────────── */

// Seed business types; users can add their own (persisted in business_types).
const DEFAULT_BUSINESS_TYPES = ['supermarket', 'grocery', 'bakery', 'restaurant', 'sweets', 'flowers', 'other']

// Every non-driver contact type shares ONE form — the former Partner form
// (Commission %, Business Type, Contact Category). Only the title/icon/colour
// differ per page; the in-form Roles selector lets a contact be Customer,
// Partner, Supplier (or several at once) and be switched between them any time.
const GENERAL_EXTRA_FIELDS = [
  { key: 'partner_percentage', label: 'Commission %',     type: 'number', placeholder: '10' },
  { key: 'shop_type',          label: 'Business Type',    type: 'select', placeholder: '— Select —', options: DEFAULT_BUSINESS_TYPES },
  { key: 'contact_category',   label: 'Contact Category', type: 'select', placeholder: '— Select —', options: [] },
]

// Panes of the add/edit contact modal.
const CONTACT_TABS = [
  { value: 'details',   label: 'Details',         Icon: UserCheck },
  { value: 'addresses', label: 'Addresses',       Icon: MapPin },
  { value: 'accounts',  label: 'Account Numbers', Icon: CreditCard },
]

const TYPE_CONFIG = {
  supplier: { title: 'Suppliers', contactType: 'supplier', Icon: Building,  color: 'text-orange-400', bg: 'bg-orange-600/20 border-orange-600/30', extraFields: GENERAL_EXTRA_FIELDS },
  customer: { title: 'Customers', contactType: 'customer', Icon: UserCheck, color: 'text-cyan-400',   bg: 'bg-cyan-600/20 border-cyan-600/30',   extraFields: GENERAL_EXTRA_FIELDS },
  partner:  { title: 'Partners',  contactType: 'partner',  Icon: Handshake, color: 'text-purple-400', bg: 'bg-purple-600/20 border-purple-600/30', extraFields: GENERAL_EXTRA_FIELDS },
}

// A random 12-character password of letters and digits.
function generatePassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(len)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length]
  return out
}

const BASE_FORM = {
  entity_type: 'individual',
  company_name: '', commercial_registration: '',
  first_name: '', last_name: '', mobile: '', whatsapp_number: '',
  email: '', city: '', address: '', notes: '',
  account_number: '', credit_debit_allowed: false,
  // Roles this contact holds (tags). Always includes the page's primary type.
  contact_types: [],
  // Shared "general form" fields (all non-driver contact types).
  partner_percentage: '', shop_type: '', contact_category: '',
}

export default function ContactsPage({ type }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.customer
  const { COMPANY_ID } = useApp()
  const { currentUser, hasRole } = useAuth()
  const isAdmin = hasRole('super_admin', 'admin')
  const navigate = useNavigate()

  const [contacts,  setContacts]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('active')
  const [modal,     setModal]     = useState(null)
  const [form,      setForm]      = useState(BASE_FORM)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [toggling,  setToggling]  = useState(null)
  const [businessTypes,     setBusinessTypes]     = useState([])   // custom types from business_types
  const [contactCategories, setContactCategories] = useState([])   // custom contact_categories
  const [addresses,      setAddresses]      = useState([])
  const [origAddressIds, setOrigAddressIds] = useState([])
  const [accounts,       setAccounts]       = useState([])   // sub_accounts rows
  const [origAccountIds, setOrigAccountIds] = useState([])
  const [tab,            setTab]            = useState('details')
  // Customer "User Account & Security" collapsible section (admin only).
  const [credOpen,     setCredOpen]     = useState(false)
  const [resetting,    setResetting]    = useState(false)
  const [usernameInput, setUsernameInput] = useState('') // read-only customer username
  const [pwInput,      setPwInput]      = useState('')   // admin-entered new password
  const [showPw,       setShowPw]       = useState(false)
  const [editingPw,    setEditingPw]    = useState(false) // true once Reset is pressed (new pw is visible)
  const [newPassword,  setNewPassword]  = useState('')   // confirmation shown after a reset
  const [credError,    setCredError]    = useState('')

  const PW_MIN = 12

  /* ── fetch ───────────────────────────────────────────────── */

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    // A contact appears here if this page's type is among its roles (contact_types),
    // so multi-role contacts (e.g. Customer + Partner) show on every matching page.
    // Paged — the customer list is past PostgREST's 1000-row cap.
    const { data } = await fetchAllRows(() => {
      let q = supabase
        .from('contacts')
        .select('*')
        .contains('contact_types', [cfg.contactType])
        .order('first_name')
        .order('id')
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    })
    setContacts(data ?? [])
    setLoading(false)
  }, [cfg.contactType, COMPANY_ID])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  /* ── user-extensible lookups (supplier form) ─────────────── */

  const fetchLookups = useCallback(async () => {
    // Every contact type now uses the shared form, so all pages need these lookups.
    const load = async (table) => {
      let q = supabase.from(table).select('name').eq('is_active', true).order('name')
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      const { data } = await q
      return (data ?? []).map(r => r.name)
    }
    const [bt, cc] = await Promise.all([load('business_types'), load('contact_categories')])
    setBusinessTypes(bt); setContactCategories(cc)
  }, [type, COMPANY_ID])

  useEffect(() => { fetchLookups() }, [fetchLookups])

  /* Insert a value into a lookup table inline; returns the saved name (reusing
     an existing one, case-insensitively) or null on error. */
  function makeAdder(table, defaults, current, setCurrent) {
    return async (name) => {
      const clean = name.trim()
      if (!clean) return null
      const existing = [...defaults, ...current].find(t => t.toLowerCase() === clean.toLowerCase())
      if (existing) return existing
      const { error } = await supabase.from(table)
        .insert([{ name: clean, is_active: true, ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}) }])
      if (error) { setError(error.message); return null }
      setCurrent(ts => [...ts, clean].sort((a, b) => a.localeCompare(b)))
      return clean
    }
  }

  // Inject merged options + the inline "add" handler onto each addable field.
  const ADDABLE = {
    shop_type:        { defaults: DEFAULT_BUSINESS_TYPES, current: businessTypes,     add: makeAdder('business_types',     DEFAULT_BUSINESS_TYPES, businessTypes,     setBusinessTypes),     placeholder: 'New business type' },
    contact_category: { defaults: [],                     current: contactCategories, add: makeAdder('contact_categories', [],                     contactCategories, setContactCategories), placeholder: 'New contact category' },
  }
  const formExtraFields = cfg.extraFields.map(ef => {
    const a = ADDABLE[ef.key]
    if (!a) return ef
    return {
      ...ef,
      options: [...new Set([...a.defaults, ...a.current])],
      addable: true,
      addPlaceholder: a.placeholder,
      onAddOption: a.add,
    }
  })

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
    setForm({ ...BASE_FORM, contact_types: [cfg.contactType] }); setAddresses([]); setOrigAddressIds([])
    setAccounts([]); setOrigAccountIds([]); setTab('details'); setError(''); setModal('add')
    if (ACCOUNT_NUMBER_TYPES.includes(type)) {
      generateAccountNumber(cfg.contactType)
        .then(acct => setForm(f => ({ ...f, account_number: acct })))
        .catch(() => {})
    }
  }
  async function openEdit(c) {
    setForm({
      ...BASE_FORM, ...c,
      entity_type: c.entity_type || 'individual',
      // Fall back to the single primary type for rows saved before multi-role.
      contact_types: (Array.isArray(c.contact_types) && c.contact_types.length)
        ? c.contact_types
        : [c.contact_type].filter(Boolean),
    })
    setAddresses([]); setOrigAddressIds([]); setAccounts([]); setOrigAccountIds([])
    setTab('details'); setError(''); setModal(c)
    setCredOpen(false); setUsernameInput(c.username || ''); setPwInput(''); setShowPw(false); setEditingPw(false); setNewPassword(''); setCredError('')
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

    const { rows: acctRows } = await loadSubAccounts(c.id)
    setAccounts(acctRows)
    setOrigAccountIds(acctRows.map(r => r._id))
  }
  function closeModal() {
    setModal(null); setForm(BASE_FORM); setAddresses([]); setOrigAddressIds([])
    setAccounts([]); setOrigAccountIds([]); setTab('details'); setError('')
    setCredOpen(false); setUsernameInput(''); setPwInput(''); setShowPw(false); setEditingPw(false); setNewPassword(''); setCredError(''); setResetting(false)
  }

  /* Enter "set new password" mode with a freshly generated password (visible).
     Warns first, since saving will replace the customer's current password. */
  function startPasswordReset() {
    if (!usernameInput.trim()) { setCredError('This customer is not registered yet (no username).'); return }
    if (!window.confirm(
      '⚠ Reset this customer’s password?\n\n' +
      'A new password will be generated (you can also type your own). When you save it, ' +
      'the customer’s current password will stop working immediately — make sure to share the new one with them.'
    )) return
    setEditingPw(true); setPwInput(generatePassword(PW_MIN)); setShowPw(true); setNewPassword(''); setCredError('')
  }
  function cancelPasswordReset() {
    setEditingPw(false); setPwInput(''); setShowPw(false); setCredError('')
  }

  /* Admin: reset the customer's password (>= 12) without revealing the old one.
     The username is view-only here (set during customer setup); the RPC requires
     the customer to already have one. */
  async function resetCustomerPassword() {
    if (!isAdmin || !modal || modal === 'add') return
    const pwd = pwInput
    if (!usernameInput.trim()) { setCredError('This customer does not have a username yet.'); return }
    if (pwd.length < PW_MIN) { setCredError(`Password must be at least ${PW_MIN} characters.`); return }
    setResetting(true); setCredError(''); setNewPassword('')
    try {
      const { data, error: e } = await supabase.rpc('admin_reset_customer_password', {
        p_contact_id:   modal.id,
        p_new_password: pwd,
      })
      if (e) throw e
      const username = data?.[0]?.username
      setNewPassword(pwd)            // confirm what was set (copyable, shown once)
      setPwInput(''); setShowPw(false); setEditingPw(false)
      if (username) { setUsernameInput(username); setForm(f => ({ ...f, username })) }
    } catch (e) {
      const msg = e?.message || String(e)
      setCredError(/USERNAME_REQUIRED/i.test(msg) ? 'This customer does not have a username yet.' : msg)
    } finally {
      setResetting(false)
    }
  }

  async function handleSave() {
    const isCompany = form.entity_type === 'company'
    if (isCompany && !form.company_name.trim()) return setError('Company name is required.')
    if (!form.first_name.trim()) return setError(`${isCompany ? 'Contact first' : 'First'} name is required.`)
    if (!form.last_name.trim())  return setError(`${isCompany ? 'Contact last' : 'Last'} name is required.`)
    if (!form.mobile.trim())     return setError('Mobile number is required.')
    setSaving(true); setError('')

    // For new customers/suppliers/partners, ensure a UNIQUE account number right
    // before saving — regenerate if the pre-filled one is blank or already taken.
    const usesAccountNumber = ACCOUNT_NUMBER_TYPES.includes(type)
    let accountNumber = form.account_number
    if (modal === 'add' && usesAccountNumber) {
      try { accountNumber = await ensureUniqueAccountNumber(accountNumber, cfg.contactType) } catch { /* leave as-is */ }
    }

    // Roles (tags) chosen on the form; always keep at least the page's own type.
    const selectedTypes = (Array.isArray(form.contact_types) && form.contact_types.length)
      ? [...new Set(form.contact_types)]
      : [cfg.contactType]
    // The primary type drives the contact code & account-number prefix. Keep the
    // existing primary when it's still among the selected roles; otherwise fall
    // back to the first selected role (e.g. when a role is switched entirely).
    const existingPrimary = modal === 'add' ? cfg.contactType : (modal.contact_type || cfg.contactType)
    const primaryType = selectedTypes.includes(existingPrimary) ? existingPrimary : selectedTypes[0]

    const payload = {
      contact_type:   primaryType,
      contact_types:  selectedTypes,
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
      credit_debit_allowed: !!form.credit_debit_allowed,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      // Shared "general form" fields — saved for every non-driver contact type.
      partner_percentage: Number(form.partner_percentage) || null,
      shop_type:          form.shop_type?.trim() || null,
      contact_category:   form.contact_category?.trim() || null,
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
      // Generates a unique contact code and retries on duplicate-code collisions.
      const { data, error: err } = await insertContactWithUniqueCode(payload, primaryType, 'id')
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

    const acctErr = await saveSubAccounts({
      contactId, accounts, origIds: origAccountIds,
      companyId: COMPANY_ID, userId: currentUser?.user_id || null,
    })
    if (acctErr) { setError(acctErr); setSaving(false); return }

    // New contact that wasn't given accounts by hand → seed the primary one, so
    // it starts out like every contact the fix81 backfill touched.
    if (modal === 'add' && accounts.length === 0) {
      await ensurePrimarySubAccount({
        contactId,
        accountNumber: accountNumber,
        creditAllowed: !!form.credit_debit_allowed,
        companyId: COMPANY_ID,
        userId: currentUser?.user_id || null,
      })
    }

    // Saved successfully → close immediately, then refresh the list in the background.
    setSaving(false); closeModal()
    fetchContacts()
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

  /* ── login access (suppliers & partners) ─────────────────────
     A contact tagged Supplier or Partner may be given a user account to sign in.
     The button hands the entered details to the User Accounts form, where the
     admin sets the username & password. */
  const LOGIN_ROLES = ['supplier', 'partner']
  const loginRole = (form.contact_types || []).find(t => LOGIN_ROLES.includes(t))
  // A login must be tied to a saved contact so the 2nd-party user only sees their
  // own orders — so this is offered on existing (edit-mode) contacts only.
  const isSavedContact = modal && modal !== 'add'
  const canCreateUser  = isAdmin && !!loginRole && isSavedContact

  // Suggest a username from the contact's name (or company), sanitised.
  function suggestUsername() {
    const base = isCompany && form.company_name
      ? form.company_name
      : `${form.first_name} ${form.last_name}`
    return base.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30)
  }

  // Carry the contact's details (and id, to link the account) to the User
  // Accounts form and open "New User".
  function goCreateUser() {
    navigate('/settings/users', {
      state: {
        prefillUser: {
          contact_id: modal.id,
          username: suggestUsername(),
          email:  form.email?.trim()  || '',
          mobile: form.mobile?.trim() || '',
          role:   loginRole,
        },
      },
    })
  }

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
                          <p className="text-slate-100 font-medium flex items-center gap-1.5">
                            {c.company_name}
                            {c.credit_debit_allowed && <CreditCard className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" title="Credit customer (may owe a balance)" />}
                          </p>
                          <p className="text-slate-400 text-xs">{c.first_name} {c.last_name}</p>
                        </>
                      ) : (
                        <p className="text-slate-100 font-medium flex items-center gap-1.5">
                          {c.first_name} {c.last_name}
                          {c.credit_debit_allowed && <CreditCard className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" title="Credit customer (may owe a balance)" />}
                        </p>
                      )}
                      {c.code && <p className="text-slate-500 text-xs font-mono">{c.code}</p>}
                      {c.account_number && <p className="text-slate-500 text-xs font-mono tracking-wider">{formatAccountNumber(c.account_number)}</p>}
                      {/* Other roles this contact also holds (besides this page's). */}
                      {Array.isArray(c.contact_types) && c.contact_types.filter(t => t !== cfg.contactType).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {CONTACT_ROLES.filter(r => c.contact_types.includes(r.value) && r.value !== cfg.contactType).map(r => (
                            <span key={r.value} className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${r.cls}`}>
                              {r.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* Contact */}
                <td className="px-4 py-3 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400"><Phone className="w-3 h-3" />{formatMobile(c.mobile)}</div>
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

            {/* Tabs — the form is long enough that details, addresses and account
                numbers each deserve their own pane. Validation errors and the
                Save button live outside the tabs, so they're always reachable. */}
            <div className="flex items-center gap-1 border-b border-surface-border -mx-6 px-6">
              {CONTACT_TABS.map(t => (
                <button key={t.value} type="button" onClick={() => setTab(t.value)}
                  className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
                    tab === t.value
                      ? 'text-brand-300 border-brand-500'
                      : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
                  <t.Icon className="w-3.5 h-3.5" /> {t.label}
                  {t.value === 'accounts' && accounts.length > 0 && (
                    <span className="text-[10px] text-slate-500">({accounts.length})</span>
                  )}
                </button>
              ))}
            </div>

            {tab === 'details' && (
              <ContactFormFields
                type={type}
                form={form}
                setField={fld}
                mode={modal === 'add' ? 'add' : 'edit'}
                extraFields={formExtraFields}
                showRoles
              />
            )}

            {tab === 'addresses' && (
              <ContactAddresses addresses={addresses} setAddresses={setAddresses} />
            )}

            {tab === 'accounts' && (
              <ContactSubAccounts
                accounts={accounts}
                setAccounts={setAccounts}
                contactType={cfg.contactType}
              />
            )}

            {/* Login access — suppliers & partners may be given a user account. */}
            {tab === 'details' && isAdmin && loginRole && (
              <div className="border border-surface-border rounded-lg p-3 flex items-start gap-3 bg-surface-hover/30">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-brand-400" /> Login Access
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isSavedContact
                      ? <>This {loginRole} can have a user account to sign in and see only their own orders. You’ll set the username &amp; password on the next screen.</>
                      : <>This {loginRole} can be given a sign-in account. Save the contact first, then reopen it to create the login.</>}
                  </p>
                </div>
                {canCreateUser && (
                  <button type="button" onClick={goCreateUser}
                    className="btn-primary whitespace-nowrap self-center">
                    <UserPlus className="w-4 h-4" /> Create User Profile
                  </button>
                )}
              </div>
            )}

            {/* Customer user account & security — collapsible, admin only */}
            {tab === 'details' && type === 'customer' && modal !== 'add' && isAdmin && (
              <div className="border border-surface-border rounded-lg overflow-hidden">
                <button type="button" onClick={() => setCredOpen(o => !o)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-surface-hover/40 hover:bg-surface-hover text-left transition-colors">
                  <ChevronRight className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${credOpen ? 'rotate-90' : ''}`} />
                  <KeyRound className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-[11px] text-slate-300 uppercase tracking-wider font-semibold">User Account &amp; Security</span>
                </button>
                {credOpen && (
                  <div className="p-3 space-y-3">
                    <div>
                      <label className="label">Username</label>
                      <input className="input font-mono opacity-80 cursor-not-allowed" value={usernameInput || 'No username set'} readOnly autoComplete="off" />
                      <p className="text-[10px] text-slate-600 mt-0.5">
                        Admins can view the username, but only the customer setup flow can create or change it.
                      </p>
                    </div>

                    <div>
                      <label className="label">Password</label>
                      {!editingPw ? (
                        <>
                          {/* Existing password is hidden and cannot be read — shown masked. */}
                          <input type="password" readOnly autoComplete="off"
                            value={usernameInput ? 'reset-placeholder' : ''}
                            placeholder={usernameInput ? '' : 'Not registered yet'}
                            className="input font-mono bg-surface-hover/50 text-slate-400 cursor-not-allowed" />
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            The current password is hidden and can’t be read. Press “Reset Password” to set a new one.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start gap-2 text-amber-300 text-[11px] bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-2">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <span>Saving replaces the customer’s password immediately — the old one stops working. Copy and share the new password before closing.</span>
                          </div>
                          {/* New password — visible so the admin can read & share it. Editable. */}
                          <div className="relative">
                            <input type={showPw ? 'text' : 'password'} value={pwInput} autoFocus autoComplete="new-password"
                              onChange={e => { setPwInput(e.target.value); setCredError('') }}
                              placeholder={`At least ${PW_MIN} characters`}
                              className="input font-mono pr-10" />
                            <button type="button" onClick={() => setShowPw(s => !s)}
                              title={showPw ? 'Hide' : 'Show'}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200">
                              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <p className={`text-[10px] ${pwInput && pwInput.length < PW_MIN ? 'text-red-400' : 'text-slate-600'}`}>
                              New password — visible so you can share it. Type your own or regenerate. Minimum {PW_MIN} characters.
                            </p>
                            <button type="button"
                              onClick={() => { setPwInput(generatePassword(PW_MIN)); setShowPw(true); setCredError('') }}
                              className="text-[11px] text-brand-400 hover:text-brand-300">Regenerate</button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      {!editingPw ? (
                        <button type="button" onClick={startPasswordReset} disabled={!usernameInput.trim()}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                          <KeyRound className="w-4 h-4" /> Reset Password
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={resetCustomerPassword}
                            disabled={resetting || pwInput.length < PW_MIN}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Check className="w-4 h-4" /> {resetting ? 'Saving…' : 'Save Password'}
                          </button>
                          <button type="button" onClick={cancelPasswordReset} disabled={resetting}
                            className="btn-ghost text-slate-400">Cancel</button>
                        </>
                      )}
                    </div>

                    {newPassword && (
                      <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 space-y-1">
                        <p className="text-[11px] text-green-300 font-semibold">Password updated — copy it now and share it with the customer:</p>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm text-slate-100 bg-surface-hover px-2 py-1 rounded select-all">{newPassword}</code>
                          <button type="button" onClick={() => navigator.clipboard?.writeText(newPassword)}
                            className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100" title="Copy">
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {credError && (
                      <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />{credError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

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
