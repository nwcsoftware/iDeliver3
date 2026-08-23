import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AppWindow,
  Plus,
  X,
  Shield,
  AlertCircle,
  Pencil,
  Trash2,
  Loader,
  CheckCircle2,
  Circle,
  Wallet,
  CalendarClock,
  RefreshCw,
  Receipt,
  Power,
  PowerOff,
  FileText,
  Download,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { downloadReceipt, openReceipt, receiptNo } from '../lib/subscriptionReceipt'
import {
  CYCLES, cycleLabel, todayStr, daysUntil, nextExpiry, fmtMoney, totalsText,
  paymentSummary, subscriptionStatus, STATUS_STYLES, summarise, REMINDER_DAYS,
  fetchSoftwareSubscriptions, saveSoftwareSubscription, deleteSoftwareSubscription,
  savePayment, deletePayment, installHint,
} from '../lib/softwareSubscriptions'
import SearchField from '../components/ui/SearchField'

const CURRENCIES = ['USD', 'LBP', 'EUR']
const STATUS_FILTERS = [
  { value: 'all',      label: 'All' },
  { value: 'active',   label: 'Active' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'expired',  label: 'Expired' },
  { value: 'unpaid',   label: 'Payment due' },
  { value: 'inactive', label: 'Not in use' },
]

const emptyForm = () => ({
  software_name: '', vendor: '', description: '',
  billing_cycle: 'annual', start_date: todayStr(), expiry_date: '',
  amount: '', currency: 'USD', is_active: true, notes: '',
})

const emptyPayment = (sub) => ({
  subscription_id: sub?.id ?? '', amount: sub?.amount ?? '', currency: sub?.currency || 'USD',
  paid_on: todayStr(), covers_until: nextExpiry(sub?.expiry_date, sub?.billing_cycle),
  method: '', reference: '', notes: '', is_confirmed: false,
})

/* Settings → Software Subscriptions.

   What the company itself pays for: this application, hosting, a mapping key,
   an SMS gateway. The super admin adds subscriptions and records payments;
   admins read the list, the statuses and the totals. Everyone in the office is
   reminded from REMINDER_DAYS before an expiry (see SoftwareSubscriptionAlert)
   unless a confirmed payment already covers past it. */
export default function SoftwareSubscriptionsPage() {
  const { hasRole, currentUser } = useAuth()
  const { COMPANY_ID } = useApp()
  const isSuperAdmin = hasRole('super_admin')
  const canView      = hasRole('super_admin', 'admin')

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [modal,   setModal]   = useState(null)      // 'add' | row
  const [form,    setForm]    = useState(emptyForm())
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const [payFor,   setPayFor]   = useState(null)    // subscription whose payments are open
  const [payForm,  setPayForm]  = useState(null)    // 'add' | payment row being edited
  // The payment just recorded, offered as a receipt until dismissed.
  const [receiptFor, setReceiptFor] = useState(null)
  const [payDraft, setPayDraft] = useState(emptyPayment(null))
  const [paySaving, setPaySaving] = useState(false)
  const [payErr,   setPayErr]   = useState('')
  const [busyId,   setBusyId]   = useState(null)

  const today = todayStr()

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: r, error: e } = await fetchSoftwareSubscriptions(COMPANY_ID)
    setRows(r); setError(installHint(e)); setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { if (canView) load() }, [canView, load])

  // Keep the open payments panel pointing at the freshly loaded row.
  useEffect(() => {
    if (!payFor) return
    const fresh = rows.find(r => r.id === payFor.id)
    if (fresh && fresh !== payFor) setPayFor(fresh)
  }, [rows])   // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (statusFilter !== 'all' && subscriptionStatus(r, today) !== statusFilter) return false
      if (!q) return true
      return [r.software_name, r.vendor, r.description, r.notes]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter, today])

  const totals = useMemo(() => summarise(rows, today), [rows, today])

  if (!canView) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Administrators only</p>
        <p className="text-slate-500 text-sm">You don’t have permission to view software subscriptions.</p>
      </div>
    )
  }

  /* ── subscription form ─────────────────────────────────────── */

  function openAdd() { setForm(emptyForm()); setFormErr(''); setModal('add') }
  function openEdit(r) {
    setForm({
      id: r.id,
      software_name: r.software_name ?? '', vendor: r.vendor ?? '', description: r.description ?? '',
      billing_cycle: r.billing_cycle || 'one_time',
      start_date: r.start_date ?? '', expiry_date: r.expiry_date ?? '',
      amount: r.amount ?? '', currency: r.currency || 'USD',
      is_active: r.is_active !== false, notes: r.notes ?? '',
    })
    setFormErr(''); setModal(r)
  }
  function closeModal() { setModal(null); setForm(emptyForm()); setFormErr('') }

  async function save() {
    if (!form.software_name.trim()) { setFormErr('Give the software a name.'); return }
    if (!form.expiry_date)          { setFormErr('The due / expiry date is required.'); return }
    if (form.start_date && form.expiry_date < form.start_date) {
      setFormErr('The expiry date must be on or after the start date.'); return
    }
    setSaving(true); setFormErr('')
    const err = await saveSoftwareSubscription(form, { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setSaving(false)
    if (err) { setFormErr(err); return }
    closeModal(); load()
  }

  async function remove(row) {
    setBusyId(row.id)
    const err = await deleteSoftwareSubscription(row.id)
    setBusyId(null); setConfirmDelete(null)
    if (err) { setError(err); return }
    if (payFor?.id === row.id) setPayFor(null)
    load()
  }

  async function toggleActive(row) {
    setBusyId(row.id)
    const err = await saveSoftwareSubscription(
      { ...row, is_active: row.is_active === false }, { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  /* Roll the subscription on by one cycle — what you press once a renewal has
     been paid. The expiry moves forward from the current one, never from today,
     so no paid time is lost. */
  async function renew(row) {
    if (!row.expiry_date || row.billing_cycle === 'one_time') return
    setBusyId(row.id)
    const err = await saveSoftwareSubscription(
      { ...row, start_date: row.expiry_date, expiry_date: nextExpiry(row.expiry_date, row.billing_cycle) },
      { companyId: COMPANY_ID, userId: currentUser?.user_id ?? null })
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  /* The name that goes on a receipt as its issuer. */
  const issuerName = () =>
    `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || ''

  /* ── payments ──────────────────────────────────────────────── */

  function openPayments(r) { setPayFor(r); setPayForm(null); setPayErr(''); setReceiptFor(null) }
  function openPayAdd(sub) { setPayDraft(emptyPayment(sub)); setPayForm('add'); setPayErr('') }
  function openPayEdit(p)  {
    setPayDraft({
      id: p.id, subscription_id: p.subscription_id,
      amount: p.amount ?? '', currency: p.currency || 'USD',
      paid_on: p.paid_on ?? todayStr(), covers_until: p.covers_until ?? '',
      method: p.method ?? '', reference: p.reference ?? '', notes: p.notes ?? '',
      is_confirmed: !!p.is_confirmed,
    })
    setPayForm(p); setPayErr('')
  }

  async function storePayment() {
    if (!(Number(payDraft.amount) > 0)) { setPayErr('Enter the amount paid.'); return }
    setPaySaving(true); setPayErr('')
    const err = await savePayment(payDraft, { userId: currentUser?.user_id ?? null })
    setPaySaving(false)
    if (err) { setPayErr(err); return }
    // Offer the receipt for the row we just wrote — the money is fresh in mind
    // and this is when it gets sent on.
    setReceiptFor(savePayment.last || null)
    setPayForm(null); load()
  }

  async function togglePaymentConfirmed(p) {
    setBusyId(p.id)
    const err = await savePayment({ ...p, is_confirmed: !p.is_confirmed }, { userId: currentUser?.user_id ?? null })
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  async function removePayment(p) {
    setBusyId(p.id)
    const err = await deletePayment(p.id)
    setBusyId(null)
    if (err) { setError(err); return }
    load()
  }

  /* ── render ────────────────────────────────────────────────── */

  const dueLabel = (r) => {
    const d = daysUntil(r.expiry_date, today)
    if (d == null) return '—'
    if (d < 0)  return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`
    if (d === 0) return 'Due today'
    return `in ${d} day${d === 1 ? '' : 's'}`
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <AppWindow className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">Software Subscriptions</h2>
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search software, vendor or description…"
            className="input pl-9"
          />
        </div>
        {isSuperAdmin && (
          <button className="btn-primary ml-auto" onClick={openAdd}>
            <Plus className="w-4 h-4" /> New subscription
          </button>
        )}
      </div>

      {/* Totals — subscription value, confirmed payments, outstanding dues */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Subscriptions', value: totalsText(totals.total), icon: Receipt,        cls: 'text-brand-300' },
          { label: 'Paid',          value: totalsText(totals.paid),  icon: CheckCircle2,   cls: 'text-green-300' },
          { label: 'Dues',          value: totalsText(totals.due),   icon: Wallet,         cls: 'text-fuchsia-300' },
        ].map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className="card px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
              <Icon className={`w-3.5 h-3.5 ${cls}`} /> {label}
            </div>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${cls}`}>{value || '—'}</p>
          </div>
        ))}
      </div>

      {/* Status counters + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map(f => {
          const n = f.value === 'all' ? rows.length : totals.counts[f.value]
          return (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                statusFilter === f.value
                  ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                  : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
              {f.label} <span className="text-slate-500">({n})</span>
            </button>
          )
        })}
        {(search || statusFilter !== 'all') && (
          <button onClick={() => { setSearch(''); setStatusFilter('all') }}
            className="btn-ghost py-1.5 px-2.5 text-xs text-slate-400 border border-surface-border">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
        {!isSuperAdmin && (
          <span className="ml-auto text-[11px] text-slate-500">View only — subscriptions are managed by the super admin.</span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Software', 'Billing', 'Expiry', 'Amount', 'Paid', 'Dues', 'Status', ''].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No software subscriptions found</td></tr>
            ) : filtered.map(r => {
              const st  = subscriptionStatus(r, today)
              const cfg = STATUS_STYLES[st]
              const s   = paymentSummary(r)
              const open = payFor?.id === r.id
              return (
                <tr key={r.id} className={`border-b border-surface-border/50 transition-colors ${open ? 'bg-surface-hover/40' : 'hover:bg-surface-hover/30'}`}>
                  <td className="px-4 py-3">
                    <p className="text-slate-100 font-medium">{r.software_name}</p>
                    <p className="text-[11px] text-slate-500">{r.vendor || r.description || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{cycleLabel(r.billing_cycle)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="text-slate-300 text-xs">{r.expiry_date || '—'}</p>
                    <p className={`text-[11px] ${st === 'expired' ? 'text-red-300' : st === 'due_soon' ? 'text-amber-300' : 'text-slate-500'}`}>
                      {dueLabel(r)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-200 tabular-nums whitespace-nowrap">{fmtMoney(r.amount, r.currency)}</td>
                  <td className="px-4 py-3 text-green-300 tabular-nums whitespace-nowrap">
                    {totalsText(s.paidByCurrency) || '—'}
                    {s.pending > 0 && (
                      <span className="block text-[10px] text-amber-300">{s.pending} awaiting confirmation</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 tabular-nums whitespace-nowrap ${s.due > 0 ? 'text-fuchsia-300' : 'text-slate-500'}`}>
                    {s.due > 0 ? fmtMoney(s.due, r.currency) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${cfg.cls}`}>{cfg.label}</span>
                    {s.coveredUntil && s.coveredUntil > (r.expiry_date || '') && (
                      <span className="block mt-1 text-[10px] text-green-300">Renewal paid to {s.coveredUntil}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => (open ? setPayFor(null) : openPayments(r))}
                        title="Payments"
                        className={`btn-ghost p-1.5 ${open ? 'text-brand-300' : 'text-slate-400 hover:text-slate-100'}`}>
                        <Wallet className="w-4 h-4" />
                      </button>
                      {isSuperAdmin && (
                        <>
                          <button onClick={() => renew(r)} disabled={busyId === r.id || r.billing_cycle === 'one_time'}
                            title={r.billing_cycle === 'one_time'
                              ? 'One-time payment — nothing to renew'
                              : `Renew — moves the expiry to ${nextExpiry(r.expiry_date, r.billing_cycle)}`}
                            className="btn-ghost p-1.5 text-slate-400 hover:text-green-300 disabled:opacity-30 disabled:cursor-not-allowed">
                            {busyId === r.id ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          </button>
                          <button onClick={() => toggleActive(r)} disabled={busyId === r.id}
                            title={r.is_active === false ? 'Not in use — click to put back in use' : 'In use — click to retire'}
                            className={`btn-ghost p-1.5 ${r.is_active === false ? 'text-slate-500 hover:text-green-300' : 'text-green-400 hover:text-slate-300'}`}>
                            {r.is_active === false ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                          </button>
                          <button onClick={() => openEdit(r)} title="Edit"
                            className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setConfirmDelete(r)} title="Delete"
                            className="btn-ghost p-1.5 text-slate-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Payments panel for the selected subscription */}
      {payFor && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-border bg-surface-hover/40">
            <Wallet className="w-4 h-4 text-brand-300" />
            <span className="text-sm font-medium text-slate-100">Payments — {payFor.software_name}</span>
            <span className="text-[11px] text-slate-500">
              {fmtMoney(paymentSummary(payFor).paid, payFor.currency)} of {fmtMoney(payFor.amount, payFor.currency)} confirmed
            </span>
            {isSuperAdmin && (
              <button className="btn-primary ml-auto py-1.5 text-xs" onClick={() => openPayAdd(payFor)}>
                <Plus className="w-3.5 h-3.5" /> Record payment
              </button>
            )}
            <button onClick={() => { setPayFor(null); setReceiptFor(null) }} className={`btn-ghost p-1.5 text-slate-500 hover:text-slate-200 ${isSuperAdmin ? '' : 'ml-auto'}`}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {receiptFor && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-green-500/10 border-b border-green-500/25">
              <CheckCircle2 className="w-4 h-4 text-green-300 flex-shrink-0" />
              <span className="text-xs text-green-200">
                Payment recorded — receipt <span className="font-mono">{receiptNo(receiptFor)}</span> is ready for the admins.
              </span>
              <button onClick={() => openReceipt(payFor, receiptFor, { issuedBy: issuerName() })}
                className="btn-ghost ml-auto py-1 px-2.5 text-[11px] border border-green-500/30 text-green-200 hover:bg-green-500/15">
                <FileText className="w-3.5 h-3.5" /> View
              </button>
              <button onClick={() => downloadReceipt(payFor, receiptFor, { issuedBy: issuerName() })}
                className="btn-primary py-1 px-2.5 text-[11px]">
                <Download className="w-3.5 h-3.5" /> Download receipt
              </button>
              <button onClick={() => setReceiptFor(null)} className="btn-ghost p-1 text-slate-500 hover:text-slate-200">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border">
                {['Paid on', 'Amount', 'Covers until', 'Method / reference', 'Confirmed', 'Receipt'].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2 text-slate-500 text-[11px] font-medium uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(payFor.payments ?? []).length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-xs">No payments recorded yet.</td></tr>
              ) : [...payFor.payments]
                .sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)))
                .map(p => (
                  <tr key={p.id} className="border-b border-surface-border/50 hover:bg-surface-hover/30">
                    <td className="px-4 py-2 text-slate-300 text-xs whitespace-nowrap">{p.paid_on}</td>
                    <td className="px-4 py-2 text-slate-200 tabular-nums whitespace-nowrap">{fmtMoney(p.amount, p.currency)}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{p.covers_until || '—'}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs">
                      {[p.method, p.reference].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2">
                      {isSuperAdmin ? (
                        <button onClick={() => togglePaymentConfirmed(p)} disabled={busyId === p.id}
                          title={p.is_confirmed ? 'Confirmed — click to unconfirm' : 'Confirm this payment'}
                          className={`inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2.5 py-1 transition-colors ${
                            p.is_confirmed
                              ? 'bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15'
                              : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15'}`}>
                          {busyId === p.id ? <Loader className="w-3.5 h-3.5 animate-spin" />
                            : p.is_confirmed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                          {p.is_confirmed ? 'Confirmed' : 'Pending'}
                        </button>
                      ) : (
                        <span className={`text-[11px] border rounded px-2 py-0.5 ${
                          p.is_confirmed ? 'bg-green-500/10 text-green-300 border-green-500/30'
                                         : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
                          {p.is_confirmed ? 'Confirmed' : 'Pending'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {/* The receipt is built from this row on demand, so it
                            always matches the record — admins read the same
                            document the super admin issued. */}
                        <button onClick={() => openReceipt(payFor, p, { issuerName: issuerName(), issuedBy: issuerName() })}
                          title={`View receipt ${receiptNo(p)}`}
                          className="btn-ghost p-1.5 text-brand-300 hover:text-brand-200"><FileText className="w-3.5 h-3.5" /></button>
                        <button onClick={() => downloadReceipt(payFor, p, { issuedBy: issuerName() })}
                          title={`Download receipt ${receiptNo(p)}`}
                          className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Download className="w-3.5 h-3.5" /></button>
                        {isSuperAdmin && (<>
                          <button onClick={() => openPayEdit(p)} title="Edit payment"
                            className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => removePayment(p)} disabled={busyId === p.id} title="Delete payment"
                            className="btn-ghost p-1.5 text-slate-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>)}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Subscription form ─────────────────────────────────── */}
      {modal && isSuperAdmin && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border">
              <AppWindow className="w-4 h-4 text-brand-400" />
              <h3 className="text-sm font-semibold text-slate-100">
                {modal === 'add' ? 'New software subscription' : 'Edit subscription'}
              </h3>
              <button onClick={closeModal} className="btn-ghost p-1.5 ml-auto text-slate-500 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="label">Software *</label>
                <input className="input" autoFocus value={form.software_name}
                  onChange={e => setForm(f => ({ ...f, software_name: e.target.value }))}
                  placeholder="iDeliver III, Supabase, Google Maps API…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Vendor</label>
                  <input className="input" value={form.vendor}
                    onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="Who is paid" />
                </div>
                <div>
                  <label className="label">Billing</label>
                  <select className="input" value={form.billing_cycle}
                    onChange={e => setForm(f => ({ ...f, billing_cycle: e.target.value }))}>
                    {CYCLES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Description</label>
                <input className="input" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What this subscription covers" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start date</label>
                  <input type="date" className="input" value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Due / expiry date *</label>
                  <input type="date" className="input" value={form.expiry_date}
                    onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
                </div>
              </div>
              {form.billing_cycle !== 'one_time' && form.start_date && !form.expiry_date && (
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, expiry_date: nextExpiry(f.start_date, f.billing_cycle) }))}
                  className="btn-ghost py-1 px-2 text-[11px] text-brand-300 border border-surface-border">
                  <CalendarClock className="w-3.5 h-3.5" />
                  Use {nextExpiry(form.start_date, form.billing_cycle)} (one {cycleLabel(form.billing_cycle).toLowerCase()} period)
                </button>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount per period</label>
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
              <div>
                <label className="label">Notes</label>
                <textarea rows={2} className="input resize-none" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                In use — a retired subscription is kept for the record but never reminds anyone
              </label>

              {formErr && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{formErr}</p>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Everyone in the office is reminded from {REMINDER_DAYS} days before the expiry date,
                unless a confirmed payment covers past it.
              </p>
            </div>

            <div className="flex items-center gap-2 px-5 py-3 border-t border-surface-border">
              <button onClick={closeModal} className="btn-ghost text-xs border border-surface-border ml-auto">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary text-xs disabled:opacity-50">
                {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment form ──────────────────────────────────────── */}
      {payForm && isSuperAdmin && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPayForm(null)}>
          <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border">
              <Wallet className="w-4 h-4 text-brand-400" />
              <h3 className="text-sm font-semibold text-slate-100">
                {payForm === 'add' ? 'Record a payment' : 'Edit payment'}
              </h3>
              <button onClick={() => setPayForm(null)} className="btn-ghost p-1.5 ml-auto text-slate-500 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount</label>
                  <input type="number" min="0" step="0.01" autoFocus className="input" value={payDraft.amount}
                    onChange={e => setPayDraft(d => ({ ...d, amount: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <select className="input" value={payDraft.currency}
                    onChange={e => setPayDraft(d => ({ ...d, currency: e.target.value }))}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Paid on</label>
                  <input type="date" className="input" value={payDraft.paid_on}
                    onChange={e => setPayDraft(d => ({ ...d, paid_on: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Covers until</label>
                  <input type="date" className="input" value={payDraft.covers_until || ''}
                    onChange={e => setPayDraft(d => ({ ...d, covers_until: e.target.value }))} />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                “Covers until” is what makes this a renewal — a confirmed payment reaching past the
                expiry date stops the reminder.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Method</label>
                  <input className="input" value={payDraft.method}
                    onChange={e => setPayDraft(d => ({ ...d, method: e.target.value }))} placeholder="Card, transfer, cash…" />
                </div>
                <div>
                  <label className="label">Reference</label>
                  <input className="input" value={payDraft.reference}
                    onChange={e => setPayDraft(d => ({ ...d, reference: e.target.value }))} placeholder="Invoice / receipt no." />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={payDraft.is_confirmed}
                  onChange={e => setPayDraft(d => ({ ...d, is_confirmed: e.target.checked }))} />
                Payment confirmed — the money has actually left
              </label>
              {payErr && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">{payErr}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-surface-border">
              <button onClick={() => setPayForm(null)} className="btn-ghost text-xs border border-surface-border ml-auto">Cancel</button>
              <button onClick={storePayment} disabled={paySaving} className="btn-primary text-xs disabled:opacity-50">
                {paySaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {paySaving ? 'Saving…' : 'Save payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ───────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="card w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold text-slate-100">Delete this subscription?</h3>
            </div>
            <p className="text-xs text-slate-400">
              <span className="text-slate-200">{confirmDelete.software_name}</span> and every payment recorded
              against it will be removed. This can’t be undone.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => setConfirmDelete(null)} className="btn-ghost text-xs border border-surface-border ml-auto">Cancel</button>
              <button onClick={() => remove(confirmDelete)} disabled={busyId === confirmDelete.id}
                className="btn-primary text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50">
                {busyId === confirmDelete.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
