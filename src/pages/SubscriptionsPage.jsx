import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CreditCard,
  Receipt,
  Plus,
  X,
  Loader,
  AlertCircle,
  Pencil,
  Trash2,
  Shield,
  CheckCircle2,
  Circle,
  Power,
  PowerOff,
  Hourglass,
  ShieldAlert,
  Building,
  Handshake,
  CalendarRange,
  AlertTriangle,
  AlertOctagon,
  XCircle,
  RefreshCw,
  Users,
  Wallet,
  CalendarClock,
  FileSignature,
  FileDown,
  Info,
  ArrowUpAZ,
  ArrowDownZA,
  ChevronsUpDown,
  Pin,
  PinOff,
  FilterX,
  ChevronRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { isStrictAdmin } from '../lib/roles'
import ContactCombobox from '../components/orders/ContactCombobox'
import { useApp } from '../context/AppContext'
import {
  fetchSubscriptions, saveSubscription, deleteSubscription,
  subscriptionStatus, STATUS_STYLES, contactLabel, todayStr, graceDaysLeft,
  subscriptionsSummary, coveredContactIds, renewalStage, RENEWAL_STAGES,
  daysLeftLabel, RENEWAL_WARN_DAYS, RENEWAL_URGENT_DAYS,
  isTrialSubscription, TRIAL_DAYS, addDays, RATE_CURRENCY,
  rankPartners, scopeFor, SCOPE, PARTNER_FREE_LIMIT, isSupplierContact, isPartnerContact,
  seatHolderIds, PAYMENT_METHODS, isAmountDue, ownerKey,
} from '../lib/subscriptions'
import { downloadDuePaymentsPdf, accessOf, daysOutstanding, totalsByCurrency } from '../lib/duePaymentsPdf'
import { SEATS, UNPAID_GRACE_DAYS } from '../lib/billing'
import { fetchAgreementMap, AGREEMENT_STATUS } from '../lib/subscriptionAgreement'
import { downloadAgreementPdf } from '../lib/subscriptionAgreementPdf'
import SearchField from '../components/ui/SearchField'

const CURRENCIES = ['USD', 'LBP', 'EUR']
const STATUS_FILTERS = [
  { value: 'all',         label: 'All' },
  { value: 'active',      label: 'Active' },
  { value: 'unpaid',      label: 'Unpaid' },
  { value: 'credit',      label: 'Active — payment due' },
  { value: 'scheduled',   label: 'Scheduled' },
  { value: 'expired',     label: 'Expired' },
  { value: 'deactivated', label: 'Deactivated' },
]
const PARTY_FILTERS = [
  { value: 'all',      label: 'All parties' },
  { value: 'supplier', label: 'Suppliers' },
  { value: 'partner',  label: 'Partners' },
]

// A month from today, as the default end date.
function plusMonths(dateStr, months) {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + months)
  return todayStr(d)
}

const emptyForm = () => ({
  contact_id: '', user_account_id: '', description: '', start_date: todayStr(), end_date: plusMonths(todayStr(), 1),
  amount: '', currency: 'USD', is_paid: false, paid_by_note: '', is_active: false,
})

/* The four renewal steps, as icons. Shape carries the meaning as much as
   colour does, so the list is still readable in a screenshot or on a projector. */
const RENEWAL_ICONS = {
  ok:      CheckCircle2,
  due:     AlertTriangle,
  urgent:  AlertOctagon,
  expired: XCircle,
  renewed: RefreshCw,
  idle:    Circle,
  unknown: Circle,
}

const fmtMoney = (v, c) =>
  `${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`

/* Money totals held per currency, printed as "1,200.00 USD · 3,000,000 LBP".
   Currencies are never added together — the sum would mean nothing. */
const moneyLine = (bucket) => {
  const parts = Object.entries(bucket || {})
    .filter(([, v]) => Number(v) !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => fmtMoney(v, c))
  return parts.length ? parts.join('  ·  ') : '—'
}

/* Settings → Subscriptions.

   Suppliers and partners can only sign in while they hold a subscription that
   is active, paid and in date. The super admin creates/edits/deletes them and
   confirms payment; admins may view, search and filter the list only. */
export default function SubscriptionsPage() {
  const { hasRole, currentUser } = useAuth()
  const { COMPANY_ID } = useApp()
  const isSuperAdmin = hasRole('super_admin')
  // Whoever grants an indulgence is recorded against it.
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
    || currentUser?.username || null
  const canView      = hasRole('super_admin', 'admin')
  /* A Senior Call Center user may READ this page and change nothing on it.
     Knowing whether a partner is paid up is part of dealing with them; issuing,
     pricing and activating a subscription is not.

     Every control here was already super-admin only, so today this changes
     nothing on screen. It is on the writing FUNCTIONS rather than the buttons
     on purpose: it states the rank's rule where the database is actually
     reached, so a control added later cannot hand the power over by being
     written without a check. */
  const canEditSubs  = isStrictAdmin(currentUser?.role)

  const [rows,       setRows]       = useState([])
  const [agreements, setAgreements] = useState(new Map())   // contact_id → agreement row
  const [agreementsOff, setAgreementsOff] = useState(false) // fix128 not run yet
  const [parties,    setParties]    = useState([])          // supplier/partner contacts
  // Contacts with an ACTIVE login — the only ones that occupy a seat (fix136).
  // A deactivated login cannot sign in, so it holds nothing.
  const [loginIds,   setLoginIds]   = useState(() => new Set())
  // Contacts with ANY login, active or not — only to tell “no login at all”
  // apart from “login deactivated” when saying why a partner holds no seat.
  const [anyLoginIds, setAnyLoginIds] = useState(() => new Set())
  /* Every party login (fix160: a partner may have several). A subscription
     belongs to ONE of them, so the list and the form name which. */
  const [logins, setLogins] = useState([])
  const loginById = useMemo(() => new Map(logins.map(l => [l.id, l])), [logins])
  const loginsOf  = useCallback((contactId) => logins.filter(l => l.contact_id === contactId), [logins])
  /* Super-admin dialogs (fix159): how to switch on an unpaid subscription, the
     payment record with its reference, and the Due Payments report. */
  const [activateFor, setActivateFor] = useState(null)
  const [payFor,      setPayFor]      = useState(null)
  const [payForm,     setPayForm]     = useState({ paid_on: '', method: 'Cash', reference: '', note: '' })
  const [payErr,      setPayErr]      = useState('')
  const [dueOpen,     setDueOpen]     = useState(false)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [partyFilter,   setPartyFilter]   = useState('all')
  const [renewalFilter, setRenewalFilter] = useState('')     // '' | 'due' | 'urgent' | 'expired'
  const [agreeFilter,   setAgreeFilter]   = useState('')     // '' | 'pending' | 'agreed' | 'rejected'

  /* The summary and filters fold away, because on a laptop they can take half
     the screen before a single subscription is visible. Pinning keeps them
     open for good — a person who works from the figures should not have to
     reopen them every visit. Both choices are remembered per device: it is a
     preference about this screen, not something the office needs to agree on. */
  const PANEL_KEY = 'ideliver_subs_panel'
  const [panel, setPanel] = useState(() => {
    try { return { open: true, pinned: false, ...(JSON.parse(localStorage.getItem(PANEL_KEY) || '{}')) } }
    catch { return { open: true, pinned: false } }
  })
  const savePanel = (next) => {
    setPanel(next)
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(next)) } catch { /* a preference, not data */ }
  }
  // Pinned means always shown, so pinning opens it and unpinning leaves it as is.
  const togglePin  = () => savePanel({ ...panel, pinned: !panel.pinned, open: panel.pinned ? panel.open : true })
  const toggleOpen = () => { if (!panel.pinned) savePanel({ ...panel, open: !panel.open }) }
  const panelOpen  = panel.open || panel.pinned

  /* One place that puts the list back to everything, so no filter can be left
     behind by a button that was written before it existed. */
  const activeFilters = [
    search && 'search',
    statusFilter !== 'all' && 'status',
    partyFilter !== 'all' && 'party',
    renewalFilter && 'renewal',
    agreeFilter && 'agreement',
  ].filter(Boolean)

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setPartyFilter('all')
    setRenewalFilter('')
    setAgreeFilter('')
  }

  /* Column sorting, cycling A→Z, Z→A, then back to the order the query
     returned. The third state is the point: "newest first" is itself a view,
     and without a way back to it a click on a header is a one-way door. */
  const [sort, setSort] = useState({ key: null, dir: null })
  const cycleSort = (key) => setSort(s => (
    s.key !== key ? { key, dir: 'asc' }
      : s.dir === 'asc' ? { key, dir: 'desc' }
      : { key: null, dir: null }))

  const [modal,   setModal]   = useState(null)   // 'add' | row
  const [form,    setForm]    = useState(emptyForm())
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ rows: r, error: e }, ag] = await Promise.all([
      fetchSubscriptions(COMPANY_ID),
      fetchAgreementMap(),          // empty map when fix128 hasn't been run
    ])
    setRows(r)
    setAgreements(ag.map)
    setAgreementsOff(!!ag.missing)
    setError(e && /subscriptions/i.test(e) && /not exist|schema cache/i.test(e)
      ? 'Subscriptions aren’t installed yet — run supabase-fix110.sql.'
      : (e || ''))
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { if (canView) load() }, [canView, load])

  useEffect(() => {
    if (!canView) return
    ;(async () => {
      const { data } = await supabase
        .from('contacts')
        /* mobile, account_number and contact_type are here for the picker in the
           New Subscription form: it searches by name, contact code, mobile and
           account number, and shows the role badges. Without them the search
           silently matches nothing for two of the four. */
        .select('id, first_name, last_name, company_name, code, mobile, account_number, contact_type, contact_types, created_at, is_active')
        .overlaps('contact_types', ['supplier', 'partner'])
        .order('first_name')
      setParties(data ?? [])

      const { data: logins } = await supabase
        .from('user_accounts')
        .select('id, username, status, contact_id, created_at')
        .not('contact_id', 'is', null)
        .order('created_at')
      setLoginIds(seatHolderIds(logins))
      setAnyLoginIds(new Set((logins ?? []).map(l => l.contact_id)))
      setLogins(logins ?? [])
    })()
  }, [canView])

  const today = todayStr()

  // Which contacts already hold cover reaching today or later — so an old period
  // reads as "renewed" rather than lapsed.
  const covered = useMemo(() => coveredContactIds(rows, today), [rows, today])

  const stageOf = useCallback(
    (r) => renewalStage(r, today, covered.has(ownerKey(r))),
    [today, covered])

  // No row on file means they haven't been asked yet — which is 'pending', not
  // an absence: the office should see who still owes an answer.
  const agreementOf = useCallback(
    (r) => agreements.get(r.contact_id) || null,
    [agreements])
  const agreementStatusOf = useCallback(
    (r) => agreementOf(r)?.status || 'pending',
    [agreementOf])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      const st = subscriptionStatus(r, today)
      if (statusFilter !== 'all' && st !== statusFilter) return false
      if (partyFilter !== 'all' && !(r.contact?.contact_types ?? []).includes(partyFilter)) return false
      if (renewalFilter && renewalStage(r, today, covered.has(ownerKey(r))).stage !== renewalFilter) return false
      if (agreeFilter && (agreements.get(r.contact_id)?.status || 'pending') !== agreeFilter) return false
      if (!q) return true
      return [contactLabel(r.contact), r.description, r.contact?.mobile]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter, partyFilter, renewalFilter, agreeFilter, today, covered, agreements])

  /* What each column sorts BY — not always what it shows. Renewal sorts by the
     days left, so "Expired" and "3 days" sit at the same end; Amount by the
     figure rather than its formatted text; Agreement by where the party stands.
     Sorting by the printed string would order 10 before 9. */
  const sortValue = (r, key) => {
    switch (key) {
      case 'party':       return contactLabel(r.contact).toLowerCase()
      case 'description': return (r.description || '').toLowerCase()
      case 'start':       return r.start_date || ''
      case 'end':         return r.end_date || ''
      case 'renewal': {
        const { days } = stageOf(r)
        return days == null ? Number.NEGATIVE_INFINITY : days
      }
      case 'amount':      return Number(r.amount) || 0
      case 'payment':     return r.is_paid ? 1 : 0
      case 'status':      return subscriptionStatus(r, today)
      case 'agreement':   return agreementStatusOf(r)
      default:            return ''
    }
  }

  const sorted = useMemo(() => {
    if (!sort.key || !sort.dir) return filtered            // the natural order
    const dir = sort.dir === 'asc' ? 1 : -1
    return filtered.slice().sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      if (va === vb) return contactLabel(a.contact).localeCompare(contactLabel(b.contact))
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, today, agreements, covered])

  // Headline figures over the whole list (not the filtered view) — counts, money
  // per currency, and how many renewals are coming up.
  const summary = useMemo(() => subscriptionsSummary(rows, today), [rows, today])

  /* Agreements are counted per CONTACT, not per subscription row: one party
     with three periods has answered once, and counting the rows would say
     three. */
  /* Who actually has to subscribe: every supplier, and partners from the
     eleventh onward. Computed from the party list already loaded, so it costs
     nothing extra. */
  const partnerRanks = useMemo(() => rankPartners(parties, loginIds), [parties, loginIds])
  /* WHY A ROW IS NOT BEING CHARGED, said accurately.

     This badge used to read “free partner” for every contact that was not
     subject to a subscription — which lumped together two opposite things.
     One of the first ten partners is genuinely free. A contact that is no
     longer typed as a partner at all is not free: it is not a partner, its
     subscription row is stranded, and its login is refused at sign-in for a
     role mismatch. Calling that “free partner” told the admin the opposite of
     what was true, and the only thing that said otherwise was a tooltip.

     Three states, three labels. Each says what it is and what to do. */
  /* ONE SENTENCE FOR EVERY SUBSCRIPTION THAT IS PLACED BUT NOT PAID.

     Until now only a contact that was NOT charged carried a badge, so the rows
     that actually owe money — partners past the free ten, suppliers — sat
     there with nothing beside the name, and the one unpaid row that did have a
     badge looked like the odd one out. It is the owed rows that need saying.

     Read from the row, so a subscription added tomorrow and left unpaid shows
     it without anybody remembering to. A zero-amount row is never awaiting
     anything, so it is left alone. The tooltip says what the missing payment
     is holding back, which is the part that differs from row to row. */
  const unpaidBadge = useCallback((r, sc) => {
    if (!r || r.is_paid || !(Number(r.amount) > 0)) return null
    const st = subscriptionStatus(r)
    const money = `${Number(r.amount).toFixed(2)} ${r.currency || ''}`.trim()
    const owed = (title) => ({
      label: 'awaiting payment',
      cls:   'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
      title,
    })
    /* A charge raised while the partner was past the tenth seat, which it no
       longer is — somebody older left the ten and it moved up. The row still
       says 10 USD unpaid, but nothing is owed: it signs in as a free partner.
       Calling that “awaiting payment” would chase money that is not due. */
    if (sc?.scope === SCOPE.partnerFree) {
      return {
        label: 'not due — free seat',
        cls:   'border-amber-500/40 bg-amber-500/10 text-amber-300',
        title: `This ${money} charge is no longer owed: the partner is now #${sc.rank}, inside the free `
             + `${PARTNER_FREE_LIMIT}, and signs in without a subscription. Delete this row, or set its amount `
             + 'to 0 and mark it paid, so it stops reading as unpaid.',
      }
    }
    if (st === 'credit') {
      return owed(`${money} not yet paid. Activated for the full term`
        + `${r.credit_granted_at ? ` on ${String(r.credit_granted_at).slice(0, 10)}` : ''}`
        + `${r.credit_granted_by ? ` by ${r.credit_granted_by}` : ''} — they can sign in, and the payment `
        + 'stays due until it is recorded with its reference.')
    }
    if (st === 'grace') {
      const left = graceDaysLeft(r)
      return owed(`${money} not yet paid. Let in on trust while it is outstanding — `
        + `${left} day${left === 1 ? '' : 's'} left, then sign-in closes again.`)
    }
    if (st === 'grace_over') {
      return owed(`${money} not yet paid, and the trust period has ended. `
        + 'Sign-in is closed until the payment is confirmed.')
    }
    if (r.contact && !loginIds.has(r.contact.id)) {
      return owed(`${money} not yet paid. Nobody can sign in as this contact right now, so nothing is `
        + 'blocked today — once it has an active login, sign-in waits on this payment.')
    }
    return owed(`${money} not yet paid. Sign-in stays closed until the payment is confirmed `
      + 'and the subscription is activated.')
  }, [loginIds])

  const exemptBadge = useCallback((sc, contact) => {
    if (sc.scope === SCOPE.partnerFree) {
      return {
        label: `free partner #${sc.rank}`,
        cls:   'border-fresh-500/30 bg-fresh-500/10 text-fresh-300',
        title: `Partner #${sc.rank} — inside the first ${PARTNER_FREE_LIMIT}, so no subscription is required.`,
      }
    }
    if (sc.scope === SCOPE.notParty) {
      return {
        label: 'not a partner',
        cls:   'border-red-500/40 bg-red-500/10 text-red-300',
        title: 'This contact is no longer typed as a partner or supplier, so no subscription applies to it — '
             + 'and any partner login it still has is refused at sign-in. Either set its contact type back, '
             + 'or remove the login and this subscription row.',
      }
    }
    /* SCOPE.unknown means “this is a partner, but it has no rank” — and on this
       page there is only one way that happens: the contact holds no seat, so it
       was never placed in the running order at all. A seat is held by an ACTIVE
       partner WITH A LOGIN (fix136); a partner nobody can sign in as is not
       occupying one of the ten and is not competing for them.

       That is worth saying out loud rather than calling it unknown, because it
       also explains the thing that looks wrong: a subscription sold to a contact
       that is not yet using a seat. */
    if (contact && contact.is_active === false) {
      return {
        label: 'inactive contact',
        cls:   'border-slate-500/30 bg-slate-500/10 text-slate-400',
        title: 'This contact is deactivated, so it holds no seat and no subscription applies to it.',
      }
    }
    if (contact && !loginIds.has(contact.id) && anyLoginIds.has(contact.id)) {
      return {
        label: 'login deactivated — no seat',
        cls:   'border-amber-500/40 bg-amber-500/10 text-amber-300',
        title: 'This partner’s login is deactivated, so it cannot sign in and holds none of the ten seats — '
             + 'its place passed to the next partner in line. Reactivate the login and it takes its place back '
             + 'by date of creation, which can push the partner at #10 out of the free ten.',
      }
    }
    if (contact && !loginIds.has(contact.id)) {
      return {
        label: 'no login — no seat',
        cls:   'border-amber-500/40 bg-amber-500/10 text-amber-300',
        title: 'This partner has no login, so it occupies none of the ten seats and is not ranked among them. '
             + 'Once a login is created it takes its place by date of creation, which may put it inside the '
             + 'free ten — and make this subscription unnecessary.',
      }
    }
    return {
      label: 'not ranked',
      cls:   'border-slate-500/30 bg-slate-500/10 text-slate-400',
      title: 'This partner could not be placed in the running order, so whether it owes a subscription is '
           + 'unknown. It is treated as exempt until it can be.',
    }
  }, [loginIds, anyLoginIds])

  const scopeOf = useCallback((contact) => {
    if (!contact) return { subject: true, scope: SCOPE.supplier, rank: null }
    return scopeFor(contact, partnerRanks.get(contact.id) ?? null)
  }, [partnerRanks])

  /* The Due Payments report: money owed and actually due. A charge that is
     “not due — free seat” is left off and counted apart, because chasing it
     would be chasing money nobody owes. Longest-owed first.

   Declared AFTER scopeOf on purpose: useMemo runs during render, and calling
   a const declared further down blanked the whole page. */
  const dueRows = useMemo(() => rows
    .filter(r => isAmountDue(r) && scopeOf(r.contact).scope !== SCOPE.partnerFree)
    .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || ''))),
  [rows, scopeOf])
  const staleFreeCount = useMemo(() => rows
    .filter(r => isAmountDue(r) && scopeOf(r.contact).scope === SCOPE.partnerFree).length,
  [rows, scopeOf])


  const scopeCounts = useMemo(() => {
    // Seats are held by parties that can sign in; the rest of the address book
    // is contacts, not subscriptions.
    const seated = parties.filter(c => c.is_active !== false && loginIds.has(c.id))
    const livePartners = seated.filter(c => isPartnerContact(c) && !isSupplierContact(c))
    return {
      suppliers: seated.filter(c => isSupplierContact(c)).length,
      free: Math.min(PARTNER_FREE_LIMIT, livePartners.length),
      paying: Math.max(0, livePartners.length - PARTNER_FREE_LIMIT),
    }
  }, [parties, loginIds])

  const agreeCounts = useMemo(() => {
    const seen = new Map()
    for (const r of rows) {
      if (!r.contact_id || seen.has(r.contact_id)) continue
      seen.set(r.contact_id, agreements.get(r.contact_id)?.status || 'pending')
    }
    const c = { agreed: 0, pending: 0, rejected: 0 }
    for (const st of seen.values()) if (c[st] != null) c[st] += 1
    return c
  }, [rows, agreements])

  if (!canView) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Administrators only</p>
        <p className="text-slate-500 text-sm">You don’t have permission to view subscriptions.</p>
      </div>
    )
  }

  function openAdd() { if (!canEditSubs) return; setForm(emptyForm()); setFormErr(''); setModal('add') }
  /* Renewing a partner is always the same arrangement — one year at USD 10,
     invoiced to 3asari3 — so the form offers exactly that rather than making
     the super admin retype the licence every time. A supplier renews onto its
     chosen monthly plan instead, which is the party's own decision. */
  function renewPartner(r) {
    const from = r?.end_date && r.end_date >= todayStr() ? addDays(r.end_date, 1) : todayStr()
    setForm({
      contact_id: r.contact_id,
      user_account_id: r.user_account_id || '',   // renewing THIS login's seat
      description: `Annual partner seat — ${from.slice(0, 4)}`,
      start_date: from,
      end_date: addDays(from, 364),
      amount: String(SEATS.partner.extraRate),
      currency: RATE_CURRENCY,
      is_paid: false,
      paid_by_note: 'Invoiced to 3asari3 with the annual package',
      is_active: false,
    })
    setFormErr(''); setModal('add')
  }

  function openEdit(r) {
    if (!canEditSubs) return
    setForm({
      contact_id: r.contact_id ?? '', user_account_id: r.user_account_id ?? '', description: r.description ?? '',
      start_date: r.start_date ?? todayStr(), end_date: r.end_date ?? '',
      amount: r.amount ?? '', currency: r.currency || 'USD',
      is_paid: !!r.is_paid, paid_by_note: r.paid_by_note ?? '', is_active: !!r.is_active,
    })
    setFormErr(''); setModal(r)
  }
  function closeModal() { setModal(null); setForm(emptyForm()); setFormErr('') }

  async function save() {
    if (!canEditSubs) return
    if (!form.contact_id)  { setFormErr('Choose the supplier or partner.'); return }
    if (loginsOf(form.contact_id).length > 1 && !form.user_account_id) {
      setFormErr('This partner has several logins — choose which one this subscription is for.'); return
    }
    if (!form.start_date)  { setFormErr('Start date is required.'); return }
    if (!form.end_date)    { setFormErr('End date is required.'); return }
    if (form.end_date < form.start_date) { setFormErr('The end date must be after the start date.'); return }
    if (form.is_active && !form.is_paid) {
      setFormErr('Confirm the payment first — a subscription can only be activated once it is paid.'); return
    }
    setSaving(true); setFormErr('')
    const err = await saveSubscription(
      { ...form, id: modal === 'add' ? null : modal.id, paid_at: modal === 'add' ? null : modal.paid_at },
      { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setSaving(false)
    if (err) {
      setFormErr(/subscriptions/i.test(err) && /not exist|schema cache/i.test(err)
        ? 'Subscriptions aren’t installed yet — run supabase-fix110.sql.' : err)
      return
    }
    closeModal(); load()
  }

  // Quick toggles from the list (super admin only).
  async function patch(row, changes) {
    if (!canEditSubs) return
    setBusyId(row.id)
    const err = await saveSubscription({ ...row, ...changes }, { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  /* Switch an UNPAID subscription on. Two ways, chosen in the dialog:

       for the full term   — open until its end date; stays owed and sits on
                             the Due Payments report until paid (fix159)
       on trust            — open for UNPAID_GRACE_DAYS, then closes again

     Either is signed with the super admin's name and the date. */
  function activateUnpaid(row, mode) {
    setActivateFor(null)
    if (mode === 'credit') {
      patch(row, { is_active: true, credit_granted_at: new Date().toISOString(), credit_granted_by: currentUserName,
                   grace_started_on: null, grace_granted_by: null })
    } else {
      patch(row, { is_active: true, grace_started_on: todayStr(), grace_granted_by: currentUserName,
                   credit_granted_at: null, credit_granted_by: null })
    }
  }

  function openPay(row) {
    setPayForm({ paid_on: todayStr(), method: 'Cash', reference: '', note: row.paid_by_note || '' })
    setPayErr('')
    setPayFor(row)
  }

  /* Record the money. A reference is required: a payment nobody can trace
     later is how "it was paid, I think" turns into an argument. */
  async function recordPayment() {
    const row = payFor
    if (!row) return
    if (!payForm.reference.trim()) { setPayErr('Enter the payment reference — receipt, transfer or cheque number.'); return }
    if (!payForm.paid_on) { setPayErr('Enter the date the money was received.'); return }
    setPayFor(null)
    await patch(row, {
      is_paid:           true,
      paid_at:           new Date(`${payForm.paid_on}T12:00:00`).toISOString(),
      payment_method:    payForm.method,
      payment_reference: payForm.reference.trim(),
      paid_recorded_by:  currentUserName,
      paid_by_note:      payForm.note,
      grace_started_on:  null,
      grace_granted_by:  null,
    })
  }

  async function remove(row) {
    if (!canEditSubs) return
    setBusyId(row.id)
    const err = await deleteSubscription(row.id)
    setBusyId(null); setConfirmDelete(null)
    if (err) { setError(err); return }
    load()
  }

  const partyIcon = (c) => ((c?.contact_types ?? []).includes('supplier') ? Building : Handshake)
  const COL_COUNT = isSuperAdmin ? 10 : 9     // header cells, for the empty/loading rows

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-400" />
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search supplier, partner or description…"
            className="input pl-9"
          />
        </div>
        {/* Already super-admin only — a senior call centre user could not have
            reached it in any case. */}
        {isSuperAdmin && (
          <button type="button" onClick={() => setDueOpen(true)}
            title="Every subscription with money still owed — printable"
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                       border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20">
            <Receipt className="w-4 h-4" /> Due payments
            <span className="text-[11px] tabular-nums px-1.5 rounded bg-fuchsia-500/20">{dueRows.length}</span>
          </button>
        )}
        {isSuperAdmin && (
          <button className="btn-primary" onClick={openAdd}>
            <Plus className="w-4 h-4" /> New subscription
          </button>
        )}
      </div>

      {/* ── Summary & filters, foldable and pinnable ─────────────────────
          The title, the search box and New subscription stay outside: those
          are how you get anywhere on this page, so they are never hidden. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={toggleOpen} disabled={panel.pinned}
          title={panel.pinned ? 'Pinned open — unpin to fold it away' : (panelOpen ? 'Hide the summary and filters' : 'Show the summary and filters')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            panel.pinned
              ? 'border-surface-border text-slate-500 cursor-default'
              : 'border-surface-border text-slate-300 hover:bg-surface-hover'}`}>
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${panelOpen ? 'rotate-90' : ''}`} />
          Summary &amp; filters
        </button>

        <button onClick={togglePin}
          title={panel.pinned ? 'Unpin — let it fold away' : 'Pin — keep it open on this device'}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            panel.pinned
              ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
              : 'border-surface-border text-slate-400 hover:bg-surface-hover'}`}>
          {panel.pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
          {panel.pinned ? 'Pinned' : 'Pin'}
        </button>

        {/* Folded away, the filters must still announce themselves — a hidden
            filter is the reason a list looks empty for no apparent reason. */}
        {!panelOpen && activeFilters.length > 0 && (
          <span className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-amber-500/10 text-amber-300 border-amber-500/30">
            {activeFilters.length} filter{activeFilters.length === 1 ? '' : 's'} on — {activeFilters.join(', ')}
          </span>
        )}

        {activeFilters.length > 0 && (
          <button onClick={clearFilters}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-surface-border text-slate-400 hover:text-slate-200">
            <FilterX className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}

        <span className="ml-auto text-[11px] text-slate-500">
          {sorted.length} of {rows.length} subscription{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {panelOpen && (<>
      {/* ── Summary (super admin) ────────────────────────────────────────
          How many subscriptions there are, what they are worth, and what needs
          renewing — over the whole list, not the filtered view, so the figures
          don't move when a filter is clicked. Each card is a filter. */}
      {isSuperAdmin ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <button onClick={() => { setStatusFilter('all'); setRenewalFilter('') }}
            className={`card p-3 text-left transition-colors ${
              statusFilter === 'all' && !renewalFilter ? 'border-brand-500/40 bg-brand-500/5' : 'hover:bg-surface-hover/40'}`}>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-brand-400" />
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Subscriptions</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-slate-100 tabular-nums">{summary.total}</p>
            <p className="text-[11px] text-slate-500">
              {summary.partyCount} supplier{summary.partyCount === 1 ? '' : 's'} / partner{summary.partyCount === 1 ? '' : 's'}
            </p>
          </button>

          <div className="card p-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-slate-300" />
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Value</span>
            </div>
            <p className="mt-1.5 text-sm font-bold text-slate-100 tabular-nums leading-snug">{moneyLine(summary.value)}</p>
            <p className="text-[11px] text-slate-500">active: {moneyLine(summary.activeValue)}</p>
          </div>

          <button onClick={() => { setStatusFilter(statusFilter === 'active' ? 'all' : 'active'); setRenewalFilter('') }}
            className={`card p-3 text-left transition-colors ${
              statusFilter === 'active' ? 'border-green-500/50 bg-green-500/5' : 'hover:bg-surface-hover/40'}`}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Active</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-green-300 tabular-nums">{summary.active}</p>
            <p className="text-[11px] text-slate-500">
              {summary.unpaid} unpaid · {summary.scheduled} scheduled · {summary.deactivated} off{summary.credit ? ` · ${summary.credit} open, payment due` : ''}
            </p>
          </button>

          <button onClick={() => { setRenewalFilter(renewalFilter === 'due' ? '' : 'due'); setStatusFilter('all') }}
            className={`card p-3 text-left transition-colors ${
              renewalFilter === 'due' ? 'border-amber-500/50 bg-amber-500/5' : 'hover:bg-surface-hover/40'}`}>
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber-400" />
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Renewals due</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-amber-300 tabular-nums">{summary.due + summary.urgent}</p>
            <p className="text-[11px] text-slate-500">
              within {RENEWAL_WARN_DAYS} days
              {summary.urgent > 0 && (
                <span className="text-red-300"> · {summary.urgent} within {RENEWAL_URGENT_DAYS}</span>
              )}
            </p>
          </button>

          <button onClick={() => { setRenewalFilter(renewalFilter === 'expired' ? '' : 'expired'); setStatusFilter('all') }}
            className={`card p-3 text-left transition-colors ${
              renewalFilter === 'expired' ? 'border-red-500/50 bg-red-500/5' : 'hover:bg-surface-hover/40'}`}>
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Expired</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-red-300 tabular-nums">{summary.expired}</p>
            <p className="text-[11px] text-slate-500">
              {moneyLine(summary.expiredValue)}
              {summary.renewed > 0 && <span className="text-slate-600"> · {summary.renewed} renewed</span>}
            </p>
          </button>

          {/* Where each party stands on the subscription agreement they are
              shown at sign-in. Counted per contact — one party, one answer. */}
          <div className="card p-3">
            <div className="flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-slate-300" />
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Agreement</span>
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {agreementsOff && <p className="text-[11px] text-amber-300/80">not installed</p>}
              {!agreementsOff && ['agreed', 'pending', 'rejected'].map(st => (
                <button key={st} onClick={() => setAgreeFilter(agreeFilter === st ? '' : st)}
                  className={`flex items-center justify-between gap-2 rounded px-1.5 py-0.5 text-[11px] border transition-colors ${
                    agreeFilter === st ? AGREEMENT_STATUS[st].cls : 'border-transparent text-slate-500 hover:bg-surface-hover'}`}>
                  <span>{AGREEMENT_STATUS[st].label}</span>
                  <span className="tabular-nums font-semibold">{agreeCounts[st]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="px-2.5 py-1 rounded-lg border bg-green-500/10 text-green-300 border-green-500/30">
            {summary.active} active
          </span>
          <span className="px-2.5 py-1 rounded-lg border bg-amber-500/10 text-amber-300 border-amber-500/30">
            {summary.due + summary.urgent} due for renewal
          </span>
          <span className="px-2.5 py-1 rounded-lg border bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30">
            {summary.unpaid} unpaid
          </span>
          <span className="px-2.5 py-1 rounded-lg border bg-red-500/10 text-red-300 border-red-500/30">
            {summary.expired} expired
          </span>
          <span className="ml-auto text-[11px] text-slate-500">View only — subscriptions are managed by the super admin.</span>
        </div>
      )}

      {/* The rule, in one line — the figures under it are what it produces today. */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-surface-border bg-surface-hover/30">
        <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-slate-200">Suppliers always subscribe.</span>{' '}
          Partners get the first {PARTNER_FREE_LIMIT} free — from the {PARTNER_FREE_LIMIT + 1}th onward they
          subscribe too. The free slots are held by the {PARTNER_FREE_LIMIT} longest-standing live partners, so
          retiring one passes its slot to the next in line.
          <span className="block mt-1 text-slate-500">
            Today: {scopeCounts.suppliers} supplier{scopeCounts.suppliers === 1 ? '' : 's'} ·
            {' '}{scopeCounts.free} free partner{scopeCounts.free === 1 ? '' : 's'} ·
            {' '}{scopeCounts.paying} partner{scopeCounts.paying === 1 ? '' : 's'} subscribing.
          </span>
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                statusFilter === f.value
                  ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                  : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2">
          {PARTY_FILTERS.map(f => (
            <button key={f.value} onClick={() => setPartyFilter(f.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                partyFilter === f.value
                  ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                  : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {renewalFilter && (
          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${RENEWAL_STAGES[renewalFilter].cls}`}>
            {renewalFilter === 'due'    ? `Renewing within ${RENEWAL_WARN_DAYS} days`
              : renewalFilter === 'urgent' ? `Renewing within ${RENEWAL_URGENT_DAYS} days`
              : 'Expired, not renewed'}
          </span>
        )}
        {agreeFilter && (
          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${AGREEMENT_STATUS[agreeFilter].cls}`}>
            Agreement {AGREEMENT_STATUS[agreeFilter].label.toLowerCase()}
          </span>
        )}
        {activeFilters.length > 0 && (
          <button onClick={clearFilters}
            className="btn-ghost py-1.5 px-2.5 text-xs text-slate-400 border border-surface-border">
            <FilterX className="w-3.5 h-3.5" /> Clear filters
          </button>
        )}
      </div>
      </>)}

      {agreementsOff && isSuperAdmin && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-200 text-xs leading-relaxed">
            The subscription agreement isn’t installed yet — run <span className="font-mono">supabase-fix128.sql</span>.
            Until then suppliers and partners are not asked to accept it, and no agreement status is recorded.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* List */}
      {/* The table scrolls inside the card so the header can stay put: on a long
          list the column you are reading is otherwise off the top of the screen
          by the time you reach the rows you came for. */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-card">
            <tr className="border-b border-surface-border">
              {[
                ['Supplier / Partner', 'party'], ['Description', 'description'],
                ['Start', 'start'], ['End', 'end'], ['Renewal', 'renewal'],
                ['Amount', 'amount'], ['Payment', 'payment'], ['Status', 'status'],
                ['Agreement', 'agreement'],
                ...(isSuperAdmin ? [['', null]] : []),
              ].map(([label, key]) => (
                <th key={label || 'actions'}
                  className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider bg-surface-card">
                  {key ? (
                    <button onClick={() => cycleSort(key)}
                      title={sort.key === key
                        ? (sort.dir === 'asc' ? 'Sorted A→Z — click for Z→A' : 'Sorted Z→A — click to clear')
                        : `Sort by ${label}`}
                      className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${
                        sort.key === key ? 'text-brand-300' : 'hover:text-slate-300'}`}>
                      {label}
                      {sort.key === key
                        ? (sort.dir === 'asc' ? <ArrowUpAZ className="w-3.5 h-3.5" /> : <ArrowDownZA className="w-3.5 h-3.5" />)
                        : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                    </button>
                  ) : label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COL_COUNT} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={COL_COUNT} className="px-4 py-10 text-center text-slate-500">No subscriptions found</td></tr>
            ) : sorted.map(r => {
              const st  = subscriptionStatus(r, today)
              const cfg = STATUS_STYLES[st] ?? STATUS_STYLES.deactivated
              const Icon = partyIcon(r.contact)
              const { stage, days } = stageOf(r)
              // A subscription that isn't in force today — unpaid, not yet started,
              // switched off — is not "renewing well"; the countdown is shown plainly
              // rather than in green, and the Status column carries the real answer.
              const key = (st !== 'active' && ['ok', 'due', 'urgent'].includes(stage)) ? 'idle' : stage
              const rn = RENEWAL_STAGES[key]
              const RnIcon = RENEWAL_ICONS[key]
              // A period that ran out with nothing to replace it is struck through:
              // it reads at a glance as history rather than something still owed.
              const lapsed = stage === 'expired'
              const strike = lapsed ? 'line-through decoration-red-400/60 text-slate-500' : ''
              return (
                <tr key={r.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${
                  lapsed ? 'bg-red-500/[0.03]' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className={`font-medium ${lapsed ? strike : 'text-slate-100'}`}>{contactLabel(r.contact)}</span>
                      {r.user_account_id && loginById.get(r.user_account_id) && (
                        <span title="The login this subscription lets in"
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-surface-border text-slate-400 whitespace-nowrap flex-shrink-0">
                          @{loginById.get(r.user_account_id).username}
                        </span>
                      )}
                      {(() => {
                        /* Up to two badges beside the name: whether the row is
                           awaiting payment, and — for a contact that is not
                           charged — why not. The first is the same sentence on
                           every unpaid row, so the list reads one way. */
                        const sc = scopeOf(r.contact)
                        const owed = unpaidBadge(r, sc)
                        const b = sc.subject ? null : exemptBadge(sc, r.contact)
                        if (!owed && !b) return null
                        return (
                          <>
                            {owed && (
                              <span title={owed.title}
                                className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap flex-shrink-0 ${owed.cls}`}>
                                {owed.label}
                              </span>
                            )}
                            {b && (
                              <span title={b.title}
                                className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap flex-shrink-0 ${b.cls}`}>
                                {b.label}
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[16rem]">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-slate-400 text-xs truncate ${strike}`}>{r.description || '—'}</span>
                      {isTrialSubscription(r) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-brand-500/30 bg-brand-500/10 text-brand-300 whitespace-nowrap flex-shrink-0"
                          title={`Issued automatically when the contact was created — ${TRIAL_DAYS} free days`}>
                          free
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`px-4 py-3 text-slate-400 text-xs whitespace-nowrap ${strike}`}>{r.start_date}</td>
                  <td className={`px-4 py-3 text-xs whitespace-nowrap ${lapsed ? strike : 'text-slate-400'}`}>{r.end_date}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2 py-1 ${rn.cls}`}
                      title={key === 'expired' ? `Expired — ended ${r.end_date}, not renewed`
                        : key === 'renewed' ? 'This period ended, but a newer subscription covers them'
                        : key === 'urgent'  ? `Renew now — ${daysLeftLabel(days)} left`
                        : key === 'due'     ? `Renewal coming up — ${daysLeftLabel(days)} left`
                        : key === 'idle'    ? `${daysLeftLabel(days)} left, but this subscription isn’t in force`
                        : key === 'ok'      ? `${daysLeftLabel(days)} left`
                        : 'No end date set'}>
                      <RnIcon className={`w-3.5 h-3.5 flex-shrink-0 ${key === 'urgent' ? 'animate-pulse' : ''}`} />
                      {['expired', 'renewed', 'unknown'].includes(key)
                        ? rn.label
                        : <span className="tabular-nums">{daysLeftLabel(days)}</span>}
                    </span>
                  </td>
                  <td className={`px-4 py-3 tabular-nums whitespace-nowrap ${lapsed ? strike : 'text-slate-200'}`}>{fmtMoney(r.amount, r.currency)}</td>
                  <td className="px-4 py-3">
                    {isSuperAdmin ? (
                      <button onClick={() => {
                          if (!r.is_paid) { openPay(r); return }
                          if (!window.confirm('Mark this subscription UNPAID again? The recorded payment details are '
                            + 'cleared and access closes until it is paid.')) return
                          patch(r, { is_paid: false, is_active: false, grace_started_on: null, grace_granted_by: null,
                                     credit_granted_at: null, credit_granted_by: null,
                                     payment_method: null, payment_reference: null, paid_recorded_by: null })
                        }}
                        disabled={busyId === r.id}
                        title={r.is_paid
                          ? [ 'Money received',
                              r.payment_method ? `by ${r.payment_method}` : '',
                              r.payment_reference ? `ref ${r.payment_reference}` : '',
                              r.paid_at ? `on ${String(r.paid_at).slice(0, 10)}` : '',
                              r.paid_recorded_by ? `— recorded by ${r.paid_recorded_by}` : '',
                              '— click to mark unpaid' ].filter(Boolean).join(' ')
                          : 'Record the payment — date, method and reference'}
                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2.5 py-1 transition-colors ${
                          r.is_paid
                            ? 'bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15'
                            : 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/15'}`}>
                        {busyId === r.id ? <Loader className="w-3.5 h-3.5 animate-spin" />
                          : r.is_paid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                        {r.is_paid ? 'Paid' : 'Unpaid'}
                      </button>
                    ) : (
                      <span className={`text-[11px] border rounded px-2 py-0.5 ${
                        r.is_paid ? 'bg-green-500/10 text-green-300 border-green-500/30'
                                  : 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30'}`}>
                        {r.is_paid ? 'Paid' : 'Unpaid'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${cfg.cls}`}>{cfg.label}</span>
                    {/* An indulgence is running, or has run out. Either way it is
                        counted down in the open: a party let in without paying is
                        the one thing on this page that quietly becomes permanent
                        if nobody is looking at it (fix149). */}
                    {subscriptionStatus(r, today) === 'credit' && (
                      <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-400"
                        title={`Activated for the full term while unpaid${r.credit_granted_at ? ` on ${String(r.credit_granted_at).slice(0, 10)}` : ''}${r.credit_granted_by ? ` by ${r.credit_granted_by}` : ''}. It stays on the Due Payments report until the payment is recorded.`}>
                        <Receipt className="w-3.5 h-3.5 flex-shrink-0" />
                        payment due{r.credit_granted_by ? ` · ${r.credit_granted_by}` : ''}
                      </span>
                    )}
                    {r.is_paid && r.payment_reference && (
                      <span className="mt-1 block text-[10px] text-slate-500 font-mono truncate max-w-[10rem]"
                        title={`${r.payment_method || ''} ${r.payment_reference}`.trim()}>
                        {r.payment_method ? `${r.payment_method} · ` : ''}{r.payment_reference}
                      </span>
                    )}
                    {r.grace_started_on && !r.is_paid && (() => {
                      const left = graceDaysLeft(r, today)
                      const over = left <= 0
                      return (
                        <span className={`mt-1 flex items-center gap-1 text-[11px] ${over ? 'text-red-400' : 'text-amber-400'}`}
                          title={over
                            ? `Switched on unpaid on ${String(r.grace_started_on).slice(0, 10)}${r.grace_granted_by ? ` by ${r.grace_granted_by}` : ''} — the ${UNPAID_GRACE_DAYS} days have run out and sign-in is blocked again`
                            : `Switched on unpaid on ${String(r.grace_started_on).slice(0, 10)}${r.grace_granted_by ? ` by ${r.grace_granted_by}` : ''} — access closes on its own when this reaches zero`}>
                          {over ? <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
                                : <Hourglass className="w-3.5 h-3.5 flex-shrink-0" />}
                          {over ? 'Unpaid — access closed' : `${left} day${left === 1 ? '' : 's'} left to pay`}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      if (agreementsOff) return <span className="text-slate-600 text-[11px]">—</span>
                      const ag = agreementOf(r)
                      const ast = agreementStatusOf(r)
                      const cls = AGREEMENT_STATUS[ast]?.cls ?? AGREEMENT_STATUS.pending.cls
                      const when = ag?.responded_at ? String(ag.responded_at).slice(0, 10) : ''
                      // Clicking it downloads that party's agreement — signed if
                      // they answered, with signature lines if they haven't.
                      return (
                        <button
                          onClick={() => downloadAgreementPdf({
                            contact: r.contact,
                            agreement: ag,
                            trialEnd: isTrialSubscription(r) ? r.end_date : null,
                          })}
                          className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap inline-flex items-center gap-1 hover:brightness-125 ${cls}`}
                          title={[
                            ag ? `${AGREEMENT_STATUS[ast].label} on ${when}` : 'Not answered yet — they see the agreement next time they sign in',
                            ag?.responded_name ? `by ${ag.responded_name}` : '',
                            ag?.note ? `“${ag.note}”` : '',
                            'Click to download the agreement as a PDF',
                          ].filter(Boolean).join(' · ')}>
                          {AGREEMENT_STATUS[ast].label}
                          <FileDown className="w-3 h-3 opacity-60" />
                        </button>
                      )
                    })()}
                  </td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Activating an UNPAID subscription is allowed, on a clock
                            (fix149). It is asked for explicitly, because letting
                            somebody in without payment is a decision, and the
                            clock is what keeps it from becoming permanent.
                            Switching a row off, or paying it, clears the clock. */}
                        <button onClick={() => {
                          if (r.is_active) { patch(r, { is_active: false, grace_started_on: null, grace_granted_by: null,
                                                        credit_granted_at: null, credit_granted_by: null }); return }
                          if (r.is_paid)   { patch(r, { is_active: true }); return }
                          // Unpaid: the super admin chooses full term or trust.
                          setActivateFor(r)
                        }}
                          disabled={busyId === r.id}
                          title={r.is_active
                            ? 'Deactivate — blocks their sign-in'
                            : (r.is_paid
                                ? 'Activate — lets them sign in'
                                : 'Activate while unpaid — for the full term, or on trust')}
                          className={`btn-ghost p-1.5 disabled:opacity-30 disabled:cursor-not-allowed ${
                            r.is_active ? 'text-green-400 hover:text-red-400' : 'text-slate-400 hover:text-green-400'}`}>
                          {r.is_active ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                        </button>
                        {!isSupplierContact(r.contact) && (
                          <button onClick={() => renewPartner(r)}
                            title={`Renew — one year at ${SEATS.partner.extraRate} ${RATE_CURRENCY}, invoiced to 3asari3`}
                            className="btn-ghost p-1.5 text-slate-400 hover:text-brand-300">
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => openEdit(r)} title="Edit"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setConfirmDelete(r)} title="Delete"
                          className="btn-ghost p-1.5 text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* What the four renewal icons mean — stated once, under the list. */}
      <div className="flex items-center gap-4 flex-wrap text-[11px] text-slate-500">
        <span className="text-slate-600">Renewal:</span>
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> in date</span>
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> renew within {RENEWAL_WARN_DAYS} days</span>
        <span className="inline-flex items-center gap-1.5"><AlertOctagon className="w-3.5 h-3.5 text-red-400" /> renew within {RENEWAL_URGENT_DAYS} days</span>
        <span className="inline-flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-red-400" /> <span className="line-through decoration-red-400/60">expired, not renewed</span></span>
        <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-slate-400" /> ended, already renewed</span>
      </div>

      {/* ── Add / edit ─────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">
                {modal === 'add' ? 'New subscription' : `Edit subscription — ${contactLabel(modal.contact)}`}
              </h3>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="label">Supplier / Partner *</label>
                {/* A plain <select> meant scrolling a list that grows with every
                    partner taken on. This is the same typeahead the order form
                    uses: type any part of a name, a contact code, a mobile or an
                    account number and the list narrows to it. No "add new" is
                    offered — a subscription is attached to a party that already
                    exists, and creating a contact from here would be an accident
                    waiting to happen. */}
                <ContactCombobox
                  value={form.contact_id}
                  options={parties}
                  onSelect={c => {
                    const own = c?.id ? loginsOf(c.id) : []
                    // One login: it is that login's. Several: the super admin picks.
                    setForm(f => ({ ...f, contact_id: c?.id || '', user_account_id: own.length === 1 ? own[0].id : '' }))
                    setFormErr('')
                  }}
                  placeholder="Type a name, contact code or mobile…"
                />
              </div>

              {/* WHICH LOGIN this subscription lets in (fix160). A partner may
                  have several, each with its own subscription. With one it is
                  chosen for you; with none, the row waits and goes to the first
                  login created from the partner's profile. */}
              {form.contact_id && (() => {
                const own = loginsOf(form.contact_id)
                if (own.length === 0) {
                  return (
                    <p className="text-[11px] text-slate-500">
                      This contact has no login yet. The subscription is held for it and goes to the first
                      login created from its profile.
                    </p>
                  )
                }
                return (
                  <div>
                    <label className="label" htmlFor="sub-login">Login *</label>
                    <select id="sub-login" className="input" value={form.user_account_id || ''}
                      onChange={e => setForm(f => ({ ...f, user_account_id: e.target.value }))}>
                      {own.length > 1 && <option value="">Choose the login…</option>}
                      {own.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.username}{l.status !== 'active' ? ` (${l.status})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })()}

              <div>
                <label className="label">Description</label>
                <input className="input" value={form.description} placeholder="e.g. Standard plan — 12 months"
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Start date *</label>
                  <input type="date" className="input" value={form.start_date}
                    onChange={e => { setForm(f => ({ ...f, start_date: e.target.value })); setFormErr('') }} />
                </div>
                <div>
                  <label className="label flex items-center gap-1"><CalendarRange className="w-3 h-3" /> End date *</label>
                  <input type="date" className="input" value={form.end_date}
                    onChange={e => { setForm(f => ({ ...f, end_date: e.target.value })); setFormErr('') }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <select className="input" value={form.currency}
                    onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-surface-border p-3 space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={form.is_paid}
                    onChange={e => { setForm(f => ({ ...f, is_paid: e.target.checked, is_active: e.target.checked ? f.is_active : false })); setFormErr('') }} />
                  <span className="text-sm text-slate-200">Money received (payment confirmed)</span>
                </label>
                <input className="input" value={form.paid_by_note} placeholder="Payment note — e.g. OMT ref, cash to driver…"
                  onChange={e => setForm(f => ({ ...f, paid_by_note: e.target.value }))} />
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={form.is_active}
                    disabled={!form.is_paid}
                    onChange={e => { setForm(f => ({ ...f, is_active: e.target.checked })); setFormErr('') }} />
                  <span className={`text-sm ${form.is_paid ? 'text-slate-200' : 'text-slate-500'}`}>
                    Activated — the supplier/partner can sign in
                  </span>
                </label>
                <p className="text-[11px] text-slate-500">
                  A 2nd party can only sign in while a subscription is paid, activated and inside its dates.
                </p>
              </div>

              {formErr && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{formErr}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={closeModal} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ────────────────────────────────── */}
      {/* ── Switch on an UNPAID subscription (super admin, fix159) ────────── */}
      {activateFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4"
          onClick={() => setActivateFor(null)}>
          <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">Activate while unpaid</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {contactLabel(activateFor.contact)} has not paid {fmtMoney(activateFor.amount, activateFor.currency)}.
                How long should they be able to sign in?
              </p>
            </div>
            <div className="p-5 space-y-2.5">
              <button type="button" onClick={() => activateUnpaid(activateFor, 'credit')}
                className="w-full text-left rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 p-3 transition-colors">
                <span className="block text-sm font-medium text-amber-200">For the full term — payment due</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Open until {activateFor.end_date || 'the end date'}. It stays marked unpaid and is listed on
                  Due Payments until you record the payment with its reference.
                </span>
              </button>
              <button type="button" onClick={() => activateUnpaid(activateFor, 'trust')}
                className="w-full text-left rounded-lg border border-surface-border hover:bg-surface-hover p-3 transition-colors">
                <span className="block text-sm font-medium text-slate-200">On trust — {UNPAID_GRACE_DAYS} days</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Closes again on its own if the money has not arrived by then.
                </span>
              </button>
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-surface-border">
              <button type="button" className="btn-ghost" onClick={() => setActivateFor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record a payment, with its reference ─────────────────────────── */}
      {payFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-4"
          onClick={() => setPayFor(null)}>
          <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">Record payment</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {contactLabel(payFor.contact)} · {fmtMoney(payFor.amount, payFor.currency)} · {payFor.description || 'Subscription'}
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="pay-date">Received on *</label>
                  <input id="pay-date" type="date" className="input" value={payForm.paid_on}
                    onChange={e => setPayForm(f => ({ ...f, paid_on: e.target.value }))} />
                </div>
                <div>
                  <label className="label" htmlFor="pay-method">Method *</label>
                  <select id="pay-method" className="input" value={payForm.method}
                    onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="pay-ref">Reference *</label>
                <input id="pay-ref" className="input font-mono" autoFocus value={payForm.reference}
                  placeholder="Receipt, transfer or cheque number"
                  onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
              </div>
              <div>
                <label className="label" htmlFor="pay-note">Note</label>
                <input id="pay-note" className="input" value={payForm.note}
                  placeholder="Optional — who handed it over, anything unusual"
                  onChange={e => setPayForm(f => ({ ...f, note: e.target.value }))} />
              </div>
              {payErr && <p className="text-xs text-red-400">{payErr}</p>}
              <p className="text-[11px] text-slate-500">
                Saving marks the subscription paid{payFor.is_active ? '' : ' — switch it on afterwards if it should open now'}.
                It leaves the Due Payments list.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border">
              <button type="button" className="btn-ghost" onClick={() => setPayFor(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={recordPayment}>
                <CheckCircle2 className="w-4 h-4" /> Record payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Due Payments report ─────────────────────────────────────────── */}
      {dueOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[75] p-4"
          onClick={() => setDueOpen(false)}>
          <div className="card w-full max-w-5xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-border">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-fuchsia-300" /> Due payments
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {dueRows.length} subscription{dueRows.length === 1 ? '' : 's'} owing ·{' '}
                  {dueRows.filter(r => ['credit', 'grace'].includes(accessOf(r, today).key)).length} already
                  activated and in use without payment
                  {Object.entries(totalsByCurrency(dueRows)).map(([c, a]) => ` · ${fmtMoney(a, c)}`).join('')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={!dueRows.length}
                  onClick={() => downloadDuePaymentsPdf(
                    dueRows.map(r => ({ ...r, login: loginById.get(r.user_account_id)?.username || '' })),
                    { generatedBy: currentUserName, today })}
                  className="btn-primary disabled:opacity-40">
                  <FileDown className="w-4 h-4" /> Download PDF
                </button>
                <button type="button" className="btn-ghost p-2" onClick={() => setDueOpen(false)} aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-card">
                  <tr className="border-b border-surface-border text-slate-500 text-left">
                    <th className="px-4 py-2 font-medium">Party</th>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                    <th className="px-4 py-2 font-medium">Access</th>
                    <th className="px-4 py-2 font-medium text-right">Owed for</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {dueRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Nothing is owed.</td></tr>
                  ) : dueRows.map(r => {
                    const a = accessOf(r, today)
                    const d = daysOutstanding(r, today)
                    const tone = a.key === 'credit' || a.key === 'grace' ? 'text-amber-300'
                      : a.key === 'grace_over' || a.key === 'expired' ? 'text-red-300' : 'text-slate-400'
                    return (
                      <tr key={r.id} className="border-b border-surface-border/50">
                        <td className="px-4 py-2.5">
                          <span className="text-slate-200 font-medium">{contactLabel(r.contact)}</span>
                          {loginById.get(r.user_account_id) && (
                            <span className="ml-1.5 text-[10px] font-mono text-slate-400">@{loginById.get(r.user_account_id).username}</span>
                          )}
                          <span className="block text-[11px] text-slate-500">{r.description || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{r.start_date} → {r.end_date}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-200 whitespace-nowrap">{fmtMoney(r.amount, r.currency)}</td>
                        <td className={`px-4 py-2.5 ${tone}`}>
                          {a.label}
                          {a.detail && <span className="block text-[11px] text-slate-500">{a.detail}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-400 whitespace-nowrap">
                          {d == null ? '—' : `${d} day${d === 1 ? '' : 's'}`}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button type="button" onClick={() => openPay(r)}
                            className="text-[11px] px-2 py-1 rounded border border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20 whitespace-nowrap">
                            Record payment
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {staleFreeCount > 0 && (
              <p className="px-5 py-2.5 border-t border-surface-border text-[11px] text-slate-500">
                {staleFreeCount} unpaid charge{staleFreeCount === 1 ? ' is' : 's are'} left off: the partner is now inside
                the free {PARTNER_FREE_LIMIT}, so nothing is owed. Those rows read “not due — free seat”.
              </p>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-sm p-5 space-y-4">
            <p className="text-sm text-slate-200">
              Delete the subscription for <span className="font-semibold">{contactLabel(confirmDelete.contact)}</span>?
            </p>
            <p className="text-xs text-slate-500">
              They will no longer be able to sign in unless another active subscription covers them.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={() => remove(confirmDelete)} disabled={busyId === confirmDelete.id}
                className="px-4 py-2 text-sm rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-60">
                {busyId === confirmDelete.id ? <Loader className="w-4 h-4 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
