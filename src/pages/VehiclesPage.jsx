import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Car, Edit2, X, Check, AlertCircle, History, Power } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { formatMobile } from '../lib/phone'
import { generateVehicleAccountNumber, generateVehicleCode, formatAccountNumber } from '../lib/accountNumber'

const STATUSES = ['active', 'in_maintenance', 'retired', 'sold']
const STATUS_STYLE = {
  active:         'bg-green-500/10  text-green-400  border-green-500/20',
  in_maintenance: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  retired:        'bg-slate-500/10  text-slate-400  border-slate-500/20',
  sold:           'bg-red-500/10    text-red-400    border-red-500/20',
}

const EMPTY_VEHICLE = {
  asset_code: '', type: '', make: '', model: '', year: '',
  plate_number: '', color: '', status: 'active', notes: '',
}

const vehicleLabel = v => [v.make, v.model].filter(Boolean).join(' ') || v.type || '—'

export default function VehiclesPage() {
  const { COMPANY_ID } = useApp()
  const { currentUser } = useAuth()

  const [vehicles, setVehicles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState(null)   // null | 'add' | vehicle row
  const [form,     setForm]     = useState(EMPTY_VEHICLE)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [history,  setHistory]  = useState(null)   // { vehicle, rows } | null
  const [assignedDrivers, setAssignedDrivers] = useState([])   // assigned drivers for current vehicle
  const [drivers, setDrivers] = useState([])   // available drivers for assignment
  const [assignmentModal, setAssignmentModal] = useState(null)   // null | 'add' | assignment object
  const [assignmentForm, setAssignmentForm] = useState({ driver_id: '', start_date: '', end_date: '' })
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [assignmentError, setAssignmentError] = useState('')

  const fetchVehicles = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('vehicles').select('*').order('asset_code')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    setVehicles(data ?? [])
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { fetchVehicles() }, [fetchVehicles])

  const visible = vehicles.filter(v => {
    const s = search.trim().toLowerCase()
    return !s || [v.asset_code, v.make, v.model, v.plate_number, v.type]
      .some(x => String(x ?? '').toLowerCase().includes(s))
  })

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })); setError('') }
  async function openAdd() {
    setForm(EMPTY_VEHICLE); setError(''); setModal('add')
    try {
      const [code, num] = await Promise.all([
        generateVehicleCode(COMPANY_ID),
        generateVehicleAccountNumber(COMPANY_ID),
      ])
      setForm(f => ({ ...f, asset_code: code, vehicle_account_number: num }))
    } catch { /* silently ignore — user can still save without auto-generated values */ }
  }
  function openEdit(v) { 
    setForm({ ...EMPTY_VEHICLE, ...v, year: v.year ?? '' })
    setError('')
    setModal(v)
    fetchAssignedDrivers(v.id)
  }
  
  async function fetchAssignedDrivers(vehicleId) {
    try {
      const { data } = await supabase
        .from('driver_vehicle_assignments')
        .select('id, driver_id, start_date, end_date, driver:contacts!driver_id(first_name, last_name, code, mobile)')
        .eq('vehicle_id', vehicleId)
        .order('start_date', { ascending: false })
      setAssignedDrivers(data ?? [])
    } catch {
      setAssignedDrivers([])
    }
  }
  
  async function fetchAvailableDrivers() {
    try {
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, code')
        .eq('contact_type', 'driver')
        .order('first_name')
      setDrivers(data ?? [])
    } catch {
      setDrivers([])
    }
  }
  
  function openAddAssignment() {
    setAssignmentForm({ driver_id: '', start_date: '', end_date: '' })
    setAssignmentError('')
    setAssignmentModal('add')
    fetchAvailableDrivers()
  }
  
  function openEditAssignment(a) {
    setAssignmentForm({ 
      driver_id: a.driver_id,
      start_date: a.start_date || '',
      end_date: a.end_date || ''
    })
    setAssignmentError('')
    setAssignmentModal(a)
    fetchAvailableDrivers()
  }
  
  function closeAssignmentModal() {
    setAssignmentModal(null)
    setAssignmentForm({ driver_id: '', start_date: '', end_date: '' })
    setAssignmentError('')
  }
  
  async function handleSaveAssignment() {
    if (!assignmentForm.driver_id) return setAssignmentError('Please select a driver.')
    if (!assignmentForm.start_date) return setAssignmentError('Start date is required.')
    
    setAssignmentSaving(true)
    setAssignmentError('')
    
    try {
      if (assignmentModal === 'add') {
        const { error: e } = await supabase
          .from('driver_vehicle_assignments')
          .insert([{
            vehicle_id: modal.id,
            driver_id: assignmentForm.driver_id,
            start_date: assignmentForm.start_date,
            end_date: assignmentForm.end_date || null
          }])
        if (e) throw e
      } else {
        const { error: e } = await supabase
          .from('driver_vehicle_assignments')
          .update({
            driver_id: assignmentForm.driver_id,
            start_date: assignmentForm.start_date,
            end_date: assignmentForm.end_date || null
          })
          .eq('id', assignmentModal.id)
        if (e) throw e
      }
      await fetchAssignedDrivers(modal.id)
      closeAssignmentModal()
    } catch (e) {
      setAssignmentError(e?.message || String(e))
    } finally {
      setAssignmentSaving(false)
    }
  }
  
  async function handleDeleteAssignment(assignmentId) {
    if (!window.confirm('Remove this driver assignment?')) return
    
    try {
      const { error: e } = await supabase
        .from('driver_vehicle_assignments')
        .delete()
        .eq('id', assignmentId)
      if (e) throw e
      await fetchAssignedDrivers(modal.id)
    } catch (e) {
      setAssignmentError(e?.message || String(e))
    }
  }
  function closeModal() { 
    setModal(null)
    setForm(EMPTY_VEHICLE)
    setError('')
    setAssignedDrivers([])
    closeAssignmentModal()
  }

  async function handleSave() {
    setSaving(true); setError('')
    let vehicleCode = form.asset_code.trim()
    
    // Auto-generate vehicle code if empty (new vehicles only)
    if (!vehicleCode && modal === 'add') {
      try {
        vehicleCode = await generateVehicleCode(COMPANY_ID)
      } catch {
        setSaving(false)
        return setError('Failed to generate vehicle code. Please try again.')
      }
    }
    
    if (!vehicleCode) {
      setSaving(false)
      return setError('Vehicle code is required.')
    }
    
    const payload = {
      asset_code:   vehicleCode,
      type:         form.type?.trim()   || null,
      make:         form.make?.trim()   || null,
      model:        form.model?.trim()  || null,
      year:         Number(form.year)   || null,
      plate_number: form.plate_number?.trim() || null,
      color:        form.color?.trim()  || null,
      status:       form.status,
      notes:        form.notes?.trim()  || null,
      vehicle_account_number: form.vehicle_account_number || null,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }
    try {
      if (modal === 'add') {
        const { error: e } = await supabase.from('vehicles').insert([{ ...payload, created_by: currentUser?.user_id || null }])
        if (e) throw e
      } else {
        const { error: e } = await supabase.from('vehicles').update(payload).eq('id', modal.id)
        if (e) throw e
      }
      await fetchVehicles(); closeModal()
    } catch (e) {
      const msg = e?.message || String(e)
      setError(/duplicate key|unique/i.test(msg) ? 'That vehicle code or plate number is already used.' : msg)
    } finally {
      setSaving(false)
    }
  }

  async function openHistory(v) {
    setHistory({ vehicle: v, rows: null })
    const { data } = await supabase
      .from('driver_vehicle_assignments')
      .select('id, start_date, end_date, driver:contacts!driver_id(first_name, last_name, code, mobile)')
      .eq('vehicle_id', v.id)
      .order('start_date', { ascending: false })
    setHistory({ vehicle: v, rows: data ?? [] })
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Car className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Vehicles</h1>
            <p className="text-xs text-slate-500 mt-0.5">{vehicles.length} total</p>
          </div>
        </div>
        <div className="relative flex-1 max-w-sm ml-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search code, make, model, plate…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary ml-auto" onClick={openAdd}>
          <Plus className="w-4 h-4" /> New Vehicle
        </button>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              {['Code', 'Vehicle', 'Plate', 'Year', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No vehicles found</td></tr>
            ) : visible.map(v => (
              <tr key={v.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-brand-400 bg-brand-600/10 border border-brand-600/20 px-2 py-0.5 rounded">{v.asset_code}</span>
                </td>
                <td className="px-4 py-3 text-slate-200 text-xs">{vehicleLabel(v)}</td>
                <td className="px-4 py-3 text-slate-400 text-xs font-mono">{v.plate_number ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{v.year ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border capitalize ${STATUS_STYLE[v.status] ?? STATUS_STYLE.retired}`}>
                    {String(v.status ?? '').replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openHistory(v)} className="btn-ghost p-1.5 text-slate-500 hover:text-brand-300" title="Assigned driver history">
                      <History className="w-4 h-4" />
                    </button>
                    <button onClick={() => openEdit(v)} className="btn-ghost p-1.5 text-slate-500" title="Edit">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit modal */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg p-6 space-y-4 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">{modal === 'add' ? 'New Vehicle' : `Edit — ${modal.asset_code}`}</h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-fuchsia-300">Vehicle Code *</label>
                  <input className="input font-mono bg-surface-hover/50 text-slate-400 cursor-not-allowed" value={form.asset_code} readOnly placeholder="Auto-generated on save…" />
                  <p className="text-[10px] text-slate-600 mt-0.5">Auto-generated · read-only</p>
                </div>
                <div>
                  <label className="label">Plate Number</label>
                  <input className="input font-mono" value={form.plate_number} onChange={e => fld('plate_number', e.target.value)} placeholder="ABC-1234" />
                </div>
              </div>
              <div>
                <label className="label text-brand-400">Vehicle Account Number</label>
                <input className="input font-mono bg-surface-hover/50 text-slate-400 cursor-not-allowed" value={form.vehicle_account_number ? formatAccountNumber(form.vehicle_account_number) : ''}
                  readOnly placeholder="Auto-generated on save…" />
                <p className="text-[10px] text-slate-600 mt-0.5">Auto-generated · read-only</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Make</label>
                  <input className="input" value={form.make} onChange={e => fld('make', e.target.value)} placeholder="Toyota" />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input className="input" value={form.model} onChange={e => fld('model', e.target.value)} placeholder="Hiace" />
                </div>
                <div>
                  <label className="label">Year</label>
                  <input type="number" className="input" value={form.year} onChange={e => fld('year', e.target.value)} placeholder="2022" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Type</label>
                  <input className="input" value={form.type} onChange={e => fld('type', e.target.value)} placeholder="Van / Motorcycle…" />
                </div>
                <div>
                  <label className="label">Color</label>
                  <input className="input" value={form.color} onChange={e => fld('color', e.target.value)} placeholder="White" />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={form.status} onChange={e => fld('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => fld('notes', e.target.value)} placeholder="Optional notes…" />
              </div>
              {modal !== 'add' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="label text-brand-400">Assigned Drivers</label>
                    <button onClick={openAddAssignment} className="btn-primary py-1 px-3 text-xs flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Assign Driver
                    </button>
                  </div>
                  <div className="border border-surface-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                          <th className="text-left px-3 py-2">Driver Code</th>
                          <th className="text-left px-3 py-2">Driver Name</th>
                          <th className="text-left px-3 py-2">Start Date</th>
                          <th className="text-left px-3 py-2">End Date</th>
                          <th className="text-right px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignedDrivers.length === 0 ? (
                          <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">No drivers assigned yet</td></tr>
                        ) : assignedDrivers.map(r => (
                          <tr key={r.id} className="border-t border-surface-border/50">
                            <td className="px-3 py-2 font-mono text-brand-400">{r.driver?.code ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-200">
                              {r.driver ? `${r.driver.first_name ?? ''} ${r.driver.last_name ?? ''}`.trim() || '—' : '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-400">{r.start_date ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-400">{r.end_date ?? '—'}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => openEditAssignment(r)} className="btn-ghost p-1 text-slate-500 hover:text-blue-400" title="Edit">
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button onClick={() => handleDeleteAssignment(r.id)} className="btn-ghost p-1 text-slate-500 hover:text-red-400" title="Delete">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving || !form.asset_code.trim()}>
                <Check className="w-4 h-4" /> {saving ? 'Saving…' : modal === 'add' ? 'Create Vehicle' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment modal */}
      {assignmentModal !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">{assignmentModal === 'add' ? 'Assign Driver' : 'Edit Assignment'}</h2>
              <button onClick={closeAssignmentModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Driver *</label>
                <select className="input" value={assignmentForm.driver_id} 
                  onChange={e => { setAssignmentForm(f => ({ ...f, driver_id: e.target.value })); setAssignmentError('') }}>
                  <option value="">Select a driver…</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.code ? `${d.code} - ` : ''}{d.first_name ?? ''} {d.last_name ?? ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Start Date *</label>
                <input type="date" className="input" value={assignmentForm.start_date}
                  onChange={e => { setAssignmentForm(f => ({ ...f, start_date: e.target.value })); setAssignmentError('') }} />
              </div>
              <div>
                <label className="label">End Date (Optional)</label>
                <input type="date" className="input" value={assignmentForm.end_date}
                  onChange={e => setAssignmentForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            {assignmentError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{assignmentError}
              </div>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <button className="btn-ghost" onClick={closeAssignmentModal}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveAssignment} disabled={assignmentSaving || !assignmentForm.driver_id}>
                <Check className="w-4 h-4" /> {assignmentSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assigned-driver history */}
      {history && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-lg p-6 space-y-4 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <History className="w-4 h-4 text-brand-400" /> Assigned Driver History
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-mono text-brand-400">{history.vehicle.asset_code}</span> · {vehicleLabel(history.vehicle)}
                </p>
              </div>
              <button onClick={() => setHistory(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="border border-surface-border rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                    <th className="text-left px-3 py-2">Driver</th>
                    <th className="text-left px-3 py-2">Code</th>
                    <th className="text-left px-3 py-2">Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows === null ? (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
                  ) : history.rows.length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-600">No drivers have been assigned to this vehicle yet.</td></tr>
                  ) : history.rows.map(r => (
                    <tr key={r.id} className="border-t border-surface-border/50">
                      <td className="px-3 py-2 text-slate-200">
                        {r.driver ? `${r.driver.first_name ?? ''} ${r.driver.last_name ?? ''}`.trim() || '—' : '—'}
                        {r.driver?.mobile && <span className="block text-[10px] text-slate-500">{formatMobile(r.driver.mobile)}</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-400">{r.driver?.code ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-400">{r.start_date ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
