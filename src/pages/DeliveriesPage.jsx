import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Search, Filter, X, Check, Trash2, AlertTriangle,
  Edit2, Power, AlertCircle, Package, RotateCcw, RotateCw,
  Phone, Mail, MapPin, UserCheck, UserPlus, Wallet, Calendar, Truck, Lock, ChevronRight, Globe, Banknote, CreditCard,
  ChevronUp, ChevronDown, ChevronsUpDown, CheckCircle2, Circle, Receipt, Flag, BellRing,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { generateCustomerAccountNumber, formatAccountNumber } from '../lib/accountNumber'
import { formatMobile } from '../lib/phone'
import { orderTotalsByCurrency, orderCollectedByCurrency, orderDriverCollectByCurrency, orderAmountBreakdown, AmountSummaryContent, placeHoverPanel, fmtAmount } from '../lib/orderAmounts'
import MobileInput from '../components/MobileInput'
import Badge, { variants as STATUS_VARIANTS, labels as STATUS_LABELS } from '../components/ui/Badge'
import ContactFormFields from '../components/contacts/ContactFormFields'
import ContactAddresses from '../components/contacts/ContactAddresses'
import { saveContactAddresses } from '../lib/contactAddresses'
import OrderPackages, { EMPTY_PACKAGE } from '../components/orders/OrderPackages'
import { saveOrderPackages } from '../lib/orderPackages'
import OrderServices, { EMPTY_SERVICE } from '../components/orders/OrderServices'
import { saveOrderServices } from '../lib/orderServices'
import TagLocationField from '../components/orders/TagLocationField'
import { getSavedLocations, addSavedLocation } from '../lib/savedLocations'

/* ── constants ───────────────────────────────────────────── */

// Order lifecycle status (stored values + display labels)
const ORDER_STATUS_OPTIONS = [
  { value: 'scheduled',   label: 'Scheduled' },
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

const STATUS_FILTERS   = ['all','scheduled','in_progress','completed','cancelled']
// Filter chips reuse the order-status Badge styling (same shape + colours). The
// "all" pseudo-status has no Badge variant, so it gets a neutral brand chip.
const FILTER_VARIANTS  = { all: 'bg-brand-500/15 text-brand-400 border-brand-500/30' }
const FILTER_LABELS    = { all: 'All' }
// Payment-status filter chips — reuse the payment Badge styling/labels/colours.
// '' is the "All" pseudo-value (no payment filter applied).
const PAYMENT_FILTERS  = ['','unpaid','partially_paid','collected_by_driver','paid_to_office']
// Flag filter — '' is the "All" pseudo-value (no flag filter applied).
const FLAG_FILTERS     = [
  { value: '',          label: 'All',       cls: 'bg-brand-500/15 text-brand-400 border-brand-500/30' },
  { value: 'flagged',   label: 'Flagged',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { value: 'unflagged', label: 'Unflagged', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
]
const CURRENCIES       = ['USD', 'LBP', 'EUR']

// Map legacy/enum order statuses onto the four-step lifecycle for display & filtering.
function normalizeStatus(s) {
  if (['scheduled', 'confirmed', 'in_progress', 'completed'].includes(s)) return s
  if (s === 'pending') return 'scheduled'
  if (['assigned', 'picked_up', 'in_transit', 'return_requested'].includes(s)) return 'in_progress'
  if (['delivered', 'returned'].includes(s)) return 'completed'
  return s   // cancelled, failed, or anything unknown → leave as-is
}

// A deactivated order = cancelled or failed. Such orders (and closed ones) are
// locked: no edit, payment, status change or driver assignment from the list.
function isDeactivated(o) { return ['cancelled', 'failed'].includes(o?.status) }
function isRowLocked(o)   { return o?.isclosed === true || isDeactivated(o) }

// Once the driver has picked the order up (delivery status past "Awaiting
// Pickup"), the assigned driver can no longer be changed.
function isPickedUp(o)    { return !!o?.delivery_status && o.delivery_status !== 'Awaiting Pickup' }

// Fully paid = the whole balance has been collected; there's nothing left to
// collect, so the list shows a "paid" hint instead of the quick-Pay button.
function isFullyPaid(o)   { return o?.payment_status === 'paid_to_office' }

// Order confirmation flag (delivery_orders.order_confirmed). Not-confirmed rows
// are highlighted in light fuchsia in the list.
function isConfirmed(o) { return o?.order_confirmed === true }

// An active, not-yet-confirmed order that has been waiting (since it was created)
// longer than the configured reminder time. Such rows blink so the user notices
// an order has been placed but not confirmed. `reminderMins <= 0` disables it.
function needsConfirmReminder(o, reminderMins, nowMs) {
  if (!(reminderMins > 0)) return false
  if (isConfirmed(o) || isRowLocked(o)) return false
  if (!o?.created_at) return false
  const created = new Date(o.created_at).getTime()
  if (isNaN(created)) return false
  return nowMs - created >= reminderMins * 60 * 1000
}

// User flag (delivery_orders.is_flagged) — a manual marker the user toggles to
// pull selected orders into the Flagged filter. Independent of any status.
function isFlagged(o) { return o?.is_flagged === true }

// Is this order's customer a credit customer (allowed to owe a balance)?
function isCreditCustomerOrder(o) { return o?.customer?.credit_debit_allowed === true }

// Quick "Mark Closed" from the list is allowed once the materials are Delivered.
// Normally the money must also be fully collected, but a credit customer may close
// with an unpaid balance — they settle their dues later from the Credit Customers
// page. The row must not already be closed/deactivated. The edit modal keeps the
// fuller close flow (status Completed); this is the one-click shortcut.
function canQuickClose(o) {
  if (isRowLocked(o) || o?.delivery_status !== 'Delivered') return false
  return isCreditCustomerOrder(o) || isFullyPaid(o)
}

// The scheduled deadline = scheduled_date at scheduled_time_to (else _from, else
// end of day). Used to flag overdue orders in the list.
function orderDeadline(o) {
  if (!o?.scheduled_date) return null
  const d = String(o.scheduled_date).slice(0, 10)
  const t = String(o.scheduled_time_to || o.scheduled_time_from || '23:59').slice(0, 5)
  const dt = new Date(`${d}T${t}`)
  return isNaN(dt.getTime()) ? null : dt
}

// Overdue = an active order (scheduled / confirmed / in progress, i.e. not yet
// completed and not cancelled/failed/closed) whose scheduled deadline has passed.
// Covers both "scheduled but not started in time" and "in progress past the date".
function isOverdue(o) {
  if (!o || o.isclosed) return false
  if (!['scheduled', 'confirmed', 'in_progress'].includes(normalizeStatus(o.status))) return false
  const dl = orderDeadline(o)
  return !!dl && Date.now() > dl.getTime()
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

const EMPTY_RETAIL_INVOICE = { shop_name: '', shop_type: '', contact_id: '', contact_code: '', invoice_reference: '', invoice_date: '', invoice_value: '', currency: 'USD', paid: true, payment_type: '' }

/* Pickup / delivery addresses are stored as a single text column but edited as
   multiple location tags — serialised with " | " so existing single-address rows
   keep working (they just read back as one tag). */
const LOC_SEP   = ' | '
const splitLocs = s => (s || '').split('|').map(x => x.trim()).filter(Boolean)
const joinLocs  = arr => arr.join(LOC_SEP)
/* Add `value` to the serialized location string `s`, de-duped case-insensitively. */
function mergeLoc(s, value) {
  const v = (value || '').trim()
  if (!v) return s
  const cur = splitLocs(s)
  return cur.some(x => x.toLowerCase() === v.toLowerCase()) ? s : joinLocs([...cur, v])
}
/* Remove `value` from the serialized location string `s`, case-insensitively. */
function dropLoc(s, value) {
  const v = (value || '').trim().toLowerCase()
  return joinLocs(splitLocs(s).filter(x => x.toLowerCase() !== v))
}

const EMPTY_CUSTOMER = {
  entity_type: 'individual',
  company_name: '', commercial_registration: '',
  first_name: '', last_name: '', mobile: '', whatsapp_number: '',
  email: '', city: '', address: '', notes: '', account_number: '', credit_debit_allowed: false,
}

function customerName(c) {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
}

// Display name for a contact in lists: company name for companies/partners,
// otherwise the person's name.
function customerListName(c) {
  const isCompany = c.entity_type === 'company' || c.contact_type === 'partner'
  return (isCompany && c.company_name) ? c.company_name : (customerName(c) || '—')
}

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'card',          label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'other',         label: 'Other' },
]

// Payments are stored as a single amount + currency, so any order currency works.
const PAYMENT_CURRENCIES = CURRENCIES

const EMPTY_PAYMENT = { method: 'cash', amount: '', currency: 'USD', paid_at: '', notes: '' }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

// Category rows for the expandable totals panel on the floating bar — mirrors the
// per-order amounts popup (orderAmountBreakdown), but summed across the filtered
// orders. `tone` picks a colour; `strong` adds a divider/emphasis; `neg` shows a
// leading minus (discount is subtracted from the total).
const TOTALS_BREAKDOWN_ROWS = [
  { key: 'packages',       label: 'Delivery Packages' },
  { key: 'services',       label: 'Order Services' },
  { key: 'localRetail',    label: 'Local retail items' },
  { key: 'externalRetail', label: 'External retail invoices' },
  { key: 'fees',           label: 'Delivery fees' },
  { key: 'discount',       label: 'Discount',                 tone: 'rose',    neg: true },
  { key: 'vat',            label: 'VAT' },
  { key: 'total',          label: 'Total All',                tone: 'strong',  strong: true },
  { key: 'collected',      label: 'Collected from customers', tone: 'emerald' },
  { key: 'balance',        label: 'Balance',                  tone: 'amber' },
  { key: 'fromDriver',     label: 'To collect from driver',   tone: 'teal',    strong: true },
  { key: 'pending',        label: 'Order Pending',            tone: 'amber' },
]

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

function calcTotals(items, deliveryFee, feeCurrency, discount, vat, discountCurrency = feeCurrency,
                    packages = [], services = [], retailInvoices = []) {
  const t = { USD: 0, LBP: 0, EUR: 0 }
  const add = (cur, n) => { t[cur in t ? cur : 'USD'] += n }
  // Per-item line totals already apply each item's own discount in its currency.
  for (const it of items) add(it.currency || 'USD', lineTotal(it))
  // Packages carry their own currency. A package already paid directly to its
  // provider is excluded from the order total.
  for (const p of packages) if (!p.paid) add(p.currency || feeCurrency, Number(p.package_price) || 0)
  // Services and external retail invoice references carry their own currency.
  for (const s of services) add(s.service_fees_currency || 'USD', Number(s.service_fees) || 0)
  for (const r of retailInvoices) add(r.currency || 'USD', Number(r.invoice_value) || 0)
  add(feeCurrency, Number(deliveryFee) || 0)
  // Discount always reduces the total, in its own currency (never adds).
  add(discountCurrency, -Math.abs(Number(discount) || 0))
  add(feeCurrency, Number(vat) || 0)
  return t
}

function SectionLabel({ children }) {
  return <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">{children}</p>
}

// Order-form sections, in display order. Used to collapse/expand each block.
const FORM_SECTIONS = ['order_type', 'customer', 'route', 'assignment', 'packages', 'services', 'items', 'retail_invoices', 'totals', 'payments', 'notes']
// Sections expanded by default on a new order; the rest start collapsed.
const DEFAULT_OPEN_SECTIONS = ['order_type', 'customer', 'route', 'assignment', 'notes']
const allSectionsClosed = () => Object.fromEntries(FORM_SECTIONS.map(s => [s, false]))
const allSectionsOpen   = () => Object.fromEntries(FORM_SECTIONS.map(s => [s, true]))
const defaultNewSections = () => Object.fromEntries(FORM_SECTIONS.map(s => [s, DEFAULT_OPEN_SECTIONS.includes(s)]))

/* A vertically collapsible form section. Header toggles open/closed; tabbing or
   clicking the header also expands it, so a fresh (all-collapsed) order opens
   one section at a time as the user moves through it. `right` is an optional
   header action (e.g. an Add button) that opens the section when used. */
function CollapsibleSection({ title, open, onToggle, right, children, accent }) {
  const accentStyles = {
    fuchsia: { border: 'border-fuchsia-500/40', header: 'bg-fuchsia-500/10' },
    blue:    { border: 'border-blue-500/40',    header: 'bg-blue-500/10' },
  }[accent]
  return (
    <div className={`border rounded-lg overflow-hidden ${accentStyles ? accentStyles.border : 'border-surface-border'}`}>
      <div className={`flex items-center ${accentStyles ? accentStyles.header : 'bg-surface-hover/40'}`}>
        <button type="button"
          onClick={() => onToggle(!open)}
          onFocus={() => { if (!open) onToggle(true) }}
          className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-hover transition-colors">
          <ChevronRight className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          <span className="text-[11px] text-slate-300 uppercase tracking-wider font-semibold">{title}</span>
        </button>
        {right && <div className="pr-2 flex-shrink-0">{right}</div>}
      </div>
      {open && <div className="p-3 space-y-3">{children}</div>}
    </div>
  )
}

function fmtMoney(n, cur) { return Number(n || 0).toFixed(cur === 'LBP' ? 0 : 2) }

/* ── page ─────────────────────────────────────────────────── */

export default function DeliveriesPage({ closed = false }) {
  const { orders, drivers, zones, fetchOrders, loading, COMPANY_ID, showSummary, appSettings } = useApp()
  // Minutes an unconfirmed order may sit before its row starts blinking (0 = off).
  const reminderMins = Number(appSettings?.orderConfirmReminderMinutes) || 0
  // Ticks the clock so blinking starts on time without needing a manual refresh.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])
  const { currentUser } = useAuth()
  // Full name of the signed-in user, stamped on payments they record (collector).
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || null

  // Remembers the id of an order created during this modal session, so if a
  // later step (items, packages, services…) fails the retry UPDATEs that order
  // instead of inserting a duplicate. Reset whenever the modal opens/closes.
  const savedOrderIdRef = useRef(null)
  const driverSearchRef = useRef(null)
  const handledEditRef  = useRef(null)   // deep-link: open an order from ?edit=<id>
  const [searchParams, setSearchParams] = useSearchParams()

  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [sort,      setSort]      = useState({ col: null, dir: null })  // column sort: asc | desc | null
  const [modal,     setModal]     = useState(null)
  const [form,      setForm]      = useState(BASE_FORM)
  const [items,     setItems]     = useState([])
  const [retailInvoices, setRetailInvoices] = useState([])   // retail_goods_invoices
  const [packages,       setPackages]       = useState([])
  const [origPackageIds, setOrigPackageIds] = useState([])
  const [services,       setServices]       = useState([])
  const [origServiceIds, setOrigServiceIds] = useState([])
  const [savedPickup,   setSavedPickup]   = useState(() => getSavedLocations('pickup'))
  const [savedDelivery, setSavedDelivery] = useState(() => getSavedLocations('delivery'))
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [copied,    setCopied]    = useState(null)
  const [toggling,  setToggling]  = useState(null)
  // Deactivate-order confirmation: { order, reason, counts, loading, busy }
  const [cancelModal, setCancelModal] = useState(null)
  const [customers,          setCustomers]          = useState([])
  const [products,           setProducts]           = useState([])
  const [providers,          setProviders]          = useState([])   // "Online" contacts → package providers
  const [orderTypes,         setOrderTypes]         = useState([])   // custom order types (DB)
  const [addingType,         setAddingType]         = useState(false)
  const [newTypeName,        setNewTypeName]        = useState('')
  const [typeBusy,           setTypeBusy]           = useState(false)
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
  const [payFilter,            setPayFilter]            = useState('')   // payment_status chip (toggle)
  const [flagFilter,           setFlagFilter]           = useState('')   // ''|flagged|unflagged
  const [customerFilter,       setCustomerFilter]       = useState('')
  const [categoryFilter,       setCategoryFilter]       = useState('')   // credit|regular|partner|supplier
  const [sourceFilter,         setSourceFilter]         = useState('')   // LOCAL|EXTERNAL
  const [dateFrom,             setDateFrom]             = useState('')
  const [dateTo,               setDateTo]               = useState('')
  const [pendingsOpen,         setPendingsOpen]         = useState(false)
  const [totalsExpanded,       setTotalsExpanded]       = useState(false)  // floating-bar breakdown panel
  const [popover,              setPopover]              = useState(null)   // { type:'driver'|'status'|'fee', order, x, y }
  const [hoverSummary,         setHoverSummary]         = useState(null)   // { order, x, y } — amounts preview following the cursor
  const hoverPanelRef = useRef(null)
  const [feeDraft,             setFeeDraft]             = useState({ amount: '', currency: 'USD' })   // quick delivery-fee edit
  const [driverQuickSearch,    setDriverQuickSearch]    = useState('')
  const [quickBusy,            setQuickBusy]            = useState(false)
  const [sectionsOpen,         setSectionsOpen]         = useState(allSectionsClosed)
  const [addCredit,            setAddCredit]            = useState(false)   // creating a Credit Order
  // Quick "Pay" from the list — records a payment on an order without opening the full form.
  const [payModal,             setPayModal]             = useState(null)   // order being paid | null
  const [payForm,              setPayForm]              = useState(EMPTY_PAYMENT)
  const [payPaid,              setPayPaid]              = useState({ USD: 0, LBP: 0 })
  const [paySaving,            setPaySaving]            = useState(false)
  const [payError,             setPayError]             = useState('')

  const toggleSection = (id, val) => setSectionsOpen(s => ({ ...s, [id]: val }))
  const openSection   = (id) => setSectionsOpen(s => (s[id] ? s : { ...s, [id]: true }))
  // Add a package from the section header (works even while the subform is collapsed/unmounted).
  const addPackage    = () => { openSection('packages'); setPackages(p => [...p, { ...EMPTY_PACKAGE, _key: Date.now() }]) }

  /* ── lookups ─────────────────────────────────────────────── */

  const fetchLookups = useCallback(async () => {
    // A delivery can be for any contact, so the picker includes customers,
    // partners and suppliers.
    let typesQ = supabase.from('order_types').select('id, name').eq('is_active', true).order('name')
    if (COMPANY_ID) typesQ = typesQ.eq('company_id', COMPANY_ID)
    const [{ data: custs }, { data: prods }, { data: types }, { data: provs }] = await Promise.all([
      supabase.from('contacts')
        .select('id,first_name,last_name,mobile,whatsapp_number,email,city,address,contact_type,entity_type,company_name,code,account_number,credit_debit_allowed,shop_type')
        .in('contact_type', ['customer', 'partner', 'supplier']),
      supabase.from('products').select('id,name,code,unit_price,currency').eq('is_active', true),
      typesQ,
      // Package providers — contacts categorised as "Online".
      supabase.from('contacts')
        .select('id,first_name,last_name,company_name,contact_type,account_number,code')
        .eq('contact_category', 'Online'),
    ])
    setCustomers(custs ?? [])
    setProducts(prods  ?? [])
    setOrderTypes(types ?? [])
    setProviders(provs ?? [])
  }, [COMPANY_ID])

  useEffect(() => { fetchLookups() }, [fetchLookups])

  // Deep link: /deliveries?edit=<orderId> opens that order and jumps to Items.
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || loading.orders || handledEditRef.current === editId) return
    const o = orders.find(x => x.id === editId)
    if (!o) return   // wait until the orders list includes it
    handledEditRef.current = editId
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('edit'); return p }, { replace: true })
    ;(async () => {
      await openEdit(o)
      setSectionsOpen(s => ({ ...s, items: true }))
      setTimeout(() => {
        document.getElementById('order-section-items')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 350)
    })()
  }, [searchParams, orders, loading.orders])

  /* Create a custom order type inline and select it for this order. */
  async function createOrderType() {
    const name = newTypeName.trim()
    if (!name) return
    setTypeBusy(true)
    const { data, error: e } = await supabase
      .from('order_types')
      .insert([{ name, is_active: true, ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}) }])
      .select('id, name')
      .single()
    setTypeBusy(false)
    if (e) { setError(e.message); return }
    setOrderTypes(ts => [...ts, data].sort((a, b) => a.name.localeCompare(b.name)))
    fld('order_type', data.name)
    setAddingType(false); setNewTypeName('')
  }

  /* ── filter ──────────────────────────────────────────────── */

  function matchScheduledDate(o) {
    if (!dateFrom && !dateTo) return true
    const sd = o.scheduled_date ? o.scheduled_date.slice(0, 10) : ''
    if (!sd) return false                              // no date → excluded once a date filter is set
    if (dateFrom && dateTo) return sd >= dateFrom && sd <= dateTo  // between two dates (inclusive)
    if (dateFrom)           return sd === dateFrom     // single scheduled date
    return sd <= dateTo
  }

  function matchCategory(o) {
    if (!categoryFilter) return true
    const c = o.customer
    if (!c) return false
    if (categoryFilter === 'credit')  return c.credit_debit_allowed === true
    if (categoryFilter === 'regular') return c.contact_type === 'customer' && c.credit_debit_allowed !== true
    if (categoryFilter === 'partner') return c.contact_type === 'partner'
    if (categoryFilter === 'supplier') return c.contact_type === 'supplier'
    return true
  }
  function matchSource(o) {
    if (!sourceFilter) return true
    // External data may be filled with varied spelling/casing (e.g. "EXTERNAL",
    // "EXTRERNAL"); treat anything starting with EXT as external, else local.
    const isExternal = (o.order_source || '').trim().toUpperCase().startsWith('EXT')
    return sourceFilter === 'EXTERNAL' ? isExternal : !isExternal
  }
  // An order from the online application = external source.
  const isOnlineOrder = (o) => (o.order_source || '').trim().toUpperCase().startsWith('EXT')

  const filtered = orders.filter(o => {
    // Closed orders live on their own page; the daily Orders page excludes them.
    const matchClosed = closed ? o.isclosed === true : o.isclosed !== true
    const q = search.toLowerCase()
    const matchSearch = !search || [
      o.order_number,
      o.recipient_name,
      o.recipient_mobile,
      o.recipient_whatsapp,
      o.delivery_address,
      o.pickup_address,
      o.main_account,
      o.customer && `${o.customer.first_name ?? ''} ${o.customer.last_name ?? ''} ${o.customer.company_name ?? ''}`,
      o.customer?.account_number,
    ].some(v => String(v ?? '').toLowerCase().includes(q))
    return matchClosed && matchSearch
      && (filter === 'all' || normalizeStatus(o.status) === filter)
      && (!payFilter      || o.payment_status === payFilter)
      && (!flagFilter     || (flagFilter === 'flagged' ? isFlagged(o) : !isFlagged(o)))
      && (!driverFilter   || o.driver_id   === driverFilter)
      && (!customerFilter || o.customer_id === customerFilter)
      && matchCategory(o)
      && matchSource(o)
      && matchScheduledDate(o)
  })

  const hasAdvancedFilters = driverFilter || customerFilter || categoryFilter || sourceFilter || dateFrom || dateTo
  function clearAdvancedFilters() {
    setDriverFilter(''); setCustomerFilter(''); setCategoryFilter(''); setSourceFilter(''); setDateFrom(''); setDateTo('')
  }

  // Sortable column header → value extractor. Headers not listed here aren't sortable.
  const SORT_GETTERS = {
    'Order #':   o => o.order_number ?? '',
    'Recipient': o => o.recipient_name ?? '',
    'Customer':  o => o.customer ? customerListName(o.customer) : '',
    'Driver':    o => o.driver ? `${o.driver.first_name ?? ''} ${o.driver.last_name ?? ''}`.trim() : '',
    'Address':   o => o.delivery_address ?? '',
    'Amount(s)': o => Number(o.total_amount) || 0,
    'Status':    o => normalizeStatus(o.status) ?? '',
    'Payment':   o => o.payment_status ?? '',
  }
  // Click a header: none → A→Z → Z→A → none.
  function toggleSort(col) {
    if (!SORT_GETTERS[col]) return
    setSort(s => s.col !== col ? { col, dir: 'asc' }
              : s.dir === 'asc' ? { col, dir: 'desc' }
              : { col: null, dir: null })
  }

  // Apply the active column sort to the filtered rows.
  const sorted = (() => {
    const get = sort.col && SORT_GETTERS[sort.col]
    if (!get || !sort.dir) return filtered
    const arr = [...filtered].sort((a, b) => {
      const va = get(a), vb = get(b)
      const cmp = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return arr
  })()

  /* Aggregate the filtered orders into per-currency totals for the pendings popup. */
  const pendingsSummary = (() => {
    const cur = { USD: { order: 0, paid: 0, driverCollect: 0 }, LBP: { order: 0, paid: 0, driverCollect: 0 }, EUR: { order: 0, paid: 0, driverCollect: 0 } }
    for (const o of filtered) {
      const tt = orderTotalsByCurrency(o)
      const cc = orderCollectedByCurrency(o)
      const dc = orderDriverCollectByCurrency(o)   // delivery fees + local retail items
      for (const c of CURRENCIES) {
        cur[c].order += (tt[c] || 0)
        cur[c].paid  += (cc[c] || 0)
        cur[c].driverCollect += (dc[c] || 0)
      }
    }
    const rows = CURRENCIES
      .map(c => ({ cur: c, order: round2(cur[c].order), paid: round2(cur[c].paid), driverCollect: round2(cur[c].driverCollect) }))
      .filter(r => r.order !== 0 || r.paid !== 0)
      .map(r => ({ ...r, pending: round2(r.order - r.paid) }))
    return { count: filtered.length, rows }
  })()

  /* Sum the per-order amount breakdown (packages, services, local/external retail,
     fees, discount, vat, total, collected, balance, to-collect, pending) across
     the filtered orders, per currency — feeds the expandable totals panel on the
     floating bar. Same categories as the per-order amounts popup. */
  const totalsBreakdown = (() => {
    const acc = {}   // cur -> category sums
    for (const o of filtered) {
      for (const r of orderAmountBreakdown(o)) {
        const b = (acc[r.cur] ||= { packages: 0, services: 0, localRetail: 0, externalRetail: 0, fees: 0, discount: 0, vat: 0, total: 0, collected: 0, balance: 0, fromDriver: 0, pending: 0 })
        for (const row of TOTALS_BREAKDOWN_ROWS) b[row.key] += (r[row.key] || 0)
      }
    }
    const order = [...CURRENCIES, ...Object.keys(acc).filter(c => !CURRENCIES.includes(c))]
    return order.filter(c => acc[c]).map(c => {
      const out = { cur: c }
      for (const row of TOTALS_BREAKDOWN_ROWS) out[row.key] = round2(acc[c][row.key])
      return out
    })
  })()

  /* ── modal handlers ──────────────────────────────────────── */

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })); setError('') }

  /* Remember a location in the reusable library (localStorage) so it's offered
     as a quick-pick tag on future orders. */
  function rememberPickup(v)   { setSavedPickup(addSavedLocation('pickup', v)) }
  function rememberDelivery(v) { setSavedDelivery(addSavedLocation('delivery', v)) }

  /* Add a warehouse/shop to the pickup-location tags (used when a shop is picked
     in the External retail invoices section), de-duped, and remember it. */
  function addPickupTag(name) {
    const v = (name || '').trim()
    if (!v) return
    setForm(f => ({ ...f, pickup_address: mergeLoc(f.pickup_address, v) }))
    rememberPickup(v)
  }

  /* Remove a shop from the pickup-location tags — but only if no other retail
     invoice still references it (so a shared shop tag stays). */
  function dropPickupTagIfUnused(name, invoices) {
    const v = (name || '').trim()
    if (!v) return
    if (invoices.some(r => r.shop_name?.toLowerCase() === v.toLowerCase())) return
    setForm(f => ({ ...f, pickup_address: dropLoc(f.pickup_address, v) }))
  }

  /* Fill the order's customer-related fields from a customer record.
     When the contact is a company (entity_type 'company', or a partner placing
     the order on its behalf), the company name goes in the customer box and the
     recipient (the end customer) is left blank to be entered manually. The
     main_account is always taken from the contact's account_number (read-only). */
  function applyCustomer(c) {
    const isCompany   = c.entity_type === 'company' || c.contact_type === 'partner'
    const displayName = (isCompany && c.company_name) ? c.company_name : customerName(c)
    setForm(f => ({
      ...f,
      customer_id:        c.id,
      main_account:       c.account_number ?? '',
      recipient_name:     isCompany ? '' : (customerName(c) || f.recipient_name),
      recipient_mobile:   isCompany ? '' : (c.mobile ?? f.recipient_mobile),
      recipient_whatsapp: isCompany ? '' : (c.whatsapp_number ?? c.mobile ?? f.recipient_whatsapp),
      // Merge the customer's address into the delivery-location tags (de-duped)
      // rather than overwriting any tags already added.
      delivery_address:   mergeLoc(f.delivery_address, c.address),
    }))
    if (c.address?.trim()) rememberDelivery(c.address.trim())
    setCustomerInput(displayName)
    setCustomerDropdownOpen(false)
    setError('')
  }

  function handleCustomerChange(id) {
    const c = customers.find(x => x.id === id)
    if (c) applyCustomer(c)
  }

  /* The default "walk-in" customer applied to every new order. Matched by name
     (case-insensitive) against either the company name or the person's name. */
  function findGeneralCustomer() {
    return customers.find(c =>
      (c.company_name || customerName(c) || '').trim().toLowerCase() === 'general customer'
    )
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
      credit_debit_allowed: !!newCustomer.credit_debit_allowed,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      branch_id:      currentUser?.branch_id || null,
      created_by:     currentUser?.user_id   || null,
      account_number: accountNumber || null,
    }
    const { data, error: e } = await supabase
      .from('contacts')
      .insert([payload])
      .select('id,first_name,last_name,mobile,whatsapp_number,email,city,address,account_number,contact_type,entity_type,company_name,credit_debit_allowed')
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
    savedOrderIdRef.current = null
    setForm(getEmptyForm()); setItems([]); setRetailInvoices([]); setPayments([]); setOrigPaymentIds([])
    setPackages([]); setOrigPackageIds([])
    setServices([]); setOrigServiceIds([])
    setSectionsOpen(defaultNewSections())         // new order: Order Type, Customer, Route, Notes open
    setAddCredit(false)
    setCustomerInput(''); setError(''); setModal('add')
    // Default to the "GENERAL CUSTOMER" contact; the user can still type/select another.
    const general = findGeneralCustomer()
    if (general) applyCustomer(general)
  }

  // Credit Order: same form, but pricing sections hidden and credit-only customers.
  function openAddCredit() {
    savedOrderIdRef.current = null
    setForm(getEmptyForm()); setItems([]); setRetailInvoices([]); setPayments([]); setOrigPaymentIds([])
    setPackages([]); setOrigPackageIds([])
    setServices([]); setOrigServiceIds([])
    setSectionsOpen(defaultNewSections())
    setAddCredit(true)
    setCustomerInput(''); setError(''); setModal('add')
  }

  async function openEdit(o) {
    savedOrderIdRef.current = null
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
    const { data: riData } = await supabase
      .from('retail_goods_invoices')
      .select('*')
      .eq('order_id', o.id)
      .order('created_at')
    setRetailInvoices((riData ?? []).map(ri => ({
      _id:               ri.id,
      shop_name:         ri.shop_name ?? '',
      shop_type:         ri.shop_type ?? '',
      contact_id:        ri.contact_id ?? '',
      contact_code:      ri.contact_code ?? '',
      invoice_reference: ri.invoice_reference ?? '',
      invoice_date:      ri.invoice_date ? ri.invoice_date.slice(0, 10) : '',
      invoice_value:     ri.invoice_value ?? '',
      currency:          ri.currency ?? 'USD',
      paid:              !!ri.paid,
      payment_type:      ri.payment_type ?? '',
    })))
    const { data: payData } = await supabase
      .from('payment_collections')
      .select('id,collection_type,amount,currency,collected_at,notes')
      .eq('order_id', o.id)
      .order('collected_at')
    const mappedPayments = (payData ?? []).map(pc => {
      return {
        _id:      pc.id,
        method:   pc.collection_type || 'cash',
        currency: pc.currency || 'USD',
        amount:   round2(pc.amount) || '',
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
      provider_id:     pk.provider_id ?? '',
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
      currency:        pk.currency ?? 'USD',
      paid:            !!pk.paid,
      payment_type:    pk.payment_type ?? '',
    }))
    setPackages(mappedPackages)
    setOrigPackageIds(mappedPackages.map(p => p._id))

    const { data: svcData } = await supabase
      .from('order_services')
      .select('*')
      .eq('order_id', o.id)
      .order('service_date')
    const mappedServices = (svcData ?? []).map(sv => ({
      _id:                     sv.id,
      service_date:            sv.service_date ?? '',
      provider_id:             sv.provider_id ?? '',
      service_description:     sv.service_description ?? '',
      service_reference:       sv.service_reference ?? '',
      quantity:                sv.quantity ?? 1,
      service_fees:            sv.service_fees ?? '',
      service_fees_currency:   sv.service_fees_currency ?? 'USD',
    }))
    setServices(mappedServices)
    setOrigServiceIds(mappedServices.map(s => s._id))

    const existing = customers.find(x => x.id === o.customer_id) || o.customer
    const existingIsCompany = existing && (existing.entity_type === 'company' || existing.contact_type === 'partner')
    setCustomerInput(
      existing
        ? (existingIsCompany && existing.company_name ? existing.company_name : customerName(existing))
        : ''
    )
    // Editing: keep the core sections open, but collapse the optional ones that
    // hold no data so a busy order isn't overwhelming.
    const hasTotals = (Number(o.total_amount) || 0) !== 0
      || (Number(o.delivery_fee) || 0) !== 0
      || (Number(o.discount_amount) || 0) !== 0
      || (data ?? []).length > 0
    setSectionsOpen({
      order_type:      true,
      customer:        true,
      route:           true,
      assignment:      true,
      packages:        mappedPackages.length > 0,
      services:        mappedServices.length > 0,
      items:           (data ?? []).length > 0,
      retail_invoices: (riData ?? []).length > 0,
      totals:          hasTotals,
      payments:        mappedPayments.length > 0,
      notes:           !!(o.order_details_text || o.special_instructions),
    })
    setError(''); setModal(o)
  }

  function closeModal() {
    savedOrderIdRef.current = null
    setModal(null); setItems([]); setRetailInvoices([]); setPayments([]); setOrigPaymentIds([]); setError('')
    setPackages([]); setOrigPackageIds([])
    setServices([]); setOrigServiceIds([])
    setCustomerInput(''); setCustomerDropdownOpen(false); setAddCredit(false)
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

  /* ── quick "Pay" from the list ───────────────────────────────
     Records one payment_collections row on an order and recomputes the order's
     payment_status / collected totals — same effect as the form's Payments section. */
  async function openPay(o) {
    if (isRowLocked(o)) return   // closed or deactivated orders are locked
    setPayModal(o)
    setPayForm({ ...EMPTY_PAYMENT, paid_at: new Date().toISOString().slice(0, 10) })
    setPayPaid({})
    setPayError(''); setPaySaving(false)
    const { data } = await supabase.from('payment_collections').select('amount,currency').eq('order_id', o.id)
    setPayPaid(paidByCurrency(data ?? []))
  }
  function closePay() { setPayModal(null); setPayForm(EMPTY_PAYMENT); setPayError(''); setPaySaving(false) }
  function setPayFld(k, v) { setPayForm(f => ({ ...f, [k]: v })); setPayError('') }

  async function savePayment() {
    const o = payModal
    if (!o) return
    const amt = round2(payForm.amount)
    if (!(amt > 0)) { setPayError('Enter an amount greater than 0.'); return }
    setPaySaving(true); setPayError('')

    const cur = payForm.currency
    const dp  = cur === 'LBP' ? 0 : 2

    // 1. Read current payments and check the new amount won't exceed the order's
    //    balance in this currency. Hint the actual amount that can still be paid.
    const { data: prevPays, error: fe } = await supabase
      .from('payment_collections').select('amount,currency').eq('order_id', o.id)
    if (fe) { setPayError(fe.message); setPaySaving(false); return }
    const paidPrev    = paidByCurrency(prevPays ?? [])   // { USD, LBP, EUR }
    const totals      = orderTotalsByCurrency(o)
    const orderCur    = round2(totals[cur] || 0)
    const paidCurPrev = round2(paidPrev[cur] || 0)
    const remaining   = round2(orderCur - paidCurPrev)
    if (amt > remaining) {
      setPayPaid(paidPrev)   // refresh the modal summary
      setPayError(
        remaining > 0
          ? `Amount exceeds the order balance. The most you can pay in ${cur} is ${remaining.toFixed(dp)}.`
          : `This order's ${cur} balance is already fully paid (nothing left to pay).`,
      )
      setPaySaving(false)
      return
    }

    // 2. Insert the payment (single amount + currency). Stamp the signed-in user
    //    as the collector — a payment recorded here is paid to the office directly,
    //    so it's attributed to the user, not the driver.
    const { error: pe } = await supabase.from('payment_collections').insert([{
      order_id:          o.id,
      collection_type:   payForm.method || 'cash',
      amount:            amt,
      currency:          cur,
      collected_at:      payForm.paid_at || new Date().toISOString(),
      notes:             payForm.notes?.trim() || null,
      collected_by:      currentUser?.user_id || null,
      collected_by_name: currentUserName,
    }])
    if (pe) { setPayError(pe.message); setPaySaving(false); return }

    // 3. Recompute the order's payment status (collected totals are derived from
    //    payment_collections, no longer stored on the order).
    const paidCur = { ...paidPrev, [cur]: round2(paidCurPrev + amt) }
    const status  = derivePaymentStatus(paidCur, totals)
    const { error: ue } = await supabase.from('delivery_orders').update({
      payment_status:           status,
      collection_from_customer: collectionFromPayStatus(status),
    }).eq('id', o.id)
    if (ue) { setPayError(ue.message); setPaySaving(false); return }

    await fetchOrders(); closePay(); setPaySaving(false)
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

  /* Retail goods invoices (retail_goods_invoices). */
  function addRetailInvoice() {
    setRetailInvoices(p => [...p, { ...EMPTY_RETAIL_INVOICE, invoice_date: new Date().toISOString().slice(0, 10), _key: Date.now() }])
  }
  function removeRetailInvoice(i) {
    const removed = retailInvoices[i]
    const next    = retailInvoices.filter((_, idx) => idx !== i)
    setRetailInvoices(next)
    dropPickupTagIfUnused(removed?.shop_name, next)
  }
  function setRetailInvoice(i, k, v) {
    setRetailInvoices(p => { const next = [...p]; next[i] = { ...next[i], [k]: v }; return next })
  }

  /* ── save ────────────────────────────────────────────────── */

  async function handleSave(opts = {}) {
    const close = opts?.close === true
    if (!form.recipient_name.trim())   return setError('Recipient name is required.')
    if (!form.recipient_mobile.trim()) return setError('Recipient mobile is required.')
    if (!form.delivery_address.trim()) return setError('Delivery address is required.')
    if (!form.customer_id)             return setError('Please select a customer.')
    // Package provider and reference are mandatory on every package row.
    for (const p of packages) {
      if (!p.provider_id)             return setError('Each package needs a Package provider.')
      if (!p.tracking_number?.trim()) return setError('Each package needs a Package reference.')
    }

    // Backstop for "Mark Closed": besides the disabled button, re-verify the close
    // requirements at save-time so an order can never be locked while ineligible
    // (status Completed, delivery Delivered, and fully collected / zero pending —
    // payment waived only for credit orders / credit-allowed customers).
    if (close && (alreadyClosed || !canClose)) {
      return setError(alreadyClosed
        ? 'This order is already closed.'
        : 'Cannot close — order must be: ' + closeRequirements.join(', ') + '.')
    }

    setSaving(true); setError('')

    const totals = calcTotals(items, form.delivery_fee, form.currency, form.discount_amount, form.vat_amount, form.discount_currency, packages, services, retailInvoices)
    const itemsInPrimary = items.filter(it => it.currency === form.currency).reduce((s, it) => s + lineTotal(it), 0)

    // Derive payment status from the payments list vs the order totals, per currency.
    const paidCur = paidByCurrency(payments)
    const derivedPaymentStatus = ['closed', 'refunded'].includes(form.payment_status)
      ? form.payment_status                         // preserve terminal states on edit
      : derivePaymentStatus(paidCur, totals)
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
      is_credit_order:      addCredit || (modal !== 'add' && modal?.is_credit_order === true),
      pickup_address:       form.pickup_address?.trim()  || null,
      delivery_address:     form.delivery_address.trim(),
      delivery_zone_id:     form.delivery_zone_id        || null,
      driver_id:            form.driver_id               || null,
      status:                   toDbStatus(form.status),
      delivery_status:          form.delivery_status || null,
      collection_from_customer: collectionStatus,
      payment_status:       derivedPaymentStatus,
      ...closeCols,
      delivery_fee:         Number(form.delivery_fee)    || 0,
      currency:             form.currency,
      items_total:          itemsInPrimary,
      discount_amount:      Math.abs(Number(form.discount_amount) || 0),
      discount_currency:    form.discount_currency || form.currency,
      vat_amount:           Number(form.vat_amount)      || 0,
      total_amount:         Math.max(0, totals[form.currency] || 0),
      order_type:            form.order_type                   || null,
      order_details_text:    form.order_details_text?.trim()   || null,
      special_instructions:  form.special_instructions?.trim() || null,
      scheduled_date:        form.scheduled_date               || null,
      scheduled_time_from:   form.scheduled_time_from          || null,
      scheduled_time_to:     form.scheduled_time_to            || null,
      // Staff-created orders are confirmed on creation (online orders arrive
      // unconfirmed and are confirmed via the globe popup) and are tagged as
      // entered by the call center.
      ...(modal === 'add' ? { order_confirmed: true, order_source: 'Call center' } : {}),
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }

    // Reuse the order from this session if one was already created (a previous
    // attempt that failed on a later step), so retries never duplicate the order.
    let orderId = (modal !== 'add' && modal?.id) || savedOrderIdRef.current || null
    // "recovering" = re-saving an order that was created earlier this session
    // (modal still 'add'); its child rows weren't tracked, so clear them first.
    const recovering = modal === 'add' && !!savedOrderIdRef.current

    let orderCompanyId = (modal !== 'add' && modal?.company_id) || COMPANY_ID || null
    if (!orderId) {
      const { data, error: e } = await supabase.from('delivery_orders').insert([payload]).select('id, company_id').single()
      if (e) { setError(e.message); setSaving(false); return }
      orderId = data.id
      orderCompanyId = data.company_id || orderCompanyId   // inherit company from the saved order
      savedOrderIdRef.current = orderId
    } else {
      const { error: e } = await supabase.from('delivery_orders').update(payload).eq('id', orderId)
      if (e) { setError(e.message); setSaving(false); return }
      // Soft-delete existing items
      await supabase.from('order_items').update({ is_deleted: true }).eq('order_id', orderId).eq('is_deleted', false)
      // Retail invoices have no soft-delete flag — replace the set outright.
      await supabase.from('retail_goods_invoices').delete().eq('order_id', orderId)
      // On a recovery retry, also clear children that were written untracked on
      // the failed attempt so they are not duplicated when re-saved below.
      if (recovering) {
        await supabase.from('delivery_packages').delete().eq('order_id', orderId)
        await supabase.from('order_services').delete().eq('order_id', orderId)
        await supabase.from('payment_collections').delete().eq('order_id', orderId)
        await supabase.from('account_transactions').delete().eq('order_id', orderId)
      }
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

    // Retail goods invoices — only rows with a shop selected.
    const retailRows = retailInvoices
      .filter(r => r.shop_name?.trim())
      .map(r => ({
        order_id:          orderId,
        shop_name:         r.shop_name.trim(),
        shop_type:         r.shop_type?.trim() || null,
        contact_id:        r.contact_id || null,
        contact_code:      r.contact_code?.trim() || null,
        invoice_reference: r.invoice_reference?.trim() || null,
        invoice_date:      r.invoice_date || new Date().toISOString().slice(0, 10),
        invoice_value:     Number(r.invoice_value) || 0,
        currency:          r.currency || 'USD',
        paid:              !!r.paid,
        payment_type:      r.payment_type || null,
        created_by:        currentUser?.user_id || null,
        ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      }))
    if (retailRows.length > 0) {
      const { error: re } = await supabase.from('retail_goods_invoices').insert(retailRows)
      if (re) { setError(re.message); setSaving(false); return }
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
      const row = {
        collection_type: p.method || 'cash',
        amount:          amt,
        currency:        p.currency || 'USD',
        collected_at:    p.paid_at || new Date().toISOString(),
        notes:           p.notes?.trim() || null,
      }
      // New payments are stamped with the signed-in user as the collector (paid to
      // office); edits keep whatever collector the row already had.
      const { error: pe } = p._id
        ? await supabase.from('payment_collections').update(row).eq('id', p._id)
        : await supabase.from('payment_collections').insert([{
            order_id:          orderId,
            ...row,
            collected_by:      currentUser?.user_id || null,
            collected_by_name: currentUserName,
          }])
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

    // ── Sync order services ────────────────────────────────────
    //    order_id and company_id are inherited from the order automatically.
    const svcErr = await saveOrderServices({
      orderId, services, origIds: origServiceIds,
      companyId: orderCompanyId,
      userId: currentUser?.user_id || null,
    })
    if (svcErr) { setError(svcErr); setSaving(false); return }

    // On "Mark Closed" the order is simply locked via the isclosed flag (set in
    // the update payload above). No account_transactions are posted.

    // ── Credit customer: on close with an unpaid balance, record a sales
    //    invoice so the customer shows up in v_credit_customer_balances. ───────
    if (close && selCustomer?.credit_debit_allowed === true) {
      const cur     = form.currency
      const total   = round2(totals[cur] || 0)
      const paid    = round2(paidCur[cur] || 0)
      const balance = round2(total - paid)
      if (balance > 0) {
        const orderNo = (modal && modal !== 'add') ? modal.order_number : String(orderId).slice(0, 8)
        const invoice = {
          customer_id:    form.customer_id,
          invoice_number: `SI-${orderNo}-${Date.now().toString().slice(-6)}`,
          invoice_date:   new Date().toISOString().slice(0, 10),
          currency:       cur,
          subtotal:       total,
          total_amount:   total,
          paid_amount:    paid,
          status:         paid > 0 ? 'partially_paid' : 'unpaid',
          notes:          `Auto-created on closing order ${orderNo} (credit customer).`,
          created_by:     currentUser?.user_id || null,
          ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
        }
        const { data: inv, error: sie } = await supabase.from('sales_invoices').insert([invoice]).select('id').single()
        if (sie) { setError(`Order closed, but recording the credit invoice failed: ${sie.message}`); setSaving(false); return }
        await supabase.from('sales_invoice_orders').insert([{ invoice_id: inv.id, order_id: orderId, amount: total }])
      }
    }

    await fetchOrders(); closeModal(); setSaving(false)
  }

  /* ── toggle cancel ───────────────────────────────────────── */

  /* ── quick actions (driver / status popovers) ────────────── */

  function openPopover(type, order, e) {
    if (isRowLocked(order)) return
    const rect = e.currentTarget.getBoundingClientRect()
    const width = type === 'driver' ? 240 : type === 'fee' ? 220 : 176
    setDriverQuickSearch('')
    if (type === 'fee') setFeeDraft({ amount: order.delivery_fee ?? '', currency: order.currency || 'USD' })
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
    const patch = { status: toDbStatus(uiStatus) }
    // Selecting "Completed" implies the materials reached the customer — move the
    // delivery status straight to Delivered so both stay in sync from the list.
    if (uiStatus === 'completed') patch.delivery_status = 'Delivered'
    await supabase.from('delivery_orders').update(patch).eq('id', order.id)
    await fetchOrders()
    setQuickBusy(false); setPopover(null)
  }

  // Quick delivery-fee edit from the list. Updates delivery_fee + currency and
  // recomputes total_amount (in the order's primary currency) so list totals and
  // the Amount(s) sort stay in sync.
  async function quickSaveFee(order, amount, currency) {
    setQuickBusy(true)
    const fee = Math.max(0, Number(amount) || 0)
    const totals = orderTotalsByCurrency({ ...order, delivery_fee: fee, currency })
    await supabase.from('delivery_orders').update({
      delivery_fee: fee,
      currency,
      total_amount: Math.max(0, totals[currency] || 0),
    }).eq('id', order.id)
    await fetchOrders()
    setQuickBusy(false); setPopover(null)
  }

  // Online order confirmation — sets the order_confirmed flag (not the status).
  async function quickConfirmOrder(order, confirmed = true) {
    setQuickBusy(true)
    await supabase.from('delivery_orders')
      .update({
        order_confirmed: confirmed,
        confirmed_at:    confirmed ? new Date().toISOString() : null,
        confirmed_by:    confirmed ? (currentUser?.user_id || null) : null,
      })
      .eq('id', order.id)
    await fetchOrders()
    setQuickBusy(false); setPopover(null)
  }

  // Toggle the manual flag on an order (delivery_orders.is_flagged). A flag is a
  // user marker independent of status, so it stays available even on locked rows.
  async function toggleFlag(o) {
    setToggling(o.id)
    await supabase.from('delivery_orders').update({ is_flagged: !isFlagged(o) }).eq('id', o.id)
    await fetchOrders()
    setToggling(null)
  }

  // Power button. Reactivating a cancelled/failed order is immediate; deactivating
  // an active one opens a confirmation modal that warns about — and then deletes —
  // every transaction on the order (see confirmCancel).
  async function toggleCancel(o) {
    if (o.isclosed) return                            // closed orders are locked
    if (['cancelled', 'failed'].includes(o.status)) {
      setToggling(o.id)
      await supabase.from('delivery_orders').update({ status: 'pending' }).eq('id', o.id)
      await fetchOrders()
      setToggling(null)
      return
    }
    // Open the deactivation confirmation, then load the transaction counts so the
    // warning can spell out exactly what will be deleted.
    setCancelModal({ order: o, reason: '', counts: null, loading: true, busy: false })
    const counts = await fetchOrderTxnCounts(o.id, o.delivery_fee)
    setCancelModal(m => (m && m.order.id === o.id ? { ...m, counts, loading: false } : m))
  }

  // Counts of each transaction kind attached to an order, used to warn the user
  // before a deactivation wipes them. Mirrors the tables confirmCancel clears.
  async function fetchOrderTxnCounts(orderId, deliveryFee) {
    const queries = [
      ['Packages',          supabase.from('delivery_packages').select('id', { count: 'exact', head: true }).eq('order_id', orderId)],
      ['Services',          supabase.from('order_services').select('id', { count: 'exact', head: true }).eq('order_id', orderId)],
      ['Local Items',       supabase.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', orderId).eq('is_deleted', false)],
      ['External Retails',  supabase.from('retail_goods_invoices').select('id', { count: 'exact', head: true }).eq('order_id', orderId)],
      ['Payments',          supabase.from('payment_collections').select('id', { count: 'exact', head: true }).eq('order_id', orderId)],
    ]
    const out = {}
    for (const [label, q] of queries) {
      const { count } = await q
      out[label] = count || 0
    }
    out['Delivery Fee'] = Number(deliveryFee) > 0 ? 1 : 0
    return out
  }

  // Confirm deactivation: delete every transaction on the order, zero the delivery
  // fee, set the status to cancelled and stamp who/why/when on the cancellation.
  async function confirmCancel() {
    const o = cancelModal?.order
    if (!o) return
    setCancelModal(m => ({ ...m, busy: true }))
    setToggling(o.id)
    // Packages, services, retail invoices and payments are hard-deleted; order
    // items follow the app's soft-delete convention (is_deleted flag).
    await supabase.from('delivery_packages').delete().eq('order_id', o.id)
    await supabase.from('order_services').delete().eq('order_id', o.id)
    await supabase.from('order_items').update({ is_deleted: true }).eq('order_id', o.id).eq('is_deleted', false)
    await supabase.from('retail_goods_invoices').delete().eq('order_id', o.id)
    await supabase.from('payment_collections').delete().eq('order_id', o.id)
    await supabase.from('delivery_orders').update({
      status:                    'cancelled',
      delivery_fee:              0,
      payment_status:            'unpaid',          // every payment record was just removed
      cancellation_reason:       cancelModal.reason.trim() || null,
      cancellation_requested_by: currentUser?.user_id || null,
      cancellation_requested_at: new Date().toISOString(),
    }).eq('id', o.id)
    await fetchOrders()
    setToggling(null)
    setCancelModal(null)
  }

  // One-click close from the list. Guarded by canQuickClose (fully collected +
  // Delivered), then locks the order via the isclosed flag — same columns the
  // edit modal's "Mark Closed" sets.
  async function markClosed(o) {
    if (!canQuickClose(o)) return
    setToggling(o.id)
    await supabase.from('delivery_orders').update({
      isclosed:  true,
      closed_at: new Date().toISOString(),
      closed_by: currentUser?.user_id || null,
    }).eq('id', o.id)
    await fetchOrders()
    setToggling(null)
  }

  async function copyNum(num) {
    await navigator.clipboard.writeText(num).catch(() => {})
    setCopied(num); setTimeout(() => setCopied(null), 1500)
  }

  // driver_id → latest assigned vehicle label (asset_code · make · model), shown
  // under the driver name in the daily list. Sourced from the drivers in context,
  // which already carry their most-recent vehicle assignment.
  const driverVehicle = {}
  for (const d of drivers) {
    const v = d.assigned_vehicle
    if (v) driverVehicle[d.id] = [v.asset_code, v.make, v.model].filter(Boolean).join(' · ')
  }

  /* ── totals (live) ───────────────────────────────────────── */

  const totals   = calcTotals(items, form.delivery_fee, form.currency, form.discount_amount, form.vat_amount, form.discount_currency, packages, services, retailInvoices)
  const anyItems = items.length > 0 || packages.length > 0 || services.length > 0 || retailInvoices.length > 0 || Number(form.delivery_fee) > 0

  // Credit Order mode: active when adding a credit order, or editing one.
  const isCreditOrder = addCredit || (modal && modal !== 'add' && modal.is_credit_order === true)
  // In credit mode the customer pickers list only credit-allowed contacts.
  const pickCustomers = isCreditOrder ? customers.filter(c => c.credit_debit_allowed === true) : customers
  // Shops/warehouses for the retail invoices dropdown = supplier contacts.
  // supplierByName maps a shop's display name → its contact, so selecting a
  // shop can auto-fill the invoice's business type (shop_type).
  const supplierByName    = {}
  customers.filter(c => c.contact_type === 'supplier').forEach(c => {
    const name = c.company_name || customerName(c)
    if (name) supplierByName[name] = c
  })
  const supplierOptions   = Object.keys(supplierByName)

  // Quick-pick suggestions for the pickup / delivery tag fields: the user's saved
  // locations, plus values already used on other orders (and supplier shops for
  // pickup), de-duped case-sensitively for display.
  const uniq = arr => [...new Set(arr.filter(Boolean))]
  const pickupSuggestions   = uniq([...savedPickup, ...supplierOptions,
    ...(orders ?? []).flatMap(o => splitLocs(o.pickup_address))])
  const deliverySuggestions = uniq([...savedDelivery,
    ...(orders ?? []).flatMap(o => splitLocs(o.delivery_address))])

  // Counts shown in the section titles.
  const packagesQty = packages.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
  const itemsQty    = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  const invoicesQty = retailInvoices.length

  const trimmedCustomer = customerInput.trim()
  const isNewCustomer =
    trimmedCustomer !== '' &&
    !form.customer_id &&
    !customers.some(c => customerName(c).toLowerCase() === trimmedCustomer.toLowerCase())

  const paidByCur     = paidByCurrency(payments)
  const paymentStatus = derivePaymentStatus(paidByCur, totals)
  const collectionFromCustomer = collectionFromPayStatus(paymentStatus)

  // A closed OR deactivated (cancelled/failed) order is locked: view-only, no edits.
  const orderLocked   = modal && modal !== 'add' && (modal.isclosed === true || isDeactivated(modal))
  const alreadyClosed = modal && modal !== 'add' && modal.isclosed === true
  // Credit customers may close an order with an unpaid balance (it becomes a receivable).
  const customerAllowsCredit = customers.find(c => c.id === form.customer_id)?.credit_debit_allowed === true
  // "Mark Closed" eligibility. Credit orders: driver assigned + Completed +
  // Delivered (no payment requirement). Normal orders: fully paid + Completed +
  // Delivered (payment waived for credit-allowed customers).
  const closeRequirements = []
  if (isCreditOrder) {
    if (!form.driver_id)                    closeRequirements.push('a driver assigned')
  } else if (paymentStatus !== 'paid_to_office' && !customerAllowsCredit) {
    closeRequirements.push('fully paid (no pending dues)')
  }
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

      {/* Toolbar — sticky top bar holding search, filters and actions */}
      <div className="sticky top-0 z-20 rounded-xl border border-blue-400/20 bg-gradient-to-r from-blue-950/80 via-slate-900/75 to-slate-800/80 backdrop-blur-md shadow-lg shadow-black/50 px-4 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input className={`input pl-9 ${search ? 'pr-9' : ''}`} placeholder={closed ? 'Search closed orders…' : 'Search orders…'}
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button type="button" onClick={() => setSearch('')} title="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {!closed && (
            <div className="flex items-center gap-1 flex-wrap">
              <Filter className="w-4 h-4 text-slate-500" />
              {STATUS_FILTERS.map(s => {
                const active = filter === s
                const cls = FILTER_VARIANTS[s] || STATUS_VARIANTS[s] || 'bg-slate-500/15 text-slate-400 border-slate-500/30'
                return (
                  <button key={s} onClick={() => setFilter(s)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border transition-all ${
                      active ? cls : 'border-surface-border text-slate-500 hover:text-slate-100 hover:bg-surface-hover'
                    }`}>
                    {FILTER_LABELS[s] || STATUS_LABELS[s] || s}
                  </button>
                )
              })}
            </div>
          )}
          {!closed && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="w-px h-5 bg-surface-border mx-1" />
              <Wallet className="w-4 h-4 text-slate-500" />
              {PAYMENT_FILTERS.map(s => {
                const active = payFilter === s
                const cls = s === '' ? FILTER_VARIANTS.all : (STATUS_VARIANTS[s] || 'bg-slate-500/15 text-slate-400 border-slate-500/30')
                return (
                  <button key={s || 'all'} onClick={() => setPayFilter(s)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border transition-all ${
                      active ? cls : 'border-surface-border text-slate-500 hover:text-slate-100 hover:bg-surface-hover'
                    }`}>
                    {s === '' ? 'All' : (STATUS_LABELS[s] || s)}
                  </button>
                )
              })}
            </div>
          )}
          {!closed && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="w-px h-5 bg-surface-border mx-1" />
              <Flag className="w-4 h-4 text-slate-500" />
              {FLAG_FILTERS.map(f => {
                const active = flagFilter === f.value
                return (
                  <button key={f.value || 'all'} onClick={() => setFlagFilter(f.value)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border transition-all ${
                      active ? f.cls : 'border-surface-border text-slate-500 hover:text-slate-100 hover:bg-surface-hover'
                    }`}>
                    {f.label}
                  </button>
                )
              })}
            </div>
          )}
          {!closed && (
            <div className="ml-auto flex items-center gap-2">
              <button className="btn-primary" onClick={openAdd}>
                <Plus className="w-4 h-4" /> Add Order
              </button>
            </div>
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
            <label className="label flex items-center gap-1"><UserCheck className="w-3 h-3" /> Customer type</label>
            <select className="input py-1.5 text-xs w-40" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="credit">Credit customers</option>
              <option value="regular">Regular customers</option>
              <option value="partner">Partners</option>
              <option value="supplier">Suppliers</option>
            </select>
          </div>
          <div>
            <label className="label flex items-center gap-1"><Package className="w-3 h-3" /> Order source</label>
            <select className="input py-1.5 text-xs w-36" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
              <option value="">All orders</option>
              <option value="LOCAL">Local orders</option>
              <option value="EXTERNAL">External orders</option>
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
              {['Order #','Recipient','Customer','Driver','Delivery Fee','Status','Payment',''].map(h => {
                const sortable = !!SORT_GETTERS[h]
                const active   = sort.col === h
                return (
                  <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">
                    {sortable ? (
                      <button type="button" onClick={() => toggleSort(h)}
                        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 transition-colors ${active ? 'text-brand-300' : ''}`}
                        title="Click to sort">
                        {h}
                        {active
                          ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                          : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                      </button>
                    ) : h}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody onMouseLeave={() => setHoverSummary(null)}>
            {loading.orders ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">{closed ? 'No closed orders found' : 'No orders found'}</td></tr>
            ) : sorted.map(o => (
              <tr key={o.id}
                onMouseEnter={(e) => setHoverSummary({ order: o, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => placeHoverPanel(hoverPanelRef.current, e.clientX, e.clientY)}
                className={`border-b border-surface-border/50 transition-colors ${
                isDeactivated(o) ? 'opacity-50 hover:bg-surface-hover/40'
                : isOverdue(o)   ? 'bg-red-500/10 hover:bg-red-500/20'
                :                  'hover:bg-surface-hover/40'} ${
                isConfirmed(o) ? '' : '[&_*]:!text-fuchsia-300'}`}>
                <td className="px-4 py-3">
                  {o.scheduled_date && (
                    <p className="text-slate-500 text-[11px] font-mono tracking-wider">{String(o.scheduled_date).slice(0, 10)}</p>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => copyNum(o.order_number)}
                      className="font-mono text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                      {o.order_number}
                      {copied === o.order_number && <Check className="w-3 h-3 text-green-400" />}
                    </button>
                    {isOnlineOrder(o) && (
                      <button type="button" disabled={isRowLocked(o)}
                        onClick={(e) => openPopover('online', o, e)}
                        title="Online order — confirm"
                        className="inline-flex text-cyan-400 hover:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Globe className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {(() => {
                    const remind = needsConfirmReminder(o, reminderMins, now)
                    return (
                      <button type="button" onClick={(e) => openPopover('online', o, e)} disabled={isRowLocked(o)}
                        title={remind ? 'This order has been placed but not confirmed — click to confirm' : 'Click to change confirmation'}
                        className={`inline-flex items-center gap-1 text-[10px] mt-1 px-1.5 py-0.5 rounded border transition-colors hover:brightness-125 disabled:opacity-60 disabled:cursor-not-allowed ${
                        isConfirmed(o)
                          ? 'text-green-400 bg-green-500/10 border-green-500/20'
                          : 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30'} ${
                        remind ? 'animate-blink ring-1 ring-fuchsia-400' : ''}`}>
                        {isConfirmed(o)
                          ? <Check className="w-3 h-3" />
                          : remind ? <BellRing className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {isConfirmed(o) ? 'Confirmed' : 'Not confirmed'}
                      </button>
                    )
                  })()}
                  {o.isclosed && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-400 mt-1 ml-1">
                      <Lock className="w-3 h-3" /> Closed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-slate-100 text-sm">{o.recipient_name}</p>
                  <p className="text-slate-500 text-xs">{formatMobile(o.recipient_mobile)}</p>
                  {o.pickup_address && (
                    <p className="text-slate-500 text-[11px] font-mono tracking-wider">From : {o.pickup_address}</p>
                  )}
                  {o.delivery_address && (
                    <p className="text-slate-500 text-[11px] font-mono tracking-wider">To : {o.delivery_address}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {o.customer ? (
                    <div>
                      <p className="text-slate-300 flex items-center gap-1.5">
                        {customerListName(o.customer)}
                        {o.customer.credit_debit_allowed && (
                          <span title="Credit customer — credit order" className="inline-flex text-amber-400">
                            <CreditCard className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </p>
                      {o.customer.account_number && (
                        <p className="text-slate-500 text-[11px] font-mono tracking-wider">{formatAccountNumber(o.customer.account_number)}</p>
                      )}
                    </div>
                  ) : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  <div className="flex items-center gap-1.5">
                    <button type="button" disabled={isRowLocked(o) || isPickedUp(o)}
                      onClick={(e) => openPopover('driver', o, e)}
                      title={o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : isPickedUp(o) ? 'Picked up — driver locked' : 'Assign driver'}
                      className="btn-ghost p-1 text-brand-400 hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Truck className="w-3.5 h-3.5" />
                    </button>
                    <div>
                      {o.driver ? `${o.driver.first_name} ${o.driver.last_name}` : <span className="text-slate-600">Unassigned</span>}
                      {!closed && o.driver && driverVehicle[o.driver_id] && (
                        <p className="text-slate-500 text-[11px] font-mono tracking-wider">{driverVehicle[o.driver_id]}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button type="button" disabled={isRowLocked(o)}
                    onClick={(e) => openPopover('fee', o, e)}
                    title={o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : 'Edit delivery fee'}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors hover:brightness-125 disabled:opacity-60 disabled:cursor-not-allowed ${
                      Number(o.delivery_fee) > 0
                        ? 'border-green-500/30 bg-green-500/10 text-green-300'
                        : 'border-surface-border bg-surface-hover text-slate-400'}`}>
                    <Wallet className="w-3.5 h-3.5" />
                    {fmtMoney(o.delivery_fee, o.currency)} {o.currency || 'USD'}
                  </button>
                  {Number(o.discount_amount) !== 0 && (
                    <p className="text-slate-500 text-[11px] font-mono tracking-wider mt-1">
                      Discount : {fmtMoney(Math.abs(Number(o.discount_amount)), o.discount_currency || o.currency)} {o.discount_currency || o.currency || 'USD'}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button type="button" disabled={isRowLocked(o)}
                    onClick={(e) => openPopover('status', o, e)}
                    title={o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : 'Change status'}
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
                    <button onClick={() => toggleFlag(o)} disabled={toggling === o.id}
                      title={isFlagged(o) ? 'Unflag order' : 'Flag order'}
                      className={`btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                        isFlagged(o)
                          ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                          : 'text-slate-500 hover:text-amber-400 hover:bg-amber-500/10'}`}>
                      <Flag className={`w-4 h-4 ${isFlagged(o) ? 'fill-amber-400' : ''}`} />
                    </button>
                    {isFullyPaid(o) ? (
                      <span title="Fully paid — nothing to collect"
                        className="p-1.5 inline-flex items-center text-green-400">
                        <CheckCircle2 className="w-4 h-4" />
                      </span>
                    ) : (
                      <button onClick={() => openPay(o)} disabled={isRowLocked(o)}
                        title={o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : 'Record payment'}
                        className="btn-ghost p-1.5 text-slate-500 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Banknote className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => openEdit(o)} className="btn-ghost p-1.5 text-slate-500"
                      title={isRowLocked(o) ? 'View (locked)' : 'Edit'}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {!closed && !o.isclosed && !isDeactivated(o) && (
                      <button onClick={() => markClosed(o)} disabled={toggling === o.id || !canQuickClose(o)}
                        title={canQuickClose(o)
                          ? (isCreditCustomerOrder(o) && !isFullyPaid(o) ? 'Mark as closed (credit customer — balance settled later)' : 'Mark as closed')
                          : (isCreditCustomerOrder(o) ? 'Can close once delivery status is Delivered' : 'Can close only when fully collected and delivery status is Delivered')}
                        className="btn-ghost p-1.5 text-slate-500 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Lock className="w-4 h-4" />
                      </button>
                    )}
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

      {/* ── Floating summary bar (filtered orders + per-currency totals) ── */}
      <div className="sticky bottom-0 z-10 pt-2 pb-1">
        {/* Expandable totals breakdown — grows up from the bar's toggle button. */}
        <div className={`overflow-hidden transition-all duration-300 ease-out ${totalsExpanded ? 'max-h-[60vh] opacity-100 mb-2' : 'max-h-0 opacity-0'}`}>
          <div className="rounded-xl border border-blue-400/20 bg-slate-900/95 backdrop-blur-md shadow-lg shadow-black/50 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-surface-border">
              <Receipt className="w-4 h-4 text-blue-300" />
              <span className="text-sm font-semibold text-slate-100">Totals breakdown</span>
              <span className="text-xs text-slate-500">· {pendingsSummary.count} filtered order{pendingsSummary.count === 1 ? '' : 's'}</span>
            </div>
            {totalsBreakdown.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500 text-center">No amounts for the current filter.</p>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-surface-border">
                      <th className="text-left py-1.5 pr-4 font-medium">Category</th>
                      {totalsBreakdown.map(r => (
                        <th key={r.cur} className="text-right py-1.5 pl-4 font-medium text-purple-400">{r.cur}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TOTALS_BREAKDOWN_ROWS.map(row => (
                      <tr key={row.key} className={row.strong ? 'border-t border-surface-border/60' : ''}>
                        <td className={`py-1 pr-4 ${row.strong ? 'text-slate-200 font-medium pt-1.5' : 'text-slate-500'}`}>{row.label}</td>
                        {totalsBreakdown.map(r => {
                          const v = r[row.key]
                          const cls =
                            row.tone === 'strong'  ? 'text-slate-100 font-medium' :
                            row.tone === 'emerald' ? 'text-emerald-300/90' :
                            row.tone === 'rose'    ? 'text-rose-300/90' :
                            row.tone === 'teal'    ? 'text-[#1dffd5] font-semibold [text-shadow:0_0_6px_rgba(29,255,213,0.6)]' :
                            row.tone === 'amber'   ? (v > 0 ? 'text-amber-300' : 'text-slate-500') :
                                                     'text-slate-300'
                          return (
                            <td key={r.cur} className={`text-right py-1 pl-4 ${row.strong ? 'pt-1.5' : ''} ${cls}`}>
                              {row.neg && v ? '−' : ''}{fmtAmount(Math.abs(v), r.cur)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-blue-400/20 bg-gradient-to-r from-blue-950/80 via-slate-900/75 to-slate-800/80 backdrop-blur-md shadow-lg shadow-black/50 px-5 py-3 flex items-center gap-4 flex-wrap">
          <button
            onClick={() => setTotalsExpanded(v => !v)}
            title={totalsExpanded ? 'Hide totals breakdown' : 'Show totals breakdown'}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${totalsExpanded ? 'border-blue-400/40 bg-blue-500/15 text-blue-200' : 'border-white/10 bg-white/5 text-slate-300 hover:text-blue-200 hover:border-blue-400/30'}`}>
            <Receipt className="w-4 h-4" />
            {totalsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <span className="flex items-center gap-2 text-sm text-slate-300">
            <Package className="w-4 h-4 text-blue-300" />
            <span className="font-semibold text-slate-100">{pendingsSummary.count}</span>
            {pendingsSummary.count === 1 ? 'order' : 'orders'}
          </span>
          <div className="flex items-center gap-3 flex-wrap ml-auto">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Total <span className="text-slate-500 normal-case">(fees + local retail)</span></span>
            {CURRENCIES.map(c => {
              const row = pendingsSummary.rows.find(r => r.cur === c)
              const total = row ? row.driverCollect : 0   // delivery fees + local retail items
              if (total <= 0) return null            // only show currencies with an amount
              return (
                <div key={c} className="text-sm whitespace-nowrap rounded-lg bg-white/5 border border-white/10 px-2.5 py-1">
                  <span className="text-slate-400 text-[11px] mr-1">{c}</span>
                  <span className="font-semibold text-blue-200">{total.toFixed(c === 'LBP' ? 0 : 2)}</span>
                </div>
              )
            })}
            {pendingsSummary.rows.every(r => r.driverCollect <= 0) && (
              <span className="text-sm text-slate-500">—</span>
            )}
            <span className="text-[11px] uppercase tracking-wider text-slate-400 ml-2">Payments <span className="text-slate-500 normal-case">(collected)</span></span>
            {CURRENCIES.map(c => {
              const row = pendingsSummary.rows.find(r => r.cur === c)
              const paid = row ? row.paid : 0   // total collected from customers
              if (paid <= 0) return null         // only show currencies with an amount
              return (
                <div key={c} className="text-sm whitespace-nowrap rounded-lg bg-white/5 border border-white/10 px-2.5 py-1">
                  <span className="text-slate-400 text-[11px] mr-1">{c}</span>
                  <span className="font-semibold text-emerald-300">{paid.toFixed(c === 'LBP' ? 0 : 2)}</span>
                </div>
              )
            })}
            {pendingsSummary.rows.every(r => r.paid <= 0) && (
              <span className="text-sm text-slate-500">—</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal ─────────────────────────────────────────────── */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-5xl flex flex-col" style={{ maxHeight: '92vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand-400" />
                {modal === 'add'
                  ? (isCreditOrder ? 'Credit Order' : 'New Order')
                  : `${isCreditOrder ? 'Credit Order' : 'Edit'} — ${modal.order_number}`}
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

              <fieldset disabled={orderLocked} className="space-y-3 min-w-0 border-0 p-0 m-0 disabled:opacity-70">

              {/* ── Order Type (top, above Customer) ───────────── */}
              <CollapsibleSection title="Order Type" open={sectionsOpen.order_type} onToggle={v => toggleSection('order_type', v)}>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label">Order Type</label>
                    {!addingType && (
                      <button type="button" onClick={() => { setAddingType(true); setNewTypeName('') }}
                        className="text-[11px] text-brand-400 hover:text-brand-300 mb-1">
                        <Plus className="w-3 h-3 inline -mt-0.5" /> New type
                      </button>
                    )}
                  </div>
                  {addingType ? (
                    <div className="flex items-center gap-1.5">
                      <input autoFocus className="input" value={newTypeName}
                        onChange={e => setNewTypeName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createOrderType() } }}
                        placeholder="New order type" />
                      <button type="button" onClick={createOrderType} disabled={typeBusy || !newTypeName.trim()}
                        className="btn-primary px-2 py-2 disabled:opacity-50" title="Create order type">
                        <Check className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => { setAddingType(false); setNewTypeName('') }}
                        className="btn-ghost p-2 text-slate-500" title="Cancel">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <select className="input" value={form.order_type || ''}
                      onChange={e => fld('order_type', e.target.value)}>
                      <option value="">—</option>
                      {ORDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      {orderTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      {form.order_type
                        && !ORDER_TYPES.some(t => t.value === form.order_type)
                        && !orderTypes.some(t => t.name === form.order_type)
                        && <option value={form.order_type}>{form.order_type}</option>}
                    </select>
                  )}
                </div>
              </CollapsibleSection>

              {/* ── Recipient & Customer ───────────────────────── */}
              <CollapsibleSection title="Recipient & Customer" open={sectionsOpen.customer} onToggle={v => toggleSection('customer', v)}>

                {/* Customer first — drives auto-fill. Type to search/add, or use the picker button. */}
                <div>
                  <label className="label text-fuchsia-300">Customer *</label>
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
                          const list = pickCustomers.filter(c =>
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
                                    <p className="text-slate-500 text-xs truncate">{formatMobile(c.mobile)}</p>
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
                    <label className="label text-fuchsia-300">Recipient Name *</label>
                    <input className="input" value={form.recipient_name}
                      onChange={e => fld('recipient_name', e.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div>
                    <label className="label text-fuchsia-300">Mobile *</label>
                    <MobileInput value={form.recipient_mobile} onChange={v => fld('recipient_mobile', v)} />
                  </div>
                </div>

                <div>
                  <label className="label">WhatsApp</label>
                  <MobileInput value={form.recipient_whatsapp} onChange={v => fld('recipient_whatsapp', v)} placeholder="If different from mobile" />
                </div>
              </CollapsibleSection>

              {/* ── Route ─────────────────────────────────────── */}
              <CollapsibleSection title="Route" open={sectionsOpen.route} onToggle={v => toggleSection('route', v)}>
                <div className="grid grid-cols-2 gap-3">
                  <TagLocationField
                    label="Pickup / Origin"
                    tags={splitLocs(form.pickup_address)}
                    setTags={arr => fld('pickup_address', joinLocs(arr))}
                    suggestions={pickupSuggestions}
                    onAddNew={rememberPickup}
                    placeholder="Add warehouse / pickup…" />
                  <TagLocationField
                    label="Delivery Address" required
                    tags={splitLocs(form.delivery_address)}
                    setTags={arr => fld('delivery_address', joinLocs(arr))}
                    suggestions={deliverySuggestions}
                    onAddNew={rememberDelivery}
                    placeholder="Add delivery address…" />
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
              </CollapsibleSection>

              {/* ── Assignment & Status ────────────────────────── */}
              <CollapsibleSection title="Assignment & Status" accent="fuchsia" open={sectionsOpen.assignment} onToggle={v => toggleSection('assignment', v)}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Driver</label>
                    <select className="input disabled:opacity-60 disabled:cursor-not-allowed"
                      value={form.driver_id} onChange={e => fld('driver_id', e.target.value)}
                      disabled={isPickedUp(form)}
                      title={isPickedUp(form) ? 'Picked up — driver can no longer be changed' : undefined}>
                      <option value="">— Unassigned —</option>
                      {drivers.filter(d => ['available','on_duty'].includes(d.driver_status)).map(d => (
                        <option key={d.id} value={d.id}>{d.first_name} {d.last_name}</option>
                      ))}
                    </select>
                    {isPickedUp(form) && (
                      <p className="text-[11px] text-slate-500 mt-1">Locked — driver already picked up the order.</p>
                    )}
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
              </CollapsibleSection>

              {/* ── Delivery Packages (always shown) ──────────── */}
              <CollapsibleSection title={`Delivery Packages (${packagesQty})`} open={sectionsOpen.packages} onToggle={v => toggleSection('packages', v)}
                right={
                  <button type="button" onClick={addPackage}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Package
                  </button>
                }>
                <OrderPackages packages={packages} setPackages={setPackages} providers={providers} customerName={customerInput.trim()} embedded onAdd={addPackage} />
              </CollapsibleSection>

              {/* ── Order Services ────────────────────────────── */}
              <CollapsibleSection title={`Order Services (${services.length})`} open={sectionsOpen.services} onToggle={v => toggleSection('services', v)}
                right={
                  <button type="button" onClick={() => { openSection('services'); setServices(s => [...s, { ...EMPTY_SERVICE, _key: Date.now() }]) }}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Service
                  </button>
                }>
                <OrderServices services={services} setServices={setServices}
                  suppliers={customers.filter(c => c.contact_type === 'supplier')}
                  embedded onAdd={() => setServices(s => [...s, { ...EMPTY_SERVICE, _key: Date.now() }])} />
              </CollapsibleSection>

              {/* Pricing sections (hidden for Credit Orders) */}
              {!isCreditOrder && (<>
              {/* ── Items ─────────────────────────────────────── */}
              <div id="order-section-items" className="scroll-mt-4" />
              <CollapsibleSection title={`Local retail items (${itemsQty})`} open={sectionsOpen.items} onToggle={v => toggleSection('items', v)}
                right={
                  <button type="button" onClick={() => { openSection('items'); addItem() }}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Item
                  </button>
                }>

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
              </CollapsibleSection>

              {/* ── External Retails Invoices References (retail_goods_invoices) ── */}
              <CollapsibleSection title={`External retails invoices references (${invoicesQty})`} open={sectionsOpen.retail_invoices} onToggle={v => toggleSection('retail_invoices', v)}
                right={
                  <button type="button" onClick={() => { openSection('retail_invoices'); addRetailInvoice() }}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Invoice
                  </button>
                }>

                <div className="border border-surface-border rounded-xl overflow-x-auto">
                  <table className="w-full text-xs min-w-[860px]">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-[22%]">Warehouse / Shop</th>
                        <th className="text-left px-3 py-2 w-[14%]">Invoice Ref</th>
                        <th className="text-left px-3 py-2 w-[12%]">Date</th>
                        <th className="text-left px-3 py-2 w-[11%]">Amount</th>
                        <th className="text-left px-3 py-2 w-[9%]">Currency</th>
                        <th className="text-left px-3 py-2 w-[13%]">Paid</th>
                        <th className="text-left px-3 py-2 w-[15%]">Payment Type</th>
                        <th className="w-[4%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {retailInvoices.length === 0 ? (
                        <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-600">No invoices — click "Add Invoice"</td></tr>
                      ) : retailInvoices.map((ri, idx) => (
                        <tr key={ri._id ?? ri._key ?? idx} className="border-t border-surface-border/50">
                          <td className="px-3 py-2 align-top">
                            <select className="input py-1.5 text-xs" value={ri.shop_name}
                              onChange={e => {
                                const name = e.target.value
                                const prevName = retailInvoices[idx]?.shop_name || ''
                                // Auto-fill business type + the contact link/code from the selected supplier.
                                const sup = supplierByName[name]
                                const next = retailInvoices.map((r, j) => j === idx ? {
                                  ...r,
                                  shop_name:    name,
                                  shop_type:    sup?.shop_type || '',
                                  contact_id:   sup?.id || '',
                                  contact_code: sup?.code || '',
                                } : r)
                                setRetailInvoices(next)
                                // Keep pickup tags in sync: drop the old shop (if unused
                                // elsewhere) and add the newly selected one.
                                if (prevName.toLowerCase() !== name.toLowerCase()) dropPickupTagIfUnused(prevName, next)
                                addPickupTag(name)
                              }}>
                              <option value="">— Select —</option>
                              {ri.shop_name && !supplierOptions.includes(ri.shop_name) && (
                                <option value={ri.shop_name}>{ri.shop_name}</option>
                              )}
                              {supplierOptions.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            {(ri.shop_type || ri.contact_code) && (
                              <p className="text-[10px] text-slate-500 mt-0.5 flex gap-2">
                                {ri.contact_code && <span className="font-mono text-slate-400">{ri.contact_code}</span>}
                                {ri.shop_type && <span className="capitalize">{ri.shop_type}</span>}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <input className="input py-1.5 text-xs" value={ri.invoice_reference}
                              onChange={e => setRetailInvoice(idx, 'invoice_reference', e.target.value)} placeholder="Ref / #" />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <input type="date" className="input py-1.5 text-xs" value={ri.invoice_date}
                              onChange={e => setRetailInvoice(idx, 'invoice_date', e.target.value)} />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={ri.invoice_value}
                              onChange={e => setRetailInvoice(idx, 'invoice_value', e.target.value)} placeholder="0.00" />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <select className="input py-1.5 text-xs" value={ri.currency}
                              onChange={e => setRetailInvoice(idx, 'currency', e.target.value)}>
                              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <button type="button" onClick={() => setRetailInvoice(idx, 'paid', !ri.paid)}
                              aria-pressed={!!ri.paid}
                              title={ri.paid ? 'Paid directly to shop — excluded from order total' : 'Not paid — counted in order total'}
                              className={`inline-flex items-center gap-1.5 w-full justify-center py-1.5 px-2 rounded-lg text-[11px] font-medium border whitespace-nowrap transition-colors select-none
                                ${ri.paid
                                  ? 'bg-green-500/15 border-green-500/40 text-green-300'
                                  : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
                              {ri.paid ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 flex-shrink-0" />}
                              {ri.paid ? 'Paid' : 'Not paid'}
                            </button>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <select className="input py-1.5 text-xs" value={ri.payment_type}
                              disabled={!ri.paid}
                              onChange={e => setRetailInvoice(idx, 'payment_type', e.target.value)}>
                              <option value="">—</option>
                              {PAYMENT_METHODS.map(pm => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <button onClick={() => removeRetailInvoice(idx)} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleSection>

              {/* ── Delivery Fees & Totals ─────────────────────── */}
              <CollapsibleSection title="Delivery & Totals" accent="fuchsia" open={true} onToggle={() => {}}>

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
                          {isPrimary && <p className="text-[10px] text-slate-500 mt-0.5">items + packages + services + retail + fee − discount + vat</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CollapsibleSection>
              </>)}

              {/* ── Payments ──────────────────────────────────── */}
              {/* Outside the credit-order block: payments (incl. quick-Pay from
                  the list) must be visible/editable on every order. */}
              <CollapsibleSection title="Payments" accent="blue" open={sectionsOpen.payments} onToggle={v => toggleSection('payments', v)}
                right={
                  <button type="button" onClick={() => { openSection('payments'); addPayment() }}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Payment
                  </button>
                }>

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
              </CollapsibleSection>

              {/* ── Notes ─────────────────────────────────────── */}
              <CollapsibleSection title="Notes" open={sectionsOpen.notes} onToggle={v => toggleSection('notes', v)}>
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
              </CollapsibleSection>
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
                const list = pickCustomers.filter(c =>
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
                          <Phone className="w-3 h-3" />{formatMobile(c.mobile)}
                        </span>
                        {c.whatsapp_number && c.whatsapp_number !== c.mobile && (
                          <span className="text-slate-500 text-xs flex items-center gap-1">
                            <Phone className="w-3 h-3 text-green-500" />{formatMobile(c.whatsapp_number)}
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

      {/* ── Quick Pay modal ────────────────────────────────────── */}
      {payModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
          <div className="card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-green-400" /> Record Payment
                </h2>
                <p className="text-xs mt-0.5">
                  <span className="font-mono text-brand-400">{payModal.order_number}</span>
                  {payModal.customer && <span className="text-slate-500"> · {customerListName(payModal.customer)}</span>}
                </p>
              </div>
              <button onClick={closePay} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            {/* Order totals vs already paid, per currency */}
            {(() => {
              const totals = orderTotalsByCurrency(payModal)
              const rows = PAYMENT_CURRENCIES
                .map(cur => ({ cur, total: round2(totals[cur] || 0), paid: round2(payPaid[cur] || 0) }))
                .filter(r => r.total > 0 || r.paid > 0)
              if (rows.length === 0) return null
              return (
                <div className="rounded-lg border border-surface-border bg-surface-hover px-3 py-2 text-xs space-y-1">
                  {rows.map(r => {
                    const dp = r.cur === 'LBP' ? 0 : 2
                    const pending = round2(r.total - r.paid)
                    return (
                      <div key={r.cur} className="flex items-center justify-between">
                        <span className="text-slate-500 font-semibold">{r.cur}</span>
                        <span className="text-slate-300">
                          Total {r.total.toFixed(dp)} · Paid {r.paid.toFixed(dp)} ·{' '}
                          <span className={pending > 0 ? 'text-yellow-400' : pending < 0 ? 'text-cyan-400' : 'text-green-400'}>
                            Pending {pending.toFixed(dp)}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Method</label>
                <select className="input" value={payForm.method} onChange={e => setPayFld('method', e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Currency</label>
                <select className="input" value={payForm.currency} onChange={e => setPayFld('currency', e.target.value)}>
                  {PAYMENT_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Amount</label>
                <input type="number" min="0" step="0.01" className="input" value={payForm.amount}
                  onChange={e => setPayFld('amount', e.target.value)} placeholder="0.00" autoFocus />
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={payForm.paid_at}
                  onChange={e => setPayFld('paid_at', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" value={payForm.notes} onChange={e => setPayFld('notes', e.target.value)} placeholder="Optional" />
            </div>

            {payError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{payError}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={closePay}>Cancel</button>
              <button className="btn-primary" onClick={savePayment} disabled={paySaving || !(round2(payForm.amount) > 0)}>
                <Check className="w-4 h-4" /> {paySaving ? 'Saving…' : 'Record Payment'}
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
                {hasAdvancedFilters || filter !== 'all' || payFilter || search ? ' (current filters applied)' : ''}.
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

      {/* ── Amounts hover preview (follows the cursor; read-only) ── */}
      {showSummary && hoverSummary && !popover && (
        <div ref={hoverPanelRef}
          className="fixed z-[55] pointer-events-none card border border-surface-border rounded-lg shadow-xl overflow-hidden"
          style={{ left: hoverSummary.x + 16, top: hoverSummary.y + 16, width: 340 }}>
          <AmountSummaryContent order={hoverSummary.order} />
        </div>
      )}

      {/* ── Quick action popover (driver / status) ─────────────── */}
      {popover && (
        <div className="fixed inset-0 z-[60]" onClick={() => !quickBusy && setPopover(null)}>
          <div
            className="absolute card border border-surface-border rounded-lg shadow-xl overflow-hidden"
            style={{ top: popover.y, left: popover.x, width: popover.type === 'driver' ? 240 : popover.type === 'fee' ? 220 : 176 }}
            onClick={e => e.stopPropagation()}>

            {popover.type === 'driver' ? (
              <>
                <div className="p-2 border-b border-surface-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input ref={driverSearchRef} autoFocus className={`input pl-8 py-1.5 text-xs ${driverQuickSearch ? 'pr-8' : ''}`} placeholder="Search driver…"
                      value={driverQuickSearch} onChange={e => setDriverQuickSearch(e.target.value)} />
                    {driverQuickSearch && (
                      <button type="button" onClick={() => { setDriverQuickSearch(''); driverSearchRef.current?.focus() }} title="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
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
                          <p className="text-slate-500 text-[10px] truncate">{formatMobile(d.mobile)}</p>
                        </div>
                        {popover.order.driver_id === d.id && <Check className="w-3 h-3 text-green-400 ml-auto flex-shrink-0" />}
                      </button>
                    ))}
                  {drivers.length === 0 && <p className="px-3 py-3 text-xs text-slate-500 text-center">No drivers</p>}
                </div>
              </>
            ) : popover.type === 'online' ? (
              <div className="p-1">
                {[{ val: true, label: 'Confirmed' }, { val: false, label: 'Not confirmed' }].map(opt => {
                  const active = isConfirmed(popover.order) === opt.val
                  return (
                    <button key={String(opt.val)} onClick={() => quickConfirmOrder(popover.order, opt.val)} disabled={quickBusy}
                      className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-surface-hover ${active ? 'bg-surface-hover' : ''}`}>
                      {opt.val
                        ? <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                        : <AlertCircle className="w-4 h-4 text-fuchsia-300 flex-shrink-0" />}
                      <span className={`text-xs ${opt.val ? 'text-green-300' : 'text-fuchsia-300'}`}>{opt.label}</span>
                      {active && <Check className="w-3.5 h-3.5 text-green-400 ml-auto" />}
                    </button>
                  )
                })}
              </div>
            ) : popover.type === 'fee' ? (
              <div className="p-3 space-y-2.5">
                <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Delivery Fee</p>
                <div className="flex items-center gap-1.5">
                  <input type="number" min="0" step="0.01" autoFocus
                    className="input flex-1 min-w-0 py-1.5 text-xs"
                    value={feeDraft.amount}
                    onChange={e => setFeeDraft(f => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00" />
                  <select className="input w-[68px] py-1.5 text-xs"
                    value={feeDraft.currency}
                    onChange={e => setFeeDraft(f => ({ ...f, currency: e.target.value }))}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <button type="button" disabled={quickBusy}
                  onClick={() => setFeeDraft(f => ({ ...f, amount: '0' }))}
                  className="w-full text-[11px] px-2 py-1.5 rounded border border-surface-border text-slate-400 hover:text-slate-100 hover:bg-surface-hover transition-colors disabled:opacity-50">
                  Clear
                </button>
                <button type="button" disabled={quickBusy}
                  onClick={() => quickSaveFee(popover.order, feeDraft.amount, feeDraft.currency)}
                  className="w-full text-xs px-2 py-1.5 rounded bg-brand-600 text-white hover:bg-brand-500 transition-colors disabled:opacity-50">
                  {quickBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
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

      {/* ── Deactivate-order confirmation ───────────────────────── */}
      {cancelModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !cancelModal.busy && setCancelModal(null)}>
          <div className="card border border-red-500/30 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 p-4 border-b border-surface-border bg-red-500/10">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-slate-100 font-semibold">Deactivate order {cancelModal.order.order_number}?</h3>
                <p className="text-slate-400 text-xs mt-1">
                  This will permanently delete every transaction on the order, set the delivery fee to 0 and mark the order Cancelled. This cannot be undone.
                </p>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {cancelModal.loading ? (
                <p className="text-slate-500 text-xs">Checking transactions…</p>
              ) : (() => {
                const present = Object.entries(cancelModal.counts || {}).filter(([, n]) => n > 0)
                return present.length > 0 ? (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <p className="text-[11px] text-red-300 uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
                      <Trash2 className="w-3.5 h-3.5" /> Will be removed
                    </p>
                    <ul className="space-y-1">
                      {present.map(([label, n]) => (
                        <li key={label} className="flex items-center justify-between text-xs text-slate-300">
                          <span>{label}</span>
                          <span className="font-mono text-red-300">{label === 'Delivery Fee' ? 'set to 0' : `${n} ✕`}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs">No transactions on this order — it will simply be marked Cancelled.</p>
                )
              })()}

              <div>
                <label className="label">Reason for cancellation <span className="text-slate-600">(optional)</span></label>
                <textarea rows={3} className="input resize-none" placeholder="Why is this order being cancelled?"
                  value={cancelModal.reason}
                  onChange={e => setCancelModal(m => ({ ...m, reason: e.target.value }))} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-surface-border">
              <button type="button" disabled={cancelModal.busy}
                onClick={() => setCancelModal(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-surface-hover transition-colors disabled:opacity-50">
                Keep order
              </button>
              <button type="button" disabled={cancelModal.busy || cancelModal.loading}
                onClick={confirmCancel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50">
                <Power className="w-3.5 h-3.5" />
                {cancelModal.busy ? 'Deactivating…' : 'Deactivate & delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
