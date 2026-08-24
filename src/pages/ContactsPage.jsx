import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Edit2,
  Power,
  X,
  Check,
  AlertCircle,
  Phone,
  Mail,
  MapPin,
  Building,
  UserCheck,
  Handshake,
  ChevronRight,
  KeyRound,
  Copy,
  Eye,
  EyeOff,
  CreditCard,
  UserPlus,
  Package,
  ClipboardList,
  Trash2,
  CalendarCheck,
} from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { contactSettlement } from '../lib/contactVisibility'
import { useAuth } from '../context/AuthContext'
import { generateAccountNumber, ensureUniqueAccountNumber, insertContactWithUniqueCode, formatAccountNumber } from '../lib/accountNumber'
import {
  ensureTrialSubscription, TRIAL_DAYS, reviewSubscriptionAfterTypeChange, RATE_CURRENCY,
} from '../lib/subscriptions'
import { syncLoginRole } from '../lib/contactLogin'
import { formatMobile } from '../lib/phone'
import ContactFormFields, { ACCOUNT_NUMBER_TYPES, CONTACT_ROLES, normalizeOptions } from '../components/contacts/ContactFormFields'
import { CONTACT_EXTRA_FIELDS } from '../lib/contactFields'
import ContactAddresses from '../components/contacts/ContactAddresses'
import ContactSubAccounts from '../components/contacts/ContactSubAccounts'
import ContactPartnerPackages from '../components/contacts/ContactPartnerPackages'
import ContactPartnerOrders from '../components/contacts/ContactPartnerOrders'
import { saveContactAddresses } from '../lib/contactAddresses'
import { loadSubAccounts, saveSubAccounts, ensurePrimarySubAccount } from '../lib/subAccounts'
import SearchField from '../components/ui/SearchField'

/* ── type config ─────────────────────────────────────────── */

// Seed business types; users can add their own (persisted in business_types).
const DEFAULT_BUSINESS_TYPES = ['supermarket', 'grocery', 'bakery', 'restaurant', 'sweets', 'flowers', 'other']

// Every non-driver contact type shares ONE form — the former Partner form
// (Commission %, Business Type, Contact Category). Only the title/icon/colour
// differ per page; the in-form Roles selector lets a contact be Customer,
// Partner, Supplier (or several at once) and be switched between them any time.
// Shared with the quick "add contact" popup in the order form (contactFields.js)
// so both forms stay identical: Commission %, Commission Type, Business Type,
// Contact Category.
const GENERAL_EXTRA_FIELDS = CONTACT_EXTRA_FIELDS.customer

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
  partner_percentage: '', partner_percentage_type: '', shop_type: '', contact_category: '',
}

export default function ContactsPage({ type }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.customer
  const { COMPANY_ID, orders, loadFullOrderHistory, refreshInactiveContacts } = useApp()
  const { currentUser, hasRole } = useAuth()
  const isAdmin = hasRole('super_admin', 'admin')
  const isSuperAdmin = hasRole('super_admin')   // only the super admin may hard-delete a contact
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
  const [checking,  setChecking]  = useState(null)   // settlement check in flight
  const [deactivate, setDeactivate] = useState(null) // { contact, blocked, reasons }
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
  const [notice,       setNotice]       = useState('')   // side-effects of a save, worth saying out loud

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

  // Only admins may view inactive/all; normal users always see active only.
  /* Retired contacts belong to the super admin alone. Everyone else sees the
     active list only — no filter to flip, so a deactivated contact cannot be
     found, opened, or attached to new work. */
  const effFilter = isSuperAdmin ? filter : 'active'
  const visible = contacts.filter(c => {
    /* Name, company, phone, email — and the two numbers people actually quote
       at each other: the contact code (PTN-000004) and the account number.
       Searching by either used to return nothing, which made the code on every
       statement and label useless for finding anyone. */
    const q = search.trim().toLowerCase()
    const matchSearch = !q || [
      `${c.first_name ?? ''} ${c.last_name ?? ''}`,
      c.company_name, c.mobile, c.email, c.code, c.account_number,
    ].some(v => String(v ?? '').toLowerCase().includes(q))
    const matchFilter =
      effFilter === 'all'      ? true :
      effFilter === 'active'   ? c.is_active :
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
    if (usernameInput.trim().length < 3) { setCredError('Enter a username (at least 3 characters) first.'); return }
    const has = !!(modal && modal.username)
    if (!window.confirm(has
      ? '⚠ Reset this customer’s password?\n\n' +
        'A new password will be generated (you can also type your own). When you save it, ' +
        'the customer’s current password will stop working immediately — make sure to share the new one with them.'
      : 'Set a username & password for this customer?\n\n' +
        'A password will be generated (you can also type your own). Share it with the customer after saving.'
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
    const uname = usernameInput.trim()
    const pwd = pwInput
    if (uname.length < 3) { setCredError('Username must be at least 3 characters.'); return }
    if (pwd.length < PW_MIN) { setCredError(`Password must be at least ${PW_MIN} characters.`); return }
    setResetting(true); setCredError(''); setNewPassword('')
    try {
      // Sets BOTH username and password (create or change) for any contact type.
      const { data, error: e } = await supabase.rpc('admin_set_contact_credentials', {
        p_contact_id:   modal.id,
        p_username:     uname,
        p_new_password: pwd,
      })
      if (e) throw e
      const username = data?.[0]?.username
      setNewPassword(pwd)            // confirm what was set (copyable, shown once)
      setPwInput(''); setShowPw(false); setEditingPw(false)
      if (username) { setUsernameInput(username); setForm(f => ({ ...f, username })) }

      /* The login exists now, so the free period starts now. Issued once: a
         later password reset finds a subscription already on file and leaves
         it alone, rather than handing out another ninety days. */
      const types = Array.isArray(modal.contact_types) && modal.contact_types.length
        ? modal.contact_types
        : (modal.contact_type ? [modal.contact_type] : [])
      const trial = await ensureTrialSubscription(modal.id, types, {
        companyId: COMPANY_ID, userId: currentUser?.user_id || null,
      })
      if (trial.created) {
        setNotice(`Login created — a free ${TRIAL_DAYS}-day subscription starts today. `
          + 'Renewals are entered by the super admin under Settings → Subscriptions.')
      } else if (trial.error) {
        console.warn('Could not issue the free subscription:', trial.error)
      }
    } catch (e) {
      const msg = e?.message || String(e)
      setCredError(
        /USERNAME_TAKEN/i.test(msg)      ? 'That username is already used by another contact.'
        : /USERNAME_TOO_SHORT/i.test(msg) ? 'Username must be at least 3 characters.'
        : /PASSWORD_TOO_SHORT/i.test(msg) ? `Password must be at least ${PW_MIN} characters.`
        : /admin_set_contact_credentials/i.test(msg) ? 'Contact credential setup isn’t installed yet — run supabase-fix97.sql.'
        : msg)
    } finally {
      setResetting(false)
    }
  }

  /* Super admin: remove a contact's login entirely (clears username + password). */
  async function removeLogin() {
    if (!isSuperAdmin || !modal || modal === 'add') return
    if (!window.confirm(
      '⚠ Remove this contact’s login?\n\n' +
      'Their username and password will be deleted and they will no longer be able to sign in. This cannot be undone (you can set a new login afterwards).'
    )) return
    setResetting(true); setCredError(''); setNewPassword('')
    try {
      const { error: e } = await supabase.rpc('admin_clear_contact_credentials', { p_contact_id: modal.id })
      if (e) throw e
      setUsernameInput(''); setPwInput(''); setShowPw(false); setEditingPw(false)
      setForm(f => ({ ...f, username: '' }))
    } catch (e) {
      const msg = e?.message || String(e)
      setCredError(/admin_clear_contact_credentials/i.test(msg) ? 'Contact credential setup isn’t installed yet — run supabase-fix97.sql.' : msg)
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
      partner_percentage_type: form.partner_percentage_type?.trim() || null,
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

    /* No trial here any more. A subscription exists to let somebody sign in,
       and at this point nobody can: the login is created separately, and that
       is where the free period now begins (fix136). */

    /* The login's role follows the contact's roles. They are separate records —
       the portal reads the login — so a partner retagged as a supplier would
       otherwise keep signing in as a partner, without the supplier pages. */
    const roleSync = await syncLoginRole(contactId, selectedTypes, {
      actorId: currentUser?.user_id || null,
    })
    if (roleSync.error) console.warn('Could not update the login role:', roleSync.error)

    /* A partner promoted to supplier is billed at the supplier rate. The
       difference for whatever is left of their period is added to the
       subscription and it goes unpaid, which closes their portal until the
       money is confirmed — checked here AND at every sign-in, so neither the
       party nor the admin who made the change can leave it unsettled. */
    const rolesChanged = modal !== 'add'
      && JSON.stringify([...(modal.contact_types || [])].sort()) !== JSON.stringify([...selectedTypes].sort())
    const review = rolesChanged
      ? await reviewSubscriptionAfterTypeChange(contactId, { userId: currentUser?.user_id || null })
      : { changed: false, none: false, error: null }
    if (review.error) console.warn('Could not review the subscription:', review.error)

    setNotice([
      roleSync.changed
        ? `Their login now signs in as ${roleSync.to} (was ${roleSync.from}). They will see the change the next time the app starts.`
        : '',
      review.changed
        ? `Subscription upgraded: ${review.from.toFixed(2)} → ${review.to.toFixed(2)} ${RATE_CURRENCY}/month. `
          + `${review.due.toFixed(2)} ${RATE_CURRENCY} is due for the remaining ${review.days} day${review.days === 1 ? '' : 's'}, `
          + 'and their portal stays closed until the super admin confirms the payment on Settings → Subscriptions.'
        : '',
      review.none
        ? 'This contact now needs a subscription and holds none — they cannot sign in until the super admin creates one.'
        : '',
    ].filter(Boolean).join(' '))

    // Saved successfully → close immediately, then refresh the list in the background.
    setSaving(false); closeModal()
    fetchContacts()
  }

  /* Deactivating hides a contact from everyone but the super admin — its orders
     included — so it has to be settled first. Retiring a contact that is still
     owed money, or still owes us, would bury the debt where the office cannot
     see it. Reactivating needs no check: nothing is being hidden. */
  const contactDisplayName = (c) =>
    c?.company_name?.trim() || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || 'this contact'

  async function toggleActive(c) {
    if (c.is_active) {
      setChecking(c.id)
      // Balances span the whole history, not the startup window.
      await loadFullOrderHistory?.()
      const { data: payouts } = await supabase.from('partner_payouts').select('partner_id, amount, currency')
      const result = await contactSettlement(c.id, { orders, payouts: payouts ?? [] })
      setChecking(null)
      setDeactivate({ contact: c, ...result })
      return
    }
    setToggling(c.id)
    await supabase.from('contacts').update({ is_active: true }).eq('id', c.id)
    await fetchContacts(); refreshInactiveContacts?.()
    setToggling(null)
  }

  /* Confirmed from the dialog — only reachable when nothing is outstanding. */
  async function confirmDeactivate() {
    const c = deactivate?.contact
    if (!c || deactivate.blocked) return
    setToggling(c.id)
    await supabase.from('contacts').update({ is_active: false }).eq('id', c.id)
    await fetchContacts(); refreshInactiveContacts?.()
    setToggling(null); setDeactivate(null)
  }

  /* Super-admin hard delete — only offered for already-deactivated contacts. If the
     contact is still referenced (orders, packages, invoices, accounts), the DB
     rejects the delete and the error is surfaced rather than silently failing. */
  async function deleteContact(c) {
    if (!isSuperAdmin || c.is_active) return
    const name = contactDisplayName(c)
    if (!window.confirm(`Permanently delete “${name}”?\n\nThis cannot be undone. It will fail if the contact is still linked to any orders or records.`)) return
    setToggling(c.id)
    const { error: err } = await supabase.from('contacts').delete().eq('id', c.id)
    setToggling(null)
    if (err) {
      window.alert(/foreign key|violates|referenced/i.test(err.message)
        ? `Can’t delete “${name}” — it’s still linked to orders or other records.`
        : `Could not delete “${name}”: ${err.message}`)
      return
    }
    fetchContacts()
  }

  const { Icon, title, color, bg } = cfg

  // Entity type (Individual / Company) of the open form — used by the save button.
  const isCompany = form.entity_type === 'company'

  // The "Packages" tab lists everything this partner has shipped through us, so it
  // only makes sense for a saved contact that actually holds the Partner role.
  const isSaved       = modal && modal !== 'add'
  const holdsPartner  = (form.contact_types || []).includes('partner')
  // Shown on the partner-only tabs (Packages / Orders) and in their PDFs.
  const partnerLabel  = form.company_name?.trim()
    || `${form.first_name ?? ''} ${form.last_name ?? ''}`.trim() || 'Partner'
  const contactTabs   = (isSaved && holdsPartner)
    ? [...CONTACT_TABS,
       { value: 'packages', label: 'Packages', Icon: Package },
       { value: 'orders',   label: 'Orders',   Icon: ClipboardList }]
    : CONTACT_TABS
  // If the open tab is no longer available (e.g. the Partner role was toggled off
  // while viewing Packages), fall back to Details so the pane never goes blank.
  const activeTab = contactTabs.some(t => t.value === tab) ? tab : 'details'

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

      {/* Something the save did on its own — currently the login role following
          the contact's roles. Dismissible; it is news, not an error. */}
      {notice && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-brand-500/10 border border-brand-500/30 rounded-lg">
          <KeyRound className="w-4 h-4 text-brand-300 flex-shrink-0 mt-0.5" />
          <p className="text-brand-200 text-xs leading-relaxed flex-1">{notice}</p>
          <button onClick={() => setNotice('')} className="text-slate-400 hover:text-slate-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${bg}`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mt-0.5">{contacts.length} total</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}…`}
            className="input pl-9"
          />
        </div>

        {/* Active / inactive / all — the super admin alone. A retired contact is
            invisible to everyone else, so there is nothing for them to filter. */}
        {isSuperAdmin && (
          <div className="flex items-center gap-1">
            {['active', 'inactive', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                  filter === f ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
                }`}>{f}</button>
            ))}
          </div>
        )}

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
                {cfg.extraFields.map(ef => {
                  const raw = c[ef.key]
                  // Selects may carry {value,label} options — show the label.
                  const shown = ef.type === 'select'
                    ? normalizeOptions(ef.options).find(o => o.value === raw)?.label ?? raw
                    : raw
                  return (
                    <td key={ef.key} className="px-4 py-3 text-slate-400 text-xs">
                      {shown || <span className="text-slate-600">—</span>}
                    </td>
                  )
                })}

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
                    {isSuperAdmin && !c.is_active && (
                      <button onClick={() => deleteContact(c)} disabled={toggling === c.id}
                        title="Delete permanently (super admin)"
                        className="btn-ghost p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
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
          {/* Width follows the CONTACT rather than the open tab: a partner has
              the wide Packages/Orders tabs, so its form stays wide throughout —
              the tab bar then reads the same on every pane instead of the modal
              resizing as you switch. */}
          <div className={`card w-full p-6 space-y-4 overflow-y-auto max-h-[90vh] transition-[max-width] duration-200 ${
            ['packages', 'orders'].includes(activeTab) ? 'max-w-6xl'
              : (isSaved && holdsPartner) ? 'max-w-3xl' : 'max-w-lg'}`}>
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
            <div className="flex items-center gap-1 border-b border-surface-border -mx-6 px-6 overflow-x-auto">
              {contactTabs.map(t => (
                <button key={t.value} type="button" onClick={() => setTab(t.value)}
                  className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 ${
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

            {activeTab === 'details' && (
              <ContactFormFields
                type={type}
                form={form}
                setField={fld}
                mode={modal === 'add' ? 'add' : 'edit'}
                extraFields={formExtraFields}
                showRoles
              />
            )}

            {activeTab === 'addresses' && (
              <ContactAddresses addresses={addresses} setAddresses={setAddresses} />
            )}

            {activeTab === 'accounts' && (
              <ContactSubAccounts
                accounts={accounts}
                setAccounts={setAccounts}
                contactType={cfg.contactType}
              />
            )}

            {activeTab === 'packages' && isSaved && (
              <ContactPartnerPackages
                contactId={modal.id}
                contactName={partnerLabel}
                accountNumber={form.account_number || modal.account_number || ''}
              />
            )}

            {activeTab === 'orders' && isSaved && (
              <ContactPartnerOrders
                contactId={modal.id}
                contactName={partnerLabel}
                accountNumber={form.account_number || modal.account_number || ''}
              />
            )}

            {/* Login access — suppliers & partners may be given a user account. */}
            {activeTab === 'details' && isAdmin && loginRole && (
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

            {/* The free introductory period, announced before it is issued — a 2nd
                party cannot sign in without a subscription, so this is part of
                creating them, not a surprise found later. */}
            {activeTab === 'details' && modal === 'add' && loginRole && (
              <div className="border border-green-500/30 bg-green-500/5 rounded-lg p-3 flex items-start gap-2.5">
                <CalendarCheck className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <span className="text-green-300 font-medium">Free {TRIAL_DAYS}-day subscription.</span>{' '}
                  Saving this {loginRole} issues one automatically, starting today, so they can sign in
                  right away. Renewals after that are entered by the super admin under
                  <span className="text-slate-300"> Settings → Subscriptions</span>.
                </p>
              </div>
            )}

            {/* Contact user account & security — collapsible, admin only (any type) */}
            {activeTab === 'details' && modal !== 'add' && isAdmin && (
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
                      <input className="input font-mono" value={usernameInput}
                        onChange={e => { setUsernameInput(e.target.value); setCredError('') }}
                        placeholder="Set a username (min 3 characters)" autoComplete="off" />
                      <p className="text-[10px] text-slate-600 mt-0.5">
                        Set or change this contact’s username here (must be unique across all contacts).
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
                        <>
                        <button type="button" onClick={startPasswordReset} disabled={usernameInput.trim().length < 3}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                          <KeyRound className="w-4 h-4" /> {modal.username ? 'Reset Password' : 'Set Username & Password'}
                        </button>
                        {isSuperAdmin && modal.username && (
                          <button type="button" onClick={removeLogin} disabled={resetting}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Trash2 className="w-4 h-4" /> Remove Login
                          </button>
                        )}
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={resetCustomerPassword}
                            disabled={resetting || pwInput.length < PW_MIN}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Check className="w-4 h-4" /> {resetting ? 'Saving…' : 'Save Credentials'}
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

      {/* ── Deactivating a contact ──────────────────────────────────────
          Refused while anything is outstanding: a retired contact disappears
          for every user but the super admin, taking its orders with it, so a
          debt hidden this way would never be chased. */}
      {deactivate && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
          <div className="card w-full max-w-lg p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                deactivate.blocked ? 'bg-red-500/10 border border-red-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                <AlertCircle className={`w-4 h-4 ${deactivate.blocked ? 'text-red-400' : 'text-amber-400'}`} />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-100">
                  {deactivate.blocked ? 'Cannot deactivate yet' : 'Deactivate this contact?'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {contactDisplayName(deactivate.contact)}
                  {deactivate.contact?.code ? ` · ${deactivate.contact.code}` : ''}
                </p>
              </div>
            </div>

            {deactivate.blocked ? (
              <>
                <p className="text-xs text-slate-300">
                  Settle these first — everything below must be closed or paid before the contact can be retired:
                </p>
                <div className="space-y-2">
                  {deactivate.reasons.map(r => (
                    <div key={r.key} className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                      <p className="text-xs font-semibold text-red-200">{r.label}</p>
                      {r.detail && <p className="text-[11px] text-slate-400 mt-0.5 break-words">{r.detail}</p>}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-green-300">Nothing is outstanding — no open orders, no dues, no balance.</p>
                <p className="text-xs text-slate-400">
                  Once deactivated, this contact and its orders are hidden from admins and users everywhere in
                  the application, including every dropdown. Only a super admin will still see them. Stock
                  movements keep showing the contact, so the inventory history and its totals stay correct.
                </p>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDeactivate(null)}
                className="btn-ghost px-4 py-2 text-sm border border-surface-border">
                {deactivate.blocked ? 'Close' : 'Cancel'}
              </button>
              {!deactivate.blocked && (
                <button onClick={confirmDeactivate} disabled={toggling === deactivate.contact?.id}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                  Deactivate
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
