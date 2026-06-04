import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Search, Filter, X, Check, Trash2,
  Edit2, Power, AlertCircle, Package, RotateCcw, RotateCw,
  Phone, Mail, MapPin, UserCheck, UserPlus, Wallet, Calendar, Truck, Lock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { generateCustomerAccountNumber, formatAccountNumber } from '../lib/accountNumber'
import Badge from '../components/ui/Badge'
import ContactFormFields from '../components/contacts/ContactFormFields'
import ContactAddresses from '../components/contacts/ContactAddresses'
import { saveContactAddresses } from '../lib/contactAddresses'
import OrderPackages from '../components/orders/OrderPackages'
import { saveOrderPackages } from '../lib/orderPackages'

/* ── constants ───────────────────────────────────────────── */

// Order lifecycle status (stored values + display labels)
const ORDER_STATUS_OPTIONS = [
  { value: 'scheduled',   label: 'Scheduled' },
  { value: 'confirmed',   label: 'Confirmed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed' },
]
// Business/merchant category of the order
const ORDER_TYPES = [
  { value: 'restaurant',  label: 'Restaurant' },
  { value: 'supermarket', label: 'Supermarket' },
  { value: 'taxi',        label: 'Taxi' },
  { value: 'sweets',      label: 'Sweets' },
  { value: 'flowers',     label: 'Flowers' },
  { value: 'bakery',      label: 'Bakery' },
]
// Physical delivery progress of the materials
const DELIVERY_STATUSES = ['Awaiting Pickup', 'Picked Up', 'In Transit', 'Delivered']
// Money collection state (derived from payments)
const COLLECTION_FULL    = 'Money Fully collected'
const COLLECTION_PARTIAL = 'Money partially collected'
const COLLECTION_DUE     = 'Money is due'

const STATUS_FILTERS   = ['all','scheduled','confirmed','in_progress','completed','cancelled']
const CURRENCIES       = ['USD', 'LBP', 'EUR']

// Map legacy/enum order statuses onto the four-step lifecycle for display & filtering.
function normalizeStatus(s) {
  if (['scheduled', 'confirmed', 'in_progress', 'completed'].includes(s)) return s
  if (s === 'pending') return 'scheduled'
  if (['assigned', 'picked_up', 'in_transit', 'return_requested'].includes(s)) return 'in_progress'
  if (['delivered', 'returned'].includes(s)) return 'completed'
  return s   // cancelled, failed, or anything unknown → leave as-is
}

// The `status` column is the order_status enum, which has no scheduled/in_progress/completed
// values, so map the lifecycle labels back to valid enum values before writing.
function toDbStatus(uiStatus) {
  return ({
    scheduled:   'pending',
    confirmed:   'confirmed',
    in_progress: 'in_transit',
    completed:   'delivered',
  })[uiStatus] || uiStatus
}

// Money collection label derived from a payment_status (unpaid/partial/full).
function collectionFromPayStatus(payStatus) {
  if (payStatus === 'paid_to_office') return COLLECTION_FULL
  if (payStatus === 'partially_paid') return COLLECTION_PARTIAL
  return COLLECTION_DUE
}

const BASE_FORM = {
  recipient_name: '', recipient_mobile: '', recipient_whatsapp: '',
  customer_id: '', main_account: '', pickup_address: '', delivery_address: '',
  delivery_zone_id: '', driver_id: '',
  status: 'scheduled', delivery_status: 'Awaiting Pickup', payment_status: 'unpaid',
  delivery_fee: '', currency: 'USD',
  discount_amount: '0', discount_currency: 'USD', vat_amount: '0',
  order_type: '', order_details_text: '', special_instructions: '',
  scheduled_date: '', scheduled_time_from: '', scheduled_time_to: '',
}

function fmt2(n) { return String(n).padStart(2, '0') }
function timeStr(d) { return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}` }

function getEmptyForm() {
  const now      = new Date()
  const plusHour = new Date(now.getTime() + 60 * 60 * 1000)
  return {
    ...BASE_FORM,
    scheduled_date:      now.toISOString().slice(0, 10),
    scheduled_time_from: timeStr(now),
    scheduled_time_to:   timeStr(plusHour),
  }
}

function adjustTime(t, deltaMinutes) {
  if (!t) return t
  const [h, m] = t.split(':').map(Number)
  const total  = ((h * 60 + m + deltaMinutes) % (24 * 60) + 24 * 60) % (24 * 60)
  return `${fmt2(Math.floor(total / 60))}:${fmt2(total % 60)}`
}

const EMPTY_ITEM = { product_id: '', quantity: 1, unit_price: 0, currency: 'USD', discount: 0 }

const EMPTY_CUSTOMER = {
  entity_type: 'individual',
  company_name: '', commercial_registration: '',
  first_name: '', last_name: '', mobile: '', whatsapp_number: '',
  email: '', city: '', address: '', notes: '', account_number: '',
}

function customerName(c) {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
}

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'card',          label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'other',         label: 'Other' },
]

// payment_collections only has USD/LBP columns, so payments are limited to these.
const PAYMENT_CURRENCIES = ['USD', 'LBP']

const EMPTY_PAYMENT = { method: 'cash', amount: '', currency: 'USD', paid_at: '', notes: '' }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

/* Sum payments grouped by currency → { USD, LBP, EUR }. */
function paidByCurrency(payments) {
  const t = { USD: 0, LBP: 0, EUR: 0 }
  for (const p of payments) t[p.currency || 'USD'] += Number(p.amount) || 0
  return t
}

/* Derive an order's payment_status from amounts paid vs the order totals, per currency.
   Per spec: nothing paid → unpaid, every currency with a balance covered → paid_to_office,
   anything in between → partially_paid. */
function derivePaymentStatus(paidByCur, totalsByCur) {
  const anyOrder = CURRENCIES.some(c => round2(totalsByCur[c]) > 0)
  const anyPaid  = CURRENCIES.some(c => round2(paidByCur[c]) > 0)
  if (!anyOrder || !anyPaid) return 'unpaid'
  const fullyCovered = CURRENCIES.every(c => round2(totalsByCur[c]) <= 0 || round2(paidByCur[c]) >= round2(totalsByCur[c]))
  return fullyCovered ? 'paid_to_office' : 'partially_paid'
}

/* ── time UI components ──────────────────────────────────── */

function AdjBtn({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="px-2.5 py-2 rounded-lg flex-shrink-0
                 bg-surface-hover border border-surface-border
                 text-slate-400 text-xs font-medium
                 hover:text-slate-100 hover:bg-surface-border
                 transition-colors duration-150 select-none">
      {children}
    </button>
  )
}

function TimeField({ label, value, onChange, leftButtons, rightButtons }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-1.5">
        {(leftButtons ?? []).map(([d, lbl]) => (
          <AdjBtn key={lbl} onClick={() => onChange(adjustTime(value, d))}>
            {d === -10
              ? <span className="relative inline-flex items-center justify-center w-5 h-5">
                  <RotateCcw className="w-full h-full" />
                  <span className="absolute text-[7px] font-black leading-none mt-0.5">10</span>
                </span>
              : lbl}
          </AdjBtn>
        ))}
        <input type="time" className="input flex-1 min-w-0" value={value}
          onChange={e => onChange(e.target.value)} />
        {(rightButtons ?? []).map(([d, lbl]) => (
          <AdjBtn key={lbl} onClick={() => onChange(adjustTime(value, d))}>
            {d === 10
              ? <span className="relative inline-flex items-center justify-center w-5 h-5">
                  <RotateCw className="w-full h-full" />
                  <span className="absolute text-[7px] font-black leading-none mt-0.5">10</span>
                </span>
              : lbl}
          </AdjBtn>
        ))}
      </div>
    </div>
  )
}

/* ── helpers ─────────────────────────────────────────────── */

function lineTotal(it) {
  return Math.max(0, (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) - (Number(it.discount) || 0))
}

function calcTotals(items, deliveryFee, feeCurrency, discount, vat, discountCurrency = feeCurrency) {
  const t = { USD: 0, LBP: 0, EUR: 0 }
  // Per-item line totals already apply each item's own discount in its currency.
  for (const it of items) t[it.currency || 'USD'] += lineTotal(it)
  t[feeCurrency]      += Number(deliveryFee) || 0
  t[discountCurrency] -= Number(discount)    || 0
  t[feeCurrency]      += Number(vat)         || 0
  return t
}

function SectionLabel({ children }) {
  return <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">{children}</p>
}

/* Per-currency total of a saved order, from its line items + fee/discount/vat. */
function orderTotalsByCurrency(o) {
  const t = {}
  const active = (o.order_items ?? []).filter(it => !it.is_deleted)
  for (const it of active) {
    const c = it.currency || 'USD'
    t[c] = (t[c] || 0) + Number(it.line_total || 0)
  }
  const discountCur = o.discount_currency || o.currency
  if (Number(o.delivery_fee) > 0)    t[o.currency]   = (t[o.currency]   || 0) + Number(o.delivery_fee)
  if (Number(o.discount_amount) > 0) t[discountCur]  = (t[discountCur]  || 0) - Number(o.discount_amount)
  if (Number(o.vat_amount) > 0)      t[o.currency]   = (t[o.currency]   || 0) + Number(o.vat_amount)
  return t
}

function fmtMoney(n, cur) { return Number(n || 0).toFixed(cur === 'LBP' ? 0 : 2) }

/* ── page ─────────────────────────────────────────────────── */

export default function DeliveriesPage({ closed = false }) {
  const { orders, drivers, zones, fetchOrders, loading, COMPANY_ID } = useApp()
  const { currentUser } = useAuth()

  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [modal,     setModal]     = useState(null)
  const [form,      setForm]      = useState(BASE_FORM)
  const [items,     setItems]     = useState([])
  const [packages,       setPackages]       = useState([])
  const [origPackageIds, setOrigPackageIds] = useState([])
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [copied,    setCopied]    = useState(null)
  const [toggling,  setToggling]  = useState(null)
  const [customers,          setCustomers]          = useState([])
  const [products,           setProducts]           = useState([])
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [customerSearch,     setCustomerSearch]     = useState('')
  const [customerInput,        setCustomerInput]        = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [newCustomerOpen,      setNewCustomerOpen]      = useState(false)
  const [newCustomer,          setNewCustomer]          = useState(EMPTY_CUSTOMER)
  const [custAddresses,        setCustAddresses]        = useState([])
  const [savingCustomer,       setSavingCustomer]       = useState(false)
  const [customerError,        setCustomerError]        = useState('')
  const [payments,             setPayments]             = useState([])
  const [origPaymentIds,       setOrigPaymentIds]       = useState([])
  const [driverFilter,         setDriverFilter]         = useState('')
  const [customerFilter,       setCustomerFilter]       = useState('')
  const [dateFrom,             setDateFrom]             = useState('')
  const [dateTo,               setDateTo]               = useState('')
  const [pendingsOpen,         setPendingsOpen]         = useState(false)
  const [popover,              setPopover]              = useState(null)   // { type:'driver'|'status', order, x, y }
  const [driverQuickSearch,    setDriverQuickSearch]    = useState('')
  const [quickBusy,            setQuickBusy]            = useState(false)

  /* ── lookups ─────────────────────────────────────────────── */

  const fetchLookups = useCallback(async () => {
    // A delivery can be for any contact, so the picker includes customers,
    // partners and suppliers.
    const [{ data: custs }, { data: prods }] = await Promise.all([
      supabase.from('contacts')
        .select('id,first_name,last_name,mobile,whatsapp_number,email,city,address,contact_type,company_name,code,account_number')
        .in('contact_type', ['customer', 'partner', 'supplier']),
      supabase.from('products').select('id,name,code,unit_price,currency').eq('is_active', true),
    ])
    setCustomers(custs ?? [])
    setProducts(prods  ?? [])
  }, [])

  useEffect(() => { fetchLookups() }, [fetchLookups])

  /* ── filter ──────────────────────────────────────────────── */

  function matchScheduledDate(o) {
    if (!dateFrom && !dateTo) return true
    const sd = o.scheduled_date ? o.scheduled_date.slice(0, 10) : ''
    if (!sd) return false                              // no date → excluded once a date filter is set
    if (dateFrom && dateTo) return sd >= dateFrom && sd <= dateTo  // between two dates (inclusive)
    if (dateFrom)           return sd === dateFrom     // single scheduled date
    return sd <= dateTo
  }

  const filtered = orders.filter(o => {
    // Closed orders live on their own page; the daily Orders page excludes them.
    const matchClosed = closed ? o.isclosed === true : o.isclosed !== true
    const matchSearch = (
      o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
      o.recipient_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.recipient_mobile?.includes(search) ||
      o.delivery_address?.toLowerCase().includes(search.toLowerCase())
    )
    return matchClosed && matchSearch
      && (filter === 'all' || normalizeStatus(o.status) === filter)
      && (!driverFilter   || o.driver_id   === driverFilter)
      && (!customerFilter || o.customer_id === customerFilter)
      && matchScheduledDate(o)
  })

  const hasAdvancedFilters = driverFilter || customerFilter || dateFrom || dateTo
  function clearAdvancedFilters() {
    setDriverFilter(''); setCustomerFilter(''); setDateFrom(''); setDateTo('')
  }

  /* Aggregate the filtered orders into per-currency totals for the pendings popup. */
  const pendingsSummary = (() => {
    const cur = { USD: { order: 0, paid: 0 }, LBP: { order: 0, paid: 0 }, EUR: { order: 0, paid: 0 } }
    for (const o of filtered) {
      const tt = orderTotalsByCurrency(o)
      for (const c of CURRENCIES) cur[c].order += (tt[c] || 0)
      cur.USD.paid += Number(o.collected_usd) || 0
      cur.LBP.paid += Number(o.collected_lbp) || 0
    }
    const rows = CURRENCIES
      .map(c => ({ cur: c, order: round2(cur[c].order), paid: round2(cur[c].paid) }))
      .filter(r => r.order !== 0 || r.paid !== 0)
      .map(r => ({ ...r, pending: round2(r.order - r.paid) }))
    return { count: filtered.length, rows }
  })()

  /* ── modal handlers ──────────────────────────────────────── */

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })); setError('') }

  /* Fill the order's customer-related fields from a customer record.
     For a partner the order is placed on behalf of the partner company, so the
     company name goes in the customer box and the recipient (the end customer)
     is left blank to be entered manually. The main_account is always taken from
     the contact's account_number (read-only on the form). */
  function applyCustomer(c) {
    const isPartner   = c.contact_type === 'partner'
    const displayName = isPartner ? (c.company_name || customerName(c)) : customerName(c)
    setForm(f => ({
      ...f,
      customer_id:        c.id,
      main_account:       c.account_number ?? '',
      recipient_name:     isPartner ? '' : (customerName(c) || f.recipient_name),
      recipient_mobile:   isPartner ? '' : (c.mobile ?? f.recipient_mobile),
      recipient_whatsapp: isPartner ? '' : (c.whatsapp_number ?? c.mobile ?? f.recipient_whatsapp),
      delivery_address:   c.address ?? f.delivery_address,
    }))
    setCustomerInput(displayName)
    setCustomerDropdownOpen(false)
    setError('')
  }

  function handleCustomerChange(id) {
    const c = customers.find(x => x.id === id)
    if (c) applyCustomer(c)
  }

  /* Open the quick "new customer" modal, pre-filling from what's typed so far. */
  function openNewCustomer(seedName = customerInput) {
    const parts = (seedName ?? '').trim().split(/\s+/).filter(Boolean)
    setNewCustomer({
      ...EMPTY_CUSTOMER,
      first_name:      parts[0] ?? '',
      last_name:       parts.slice(1).join(' '),
      mobile:          form.recipient_mobile   || '',
      whatsapp_number: form.recipient_whatsapp || '',
      address:         form.delivery_address   || '',
    })
    setCustAddresses([])
    setCustomerError('')
    setCustomerDropdownOpen(false)
    setNewCustomerOpen(true)
    // Generate the account number and fill the field
    generateCustomerAccountNumber()
      .then(acct => setNewCustomer(c => ({ ...c, account_number: acct })))
      .catch(() => {})
  }

  function setNewCust(k, v) { setNewCustomer(c => ({ ...c, [k]: v })); setCustomerError('') }

  async function saveNewCustomer() {
    const isCompany = newCustomer.entity_type === 'company'
    if (isCompany && !newCustomer.company_name.trim()) return setCustomerError('Company name is required.')
    if (!newCustomer.first_name.trim()) return setCustomerError(`${isCompany ? 'Contact first' : 'First'} name is required.`)
    if (!newCustomer.last_name.trim())  return setCustomerError(`${isCompany ? 'Contact last' : 'Last'} name is required.`)
    if (!newCustomer.mobile.trim())     return setCustomerError('Mobile number is required.')

    setSavingCustomer(true); setCustomerError('')

    // Ensure an account number is generated before saving.
    let accountNumber = newCustomer.account_number
    if (!accountNumber) {
      try { accountNumber = await generateCustomerAccountNumber() } catch { /* leave blank */ }
    }

    const payload = {
      contact_type:    'customer',
      // Company-only columns are sent only for companies, so individuals don't
      // depend on the entity_type/company_name/commercial_registration columns.
      ...(isCompany ? {
        entity_type:             'company',
        company_name:            newCustomer.company_name.trim(),
        commercial_registration: newCustomer.commercial_registration?.trim() || null,
      } : {}),
      first_name:      newCustomer.first_name.trim(),
      last_name:       newCustomer.last_name.trim(),
      mobile:          newCustomer.mobile.trim(),
      whatsapp_number: newCustomer.whatsapp_number?.trim() || null,
      email:           newCustomer.email?.trim()           || null,
      city:            newCustomer.city?.trim()            || null,
      address:         newCustomer.address?.trim()         || null,
      notes:           newCustomer.notes?.trim()           || null,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      branch_id:      currentUser?.branch_id || null,
      created_by:     currentUser?.user_id   || null,
      account_number: accountNumber || null,
    }
    const { data, error: e } = await supabase
      .from('contacts')
      .insert([payload])
      .select('id,first_name,last_name,mobile,whatsapp_number,email,city,address,account_number')
      .single()
    if (e) { setCustomerError(e.message); setSavingCustomer(false); return }

    const addrErr = await saveContactAddresses({
      contactId: data.id, addresses: custAddresses, origIds: [],
      companyId: COMPANY_ID, userId: currentUser?.user_id || null,
    })
    if (addrErr) { setCustomerError(addrErr); setSavingCustomer(false); return }

    setCustomers(prev => [...prev, data])
    applyCustomer(data)
    setNewCustomerOpen(false)
    setSavingCustomer(false)
  }

  function openAdd() {
    setForm(getEmptyForm()); setItems([]); setPayments([]); setOrigPaymentIds([])
    setPackages([]); setOrigPackageIds([])
    setCustomerInput(''); setError(''); setModal('add')
  }

  async function openEdit(o) {
    setForm({
      ...BASE_FORM, ...o,
      status:           normalizeStatus(o.status),
      delivery_status:  o.delivery_status   ?? 'Awaiting Pickup',
      driver_id:        o.driver_id        ?? '',
      delivery_zone_id: o.delivery_zone_id ?? '',
      customer_id:      o.customer_id      ?? '',
      delivery_fee:     o.delivery_fee     ?? '',
      discount_amount:  o.discount_amount  ?? '0',
      discount_currency: o.discount_currency || o.currency || 'USD',
      vat_amount:       o.vat_amount       ?? '0',
    })
    const { data } = await supabase
      .from('order_items')
      .select('*, product:products(id,name,code)')
      .eq('order_id', o.id)
      .eq('is_deleted', false)
    setItems((data ?? []).map(it => ({
      _id:        it.id,
      product_id: it.product_id ?? '',
      quantity:   it.quantity,
      unit_price: it.unit_price,
      currency:   it.currency ?? 'USD',
      discount:   it.discount ?? 0,
    })))
    const { data: payData } = await supabase
      .from('payment_collections')
      .select('id,collection_type,amount_usd,amount_lbp,collected_at,notes')
      .eq('order_id', o.id)
      .order('collected_at')
    const mappedPayments = (payData ?? []).map(pc => {
      const lbp = Number(pc.amount_lbp) || 0
      const usd = Number(pc.amount_usd) || 0
      return {
        _id:      pc.id,
        method:   pc.collection_type || 'cash',
        currency: lbp > 0 ? 'LBP' : 'USD',
        amount:   round2(lbp > 0 ? lbp : usd) || '',
        paid_at:  pc.collected_at ? pc.collected_at.slice(0, 10) : '',
        notes:    pc.notes ?? '',
      }
    })
    setPayments(mappedPayments)
    setOrigPaymentIds(mappedPayments.map(p => p._id))

    const { data: pkgData } = await supabase
      .from('delivery_packages')
      .select('*')
      .eq('order_id', o.id)
      .order('created_at')
    const mappedPackages = (pkgData ?? []).map(pk => ({
      _id:             pk.id,
      tracking_number: pk.tracking_number ?? '',
      category:        pk.category ?? '',
      type:            pk.type ?? '',
      package_size:    pk.package_size ?? '',
      handling:        pk.handling ?? 'regular',
      vehicle_type:    pk.vehicle_type ?? '',
      quantity:        pk.quantity ?? 1,
      weight_kg:       pk.weight_kg ?? '',
      description:     pk.description ?? '',
      base_price:      pk.base_price ?? '',
      package_price:   pk.package_price ?? '',
      paid:            !!pk.paid,
      payment_type:    pk.payment_type ?? '',
    }))
    setPackages(mappedPackages)
    setOrigPackageIds(mappedPackages.map(p => p._id))

    const existing = customers.find(x => x.id === o.customer_id) || o.customer
    setCustomerInput(
      existing
        ? (existing.contact_type === 'partner' ? (existing.company_name || customerName(existing)) : customerName(existing))
        : ''
    )
    setError(''); setModal(o)
  }

  function closeModal() {
    setModal(null); setItems([]); setPayments([]); setOrigPaymentIds([]); setError('')
    setPackages([]); setOrigPackageIds([])
    setCustomerInput(''); setCustomerDropdownOpen(false)
  }

  /* ── payments helpers ────────────────────────────────────── */

  function addPayment() {
    const defCur = form.currency === 'LBP' ? 'LBP' : 'USD'
    setPayments(p => [...p, { ...EMPTY_PAYMENT, currency: defCur, paid_at: new Date().toISOString().slice(0, 10), _key: Date.now() }])
  }
  function removePayment(i) { setPayments(p => p.filter((_, idx) => idx !== i)) }
  function setPayment(i, k, v) {
    setPayments(p => { const next = [...p]; next[i] = { ...next[i], [k]: v }; return next })
  }

  /* ── items helpers ───────────────────────────────────────── */

  function addItem() { setItems(p => [...p, { ...EMPTY_ITEM, _key: Date.now() }]) }
  function removeItem(i) { setItems(p => p.filter((_, idx) => idx !== i)) }

  function setItem(i, k, v) {
    setItems(p => {
      const next = [...p]
      next[i] = { ...next[i], [k]: v }
      if (k === 'product_id') {
        const prod = products.find(x => x.id === v)
        if (prod) { next[i].unit_price = prod.unit_price ?? 0; next[i].currency = prod.currency ?? 'USD' }
      }
      return next
    })
  }

  /* ── save ────────────────────────────────────────────────── */

  async function handleSave(opts = {}) {
    const close = opts?.close === true
    if (!form.recipient_name.trim())   return setError('Recipient name is required.')
    if (!form.recipient_mobile.trim()) return setError('Recipient mobile is required.')
    if (!form.delivery_address.trim()) return setError('Delivery address is required.')
    if (!form.customer_id)             return setError('Please select a customer.')

    setSaving(true); setError('')

    const totals = calcTotals(items, form.delivery_fee, form.currency, form.discount_amount, form.vat_amount, form.discount_currency)
    const itemsInPrimary = items.filter(it => it.currency === form.currency).reduce((s, it) => s + lineTotal(it), 0)

    // Derive payment status from the payments list vs the order totals, per currency.
    const paidCur = paidByCurrency(payments)
    const derivedPaymentStatus = ['closed', 'refunded'].includes(form.payment_status)
      ? form.payment_status                         // preserve terminal states on edit
      : derivePaymentStatus(paidCur, totals)
    const collectedCols = { collected_usd: round2(paidCur.USD), collected_lbp: round2(paidCur.LBP) }
    // Money collection state, derived from payments (driver-collected cash recorded as payments).
    const collectionStatus = collectionFromPayStatus(derivePaymentStatus(paidCur, totals))
    // "Mark Closed" locks the order via the isclosed flag.
    const closeCols = close
      ? { isclosed: true, closed_at: new Date().toISOString(), closed_by: currentUser?.user_id || null }
      : {}

    const payload = {
      recipient_name:       form.recipient_name.trim(),
      recipient_mobile:     form.recipient_mobile.trim(),
      recipient_whatsapp:   form.recipient_whatsapp?.trim() || null,
      customer_id:          form.customer_id,
      main_account:         form.main_account || null,
      pickup_address:       form.pickup_address?.trim()  || null,
      delivery_address:     form.delivery_address.trim(),
      delivery_zone_id:     form.delivery_zone_id        || null,
      driver_id:            form.driver_id               || null,
      status:                   toDbStatus(form.status),
      delivery_status:          form.delivery_status || null,
      collection_from_customer: collectionStatus,
      payment_status:       derivedPaymentStatus,
      ...collectedCols,
      ...closeCols,
      delivery_fee:         Number(form.delivery_fee)    || 0,
      currency:             form.currency,
      items_total:          itemsInPrimary,
      discount_amount:      Number(form.discount_amount) || 0,
      discount_currency:    form.discount_currency || form.currency,
      vat_amount:           Number(form.vat_amount)      || 0,
      total_amount:         Math.max(0, totals[form.currency] || 0),
      order_type:            form.order_type                   || null,
      order_details_text:    form.order_details_text?.trim()   || null,
      special_instructions:  form.special_instructions?.trim() || null,
      scheduled_date:        form.scheduled_date               || null,
      scheduled_time_from:   form.scheduled_time_from          || null,
      scheduled_time_to:     form.scheduled_time_to            || null,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }

    let orderId
    if (modal === 'add') {
      const { data, error: e } = await supabase.from('delivery_orders').insert([payload]).select('id').single()
      if (e) { setError(e.message); setSaving(false); return }
      orderId = data.id
    } else {
      const { error: e } = await supabase.from('delivery_orders').update(payload).eq('id', modal.id)
      if (e) { setError(e.message); setSaving(false); return }
      orderId = modal.id
      // Soft-delete existing items
      await supabase.from('order_items').update({ is_deleted: true }).eq('order_id', orderId).eq('is_deleted', false)
    }

    if (items.length > 0) {
      const rows = items.map(it => ({
        order_id:   orderId,
        item_type:  'product',
        product_id: it.product_id || null,
        quantity:   Number(it.quantity),
        unit_price: Number(it.unit_price),
        currency:   it.currency,
        discount:   Number(it.discount) || 0,
        line_total: lineTotal(it),
      }))
      const { error: ie } = await supabase.from('order_items').insert(rows)
      if (ie) { setError(ie.message); setSaving(false); return }
    }

    // ── Sync payments (payment_collections) ──────────────────
    const persistable = payments.filter(p => Number(p.amount) > 0)
    const keepIds     = persistable.filter(p => p._id).map(p => p._id)
    const toDelete    = origPaymentIds.filter(id => !keepIds.includes(id))

    if (toDelete.length > 0) {
      const { error: de } = await supabase.from('payment_collections').delete().in('id', toDelete)
      if (de) { setError(de.message); setSaving(false); return }
    }

    for (const p of persistable) {
      const amt  = round2(p.amount)
      const cols = p.currency === 'LBP'
        ? { amount_lbp: amt, amount_usd: 0 }
        : { amount_usd: amt, amount_lbp: 0 }
      const row = {
        collection_type: p.method || 'cash',
        ...cols,
        collected_at:    p.paid_at || new Date().toISOString(),
        notes:           p.notes?.trim() || null,
      }
      const { error: pe } = p._id
        ? await supabase.from('payment_collections').update(row).eq('id', p._id)
        : await supabase.from('payment_collections').insert([{ order_id: orderId, ...row }])
      if (pe) { setError(pe.message); setSaving(false); return }
    }

    // ── Sync delivery packages (partners) ────────────────────
    const selCustomer = customers.find(c => c.id === form.customer_id) || null
    const pkgErr = await saveOrderPackages({
      orderId, packages, origIds: origPackageIds,
      companyId: COMPANY_ID, contactCode: selCustomer?.code || null,
      userId: currentUser?.user_id || null,
    })
    if (pkgErr) { setError(pkgErr); setSaving(false); return }

    await fetchOrders(); closeModal(); setSaving(false)
  }

  /* ── toggle cancel ───────────────────────────────────────── */

  /* ── quick actions (driver / status popovers) ────────────── */

  function openPopover(type, order, e) {
    if (order.isclosed) return                        // closed orders are locked
    const rect = e.currentTarget.getBoundingClientRect()
    const width = type === 'driver' ? 240 : 176
    setDriverQuickSearch('')
    setPopover({
      type,
      order,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      y: rect.bottom + 4,
    })
  }

  async function quickAssignDriver(order, driverId) {
    setQuickBusy(true)
    await supabase.from('delivery_orders').update({ driver_id: driverId || null }).eq('id', order.id)
    await fetchOrders()
    setQuickBusy(false); setPopover(null)
  }

  async function quickSetStatus(order, uiStatus) {
    setQuickBusy(true)
    await supabase.from('delivery_orders').update({ status: toDbStatus(uiStatus) }).eq('id', order.id)
    await fetchOrders()
    setQuickBusy(false); setPopover(null)
  }

  async function toggleCancel(o) {
    if (o.isclosed) return                            // closed orders are locked
    setToggling(o.id)
    const next = ['cancelled', 'failed'].includes(o.status) ? 'pending' : 'cancelled'
    await supabase.from('delivery_orders').update({ status: next }).eq('id', o.id)
    await fetchOrders()
    setToggling(null)
  }

  async function copyNum(num) {
    await navigator.clipboard.writeText(num).catch(() => {})
    setCopied(num); setTimeout(() => setCopied(null), 1500)
  }

  /* ── totals (live) ───────────────────────────────────────── */

  const totals   = calcTotals(items, form.delivery_fee, form.currency, form.discount_amount, form.vat_amount, form.discount_currency)
  const anyItems = items.length > 0 || Number(form.delivery_fee) > 0

  // Delivery packages sub-form is shown only when the selected contact is a partner.
  const selectedCustomer  = customers.find(c => c.id === form.customer_id) || null
  const isPartnerCustomer = selectedCustomer?.contact_type === 'partner'

  const trimmedCustomer = customerInput.trim()
  const isNewCustomer =
    trimmedCustomer !== '' &&
    !form.customer_id &&
    !customers.some(c => customerName(c).toLowerCase() === trimmedCustomer.toLowerCase())

  const paidByCur     = paidByCurrency(payments)
  const paymentStatus = derivePaymentStatus(paidByCur, totals)
  const collectionFromCustomer = collectionFromPayStatus(paymentStatus)

  // A closed order is locked: no edits, cannot be cancelled or deleted.
  const orderLocked   = modal && modal !== 'add' && modal.isclosed === true
  const alreadyClosed = orderLocked
  // "Mark Closed" eligibility: fully paid (no pending), Completed, and Delivered.
  const closeRequirements = []
  if (paymentStatus !== 'paid_to_office')   closeRequirements.push('fully paid (no pending dues)')
  if (form.status !== 'completed')          closeRequirements.push('order status Completed')
  if (form.delivery_status !== 'Delivered') closeRequirements.push('delivery status Delivered')
  const canClose = closeRequirements.length === 0
  const paySummary    = CURRENCIES
    .map(c => ({ cur: c, total: round2(totals[c] || 0), paid: round2(paidByCur[c] || 0) }))
    .filter(r => r.total > 0 || r.paid > 0)
    .map(r => ({ ...r, pending: round2(r.total - r.paid) }))

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input className="input pl-9" placeholder={closed ? 'Search closed orders…' : 'Search orders…'}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {!closed && (
            <div className="flex items-center gap-1 flex-wrap">
              <Filter className="w-4 h-4 text-slate-500" />
              {STATUS_FILTERS.map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    filter === s ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
                  }`}>
                  {s === 'in_progress' ? 'In Progress' : s}
                </button>
              ))}
            </div>
          )}
          {!closed && (
            <button className="btn-primary ml-auto" onClick={openAdd}>
              <Plus className="w-4 h-4" /> New Order
            </button>
          )}
        </div>

        {/* Advanced filters */}
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="label flex items-center gap-1"><Truck className="w-3 h-3" /> Driver</label>
            <select className="input py-1.5 text-xs w-40" value={driverFilter} onChange={e => setDriverFilter(e.target.value)}>
              <option value="">All drivers</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.first_name} {d.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label flex items-center gap-1"><UserCheck className="w-3 h-3" /> Customer</label>
            <select className="input py-1.5 text-xs w-44" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
              <option value="">All contacts</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name || `${c.first_name} ${c.last_name}`}</option>)}
            </select>
          </div>
          <div>
            <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> Scheduled date</label>
            <input type="date" className="input py-1.5 text-xs w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">to (optional)</label>
            <input type="date" className="input py-1.5 text-xs w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {hasAdvancedFilters && (
            <button onClick={clearAdvancedFilters}
              className="btn-ghost py-1.5 px-2.5 text-xs text-slate-400 border border-surface-border">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
          <button onClick={() => setPendingsOpen(true)}
            className="btn-ghost ml-auto py-1.5 px-3 text-xs text-teal-300 border border-teal-500/30 bg-teal-500/10 hover:bg-teal-500/15">
            <Wallet className="w-4 h-4" /> Display Pendings
          </button>
        </div>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Order #','Recipient','Customer','Driver','Address','Amount(s)','Status','Payment',''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading.orders ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">{closed ? 'No closed orders found' : 'No orders found'}</td></tr>
            ) : filtered.map(o => (
              <tr key={o.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${['cancelled','failed'].includes(o.status) ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <button onClick={() => copyNum(o.order_number)}
                    className="font-mono text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                    {o.order_number}
                    {copied === o.order_number && <Check className="w-3 h-3 text-green-400" />}
                  </button>
                  {o.isclosed && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-400 mt-1">
                      <Lock className="w-3 h-3" /> Closed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-slate-100 text-sm">{o.recipient_name}</p>
                  <p className="text-slate-500 text-xs">{o.recipient_mobile}</p>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {o.customer ? (
                    <div>
                      <p className="text-slate-300">{o.customer.first_name} {o.customer.last_name}</p>
                      {o.customer.account_number && (
                        <p className="text-slate-500 text-[11px] font-mono tracking-wider">{formatAccountNumber(o.customer.account_number)}</p>
                      )}
                    </div>
                  ) : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  <div className="flex items-center gap-1.5">
                    <button type="button" disabled={o.isclosed}
                      onClick={(e) => openPopover('driver', o, e)}
                      title={o.isclosed ? 'Closed — locked' : 'Assign driver'}
                      className="btn-ghost p-1 text-brand-400 hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Truck className="w-3.5 h-3.5" />
                    </button>
                    {o.driver ? `${o.driver.first_name} ${o.driver.last_name}` : <span className="text-slate-600">Unassigned</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs max-w-[130px] truncate">{o.delivery_address}</td>
                <td className="px-4 py-3">
                  {(() => {
                    const t = orderTotalsByCurrency(o)
                    const entries = Object.entries(t).filter(([, v]) => v > 0)
                    if (entries.length === 0) return <span className="text-slate-600 text-xs">—</span>
                    return (
                      <div className="space-y-0.5">
                        {entries.map(([curr, amt]) => (
                          <div key={curr} className="text-xs font-medium text-slate-100">
                            <span className="text-slate-500 text-[10px] mr-1">{curr}</span>
                            {Number(amt).toFixed(curr === 'LBP' ? 0 : 2)}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </td>
                <td className="px-4 py-3">
                  <button type="button" disabled={o.isclosed}
                    onClick={(e) => openPopover('status', o, e)}
                    title={o.isclosed ? 'Closed — locked' : 'Change status'}
                    className="disabled:cursor-not-allowed hover:opacity-80 transition-opacity">
                    <Badge status={normalizeStatus(o.status)} />
                  </button>
                  {o.delivery_status && <p className="text-slate-500 text-[11px] mt-1">{o.delivery_status}</p>}
                </td>
                <td className="px-4 py-3">
                  <Badge status={o.payment_status} />
                  {o.collection_from_customer && <p className="text-slate-500 text-[11px] mt-1">{o.collection_from_customer}</p>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(o)} className="btn-ghost p-1.5 text-slate-500"
                      title={o.isclosed ? 'View (closed)' : 'Edit'}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleCancel(o)} disabled={toggling === o.id || o.isclosed}
                      title={o.isclosed ? 'Closed — locked' : (['cancelled','failed'].includes(o.status) ? 'Reactivate' : 'Cancel')}
                      className={`btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${['cancelled','failed'].includes(o.status)
                        ? 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'
                        : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modal ─────────────────────────────────────────────── */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-5xl flex flex-col" style={{ maxHeight: '92vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand-400" />
                {modal === 'add' ? 'New Order' : `Edit — ${modal.order_number}`}
              </h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {orderLocked && (
                <div className="flex items-center gap-2 text-amber-300 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <Lock className="w-4 h-4 flex-shrink-0" />
                  This order is closed and locked — no changes can be made.
                </div>
              )}

              <fieldset disabled={orderLocked} className="space-y-6 min-w-0 border-0 p-0 m-0 disabled:opacity-70">

              {/* ── Recipient & Customer ───────────────────────── */}
              <div className="space-y-3">
                <SectionLabel>Recipient & Customer</SectionLabel>

                {/* Customer first — drives auto-fill. Type to search/add, or use the picker button. */}
                <div>
                  <label className="label">Customer *</label>
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1 min-w-0">
                        <input
                          className="input w-full pr-8"
                          placeholder="Type a customer name…"
                          value={customerInput}
                          onChange={e => {
                            setCustomerInput(e.target.value)
                            setCustomerDropdownOpen(true)
                            if (form.customer_id) setForm(f => ({ ...f, customer_id: '', main_account: '' }))
                            setError('')
                          }}
                          onFocus={() => setCustomerDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
                        />
                        {form.customer_id && (
                          <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400 pointer-events-none" />
                        )}

                        {/* Inline matches dropdown */}
                        {customerDropdownOpen && trimmedCustomer !== '' && (() => {
                          const q = trimmedCustomer.toLowerCase()
                          const list = customers.filter(c =>
                            customerName(c).toLowerCase().includes(q) ||
                            c.company_name?.toLowerCase().includes(q) ||
                            c.mobile?.includes(trimmedCustomer)
                          ).slice(0, 6)
                          if (list.length === 0) return null
                          return (
                            <div className="absolute z-[55] left-0 right-0 mt-1 card border border-surface-border rounded-lg shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                              {list.map(c => (
                                <button type="button" key={c.id}
                                  onMouseDown={e => { e.preventDefault(); applyCustomer(c) }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors border-b border-surface-border/50 last:border-0">
                                  <div className="w-7 h-7 rounded-full bg-cyan-600/20 border border-cyan-600/30 flex items-center justify-center text-[10px] font-bold text-cyan-400 flex-shrink-0">
                                    {c.first_name?.[0]?.toUpperCase()}{c.last_name?.[0]?.toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-slate-100 text-sm truncate">{c.company_name || `${c.first_name} ${c.last_name}`}</p>
                                    <p className="text-slate-500 text-xs truncate">{c.mobile}</p>
                                  </div>
                                  <span className="text-[9px] uppercase tracking-wide text-slate-400 bg-surface-hover border border-surface-border rounded px-1.5 py-0.5 flex-shrink-0">{c.contact_type}</span>
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                      </div>

                      {/* Picker button — full search modal */}
                      <button type="button" title="Search customers"
                        onClick={() => { setCustomerSearch(trimmedCustomer); setCustomerPickerOpen(true) }}
                        className="btn-ghost px-3 py-2 border border-surface-border flex-shrink-0 hover:border-brand-600/50">
                        <Search className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Main account — auto-filled from the contact, read-only */}
                    {form.main_account && (
                      <p className="mt-1 text-[11px] text-slate-500 font-mono tracking-wider">
                        Main account: {formatAccountNumber(form.main_account)}
                      </p>
                    )}

                    {/* New-customer hint */}
                    {isNewCustomer && (
                      <button type="button" onClick={() => openNewCustomer()}
                        className="mt-1.5 w-full flex items-center gap-2 text-left text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2 hover:bg-cyan-500/15 transition-colors">
                        <UserPlus className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>It seems <span className="font-semibold">“{trimmedCustomer}”</span> is a new customer — do you want to save?</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Recipient Name *</label>
                    <input className="input" value={form.recipient_name}
                      onChange={e => fld('recipient_name', e.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div>
                    <label className="label">Mobile *</label>
                    <input className="input" value={form.recipient_mobile}
                      onChange={e => fld('recipient_mobile', e.target.value)} placeholder="+961 70 000 000" />
                  </div>
                </div>

                <div>
                  <label className="label">WhatsApp</label>
                  <input className="input" value={form.recipient_whatsapp}
                    onChange={e => fld('recipient_whatsapp', e.target.value)} placeholder="If different from mobile" />
                </div>
              </div>

              {/* ── Route ─────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionLabel>Route</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Pickup / Origin</label>
                    <input className="input" value={form.pickup_address}
                      onChange={e => fld('pickup_address', e.target.value)} placeholder="Warehouse address" />
                  </div>
                  <div>
                    <label className="label">Delivery Address *</label>
                    <input className="input" value={form.delivery_address}
                      onChange={e => fld('delivery_address', e.target.value)} placeholder="Auto-filled from customer or enter manually" />
                  </div>
                </div>
                <div className="flex items-end gap-5">
                  <div className="w-36 flex-shrink-0">
                    <label className="label">Scheduled Date</label>
                    <input type="date" className="input" value={form.scheduled_date}
                      onChange={e => fld('scheduled_date', e.target.value)} />
                  </div>
                  <div className="flex-1 min-w-0">
                  <TimeField
                    label="Pickup Time"
                    value={form.scheduled_time_from}
                    onChange={v => fld('scheduled_time_from', v)}
                    leftButtons={[[-60,'-1h'],[-10,'-10']]}
                    rightButtons={[[10,'+10'],[60,'+1h']]}
                  />
                  </div>
                  <div className="flex-1 min-w-0">
                  <TimeField
                    label="Delivery Time"
                    value={form.scheduled_time_to}
                    onChange={v => fld('scheduled_time_to', v)}
                    leftButtons={[[-60,'-1h'],[-10,'-10']]}
                    rightButtons={[[10,'+10'],[60,'+1h']]}
                  />
                  </div>
                </div>
              </div>

              {/* ── Assignment & Status ────────────────────────── */}
              <div className="space-y-3">
                <SectionLabel>Assignment & Status</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Driver</label>
                    <select className="input" value={form.driver_id} onChange={e => fld('driver_id', e.target.value)}>
                      <option value="">— Unassigned —</option>
                      {drivers.filter(d => ['available','on_duty'].includes(d.driver_status)).map(d => (
                        <option key={d.id} value={d.id}>{d.first_name} {d.last_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Order Status</label>
                    <select className="input" value={form.status} onChange={e => fld('status', e.target.value)}>
                      {!ORDER_STATUS_OPTIONS.some(o => o.value === form.status) && form.status && (
                        <option value={form.status}>{form.status.replace(/_/g, ' ')}</option>
                      )}
                      {ORDER_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Delivery Status</label>
                    <select className="input" value={form.delivery_status} onChange={e => fld('delivery_status', e.target.value)}>
                      {DELIVERY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Collection from Customer</label>
                    <input
                      className="input cursor-not-allowed opacity-90"
                      value={collectionFromCustomer}
                      readOnly
                      title="Derived from recorded payments"
                    />
                  </div>
                </div>
              </div>

              {/* ── Delivery Packages (partners only) ──────────── */}
              {isPartnerCustomer && (
                <OrderPackages packages={packages} setPackages={setPackages} customerName={customerInput.trim()} />
              )}

              {/* ── Items ─────────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionLabel>Retail Items</SectionLabel>
                  <button onClick={addItem} className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                </div>

                <div className="border border-surface-border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-[34%]">Product</th>
                        <th className="text-left px-3 py-2 w-[10%]">Qty</th>
                        <th className="text-left px-3 py-2 w-[15%]">Unit Price</th>
                        <th className="text-left px-3 py-2 w-[13%]">Currency</th>
                        <th className="text-left px-3 py-2 w-[12%]">Discount</th>
                        <th className="text-right px-3 py-2 w-[12%]">Line Total</th>
                        <th className="w-[4%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-600">No items — click "Add Item"</td></tr>
                      ) : items.map((it, idx) => (
                        <tr key={it._id ?? it._key ?? idx} className="border-t border-surface-border/50">
                          <td className="px-3 py-2">
                            <select className="input py-1.5 text-xs" value={it.product_id}
                              onChange={e => setItem(idx, 'product_id', e.target.value)}>
                              <option value="">— Select —</option>
                              {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0.01" step="0.01" className="input py-1.5 text-xs" value={it.quantity}
                              onChange={e => setItem(idx, 'quantity', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={it.unit_price}
                              onChange={e => setItem(idx, 'unit_price', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <select className="input py-1.5 text-xs" value={it.currency}
                              onChange={e => setItem(idx, 'currency', e.target.value)}>
                              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={it.discount}
                              onChange={e => setItem(idx, 'discount', e.target.value)} />
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-100">
                            {lineTotal(it).toFixed(it.currency === 'LBP' ? 0 : 2)}
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => removeItem(idx)} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Delivery Fees & Totals ─────────────────────── */}
              <div className="space-y-3">
                <SectionLabel>Delivery & Totals</SectionLabel>

                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="label">Delivery Fee</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.delivery_fee}
                      onChange={e => fld('delivery_fee', e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="label">Fee Currency</label>
                    <select className="input" value={form.currency} onChange={e => fld('currency', e.target.value)}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Discount</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.discount_amount}
                      onChange={e => fld('discount_amount', e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="label">Discount Currency</label>
                    <select className="input" value={form.discount_currency} onChange={e => fld('discount_currency', e.target.value)}>
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {/* Per-currency totals */}
                {anyItems && (
                  <div className="flex gap-3">
                    {CURRENCIES.map(curr => {
                      const val = totals[curr] || 0
                      if (val === 0 && curr !== form.currency) return null
                      const isPrimary = curr === form.currency
                      return (
                        <div key={curr} className={`flex-1 rounded-xl border px-4 py-3 ${isPrimary ? 'bg-brand-600/10 border-brand-600/30' : 'bg-surface-hover border-surface-border'}`}>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">{curr} Total</p>
                          <p className={`text-xl font-bold ${isPrimary ? 'text-brand-300' : 'text-slate-200'}`}>
                            {val.toFixed(curr === 'LBP' ? 0 : 2)}
                          </p>
                          {isPrimary && <p className="text-[10px] text-slate-500 mt-0.5">items + fee − discount + vat</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── Payments ──────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionLabel>Payments</SectionLabel>
                  <button onClick={addPayment} className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Payment
                  </button>
                </div>

                <div className="border border-surface-border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-[20%]">Method</th>
                        <th className="text-left px-3 py-2 w-[18%]">Amount</th>
                        <th className="text-left px-3 py-2 w-[14%]">Currency</th>
                        <th className="text-left px-3 py-2 w-[18%]">Date</th>
                        <th className="text-left px-3 py-2 w-[26%]">Notes</th>
                        <th className="w-[4%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">No payments yet — click "Add Payment"</td></tr>
                      ) : payments.map((p, idx) => (
                        <tr key={p._id ?? p._key ?? idx} className="border-t border-surface-border/50">
                          <td className="px-3 py-2">
                            <select className="input py-1.5 text-xs" value={p.method}
                              onChange={e => setPayment(idx, 'method', e.target.value)}>
                              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={p.amount}
                              onChange={e => setPayment(idx, 'amount', e.target.value)} placeholder="0.00" />
                          </td>
                          <td className="px-3 py-2">
                            <select className="input py-1.5 text-xs" value={p.currency}
                              onChange={e => setPayment(idx, 'currency', e.target.value)}>
                              {PAYMENT_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="date" className="input py-1.5 text-xs" value={p.paid_at}
                              onChange={e => setPayment(idx, 'paid_at', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <input className="input py-1.5 text-xs" value={p.notes}
                              onChange={e => setPayment(idx, 'notes', e.target.value)} placeholder="Optional" />
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => removePayment(idx)} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Payment summary — per currency */}
                <div className="rounded-xl border border-surface-border bg-surface-hover px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Payment Summary</p>
                    <div className="flex items-center gap-2">
                      <Badge status={paymentStatus} />
                      {paymentStatus === 'paid_to_office' && (
                        <span className="text-[11px] text-green-400">ready to close</span>
                      )}
                    </div>
                  </div>

                  {paySummary.length === 0 ? (
                    <p className="text-xs text-slate-600 py-1">No amounts yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="text-left  font-medium py-1">Currency</th>
                          <th className="text-right font-medium py-1">Total Order</th>
                          <th className="text-right font-medium py-1">Total Paid</th>
                          <th className="text-right font-medium py-1">Total Pending</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paySummary.map(r => {
                          const dp = r.cur === 'LBP' ? 0 : 2
                          return (
                            <tr key={r.cur} className="border-t border-surface-border/40">
                              <td className="py-1.5 text-slate-300 font-semibold">{r.cur}</td>
                              <td className="py-1.5 text-right text-slate-200">{r.total.toFixed(dp)}</td>
                              <td className="py-1.5 text-right text-slate-200">{r.paid.toFixed(dp)}</td>
                              <td className={`py-1.5 text-right font-semibold ${r.pending > 0 ? 'text-yellow-400' : r.pending < 0 ? 'text-cyan-400' : 'text-green-400'}`}>
                                {r.pending.toFixed(dp)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* ── Notes ─────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionLabel>Notes</SectionLabel>
                <div>
                  <label className="label">Order Type</label>
                  <select className="input" value={form.order_type || ''}
                    onChange={e => fld('order_type', e.target.value)}>
                    <option value="">—</option>
                    {ORDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Order Details</label>
                    <textarea className="input resize-none" rows={2} value={form.order_details_text}
                      onChange={e => fld('order_details_text', e.target.value)} placeholder="Item descriptions, parcel info…" />
                  </div>
                  <div>
                    <label className="label">Special Instructions</label>
                    <textarea className="input resize-none" rows={2} value={form.special_instructions}
                      onChange={e => fld('special_instructions', e.target.value)} placeholder="Fragile, leave at door…" />
                  </div>
                </div>
              </div>
              </fieldset>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-surface-border space-y-3">
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
                </div>
              )}
              <div className="flex gap-3 justify-end items-center">
                {modal !== 'add' && (
                  <button
                    type="button"
                    onClick={() => handleSave({ close: true })}
                    disabled={saving || alreadyClosed || !canClose}
                    title={
                      alreadyClosed ? 'Order is already closed'
                      : canClose    ? 'Mark this order as closed'
                      : 'Requires: ' + closeRequirements.join(', ')
                    }
                    className="mr-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                               bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15
                               disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-500/10">
                    <Lock className="w-4 h-4" />
                    {alreadyClosed ? 'Closed' : 'Mark Closed'}
                  </button>
                )}
                <button className="btn-ghost" onClick={closeModal}>{orderLocked ? 'Close' : 'Cancel'}</button>
                {!orderLocked && (
                  <button className="btn-primary" onClick={handleSave} disabled={saving}>
                    <Check className="w-4 h-4" />
                    {saving ? 'Saving…' : modal === 'add' ? 'Create Order' : 'Save Changes'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Customer Picker ────────────────────────────────────── */}
      {customerPickerOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-lg flex flex-col" style={{ maxHeight: '75vh' }}>

            {/* Picker header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-100">Select Customer</h3>
              </div>
              <button onClick={() => setCustomerPickerOpen(false)} className="btn-ghost p-1.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-surface-border flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  className="input pl-9 pr-8" autoFocus
                  placeholder="Search by name, mobile, email, address…"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                />
                {customerSearch && (
                  <button type="button" onClick={() => setCustomerSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Customer list */}
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const q = customerSearch.toLowerCase()
                const list = customers.filter(c =>
                  `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
                  c.company_name?.toLowerCase().includes(q) ||
                  c.mobile?.includes(q) ||
                  c.email?.toLowerCase().includes(q) ||
                  c.address?.toLowerCase().includes(q)
                )
                if (list.length === 0) return (
                  <div className="px-5 py-10 text-center space-y-3">
                    <p className="text-slate-500 text-sm">No contacts found</p>
                    <button type="button"
                      onClick={() => {
                        const seed = customerSearch.trim()
                        if (seed) setCustomerInput(seed)
                        setCustomerPickerOpen(false)
                        openNewCustomer(seed)
                      }}
                      className="btn-primary py-1.5 px-3 text-xs mx-auto">
                      <UserPlus className="w-3.5 h-3.5" /> Add new customer
                    </button>
                  </div>
                )
                return list.map(c => (
                  <div key={c.id}
                    className="flex items-start gap-3 px-5 py-3 border-b border-surface-border/50 hover:bg-surface-hover transition-colors">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-cyan-600/20 border border-cyan-600/30 flex items-center justify-center text-xs font-bold text-cyan-400 flex-shrink-0 mt-0.5">
                      {c.first_name?.[0]?.toUpperCase()}{c.last_name?.[0]?.toUpperCase()}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-slate-100 text-sm font-medium truncate">{c.company_name || `${c.first_name} ${c.last_name}`}</p>
                        <span className="text-[9px] uppercase tracking-wide text-slate-400 bg-surface-hover border border-surface-border rounded px-1.5 py-0.5 flex-shrink-0">{c.contact_type}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="text-slate-500 text-xs flex items-center gap-1">
                          <Phone className="w-3 h-3" />{c.mobile}
                        </span>
                        {c.whatsapp_number && c.whatsapp_number !== c.mobile && (
                          <span className="text-slate-500 text-xs flex items-center gap-1">
                            <Phone className="w-3 h-3 text-green-500" />{c.whatsapp_number}
                          </span>
                        )}
                        {c.email && (
                          <span className="text-slate-500 text-xs flex items-center gap-1">
                            <Mail className="w-3 h-3" />{c.email}
                          </span>
                        )}
                      </div>
                      {c.address && (
                        <p className="text-slate-600 text-xs flex items-center gap-1 mt-0.5 truncate">
                          <MapPin className="w-3 h-3 flex-shrink-0" />{c.address}
                        </p>
                      )}
                    </div>
                    {/* Select button */}
                    <button
                      onClick={() => { handleCustomerChange(c.id); setCustomerPickerOpen(false); setCustomerSearch('') }}
                      className="btn-primary py-1.5 px-3 text-xs flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3" /> Select
                    </button>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Quick New Customer (same form as the Customers page) ─── */}
      {newCustomerOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-lg p-6 space-y-4 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-cyan-400" />
                Add Customer
              </h2>
              <button onClick={() => setNewCustomerOpen(false)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <ContactFormFields
              type="customer"
              form={newCustomer}
              setField={setNewCust}
              mode="add"
            />

            <ContactAddresses addresses={custAddresses} setAddresses={setCustAddresses} />

            {customerError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{customerError}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={() => setNewCustomerOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveNewCustomer}
                disabled={savingCustomer || (newCustomer.entity_type === 'company' && !newCustomer.company_name.trim()) || !newCustomer.first_name.trim() || !newCustomer.last_name.trim() || !newCustomer.mobile.trim()}>
                <Check className="w-4 h-4" />
                {savingCustomer ? 'Saving…' : 'Save & Use'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pendings Summary ───────────────────────────────────── */}
      {pendingsOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-lg flex flex-col" style={{ maxHeight: '85vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-teal-400" />
                <h3 className="text-sm font-semibold text-slate-100">Pendings Summary</h3>
              </div>
              <button onClick={() => setPendingsOpen(false)} className="btn-ghost p-1.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <p className="text-xs text-slate-500">
                Based on <span className="text-slate-200 font-semibold">{pendingsSummary.count}</span> filtered order{pendingsSummary.count === 1 ? '' : 's'}
                {hasAdvancedFilters || filter !== 'all' || search ? ' (current filters applied)' : ''}.
              </p>

              {pendingsSummary.rows.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">No amounts for the current filter.</p>
              ) : (
                <div className="rounded-xl border border-surface-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 text-xs uppercase tracking-wider">
                        <th className="text-left  px-4 py-2.5 font-medium">Currency</th>
                        <th className="text-right px-4 py-2.5 font-medium">Total Orders</th>
                        <th className="text-right px-4 py-2.5 font-medium">Total Paid</th>
                        <th className="text-right px-4 py-2.5 font-medium">Total Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingsSummary.rows.map(r => (
                        <tr key={r.cur} className="border-t border-surface-border/50">
                          <td className="px-4 py-2.5 text-slate-300 font-semibold">{r.cur}</td>
                          <td className="px-4 py-2.5 text-right text-slate-200">{fmtMoney(r.order, r.cur)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-200">{fmtMoney(r.paid, r.cur)}</td>
                          <td className={`px-4 py-2.5 text-right font-bold ${r.pending > 0 ? 'text-yellow-400' : r.pending < 0 ? 'text-cyan-400' : 'text-green-400'}`}>
                            {fmtMoney(r.pending, r.cur)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-[11px] text-slate-600">
                Pending = Total Orders − Total Paid. A negative value means collected more than billed (credit).
              </p>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-5 py-4 border-t border-surface-border flex justify-end">
              <button className="btn-primary" onClick={() => setPendingsOpen(false)}>
                <Check className="w-4 h-4" /> Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick action popover (driver / status) ─────────────── */}
      {popover && (
        <div className="fixed inset-0 z-[60]" onClick={() => !quickBusy && setPopover(null)}>
          <div
            className="absolute card border border-surface-border rounded-lg shadow-xl overflow-hidden"
            style={{ top: popover.y, left: popover.x, width: popover.type === 'driver' ? 240 : 176 }}
            onClick={e => e.stopPropagation()}>

            {popover.type === 'driver' ? (
              <>
                <div className="p-2 border-b border-surface-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input autoFocus className="input pl-8 py-1.5 text-xs" placeholder="Search driver…"
                      value={driverQuickSearch} onChange={e => setDriverQuickSearch(e.target.value)} />
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <button onClick={() => quickAssignDriver(popover.order, '')} disabled={quickBusy}
                    className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-surface-hover flex items-center gap-2">
                    — Unassigned —
                    {!popover.order.driver_id && <Check className="w-3 h-3 text-green-400 ml-auto" />}
                  </button>
                  {drivers
                    .filter(d => {
                      const q = driverQuickSearch.toLowerCase()
                      return `${d.first_name} ${d.last_name}`.toLowerCase().includes(q) || d.mobile?.includes(driverQuickSearch)
                    })
                    .map(d => (
                      <button key={d.id} onClick={() => quickAssignDriver(popover.order, d.id)} disabled={quickBusy}
                        className="w-full flex items-center gap-2 text-left px-3 py-2 hover:bg-surface-hover border-t border-surface-border/40">
                        <div className="w-6 h-6 rounded-full bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-[9px] font-bold text-brand-300 flex-shrink-0">
                          {d.first_name?.[0]?.toUpperCase()}{d.last_name?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-slate-100 text-xs truncate">{d.first_name} {d.last_name}</p>
                          <p className="text-slate-500 text-[10px] truncate">{d.mobile}</p>
                        </div>
                        {popover.order.driver_id === d.id && <Check className="w-3 h-3 text-green-400 ml-auto flex-shrink-0" />}
                      </button>
                    ))}
                  {drivers.length === 0 && <p className="px-3 py-3 text-xs text-slate-500 text-center">No drivers</p>}
                </div>
              </>
            ) : (
              <div className="p-1">
                {ORDER_STATUS_OPTIONS.map(opt => {
                  const active = normalizeStatus(popover.order.status) === opt.value
                  return (
                    <button key={opt.value} onClick={() => quickSetStatus(popover.order, opt.value)} disabled={quickBusy}
                      className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-surface-hover ${active ? 'bg-surface-hover' : ''}`}>
                      <Badge status={opt.value} />
                      {active && <Check className="w-3.5 h-3.5 text-green-400 ml-auto" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
