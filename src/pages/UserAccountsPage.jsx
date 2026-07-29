import React, { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  UserCog, UserPlus, Search, Shield, X, Loader, AlertCircle,
  KeyRound, Power, PowerOff, Pencil, Eye, EyeOff, Copy, Check, RefreshCw, Wand2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatMobile } from '../lib/phone'
import MobileInput from '../components/MobileInput'

const PW_MIN = 8

// A random, easy-to-read password (no ambiguous chars like O/0, l/1).
function generatePassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(len)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length]
  return out
}

// Reduce any text to a clean username fragment (letters/digits only, lower-case).
function slugUser(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20)
}

// Suggest a username from a name/email base, made unique against `taken`.
function suggestUsername(base, taken) {
  const set = new Set((taken || []).map(u => String(u).toLowerCase()))
  let root = slugUser(base) || 'user'
  if (root.length < 3) root = `${root}user`.slice(0, 20)
  if (!set.has(root)) return root
  for (let i = 2; i < 1000; i++) {
    const cand = `${root}${i}`.slice(0, 22)
    if (!set.has(cand)) return cand
  }
  return `${root}${Date.now().toString().slice(-4)}`
}

// Roles an admin may assign (super_admin is intentionally excluded).
const ASSIGNABLE_ROLES = [
  { value: 'admin',       label: 'Admin' },
  { value: 'call_center', label: 'Call Center' },
  { value: 'driver',      label: 'Driver' },
  { value: 'customer',    label: 'Customer' },
  { value: 'supplier',    label: 'Supplier' },
  { value: 'partner',     label: 'Partner' },
]
const roleLabel = Object.fromEntries(ASSIGNABLE_ROLES.map(r => [r.value, r.label]))

// Maximum number of *active* accounts allowed per role. Adding beyond the cap
// is blocked with a warning; deactivated accounts don't count (and are hidden).
const ROLE_LIMITS = { partner: 20, supplier: 20, call_center: 6 }

const STATUS_STYLES = {
  active:    'bg-green-500/10 text-green-400 border-green-500/30',
  inactive:  'bg-slate-500/10 text-slate-400 border-slate-500/30',
  suspended: 'bg-red-500/10 text-red-400 border-red-500/30',
  pending:   'bg-amber-500/10 text-amber-400 border-amber-500/30',
}

const EMPTY_USER = { username: '', email: '', mobile: '', role: 'call_center', status: 'active', password: '', contact_id: '' }

// Map RPC error codes to friendly text.
function friendlyError(message = '') {
  if (message.includes('NOT_AUTHORIZED'))            return 'You are not authorized to do that.'
  if (message.includes('CANNOT_MODIFY_SUPER_ADMIN')) return 'The super admin account cannot be modified here.'
  if (message.includes('CANNOT_CHANGE_OWN_STATUS'))  return 'You cannot deactivate your own account.'
  if (message.includes('CANNOT_CREATE_SUPER_ADMIN')) return 'Super admin accounts cannot be created here.'
  if (message.includes('USERNAME_REQUIRED'))         return 'Username is required.'
  if (message.includes('PASSWORD_REQUIRED'))         return 'Password is required.'
  if (message.includes('duplicate key') && message.includes('username')) return 'That username is already taken.'
  if (message.includes('duplicate key') && message.includes('email'))    return 'That email is already in use.'
  if (message.includes('duplicate key'))             return 'A user with those details already exists.'
  return message || 'Something went wrong. Please try again.'
}

export default function UserAccountsPage() {
  const { currentUser, hasRole, onlineUserIds } = useAuth()
  const isAdmin = hasRole('super_admin', 'admin')
  const onlineSet = new Set((onlineUserIds ?? []).map(String))
  const isSuperAdmin = hasRole('super_admin')
  const location = useLocation()
  const navigate = useNavigate()

  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [error,   setError]   = useState('')

  const [modal,    setModal]    = useState(null)   // 'add' | user object (edit)
  const [form,     setForm]     = useState(EMPTY_USER)
  const [saving,   setSaving]   = useState(false)
  const [formErr,  setFormErr]  = useState('')
  const [showPw,   setShowPw]   = useState(false)

  const [resetFor, setResetFor] = useState(null)   // user object
  const [resetPw,  setResetPw]  = useState('')
  const [resetErr, setResetErr] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  // Credentials shown once, right after an account is created, so the super admin
  // can copy and hand them over (the password can never be read again afterwards).
  const [created, setCreated] = useState(null)     // { username, password }
  const [copied,  setCopied]  = useState('')        // which field was last copied

  // Copy text to the clipboard with a brief "copied" flash on the matching button.
  async function copy(text, key) {
    try { await navigator.clipboard.writeText(String(text ?? '')) } catch { /* ignore */ }
    setCopied(key); setTimeout(() => setCopied(c => (c === key ? '' : c)), 1500)
  }

  const [busyId, setBusyId] = useState(null)       // row with an in-flight status toggle

  // Supplier & Partner contacts — a login for either role MUST be linked to one
  // (via contact_id) so the 2nd-party user only sees their own orders.
  const [partyContacts, setPartyContacts] = useState([])
  const isPartyRole = form.role === 'supplier' || form.role === 'partner'

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data, error: e } = await supabase
      .from('user_accounts')
      .select('id,username,email,mobile,role,status,contact_id,last_login_at,must_change_password,created_at')
      .neq('role', 'super_admin')                  // exclude the top-level admin
      .order('created_at', { ascending: true })
    if (e) setError(friendlyError(e.message))
    else   { setUsers(data ?? []); setError('') }
    setLoading(false)
  }, [])

  useEffect(() => { if (isAdmin) fetchUsers() }, [isAdmin, fetchUsers])

  // Load supplier/partner contacts once (for the "linked contact" picker).
  useEffect(() => {
    if (!isAdmin) return
    ;(async () => {
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, company_name, code, contact_types')
        .overlaps('contact_types', ['supplier', 'partner'])
        .order('first_name')
      setPartyContacts(data ?? [])
    })()
  }, [isAdmin])

  // Display name for a contact: company first, else person, then code.
  function contactLabel(c) {
    if (!c) return ''
    const name = (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unnamed'
    return c.code ? `${name} (${c.code})` : name
  }
  // Contacts offered for the current role (only those carrying that role tag).
  const roleContacts = partyContacts.filter(c =>
    Array.isArray(c.contact_types) && c.contact_types.includes(form.role))

  // Arrived from a contact (supplier/partner) via "Create User Profile":
  // open the New User form pre-filled with the contact's details, then clear
  // the navigation state so a refresh/back doesn't re-open it.
  useEffect(() => {
    const prefill = location.state?.prefillUser
    if (prefill && isAdmin) {
      setForm({ ...EMPTY_USER, ...prefill })
      setFormErr(''); setShowPw(false); setModal('add')
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isAdmin])

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <Shield className="w-10 h-10 text-slate-600" />
        <p className="text-slate-300 font-medium">Administrators only</p>
        <p className="text-slate-500 text-sm">You don’t have permission to manage user accounts.</p>
      </div>
    )
  }

  // Regular admins never see deactivated users; the super admin sees everyone
  // (of every role) and can reactivate any of them.
  const visibleUsers = isSuperAdmin ? users : users.filter(u => u.status === 'active')

  const q = search.trim().toLowerCase()
  const filtered = visibleUsers.filter(u =>
    !q ||
    u.username?.toLowerCase().includes(q) ||
    u.email?.toLowerCase().includes(q) ||
    u.mobile?.includes(search.trim()) ||
    roleLabel[u.role]?.toLowerCase().includes(q)
  )

  // Count active accounts for a role, optionally excluding one user (the row
  // being edited). Used to enforce the per-role caps in ROLE_LIMITS.
  const activeRoleCount = (role, excludeId = null) =>
    users.filter(u => u.role === role && u.status === 'active' && u.id !== excludeId).length

  /* ── add / edit ──────────────────────────────────────────── */
  function openAdd() {
    // Start with a ready-to-use strong password so the admin can just create &
    // share, or replace it. Shown in clear since it's a brand-new temporary one.
    setForm({ ...EMPTY_USER, password: generatePassword() })
    setFormErr(''); setShowPw(true); setModal('add')
  }
  function openEdit(u) {
    setForm({ username: u.username, email: u.email ?? '', mobile: u.mobile ?? '', role: u.role, status: u.status, password: '', contact_id: u.contact_id ?? '' })
    setFormErr(''); setModal(u)
  }
  function closeModal() { setModal(null); setForm(EMPTY_USER); setFormErr('') }

  async function saveUser() {
    if (!form.username.trim()) { setFormErr('Username is required.'); return }
    if (!form.mobile.trim())   { setFormErr('Mobile is required.'); return }
    if (isPartyRole && !form.contact_id) {
      setFormErr(`Select the ${form.role} contact this login belongs to.`); return
    }
    // Enforce the per-role active-account cap. Only relevant when the saved
    // account will be active in a capped role and isn't already counted.
    const limit = ROLE_LIMITS[form.role]
    if (limit != null) {
      const excludeId = modal === 'add' ? null : modal.id
      if (activeRoleCount(form.role, excludeId) >= limit) {
        setFormErr(`Limit reached: you can have at most ${limit} active ${roleLabel[form.role]} accounts. Deactivate an existing one to add another.`)
        return
      }
    }
    if (modal === 'add' && form.password.length < 8) {
      setFormErr('Set a temporary password of at least 8 characters.'); return
    }
    setSaving(true); setFormErr('')

    let rpcError
    if (modal === 'add') {
      const { error: e } = await supabase.rpc('admin_create_user', {
        p_actor_id:   currentUser.user_id,
        p_username:   form.username.trim(),
        p_email:      form.email.trim(),
        p_mobile:     form.mobile.trim(),
        p_password:   form.password,
        p_role:       form.role,
        p_status:     form.status,
        p_contact_id: form.contact_id || null,
      })
      rpcError = e
    } else {
      const { error: e } = await supabase.rpc('admin_update_user', {
        p_actor_id:   currentUser.user_id,
        p_user_id:    modal.id,
        p_username:   form.username.trim(),
        p_email:      form.email.trim(),
        p_mobile:     form.mobile.trim(),
        p_role:       form.role,
        p_contact_id: form.contact_id || null,
      })
      rpcError = e
    }

    setSaving(false)
    if (rpcError) { setFormErr(friendlyError(rpcError.message)); return }
    // On a new account, surface the credentials once so they can be copied and
    // handed to the user — the password can't be retrieved later.
    if (modal === 'add') setCreated({ username: form.username.trim(), password: form.password })
    closeModal()
    fetchUsers()
  }

  /* ── reset password ──────────────────────────────────────── */
  function openReset(u) { setResetFor(u); setResetPw(''); setResetErr(''); setShowPw(false) }
  async function doReset() {
    if (resetPw.length < 8) { setResetErr('Password must be at least 8 characters.'); return }
    setResetBusy(true); setResetErr('')
    const { error: e } = await supabase.rpc('admin_reset_password', {
      p_actor_id:     currentUser.user_id,
      p_user_id:      resetFor.id,
      p_new_password: resetPw,
    })
    setResetBusy(false)
    if (e) { setResetErr(friendlyError(e.message)); return }
    setResetFor(null); setResetPw('')
    fetchUsers()
  }

  /* ── activate / deactivate ───────────────────────────────── */
  async function toggleStatus(u) {
    const next = u.status === 'active' ? 'inactive' : 'active'
    setBusyId(u.id)
    const { error: e } = await supabase.rpc('admin_set_user_status', {
      p_actor_id: currentUser.user_id,
      p_user_id:  u.id,
      p_status:   next,
    })
    setBusyId(null)
    if (e) { setError(friendlyError(e.message)); return }
    setError(''); fetchUsers()
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <UserCog className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">User Accounts</h2>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input className="input pl-9" placeholder="Search users…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary ml-auto" onClick={openAdd}>
          <UserPlus className="w-4 h-4" /> New User
        </button>
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
              {['Username', 'Email', 'Mobile', 'Role', 'Status', 'Online', 'Last Login', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No users found</td></tr>
            ) : filtered.map(u => {
              const isSelf = u.id === currentUser.user_id
              return (
                <tr key={u.id} className={`border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors ${u.status === 'inactive' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="text-slate-100 font-medium">{u.username}</span>
                    {u.must_change_password && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                        Must reset
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{u.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{u.mobile ? formatMobile(u.mobile) : '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{roleLabel[u.role] ?? u.role}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] capitalize border rounded px-2 py-0.5 ${STATUS_STYLES[u.status] ?? STATUS_STYLES.pending}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {onlineSet.has(String(u.id)) ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-green-400">
                        <span className="relative flex w-2 h-2">
                          <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-60 animate-ping" />
                          <span className="relative inline-flex w-2 h-2 rounded-full bg-green-400" />
                        </span>
                        Online now
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="w-2 h-2 rounded-full bg-slate-600" /> Offline
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(u)} title="Edit"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => openReset(u)} title="Reset password"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-amber-300">
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleStatus(u)} disabled={isSelf || busyId === u.id}
                        title={isSelf ? 'You cannot change your own status' : (u.status === 'active' ? 'Deactivate' : 'Activate')}
                        className={`btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${u.status === 'active' ? 'text-slate-400 hover:text-red-400' : 'text-slate-400 hover:text-green-400'}`}>
                        {busyId === u.id
                          ? <Loader className="w-4 h-4 animate-spin" />
                          : (u.status === 'active' ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />)}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Add / Edit modal ──────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-md flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100">
                {modal === 'add' ? 'New User' : `Edit ${modal.username}`}
              </h3>
              <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-4">
              {form.contact_id && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/10 border border-brand-500/30 text-brand-300 text-[11px]">
                  <UserPlus className="w-3.5 h-3.5 flex-shrink-0" />
                  This login will be linked to the selected contact, so they’ll see only their own orders.
                </div>
              )}
              <div>
                <div className="flex items-center justify-between">
                  <label className="label">Username *</label>
                  {modal === 'add' && (
                    <button type="button"
                      onClick={() => {
                        const base = form.email || (form.mobile ? `cc${form.mobile.replace(/\D/g, '').slice(-4)}` : 'cc')
                        setForm(f => ({ ...f, username: suggestUsername(base.split('@')[0], users.map(u => u.username)) }))
                        setFormErr('')
                      }}
                      className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                      <Wand2 className="w-3 h-3" /> Suggest
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input className="input pr-10" value={form.username}
                    onChange={e => { setForm(f => ({ ...f, username: e.target.value })); setFormErr('') }}
                    placeholder="jdoe" autoFocus autoComplete="off" />
                  {form.username && (
                    <button type="button" onClick={() => copy(form.username, 'u')} title="Copy username"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" tabIndex={-1}>
                      {copied === 'u' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">Set by the administrator. The user cannot change this.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Email</label>
                  <input className="input" value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jdoe@company.com" />
                </div>
                <div>
                  <label className="label">Mobile *</label>
                  <MobileInput value={form.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} />
                </div>
              </div>
              <div>
                <label className="label">Role *</label>
                <select className="input" value={form.role}
                  onChange={e => {
                    const role = e.target.value
                    // Drop any linked contact when leaving a supplier/partner role.
                    const keepLink = role === 'supplier' || role === 'partner'
                    setForm(f => ({ ...f, role, contact_id: keepLink ? f.contact_id : '' }))
                    setFormErr('')
                  }}>
                  {ASSIGNABLE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {ROLE_LIMITS[form.role] != null && (() => {
                  const used = activeRoleCount(form.role, modal === 'add' ? null : modal.id)
                  const cap  = ROLE_LIMITS[form.role]
                  const full = used >= cap
                  return (
                    <p className={`text-[11px] mt-1 ${full ? 'text-red-400' : 'text-slate-500'}`}>
                      {used} of {cap} {roleLabel[form.role]} accounts used
                      {full && ' — limit reached'}
                    </p>
                  )
                })()}
              </div>

              {/* Supplier/Partner logins must be tied to a contact (contact_id). */}
              {isPartyRole && (
                <div>
                  <label className="label capitalize">{form.role} contact *</label>
                  <select className="input" value={form.contact_id || ''}
                    onChange={e => { setForm(f => ({ ...f, contact_id: e.target.value })); setFormErr('') }}>
                    <option value="">— Select the {form.role} —</option>
                    {roleContacts.map(c => (
                      <option key={c.id} value={c.id}>{contactLabel(c)}</option>
                    ))}
                    {/* Keep a prefilled/linked contact selectable even if it isn't
                        in the loaded list (e.g. inactive or different role tag). */}
                    {form.contact_id && !roleContacts.some(c => c.id === form.contact_id) && (
                      <option value={form.contact_id}>Linked contact</option>
                    )}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Links the login to this contact so they only see their own orders.
                  </p>
                </div>
              )}

              {modal === 'add' && (
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label">Temporary password *</label>
                    <button type="button"
                      onClick={() => { setForm(f => ({ ...f, password: generatePassword() })); setShowPw(true); setFormErr('') }}
                      className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                      <RefreshCw className="w-3 h-3" /> Generate
                    </button>
                  </div>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} className="input pr-16 font-mono" value={form.password}
                      onChange={e => { setForm(f => ({ ...f, password: e.target.value })); setFormErr('') }}
                      placeholder={`At least ${PW_MIN} characters`} autoComplete="new-password" />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      {form.password && (
                        <button type="button" onClick={() => copy(form.password, 'p')} title="Copy password"
                          className="text-slate-500 hover:text-slate-300" tabIndex={-1}>
                          {copied === 'p' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      )}
                      <button type="button" onClick={() => setShowPw(s => !s)}
                        className="text-slate-500 hover:text-slate-300" tabIndex={-1}>
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">The user must change this on first sign-in.</p>
                </div>
              )}

              {formErr && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed">{formErr}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={closeModal} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={saveUser} disabled={saving}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : (modal === 'add' ? 'Create User' : 'Save Changes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset password modal ──────────────────────────────── */}
      {resetFor && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-sm flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" /> Reset password
              </h3>
              <button onClick={() => setResetFor(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-slate-400 text-xs">
                Set a new password for <span className="text-slate-200 font-medium">{resetFor.username}</span>.
                They will be required to change it the next time they sign in.
              </p>
              <div>
                <label className="label">New password *</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} className="input pr-10" value={resetPw}
                    onChange={e => { setResetPw(e.target.value); setResetErr('') }}
                    placeholder="At least 8 characters" autoFocus autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" tabIndex={-1}>
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {resetErr && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-relaxed">{resetErr}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
              <button onClick={() => setResetFor(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">Cancel</button>
              <button onClick={doReset} disabled={resetBusy} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
                {resetBusy ? <><Loader className="w-4 h-4 animate-spin" /> Saving…</> : 'Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Account created — credentials to hand over (shown once) ── */}
      {created && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="card w-full max-w-sm flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" /> Account created
              </h3>
              <button onClick={() => setCreated(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-slate-400 text-xs">
                Share these with the user now — the password is shown only this once and
                cannot be read again. They’ll be asked to change it on first sign-in.
              </p>
              {[
                { label: 'Username', value: created.username, key: 'cu' },
                { label: 'Temporary password', value: created.password, key: 'cp' },
              ].map(row => (
                <div key={row.key}>
                  <label className="label">{row.label}</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 rounded-lg bg-surface-hover border border-surface-border text-slate-100 text-sm font-mono break-all">
                      {row.value}
                    </code>
                    <button type="button" onClick={() => copy(row.value, row.key)} title={`Copy ${row.label.toLowerCase()}`}
                      className="btn-ghost p-2 border border-surface-border text-slate-400 hover:text-slate-100">
                      {copied === row.key ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between gap-2 px-5 py-4 border-t border-surface-border">
              <button
                onClick={() => copy(`Username: ${created.username}\nPassword: ${created.password}`, 'both')}
                className="btn-ghost px-4 py-2 text-sm border border-surface-border inline-flex items-center gap-2">
                {copied === 'both' ? <><Check className="w-4 h-4 text-green-400" /> Copied</> : <><Copy className="w-4 h-4" /> Copy both</>}
              </button>
              <button onClick={() => setCreated(null)} className="btn-primary px-4 py-2 text-sm">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
