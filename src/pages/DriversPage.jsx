import React, { useState, useEffect } from 'react'
import {
  Plus, Search, Phone, Mail, CreditCard, Edit2, Trash2, Power, X, Check,
  AlertCircle, ChevronRight, KeyRound, Copy, Eye, EyeOff,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { generateAccountNumber, formatAccountNumber, insertContactWithUniqueCode } from '../lib/accountNumber'
import { formatMobile } from '../lib/phone'
import MobileInput from '../components/MobileInput'

const CURRENCIES = ['USD', 'LBP', 'EUR']

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
  account_number: '',
}

// Reject if a Supabase call doesn't settle in time, so the form never sticks on "Saving…".
function withTimeout(thenable, ms, label) {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out — check your connection and try again.`)), ms)),
  ])
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
  const { currentUser, hasRole } = useAuth()
  const isAdmin = hasRole('super_admin', 'admin')
  const currentUserName = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || 'You'

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
  const [toggling, setToggling] = useState(null)
  const [codeNotice, setCodeNotice] = useState(null)   // { code, account_number, name } after a new driver is created
  const [pettyCash,    setPettyCash]    = useState([]) // driver_petty_cash rows in the sub-form
  const [origPettyIds, setOrigPettyIds] = useState([]) // ids loaded on edit, to detect removals
  const [vehicles,      setVehicles]      = useState([]) // vehicles list for the assignment picker
  const [assignments,   setAssignments]   = useState([]) // driver_vehicle_assignments rows
  const [origAssignIds, setOrigAssignIds] = useState([])
  const [latestVehicle, setLatestVehicle] = useState({}) // driver_id -> "code | make | model | color"
  const [pettyTotals,   setPettyTotals]   = useState({}) // driver_id -> { USD, LBP, EUR }
  // Driver "User Account & Security" collapsible section (admin only).
  const [credOpen,     setCredOpen]     = useState(false)
  const [resetting,    setResetting]    = useState(false)
  const [usernameInput, setUsernameInput] = useState('') // admin-set driver username (editable)
  const [pwInput,      setPwInput]      = useState('')   // admin-entered new password
  const [showPw,       setShowPw]       = useState(false)
  const [editingPw,    setEditingPw]    = useState(false) // true once "Set Password" is pressed (new pw is visible)
  const [newPassword,  setNewPassword]  = useState('')   // confirmation shown after a save
  const [credError,    setCredError]    = useState('')

  const PW_MIN = 12

  // Vehicles available to assign to a driver.
  useEffect(() => {
    let q = supabase.from('vehicles').select('id, asset_code, make, model, type').order('asset_code')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    q.then(({ data }) => setVehicles(data ?? []))
  }, [COMPANY_ID])

  // Latest assigned vehicle per driver (most recent assignment) for the list.
  useEffect(() => {
    supabase
      .from('driver_vehicle_assignments')
      .select('driver_id, start_date, created_at, vehicle:vehicles(asset_code, make, model, color)')
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const map = {}
        for (const a of (data ?? [])) {
          // First row per driver is the latest due to the ordering above.
          if (!map[a.driver_id] && a.vehicle) {
            map[a.driver_id] = [a.vehicle.asset_code, a.vehicle.make, a.vehicle.model, a.vehicle.color]
              .filter(Boolean).join(' | ')
          }
        }
        setLatestVehicle(map)
      })
  }, [drivers])

  // Per-currency petty cash totals per driver (sum of allocations, matching the
  // driver form's per-currency totals).
  useEffect(() => {
    supabase
      .from('driver_petty_cash')
      .select('driver_id, amount, currency')
      .then(({ data }) => {
        const map = {}
        for (const r of (data ?? [])) {
          const cur = r.currency || 'USD'
          if (!map[r.driver_id]) map[r.driver_id] = {}
          map[r.driver_id][cur] = (map[r.driver_id][cur] || 0) + (Number(r.amount) || 0)
        }
        setPettyTotals(map)
      })
  }, [drivers])

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

  function resetCred(username = '') {
    setCredOpen(false); setUsernameInput(username); setPwInput(''); setShowPw(false)
    setEditingPw(false); setNewPassword(''); setCredError(''); setResetting(false)
  }

  function openAdd() {
    setForm(emptyForm); setModal('add'); setPettyCash([]); setOrigPettyIds([]); setAssignments([]); setOrigAssignIds([]); resetCred()
    // Pre-generate the driver account number so it's visible before saving.
    generateAccountNumber('driver')
      .then(acct => setForm(f => ({ ...f, account_number: acct })))
      .catch(() => {})
  }
  async function openEdit(d) {
    setForm({ ...emptyForm, ...d }); setModal(d); resetCred(d.username || '')
    // Load this driver's petty-cash entries (creator username shown read-only).
    const { data } = await supabase
      .from('driver_petty_cash')
      .select('id, transaction_date, amount, currency, created_by, creator:user_accounts!created_by(username)')
      .eq('driver_id', d.id)
      .order('transaction_date', { ascending: false })
    const rows = (data ?? []).map(r => ({
      _id:              r.id,
      transaction_date: r.transaction_date ? r.transaction_date.slice(0, 10) : '',
      amount:           r.amount ?? '',
      currency:         r.currency ?? 'USD',
      created_by:       r.created_by,
      created_by_name:  r.creator?.username || '—',
    }))
    setPettyCash(rows); setOrigPettyIds(rows.map(r => r._id))
    // Load this driver's vehicle assignments.
    const { data: aData } = await supabase
      .from('driver_vehicle_assignments')
      .select('id, vehicle_id, start_date')
      .eq('driver_id', d.id)
      .order('start_date', { ascending: false })
    const aRows = (aData ?? []).map(a => ({
      _id: a.id, vehicle_id: a.vehicle_id, start_date: a.start_date ? a.start_date.slice(0, 10) : '',
    }))
    setAssignments(aRows); setOrigAssignIds(aRows.map(a => a._id))
  }
  function closeModal() {
    setModal(null); setForm(emptyForm)
    setPettyCash([]); setOrigPettyIds([]); setAssignments([]); setOrigAssignIds([]); resetCred()
  }

  /* ── driver credentials (admin sets username + password) ──────
     Drivers have no self-registration flow, so the admin sets both. The old
     password is never shown — only the new one the admin just entered. */
  function startPasswordReset() {
    if (!usernameInput.trim()) { setCredError('Enter a username for this driver first.'); return }
    if (!window.confirm(
      '⚠ Set a new password for this driver?\n\n' +
      'A new password will be generated (you can also type your own). When you save it, ' +
      'the driver’s current password will stop working immediately — make sure to share the new one with them.'
    )) return
    setEditingPw(true); setPwInput(generatePassword(PW_MIN)); setShowPw(true); setNewPassword(''); setCredError('')
  }
  function cancelPasswordReset() {
    setEditingPw(false); setPwInput(''); setShowPw(false); setCredError('')
  }

  async function saveDriverCredentials() {
    if (!isAdmin || !modal || modal === 'add') return
    const uname = usernameInput.trim()
    const pwd = pwInput
    if (uname.length < 3)      { setCredError('Username must be at least 3 characters.'); return }
    if (pwd.length < PW_MIN)   { setCredError(`Password must be at least ${PW_MIN} characters.`); return }
    setResetting(true); setCredError(''); setNewPassword('')
    try {
      const { data, error: e } = await supabase.rpc('admin_set_driver_credentials', {
        p_contact_id:   modal.id,
        p_username:     uname,
        p_new_password: pwd,
      })
      if (e) throw e
      const username = data?.[0]?.username
      setNewPassword(pwd)            // confirm what was set (copyable, shown once)
      setPwInput(''); setShowPw(false); setEditingPw(false)
      if (username) setUsernameInput(username)
      await fetchDrivers()
    } catch (e) {
      const msg = e?.message || String(e)
      if      (/USERNAME_TAKEN/.test(msg))      setCredError('That username is already used by another contact.')
      else if (/USERNAME_TOO_SHORT/.test(msg))  setCredError('Username must be at least 3 characters.')
      else if (/USERNAME_REQUIRED/.test(msg))   setCredError('Enter a username first.')
      else if (/PASSWORD_TOO_SHORT/.test(msg))  setCredError(`Password must be at least ${PW_MIN} characters.`)
      else if (/DRIVER_NOT_FOUND/.test(msg))    setCredError('This driver could not be found.')
      else if (/admin_set_driver_credentials/.test(msg)) setCredError('Driver login is not configured in Supabase yet — run supabase-fix54.sql.')
      else setCredError(msg)
    } finally {
      setResetting(false)
    }
  }

  /* ── petty cash sub-form ─────────────────────────────────── */
  function addPetty() {
    setPettyCash(p => [...p, {
      transaction_date: new Date().toISOString().slice(0, 10),
      amount: '', currency: 'USD',
      created_by: currentUser?.user_id || null,
      created_by_name: currentUserName,
      _key: Date.now(),
    }])
  }
  function removePetty(i) { setPettyCash(p => p.filter((_, idx) => idx !== i)) }
  function setPetty(i, k, v) { setPettyCash(p => { const n = [...p]; n[i] = { ...n[i], [k]: v }; return n }) }

  // Persist the petty-cash rows for a driver: delete removed, update existing, insert new.
  async function syncPettyCash(driverId) {
    const keepIds  = pettyCash.filter(p => p._id).map(p => p._id)
    const toDelete = origPettyIds.filter(id => !keepIds.includes(id))
    if (toDelete.length) {
      const { error } = await supabase.from('driver_petty_cash').delete().in('id', toDelete)
      if (error) throw error
    }
    for (const p of pettyCash) {
      const amt = Number(p.amount)
      if (!amt) continue   // skip blank rows
      const row = {
        transaction_date: p.transaction_date || new Date().toISOString().slice(0, 10),
        amount:           amt,
        currency:         p.currency || 'USD',
      }
      if (p._id) {
        const { error } = await supabase.from('driver_petty_cash').update(row).eq('id', p._id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('driver_petty_cash').insert([{
          driver_id:        driverId,
          transaction_type: 'allocation',
          created_by:       currentUser?.user_id || null,
          ...row,
        }])
        if (error) throw error
      }
    }
  }

  /* ── assigned vehicles sub-form ──────────────────────────── */
  function addAssign() {
    setAssignments(a => [...a, { vehicle_id: '', start_date: new Date().toISOString().slice(0, 10), _key: Date.now() }])
  }
  function removeAssign(i) { setAssignments(a => a.filter((_, idx) => idx !== i)) }
  function setAssign(i, k, v) { setAssignments(a => { const n = [...a]; n[i] = { ...n[i], [k]: v }; return n }) }

  // Persist vehicle assignments for a driver: delete removed, update existing, insert new.
  async function syncAssignments(driverId) {
    const keepIds  = assignments.filter(a => a._id).map(a => a._id)
    const toDelete = origAssignIds.filter(id => !keepIds.includes(id))
    if (toDelete.length) {
      const { error } = await supabase.from('driver_vehicle_assignments').delete().in('id', toDelete)
      if (error) throw error
    }
    for (const a of assignments) {
      if (!a.vehicle_id) continue   // skip rows with no vehicle selected
      const row = { vehicle_id: a.vehicle_id, start_date: a.start_date || new Date().toISOString().slice(0, 10) }
      if (a._id) {
        const { error } = await supabase.from('driver_vehicle_assignments').update(row).eq('id', a._id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('driver_vehicle_assignments').insert([{
          driver_id:  driverId,
          created_by: currentUser?.user_id || null,
          ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
          ...row,
        }])
        if (error) throw error
      }
    }
  }

  async function handleSave() {
    setSaving(true)
    // Auto-generate the driver account number before saving (kept if already set).
    let accountNumber = form.account_number
    if (!accountNumber) {
      try { accountNumber = await generateAccountNumber('driver') } catch { /* leave blank */ }
    }
    // Null-safe: editing an existing driver spreads DB rows whose optional fields
    // can be null, so guard every .trim() (a null.trim() used to throw and hang the form).
    const payload = {
      contact_type:    'driver',
      first_name:      (form.first_name || '').trim(),
      last_name:       (form.last_name  || '').trim(),
      mobile:          (form.mobile     || '').trim(),
      whatsapp_number: form.whatsapp_number?.trim() || null,
      email:           form.email?.trim()           || null,
      driver_license:  form.driver_license?.trim()  || null,
      driver_status:   form.driver_status,
      city:            form.city?.trim()            || null,
      notes:           form.notes?.trim()           || null,
      account_number:  accountNumber || null,
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
    }
    try {
      if (modal === 'add') {
        // Generates a unique contacts.code (e.g. DRV-000123), retrying on
        // duplicate-code collisions; read it back to show the user.
        const { data, error } = await withTimeout(
          insertContactWithUniqueCode(payload, 'driver', 'id,code,account_number,first_name,last_name'),
          30000, 'Saving the driver',
        )
        if (error) throw error
        await syncPettyCash(data.id)
        await syncAssignments(data.id)
        await fetchDrivers()
        closeModal()
        setCodeNotice({
          code: data?.code,
          account_number: data?.account_number,
          name: `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim(),
        })
      } else {
        // `code` is intentionally not in the payload (it stays locked).
        const { error } = await withTimeout(
          supabase.from('contacts').update(payload).eq('id', modal.id),
          15000, 'Saving the driver',
        )
        if (error) throw error
        await syncPettyCash(modal.id)
        await syncAssignments(modal.id)
        await fetchDrivers()
        closeModal()
      }
    } catch (e) {
      const msg = e?.message || String(e)
      if (/duplicate key|unique/i.test(msg)) {
        alert('Could not save: that mobile number is already used by another contact.')
      } else {
        alert(`Could not save driver: ${msg}`)
      }
    } finally {
      setSaving(false)
    }
  }

  // Activate / deactivate a driver — mirrors the customers list (toggles the
  // shared contacts.is_active flag) instead of hard-deleting the record.
  async function toggleActive(driver) {
    setToggling(driver.id)
    await supabase.from('contacts').update({ is_active: !driver.is_active }).eq('id', driver.id)
    await fetchDrivers()
    setToggling(null)
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
              {['Driver', 'Contact', 'License', 'Vehicle', 'City', 'Status', 'Petty Cash', ''].map(h => (
                <th key={h} className="text-left px-5 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading.drivers ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">No drivers found</td></tr>
            ) : filtered.map(driver => (
              <tr key={driver.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${!driver.is_active ? 'opacity-50' : ''}`}>
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
                    <span className="text-slate-400 flex items-center gap-1.5 text-xs"><Phone className="w-3 h-3" />{formatMobile(driver.mobile)}</span>
                    {driver.email && <span className="text-slate-400 flex items-center gap-1.5 text-xs"><Mail className="w-3 h-3" />{driver.email}</span>}
                  </div>
                </td>
                <td className="px-5 py-3">
                  {driver.driver_license
                    ? <span className="text-slate-300 flex items-center gap-1.5 text-xs"><CreditCard className="w-3 h-3 text-slate-500" />{driver.driver_license}</span>
                    : <span className="text-slate-600 text-xs">—</span>
                  }
                </td>
                <td className="px-5 py-3">
                  <input readOnly value={latestVehicle[driver.id] || ''} placeholder="—"
                    title={latestVehicle[driver.id] || 'No vehicle assigned'}
                    className="input py-1 text-xs font-mono bg-surface-hover/40 text-slate-300 w-56 cursor-default" />
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">{driver.city || '—'}</td>
                <td className="px-5 py-3">
                  {!driver.is_active ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border bg-slate-500/10 text-slate-500 border-slate-500/20">Inactive</span>
                  ) : (() => {
                    const s = dutyStatus(driver)
                    return (
                      <div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${s.cls}`}>{s.label}</span>
                        {s.sub && <p className="text-slate-500 text-[11px] mt-1">{s.sub}</p>}
                      </div>
                    )
                  })()}
                </td>
                <td className="px-5 py-3">
                  {(() => {
                    const t = pettyTotals[driver.id] || {}
                    const entries = CURRENCIES.filter(c => Number(t[c]) > 0)
                    if (entries.length === 0) return <span className="text-slate-600 text-xs">—</span>
                    return (
                      <div className="space-y-0.5">
                        {entries.map(c => (
                          <div key={c} className="text-xs font-medium text-slate-100 whitespace-nowrap">
                            <span className="text-slate-500 text-[10px] mr-1">{c}</span>
                            {Number(t[c]).toFixed(c === 'LBP' ? 0 : 2)}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => openEdit(driver)} className="btn-ghost p-1.5 text-slate-500"><Edit2 className="w-4 h-4" /></button>
                    <button
                      onClick={() => toggleActive(driver)}
                      disabled={toggling === driver.id}
                      title={driver.is_active ? 'Deactivate' : 'Activate'}
                      className={`btn-ghost p-1.5 ${driver.is_active ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'}`}
                    >
                      <Power className="w-4 h-4" />
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
          <div className="card w-full max-w-2xl p-6 space-y-4 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">
                {modal === 'add' ? 'Add Driver' : 'Edit Driver'}
              </h2>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3">
              {/* System-generated, locked fields (cannot be modified) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Driver Code</label>
                  <input
                    className="input font-mono tracking-wider text-slate-300 cursor-not-allowed opacity-90"
                    value={form.code ?? ''}
                    placeholder={modal === 'add' ? 'Auto-generated on save' : '—'}
                    readOnly
                    title="The driver code is generated automatically and cannot be changed"
                  />
                </div>
                <div>
                  <label className="label">Account Number</label>
                  <input
                    className="input font-mono tracking-wider text-slate-300 cursor-not-allowed opacity-90"
                    value={form.account_number ? formatAccountNumber(form.account_number) : ''}
                    placeholder={modal === 'add' ? 'Generating…' : '—'}
                    readOnly
                    title="The account number is generated automatically and cannot be changed"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-fuchsia-300">First Name *</label>
                  <input className="input" value={form.first_name} onChange={e => field('first_name', e.target.value)} placeholder="John" />
                </div>
                <div>
                  <label className="label text-fuchsia-300">Last Name *</label>
                  <input className="input" value={form.last_name} onChange={e => field('last_name', e.target.value)} placeholder="Doe" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-fuchsia-300">Mobile *</label>
                  <MobileInput value={form.mobile} onChange={v => field('mobile', v)} />
                </div>
                <div>
                  <label className="label">WhatsApp</label>
                  <MobileInput value={form.whatsapp_number} onChange={v => field('whatsapp_number', v)} placeholder="If different from mobile" />
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
                <label className="label">Notes</label>
                <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => field('notes', e.target.value)} placeholder="Optional notes…" />
              </div>

              {/* Petty cash sub-form — multiple entries, any currency. Created By is locked. */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="label mb-0">Petty Cash</label>
                  <button type="button" onClick={addPetty}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add Petty Cash
                  </button>
                </div>
                <div className="border border-surface-border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-[26%]">Date</th>
                        <th className="text-left px-3 py-2 w-[24%]">Amount</th>
                        <th className="text-left px-3 py-2 w-[18%]">Currency</th>
                        <th className="text-left px-3 py-2 w-[26%]">Created By</th>
                        <th className="w-[6%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pettyCash.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-600">No petty cash — click "Add Petty Cash"</td></tr>
                      ) : pettyCash.map((p, idx) => (
                        <tr key={p._id ?? p._key ?? idx} className="border-t border-surface-border/50">
                          <td className="px-3 py-2">
                            <input type="date" className="input py-1.5 text-xs" value={p.transaction_date}
                              onChange={e => setPetty(idx, 'transaction_date', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" className="input py-1.5 text-xs" value={p.amount}
                              onChange={e => setPetty(idx, 'amount', e.target.value)} placeholder="0.00" />
                          </td>
                          <td className="px-3 py-2">
                            <select className="input py-1.5 text-xs" value={p.currency}
                              onChange={e => setPetty(idx, 'currency', e.target.value)}>
                              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input className="input py-1.5 text-xs text-slate-400 cursor-not-allowed opacity-90"
                              value={p.created_by_name || '—'} readOnly
                              title="Set automatically to the signed-in user and cannot be changed" />
                          </td>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => removePetty(idx)}
                              className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Totals per currency */}
                {pettyCash.some(p => Number(p.amount) > 0) && (
                  <div className="flex flex-wrap gap-2 justify-end">
                    {CURRENCIES.map(cur => {
                      const total = pettyCash.filter(p => p.currency === cur)
                        .reduce((s, p) => s + (Number(p.amount) || 0), 0)
                      if (!total) return null
                      return (
                        <div key={cur} className="rounded-lg bg-surface-hover border border-surface-border px-3 py-1.5 text-xs">
                          <span className="text-slate-500 uppercase tracking-wider mr-2">{cur} total</span>
                          <span className="font-semibold text-slate-100">{total.toFixed(cur === 'LBP' ? 0 : 2)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Assigned vehicles sub-form — one or more, shows on the vehicle's history. */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="label mb-0">Assigned Vehicles</label>
                  <button type="button" onClick={addAssign}
                    className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Assign Vehicle
                  </button>
                </div>
                <div className="border border-surface-border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-hover border-b border-surface-border text-slate-500 font-medium uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-[30%]">Vehicle Code</th>
                        <th className="text-left px-3 py-2 w-[40%]">Description</th>
                        <th className="text-left px-3 py-2 w-[24%]">Start Date</th>
                        <th className="w-[6%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-5 text-center text-slate-600">No vehicles assigned — click "Assign Vehicle"</td></tr>
                      ) : assignments.map((a, idx) => {
                        const veh = vehicles.find(v => v.id === a.vehicle_id)
                        const desc = veh ? ([veh.make, veh.model].filter(Boolean).join(' ') || veh.type || '—') : '—'
                        return (
                          <tr key={a._id ?? a._key ?? idx} className="border-t border-surface-border/50">
                            <td className="px-3 py-2">
                              <select className="input py-1.5 text-xs" value={a.vehicle_id}
                                onChange={e => setAssign(idx, 'vehicle_id', e.target.value)}>
                                <option value="">— Select —</option>
                                {vehicles.map(v => <option key={v.id} value={v.id}>{v.asset_code}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-slate-400">{desc}</td>
                            <td className="px-3 py-2">
                              <input type="date" className="input py-1.5 text-xs" value={a.start_date}
                                onChange={e => setAssign(idx, 'start_date', e.target.value)} />
                            </td>
                            <td className="px-3 py-2">
                              <button type="button" onClick={() => removeAssign(idx)}
                                className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {vehicles.length === 0 && (
                  <p className="text-[11px] text-slate-500">No vehicles exist yet — add them in the Vehicles page first.</p>
                )}
              </div>

              {/* Driver user account & security — collapsible, admin only */}
              {modal !== 'add' && isAdmin && (
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
                        <input className="input font-mono" value={usernameInput} autoComplete="off"
                          onChange={e => { setUsernameInput(e.target.value); setCredError('') }}
                          placeholder="e.g. driver username" />
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          The username the driver uses to sign in. Letters/digits, at least 3 characters.
                        </p>
                      </div>

                      <div>
                        <label className="label">Password</label>
                        {!editingPw ? (
                          <>
                            {/* Existing password is hidden and cannot be read — shown masked. */}
                            <input type="password" readOnly autoComplete="off"
                              value={modal?.username ? 'reset-placeholder' : ''}
                              placeholder={modal?.username ? '' : 'No password set yet'}
                              className="input font-mono bg-surface-hover/50 text-slate-400 cursor-not-allowed" />
                            <p className="text-[10px] text-slate-600 mt-0.5">
                              The current password is hidden and can’t be read. Press “Set Password” to set a new one.
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex items-start gap-2 text-amber-300 text-[11px] bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-2">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                              <span>Saving replaces the driver’s password immediately — the old one stops working. Copy and share the new password before closing.</span>
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
                          <button type="button" onClick={startPasswordReset} disabled={!usernameInput.trim()}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                            <KeyRound className="w-4 h-4" /> Set Password
                          </button>
                        ) : (
                          <>
                            <button type="button" onClick={saveDriverCredentials}
                              disabled={resetting || usernameInput.trim().length < 3 || pwInput.length < PW_MIN}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 disabled:cursor-not-allowed">
                              <Check className="w-4 h-4" /> {resetting ? 'Saving…' : 'Save Password'}
                            </button>
                            <button type="button" onClick={cancelPasswordReset} disabled={resetting}
                              className="btn-ghost text-slate-400">Cancel</button>
                          </>
                        )}
                      </div>

                      {newPassword && (
                        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 space-y-1">
                          <p className="text-[11px] text-green-300 font-semibold">Password updated — copy it now and share it with the driver:</p>
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
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button className="btn-ghost" onClick={closeModal}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={!form.first_name?.trim() || !form.last_name?.trim() || !form.mobile?.trim() || saving}
              >
                <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Driver'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New-driver code notification */}
      {codeNotice && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-sm p-6 space-y-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 flex items-center justify-center">
              <Check className="w-6 h-6 text-fuchsia-300" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Driver Saved</h3>
              <p className="text-sm text-slate-400 mt-1">
                {codeNotice.name || 'The new driver'} has been created with a new driver code.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface-hover border border-fuchsia-500/30 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Driver Code</p>
                <p className="text-base font-mono font-bold text-fuchsia-300 mt-1 break-all">{codeNotice.code || '—'}</p>
              </div>
              <div className="rounded-lg bg-surface-hover border border-fuchsia-500/30 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Account Number</p>
                <p className="text-base font-mono font-bold text-fuchsia-300 mt-1 break-all">
                  {codeNotice.account_number ? formatAccountNumber(codeNotice.account_number) : '—'}
                </p>
              </div>
            </div>
            <button className="btn-primary w-full justify-center" onClick={() => setCodeNotice(null)}>
              <Check className="w-4 h-4" /> Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
