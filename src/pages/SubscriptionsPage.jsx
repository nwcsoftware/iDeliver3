import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CreditCard, Plus, Search, X, Loader, AlertCircle, Pencil, Trash2, Shield,
  CheckCircle2, Circle, Power, PowerOff, Building, Handshake, CalendarRange,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  fetchSubscriptions, saveSubscription, deleteSubscription,
  subscriptionStatus, STATUS_STYLES, contactLabel, todayStr,
} from '../lib/subscriptions'

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

const fmtMoney = (v, c) =>
  `${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`

/* Settings → Subscriptions.

   Suppliers and partners can only sign in while they hold a subscription that
   is active, paid and in date. The super admin creates/edits/deletes them and
   confirms payment; admins may view, search and filter the list only. */
export default function SubscriptionsPage() {
  const { hasRole, currentUser } = useAuth()
  const { COMPANY_ID } = useApp()
  const isSuperAdmin = hasRole('super_admin')
  const canView      = hasRole('super_admin', 'admin')

  const [rows,    setRows]    = useState([])
  const [parties, setParties] = useState([])     // supplier/partner contacts
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [partyFilter,  setPartyFilter]  = useState('all')

  const [modal,   setModal]   = useState(null)   // 'add' | row
  const [form,    setForm]    = useState(emptyForm())
  const [saving,  setSaving]  = useState(false)
  const [formErr, setFormErr] = useState('')
  const [busyId,  setBusyId]  = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: r, error: e } = await fetchSubscriptions(COMPANY_ID)
    setRows(r)
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
        .select('id, first_name, last_name, company_name, code, contact_types')
        .overlaps('contact_types', ['supplier', 'partner'])
        .order('first_name')
      setParties(data ?? [])
    })()
  }, [canView])

  const today = todayStr()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      const st = subscriptionStatus(r, today)
      if (statusFilter !== 'all' && st !== statusFilter) return false
      if (partyFilter !== 'all' && !(r.contact?.contact_types ?? []).includes(partyFilter)) return false
      if (!q) return true
      return [contactLabel(r.contact), r.description, r.contact?.mobile]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, statusFilter, partyFilter, today])

  // Headline counters over the whole list (not the filtered view).
  const counts = useMemo(() => {
    const c = { active: 0, unpaid: 0, expired: 0 }
    for (const r of rows) {
      const st = subscriptionStatus(r, today)
      if (c[st] != null) c[st] += 1
    }
    return c
  }, [rows, today])

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

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">Subscriptions</h2>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search supplier, partner or description…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {isSuperAdmin && (
          <button className="btn-primary ml-auto" onClick={openAdd}>
            <Plus className="w-4 h-4" /> New subscription
          </button>
        )}
      </div>

      {/* Counters */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="px-2.5 py-1 rounded-lg border bg-green-500/10 text-green-300 border-green-500/30">
          {counts.active} active
        </span>
        <span className="px-2.5 py-1 rounded-lg border bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30">
          {counts.unpaid} unpaid
        </span>
        <span className="px-2.5 py-1 rounded-lg border bg-red-500/10 text-red-300 border-red-500/30">
          {counts.expired} expired
        </span>
        {!isSuperAdmin && (
          <span className="ml-auto text-[11px] text-slate-500">View only — subscriptions are managed by the super admin.</span>
        )}
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
        {(search || statusFilter !== 'all' || partyFilter !== 'all') && (
          <button onClick={() => { setSearch(''); setStatusFilter('all'); setPartyFilter('all') }}
            className="btn-ghost py-1.5 px-2.5 text-xs text-slate-400 border border-surface-border">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
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
              {['Supplier / Partner', 'Description', 'Start', 'End', 'Amount', 'Payment', 'Status', ...(isSuperAdmin ? [''] : [])].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No subscriptions found</td></tr>
            ) : filtered.map(r => {
              const st  = subscriptionStatus(r, today)
              const cfg = STATUS_STYLES[st] ?? STATUS_STYLES.deactivated
              const Icon = partyIcon(r.contact)
              return (
                <tr key={r.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-100 font-medium">{contactLabel(r.contact)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[16rem] truncate">{r.description || '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{r.start_date}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{r.end_date}</td>
                  <td className="px-4 py-3 text-slate-200 tabular-nums whitespace-nowrap">{fmtMoney(r.amount, r.currency)}</td>
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
