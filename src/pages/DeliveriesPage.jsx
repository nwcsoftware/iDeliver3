import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Plus, Search, Filter, X, Check, Trash2, AlertTriangle,
  Edit2, Power, AlertCircle, Package, RotateCcw, RotateCw,
  Phone, Mail, MapPin, UserCheck, UserPlus, Wallet, Calendar, Truck, Lock, Unlock, ChevronRight, Globe, Banknote, CreditCard,
  ChevronUp, ChevronDown, ChevronsUpDown, CheckCircle2, Circle, Receipt, Flag, BellRing, Tag,
  Eye, Pin, PinOff, User, Building, Handshake,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { generateAccountNumber, ensureUniqueAccountNumber, insertContactWithUniqueCode, formatAccountNumber } from '../lib/accountNumber'
import { formatMobile } from '../lib/phone'
import { buildOrderGroups, defaultOpenGroup } from '../lib/orderGroups'
import {
  resolveSubAccount, subAccountBalance, checkSubAccountCharge,
  isSubAccountExpired, isUnlimited, ensurePrimarySubAccount,
} from '../lib/subAccounts'
import { orderTotalsByCurrency, orderCollectedByCurrency, orderDriverCollectByCurrency, orderAmountBreakdown, AmountSummaryContent, placeHoverPanel, fmtAmount, paymentByDriver } from '../lib/orderAmounts'
import MobileInput from '../components/MobileInput'
import Badge, { variants as STATUS_VARIANTS, labels as STATUS_LABELS } from '../components/ui/Badge'
import ContactFormFields from '../components/contacts/ContactFormFields'
import ContactAddresses from '../components/contacts/ContactAddresses'
import MapPicker from '../components/contacts/MapPicker'
import { saveContactAddresses } from '../lib/contactAddresses'
import { buildContactExtraFields, contactTypeExtras } from '../lib/contactFields'
import OrderPackages, { EMPTY_PACKAGE } from '../components/orders/OrderPackages'
import { saveOrderPackages } from '../lib/orderPackages'
import OrderServices, { EMPTY_SERVICE } from '../components/orders/OrderServices'
import { saveOrderServices } from '../lib/orderServices'
import TagLocationField from '../components/orders/TagLocationField'
import ContactCombobox from '../components/orders/ContactCombobox'
import { getSavedLocations, addSavedLocation, renameSavedLocation, removeSavedLocation, getHiddenLocations, hideLocation } from '../lib/savedLocations'

/* ── constants ───────────────────────────────────────────── */

// Order lifecycle status (stored values + display labels)
const ORDER_STATUS_OPTIONS = [
  { value: 'scheduled',   label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed' },
]
// Picking an order status moves the delivery status to the matching stage so the
// two stay in sync (same behaviour as the quick status change in the list).
const STATUS_DELIVERY_MAP = {
  completed:   'Delivered',
  in_progress: 'In Transit',
  scheduled:   'Awaiting Pickup',
}
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
// Customer-type filter options (multi-select). An empty selection means "All types".
const CATEGORY_OPTIONS = [
  { value: 'credit',   label: 'Credit customers' },
  { value: 'regular',  label: 'Regular customers' },
  { value: 'partner',  label: 'Partners' },
  { value: 'supplier', label: 'Suppliers' },
]
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
function isRowLocked(o)   { return o?.isclosed === true || o?.is_locked === true || isDeactivated(o) }

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

// "Ads & Services" (Story) orders: a lightweight order nature stored in the same
// delivery_orders table with order_type = 'Story'. They carry no route, driver,
// delivery status, packages, market invoices, third-party services or delivery
// fee — just a customer, order status, scheduled date, their line items + payment.
const STORY_ORDER_TYPE = 'Story'
function isStoryOrder(o) { return (o?.order_type || '').trim().toLowerCase() === STORY_ORDER_TYPE.toLowerCase() }

// Data-integrity checks for the daily-orders "Check orders" audit popup. Returns a
// list of human-readable warnings for one order (empty = no issues).
function orderWarnings(o) {
  const w = []
  if (isDeactivated(o)) return w                         // cancelled/failed: not audited
  const story     = isStoryOrder(o)                      // no delivery concept
  const completed = normalizeStatus(o?.status) === 'completed'
  const delivered = story ? true : o?.delivery_status === 'Delivered'   // story: N/A → treat as met
  const free      = o?.is_free_order === true

  const r2     = n => Math.round((Number(n) || 0) * 100) / 100
  const totals = orderTotalsByCurrency(o)
  const paid   = orderCollectedByCurrency(o)
  const curs   = new Set([...Object.keys(totals), ...Object.keys(paid)])
  const totalPositive  = [...curs].some(c => r2(totals[c]) > 0)
  // Fully collected = there's a real total and no currency is short.
  const fullyCollected = totalPositive && [...curs].every(c => r2(paid[c]) >= r2(totals[c]) - 0.009)

  // 1) Normal (non-credit, non-free) customers pay cash. Credit customers may
  //    legitimately close unpaid / partially paid, so they're skipped here.
  //    • If a payment exists, the total must match it — flag any mismatch.
  //    • If NO payment exists, it's only a problem once the scheduled time has
  //      passed (a future/in-progress order simply hasn't been collected yet).
  if (!isCreditCustomerOrder(o) && !free) {
    const hasPayments = [...curs].some(c => r2(paid[c]) > 0)
    if (hasPayments) {
      const diffs = []
      for (const c of curs) {
        const t = r2(totals[c]); const p = r2(paid[c])
        if (Math.abs(t - p) > 0.009) diffs.push(`${c}: total ${fmtAmount(t, c)} ≠ collected ${fmtAmount(p, c)}`)
      }
      if (diffs.length) w.push(`Total ≠ payments — ${diffs.join('; ')}`)
    } else if (totalPositive) {
      const dl = orderDeadline(o)
      if (dl && dl.getTime() < Date.now()) {
        w.push('No payment recorded and the scheduled time has passed')
      }
    }
  }
  // 2) Order marked Completed while the goods aren't Delivered yet.
  if (completed && !delivered) {
    w.push(`Order status is Completed but delivery status is “${o?.delivery_status || '—'}” (not Delivered)`)
  }
  // 3) Order closed while it isn't Delivered and/or isn't Completed.
  if (o?.isclosed === true && (!delivered || !completed)) {
    const parts = []
    if (!delivered) parts.push(`delivery status is “${o?.delivery_status || '—'}” (not Delivered)`)
    if (!completed) parts.push(`order status is “${normalizeStatus(o?.status) || '—'}” (not Completed)`)
    w.push(`Order is closed but ${parts.join(' and ')}`)
  }
  // 4) Money fully collected, but the order isn't Completed and/or not Delivered.
  if (!free && fullyCollected && (!completed || !delivered)) {
    const parts = []
    if (!completed) parts.push(`order status is “${normalizeStatus(o?.status) || '—'}” (not Completed)`)
    if (!delivered) parts.push(`delivery status is “${o?.delivery_status || '—'}” (not Delivered)`)
    w.push(`Money fully collected but ${parts.join(' and ')}`)
  }
  return w
}

// Quick "Mark Closed" from the list is allowed once the materials are Delivered.
// Normally the money must also be fully collected, but a credit customer may close
// with an unpaid balance — they settle their dues later from the Credit Customers
// page. The row must not already be closed/deactivated. The edit modal keeps the
// fuller close flow (status Completed); this is the one-click shortcut.
function canQuickClose(o) {
  if (!isConfirmed(o)) return false                 // must be confirmed before it can be worked/closed
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

// The scheduled START (pickup) time = scheduled_date at scheduled_time_from
// (else _to, else start of day). Used to highlight orders that are about to start.
function orderScheduledStart(o) {
  if (!o?.scheduled_date) return null
  const d = String(o.scheduled_date).slice(0, 10)
  const t = String(o.scheduled_time_from || o.scheduled_time_to || '00:00').slice(0, 5)
  const dt = new Date(`${d}T${t}`)
  return isNaN(dt.getTime()) ? null : dt
}

// Display a scheduled time range "03:30 PM – 04:30 PM" (or one side if only one set).
function fmtTimeRange(from, to) {
  const f = fmtTime12(from)
  const t = fmtTime12(to)
  if (f && t) return `${f} – ${t}`
  return f || t
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

// Approaching scheduled time = an active order whose row should turn red as a
// reminder it is about to start. The trigger is simply:
//   now >= (scheduled start time − leadMins)
// i.e. once the current time passes "scheduled time minus the timer", the row
// stays highlighted (it remains a reminder until the order is delivered/closed).
// `leadMins <= 0` disables it.
function isApproachingStart(o, leadMins, nowMs) {
  if (!(leadMins > 0)) return false
  if (!o || o.isclosed) return false
  if (!['scheduled', 'confirmed', 'in_progress'].includes(normalizeStatus(o.status))) return false
  const start = orderScheduledStart(o)
  if (!start) return false
  return nowMs >= start.getTime() - leadMins * 60 * 1000
}

// Local YYYY-MM-DD for a timestamp (matches how scheduled_date is stored/compared).
function localDateStr(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Past the scheduled delivery end time, on the scheduled date itself, and not yet
// completed. The row's text turns salmon red to flag a delivery that overran its
// window today (only on the scheduled date — not on later days).
function isPastDeliveryEnd(o, nowMs) {
  if (!o || o.isclosed) return false
  if (normalizeStatus(o.status) === 'completed') return false
  const end = orderDeadline(o)
  if (!end) return false
  if (String(o.scheduled_date).slice(0, 10) !== localDateStr(nowMs)) return false   // same date only
  return nowMs > end.getTime()
}

// An in-progress order that is still under way — its scheduled deadline has not
// passed. These show the in-progress (brand) row colour regardless of whether
// `now` is inside the scheduled window yet; only once the deadline is overrun do
// they turn red (see isOverdue / isPastDeliveryEnd).
function isActiveInProgress(o, nowMs) {
  if (!o || o.isclosed) return false
  if (normalizeStatus(o.status) !== 'in_progress') return false
  return !isOverdue(o) && !isPastDeliveryEnd(o, nowMs)
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
  customer_id: '', main_account: '', sub_account_id: '', pickup_address: '', delivery_address: '',
  delivery_lat: '', delivery_lng: '',
  delivery_zone_id: '', driver_id: '',
  status: 'scheduled', delivery_status: 'Awaiting Pickup', payment_status: 'unpaid',
  delivery_fee: '', currency: 'USD',
  discount_amount: '0', discount_currency: 'USD', vat_amount: '0',
  order_type: '', order_details_text: '', special_instructions: '',
  scheduled_date: '', scheduled_time_from: '', scheduled_time_to: '',
  // "We purchased the goods" → the order earns a month-end commission from the shop.
  is_procurement: false,
  // "It is a free order" → total waived to zero, closable with no payment.
  is_free_order: false,
}

function fmt2(n) { return String(n).padStart(2, '0') }
function timeStr(d) { return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}` }

// Times are stored as 24-hour "HH:MM" strings but shown to the user as 12-hour
// with AM/PM (e.g. "15:30" → "03:30 PM"). These helpers convert both ways.
function parse12h(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return { h12: '', mm: '', ap: 'AM' }
  let h = parseInt(m[1], 10)
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12; if (h === 0) h = 12
  return { h12: String(h), mm: m[2], ap }
}
function to24h(h12, mm, ap) {
  let h = parseInt(h12, 10); if (isNaN(h)) h = 12
  h = h % 12                                  // 12 → 0 before adding PM offset
  if (ap === 'PM') h += 12
  let m = parseInt(mm, 10); if (isNaN(m)) m = 0
  m = Math.min(59, Math.max(0, m))
  return `${fmt2(h)}:${fmt2(m)}`
}
// 12-hour display string, e.g. "03:30 PM". Empty string when there's no value.
function fmtTime12(hhmm) {
  const { h12, mm, ap } = parse12h(hhmm)
  if (h12 === '') return ''
  return `${fmt2(Number(h12))}:${mm} ${ap}`
}

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

// is_procurement defaults to true — a local-market retail invoice is "We bought"
// unless the user flips it to Shop-sent. (2nd-party/shop-sent orders force it
// false on save.) Mirrors the DB column default.
const EMPTY_RETAIL_INVOICE = { shop_name: '', shop_type: '', contact_id: '', contact_code: '', invoice_reference: '', invoice_date: '', invoice_value: '', currency: 'USD', paid: false, payment_type: '', is_procurement: true }

/* Pickup / delivery addresses are stored as a single text column but edited as
   multiple location tags — serialised with " | " so existing single-address rows
   keep working (they just read back as one tag). */
const LOC_SEP   = ' | '
// Local calendar date as YYYY-MM-DD, to match how scheduled_date is stored.
const localTodayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
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
  // Shared "general form" extras so the quick-add form matches the Contacts page.
  partner_percentage: '', shop_type: '', contact_category: '',
}

function customerName(c) {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
}

// True when a contact holds the given role. Multi-role contacts carry every role
// in the contact_types[] tag array, so read membership from there; fall back to
// the single primary contact_type for legacy rows that predate the array.
function contactHasType(c, t) {
  return (Array.isArray(c?.contact_types) && c.contact_types.length)
    ? c.contact_types.includes(t)
    : c?.contact_type === t
}

// Display name for a contact in lists: company name for companies/partners,
// otherwise the person's name.
function customerListName(c) {
  const isCompany = c.entity_type === 'company' || contactHasType(c, 'partner')
  return (isCompany && c.company_name) ? c.company_name : (customerName(c) || '—')
}

/* Read-only detail-drawer building blocks: a labelled, boxed section and a
   label/value row. Used only by the order detail drawer. */
function DetailSection({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}{title}
      </div>
      <div className="rounded-lg border border-surface-border bg-surface-hover/30 p-3 space-y-1">
        {children}
      </div>
    </div>
  )
}
function DetailRow({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="text-slate-200 text-xs text-right">{value}</span>
    </div>
  )
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
  // Components that sum to the Gross amount (in display order). Petty Cash
  // Reimbursement is the negative counterpart of the local-market invoices.
  { key: 'packages',       label: 'Delivery packages' },
  { key: 'services',       label: 'Order services' },
  { key: 'externalRetail', label: 'Local market invoices' },
  { key: 'localRetail',    label: '3asari3 retails' },
  { key: 'fees',           label: 'Delivery fees' },
  { key: 'vat',            label: 'VAT',                      labelCls: 'text-brand-400' },
  { key: 'total',          label: 'Gross amount',             tone: 'strong',  strong: true },
  // Petty cash reimbursement + discount are deductions between Gross and Orders net.
  { key: 'usedPettyCash',  label: 'Petty Cash Reimbursement', tone: 'rose', neg: true, labelCls: 'text-rose-300/90' },
  { key: 'discount',       label: 'Discount',                 tone: 'rose',    neg: true, labelCls: 'text-rose-300/90' },
  { key: 'ordersNet',      label: 'Orders net amount',        tone: 'strong',  strong: true },
  // Collected split by the payment's collection_group.
  { key: 'collectedByDriver', label: 'Collected from customer by driver',        tone: 'emerald' },
  { key: 'collectedByOffice', label: 'Collected from customer at the call center', tone: 'sky' },
  // Petty cash reimbursement also nets into the collections subtotal.
  { key: 'pettyReimbCollections', label: 'Petty Cash Reimbursement', tone: 'rose', neg: true, labelCls: 'text-rose-300/90' },
  { key: 'totalCollections',  label: 'Total collections',        tone: 'emerald', strong: true },
  { key: 'balance',        label: 'Pending balance',          tone: 'amber' },
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

/* A 12-hour time editor (hour : minute + AM/PM toggle) that reads and emits the
   stored 24-hour "HH:MM" string, so storage and all time math stay unchanged
   while the user always sees AM/PM — independent of the browser's locale. */
function TwelveHourTimeInput({ value, onChange }) {
  const { h12, mm, ap } = parse12h(value)
  const baseH = h12 || '12'
  const baseM = mm  || '00'

  function setHour(v) {
    const digits = String(v).replace(/\D/g, '')
    if (digits === '') { onChange(''); return }
    const n = Math.min(12, Math.max(1, parseInt(digits, 10)))
    onChange(to24h(String(n), baseM, ap))
  }
  function setMin(v) {
    const digits = String(v).replace(/\D/g, '')
    const n = Math.min(59, Math.max(0, parseInt(digits || '0', 10)))
    onChange(to24h(baseH, String(n), ap))
  }

  return (
    <div className="input flex-1 min-w-0 flex items-center gap-1 px-2">
      <input type="text" inputMode="numeric" value={h12} placeholder="--"
        onChange={e => setHour(e.target.value)}
        className="w-7 bg-transparent text-center outline-none" />
      <span className="text-slate-500">:</span>
      <input type="text" inputMode="numeric" value={mm} placeholder="--"
        onChange={e => setMin(e.target.value)}
        className="w-7 bg-transparent text-center outline-none" />
      <button type="button" onClick={() => onChange(to24h(baseH, baseM, ap === 'AM' ? 'PM' : 'AM'))}
        className="ml-auto text-xs font-bold text-brand-300 px-2 py-0.5 rounded border border-surface-border hover:bg-surface-hover">
        {ap}
      </button>
    </div>
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
        <TwelveHourTimeInput value={value} onChange={onChange} />
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
  // A local-market retail invoice flagged "Paid" was settled directly by the
  // customer with the shop/partner, so it never touches the order total or its
  // pending balance (mirrors orderTotalsByCurrency for saved orders).
  for (const r of retailInvoices) if (!r.paid) add(r.currency || 'USD', Number(r.invoice_value) || 0)
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

export default function DeliveriesPage({ closed = false, partyContactId = null }) {
  const { orders, drivers, zones, fetchOrders, loading, COMPANY_ID, showSummary, appSettings } = useApp()
  // Minutes an unconfirmed order may sit before its row starts blinking (0 = off).
  const reminderMins = Number(appSettings?.orderConfirmReminderMinutes) || 0
  // Minutes before an order's scheduled start time at which its row turns red (0 = off).
  const highlightLeadMins = Number(appSettings?.highlightBeforeScheduledMinutes) || 0
  // Ticks the clock so blinking starts on time without needing a manual refresh.
  const [now, setNow] = useState(() => Date.now())

  // Keep the user on the order they just acted on. Changing a status/payment/etc.
  // calls fetchOrders(), which briefly flips the list to a "Loading…" row — that
  // collapses the page height and the browser jumps to the top. We record the
  // touched order and re-scroll to it (and flash it) after every refresh, whether
  // that's an in-place data update or a full page reload.
  const RESTORE_KEY = `ideliver_deliveries_lastorder_${closed ? 'closed' : partyContactId ? 'party' : 'daily'}`
  const [flashOrderId, setFlashOrderId] = useState(null)
  // Seed the "scroll back to" target from storage once, so a hard refresh restores too.
  const pendingScrollRef = useRef(undefined)
  if (pendingScrollRef.current === undefined) {
    try { pendingScrollRef.current = sessionStorage.getItem(RESTORE_KEY) || null } catch { pendingScrollRef.current = null }
  }
  function rememberOrder(id) {
    if (!id) return
    pendingScrollRef.current = id
    try { sessionStorage.setItem(RESTORE_KEY, id) } catch { /* storage unavailable */ }
  }
  // Immediately scroll a daily-list row into view and flash it (used by the audit
  // popup's order-number link — the row is already rendered, no reload needed).
  function focusOrderRow(id) {
    if (!id) return
    requestAnimationFrame(() => {
      const el = document.getElementById(`order-row-${id}`)
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFlashOrderId(id)
      setTimeout(() => setFlashOrderId(f => (f === id ? null : f)), 2500)
    })
  }
  // After the list finishes (re)loading, scroll the pending order into view + flash.
  useEffect(() => {
    if (loading.orders || orders.length === 0) return
    const id = pendingScrollRef.current
    if (!id) return
    pendingScrollRef.current = null   // consume once — don't re-scroll on later refreshes
    // Wait for the rows to paint before locating the row element.
    requestAnimationFrame(() => {
      const el = document.getElementById(`order-row-${id}`)
      if (!el) return
      // Only recenter if the row isn't already visible (avoids needless jumps when
      // the list didn't collapse); always flash so the user can spot it.
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight || document.documentElement.clientHeight
      if (rect.top < 64 || rect.bottom > vh) el.scrollIntoView({ block: 'center' })
      setFlashOrderId(id)
      setTimeout(() => setFlashOrderId(f => (f === id ? null : f)), 2000)
    })
  }, [orders, loading.orders])
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])
  const { currentUser, hasRole } = useAuth()
  const isSuperAdmin = hasRole('super_admin')
  // Only admins may set the order/delivery status by hand; a normal (call-center)
  // user can't — both are driven by the driver app / order lifecycle instead.
  const canEditDeliveryStatus = hasRole('super_admin', 'admin')
  const canEditOrderStatus    = canEditDeliveryStatus   // same roles govern the order status
  // Super-admin restriction toggles (lock saved local-market invoices / protect
  // other users' payments) apply only to normal users. Admins and super admins are
  // exempt — they may always edit/delete saved invoices and any payment.
  const canBypassRestrictions = hasRole('super_admin', 'admin')
  // Full name of the signed-in user, stamped on payments they record (collector).
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || null

  // 2nd-party (supplier/partner) view: the set of order ids this contact owns —
  // orders whose packages (provider_id) or retail invoices (contact_id) point at
  // them. `null` while loading, so we show nothing rather than everything.
  const [ownedOrderIds, setOwnedOrderIds] = useState(null)
  useEffect(() => {
    if (!partyContactId) { setOwnedOrderIds(null); return }
    let cancelled = false
    ;(async () => {
      const [pkgRes, invRes] = await Promise.all([
        supabase.from('delivery_packages').select('order_id').eq('provider_id', partyContactId),
        supabase.from('retail_goods_invoices').select('order_id').eq('contact_id', partyContactId),
      ])
      if (cancelled) return
      const ids = new Set()
      for (const r of pkgRes.data ?? []) if (r.order_id) ids.add(r.order_id)
      for (const r of invRes.data ?? []) if (r.order_id) ids.add(r.order_id)
      setOwnedOrderIds(ids)
    })()
    return () => { cancelled = true }
  }, [partyContactId, orders])

  // The party's own contact — used to auto-fill (and lock) the package provider
  // and retail-invoice shop so a 2nd-party order always references them.
  const [partyContact, setPartyContact] = useState(null)
  useEffect(() => {
    if (!partyContactId) { setPartyContact(null); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('contacts')
        .select('id, first_name, last_name, company_name, code, shop_type')
        .eq('id', partyContactId).single()
      if (!cancelled) setPartyContact(data ?? null)
    })()
    return () => { cancelled = true }
  }, [partyContactId])
  const partyContactName = partyContact
    ? (partyContact.company_name?.trim() || `${partyContact.first_name ?? ''} ${partyContact.last_name ?? ''}`.trim())
    : ''

  // Remembers the id of an order created during this modal session, so if a
  // later step (items, packages, services…) fails the retry UPDATEs that order
  // instead of inserting a duplicate. Reset whenever the modal opens/closes.
  const savedOrderIdRef = useRef(null)
  const driverSearchRef = useRef(null)
  const handledEditRef  = useRef(null)   // deep-link: open an order from ?edit=<id>
  const [searchParams, setSearchParams] = useSearchParams()

  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [confirmFilter, setConfirmFilter] = useState('all')   // all | confirmed | unconfirmed
  const [sort,      setSort]      = useState({ col: null, dir: null })  // column sort: asc | desc | null
  const [modal,     setModal]     = useState(null)
  // Super-admin "lock order" reason prompt: holds the reason text while the small
  // confirm dialog is open (null = closed).
  const [lockPrompt, setLockPrompt] = useState(null)   // { reason } | null
  // "Check orders" audit popup (daily list): flags orders with data issues.
  const [auditOpen, setAuditOpen] = useState(false)
  const [mapOpen,   setMapOpen]   = useState(false)   // delivery-address map picker
  const [form,      setForm]      = useState(BASE_FORM)
  const [items,     setItems]     = useState([])
  const [retailInvoices, setRetailInvoices] = useState([])   // retail_goods_invoices
  const [packages,       setPackages]       = useState([])
  const [origPackageIds, setOrigPackageIds] = useState([])
  const [services,       setServices]       = useState([])
  const [origServiceIds, setOrigServiceIds] = useState([])
  const [savedPickup,   setSavedPickup]   = useState(() => getSavedLocations('pickup'))
  const [savedDelivery, setSavedDelivery] = useState(() => getSavedLocations('delivery'))
  const [hiddenPickup,  setHiddenPickup]  = useState(() => getHiddenLocations('pickup'))
  const [hiddenDelivery,setHiddenDelivery]= useState(() => getHiddenLocations('delivery'))
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [copied,    setCopied]    = useState(null)
  const [freeConfirm, setFreeConfirm] = useState(false)  // "make this order free?" warning modal
  const [toggling,  setToggling]  = useState(null)
  // Deactivate-order confirmation: { order, reason, counts, loading, busy }
  const [cancelModal, setCancelModal] = useState(null)
  const [customers,          setCustomers]          = useState([])
  const [allContacts,        setAllContacts]        = useState([])   // every contact, any role — for the service-provider picker
  const [subAccounts,        setSubAccounts]        = useState([])   // sub_accounts rows, all contacts
  const [creditPayments,     setCreditPayments]     = useState([])   // credit_customer_payments — pay down an account's balance
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
  const [recipientDropdownOpen, setRecipientDropdownOpen] = useState(false)
  const [newCustomerOpen,      setNewCustomerOpen]      = useState(false)
  const [newCustomer,          setNewCustomer]          = useState(EMPTY_CUSTOMER)
  const [newContactType,       setNewContactType]       = useState('customer')   // customer | partner | supplier
  const newContactCreatedRef = useRef(null)   // (createdContact) => void — selects it back into the field
  const [businessTypes,        setBusinessTypes]        = useState([])   // shared lookup: business_types
  const [contactCategories,    setContactCategories]    = useState([])   // shared lookup: contact_categories
  const [custAddresses,        setCustAddresses]        = useState([])
  const [savingCustomer,       setSavingCustomer]       = useState(false)
  const [customerError,        setCustomerError]        = useState('')
  const [payments,             setPayments]             = useState([])
  const [origPaymentIds,       setOrigPaymentIds]       = useState([])
  const [driverFilter,         setDriverFilter]         = useState('')
  const [payFilter,            setPayFilter]            = useState('')   // payment_status chip (toggle)
  const [flagFilter,           setFlagFilter]           = useState('')   // ''|flagged|unflagged
  const [customerFilter,       setCustomerFilter]       = useState('')
  const [categoryFilter,       setCategoryFilter]       = useState([])   // [] = all; else subset of credit|regular|partner|supplier
  const [catMenuOpen,          setCatMenuOpen]          = useState(false)
  const [sourceFilter,         setSourceFilter]         = useState('')   // LOCAL|EXTERNAL
  const [orderTypeFilter,      setOrderTypeFilter]      = useState('')   // order_type (string)
  // Scheduled-date range filter. Defaults to today so the list opens on
  // today's scheduled orders; the "Today" toggle sets/clears both boxes.
  const [dateFrom,             setDateFrom]             = useState(localTodayStr())
  const [dateTo,               setDateTo]               = useState(localTodayStr())
  // Closed Orders date grouping — null until the first load picks a default.
  const [openGroups,           setOpenGroups]           = useState(null)
  // Daily list groups (Delivery Orders / Ads & Services) — tracks which are
  // COLLAPSED (both open by default).
  const [collapsedGroups,      setCollapsedGroups]      = useState(() => new Set())
  const [pendingsOpen,         setPendingsOpen]         = useState(false)
  const [totalsExpanded,       setTotalsExpanded]       = useState(false)  // floating-bar breakdown panel
  const [popover,              setPopover]              = useState(null)   // { type:'driver'|'status'|'fee', order, x, y }
  const [hoverSummary,         setHoverSummary]         = useState(null)   // { order, x, y } — amounts preview following the cursor
  const hoverPanelRef = useRef(null)
  // Read-only order detail drawer (slides in from the right). `detail` holds the
  // order, `detailData` its loaded sub-records; `detailShown` drives the slide
  // animation; `detailPinned` keeps it open (otherwise a click outside closes it).
  const [detail,        setDetail]        = useState(null)
  const [detailData,    setDetailData]    = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailShown,   setDetailShown]   = useState(false)
  const [detailPinned,  setDetailPinned]  = useState(false)
  const [feeDraft,             setFeeDraft]             = useState({ amount: '', currency: 'USD' })   // quick delivery-fee edit
  const [driverQuickSearch,    setDriverQuickSearch]    = useState('')
  const [quickBusy,            setQuickBusy]            = useState(false)
  const [sectionsOpen,         setSectionsOpen]         = useState(allSectionsClosed)
  // Quick "Pay" from the list — records a payment on an order without opening the full form.
  const [payModal,             setPayModal]             = useState(null)   // order being paid | null
  const [payForm,              setPayForm]              = useState(EMPTY_PAYMENT)
  const [payPaid,              setPayPaid]              = useState({ USD: 0, LBP: 0 })
  const [paySaving,            setPaySaving]            = useState(false)
  const [payError,             setPayError]             = useState('')

  const toggleSection = (id, val) => setSectionsOpen(s => ({ ...s, [id]: val }))
  const openSection   = (id) => setSectionsOpen(s => (s[id] ? s : { ...s, [id]: true }))
  // Add a package from the section header (works even while the subform is collapsed/unmounted).
  const addPackage    = () => { openSection('packages'); setPackages(p => [...p, { ...EMPTY_PACKAGE, ...(partyContactId ? { provider_id: partyContactId } : {}), _key: Date.now() }]) }

  /* ── lookups ─────────────────────────────────────────────── */

  const fetchLookups = useCallback(async () => {
    // A delivery can be for any contact, so the picker includes customers,
    // partners and suppliers.
    let typesQ = supabase.from('order_types').select('id, name').eq('is_active', true).order('name')
    if (COMPANY_ID) typesQ = typesQ.eq('company_id', COMPANY_ID)
    const lookupQ = (table) => {
      let q = supabase.from(table).select('name').eq('is_active', true).order('name')
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      return q
    }
    // The two contact pickers are paged: both are past PostgREST's 1000-row cap, and
    // a plain select would drop customers from the picker with no visible error.
    const [{ data: custs }, { data: allc }, { data: prods }, { data: types }, { data: provs }, { data: bt }, { data: cc }] = await Promise.all([
      fetchAllRows(() => supabase.from('contacts')
        .select('id,first_name,last_name,mobile,whatsapp_number,email,city,address,contact_type,contact_types,entity_type,company_name,code,account_number,credit_debit_allowed,shop_type,partner_percentage,is_active')
        // Membership is by role tags, so a multi-role contact (e.g. Customer +
        // Partner) shows up here regardless of which type is its primary.
        .overlaps('contact_types', ['customer', 'partner', 'supplier'])
        .order('id')),
      // Every contact, any role — the Order Services "Service provider" picker is
      // not restricted to suppliers; it lists all contacts (search by name /
      // mobile / contact code).
      fetchAllRows(() => supabase.from('contacts')
        .select('id,first_name,last_name,mobile,company_name,contact_type,contact_types,entity_type,code,account_number')
        .order('first_name')
        .order('id')),
      supabase.from('products').select('id,name,code,unit_price,currency').eq('is_active', true),
      typesQ,
      // Package providers — contacts categorised as "Online".
      supabase.from('contacts')
        .select('id,first_name,last_name,company_name,contact_type,account_number,code')
        .eq('contact_category', 'Online'),
      lookupQ('business_types'),
      lookupQ('contact_categories'),
    ])
    // Deactivated contacts are hidden from the order pickers (customer, recipient,
    // package provider, retail shop). An order being edited still resolves its own
    // customer via a fallback to o.customer, so a since-deactivated customer stays
    // visible on that order. Treat null/undefined is_active as active.
    setCustomers((custs ?? []).filter(c => c.is_active !== false))
    setAllContacts(allc ?? [])
    // Account numbers + credit settlements, needed to enforce each account's
    // limit and expiry when an order is closed. Paged for the same reason the
    // contact pickers are: both are past PostgREST's 1000-row cap.
    const [{ data: subs }, { data: pays }] = await Promise.all([
      // Contact accounts only — sub_accounts is the whole Chart of Accounts, and
      // its other rows (ledger accounts with no contact) mean nothing here.
      fetchAllRows(() => supabase.from('sub_accounts').select('*')
        .not('contact_id', 'is', null).order('id')),
      fetchAllRows(() => supabase.from('credit_customer_payments').select('customer_id,sub_account_id,amount,currency').order('id')),
    ])
    setSubAccounts(subs ?? [])
    setCreditPayments(pays ?? [])
    setProducts(prods  ?? [])
    setOrderTypes(types ?? [])
    setProviders(provs ?? [])
    setBusinessTypes((bt ?? []).map(r => r.name))
    setContactCategories((cc ?? []).map(r => r.name))
  }, [COMPANY_ID])

  useEffect(() => { fetchLookups() }, [fetchLookups])

  // Deep link: /deliveries?edit=<orderId> opens that order and jumps to Items.
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId || loading.orders || handledEditRef.current === editId) return
    const o = orders.find(x => x.id === editId)
    if (!o) return   // wait until the orders list includes it
    // 2nd-party users may only deep-link into their own orders.
    if (partyContactId && !(ownedOrderIds && ownedOrderIds.has(editId))) return
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

  // Whether the scheduled-date range is currently pinned to just today, and a
  // handler that toggles it: pressed → both boxes = today, unpressed → cleared.
  const todayStr    = localTodayStr()
  const todayActive = dateFrom === todayStr && dateTo === todayStr
  function toggleToday() {
    if (todayActive) { setDateFrom(''); setDateTo('') }
    else             { setDateFrom(todayStr); setDateTo(todayStr) }
  }

  // Does a customer contact match one customer-type key?
  function customerMatchesType(c, type) {
    if (!c) return false
    if (type === 'credit')   return c.credit_debit_allowed === true
    if (type === 'regular')  return contactHasType(c, 'customer') && c.credit_debit_allowed !== true
    if (type === 'partner')  return contactHasType(c, 'partner')
    if (type === 'supplier') return contactHasType(c, 'supplier')
    return false
  }
  // Multi-select customer-type filter: empty = all; otherwise the order matches if
  // its customer is ANY of the selected types.
  function matchCategory(o) {
    if (categoryFilter.length === 0) return true
    return categoryFilter.some(t => customerMatchesType(o.customer, t))
  }
  function toggleCategory(v) {
    setCategoryFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }
  function matchSource(o) {
    if (!sourceFilter) return true
    // Exact match against the actual delivery_orders.order_source value.
    return (o.order_source || '').trim().toLowerCase() === sourceFilter.toLowerCase()
  }
  // Distinct order_source values actually present in the data, for the dropdown.
  const sourceOptions = useMemo(() => {
    const seen = new Map()   // lowercased key → original casing (first seen)
    for (const o of orders) {
      const raw = (o.order_source || '').trim()
      if (!raw) continue
      const key = raw.toLowerCase()
      if (!seen.has(key)) seen.set(key, raw)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [orders])
  // An order from the online application = external source.
  const isOnlineOrder = (o) => (o.order_source || '').trim().toUpperCase().startsWith('EXT')
  // Orders that need the call-center confirm affordance in the list: online (EXT),
  // plus partner & supplier orders (treated like online). Returns the icon "kind".
  const orderSourceKind = (o) => {
    const src = (o.order_source || '').trim()
    if (src.toUpperCase().startsWith('EXT')) return 'online'
    if (src.toLowerCase() === 'supplier')    return 'supplier'
    if (src.toLowerCase() === 'partner')     return 'partner'
    return null
  }

  const filtered = orders.filter(o => {
    // 2nd-party view: restrict to orders that reference this contact (their
    // packages or retail invoices). Empty while ownership is still loading.
    if (partyContactId && !(ownedOrderIds && ownedOrderIds.has(o.id))) return false
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
      && (confirmFilter === 'all' || (confirmFilter === 'confirmed' ? isConfirmed(o) : !isConfirmed(o)))
      && (filter === 'all' || normalizeStatus(o.status) === filter)
      && (!payFilter      || o.payment_status === payFilter)
      && (!flagFilter     || (flagFilter === 'flagged' ? isFlagged(o) : !isFlagged(o)))
      && (!driverFilter   || o.driver_id   === driverFilter)
      && (!customerFilter || o.customer_id === customerFilter)
      && (!orderTypeFilter || o.order_type === orderTypeFilter)
      && matchCategory(o)
      && matchSource(o)
      && matchScheduledDate(o)
  })

  // Orders in the current (filtered) list that have data-integrity issues, for the
  // "Check orders" audit popup.
  const auditRows = useMemo(() => {
    const rows = []
    for (const o of filtered) {
      const warnings = orderWarnings(o)
      if (warnings.length) rows.push({ o, warnings })
    }
    return rows
  }, [filtered])

  const hasAdvancedFilters = driverFilter || customerFilter || categoryFilter.length || sourceFilter || orderTypeFilter || dateFrom || dateTo
  function clearAdvancedFilters() {
    setDriverFilter(''); setCustomerFilter(''); setCategoryFilter([]); setSourceFilter(''); setOrderTypeFilter(''); setDateFrom(''); setDateTo('')
  }

  // Order-type filter options as { value, label }. `value` is exactly what's
  // stored on the order (built-in value like 'restaurant', or a custom name);
  // `label` is a friendly display. Sourced from built-in + custom (DB) types +
  // any value present on existing orders, de-duped case-insensitively.
  const orderTypeOptions = (() => {
    const builtinLabel = Object.fromEntries(ORDER_TYPES.map(t => [t.value, t.label]))
    const seen = new Map()
    const add = v => {
      const s = String(v ?? '').trim()
      if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), { value: s, label: builtinLabel[s] || s })
    }
    ORDER_TYPES.forEach(t => add(t.value))
    orderTypes.forEach(t => add(t.name))
    ;(orders ?? []).forEach(o => add(o.order_type))
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
  })()

  // Sortable column header → value extractor. Headers not listed here aren't sortable.
  const SORT_GETTERS = {
    'Order #':   o => o.order_number ?? '',
    'Schedule':  o => { const d = orderScheduledStart(o); return d ? d.getTime() : Number.POSITIVE_INFINITY },
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

  /* Closed Orders is grouped by date, Outlook-style. Only the open group renders
     its rows, which is what keeps the page quick — there are far more closed
     orders than fit comfortably in one list. */
  const groups = useMemo(() => (closed ? buildOrderGroups(sorted) : []), [closed, sorted])

  // null until the orders have loaded, so the default lands on a group that
  // actually has something in it.
  useEffect(() => {
    if (!closed || openGroups !== null || loading.orders) return
    setOpenGroups(new Set([defaultOpenGroup(groups)]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed, loading.orders, groups, openGroups])

  const openGroupSet = openGroups ?? new Set(['this_week'])
  const toggleGroup = key => setOpenGroups(prev => {
    const next = new Set(prev ?? openGroupSet)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const toggleDailyGroup = key => setCollapsedGroups(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  // Closed Orders: date groups (Outlook-style). Daily list: split into
  // "Delivery Orders" and "Ads & Services" (Story), both collapsible with counts,
  // both fed from the already-filtered `sorted` set so they respect every filter.
  const renderGroups = closed
    ? groups.map(g => ({ ...g, open: openGroupSet.has(g.key), showHeader: true, onToggle: () => toggleGroup(g.key) }))
    : (() => {
        const story  = sorted.filter(isStoryOrder)
        const normal = sorted.filter(o => !isStoryOrder(o))
        const out = [{ key: 'orders', label: 'Delivery Orders', orders: normal, open: !collapsedGroups.has('orders'), showHeader: true, onToggle: () => toggleDailyGroup('orders') }]
        // Only surface the Ads & Services group when such orders exist in the view.
        if (story.length) out.push({ key: 'story', label: 'Ads & Services', orders: story, open: !collapsedGroups.has('story'), showHeader: true, onToggle: () => toggleDailyGroup('story') })
        return out
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
    const ensure = cur => (acc[cur] ||= { packages: 0, services: 0, localRetail: 0, externalRetail: 0, fees: 0, discount: 0, vat: 0, usedPettyCash: 0, total: 0, balance: 0, collectedByDriver: 0, collectedByOffice: 0, pending: 0 })
    for (const o of filtered) {
      // 2nd-party view: only this contact's packages / external invoices count.
      for (const r of orderAmountBreakdown(o, partyContactId)) {
        const b = ensure(r.cur)
        // Used petty cash mirrors external retail invoices; the split-collected
        // rows are summed from payment_collections below.
        for (const row of TOTALS_BREAKDOWN_ROWS) {
          if (row.key === 'usedPettyCash')                                              b.usedPettyCash += (r.externalRetail || 0)
          else if (row.key === 'collectedByDriver' || row.key === 'collectedByOffice')  { /* below */ }
          else                                                                          b[row.key] += (r[row.key] || 0)
        }
      }
      // Split the order's collected cash into driver vs call-center using the same
      // paymentByDriver rule as Driver Settlements and the Cashier Box, so the
      // attribution is consistent everywhere (legacy driver payments with no id /
      // no group are still counted as driver). Every payment lands in one bucket,
      // so Total collections here matches the Daily Collection page total.
      for (const pc of (o.payment_collections ?? [])) {
        const cur = CURRENCIES.includes(pc.currency) ? pc.currency : (pc.currency || 'USD')
        const b = ensure(cur)
        const amt = round2(pc.amount)
        if (paymentByDriver(pc, o)) b.collectedByDriver += amt
        else                        b.collectedByOffice += amt
      }
    }
    const order = [...CURRENCIES, ...Object.keys(acc).filter(c => !CURRENCIES.includes(c))]
    return order.filter(c => acc[c]).map(c => {
      const out = { cur: c }
      for (const row of TOTALS_BREAKDOWN_ROWS) out[row.key] = round2(acc[c][row.key] || 0)
      // Gross amount = total of the component rows ABOVE it (packages + services +
      // local market invoices + 3asari3 retails + delivery fees + VAT). Discount is
      // subtracted in acc.total, so add it back here.
      out.total   = round2((acc[c].total || 0) + (acc[c].discount || 0))
      // Orders net amount = Gross − Petty cash reimbursement − Discount.
      out.ordersNet = round2((acc[c].total || 0) - (acc[c].usedPettyCash || 0))
      // Petty cash reimbursement also shown in the collections section (same value).
      out.pettyReimbCollections = round2(acc[c].usedPettyCash || 0)
      // Total collections = collected by driver + at the call center − petty cash reimbursement.
      out.totalCollections = round2((acc[c].collectedByDriver || 0) + (acc[c].collectedByOffice || 0) - (acc[c].usedPettyCash || 0))
      // Pending balance = Orders net amount − Total collections.
      out.balance = round2(out.ordersNet - out.totalCollections)
      out.pending = round2(acc[c].collectedByDriver || 0)
      return out
    })
  })()

  // Rows shown in the "Totals breakdown" popup. For 2nd-party (supplier/partner)
  // logins we only surface their own packages + external retail invoices totals;
  // the other categories (fees, local retail, services, discount, vat, collected,
  // balance, driver, pending, total) are hidden.
  const breakdownRows = partyContactId
    ? TOTALS_BREAKDOWN_ROWS.filter(row => row.key === 'packages' || row.key === 'externalRetail')
    : TOTALS_BREAKDOWN_ROWS

  /* ── modal handlers ──────────────────────────────────────── */

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })); setError('') }
  // Order-status change: also sync the delivery status to the matching stage.
  function setOrderStatus(v) {
    setForm(f => ({ ...f, status: v, ...(STATUS_DELIVERY_MAP[v] ? { delivery_status: STATUS_DELIVERY_MAP[v] } : {}) }))
    setError('')
  }

  /* Remember a location in the reusable library (localStorage) so it's offered
     as a quick-pick tag on future orders. */
  function rememberPickup(v)   { setSavedPickup(addSavedLocation('pickup', v)) }
  function rememberDelivery(v) { setSavedDelivery(addSavedLocation('delivery', v)) }

  // Edit / delete a saved or order-derived location suggestion. Deleting also
  // hides the value so suggestions sourced from order history stop appearing.
  function editPickupSuggestion(oldV, newV)   { setSavedPickup(renameSavedLocation('pickup', oldV, newV)); setHiddenPickup(hideLocation('pickup', oldV)) }
  function editDeliverySuggestion(oldV, newV) { setSavedDelivery(renameSavedLocation('delivery', oldV, newV)); setHiddenDelivery(hideLocation('delivery', oldV)) }
  function deletePickupSuggestion(v)   { setSavedPickup(removeSavedLocation('pickup', v)); setHiddenPickup(hideLocation('pickup', v)) }
  function deleteDeliverySuggestion(v) { setSavedDelivery(removeSavedLocation('delivery', v)); setHiddenDelivery(hideLocation('delivery', v)) }

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
  /* `knownAccounts` lets a caller that just created accounts pass them in: state
     updates don't flush synchronously, so a caller in the same tick as
     setSubAccounts would otherwise resolve against the pre-insert list. */
  function applyCustomer(c, knownAccounts = null) {
    const isCompany   = c.entity_type === 'company' || contactHasType(c, 'partner')
    const displayName = (isCompany && c.company_name) ? c.company_name : customerName(c)
    // Default to the contact's primary account; the picker below can change it.
    const pool = knownAccounts ?? subAccounts
    const primary = resolveSubAccount(null, pool.filter(s => s.contact_id === c.id))
    setForm(f => ({
      ...f,
      customer_id:        c.id,
      sub_account_id:     primary?.id ?? '',
      main_account:       primary?.code ?? c.account_number ?? '',
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

  /* Clear button inside the Customer box: reset the customer selection along with
     the recipient mobile / whatsapp (which get auto-filled from the customer).
     For a 2nd-party (supplier/partner) login the customer is locked to their own
     account, so only the recipient mobile / whatsapp are cleared. */
  function resetCustomer() {
    setCustomerInput('')
    setForm(f => ({ ...f, customer_id: '', main_account: '', sub_account_id: '', recipient_mobile: '', recipient_whatsapp: '' }))
    setCustomerDropdownOpen(false)
    setError('')
  }

  /* Clear button inside the Recipient box: reset the recipient name along with
     the recipient mobile / whatsapp. */
  function resetRecipient() {
    setForm(f => ({ ...f, recipient_name: '', recipient_mobile: '', recipient_whatsapp: '' }))
    setRecipientDropdownOpen(false)
    setError('')
  }

  /* Recipient box behaves like the Customer box: pick an existing contact from
     the dropdown (fills name / mobile / whatsapp), or add a new one when not
     found. Unlike Customer it doesn't set customer_id — it only fills the
     recipient fields stored on the order. */
  function applyRecipient(c) {
    const isCompany = c.entity_type === 'company' || contactHasType(c, 'partner')
    const name = (isCompany && c.company_name) ? c.company_name : customerName(c)
    setForm(f => {
      // The goods go to the recipient, so the delivery location follows the
      // recipient's address — UNLESS the recipient is the same contact as the
      // customer, whose address already populated the delivery location.
      const sameAsCustomer = c.id === f.customer_id
      return {
        ...f,
        recipient_name:     name || f.recipient_name,
        recipient_mobile:   c.mobile ?? f.recipient_mobile,
        recipient_whatsapp: c.whatsapp_number ?? c.mobile ?? f.recipient_whatsapp,
        ...(sameAsCustomer ? {} : { delivery_address: mergeLoc(f.delivery_address, c.address) }),
      }
    })
    if (c.id !== form.customer_id && c.address?.trim()) rememberDelivery(c.address.trim())
    setRecipientDropdownOpen(false)
    setError('')
  }
  function openNewRecipient(seedName = form.recipient_name) {
    openNewContact(seedName, 'customer', applyRecipient)
  }

  /* Open the quick "new contact" modal for any type (customer / partner /
     supplier), pre-filling the typed name. `onCreated(contact)` selects the new
     contact back into whatever field opened the modal. */
  function openNewContact(seedName = '', contactType = 'customer', onCreated = null) {
    const parts = (seedName ?? '').trim().split(/\s+/).filter(Boolean)
    setNewContactType(contactType)
    newContactCreatedRef.current = onCreated
    setNewCustomer({
      ...EMPTY_CUSTOMER,
      first_name: parts[0] ?? '',
      last_name:  parts.slice(1).join(' '),
      // For a new customer, carry over the recipient details already typed.
      ...(contactType === 'customer' ? {
        mobile:          form.recipient_mobile   || '',
        whatsapp_number: form.recipient_whatsapp || '',
        address:         form.delivery_address   || '',
      } : {}),
    })
    setCustAddresses([])
    setCustomerError('')
    setCustomerDropdownOpen(false)
    setNewCustomerOpen(true)
    // Generate the account number (prefixed per contact type) and fill the field.
    generateAccountNumber(contactType)
      .then(acct => setNewCustomer(c => ({ ...c, account_number: acct })))
      .catch(() => {})
  }

  /* The customer box's "save new" — opens the contact modal as a customer and
     selects it as the order's customer when created. */
  function openNewCustomer(seedName = customerInput) {
    openNewContact(seedName, 'customer', applyCustomer)
  }

  function setNewCust(k, v) { setNewCustomer(c => ({ ...c, [k]: v })); setCustomerError('') }

  // Insert a value into a lookup table inline (business type / contact category),
  // reusing an existing one case-insensitively. Returns the saved name or null.
  async function addLookup(table, current, setCurrent, name) {
    const clean = (name || '').trim()
    if (!clean) return null
    const existing = current.find(t => t.toLowerCase() === clean.toLowerCase())
    if (existing) return existing
    const { error } = await supabase.from(table).insert([{ name: clean, is_active: true, ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}) }])
    if (error) { setCustomerError(error.message); return null }
    setCurrent(ts => [...ts, clean].sort((a, b) => a.localeCompare(b)))
    return clean
  }

  // Live options for the supplier/partner "Business Type" & "Contact Category"
  // selects in the quick-add contact form (same lookups as the Contacts page).
  const newContactExtraFields = buildContactExtraFields(newContactType, {
    businessTypes, contactCategories,
    addBusinessType:    n => addLookup('business_types',     businessTypes,     setBusinessTypes,     n),
    addContactCategory: n => addLookup('contact_categories', contactCategories, setContactCategories, n),
  })
    // The quick "Add Customer" form (from the order forms) hides the Commission %
    // field — commission is a partner/supplier concern, not a customer one.
    .filter(ef => !(newContactType === 'customer' && ef.key === 'partner_percentage'))
    // 2nd-party (sold orders) quick-add also hides the Contact Category and
    // Business Type fields.
    .filter(ef => !(partyContactId && (ef.key === 'contact_category' || ef.key === 'shop_type')))

  async function saveNewCustomer() {
    const isCompany = newCustomer.entity_type === 'company'
    if (isCompany && !newCustomer.company_name.trim()) return setCustomerError('Company name is required.')
    if (!newCustomer.first_name.trim()) return setCustomerError(`${isCompany ? 'Contact first' : 'First'} name is required.`)
    if (!newCustomer.last_name.trim())  return setCustomerError(`${isCompany ? 'Contact last' : 'Last'} name is required.`)
    if (!newCustomer.mobile.trim())     return setCustomerError('Mobile number is required.')

    setSavingCustomer(true); setCustomerError('')

    // Ensure a UNIQUE account number before saving — regenerate if the pre-filled
    // one is blank or already taken (avoids duplicate partner/supplier codes).
    let accountNumber = newCustomer.account_number
    try { accountNumber = await ensureUniqueAccountNumber(accountNumber, newContactType) } catch { /* leave as-is */ }

    const payload = {
      contact_type:    newContactType,
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
      // Shared form fields (commission %, business type, contact category).
      ...contactTypeExtras(newContactType, newCustomer),
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      branch_id:      currentUser?.branch_id || null,
      created_by:     currentUser?.user_id   || null,
      account_number: accountNumber || null,
    }
    // Generates a unique contact code and retries on duplicate-code collisions.
    const { data, error: e } = await insertContactWithUniqueCode(
      payload, newContactType,
      'id,first_name,last_name,mobile,whatsapp_number,email,city,address,account_number,contact_type,contact_types,entity_type,company_name,credit_debit_allowed',
    )
    if (e) { setCustomerError(e.message); setSavingCustomer(false); return }

    const addrErr = await saveContactAddresses({
      contactId: data.id, addresses: custAddresses, origIds: [],
      companyId: COMPANY_ID, userId: currentUser?.user_id || null,
    })
    if (addrErr) { setCustomerError(addrErr); setSavingCustomer(false); return }

    // Seed the contact's primary account number, like the fix81 backfill did for
    // existing contacts. It must land in state before applyCustomer runs below,
    // or the order would resolve to no account at all.
    const seeded = await ensurePrimarySubAccount({
      contactId: data.id,
      accountNumber: data.account_number,
      creditAllowed: data.credit_debit_allowed === true,
      companyId: COMPANY_ID,
      userId: currentUser?.user_id || null,
    })
    const nextAccounts = seeded ? [...subAccounts, seeded] : subAccounts
    if (seeded) setSubAccounts(nextAccounts)

    setCustomers(prev => [...prev, data])
    setAllContacts(prev => [...prev, data])
    // Select the new contact back into whichever field opened the modal.
    const onCreated = newContactCreatedRef.current
    if (onCreated) onCreated(data); else applyCustomer(data, nextAccounts)
    newContactCreatedRef.current = null
    setNewCustomerOpen(false)
    setSavingCustomer(false)
  }

  function openAdd() {
    savedOrderIdRef.current = null
    // 2nd-party users: order type defaults to their contact's business type (locked).
    setForm({ ...getEmptyForm(), ...(partyContactId && partyContact?.shop_type ? { order_type: partyContact.shop_type } : {}) })
    setItems([]); setRetailInvoices([]); setPayments([]); setOrigPaymentIds([])
    setPackages([]); setOrigPackageIds([])
    setServices([]); setOrigServiceIds([])
    setSectionsOpen(defaultNewSections())         // new order: Order Type, Customer, Route, Notes open
    setCustomerInput(''); setError(''); setModal('add')
    // 2nd-party (supplier/partner) users: the customer is always their own linked
    // contact — auto-fill it (and the field is locked in the form below).
    // Everyone else picks a customer manually.
    if (partyContactId) {
      const self = customers.find(c => c.id === partyContactId) || partyContact
      if (self) applyCustomer(self)
      // Recipient (the actual delivery recipient) and the delivery address are
      // entered manually — never seeded from the 2nd-party's own contact.
      setForm(f => ({ ...f, recipient_name: '', recipient_mobile: '', recipient_whatsapp: '', delivery_address: '', delivery_lat: '', delivery_lng: '' }))
    }
  }

  // Open the simplified "Ads & Services" (Story) order form. Same modal, but the
  // order_type is fixed to 'Story' which hides route/driver/delivery/packages/etc.
  function openAddStory() {
    savedOrderIdRef.current = null
    setForm({ ...getEmptyForm(), order_type: STORY_ORDER_TYPE, scheduled_time_from: '', scheduled_time_to: '', delivery_status: null, pickup_address: '', delivery_address: '' })
    setItems([]); setRetailInvoices([]); setPayments([]); setOrigPaymentIds([])
    setPackages([]); setOrigPackageIds([])
    setServices([]); setOrigServiceIds([])
    setSectionsOpen(defaultNewSections())
    setCustomerInput(''); setError(''); setModal('add')
  }

  async function openEdit(o) {
    rememberOrder(o.id)
    // 2nd-party (supplier/partner) users can't edit a confirmed order — it's
    // locked. Open the read-only detail drawer instead so they can still view it.
    if (partyContactId && isConfirmed(o)) { openDetail(o); return }
    savedOrderIdRef.current = null
    setForm({
      ...BASE_FORM, ...o,
      status:           normalizeStatus(o.status),
      delivery_status:  o.delivery_status   ?? 'Awaiting Pickup',
      driver_id:        o.driver_id        ?? '',
      delivery_zone_id: o.delivery_zone_id ?? '',
      customer_id:      o.customer_id      ?? '',
      sub_account_id:   o.sub_account_id   ?? '',
      delivery_fee:     o.delivery_fee     ?? '',
      discount_amount:  o.discount_amount  ?? '0',
      discount_currency: o.discount_currency || o.currency || 'USD',
      vat_amount:       o.vat_amount       ?? '0',
      // 2nd-party users: order type is fixed to their contact's business type.
      ...(partyContactId && partyContact?.shop_type ? { order_type: partyContact.shop_type } : {}),
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
      // DB column renamed to exclude_calculation; the form keeps `paid` in memory.
      paid:              !!ri.exclude_calculation,
      payment_type:      ri.payment_type ?? '',
      is_procurement:    !!ri.is_procurement,
    })))
    const { data: payData } = await supabase
      .from('payment_collections')
      .select('id,collection_type,amount,currency,collected_at,notes,collected_by,collected_by_name,collection_group')
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
        collected_by:      pc.collected_by ?? null,
        collected_by_name: pc.collected_by_name ?? '',
        collection_group:  pc.collection_group ?? '',
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
    const existingIsCompany = existing && (existing.entity_type === 'company' || contactHasType(existing, 'partner'))
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

  /* ── Read-only detail drawer ─────────────────────────────────
     Loads every sub-record for an order and shows them in a slide-in panel.
     Display only — no edits happen here. */
  async function openDetail(o) {
    rememberOrder(o.id)
    setDetail(o)
    setDetailData(null)
    setDetailLoading(true)
    // Bring it in on the next frame so the slide transition runs from off-screen.
    setTimeout(() => setDetailShown(true), 10)
    const [itemsRes, pkgRes, svcRes, riRes, payRes] = await Promise.all([
      supabase.from('order_items').select('*, product:products(name,code)').eq('order_id', o.id).eq('is_deleted', false),
      supabase.from('delivery_packages').select('*, provider:contacts!provider_id(company_name,first_name,last_name)').eq('order_id', o.id).order('created_at'),
      supabase.from('order_services').select('*, provider:contacts!provider_id(company_name,first_name,last_name)').eq('order_id', o.id).order('service_date'),
      supabase.from('retail_goods_invoices').select('*').eq('order_id', o.id).order('created_at'),
      supabase.from('payment_collections').select('*').eq('order_id', o.id).order('collected_at'),
    ])
    setDetailData({
      items:          itemsRes.data ?? [],
      packages:       pkgRes.data   ?? [],
      services:       svcRes.data   ?? [],
      retailInvoices: riRes.data    ?? [],
      payments:       payRes.data   ?? [],
    })
    setDetailLoading(false)
  }

  function closeDetail() {
    setDetailShown(false)
    // Wait for the slide-out before unmounting so the animation is visible.
    setTimeout(() => { setDetail(null); setDetailData(null); setDetailPinned(false) }, 300)
  }

  function closeModal() {
    savedOrderIdRef.current = null
    setModal(null); setItems([]); setRetailInvoices([]); setPayments([]); setOrigPaymentIds([]); setError('')
    setPackages([]); setOrigPackageIds([])
    setServices([]); setOrigServiceIds([])
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

  /* ── quick "Pay" from the list ───────────────────────────────
     Records one payment_collections row on an order and recomputes the order's
     payment_status / collected totals — same effect as the form's Payments section. */
  async function openPay(o) {
    rememberOrder(o.id)
    if (isRowLocked(o)) return   // closed or deactivated orders are locked
    if (!isConfirmed(o)) return  // payment can't be recorded until the order is confirmed
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
    rememberOrder(o.id)
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
      collection_group:  'Call center',   // recorded by an office user
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
    // 2nd-party users: the shop is always their own linked contact.
    const partyFields = partyContactId
      ? { shop_name: partyContactName, contact_id: partyContactId, contact_code: partyContact?.code || '', shop_type: partyContact?.shop_type || '' }
      : {}
    setRetailInvoices(p => [...p, { ...EMPTY_RETAIL_INVOICE, invoice_date: new Date().toISOString().slice(0, 10), ...partyFields, _key: Date.now() }])
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
    // 2nd-party users can't save changes to a confirmed order (defensive guard —
    // the UI already blocks opening a confirmed order for editing).
    if (partyContactId && modal && isConfirmed(modal)) {
      return setError('This order is confirmed and can no longer be edited.')
    }
    if (!form.recipient_name.trim())   return setError('Recipient name is required.')
    // Story (ads/services) orders have no route — mobile & delivery address aren't
    // required (there's nothing to deliver).
    if (!isStory && !form.recipient_mobile.trim()) return setError('Recipient mobile is required.')
    if (!isStory && !form.delivery_address.trim()) return setError('Delivery address is required.')
    if (!form.customer_id)             return setError('Please select a customer.')
    // Closing is what puts a charge on the account, so the account's terms (cash
    // vs credit, limit, expiry) are enforced here rather than on every save. The
    // Mark Closed button is already disabled in this case — this is the guard
    // behind it, since the button isn't the only way to reach a close.
    if (close && !accountCheck.ok) return setError(accountCheck.reason)

    // 2nd-party (supplier/partner) users: force their own linked contact as the
    // package provider and the retail-invoice shop, so the order always
    // references them (and they can't set it to anyone else).
    const packagesEff = partyContactId
      ? packages.map(p => ({ ...p, provider_id: partyContactId }))
      : packages
    const retailEff = partyContactId
      ? retailInvoices.map(r => ({
          ...r,
          shop_name:    partyContactName || r.shop_name,
          contact_id:   partyContactId,
          contact_code: partyContact?.code || r.contact_code || '',
          shop_type:    partyContact?.shop_type || r.shop_type || '',
        }))
      : retailInvoices

    // Package provider and reference are mandatory on every package row.
    for (const p of packagesEff) {
      if (!p.provider_id)             return setError('Each package needs a Package provider.')
      if (!p.tracking_number?.trim()) return setError('Each package needs a Package reference.')
    }

    // Backstop for "Mark Closed": besides the disabled button, re-verify the close
    // requirements at save-time so an order can never be locked while ineligible
    // (status Completed, delivery Delivered, and fully collected / zero pending —
    // payment waived only for credit orders / credit-allowed customers).
    // A super admin can always lock an order; everyone else must meet the
    // requirements above.
    if (close && (alreadyClosed || (!canClose && !isSuperAdmin))) {
      return setError(alreadyClosed
        ? 'This order is already closed.'
        : 'Cannot close — order must be: ' + closeRequirements.join(', ') + '.')
    }

    setSaving(true); setError('')

    const isFree = !!form.is_free_order
    const rawTotals = calcTotals(items, form.delivery_fee, form.currency, form.discount_amount, form.vat_amount, form.discount_currency, packages, services, retailInvoices)
    // A free order is stored at zero total regardless of the items it carries.
    const totals = isFree ? { USD: 0, LBP: 0, EUR: 0 } : rawTotals
    const itemsInPrimary = items.filter(it => it.currency === form.currency).reduce((s, it) => s + lineTotal(it), 0)

    // Derive payment status from the payments list vs the order totals, per currency.
    // A free order owes nothing, so it's stored as fully settled.
    const paidCur = paidByCurrency(payments)
    const derivedPaymentStatus = isFree
      ? 'paid_to_office'
      : ['closed', 'refunded'].includes(form.payment_status)
        ? form.payment_status                       // preserve terminal states on edit
        : derivePaymentStatus(paidCur, totals)
    // Money collection state, derived from payments (driver-collected cash recorded as payments).
    const collectionStatus = isFree ? COLLECTION_FULL : collectionFromPayStatus(derivePaymentStatus(paidCur, totals))
    // "Mark Closed" locks the order via the isclosed flag. closed_by_name records
    // who locked it (shown as the lock indicator; only a super admin can unlock).
    const closeCols = close
      ? { isclosed: true, closed_at: new Date().toISOString(), closed_by: currentUser?.user_id || null, closed_by_name: currentUserName }
      : {}

    // New-order source: an order counts as an "outside" partner/supplier order
    // ONLY when a 2nd-party (supplier/partner) user is signed in and creates it —
    // then the source is THEIR role ('partner' / 'supplier') and it arrives
    // UNCONFIRMED for the call center to review. Anything the call center adds is a
    // "Call center" order that is confirmed on creation, regardless of whether the
    // customer contact happens to be a partner or supplier type.
    const addSource = partyContactId
      ? (currentUser?.role === 'supplier' ? 'supplier' : 'partner')
      : 'Call center'
    const addNeedsConfirm = !!partyContactId

    const payload = {
      recipient_name:       form.recipient_name.trim(),
      recipient_mobile:     form.recipient_mobile.trim(),
      recipient_whatsapp:   form.recipient_whatsapp?.trim() || null,
      customer_id:          form.customer_id,
      main_account:         form.main_account || null,
      sub_account_id:       form.sub_account_id || null,
      is_credit_order:      modal !== 'add' && modal?.is_credit_order === true,   // preserved on edit; credit handling now keys off the customer
      pickup_address:       form.pickup_address?.trim()  || null,
      delivery_address:     form.delivery_address.trim(),
      delivery_lat:         form.delivery_lat === '' || form.delivery_lat == null ? null : Number(form.delivery_lat),
      delivery_lng:         form.delivery_lng === '' || form.delivery_lng == null ? null : Number(form.delivery_lng),
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
      // Free order: total is 0. Stamp who set it free + when — preserving the
      // original stamp if it was already free (only the first setter is recorded).
      is_free_order:        isFree,
      free_marked_by:       isFree ? ((modal !== 'add' && modal?.free_marked_by) || currentUser?.user_id || null) : null,
      free_marked_at:       isFree ? ((modal !== 'add' && modal?.free_marked_at) || new Date().toISOString())    : null,
      order_type:            (partyContactId && partyContact?.shop_type) ? partyContact.shop_type : (form.order_type || null),
      // Procurement is per-invoice now; keep the order-level flag as a summary
      // (true when any local-market invoice is marked "we purchased these goods").
      // Never set for shop-sent (2nd-party) orders.
      is_procurement:        !partyContactId && retailEff.some(r => r.shop_name?.trim() && r.is_procurement),
      order_details_text:    form.order_details_text?.trim()   || null,
      special_instructions:  form.special_instructions?.trim() || null,
      scheduled_date:        form.scheduled_date               || null,
      scheduled_time_from:   form.scheduled_time_from          || null,
      scheduled_time_to:     form.scheduled_time_to            || null,
      // New orders are tagged with the customer's contact type as the source.
      // Regular/customer orders are confirmed on creation; partner & supplier
      // orders arrive unconfirmed (treated like online orders) so the call
      // center confirms them via the popover.
      ...(modal === 'add'
        ? { order_confirmed: !addNeedsConfirm, order_source: addSource }
        : {}),
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
      rememberOrder(orderId)   // return to the new order after a refresh
    } else {
      const { error: e } = await supabase.from('delivery_orders').update(payload).eq('id', orderId)
      if (e) { setError(e.message); setSaving(false); return }
      // Return to this order after a refresh (new or edited).
      rememberOrder(orderId)
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

    // Retail goods invoices — only rows with a shop selected. Procurement is now
    // a per-invoice flag ("we purchased these goods"): each such invoice snapshots
    // the shop's commission % and the money we earn (invoice value × %). Invoices
    // left off (shop-sent) record no commission.
    const retailRows = retailEff
      .filter(r => r.shop_name?.trim())
      .map(r => {
        const value = Number(r.invoice_value) || 0
        const isProc = !partyContactId && !!r.is_procurement
        const shop  = r.contact_id ? customers.find(c => c.id === r.contact_id) : null
        const rate  = isProc ? Number(shop?.partner_percentage) : NaN
        const hasRate = Number.isFinite(rate) && rate > 0
        return {
          order_id:          orderId,
          shop_name:         r.shop_name.trim(),
          shop_type:         r.shop_type?.trim() || null,
          contact_id:        r.contact_id || null,
          contact_code:      r.contact_code?.trim() || null,
          invoice_reference: r.invoice_reference?.trim() || null,
          invoice_date:      r.invoice_date || new Date().toISOString().slice(0, 10),
          invoice_value:     value,
          currency:          r.currency || 'USD',
          exclude_calculation: !!r.paid,
          payment_type:      r.payment_type || null,
          is_procurement:    isProc,
          commission_rate:   hasRate ? rate : null,
          commission_amount: hasRate ? round2(value * rate / 100) : null,
          created_by:        currentUser?.user_id || null,
          ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
        }
      })
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
            collection_group:  'Call center',   // recorded by an office user
          }])
      if (pe) { setError(pe.message); setSaving(false); return }
    }

    // ── Sync delivery packages (partners) ────────────────────
    const selCustomer = customers.find(c => c.id === form.customer_id) || null
    const pkgErr = await saveOrderPackages({
      orderId, packages: packagesEff, origIds: origPackageIds,
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
    rememberOrder(order.id)
    if (isRowLocked(order)) return
    // Order status is set by the driver app — only admins/super admins may change
    // it by hand. Backstops the hidden list button.
    if (type === 'status' && !canEditOrderStatus) return
    // Nothing can be done to an order until it's confirmed — only the confirm
    // toggle ('online') stays available. Backstops the disabled buttons.
    if (type !== 'online' && !isConfirmed(order)) return
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
    rememberOrder(order.id)
    if (!isConfirmed(order)) { setPopover(null); return }   // driver can't be assigned until confirmed
    setQuickBusy(true)
    await supabase.from('delivery_orders').update({ driver_id: driverId || null }).eq('id', order.id)
    await fetchOrders()
    setQuickBusy(false); setPopover(null)
  }

  async function quickSetStatus(order, uiStatus) {
    rememberOrder(order.id)
    if (!isConfirmed(order)) { setPopover(null); return }   // status is locked until the order is confirmed
    setQuickBusy(true)
    const patch = { status: toDbStatus(uiStatus) }
    // Selecting "Completed" implies the materials reached the customer — move the
    // delivery status straight to Delivered so both stay in sync from the list.
    if (uiStatus === 'completed') patch.delivery_status = 'Delivered'
    // Selecting "In Progress" means the delivery is on its way — move the delivery
    // status to In Transit (unless already further along) so both stay in sync.
    else if (uiStatus === 'in_progress' && order.delivery_status !== 'Delivered') {
      patch.delivery_status = 'In Transit'
    }
    await supabase.from('delivery_orders').update(patch).eq('id', order.id)
    await fetchOrders()
    setQuickBusy(false); setPopover(null)
  }

  // Quick delivery-fee edit from the list. Updates delivery_fee + currency and
  // recomputes total_amount (in the order's primary currency) so list totals and
  // the Amount(s) sort stay in sync.
  async function quickSaveFee(order, amount, currency) {
    rememberOrder(order.id)
    if (!isConfirmed(order)) { setPopover(null); return }   // fee can't be edited until confirmed
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
    rememberOrder(order.id)
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
    rememberOrder(o.id)
    setToggling(o.id)
    await supabase.from('delivery_orders').update({ is_flagged: !isFlagged(o) }).eq('id', o.id)
    await fetchOrders()
    setToggling(null)
  }

  // Power button. Reactivating a cancelled/failed order is immediate; deactivating
  // an active one opens a confirmation modal that warns about — and then deletes —
  // every transaction on the order (see confirmCancel).
  async function toggleCancel(o) {
    rememberOrder(o.id)
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
    rememberOrder(o.id)
    // A super admin can always lock an order; everyone else only when it's fully
    // collected and delivered (canQuickClose).
    if (!canQuickClose(o) && !isSuperAdmin) return
    setToggling(o.id)
    await supabase.from('delivery_orders').update({
      isclosed:  true,
      closed_at: new Date().toISOString(),
      closed_by: currentUser?.user_id || null,
      closed_by_name: currentUserName,
    }).eq('id', o.id)
    await fetchOrders()
    setToggling(null)
  }

  // Super-admin only: reopen a closed order — clears the isclosed lock (and its
  // closed_at/closed_by stamps) so the order can be edited/settled again. Admins
  // and regular users can lock an order but can never unlock one.
  async function reopenClosed(o) {
    rememberOrder(o.id)
    if (!isSuperAdmin || !o.isclosed) return
    setToggling(o.id)
    await supabase.from('delivery_orders').update({
      isclosed:  false,
      closed_at: null,
      closed_by: null,
      closed_by_name: null,
    }).eq('id', o.id)
    await fetchOrders()
    setToggling(null)
  }

  // Unlock the order currently open in the modal (super admin only) and reflect it
  // in the open modal at once, so it becomes editable without reopening.
  async function unlockCurrentOrder() {
    if (!isSuperAdmin || !modal || modal === 'add' || !modal.isclosed) return
    await reopenClosed(modal)
    setModal(m => (m && m !== 'add')
      ? { ...m, isclosed: false, closed_at: null, closed_by: null, closed_by_name: null }
      : m)
  }

  // Super-admin "lock order" (is_locked) — a standalone freeze, separate from
  // closing. It stamps who locked it (is_locked_by) and the reason (why_is_locked),
  // stored server-side so the lock applies to every signed-in user everywhere and
  // propagates via realtime. Regardless of the order's state.
  async function applyOrderLock(reason) {
    if (!isSuperAdmin || !modal || modal === 'add' || modal.is_locked) return
    const why = (reason || '').trim() || null
    setToggling(modal.id)
    const { error: e } = await supabase.from('delivery_orders').update({
      is_locked:     true,
      is_locked_by:  currentUserName,
      why_is_locked: why,
    }).eq('id', modal.id)
    setToggling(null)
    // Surface a write failure (e.g. the is_locked columns not yet visible to the
    // API) instead of pretending the lock stuck — otherwise other users would
    // never see it because it never reached the database.
    if (e) {
      setError(/column .* does not exist|schema cache|is_locked/i.test(e.message)
        ? 'Lock columns are not available in the API yet. Run: NOTIFY pgrst, \'reload schema\'; in Supabase, then try again.'
        : (e.message || 'Could not lock the order.'))
      return
    }
    await fetchOrders()
    setModal(m => (m && m !== 'add')
      ? { ...m, is_locked: true, is_locked_by: currentUserName, why_is_locked: why }
      : m)
  }

  // Remove the super-admin lock (super admin only). Clears the locker + reason.
  async function removeOrderLock() {
    if (!isSuperAdmin || !modal || modal === 'add' || !modal.is_locked) return
    setToggling(modal.id)
    const { error: e } = await supabase.from('delivery_orders').update({
      is_locked:     false,
      is_locked_by:  null,
      why_is_locked: null,
    }).eq('id', modal.id)
    setToggling(null)
    if (e) { setError(e.message || 'Could not unlock the order.'); return }
    await fetchOrders()
    setModal(m => (m && m !== 'add')
      ? { ...m, is_locked: false, is_locked_by: null, why_is_locked: null }
      : m)
  }

  async function copyNum(num) {
    const text = String(num ?? '')
    if (!text) return
    let ok = false
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); ok = true }
    } catch { /* clipboard API blocked/unavailable — fall back below */ }
    if (!ok) {
      // Legacy fallback (works when the async Clipboard API is unavailable, e.g.
      // an unfocused window or non-secure context): copy via a temp textarea.
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch { /* ignore — nothing more we can do */ }
    }
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

  const rawTotals = calcTotals(items, form.delivery_fee, form.currency, form.discount_amount, form.vat_amount, form.discount_currency, packages, services, retailInvoices)
  // A free order is waived to zero even when it carries items. rawTotals keeps the
  // real value so we can warn before flipping the toggle on a non-zero order.
  const totals    = form.is_free_order ? { USD: 0, LBP: 0, EUR: 0 } : rawTotals
  const rawHasValue = CURRENCIES.some(c => round2(rawTotals[c] || 0) > 0)
  const anyItems = items.length > 0 || packages.length > 0 || services.length > 0 || retailInvoices.length > 0 || Number(form.delivery_fee) > 0

  // Every order uses the same full form regardless of the customer; the picker
  // always lists all customers (credit handling is derived from the customer).
  const pickCustomers = customers
  // Shops/warehouses for the retail invoices dropdown = supplier contacts.
  // supplierByName maps a shop's display name → its contact, so selecting a
  // shop can auto-fill the invoice's business type (shop_type).
  const supplierContacts  = customers.filter(c => contactHasType(c, 'supplier'))
  const partnerContacts   = customers.filter(c => contactHasType(c, 'partner'))
  const supplierByName    = {}
  supplierContacts.forEach(c => {
    const name = c.company_name || customerName(c)
    if (name) supplierByName[name] = c
  })
  const supplierOptions   = Object.keys(supplierByName)

  // Quick-pick suggestions for the pickup / delivery tag fields: the user's saved
  // locations, plus values already used on other orders (and supplier shops for
  // pickup), de-duped case-sensitively for display, with user-hidden values removed.
  const uniq = arr => [...new Set(arr.filter(Boolean))]
  const notHidden = (hidden) => { const h = new Set(hidden.map(x => x.toLowerCase())); return v => !h.has(v.toLowerCase()) }
  const pickupSuggestions   = uniq([...savedPickup, ...supplierOptions,
    ...(orders ?? []).flatMap(o => splitLocs(o.pickup_address))]).filter(notHidden(hiddenPickup))
  const deliverySuggestions = uniq([...savedDelivery,
    ...(orders ?? []).flatMap(o => splitLocs(o.delivery_address))]).filter(notHidden(hiddenDelivery))

  // Counts shown in the section titles.
  const packagesQty = packages.reduce((s, p) => s + (Number(p.quantity) || 0), 0)
  const itemsQty    = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  const invoicesQty = retailInvoices.length

  const trimmedCustomer = customerInput.trim()
  const isNewCustomer =
    trimmedCustomer !== '' &&
    !form.customer_id &&
    !customers.some(c => customerName(c).toLowerCase() === trimmedCustomer.toLowerCase())

  const trimmedRecipient = (form.recipient_name || '').trim()
  const isNewRecipient =
    trimmedRecipient !== '' &&
    !customers.some(c =>
      customerName(c).toLowerCase() === trimmedRecipient.toLowerCase() ||
      (c.company_name || '').toLowerCase() === trimmedRecipient.toLowerCase())

  const paidByCur     = paidByCurrency(payments)
  // A free order owes nothing, so it reads as fully settled ("ready to close").
  const paymentStatus = form.is_free_order ? 'paid_to_office' : derivePaymentStatus(paidByCur, totals)
  const collectionFromCustomer = collectionFromPayStatus(paymentStatus)

  // A closed OR deactivated (cancelled/failed) order is locked: view-only, no edits.
  const orderLocked   = modal && modal !== 'add' && (modal.isclosed === true || modal.is_locked === true || isDeactivated(modal))
  const alreadyClosed = modal && modal !== 'add' && modal.isclosed === true
  // Separate super-admin "lock order" (is_locked) — distinct from closing.
  const isLockedNow   = modal && modal !== 'add' && modal.is_locked === true
  // Is the order in the modal an "Ads & Services" (Story) order? Drives which
  // sections are shown (no route/driver/delivery/packages/market/services/fee).
  const isStory       = isStoryOrder(form)
  // Credit customers may close an order with an unpaid balance (it becomes a
  // receivable). Detect credit from the picker list AND, as a fallback, from the
  // order's own joined customer — the credit contact may not be in the picker list
  // (it only holds customer/partner/supplier types), but the order still carries
  // its customer record, and "Mark Closed" only shows while editing an order.
  const customerAllowsCredit =
    customers.find(c => c.id === form.customer_id)?.credit_debit_allowed === true ||
    (modal && modal !== 'add' && modal.customer?.credit_debit_allowed === true)
  // A zero-total order has nothing to collect, so payment can never gate its close.
  const zeroTotal = !CURRENCIES.some(c => round2(totals[c] || 0) > 0)

  /* ── the account this order bills to (fix81) ──────────────────
     Every contact's account numbers, the one this order is charged to, and what
     that account already owes. A contact with no sub_accounts rows yet (e.g. the
     migration hasn't run) yields null, and every check below no-ops — so the old
     credit_debit_allowed behaviour stands until accounts actually exist. */
  const customerAccounts = subAccounts.filter(s => s.contact_id === form.customer_id)
  const selectedAccount  = resolveSubAccount(form.sub_account_id || null, customerAccounts)
  // What the account owes BEFORE this order. The current order is excluded so
  // that reopening an already-closed order doesn't count its own charge twice.
  const accountOutstanding = selectedAccount
    ? subAccountBalance({
        account:  selectedAccount,
        orders:   orders.filter(o =>
          o.customer_id === form.customer_id && o.isclosed === true &&
          !(modal && modal !== 'add' && o.id === modal.id)),
        payments: creditPayments.filter(p => p.customer_id === form.customer_id),
        accounts: customerAccounts,
        orderTotal: orderTotalsByCurrency,
      })
    : 0
  // The unpaid balance this order would leave on that account, in its currency.
  const orderOwing = round2((totals[form.currency] || 0) - (paidByCur[form.currency] || 0))
  const accountCheck = checkSubAccountCharge({
    account: selectedAccount,
    amount: orderOwing,
    currency: form.currency,
    outstanding: accountOutstanding,
  })

  // "Mark Closed" eligibility: order status Completed + delivery Delivered, and
  // fully paid — except a credit-allowed customer (or a zero-total order) may close
  // with an unpaid balance (it becomes a receivable settled later on the Credit
  // Customers page).
  const closeRequirements = []
  // Once a contact has account numbers, THEY decide whether an unpaid balance may
  // close: a cash account must be settled, a credit account must stay inside its
  // limit and expiry. credit_debit_allowed only still governs contacts that have
  // no accounts yet.
  if (selectedAccount) {
    // Terse here because this list renders as "must be: a, b" — the full
    // explanation is on the form under the account, and in the save guard.
    if (!accountCheck.ok) closeRequirements.push('within the account’s terms')
  } else if (paymentStatus !== 'paid_to_office' && !customerAllowsCredit && !zeroTotal) {
    closeRequirements.push('fully paid (no pending dues)')
  }
  if (form.status !== 'completed')          closeRequirements.push('order status Completed')
  // Story (ads/services) orders have no delivery status, so it isn't required.
  if (!isStory && form.delivery_status !== 'Delivered') closeRequirements.push('delivery status Delivered')
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
              <CheckCircle2 className="w-4 h-4 text-slate-500" />
              {[
                { value: 'all',         label: 'All',         cls: FILTER_VARIANTS.all },
                { value: 'confirmed',   label: 'Confirmed',   cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
                { value: 'unconfirmed', label: 'Unconfirmed', cls: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
              ].map(c => {
                const active = confirmFilter === c.value
                return (
                  <button key={c.value} onClick={() => setConfirmFilter(c.value)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border transition-all ${
                      active ? c.cls : 'border-surface-border text-slate-500 hover:text-slate-100 hover:bg-surface-hover'
                    }`}>
                    {c.label}
                  </button>
                )
              })}
              <span className="w-px h-5 bg-surface-border mx-1" />
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
          {/* Flagged / unflagged — useful on closed orders too, for chasing
              problem deliveries after the fact. */}
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
          {!closed && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setAuditOpen(true)}
                title="Check the daily orders for possible errors"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  auditRows.length
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15'
                    : 'border-surface-border text-slate-400 hover:text-slate-100 hover:bg-surface-hover'}`}>
                <AlertTriangle className="w-4 h-4" /> Check orders
                {auditRows.length > 0 && (
                  <span className="ml-0.5 text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/30">
                    {auditRows.length}
                  </span>
                )}
              </button>
              <button
                onClick={openAddStory}
                title="New ads / services (Story) order — no route or delivery"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/15 transition-colors">
                <Tag className="w-4 h-4" /> Add Ad
              </button>
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
          <div className="relative">
            <label className="label flex items-center gap-1"><UserCheck className="w-3 h-3" /> Customer type</label>
            <button type="button" onClick={() => setCatMenuOpen(o => !o)}
              className="input py-1.5 text-xs w-40 flex items-center justify-between gap-1 text-left">
              <span className="truncate">
                {categoryFilter.length === 0
                  ? 'All types'
                  : categoryFilter.length === 1
                    ? (CATEGORY_OPTIONS.find(o => o.value === categoryFilter[0])?.label || '1 selected')
                    : `${categoryFilter.length} types`}
              </span>
              <ChevronDown className="w-3 h-3 flex-shrink-0 text-slate-500" />
            </button>
            {catMenuOpen && (<>
              <div className="fixed inset-0 z-40" onClick={() => setCatMenuOpen(false)} />
              <div className="absolute z-50 mt-1 w-44 rounded-lg border border-surface-border bg-surface-card shadow-xl p-1">
                {CATEGORY_OPTIONS.map(opt => {
                  const on = categoryFilter.includes(opt.value)
                  return (
                    <button key={opt.value} type="button" onClick={() => toggleCategory(opt.value)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-surface-hover">
                      {on ? <CheckCircle2 className="w-3.5 h-3.5 text-brand-400" /> : <Circle className="w-3.5 h-3.5 text-slate-600" />}
                      <span>{opt.label}</span>
                    </button>
                  )
                })}
                {categoryFilter.length > 0 && (
                  <button type="button" onClick={() => setCategoryFilter([])}
                    className="w-full text-left px-2 py-1.5 mt-1 border-t border-surface-border text-[11px] text-slate-500 hover:text-slate-300">
                    Clear (show all)
                  </button>
                )}
              </div>
            </>)}
          </div>
          <div>
            <label className="label flex items-center gap-1"><Package className="w-3 h-3" /> Order source</label>
            <select className="input py-1.5 text-xs w-36" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
              <option value="">All sources</option>
              {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label flex items-center gap-1"><Tag className="w-3 h-3" /> Order type</label>
            <select className="input py-1.5 text-xs w-40" value={orderTypeFilter} onChange={e => setOrderTypeFilter(e.target.value)}>
              <option value="">All order types</option>
              {orderTypeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col justify-end">
            <button type="button" onClick={toggleToday}
              title={todayActive ? "Showing today's scheduled orders — click to clear" : "Set the scheduled date range to today"}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                todayActive
                  ? 'bg-brand-500/15 text-brand-300 border-brand-500/40'
                  : 'border-surface-border text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
              }`}>
              <Calendar className="w-3.5 h-3.5" /> Today
            </button>
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
              {['Order #','Schedule','Recipient','Customer','Driver',
                ...(partyContactId ? [] : ['Delivery Fee']),'Notes','Status',
                ...(partyContactId ? [] : ['Payment']),''].map(h => {
                const sortable = !!SORT_GETTERS[h]
                const active   = sort.col === h
                return (
                  <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap">
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
            {loading.orders && orders.length === 0 ? (
              <tr><td colSpan={partyContactId ? 8 : 10} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={partyContactId ? 8 : 10} className="px-4 py-10 text-center text-slate-500">{closed ? 'No closed orders found' : 'No orders found'}</td></tr>
            ) : renderGroups.flatMap(g => [
              // Group header — click to expand/collapse (Closed Orders date groups
              // and the daily Delivery Orders / Ads & Services groups).
              ...(g.showHeader ? [(
                <tr key={`group-${g.key}`} className="bg-surface-hover/40 border-y border-surface-border">
                  <td colSpan={partyContactId ? 8 : 10} className="px-0 py-0">
                    <button type="button" onClick={g.onToggle}
                      className="w-full flex items-center gap-2 px-4 py-2 hover:bg-surface-hover/60 transition-colors text-left">
                      {g.open
                        ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                      <span className="text-xs font-semibold text-slate-200">{g.label}</span>
                      <span className="text-[11px] text-slate-500">
                        {g.orders.length} order{g.orders.length === 1 ? '' : 's'}
                      </span>
                      {!g.open && g.orders.length > 0 && (
                        <span className="text-[10px] text-slate-600 ml-auto">click to show</span>
                      )}
                      {g.orders.length === 0 && (
                        <span className="text-[10px] text-slate-600 ml-auto">none</span>
                      )}
                    </button>
                  </td>
                </tr>
              )] : []),
              ...(g.open ? g.orders.map(o => (
              <tr key={o.id} id={`order-row-${o.id}`}
                onMouseEnter={(e) => setHoverSummary({ order: o, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => placeHoverPanel(hoverPanelRef.current, e.clientX, e.clientY)}
                className={`border-b border-surface-border/50 transition-colors ${
                flashOrderId === o.id ? '!bg-brand-500/20 ' : ''}${
                isDeactivated(o)            ? 'opacity-50 hover:bg-surface-hover/40'
                : isActiveInProgress(o, now) ? 'hover:bg-surface-hover/40'
                : isOverdue(o)              ? 'bg-red-500/10 hover:bg-red-500/20'
                : isApproachingStart(o, highlightLeadMins, now)
                                            ? 'bg-red-500/10 hover:bg-red-500/20'
                :                            'hover:bg-surface-hover/40'} ${
                (isPastDeliveryEnd(o, now) || (normalizeStatus(o.status) === 'in_progress' && isOverdue(o)))
                  ? '[&_*]:!text-[#fa8072]'
                  : isActiveInProgress(o, now)
                  ? '[&_*]:!text-brand-400'
                  : isConfirmed(o) ? '' : '[&_*]:!text-fuchsia-300'}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => copyNum(o.order_number)}
                      className="font-mono text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1 whitespace-nowrap">
                      {o.order_number}
                      {copied === o.order_number && <Check className="w-3 h-3 text-green-400" />}
                    </button>
                    {(() => {
                      const kind = orderSourceKind(o)
                      if (!kind || partyContactId) return null
                      const cfg = {
                        online:   { Icon: Globe,     title: 'Online order — confirm',   cls: 'text-cyan-400 hover:text-cyan-300' },
                        supplier: { Icon: Building,  title: 'Supplier order — confirm', cls: 'text-orange-400 hover:text-orange-300' },
                        partner:  { Icon: Handshake, title: 'Partner order — confirm',  cls: 'text-purple-400 hover:text-purple-300' },
                      }[kind]
                      const { Icon } = cfg
                      return (
                        <button type="button" disabled={isRowLocked(o)}
                          onClick={(e) => openPopover('online', o, e)}
                          title={cfg.title}
                          className={`inline-flex ${cfg.cls} disabled:opacity-40 disabled:cursor-not-allowed`}>
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      )
                    })()}
                  </div>
                  {(() => {
                    const remind = needsConfirmReminder(o, reminderMins, now)
                    return (
                      <button type="button" onClick={(e) => openPopover('online', o, e)} disabled={isRowLocked(o) || !!partyContactId}
                        title={partyContactId ? undefined : (remind ? 'This order has been placed but not confirmed — click to confirm' : 'Click to change confirmation')}
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
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-400 mt-1 ml-1"
                      title={o.closed_by_name ? `Closed by ${o.closed_by_name}` : 'Closed'}>
                      <Lock className="w-3 h-3" /> {o.closed_by_name ? `Closed by ${o.closed_by_name}` : 'Closed'}
                    </span>
                  )}
                  {o.is_locked && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 mt-1 ml-1"
                      title={`Locked${o.is_locked_by ? ` by ${o.is_locked_by}` : ''}${o.why_is_locked ? ` — ${o.why_is_locked}` : ''}`}>
                      <Lock className="w-3 h-3" /> {o.is_locked_by ? `Locked by ${o.is_locked_by}` : 'Locked'}
                    </span>
                  )}
                </td>
                {/* Schedule — scheduled date + time range */}
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  {o.scheduled_date ? (
                    <>
                      <p className="text-slate-300 font-mono tracking-wider whitespace-nowrap">{String(o.scheduled_date).slice(0, 10)}</p>
                      {fmtTimeRange(o.scheduled_time_from, o.scheduled_time_to) && (
                        <p className="text-slate-500 font-mono tracking-wider mt-0.5 whitespace-nowrap">{fmtTimeRange(o.scheduled_time_from, o.scheduled_time_to)}</p>
                      )}
                    </>
                  ) : <span className="text-slate-600">—</span>}
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
                          <span title="Credit customer (may owe a balance)" className="inline-flex text-amber-400">
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
                    <button type="button" disabled={isRowLocked(o) || isPickedUp(o) || !!partyContactId || !isConfirmed(o)}
                      onClick={(e) => openPopover('driver', o, e)}
                      title={partyContactId ? 'Assigned by the operations team' : (o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : !isConfirmed(o) ? 'Confirm the order first to assign a driver' : isPickedUp(o) ? 'Picked up — driver locked' : normalizeStatus(o.status) === 'in_progress' ? 'In progress — out for delivery' : 'Assign driver')}
                      className="btn-ghost p-1 text-brand-400 hover:text-brand-300 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Truck className={`w-3.5 h-3.5 ${normalizeStatus(o.status) === 'in_progress' ? 'animate-truck' : ''}`} />
                    </button>
                    <div>
                      {o.driver ? `${o.driver.first_name} ${o.driver.last_name}` : <span className="text-slate-600">Unassigned</span>}
                      {!closed && o.driver && driverVehicle[o.driver_id] && (
                        <p className="text-slate-500 text-[11px] font-mono tracking-wider">{driverVehicle[o.driver_id]}</p>
                      )}
                    </div>
                  </div>
                </td>
                {!partyContactId && (
                <td className="px-4 py-3">
                  <button type="button" disabled={isRowLocked(o) || !isConfirmed(o)}
                    onClick={(e) => openPopover('fee', o, e)}
                    title={o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : !isConfirmed(o) ? 'Confirm the order first to edit the fee' : 'Edit delivery fee'}
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
                )}
                {/* Notes — delivery description (order details) + special instructions */}
                <td className="px-4 py-3 text-xs">
                  {(o.order_details_text || o.special_instructions) ? (
                    <div className="space-y-0.5 max-w-[16rem]">
                      {o.order_details_text && (
                        <p className="text-slate-300 truncate" title={o.order_details_text}>{o.order_details_text}</p>
                      )}
                      {o.special_instructions && (
                        <p className="text-slate-500 truncate" title={o.special_instructions}>
                          <span className="text-slate-600">Note: </span>{o.special_instructions}
                        </p>
                      )}
                    </div>
                  ) : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  {partyContactId || !canEditOrderStatus ? (
                    /* 2nd-party users and normal (call-center) users can't change the
                       order status — it's set by the driver app. View only. */
                    <Badge status={normalizeStatus(o.status)} />
                  ) : (
                    <button type="button" disabled={isRowLocked(o) || !isConfirmed(o)}
                      onClick={(e) => openPopover('status', o, e)}
                      title={o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : !isConfirmed(o) ? 'Confirm the order first to change its status' : 'Change status'}
                      className="disabled:cursor-not-allowed disabled:opacity-60 hover:opacity-80 transition-opacity">
                      <Badge status={normalizeStatus(o.status)} />
                    </button>
                  )}
                  {o.delivery_status && <p className="text-slate-500 text-[11px] mt-1">{o.delivery_status}</p>}
                </td>
                {!partyContactId && (
                <td className="px-4 py-3">
                  <Badge status={o.payment_status} />
                  {o.collection_from_customer && <p className="text-slate-500 text-[11px] mt-1">{o.collection_from_customer}</p>}
                </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    {partyContactId ? (
                      /* 2nd-party users: a confirmed order is locked (view-only);
                         otherwise edit. No flag/pay/close/cancel. */
                      isConfirmed(o) ? (
                        <button onClick={() => openDetail(o)} className="btn-ghost p-1.5 text-slate-500 hover:text-brand-300 hover:bg-brand-500/10"
                          title="Confirmed — locked (view only)">
                          <Eye className="w-4 h-4" />
                        </button>
                      ) : (
                        <button onClick={() => openEdit(o)} className="btn-ghost p-1.5 text-slate-500"
                          title={isRowLocked(o) ? 'View (locked)' : 'Edit'}>
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )
                    ) : (
                    <>
                    <button onClick={() => toggleFlag(o)} disabled={toggling === o.id}
                      title={isFlagged(o) ? 'Unflag order' : 'Flag order'}
                      className={`btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                        isFlagged(o)
                          ? 'text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10'
                          : 'text-slate-500 hover:text-cyan-300 hover:bg-cyan-500/10'}`}>
                      <Flag className={`w-4 h-4 ${isFlagged(o) ? 'fill-cyan-300 animate-flag' : ''}`} />
                    </button>
                    {isFullyPaid(o) ? (
                      <span title="Fully paid — nothing to collect"
                        className="p-1.5 inline-flex items-center text-green-400">
                        <CheckCircle2 className="w-4 h-4" />
                      </span>
                    ) : (
                      <button onClick={() => openPay(o)} disabled={isRowLocked(o) || !isConfirmed(o)}
                        title={o.isclosed ? 'Closed — locked' : isDeactivated(o) ? 'Deactivated — locked' : !isConfirmed(o) ? 'Confirm the order first to record payment' : 'Record payment'}
                        className="btn-ghost p-1.5 text-slate-500 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Banknote className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => openDetail(o)} className="btn-ghost p-1.5 text-slate-500 hover:text-brand-300 hover:bg-brand-500/10"
                      title="View order details">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button onClick={() => openEdit(o)} className="btn-ghost p-1.5 text-slate-500"
                      title={isRowLocked(o) ? 'View (locked)' : 'Edit'}>
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {!closed && !o.isclosed && !isDeactivated(o) && (
                      <button onClick={() => markClosed(o)} disabled={toggling === o.id || (!canQuickClose(o) && !isSuperAdmin)}
                        title={(canQuickClose(o) || isSuperAdmin)
                          ? (isSuperAdmin && !canQuickClose(o) ? 'Lock order (super admin)' : isCreditCustomerOrder(o) && !isFullyPaid(o) ? 'Mark as closed (credit customer — balance settled later)' : 'Mark as closed')
                          : (isCreditCustomerOrder(o) ? 'Can close once delivery status is Delivered' : 'Can close only when fully collected and delivery status is Delivered')}
                        className="btn-ghost p-1.5 text-slate-500 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Lock className="w-4 h-4" />
                      </button>
                    )}
                    {o.isclosed && isSuperAdmin && (
                      <button onClick={() => reopenClosed(o)} disabled={toggling === o.id}
                        title="Reopen — unmark as closed (super admin)"
                        className="btn-ghost p-1.5 text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Unlock className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => toggleCancel(o)} disabled={toggling === o.id || o.isclosed}
                      title={o.isclosed ? 'Closed — locked' : (['cancelled','failed'].includes(o.status) ? 'Reactivate' : 'Cancel')}
                      className={`btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${['cancelled','failed'].includes(o.status)
                        ? 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'
                        : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'}`}>
                      <Power className="w-4 h-4" />
                    </button>
                    </>
                    )}
                  </div>
                </td>
              </tr>
              )) : []),
            ])}
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
                    {breakdownRows.map((row, ri) => (
                      <tr key={row.key} className={`${ri % 2 === 1 ? 'bg-white/[0.03]' : ''} ${row.strong ? 'border-t border-surface-border/60' : ''}`}>
                        <td className={`py-1 pr-4 ${row.big ? 'text-[15px] font-bold pt-2' : row.strong ? 'font-medium pt-1.5' : ''} ${row.labelCls || (row.big ? 'text-slate-100' : row.strong ? 'text-slate-200' : 'text-slate-500')}`}>{row.label}</td>
                        {totalsBreakdown.map(r => {
                          const v = r[row.key]
                          const cls =
                            row.tone === 'strong'  ? 'text-slate-100 font-medium' :
                            row.tone === 'emerald' ? 'text-emerald-300/90' :
                            row.tone === 'sky'     ? 'text-sky-300/90' :
                            row.tone === 'rose'    ? 'text-rose-300/90' :
                            row.tone === 'teal'    ? 'text-[#1dffd5] font-semibold [text-shadow:0_0_6px_rgba(29,255,213,0.6)]' :
                            row.tone === 'amber'   ? (v > 0 ? 'text-amber-300' : 'text-slate-500') :
                                                     'text-slate-300'
                          return (
                            <td key={r.cur} className={`text-right py-1 pl-4 ${row.big ? 'text-[15px] font-bold pt-2' : row.strong ? 'pt-1.5' : ''} ${cls}`}>
                              {/* Deduction rows (discount, used petty cash) store a positive
                                  magnitude and always show a leading minus; every other row
                                  shows its true value so a negative total isn't hidden. */}
                              {row.neg ? `${v ? '−' : ''}${fmtAmount(Math.abs(v), r.cur)}` : fmtAmount(v, r.cur)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* 3asari3 NET amount — framed, stands apart from the rows above. */}
                <div className="mt-3 rounded-lg border-2 border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <span className="text-sm font-bold text-fuchsia-200 uppercase tracking-wide">3asari3 NET amount</span>
                    <div className="flex items-center gap-4 flex-wrap">
                      {totalsBreakdown.map(r => (
                        <span key={r.cur} className="tabular-nums text-[15px] font-bold text-fuchsia-200 whitespace-nowrap">
                          <span className="text-fuchsia-300/60 text-[11px] mr-1.5">{r.cur}</span>
                          {fmtAmount(round2((r.localRetail || 0) + (r.fees || 0)), r.cur)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-fuchsia-300/60 mt-0.5">3asari3 retails + Delivery fees</p>
                </div>
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
          <div className="flex items-center gap-4 flex-wrap ml-auto">
            {[
              { key: 'ordersNet',        label: 'Orders net amount', cls: 'text-slate-100',   border: 'border-white/15 bg-white/5' },
              { key: 'totalCollections', label: 'Total collections', cls: 'text-emerald-300', border: 'border-emerald-500/30 bg-emerald-500/10' },
              { key: 'balance',          label: 'Pending balance',   cls: 'text-amber-300',   border: 'border-amber-500/30 bg-amber-500/10' },
            ].map(m => (
              <div key={m.key} className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{m.label}</span>
                {totalsBreakdown.filter(r => r[m.key]).map(r => (
                  <div key={r.cur} className={`text-sm whitespace-nowrap rounded-lg border px-2.5 py-1 ${m.border}`}>
                    <span className="text-slate-400 text-[11px] mr-1">{r.cur}</span>
                    <span className={`font-bold ${m.cls}`}>{fmtAmount(r[m.key], r.cur)}</span>
                  </div>
                ))}
                {totalsBreakdown.every(r => !r[m.key]) && <span className="text-sm text-slate-600">—</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Modal ─────────────────────────────────────────────── */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-6xl flex flex-col" style={{ maxHeight: '92vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand-400" />
                {modal === 'add'
                  ? (isStory ? 'New Ad / Service (Story)' : 'New Order')
                  : `Edit — ${modal.order_number}`}
              </h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {isLockedNow && (
                <div className="flex items-start gap-2 text-rose-300 text-sm bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    This order is locked{modal.is_locked_by ? ` by ${modal.is_locked_by}` : ''} — no changes can be made. Only a super admin can unlock it.
                    {modal.why_is_locked && (
                      <div className="text-rose-300/80 text-xs mt-0.5">Reason: {modal.why_is_locked}</div>
                    )}
                  </div>
                </div>
              )}
              {orderLocked && !isLockedNow && (
                <div className="flex items-center gap-2 text-amber-300 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <Lock className="w-4 h-4 flex-shrink-0" />
                  This order is locked{alreadyClosed && modal.closed_by_name ? ` by ${modal.closed_by_name}` : ''} — no changes can be made
                  {alreadyClosed ? '. Only a super admin can unlock it.' : '.'}
                </div>
              )}

              <fieldset disabled={orderLocked} className="space-y-3 min-w-0 border-0 p-0 m-0 disabled:opacity-70">

              {/* ── Order Type (top, above Customer) ───────────── */}
              <CollapsibleSection title="Order Type" open={sectionsOpen.order_type} onToggle={v => toggleSection('order_type', v)}>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label">Order Type</label>
                    {!addingType && !partyContactId && !isStory && (
                      <button type="button" onClick={() => { setAddingType(true); setNewTypeName('') }}
                        className="text-[11px] text-brand-400 hover:text-brand-300 mb-1">
                        <Plus className="w-3 h-3 inline -mt-0.5" /> New type
                      </button>
                    )}
                  </div>
                  {partyContactId ? (
                    /* 2nd-party users: fixed to their contact's business type. */
                    <select className="input disabled:opacity-60 disabled:cursor-not-allowed" value={form.order_type || ''} disabled>
                      <option value="">—</option>
                      {ORDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      {orderTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      {form.order_type
                        && !ORDER_TYPES.some(t => t.value === form.order_type)
                        && !orderTypes.some(t => t.name === form.order_type)
                        && <option value={form.order_type}>{form.order_type}</option>}
                    </select>
                  ) : addingType ? (
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
                    <select className="input disabled:opacity-60 disabled:cursor-not-allowed" value={form.order_type || ''}
                      onChange={e => fld('order_type', e.target.value)} disabled={isStory}
                      title={isStory ? 'Fixed for Ads & Services (Story) orders' : undefined}>
                      <option value="">—</option>
                      {ORDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      {orderTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      {form.order_type
                        && !ORDER_TYPES.some(t => t.value === form.order_type)
                        && !orderTypes.some(t => t.name === form.order_type)
                        && <option value={form.order_type}>{form.order_type}</option>}
                    </select>
                  )}
                  {isStory && (
                    <p className="text-[11px] text-slate-500 mt-1">Fixed to <span className="text-fuchsia-300 font-medium">Story</span> for ads &amp; services orders.</p>
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
                          className={`input w-full pr-14 ${partyContactId ? 'cursor-not-allowed opacity-90' : ''}`}
                          placeholder="Type a customer name…"
                          value={customerInput}
                          readOnly={!!partyContactId}
                          title={partyContactId ? 'Your account is the customer for these orders and cannot be changed' : undefined}
                          onChange={e => {
                            if (partyContactId) return   // 2nd-party: customer is locked to their own account
                            setCustomerInput(e.target.value)
                            setCustomerDropdownOpen(true)
                            if (form.customer_id) setForm(f => ({ ...f, customer_id: '', main_account: '', sub_account_id: '' }))
                            setError('')
                          }}
                          onFocus={() => { if (!partyContactId) setCustomerDropdownOpen(true) }}
                          onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 150)}
                        />
                        {/* Status indicator (lock when 2nd-party, check when a customer is selected) */}
                        {partyContactId
                          ? <Lock className="absolute right-8 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                          : form.customer_id && (
                              <Check className="absolute right-8 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400 pointer-events-none" />
                            )}
                        {/* Clear button — resets the customer and the auto-filled mobile / whatsapp.
                            Hidden for 2nd-party (sold orders) logins where the customer is locked. */}
                        {!partyContactId && (customerInput.trim() || form.customer_id || form.recipient_mobile || form.recipient_whatsapp) && (
                          <button type="button"
                            onMouseDown={e => { e.preventDefault(); resetCustomer() }}
                            title="Clear customer, mobile & WhatsApp"
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Inline matches dropdown */}
                        {!partyContactId && customerDropdownOpen && trimmedCustomer !== '' && (() => {
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

                      {/* Picker button — full search modal (hidden for 2nd-party: customer is locked) */}
                      {!partyContactId && (
                        <button type="button" title="Search customers"
                          onClick={() => { setCustomerSearch(trimmedCustomer); setCustomerPickerOpen(true) }}
                          className="btn-ghost px-3 py-2 border border-surface-border flex-shrink-0 hover:border-brand-600/50">
                          <Search className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Account — which of the contact's account numbers this order
                        is billed to. With one account it's the read-only line it
                        has always been; with several, a picker. */}
                    {customerAccounts.length > 1 ? (
                      <div className="mt-1.5">
                        <label className="label text-[10px]">Account</label>
                        <select className="input" value={form.sub_account_id || ''}
                          disabled={orderLocked}
                          onChange={e => {
                            const acct = customerAccounts.find(a => a.id === e.target.value)
                            setForm(f => ({
                              ...f,
                              sub_account_id: e.target.value,
                              main_account: acct?.code ?? f.main_account,
                            }))
                            setError('')
                          }}>
                          {customerAccounts.map(a => (
                            <option key={a.id} value={a.id}>
                              {formatAccountNumber(a.code)}
                              {a.name ? ` — ${a.name}` : ''}
                              {` · ${a.account_type === 'credit' ? 'Credit' : 'Cash'}`}
                              {a.account_type === 'credit' && !isUnlimited(a)
                                ? ` ${Number(a.credit_limit).toLocaleString()} ${a.currency}` : ''}
                              {isSubAccountExpired(a) ? ' · EXPIRED' : ''}
                              {a.is_active === false ? ' · INACTIVE' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : form.main_account && (
                      <p className="mt-1 text-[11px] text-slate-500 font-mono tracking-wider">
                        Main account: {formatAccountNumber(form.main_account)}
                      </p>
                    )}

                    {/* What the chosen account allows, and what it already owes —
                        shown before the close is attempted, not after it fails. */}
                    {selectedAccount && selectedAccount.account_type === 'credit' && (
                      <p className={`mt-1 text-[11px] flex items-center gap-1.5 ${
                        accountCheck.ok ? 'text-slate-500' : 'text-red-400'}`}>
                        <CreditCard className="w-3.5 h-3.5 flex-shrink-0" />
                        {isUnlimited(selectedAccount)
                          ? `Unlimited credit · ${round2(accountOutstanding).toLocaleString()} ${selectedAccount.currency} outstanding`
                          : `${round2(Math.max(0, Number(selectedAccount.credit_limit) - accountOutstanding)).toLocaleString()} ${selectedAccount.currency} of ${Number(selectedAccount.credit_limit).toLocaleString()} still available`}
                        {selectedAccount.expires_on ? ` · expires ${String(selectedAccount.expires_on).slice(0, 10)}` : ''}
                      </p>
                    )}
                    {selectedAccount && !accountCheck.ok && (
                      <p className="mt-1 text-[11px] text-red-400">{accountCheck.reason}</p>
                    )}

                    {/* New-customer hint */}
                    {isNewCustomer && !partyContactId && (
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
                    {/* Same behaviour as Customer: search dropdown + add-new contact. */}
                    <div className="relative">
                      <input
                        className="input w-full pr-8"
                        placeholder="Type a recipient name…"
                        value={form.recipient_name}
                        onChange={e => { fld('recipient_name', e.target.value); setRecipientDropdownOpen(true) }}
                        onFocus={() => setRecipientDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setRecipientDropdownOpen(false), 150)}
                      />
                      {/* Clear button — resets the recipient name, mobile & whatsapp */}
                      {(form.recipient_name?.trim() || form.recipient_mobile || form.recipient_whatsapp) && (
                        <button type="button"
                          onMouseDown={e => { e.preventDefault(); resetRecipient() }}
                          title="Clear recipient name, mobile & WhatsApp"
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {recipientDropdownOpen && trimmedRecipient !== '' && (() => {
                        const q = trimmedRecipient.toLowerCase()
                        const list = customers.filter(c =>
                          customerName(c).toLowerCase().includes(q) ||
                          c.company_name?.toLowerCase().includes(q) ||
                          c.mobile?.includes(trimmedRecipient)
                        ).slice(0, 6)
                        if (list.length === 0) return null
                        return (
                          <div className="absolute z-[55] left-0 right-0 mt-1 card border border-surface-border rounded-lg shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                            {list.map(c => (
                              <button type="button" key={c.id}
                                onMouseDown={e => { e.preventDefault(); applyRecipient(c) }}
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
                  </div>
                  <div>
                    <label className="label text-fuchsia-300">Mobile *</label>
                    <MobileInput value={form.recipient_mobile} onChange={v => fld('recipient_mobile', v)} />
                  </div>
                </div>

                {/* New-recipient hint — add a contact from the recipient box. */}
                {isNewRecipient && (
                  <button type="button" onClick={() => openNewRecipient()}
                    className="w-full flex items-center gap-2 text-left text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2 hover:bg-cyan-500/15 transition-colors">
                    <UserPlus className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>It seems <span className="font-semibold">“{trimmedRecipient}”</span> is a new contact — do you want to save?</span>
                  </button>
                )}

                <div>
                  <label className="label">WhatsApp</label>
                  <MobileInput value={form.recipient_whatsapp} onChange={v => fld('recipient_whatsapp', v)} placeholder="If different from mobile" />
                </div>
              </CollapsibleSection>

              {/* ── Route ─────────────────────────────────────── */}
              <CollapsibleSection title={isStory ? 'Schedule' : 'Route'} open={sectionsOpen.route} onToggle={v => toggleSection('route', v)}>
                {!isStory && (
                <div className="grid grid-cols-2 gap-3">
                  {/* 2nd-party (supplier/partner) users may select & type addresses
                      but not add/edit/delete the shared saved-location list. */}
                  <TagLocationField
                    label="Pickup / Origin"
                    tags={splitLocs(form.pickup_address)}
                    setTags={arr => fld('pickup_address', joinLocs(arr))}
                    suggestions={pickupSuggestions}
                    onAddNew={partyContactId ? undefined : rememberPickup}
                    onEditSuggestion={partyContactId ? undefined : editPickupSuggestion}
                    onDeleteSuggestion={partyContactId ? undefined : deletePickupSuggestion}
                    placeholder="Add warehouse / pickup…" />
                  <TagLocationField
                    label="Delivery Address" required
                    tags={splitLocs(form.delivery_address)}
                    setTags={arr => fld('delivery_address', joinLocs(arr))}
                    suggestions={deliverySuggestions}
                    onAddNew={partyContactId ? undefined : rememberDelivery}
                    onEditSuggestion={partyContactId ? undefined : editDeliverySuggestion}
                    onDeleteSuggestion={partyContactId ? undefined : deleteDeliverySuggestion}
                    placeholder="Add delivery address…"
                    labelRight={
                      <button type="button" onClick={() => setMapOpen(true)}
                        title={form.delivery_lat && form.delivery_lng
                          ? `Pinned at ${Number(form.delivery_lat).toFixed(5)}, ${Number(form.delivery_lng).toFixed(5)} — click to change`
                          : 'Pick delivery location on map'}
                        className={`btn-ghost p-1 -my-1 ${form.delivery_lat && form.delivery_lng ? 'text-brand-400' : 'text-slate-400 hover:text-brand-300'}`}>
                        <MapPin className="w-4 h-4" />
                      </button>
                    } />
                </div>
                )}
                <div className="flex items-end gap-5">
                  <div className="w-36 flex-shrink-0">
                    <label className="label">Scheduled Date</label>
                    <input type="date" className="input" value={form.scheduled_date}
                      onChange={e => fld('scheduled_date', e.target.value)} />
                  </div>
                  {!isStory && (<>
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
                  </>)}
                </div>
              </CollapsibleSection>

              {/* Delivery-address map picker → fills coordinates (and the address). */}
              <MapPicker
                open={mapOpen}
                initial={{
                  latitude:  form.delivery_lat || null,
                  longitude: form.delivery_lng || null,
                  address_line: splitLocs(form.delivery_address)[0] || '',
                }}
                onCancel={() => setMapOpen(false)}
                onConfirm={({ latitude, longitude, address_line }) => {
                  setForm(f => {
                    const next = { ...f, delivery_lat: latitude, delivery_lng: longitude }
                    const name = (address_line || '').trim()
                    if (name) {
                      const existing = splitLocs(f.delivery_address)
                      if (!existing.some(t => t.toLowerCase() === name.toLowerCase())) {
                        next.delivery_address = joinLocs([...existing, name])
                      }
                    }
                    return next
                  })
                  setError('')
                  setMapOpen(false)
                }} />

              {/* ── Assignment & Status ────────────────────────── */}
              <CollapsibleSection title="Assignment & Status" accent="fuchsia" open={sectionsOpen.assignment} onToggle={v => toggleSection('assignment', v)}>
                {partyContactId && (
                  <p className="text-[11px] text-slate-500 mb-2">View only — assignment &amp; status are managed by the operations team.</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {!isStory && (
                  <div>
                    <label className="label">Driver</label>
                    <select className="input disabled:opacity-60 disabled:cursor-not-allowed"
                      value={form.driver_id} onChange={e => fld('driver_id', e.target.value)}
                      disabled={isPickedUp(form) || !!partyContactId}
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
                  )}
                  <div>
                    <label className="label">Order Status</label>
                    <select className="input disabled:opacity-60 disabled:cursor-not-allowed" value={form.status} onChange={e => setOrderStatus(e.target.value)}
                      disabled={!!partyContactId || !canEditOrderStatus}>
                      {!ORDER_STATUS_OPTIONS.some(o => o.value === form.status) && form.status && (
                        <option value={form.status}>{form.status.replace(/_/g, ' ')}</option>
                      )}
                      {ORDER_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {!partyContactId && !canEditOrderStatus && (
                      <p className="text-[11px] text-slate-500 mt-1">Set automatically — only an admin can change it.</p>
                    )}
                  </div>
                  {!isStory && (
                  <div>
                    <label className="label">Delivery Status</label>
                    <select className="input disabled:opacity-60 disabled:cursor-not-allowed" value={form.delivery_status} onChange={e => fld('delivery_status', e.target.value)}
                      disabled={!!partyContactId || !canEditDeliveryStatus}>
                      {DELIVERY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {!partyContactId && !canEditDeliveryStatus && (
                      <p className="text-[11px] text-slate-500 mt-1">Set automatically — only an admin can change it.</p>
                    )}
                  </div>
                  )}
                  {/* Hidden for 2nd-party (supplier/partner) users. */}
                  {!partyContactId && (
                  <div>
                    <label className="label">Collection from Customer</label>
                    <input
                      className="input cursor-not-allowed opacity-90"
                      value={collectionFromCustomer}
                      readOnly
                      title="Derived from recorded payments"
                    />
                  </div>
                  )}
                </div>
              </CollapsibleSection>

              {/* ── Delivery Packages (hidden for Story/ads orders) ─ */}
              {!isStory && (
              <CollapsibleSection title={`Delivery Packages (${packagesQty})`} open={sectionsOpen.packages} onToggle={v => toggleSection('packages', v)}
                right={
                  <button type="button" onClick={addPackage}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Package
                  </button>
                }>
                <OrderPackages packages={packages} setPackages={setPackages} providers={partnerContacts}
                  onAddProvider={(name, onCreated) => openNewContact(name, 'partner', onCreated)}
                  hideProvider={!!partyContactId} fixedProviderName={partyContactName}
                  customerName={customerInput.trim()} embedded onAdd={addPackage} />
              </CollapsibleSection>
              )}

              {/* ── Order Services ────────────────────────────── */}
              {/* Hidden for 2nd-party (supplier/partner) users and Story orders. */}
              {!partyContactId && !isStory && (
              <CollapsibleSection title={`Third party services (${services.length})`} open={sectionsOpen.services} onToggle={v => toggleSection('services', v)}
                right={
                  <button type="button" onClick={() => { openSection('services'); setServices(s => [...s, { ...EMPTY_SERVICE, _key: Date.now() }]) }}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Service
                  </button>
                }>
                <OrderServices services={services} setServices={setServices}
                  suppliers={allContacts}
                  onAddProvider={(name, onCreated) => openNewContact(name, 'supplier', onCreated)}
                  embedded onAdd={() => setServices(s => [...s, { ...EMPTY_SERVICE, _key: Date.now() }])} />
              </CollapsibleSection>
              )}

              {/* ── External Retails Invoices References (retail_goods_invoices) ── */}
              {!isStory && (
              <CollapsibleSection title={`Local market invoices (${invoicesQty})`} open={sectionsOpen.retail_invoices} onToggle={v => toggleSection('retail_invoices', v)}
                right={
                  <button type="button" onClick={() => { openSection('retail_invoices'); addRetailInvoice() }}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Invoice
                  </button>
                }>

                {/* Procurement is now a per-invoice toggle in the "Purchased" column
                    below — tick each invoice we bought so it earns that shop's
                    commission % at month-end. */}
                {!partyContactId && (
                  <p className="text-[11px] text-slate-500 mb-3 px-1">
                    Use the <span className="text-slate-300 font-medium">Purchased</span> toggle on each invoice to mark the ones <span className="text-slate-300 font-medium">we bought</span> for the customer — those earn that shop’s commission % at month-end. Leave off for shop-sent invoices (delivery fee only).
                  </p>
                )}

                <div className="border border-surface-border rounded-xl overflow-x-auto">
                  <table className="w-full text-xs min-w-[980px]">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                        {/* Warehouse/Shop hidden for 2nd-party users (fixed to them). */}
                        {!partyContactId && <th className="text-left px-1.5 py-2 w-[18%]">Warehouse / Shop</th>}
                        <th className="text-left px-1.5 py-2 w-[12%]">Invoice Ref</th>
                        <th className="text-left px-1.5 py-2 w-[11%]">Date</th>
                        <th className="text-left px-1.5 py-2 w-[15%]">Amount</th>
                        <th className="text-left px-1.5 py-2 w-[8%]">Currency</th>
                        {/* Procurement toggle — staff only. */}
                        {!partyContactId && <th className="text-left px-1.5 py-2 w-[11%]">Purchased</th>}
                        <th className="text-left px-1.5 py-2 w-[10%]">Paid</th>
                        <th className="text-left px-1.5 py-2 w-[11%]">Payment Type</th>
                        <th className="w-[4%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {retailInvoices.length === 0 ? (
                        <tr><td colSpan={partyContactId ? 7 : 9} className="px-3 py-6 text-center text-slate-600">No invoices — click "Add Invoice"</td></tr>
                      ) : retailInvoices.map((ri, idx) => {
                        // A saved invoice (has a DB id) is locked ONLY when the
                        // "restriction" app setting is on: read-only, can't be deleted;
                        // new rows stay editable. With the restriction off, saved rows
                        // remain editable until the order is closed (the surrounding
                        // fieldset already disables everything on a closed order).
                        const riLocked = appSettings.lockSavedLocalInvoices !== false && !!ri._id && !canBypassRestrictions
                        return (
                        <tr key={ri._id ?? ri._key ?? idx} className="border-t border-surface-border/50">
                          {!partyContactId && (
                          <td className="px-1.5 py-2 align-top">
                            {riLocked ? (
                              <div className="text-xs text-slate-200 py-1.5">{ri.shop_name || '—'}</div>
                            ) : (
                            <ContactCombobox
                              value={ri.contact_id || ''}
                              text={ri.shop_name}
                              allowText
                              options={supplierContacts}
                              addLabel="supplier"
                              placeholder="Type a warehouse / shop…"
                              compact
                              onSelect={c => {
                                const name = c.company_name || customerName(c)
                                const prevName = retailInvoices[idx]?.shop_name || ''
                                const next = retailInvoices.map((r, j) => j === idx ? {
                                  ...r, shop_name: name, shop_type: c.shop_type || '', contact_id: c.id, contact_code: c.code || '',
                                } : r)
                                setRetailInvoices(next)
                                // Keep pickup tags in sync: drop the old shop (if unused) and add the new one.
                                if (prevName.toLowerCase() !== name.toLowerCase()) dropPickupTagIfUnused(prevName, next)
                                addPickupTag(name)
                              }}
                              onText={v => {
                                const prevName = retailInvoices[idx]?.shop_name || ''
                                // Manual text → free-form shop name, unlinked from any supplier contact.
                                const next = retailInvoices.map((r, j) => j === idx ? {
                                  ...r, shop_name: v, shop_type: '', contact_id: '', contact_code: '',
                                } : r)
                                setRetailInvoices(next)
                                if (prevName && prevName.toLowerCase() !== v.toLowerCase()) dropPickupTagIfUnused(prevName, next)
                              }}
                              onAddNew={(name, onCreated) => openNewContact(name, 'supplier', onCreated)} />
                            )}
                            {(ri.shop_type || ri.contact_code) && (
                              <p className="text-[10px] text-slate-500 mt-0.5 flex gap-2">
                                {ri.contact_code && <span className="font-mono text-slate-400">{ri.contact_code}</span>}
                                {ri.shop_type && <span className="capitalize">{ri.shop_type}</span>}
                              </p>
                            )}
                          </td>
                          )}
                          <td className="px-1.5 py-2 align-top">
                            <input className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={ri.invoice_reference}
                              disabled={riLocked}
                              onChange={e => setRetailInvoice(idx, 'invoice_reference', e.target.value)} placeholder="Ref / #" />
                          </td>
                          <td className="px-1.5 py-2 align-top">
                            <input type="date" className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={ri.invoice_date}
                              disabled={riLocked}
                              onChange={e => setRetailInvoice(idx, 'invoice_date', e.target.value)} />
                          </td>
                          <td className="px-1.5 py-2 align-top">
                            <input type="number" min="0" step="0.01" className="input py-1.5 px-2 text-xs min-w-[110px] disabled:opacity-60 disabled:cursor-not-allowed" value={ri.invoice_value}
                              disabled={riLocked}
                              onChange={e => setRetailInvoice(idx, 'invoice_value', e.target.value)} placeholder="0.00" />
                          </td>
                          <td className="px-1.5 py-2 align-top">
                            <select className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={ri.currency}
                              disabled={riLocked}
                              onChange={e => setRetailInvoice(idx, 'currency', e.target.value)}>
                              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          {!partyContactId && (
                          <td className="px-1.5 py-2 align-top">
                            <button type="button" disabled={riLocked} onClick={() => setRetailInvoice(idx, 'is_procurement', !ri.is_procurement)}
                              aria-pressed={!!ri.is_procurement}
                              title={ri.is_procurement ? 'We purchased these goods — earns this shop’s commission at month-end' : 'Shop-sent — no commission (delivery fee only)'}
                              className={`inline-flex items-center gap-1.5 w-full justify-center py-1.5 px-2 rounded-lg text-[11px] font-medium border whitespace-nowrap transition-colors select-none disabled:opacity-60 disabled:cursor-not-allowed
                                ${ri.is_procurement
                                  ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                                  : 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'}`}>
                              {ri.is_procurement ? <Check className="w-3.5 h-3.5 flex-shrink-0" /> : <Circle className="w-3.5 h-3.5 flex-shrink-0" />}
                              {ri.is_procurement ? 'We bought' : 'Shop-sent'}
                            </button>
                          </td>
                          )}
                          <td className="px-1.5 py-2 align-top">
                            <button type="button" disabled={riLocked} onClick={() => setRetailInvoice(idx, 'paid', !ri.paid)}
                              aria-pressed={!!ri.paid}
                              title={ri.paid
                                ? 'Calculation excluded — settled directly by the customer with the shop'
                                : 'Using petty cash — counted in the order total'}
                              className={`inline-flex items-center gap-1.5 w-full justify-center py-1.5 px-2 rounded-lg text-[11px] font-medium border whitespace-nowrap transition-colors select-none disabled:opacity-60 disabled:cursor-not-allowed
                                ${ri.paid
                                  ? 'bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'
                                  : 'bg-brand-500/15 border-brand-500/40 text-brand-300'}`}>
                              {ri.paid ? <Circle className="w-3.5 h-3.5 flex-shrink-0" /> : <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                              {ri.paid ? 'Calculation Excluded' : 'Using petty cash'}
                            </button>
                          </td>
                          <td className="px-1.5 py-2 align-top">
                            <select className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={ri.payment_type}
                              disabled={!ri.paid || riLocked}
                              onChange={e => setRetailInvoice(idx, 'payment_type', e.target.value)}>
                              <option value="">—</option>
                              {PAYMENT_METHODS.map(pm => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
                            </select>
                          </td>
                          <td className="px-1.5 py-2 align-top">
                            {riLocked ? (
                              <span title="Saved — locked" className="text-slate-600 inline-flex p-0.5"><Lock className="w-3.5 h-3.5" /></span>
                            ) : (
                              <button onClick={() => removeRetailInvoice(idx)} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CollapsibleSection>
              )}

              {/* Pricing sections */}
              {/* ── Items ─────────────────────────────────────── */}
              {/* Hidden for 2nd-party (supplier/partner) users. */}
              <div id="order-section-items" className="scroll-mt-4" />
              {!partyContactId && (
              <CollapsibleSection title={`3asari3 retails and services (${itemsQty})`} open={sectionsOpen.items} onToggle={v => toggleSection('items', v)}
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
              )}

              {/* ── Delivery Fees & Totals (hidden for Story/ads orders) ─ */}
              {!isStory && (
              <CollapsibleSection title="Delivery & Totals" accent="fuchsia" open={true} onToggle={() => {}}>

                {/* Editable fee/discount inputs — hidden for 2nd-party
                    (supplier/partner) users, who see only the totals summary. */}
                {!partyContactId && (
                <div className="grid grid-cols-4 gap-3">
                  {!isStory && (
                  <div>
                    <label className="label">Delivery Fee</label>
                    <input type="number" min="0" step="0.01" className="input" value={form.delivery_fee}
                      onChange={e => fld('delivery_fee', e.target.value)} placeholder="0.00" />
                  </div>
                  )}
                  <div>
                    <label className="label">{isStory ? 'Currency' : 'Fee Currency'}</label>
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
                )}

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

                {/* Free-order toggle — staff only. Waives the total to zero so the
                    order can be closed with no payment; warns first if it currently
                    carries a value, and records who set it free. */}
                {!partyContactId && (
                  <label className={`flex items-start gap-2 mt-3 px-3 py-2 rounded-lg border cursor-pointer select-none ${
                    form.is_free_order ? 'border-emerald-600/40 bg-emerald-600/10' : 'border-surface-border bg-surface-hover/40'}`}>
                    <input type="checkbox" className="mt-0.5 accent-emerald-600"
                      checked={!!form.is_free_order}
                      onChange={e => {
                        const next = e.target.checked
                        // Warn before waiving an order that currently has a value.
                        if (next && rawHasValue) { setFreeConfirm(true); return }
                        fld('is_free_order', next)
                      }} />
                    <span className="text-xs">
                      <span className={`font-medium ${form.is_free_order ? 'text-emerald-300' : 'text-slate-200'}`}>It is a free order (no charge)</span>
                      <span className="block text-[11px] text-slate-500">
                        The order total becomes <span className="font-medium">zero</span> even if it has items, and it can be closed with no payment.
                        {form.is_free_order && rawHasValue && (
                          <span className="text-amber-400"> Waived value: {CURRENCIES.filter(c => round2(rawTotals[c] || 0) > 0).map(c => `${rawTotals[c].toFixed(c === 'LBP' ? 0 : 2)} ${c}`).join(', ')}.</span>
                        )}
                      </span>
                    </span>
                  </label>
                )}
              </CollapsibleSection>
              )}

              {/* ── Payments ──────────────────────────────────── */}
              {/* Hidden for 2nd-party (supplier/partner) users. */}
              {!partyContactId && (
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
                      ) : payments.map((p, idx) => {
                        // When the "protect other users' payments" restriction is on, a
                        // saved payment is read-only unless it was recorded by the current
                        // user. Driver-collected payments often have no collected_by id
                        // (only a Driver group/name), so anything not provably "mine" is
                        // locked. Admins and super admins are always exempt.
                        const mine = !!p.collected_by && !!currentUser?.user_id && p.collected_by === currentUser.user_id
                        const pLocked = appSettings.protectOthersPayments === true
                          && !canBypassRestrictions
                          && !!p._id && !mine
                        return (
                        <tr key={p._id ?? p._key ?? idx} className="border-t border-surface-border/50">
                          <td className="px-3 py-2">
                            <select className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={p.method}
                              disabled={pLocked}
                              onChange={e => setPayment(idx, 'method', e.target.value)}>
                              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                            {pLocked && p.collected_by_name && (
                              <p className="text-[10px] text-slate-500 mt-0.5">by {p.collected_by_name}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={p.amount}
                              disabled={pLocked}
                              onChange={e => setPayment(idx, 'amount', e.target.value)} placeholder="0.00" />
                          </td>
                          <td className="px-3 py-2">
                            <select className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={p.currency}
                              disabled={pLocked}
                              onChange={e => setPayment(idx, 'currency', e.target.value)}>
                              {PAYMENT_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="date" className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={p.paid_at}
                              disabled={pLocked}
                              onChange={e => setPayment(idx, 'paid_at', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <input className="input py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" value={p.notes}
                              disabled={pLocked}
                              onChange={e => setPayment(idx, 'notes', e.target.value)} placeholder="Optional" />
                          </td>
                          <td className="px-3 py-2">
                            {pLocked ? (
                              <span title={`Collected by ${p.collected_by_name || 'another user'} — locked`} className="text-slate-600 inline-flex p-0.5"><Lock className="w-3.5 h-3.5" /></span>
                            ) : (
                              <button onClick={() => removePayment(idx)} className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                        )
                      })}
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
              )}

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
                {/* Far left — Mark Closed / locked indicator for admins & normal users. */}
                {modal !== 'add' && (
                  <div className="mr-auto flex items-center gap-2 flex-wrap">
                    {/* Close control (isclosed). Super admin can always close and can
                        reopen a closed order; others close only when eligible. */}
                    {alreadyClosed ? (
                      isSuperAdmin ? (
                        <button type="button" onClick={unlockCurrentOrder} disabled={saving || toggling === modal.id}
                          title="Reopen this closed order (super admin)"
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                                     bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15
                                     disabled:opacity-40 disabled:cursor-not-allowed">
                          <Unlock className="w-4 h-4" /> Reopen
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-400">
                          <Lock className="w-4 h-4" /> Closed{modal.closed_by_name ? ` by ${modal.closed_by_name}` : ''}
                        </span>
                      )
                    ) : (
                      <button type="button" onClick={() => handleSave({ close: true })}
                        disabled={saving || (!canClose && !isSuperAdmin)}
                        title={canClose ? 'Mark this order as closed' : isSuperAdmin ? 'Mark as closed (super admin)' : 'Requires: ' + closeRequirements.join(', ')}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                                   bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15
                                   disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-500/10">
                        <Lock className="w-4 h-4" /> Mark Closed
                      </button>
                    )}

                    {/* Lock order (is_locked) — SUPER ADMIN ONLY, beside Mark Closed.
                        Freezes the order everywhere; only a super admin can unlock. */}
                    {isSuperAdmin ? (
                      isLockedNow ? (
                        <button type="button" onClick={removeOrderLock} disabled={saving || toggling === modal.id}
                          title={`Unlock this order${modal.is_locked_by ? ` — locked by ${modal.is_locked_by}` : ''}`}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                                     bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15
                                     disabled:opacity-40 disabled:cursor-not-allowed">
                          <Unlock className="w-4 h-4" /> Unlock order
                        </button>
                      ) : (
                        <button type="button" onClick={() => setLockPrompt({ reason: '' })} disabled={saving || toggling === modal.id}
                          title="Lock this order to prevent any further changes (super admin)"
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                                     bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/15
                                     disabled:opacity-40 disabled:cursor-not-allowed">
                          <Lock className="w-4 h-4" /> Lock order
                        </button>
                      )
                    ) : isLockedNow ? (
                      <span className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-300/80"
                        title={modal.why_is_locked || ''}>
                        <Lock className="w-4 h-4" /> Locked{modal.is_locked_by ? ` by ${modal.is_locked_by}` : ''}
                      </span>
                    ) : null}
                  </div>
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

      {/* ── Daily orders check (audit popup) ───────────────────── */}
      {auditOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-4xl flex flex-col" style={{ maxHeight: '85vh' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" /> Daily orders check
                <span className="text-slate-500 font-normal">· {auditRows.length} issue{auditRows.length === 1 ? '' : 's'}</span>
              </h3>
              <button onClick={() => setAuditOpen(false)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {auditRows.length === 0 ? (
                <div className="px-5 py-14 text-center text-slate-500 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-9 h-9 text-green-500/70" />
                  No issues found in the current list.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface z-10">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-surface-border">
                      <th className="px-4 py-2.5 font-medium">Order #</th>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 font-medium">Driver</th>
                      <th className="px-4 py-2.5 font-medium">Source</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Payment</th>
                      <th className="px-4 py-2.5 font-medium">Warning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map(({ o, warnings }) => {
                      const cust = o.customer
                        ? (o.customer.company_name || `${o.customer.first_name ?? ''} ${o.customer.last_name ?? ''}`.trim() || o.recipient_name || '—')
                        : (o.recipient_name || '—')
                      const drv = o.driver ? (`${o.driver.first_name ?? ''} ${o.driver.last_name ?? ''}`.trim() || '—') : '—'
                      return (
                        <tr key={o.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 align-top">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <button type="button"
                              onClick={() => { setAuditOpen(false); focusOrderRow(o.id) }}
                              title="Go to this order in the list"
                              className="font-mono text-xs text-brand-400 hover:text-brand-300 hover:underline">
                              {o.order_number ?? '—'}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-slate-300">{cust}</td>
                          <td className="px-4 py-2.5 text-slate-300">{drv}</td>
                          <td className="px-4 py-2.5 text-slate-400 text-xs">{o.order_source || '—'}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              <Badge status={normalizeStatus(o.status)} />
                              <span className="text-[11px] text-slate-400">{o.delivery_status || '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              <Badge status={o.payment_status} />
                              <span className="text-[11px] text-slate-400">{collectionFromPayStatus(o.payment_status)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="space-y-1">
                              {warnings.map((wm, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-amber-300 text-xs">
                                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                  <span>{wm}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-between items-center px-5 py-3 border-t border-surface-border">
              <span className="text-[11px] text-slate-500">Click an order number to jump to it in the list. Checks the orders currently listed (respects filters).</span>
              <button onClick={() => setAuditOpen(false)} className="btn-primary px-4 py-2 text-sm">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lock reason prompt (super admin) ───────────────────── */}
      {lockPrompt && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-sm flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Lock className="w-4 h-4 text-rose-400" /> Lock order
              </h3>
              <button onClick={() => setLockPrompt(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-slate-400 text-xs">
                This freezes the order for everyone — only a super admin can unlock it.
                Add a short reason (shown to anyone who opens it).
              </p>
              <div>
                <label className="label">Reason for locking</label>
                <textarea className="input resize-none" rows={3} autoFocus
                  value={lockPrompt.reason}
                  onChange={e => setLockPrompt({ reason: e.target.value })}
                  placeholder="e.g. Under review — do not modify" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={() => setLockPrompt(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button
                onClick={async () => { const reason = lockPrompt.reason; setLockPrompt(null); await applyOrderLock(reason) }}
                disabled={!lockPrompt.reason.trim()}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                <Lock className="w-4 h-4" /> Lock order
              </button>
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
                Add {({ customer: 'Customer', partner: 'Partner', supplier: 'Supplier' })[newContactType] || 'Contact'}
              </h2>
              <button onClick={() => setNewCustomerOpen(false)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <ContactFormFields
              type={newContactType}
              form={newCustomer}
              setField={setNewCust}
              mode="add"
              extraFields={newContactExtraFields}
              lockTypeOnEntry={false}
              showCreditDebit={!partyContactId}
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

      {/* ── "Make this order free?" warning ────────────────────── */}
      {freeConfirm && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setFreeConfirm(false)}>
          <div className="card w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 p-4 border-b border-surface-border bg-amber-500/10">
              <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-slate-100 font-semibold">Make this a free order?</h3>
                <p className="text-slate-400 text-xs mt-1">This order currently has a value that will be waived to zero.</p>
              </div>
            </div>
            <div className="p-4 space-y-3 text-sm text-slate-300">
              <p>Current total to be waived:</p>
              <ul className="space-y-1">
                {CURRENCIES.filter(c => round2(rawTotals[c] || 0) > 0).map(c => (
                  <li key={c} className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">{c}</span>
                    <span className="font-mono text-amber-300">{rawTotals[c].toFixed(c === 'LBP' ? 0 : 2)} {c}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-400">
                The order will be recorded as <span className="text-emerald-300 font-medium">free of charge</span> (total $0) and can be
                closed with no payment. This is logged against your user account.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-surface-border">
              <button type="button" onClick={() => setFreeConfirm(false)} className="btn-ghost">Cancel</button>
              <button type="button"
                onClick={() => { fld('is_free_order', true); setFreeConfirm(false) }}
                className="btn-primary !bg-emerald-600 hover:!bg-emerald-700">
                Yes, make it free
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
                {hasAdvancedFilters || filter !== 'all' || confirmFilter !== 'all' || payFilter || search ? ' (current filters applied)' : ''}.
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
          <AmountSummaryContent order={hoverSummary.order} filterContactId={partyContactId} />
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

      {/* ── Read-only order detail drawer (slides in from the right) ──
          Pinned: stays open. Unpinned: a click anywhere outside closes it. */}
      {detail && (
        <>
          {!detailPinned && <div className="fixed inset-0 z-[65]" onClick={closeDetail} />}
          <div
            onClick={e => e.stopPropagation()}
            className={`fixed top-0 right-0 h-full w-full max-w-md z-[66] card border-l border-surface-border shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
              detailShown ? 'translate-x-0' : 'translate-x-full'}`}>
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border">
              <Receipt className="w-4 h-4 text-brand-300 flex-shrink-0" />
              <span className="font-mono text-brand-300 text-sm">{detail.order_number}</span>
              <Badge status={normalizeStatus(detail.status)} />
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => setDetailPinned(p => !p)}
                  title={detailPinned ? 'Unpin — closes when you click outside' : 'Pin — keep open'}
                  className={`btn-ghost p-1.5 ${detailPinned ? 'text-brand-300 bg-brand-500/10' : 'text-slate-500 hover:text-brand-300'}`}>
                  {detailPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                </button>
                <button onClick={closeDetail} title="Close"
                  className="btn-ghost p-1.5 text-slate-500 hover:text-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <DetailSection icon={User} title="Customer">
                <p className="text-slate-100 text-sm">{detail.customer ? customerListName(detail.customer) : '—'}</p>
                {detail.customer?.account_number && (
                  <p className="text-slate-500 text-xs font-mono">{formatAccountNumber(detail.customer.account_number)}</p>
                )}
                {detail.customer?.mobile && <p className="text-slate-500 text-xs">{formatMobile(detail.customer.mobile)}</p>}
              </DetailSection>

              <DetailSection icon={UserCheck} title="Recipient">
                <p className="text-slate-100 text-sm">{detail.recipient_name || '—'}</p>
                {detail.recipient_mobile && <p className="text-slate-500 text-xs">{formatMobile(detail.recipient_mobile)}</p>}
                {detail.pickup_address && <p className="text-slate-500 text-xs font-mono tracking-wider">From : {detail.pickup_address}</p>}
                {detail.delivery_address && <p className="text-slate-500 text-xs font-mono tracking-wider">To : {detail.delivery_address}</p>}
              </DetailSection>

              <DetailSection icon={Calendar} title="Schedule">
                {detail.scheduled_date ? (
                  <>
                    <p className="text-slate-200 text-xs font-mono tracking-wider">{String(detail.scheduled_date).slice(0, 10)}</p>
                    {fmtTimeRange(detail.scheduled_time_from, detail.scheduled_time_to) && (
                      <p className="text-slate-500 text-xs font-mono tracking-wider">{fmtTimeRange(detail.scheduled_time_from, detail.scheduled_time_to)}</p>
                    )}
                  </>
                ) : <p className="text-slate-500 text-xs">Not scheduled</p>}
                <DetailRow label="Delivery status" value={detail.delivery_status} />
              </DetailSection>

              <DetailSection icon={Truck} title="Driver">
                {detail.driver ? (
                  <>
                    <p className="text-slate-100 text-sm">{`${detail.driver.first_name ?? ''} ${detail.driver.last_name ?? ''}`.trim() || '—'}</p>
                    {driverVehicle[detail.driver_id] && (
                      <p className="text-slate-500 text-xs font-mono tracking-wider">{driverVehicle[detail.driver_id]}</p>
                    )}
                    {detail.driver.mobile && <p className="text-slate-500 text-xs">{formatMobile(detail.driver.mobile)}</p>}
                    {detail.driver.driver_status && <DetailRow label="Driver status" value={detail.driver.driver_status} />}
                  </>
                ) : <p className="text-slate-500 text-xs">Unassigned</p>}
              </DetailSection>

              {detailLoading ? (
                <p className="text-slate-500 text-xs text-center py-4">Loading details…</p>
              ) : detailData && (
                <>
                  <DetailSection icon={Package} title="Items">
                    {detailData.items.length ? detailData.items.map(it => (
                      <div key={it.id} className="flex justify-between gap-3">
                        <span className="text-slate-200 text-xs">
                          {it.product?.name || 'Item'}<span className="text-slate-500"> × {it.quantity}</span>
                        </span>
                        <span className="text-slate-300 text-xs text-right tabular-nums">{fmtAmount(it.line_total, it.currency)}</span>
                      </div>
                    )) : <p className="text-slate-500 text-xs">No items</p>}
                  </DetailSection>

                  {detailData.packages.length > 0 && (
                    <DetailSection icon={Package} title="Delivery Packages">
                      {detailData.packages.map(pk => (
                        <div key={pk.id} className="flex justify-between gap-3">
                          <span className="text-slate-200 text-xs">
                            {pk.description || pk.category || 'Package'}{pk.quantity > 1 ? ` × ${pk.quantity}` : ''}
                          </span>
                          <span className="text-slate-300 text-xs text-right tabular-nums">{fmtAmount(pk.package_price, pk.currency)}</span>
                        </div>
                      ))}
                    </DetailSection>
                  )}

                  {detailData.services.length > 0 && (
                    <DetailSection icon={Wallet} title="Order Services">
                      {detailData.services.map(sv => (
                        <div key={sv.id} className="flex justify-between gap-3">
                          <span className="text-slate-200 text-xs">{sv.service_description || 'Service'}</span>
                          <span className="text-slate-300 text-xs text-right tabular-nums">{fmtAmount(sv.service_fees, sv.service_fees_currency)}</span>
                        </div>
                      ))}
                    </DetailSection>
                  )}

                  {detailData.retailInvoices.length > 0 && (
                    <DetailSection icon={Receipt} title="Retail Invoices">
                      {detailData.retailInvoices.map(ri => (
                        <div key={ri.id} className="flex justify-between gap-3">
                          <span className="text-slate-200 text-xs">{ri.shop_name || 'Invoice'}{ri.invoice_reference ? ` · ${ri.invoice_reference}` : ''}</span>
                          <span className="text-slate-300 text-xs text-right tabular-nums">{fmtAmount(ri.invoice_value, ri.currency)}</span>
                        </div>
                      ))}
                    </DetailSection>
                  )}

                  {detailData.payments.length > 0 && (
                    <DetailSection icon={Banknote} title="Payments Collected">
                      {detailData.payments.map(p => (
                        <div key={p.id} className="flex justify-between gap-3">
                          <span className="text-slate-200 text-xs">
                            {p.collection_type || 'cash'}{p.collected_at ? ` · ${String(p.collected_at).slice(0, 10)}` : ''}
                          </span>
                          <span className="text-emerald-300 text-xs text-right tabular-nums">{fmtAmount(p.amount, p.currency)}</span>
                        </div>
                      ))}
                    </DetailSection>
                  )}
                </>
              )}

              <DetailSection icon={Wallet} title="Delivery Fees & Payments">
                <div className="-mx-3 -my-3">
                  <AmountSummaryContent order={detail} filterContactId={partyContactId} />
                </div>
              </DetailSection>

              {(detail.order_details_text || detail.special_instructions) && (
                <DetailSection title="Notes">
                  {detail.order_details_text && <p className="text-slate-300 text-xs">{detail.order_details_text}</p>}
                  {detail.special_instructions && (
                    <p className="text-slate-500 text-xs"><span className="text-slate-600">Note: </span>{detail.special_instructions}</p>
                  )}
                </DetailSection>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
