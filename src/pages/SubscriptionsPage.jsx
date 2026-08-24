import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CreditCard,
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
import { useApp } from '../context/AppContext'
import {
  fetchSubscriptions, saveSubscription, deleteSubscription,
  subscriptionStatus, STATUS_STYLES, contactLabel, todayStr,
  subscriptionsSummary, coveredContactIds, renewalStage, RENEWAL_STAGES,
  daysLeftLabel, RENEWAL_WARN_DAYS, RENEWAL_URGENT_DAYS,
  isTrialSubscription, TRIAL_DAYS, addDays, RATE_CURRENCY,
  rankPartners, scopeFor, SCOPE, PARTNER_FREE_LIMIT, isSupplierContact, isPartnerContact,
} from '../lib/subscriptions'
import { SEATS } from '../lib/billing'
import { fetchAgreementMap, AGREEMENT_STATUS } from '../lib/subscriptionAgreement'
import { downloadAgreementPdf } from '../lib/subscriptionAgreementPdf'
import SearchField from '../components/ui/SearchField'

const CURRENCIES = ['USD', 'LBP', 'EUR']
const STATUS_FILTERS = [
  { value: 'all',         label: 'All' },
  { value: 'active',      label: 'Active' },
  { value: 'unpaid',      label: 'Unpaid' },
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
  contact_id: '', description: '', start_date: todayStr(), end_date: plusMonths(todayStr(), 1),
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
  const canView      = hasRole('super_admin', 'admin')

  const [rows,       setRows]       = useState([])
  const [agreements, setAgreements] = useState(new Map())   // contact_id → agreement row
  const [agreementsOff, setAgreementsOff] = useState(false) // fix128 not run yet
  const [parties,    setParties]    = useState([])          // supplier/partner contacts
  // Contacts that have a login — the only ones that occupy a seat (fix136).
  const [loginIds,   setLoginIds]   = useState(() => new Set())
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
        .select('id, first_name, last_name, company_name, code, contact_types, created_at, is_active')
        .overlaps('contact_types', ['supplier', 'partner'])
        .order('first_name')
      setParties(data ?? [])

      const { data: logins } = await supabase
        .from('user_accounts')
        .select('contact_id')
        .not('contact_id', 'is', null)
      setLoginIds(new Set((logins ?? []).map(l => l.contact_id)))
    })()
  }, [canView])

  const today = todayStr()

  // Which contacts already hold cover reaching today or later — so an old period
  // reads as "renewed" rather than lapsed.
  const covered = useMemo(() => coveredContactIds(rows, today), [rows, today])

  const stageOf = useCallback(
    (r) => renewalStage(r, today, covered.has(r.contact_id)),
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
      if (renewalFilter && renewalStage(r, today, covered.has(r.contact_id)).stage !== renewalFilter) return false
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
  const scopeOf = useCallback((contact) => {
    if (!contact) return { subject: true, scope: SCOPE.supplier, rank: null }
    return scopeFor(contact, partnerRanks.get(contact.id) ?? null)
  }, [partnerRanks])

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

  function openAdd() { setForm(emptyForm()); setFormErr(''); setModal('add') }
  /* Renewing a partner is always the same arrangement — one year at USD 10,
     invoiced to 3asari3 — so the form offers exactly that rather than making
     the super admin retype the licence every time. A supplier renews onto its
     chosen monthly plan instead, which is the party's own decision. */
  function renewPartner(r) {
    const from = r?.end_date && r.end_date >= todayStr() ? addDays(r.end_date, 1) : todayStr()
    setForm({
      contact_id: r.contact_id,
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
    setForm({
      contact_id: r.contact_id ?? '', description: r.description ?? '',
      start_date: r.start_date ?? todayStr(), end_date: r.end_date ?? '',
      amount: r.amount ?? '', currency: r.currency || 'USD',
      is_paid: !!r.is_paid, paid_by_note: r.paid_by_note ?? '', is_active: !!r.is_active,
    })
    setFormErr(''); setModal(r)
  }
  function closeModal() { setModal(null); setForm(emptyForm()); setFormErr('') }

  async function save() {
    if (!form.contact_id)  { setFormErr('Choose the supplier or partner.'); return }
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
    setBusyId(row.id)
    const err = await saveSubscription({ ...row, ...changes }, { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  async function remove(row) {
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
        {isSuperAdmin && (
          <button className="btn-primary ml-auto" onClick={openAdd}>
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
              {summary.unpaid} unpaid · {summary.scheduled} scheduled · {summary.deactivated} off
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
                      {(() => {
                        const sc = scopeOf(r.contact)
                        if (sc.subject) return null
                        return (
                          <span title={sc.scope === SCOPE.partnerFree
                            ? `Partner #${sc.rank} — inside the first ${PARTNER_FREE_LIMIT}, so no subscription is required`
                            : 'Not subject to a subscription'}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-fresh-500/30 bg-fresh-500/10 text-fresh-300 whitespace-nowrap flex-shrink-0">
                            free partner{sc.rank ? ` #${sc.rank}` : ''}
                          </span>
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
                      <button onClick={() => patch(r, { is_paid: !r.is_paid, is_active: r.is_paid ? false : r.is_active })}
                        disabled={busyId === r.id}
                        title={r.is_paid ? 'Money received — click to mark unpaid' : 'Confirm money received'}
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
                        <button onClick={() => patch(r, { is_active: !r.is_active })}
                          disabled={busyId === r.id || (!r.is_paid && !r.is_active)}
                          title={!r.is_paid && !r.is_active
                            ? 'Confirm the payment first'
                            : (r.is_active ? 'Deactivate — blocks their sign-in' : 'Activate — lets them sign in')}
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
                <select className="input" value={form.contact_id}
                  onChange={e => { setForm(f => ({ ...f, contact_id: e.target.value })); setFormErr('') }}>
                  <option value="">— Select the supplier or partner —</option>
                  {parties.map(c => <option key={c.id} value={c.id}>{contactLabel(c)}</option>)}
                </select>
              </div>

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
