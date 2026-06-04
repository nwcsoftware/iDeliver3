import React, { useState } from 'react'
import { Plus, Search, Phone, Mail, CreditCard, Edit2, Trash2, X, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

const emptyForm = {
  first_name:     '',
  last_name:      '',
  mobile:         '',
  whatsapp_number:'',
  email:          '',
  driver_license: '',
  driver_status:  'available',
  city:           '',
  notes:          '',
  petty_cash_limit: 0,
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDutyDate(dateStr, timeStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const t = timeStr ? timeStr.slice(0, 5) : ''
  return `${d} ${MONTHS[Number(m) - 1]} ${y}${t ? ' · ' + t : ''}`
}

export default function DriversPage() {
  const { drivers, orders, fetchDrivers, loading, COMPANY_ID } = useApp()

  // Derive how a driver's duty status should be displayed.
  //  - driver_on_duty must be true (attendance on); otherwise the driver is "Out of duty" (day off).
  //  - On Duty:   has an assigned order that is happening now (today, within pickup→delivery
  //               window) and out for delivery (Picked Up / In Transit).
  //  - Scheduled: has an assigned order whose start time hasn't arrived yet.
  //  - Available: on duty but nothing active or upcoming.
  function dutyStatus(d) {
    if (!d.driver_on_duty) {
      return { label: 'Out of duty', cls: 'bg-red-500/15 text-red-400 border-red-500/30' }
    }

    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const nowHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`

    const assigned = orders.filter(o =>
      o.driver_id === d.id && !o.isclosed && !['cancelled', 'failed'].includes(o.status))

    const active = assigned.find(o => {
      if (!o.scheduled_date || o.scheduled_date.slice(0, 10) !== today) return false
      const from = (o.scheduled_time_from || '').slice(0, 5)
      const to   = (o.scheduled_time_to   || '').slice(0, 5)
      if (!from || !to) return false
      return nowHM >= from && nowHM <= to && ['Picked Up', 'In Transit'].includes(o.delivery_status)
    })
    if (active) return { label: 'On Duty', cls: 'bg-brand-500/15 text-brand-400 border-brand-500/30' }

    const future = assigned
      .filter(o => {
        if (!o.scheduled_date) return false
        const od = o.scheduled_date.slice(0, 10)
        const from = (o.scheduled_time_from || '00:00').slice(0, 5)
        return od > today || (od === today && from > nowHM)
      })
      .sort((a, b) =>
        (a.scheduled_date + (a.scheduled_time_from || '')).localeCompare(b.scheduled_date + (b.scheduled_time_from || '')))[0]
    if (future) return { label: 'Scheduled', sub: fmtDutyDate(future.scheduled_date, future.scheduled_time_from), cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' }

    return { label: 'Available', cls: 'bg-green-500/15 text-green-400 border-green-500/30' }
  }

  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('all')
  const [modal,    setModal]    = useState(null)   // null | 'add' | contact row
  const [form,     setForm]     = useState(emptyForm)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(null)

  const statusFilters = ['all', 'available', 'on_duty', 'off_duty', 'inactive']

  const filtered = drivers.filter(d => {
    const matchSearch = (
      `${d.first_name} ${d.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      d.email?.toLowerCase().includes(search.toLowerCase()) ||
      d.mobile?.includes(search) ||
      d.driver_license?.toLowerCase().includes(search.toLowerCase())
    )
    const matchStatus = filter === 'all' || d.driver_status === filter
    return matchSearch && matchStatus
  })

  function openAdd()    { setForm(emptyForm); setModal('add') }
  function openEdit(d)  { setForm({ ...emptyForm, ...d }); setModal(d) }
  function closeModal() { setModal(null); setForm(emptyForm) }

  async function handleSave() {
    setSaving(true)
    const payload = {
      contact_type:    'driver',
      first_name:      form.first_name.trim(),
      last_name:       form.last_name.trim(),
      mobile:          form.mobile.trim(),
      whatsapp_number: form.whatsapp_number.trim() || null,
      email:           form.email.trim() || null,
      driver_license:  form.driver_license.trim() || null,
      driver_status:   form.driver_status,
      city:            form.city.trim() || null,
      notes:           form.notes.trim() || null,
      petty_cash_limit: Number(form.petty_cash_limit) || 0,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }
    if (modal === 'add') {
      await supabase.from('contacts').insert([payload])
    } else {
      await supabase.from('contacts').update(payload).eq('id', modal.id)
    }
    await fetchDrivers()
    setSaving(false)
    closeModal()
  }

  async function handleDelete(id) {
    setDeleting(id)
    await supabase.from('contacts').delete().eq('id', id)
    await fetchDrivers()
    setDeleting(null)
  }

  function field(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search drivers…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="flex items-center gap-1">
          {statusFilters.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === s ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-hover'
              }`}
            >
              {s === 'on_duty' ? 'On Duty' : s === 'off_duty' ? 'Out of duty' : s}
            </button>
          ))}
        </div>

        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> Add Driver
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Driver', 'Contact', 'License', 'City', 'Status', 'Petty Cash', ''].map(h => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading.drivers ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No drivers found</td></tr>
            ) : filtered.map(driver => (
              <tr key={driver.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-600/30 flex items-center justify-center text-brand-300 text-xs font-bold flex-shrink-0">
                      {driver.first_name?.[0]?.toUpperCase()}{driver.last_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-slate-100 font-medium">{driver.first_name} {driver.last_name}</p>
                      {driver.code && <p className="text-slate-500 text-xs font-mono">{driver.code}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="space-y-0.5">
                    <span className="text-slate-400 flex items-center gap-1.5 text-xs"><Phone className="w-3 h-3" />{driver.mobile}</span>
                    {driver.email && <span className="text-slate-400 flex items-center gap-1.5 text-xs"><Mail className="w-3 h-3" />{driver.email}</span>}
                  </div>
                </td>
                <td className="px-5 py-3">
                  {driver.driver_license
                    ? <span className="text-slate-300 flex items-center gap-1.5 text-xs"><CreditCard className="w-3 h-3 text-slate-500" />{driver.driver_license}</span>
                    : <span className="text-slate-600 text-xs">—</span>
                  }
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">{driver.city || '—'}</td>
                <td className="px-5 py-3">
                  {(() => {
                    const s = dutyStatus(driver)
                    return (
                      <div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${s.cls}`}>{s.label}</span>
                        {s.sub && <p className="text-slate-500 text-[11px] mt-1">{s.sub}</p>}
                      </div>
                    )
                  })()}
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">
                  {driver.petty_cash_limit > 0 ? `$${Number(driver.petty_cash_limit).toFixed(2)}` : '—'}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => openEdit(driver)} className="btn-ghost p-1.5 text-slate-500"><Edit2 className="w-4 h-4" /></button>
                    <button
                      onClick={() => handleDelete(driver.id)}
                      disabled={deleting === driver.id}
                      className="btn-ghost p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
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
              <h2 className="text-base font-semibold text-slate-100">
                {modal === 'add' ? 'Add Driver' : 'Edit Driver'}
              </h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name *</label>
                  <input className="input" value={form.first_name} onChange={e => field('first_name', e.target.value)} placeholder="John" />
                </div>
                <div>
                  <label className="label">Last Name *</label>
                  <input className="input" value={form.last_name} onChange={e => field('last_name', e.target.value)} placeholder="Doe" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Mobile *</label>
                  <input className="input" value={form.mobile} onChange={e => field('mobile', e.target.value)} placeholder="+1 555 000 0000" />
                </div>
                <div>
                  <label className="label">WhatsApp</label>
                  <input className="input" value={form.whatsapp_number} onChange={e => field('whatsapp_number', e.target.value)} placeholder="If different from mobile" />
                </div>
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" value={form.email} onChange={e => field('email', e.target.value)} placeholder="john@example.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Driver License #</label>
                  <input className="input" value={form.driver_license} onChange={e => field('driver_license', e.target.value)} placeholder="DL-12345" />
                </div>
                <div>
                  <label className="label">City</label>
                  <input className="input" value={form.city} onChange={e => field('city', e.target.value)} placeholder="Beirut" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={form.driver_status} onChange={e => field('driver_status', e.target.value)}>
                    <option value="available">Available</option>
                    <option value="on_duty">On Duty</option>
                    <option value="off_duty">Off Duty</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="label">Petty Cash Limit ($)</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.petty_cash_limit} onChange={e => field('petty_cash_limit', e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => field('notes', e.target.value)} placeholder="Optional notes…" />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button className="btn-ghost" onClick={closeModal}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={!form.first_name.trim() || !form.last_name.trim() || !form.mobile.trim() || saving}
              >
                <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Driver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
