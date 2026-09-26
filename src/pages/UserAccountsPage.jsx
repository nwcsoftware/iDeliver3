import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  UserCog,
  UserPlus,
  Shield,
  X,
  Loader,
  AlertCircle,
  KeyRound,
  Power,
  PowerOff,
  Pencil,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Wand2,
  Monitor,
  Smartphone,
  Trash2,
  ShieldAlert,
  FileSearch,
  ArrowUpAZ,
  ArrowDownZA,
  ChevronsUpDown,
  ShieldCheck,
  CalendarClock,
  BadgeDollarSign,
  FileDown,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ensureLoginSubscription, TRIAL_DAYS } from '../lib/subscriptions'
import {
  scanUserReferences, summariseReferences, deleteUserAccount, tableLabel, columnLabel,
} from '../lib/userDeletion'
import { useAuth } from '../context/AuthContext'
import { isStrictAdmin } from '../lib/roles'
import { checkSeat, seatPosition, seatPrice, seatStatus, accountLevel } from '../lib/officeSeats'
import { freeSeatMap } from '../lib/subscriptions'
import { downloadUserAccountsPdf } from '../lib/userAccountsPdf'
import { formatMobile } from '../lib/phone'
import MobileInput from '../components/MobileInput'
import SearchField from '../components/ui/SearchField'

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
  /* A senior user is an administrator minus a list of exceptions (fix156).
     Listed under Admin because that is what it is a rank below. */
  { value: 'senior_call_center', label: 'Senior Call Center' },
  { value: 'call_center', label: 'Call Center' },
  { value: 'driver',      label: 'Driver' },
  { value: 'customer',    label: 'Customer' },
  { value: 'supplier',    label: 'Supplier' },
  { value: 'partner',     label: 'Partner' },
]
const roleLabel = Object.fromEntries(ASSIGNABLE_ROLES.map(r => [r.value, r.label]))

/* The per-role caps used to live here as flat numbers (partner 20, supplier 20,
   call_center 6) that stopped everybody, super admin included, and matched
   neither the licence nor the seats the company actually pays for. They are now
   the ALLOWANCES in lib/billing.js — 10 partners, 6 call-centre, 4
   administrators — enforced through lib/officeSeats.js, which knows the
   difference between a seat that is included and one that has to be bought. */

/* One filter chip. `cls` lets a chip wear the colour of what it filters —
   green for online, the status colours for statuses — so the bar reads as the
   list does. */
function FilterChip({ on, onClick, children, cls = '' }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg font-medium border transition-colors ${
        on ? (cls || 'bg-brand-500/15 text-brand-300 border-brand-500/30')
           : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
      {children}
    </button>
  )
}

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
  const { currentUser, hasRole, onlineUserIds, onlineSessions } = useAuth()
  const isAdmin = isStrictAdmin(currentUser?.role)
  const onlineSet = new Set((onlineUserIds ?? []).map(String))

  /* Filters and sorting for the list. Sorting cycles A→Z, Z→A, then back to
     the natural order the query returned — the third state matters, because
     "how it normally comes" is itself a view and there is otherwise no way
     back to it without reloading the page. */
  const [roleFilter,   setRoleFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [onlineFilter, setOnlineFilter] = useState('all')   // all | online | offline
  const [sort, setSort] = useState({ key: null, dir: null }) // dir: 'asc' | 'desc' | null

  const cycleSort = (key) => setSort(s => (
    s.key !== key ? { key, dir: 'asc' }
      : s.dir === 'asc' ? { key, dir: 'desc' }
      : { key: null, dir: null }))
  const isSuperAdmin = hasRole('super_admin')

  // Live devices per user (one entry per signed-in client), for the super
  // admin's Device column. De-duplicated so two tabs on the same machine count
  // once.
  const liveDevices = new Map()
  for (const s of onlineSessions ?? []) {
    const list = liveDevices.get(s.user_id) ?? []
    if (!list.some(d => (d.device_id && d.device_id === s.device_id) || d.device_name === s.device_name)) {
      list.push(s)
    }
    liveDevices.set(s.user_id, list)
  }
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
  /* Credentials panel inside the edit form (super admin only). `credsPw` is a
     NEW password being set — never an old one, which cannot be read back. */
  const [credsOpen, setCredsOpen] = useState(false)
  const [credsPw,   setCredsPw]   = useState('')
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

  /* Subscriptions, so each row can say whether its seat is included, on a free
     trial, paid for, or missing. Both shapes are read: a party subscribes as a
     CONTACT, an over-allowance office seat as the LOGIN itself (fix146). */
  const [subs, setSubs] = useState([])
  useEffect(() => {
    if (!isAdmin) return
    ;(async () => {
      const { data, error } = await supabase.from('subscriptions')
        .select('*')
      // Not installed yet (fix110/fix146 unrun) → the column simply stays quiet.
      if (!error && data) setSubs(data)
    })()
  }, [isAdmin])

  // Supplier & Partner contacts — a login for either role MUST be linked to one
  // (via contact_id) so the 2nd-party user only sees their own orders.
  const [partyContacts, setPartyContacts] = useState([])
  /* The contact each login is linked to, by id. The signed-in name comes from
     this contact (verify_login returns COALESCE(contact.first_name, username)),
     so a wrong link makes the header show somebody else — worth showing here. */
  const [linkedContacts, setLinkedContacts] = useState({})
  const isPartyRole = form.role === 'supplier' || form.role === 'partner'

  const BASE_COLS   = 'id,username,email,mobile,role,status,contact_id,last_login_at,must_change_password,created_at'
  const DEVICE_COLS = ',last_login_device,last_login_platform,last_device_seen_at'

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    // A super admin manages every account, including other super admins. Plain
    // admins never see super-admin rows.
    const load = (cols) => {
      let q = supabase.from('user_accounts').select(cols)
      if (!isSuperAdmin) q = q.neq('role', 'super_admin')
      return q.order('created_at', { ascending: true })
    }

    let { data, error: e } = await load(BASE_COLS + DEVICE_COLS)
    // The device columns arrive with supabase-fix101.sql; until it's applied,
    // fall back so the page still works (live devices come from presence).
    if (e) ({ data, error: e } = await load(BASE_COLS))

    if (e) setError(friendlyError(e.message))
    else   { setUsers(data ?? []); setError('') }
    setLoading(false)
  }, [isSuperAdmin])

  useEffect(() => { if (isAdmin) fetchUsers() }, [isAdmin, fetchUsers])

  // Load supplier/partner contacts once (for the "linked contact" picker).
  useEffect(() => {
    if (!isAdmin) return
    ;(async () => {
      const { data } = await supabase
        .from('contacts')
        // created_at, is_active and contact_type are here for the seat column:
        // shown against each login and in the seat column.
        .select('id, first_name, last_name, company_name, code, contact_type, contact_types, created_at, is_active')
        .overlaps('contact_types', ['supplier', 'partner'])
        .order('first_name')
      setPartyContacts(data ?? [])
    })()
  }, [isAdmin])

  /* Resolve the contacts the listed logins are linked to, so the page can show
     WHO each account signs in as — and make a wrong link obvious. */
  useEffect(() => {
    const ids = [...new Set(users.map(u => u.contact_id).filter(Boolean))]
    if (ids.length === 0) { setLinkedContacts({}); return }
    ;(async () => {
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, company_name, code, contact_types')
        .in('id', ids)
      setLinkedContacts(Object.fromEntries((data ?? []).map(c => [c.id, c])))
    })()
  }, [users])

  // Display name for a contact: company first, else person, then code.
  function contactLabel(c) {
    if (!c) return ''
    const name = (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unnamed'
    return c.code ? `${name} (${c.code})` : name
  }
  // Contacts offered for the current role (only those carrying that role tag).
  const roleContacts = partyContacts.filter(c =>
    Array.isArray(c.contact_types) && c.contact_types.includes(form.role))

  // Arrived from a partner's Logins panel: show that login.
  useEffect(() => {
    const q = location.state?.search
    if (q) setSearch(String(q))
  }, [location.state?.search])

  // Arrived from a contact (supplier/partner) via "Create User Profile":
  // open the New User form pre-filled with the contact's details, then clear
  // the navigation state so a refresh/back doesn't re-open it.
  useEffect(() => {
    const prefill = location.state?.prefillUser
    if (prefill && isSuperAdmin) {
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

  /* Who this viewer may see at all. Two rules, and everything else on the page
     — the filters, their counts, the presence tally, the rows — is built from
     this one list, so none of them can disagree with it:

       · a super-admin account is invisible to anyone who isn't one. The query
         already asks the server to leave those rows out; this repeats it here
         so a future fallback query, or a cached response, cannot quietly put
         them back on the screen.
       · a plain admin sees only active accounts; the super admin sees every
         account of every role, and can reactivate any of them. */
  const visibleUsers = isSuperAdmin
    ? users
    : users.filter(u => u.role !== 'super_admin' && u.status === 'active')

  const q = search.trim().toLowerCase()
  const searched = visibleUsers.filter(u =>
    !q ||
    u.username?.toLowerCase().includes(q) ||
    u.email?.toLowerCase().includes(q) ||
    u.mobile?.includes(search.trim()) ||
    roleLabel[u.role]?.toLowerCase().includes(q) ||
    (isSuperAdmin && u.last_login_device?.toLowerCase().includes(q))
  )

  const matchesFilters = (u) => {
    if (roleFilter   !== 'all' && u.role   !== roleFilter)   return false
    if (statusFilter !== 'all' && u.status !== statusFilter) return false
    if (onlineFilter !== 'all') {
      const on = onlineSet.has(String(u.id))
      if (onlineFilter === 'online'  && !on) return false
      if (onlineFilter === 'offline' &&  on) return false
    }
    return true
  }

  /* What each sortable column sorts BY — not always what it displays: Online
     sorts by whether they are, Last Login by the moment rather than the
     formatted date, so "Never" lands at one end instead of under N. */
  const sortValue = (u, key) => {
    switch (key) {
      case 'username': return (u.username || '').toLowerCase()
      case 'email':    return (u.email || '').toLowerCase()
      case 'mobile':   return (u.mobile || '').replace(/\D/g, '')
      case 'role':     return (roleLabel[u.role] || u.role || '').toLowerCase()
      case 'status':   return (u.status || '').toLowerCase()
      case 'online':   return onlineSet.has(String(u.id)) ? 1 : 0
      case 'device':   return (u.last_login_device || '').toLowerCase()
      case 'last':     return u.last_login_at ? new Date(u.last_login_at).getTime() : 0
      default:         return ''
    }
  }

  const filtered = (() => {
    const rows = searched.filter(matchesFilters)
    if (!sort.key || !sort.dir) return rows              // the natural order
    const dir = sort.dir === 'asc' ? 1 : -1
    return rows.slice().sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      if (va === vb) return (a.username || '').localeCompare(b.username || '')
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
  })()

  /* Export the page as filtered (super admin). The filters go on the paper in
     words, because a list read later without them reads as everybody. */
  const [exporting, setExporting] = useState(false)
  async function exportUsers() {
    if (!isSuperAdmin || exporting) return
    setExporting(true)
    try {
      const SORT_NAMES = { username: 'username', email: 'email', mobile: 'mobile', role: 'role', status: 'status',
                           online: 'online', device: 'device', last: 'last login' }
      const filters = [
        roleFilter   !== 'all' && `Role: ${roleLabel[roleFilter] || roleFilter}`,
        statusFilter !== 'all' && `Status: ${statusFilter}`,
        onlineFilter !== 'all' && `Online: ${onlineFilter === 'online' ? 'online now' : 'offline'}`,
        search.trim()          && `Search: “${search.trim()}”`,
        sort.key && sort.dir   && `Sorted by ${SORT_NAMES[sort.key] || sort.key} (${sort.dir === 'asc' ? 'A–Z / oldest first' : 'Z–A / newest first'})`,
      ].filter(Boolean)
      const rows = filtered.map(u => {
        const st = seatStatus(u, seatLookups)
        const lv = accountLevel(u, seatLookups)
        return {
          level:     lv.level,
          levelDetail: lv.detail,
          username:  u.username,
          contact:   u.contact_id ? contactLabel(linkedContacts[u.contact_id]) : '',
          role:      roleLabel[u.role] || u.role,
          mobile:    u.mobile,
          email:     u.email,
          status:    u.status,
          online:    onlineSet.has(String(u.id)),
          seat:      { key: st.key, label: st.label, until: st.row?.end_date ? String(st.row.end_date).slice(0, 10) : '' },
          lastLogin: u.last_login_at,
          device:    u.last_login_device,
        }
      })
      const who = `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim() || currentUser?.username || ''
      await downloadUserAccountsPdf(rows, { filters, preparedBy: who })
    } catch (e) {
      setError?.(e?.message || 'Could not build the PDF.')
    } finally {
      setExporting(false)
    }
  }

  // The roles actually present, so the filter never offers an empty one.
  const rolesPresent = [...new Set(visibleUsers.map(u => u.role))]
    .sort((a, b) => (roleLabel[a] || a).localeCompare(roleLabel[b] || b))
  const onlineCount = visibleUsers.filter(u => onlineSet.has(String(u.id))).length
  const anyFilter = roleFilter !== 'all' || statusFilter !== 'all' || onlineFilter !== 'all' || !!sort.key || !!q


  /* Everything the seat column needs, worked out once for the whole list. */
  const seatLookups = useMemo(() => {
    const subsByContact = new Map()
    const subsByUser    = new Map()
    for (const r of subs) {
      const key = r.contact_id || r.user_account_id
      if (!key) continue
      const m = r.contact_id ? subsByContact : subsByUser
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(r)
    }
    return {
      // Which partners hold a free seat, and until when (fix163) — read from
      // the same rows the sign-in gate reads.
      freeSeats: freeSeatMap(subs),
      subsByContact,
      subsByUser,
      users,
    }
  }, [users, subs, partyContacts])

  /* ONCE AN ACCOUNT HAS BEEN USED, WHAT IT IS IS SETTLED.

     Two fields decide that, and both are locked together: the ROLE, which
     decides which gate the account passes, and the CONTACT it is linked to,
     which decides whose orders and whose money it sees. Re-pointing a partner
     login from one contact to another is the quieter of the two and the larger
     one: the role on screen never changes, and the account simply starts
     reading somebody else's business.

     A role is not a label — it decides which gate the account passes through.
     An account that has signed in has already been let through one of them, and
     moving it to another category afterwards re-decides, retrospectively, what
     that person was allowed to do. It is also how a seat gets laundered: a
     partner made call-centre, or the reverse, carries its history and its
     password into an arrangement it was never granted.

     So after the first sign-in both are fixed for an administrator. The super
     admin can still change them — somebody has to be able to repair a genuine
     mistake — and an account that has never been used stays editable, because
     nothing has happened under it yet. */
  const identityLocked = (u) => !!u?.last_login_at && !isSuperAdmin

  /* ── add / edit ──────────────────────────────────────────── */
  function openAdd() {
    if (!isSuperAdmin) return
    // Start with a ready-to-use strong password so the admin can just create &
    // share, or replace it. Shown in clear since it's a brand-new temporary one.
    setForm({ ...EMPTY_USER, password: generatePassword() })
    setFormErr(''); setShowPw(true); setModal('add')
  }
  function openEdit(u) {
    if (!isSuperAdmin) return
    setForm({ username: u.username, email: u.email ?? '', mobile: u.mobile ?? '', role: u.role, status: u.status, password: '', contact_id: u.contact_id ?? '' })
    setFormErr(''); setModal(u)
    setCredsOpen(false); setCredsPw(''); setCopied('')
  }

  function closeModal() { setModal(null); setForm(EMPTY_USER); setFormErr('') }

  async function saveUser() {
    if (!isSuperAdmin) { setFormErr('Only the super admin can create or change a login here.'); return }
    if (!form.username.trim()) { setFormErr('Username is required.'); return }
    if (!form.mobile.trim())   { setFormErr('Mobile is required.'); return }
    if (isPartyRole && !form.contact_id) {
      setFormErr(`Select the ${form.role} contact this login belongs to.`); return
    }
    /* A login that belongs to an outside party cannot be promoted into the
       office. Changing a partner's role to call-centre or admin would hand a
       supplier or partner the back office — and would do it quietly, because
       office roles are not gated on a contact at all, so the subscription check
       that governs them would simply stop running. Re-pointing the account is
       refused; a member of staff gets their own login. */
    /* Refused on save as well as disabled on the form: a select that is greyed
       out is a courtesy, not a rule. */
    if (modal !== 'add' && identityLocked(modal)
        && (form.contact_id || null) !== (modal.contact_id || null)) {
      setFormErr(`This account has already signed in (${String(modal.last_login_at).slice(0, 10)}), `
        + 'so the contact it belongs to is fixed. Re-pointing a used login at another contact would give it '
        + 'somebody else’s orders and statement. Only a super admin can change it.')
      return
    }
    if (modal !== 'add' && identityLocked(modal) && form.role !== modal.role) {
      setFormErr(`This account has already signed in (${String(modal.last_login_at).slice(0, 10)}), `
        + `so its category is fixed at ${roleLabel[modal.role] ?? modal.role}. `
        + 'Only a super admin can move a used account to another category — otherwise deactivate it '
        + 'and create the new account separately.')
      return
    }

    const OFFICE_ROLES = ['admin', 'senior_call_center', 'call_center']
    if (modal !== 'add' && modal.contact_id && OFFICE_ROLES.includes(form.role)) {
      setFormErr('This login belongs to a partner or supplier contact and cannot be changed into an office role. '
        + 'Create a separate account for office staff.')
      return
    }

    /* The seat allowance. Up to it the seat is included in the annual package;
       beyond it the seat is chargeable and only a super admin may take one.
       Checked on save rather than only on the form, so it cannot be stepped
       around by editing a row into a role whose seats are gone. */
    const seatCheck = form.status === 'active'
      ? checkSeat({
          users,
          role: form.role,
          excludeId: modal === 'add' ? null : modal.id,
          isSuperAdmin,
        })
      : { ok: true, chargeable: false, pos: null }
    if (!seatCheck.ok) { setFormErr(seatCheck.message); return }
    if (modal === 'add' && form.password.length < 8) {
      setFormErr('Set a temporary password of at least 8 characters.'); return
    }
    setSaving(true); setFormErr('')

    let rpcError
    if (modal === 'add') {
      const { data: newLoginId, error: e } = await supabase.rpc('admin_create_user', {
        p_actor_id:   currentUser.user_id,
        p_username:   form.username.trim(),
        p_email:      form.email.trim(),
        p_mobile:     form.mobile.trim(),
        p_password:   form.password,
        p_role:       form.role,
        p_status:     form.status,
        p_contact_id: form.contact_id || null,
      })

      /* A supplier or partner account is what a subscription is FOR, so one is
         opened the moment the account exists — but they are not the same one.
         A SUPPLIER gets the free 90 days their agreement promises. A PARTNER
         past the tenth gets no free period at all: the ten included seats are
         already taken, so an eleventh is a seat somebody has to pay for, and it
         is placed unpaid and inactive — they cannot sign in until the office
         confirms the payment. Nothing is issued to a partner inside the ten;
         they owe nothing, so there is nothing to open. */
      if (!e && form.contact_id) {
        const { data: c } = await supabase.from('contacts')
          .select('contact_types, contact_type').eq('id', form.contact_id).maybeSingle()
        const types = (c?.contact_types?.length ? c.contact_types : (c?.contact_type ? [c.contact_type] : []))
        const trial = await ensureLoginSubscription(form.contact_id, newLoginId, form.role, {
          companyId: currentUser?.company_id ?? null, userId: currentUser.user_id, contactTypes: types,
        })
        if (trial.error) console.warn('Could not open the subscription:', trial.error)
      }

      /* An OFFICE seat beyond the allowance is recorded so it can be invoiced.
         A partner or supplier subscribes as a contact and is handled above; a
         call-centre user or administrator has no contact, so the seat is
         attached to the login itself (fix146 widened subscriptions for exactly
         this). The row is left UNPAID and INACTIVE: it is a seat to bill, not a
         payment anybody has made, and office sign-in is not gated on it — the
         staff member works from the moment their account exists.

         The create RPC hands back nothing but an error, so the new login is
         found by its username, which is unique. A failure here is logged and
         swallowed: the account was created, and losing the billing note is a
         far smaller harm than an account that half-exists. */
      if (!e && seatCheck.chargeable && !form.contact_id) {
        try {
          const { data: fresh } = await supabase.from('user_accounts')
            .select('id').eq('username', form.username.trim()).maybeSingle()
          if (fresh?.id) {
            const today = new Date().toISOString().slice(0, 10)
            const until = new Date(); until.setFullYear(until.getFullYear() + 1); until.setDate(until.getDate() - 1)
            const { error: se } = await supabase.from('subscriptions').insert([{
              company_id:      currentUser?.company_id ?? null,
              user_account_id: fresh.id,
              description:     `${seatCheck.pos.label} seat ${seatCheck.pos.next} — beyond the ${seatCheck.pos.included} included`,
              start_date:      today,
              end_date:        until.toISOString().slice(0, 10),
              amount:          seatCheck.pos.rate,
              currency:        seatCheck.pos.currency,
              is_paid:         false,
              is_active:       false,
            }])
            if (se) console.warn('Could not record the chargeable seat:', se.message)
          }
        } catch (err) { console.warn('Could not record the chargeable seat:', err?.message) }
      }
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

      /* A role change can turn an office login into a party one — a call-centre
         user made a partner, say. That is the same event as creating a party
         login, so it opens the same subscription: nothing for a partner inside
         the ten, a payable seat for one beyond it, the free period for a
         supplier. Without this the converted login was left subject to a
         subscription and holding none: refused at sign-in, which is safe, but
         invisible in the money view — no row, no amount, nothing saying what is
         owed. That is exactly the state fix148 had to go back and clean up. */
      if (!e && form.contact_id && (form.role === 'partner' || form.role === 'supplier')) {
        const { data: c } = await supabase.from('contacts')
          .select('contact_types, contact_type').eq('id', form.contact_id).maybeSingle()
        const types = (c?.contact_types?.length ? c.contact_types : (c?.contact_type ? [c.contact_type] : []))
        const opened = await ensureLoginSubscription(form.contact_id, modal.id, form.role, {
          companyId: currentUser?.company_id ?? null, userId: currentUser.user_id, contactTypes: types,
        })
        if (opened.error) console.warn('Could not open the subscription:', opened.error)
      }
      rpcError = e
    }

    setSaving(false)
    if (rpcError) { setFormErr(friendlyError(rpcError.message)); return }
    // On a new account, surface the credentials once so they can be copied and
    // handed to the user — the password can't be retrieved later.
    if (modal === 'add') setCreated({ username: form.username.trim(), password: form.password })

    /* A new password typed into the Credentials panel is applied last, through
       the same RPC the Reset button uses, so there is one way passwords are
       written and one place that hashes them. A failure here is reported rather
       than swallowed: the rest of the edit saved, but the password did not, and
       an administrator who thinks they changed it and has not is exactly the
       person who will hand out the old one. */
    if (modal !== 'add' && credsPw) {
      if (credsPw.length < 8) { setFormErr('The new password must be at least 8 characters.'); setSaving(false); return }
      const { error: pe } = await supabase.rpc('admin_reset_password', {
        p_actor_id:     currentUser.user_id,
        p_user_id:      modal.id,
        p_new_password: credsPw,
      })
      if (pe) { setFormErr(`Details saved, but the password was not changed: ${friendlyError(pe.message)}`); setSaving(false); return }
      setCredsPw('')
    }
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

  /* ── delete for good (super admin only) ───────────────────
     Never a single click: the account's footprint is read first and shown, and
     the username has to be typed back. A user's id is stamped across the
     database, and the office should agree to what happens to those records —
     their own go with them, their name on other people's work is cleared —
     before any of it happens. */
  const [purge, setPurge] = useState(null)
  // { user, phase: 'scanning'|'review'|'working'|'done', rows, report, typed, error }

  async function openPurge(u) {
    setPurge({ user: u, phase: 'scanning', rows: [], report: [], typed: '', error: '' })
    const { rows, error } = await scanUserReferences(u.id, { actorId: currentUser.user_id })
    setPurge(p => (p && p.user.id === u.id
      ? { ...p, phase: error ? 'review' : 'review', rows, error: error || '' }
      : p))
  }

  async function confirmPurge() {
    const u = purge?.user
    if (!u) return
    setPurge(p => ({ ...p, phase: 'working', error: '' }))
    const { report, error } = await deleteUserAccount(u.id, { actorId: currentUser.user_id })
    if (error) { setPurge(p => ({ ...p, phase: 'review', error })); return }
    setPurge(p => ({ ...p, phase: 'done', report }))
    fetchUsers()
  }

  /* ── activate / deactivate ───────────────────────────────── */
  async function toggleStatus(u) {
    if (!isSuperAdmin) return
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
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-6 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <UserCog className="w-5 h-5 text-brand-400" />
        </div>
        <div className="relative flex-1 max-w-sm">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users…"
            className="input pl-9"
          />
        </div>
        {/* Super admin: the list as it is filtered right now, on the _NXCORE
            letterhead. It exports `filtered` — search, chips and sort — so
            what prints is what is on screen. */}
        {isSuperAdmin && (
          <button type="button" onClick={exportUsers} disabled={exporting || filtered.length === 0}
            title={anyFilter ? `Export the ${filtered.length} account(s) matching the current filters`
                             : 'Export every account'}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                       border-surface-border bg-surface-hover text-slate-200 hover:text-white disabled:opacity-40">
            {exporting ? <Loader className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Export PDF
            <span className="text-[11px] tabular-nums px-1.5 rounded bg-surface-border">{filtered.length}</span>
          </button>
        )}
        {/* Only the super admin creates a login here. An administrator adds a
            partner or supplier login from that contact's own profile, where it
            is linked to them and can never be pointed anywhere else. */}
        {isSuperAdmin && (
        <button className="btn-primary" onClick={openAdd}>
          <UserPlus className="w-4 h-4" /> New User
        </button>
        )}
      </div>

      {/* Filters. Only the roles and statuses actually present are offered —
          a filter that can only ever return nothing is just a dead end. */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-500 uppercase tracking-wider text-[10px]">Role</span>
        <div className="flex items-center gap-1 flex-wrap">
          <FilterChip on={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>
            All <span className="opacity-60">{visibleUsers.length}</span>
          </FilterChip>
          {rolesPresent.map(r => (
            <FilterChip key={r} on={roleFilter === r} onClick={() => setRoleFilter(r)}>
              {roleLabel[r] || r}{' '}
              <span className="opacity-60">{visibleUsers.filter(u => u.role === r).length}</span>
            </FilterChip>
          ))}
        </div>

        <span className="text-slate-500 uppercase tracking-wider text-[10px] ml-2">Status</span>
        <div className="flex items-center gap-1 flex-wrap">
          <FilterChip on={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</FilterChip>
          {['active', 'inactive', 'suspended', 'pending']
            .filter(st => visibleUsers.some(u => u.status === st))
            .map(st => (
              <FilterChip key={st} on={statusFilter === st} onClick={() => setStatusFilter(st)}
                cls={STATUS_STYLES[st]}>
                <span className="capitalize">{st}</span>{' '}
                <span className="opacity-60">{visibleUsers.filter(u => u.status === st).length}</span>
              </FilterChip>
            ))}
        </div>

        <span className="text-slate-500 uppercase tracking-wider text-[10px] ml-2">Presence</span>
        <div className="flex items-center gap-1">
          <FilterChip on={onlineFilter === 'all'} onClick={() => setOnlineFilter('all')}>All</FilterChip>
          <FilterChip on={onlineFilter === 'online'} onClick={() => setOnlineFilter('online')}
            cls="bg-green-500/10 text-green-300 border-green-500/30">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 align-middle" />
            Online <span className="opacity-60">{onlineCount}</span>
          </FilterChip>
          <FilterChip on={onlineFilter === 'offline'} onClick={() => setOnlineFilter('offline')}>
            Offline <span className="opacity-60">{visibleUsers.length - onlineCount}</span>
          </FilterChip>
        </div>

        {anyFilter && (
          <button onClick={() => { setRoleFilter('all'); setStatusFilter('all'); setOnlineFilter('all'); setSort({ key: null, dir: null }); setSearch('') }}
            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-border text-slate-400 hover:text-slate-200">
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

      {/* List. The table scrolls inside the card so its header can stay put:
          on a long list the column you are reading is otherwise off the top of
          the screen by the time you reach the rows you came for. */}
      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-card">
            <tr className="border-b border-surface-border">
              {[
                ['Username', 'username'], ['Email', 'email'], ['Mobile', 'mobile'],
                ['Role', 'role'], ['Status', 'status'], ['Online', 'online'],
                ...(isSuperAdmin ? [['Device', 'device']] : []),
                ['Last Login', 'last'], ['', null],
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
              <tr><td colSpan={isSuperAdmin ? 9 : 8} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={isSuperAdmin ? 9 : 8} className="px-4 py-10 text-center text-slate-500">No users found</td></tr>
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
                    {/* The name this account appears under once signed in. */}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {u.contact_id
                        ? (linkedContacts[u.contact_id]
                            ? `Signs in as ${contactLabel(linkedContacts[u.contact_id])}`
                            : 'Linked contact')
                        : 'Signs in as the username'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{u.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{u.mobile ? formatMobile(u.mobile) : '—'}</td>
                  <td className="px-4 py-3 text-slate-300">
                    <span className="inline-flex items-center gap-1.5">
                      {roleLabel[u.role] ?? u.role}
                      {/* What this seat costs. Included and Free trial are both
                          free today, which is exactly why they are drawn apart:
                          only one of them is still free next month. */}
                      {(() => {
                        const st = seatStatus(u, seatLookups)
                        if (st.key === 'na') return null
                        const until = st.row?.end_date ? ` · to ${String(st.row.end_date).slice(0, 10)}` : ''
                        const look = {
                          included: { Icon: ShieldCheck,     cls: 'text-slate-400' },
                          trial:    { Icon: CalendarClock,   cls: 'text-amber-400' },
                          paid:     { Icon: BadgeDollarSign, cls: 'text-green-400' },
                          // open while unpaid — same fuchsia as "awaiting payment"
                          due:      { Icon: BadgeDollarSign, cls: 'text-fuchsia-400' },
                          none:     { Icon: ShieldAlert,     cls: 'text-red-400' },
                        }[st.key] ?? { Icon: ShieldAlert, cls: 'text-slate-500' }
                        const Icon = look.Icon
                        return (
                          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${look.cls}`}
                            title={`${st.label} — ${st.note}${until}`} />
                        )
                      })()}
                    </span>
                  </td>
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
                  {/* Where this user is signed in — live devices from presence,
                      otherwise the last device the account was opened on. */}
                  {isSuperAdmin && (() => {
                    const live = liveDevices.get(String(u.id)) ?? []
                    return (
                      <td className="px-4 py-3">
                        {live.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {live.map((d, i) => (
                              <span key={d.device_id || i}
                                className="inline-flex items-center gap-1.5 text-[11px] text-slate-200 max-w-[220px]">
                                {d.is_desktop
                                  ? <Monitor className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                  : <Smartphone className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                                <span className="truncate" title={d.device_name}>{d.device_name || 'Unknown device'}</span>
                              </span>
                            ))}
                          </div>
                        ) : u.last_login_device ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 max-w-[220px]"
                            title={`Last seen${u.last_device_seen_at ? ` ${new Date(u.last_device_seen_at).toLocaleString()}` : ''} — ${u.last_login_device}`}>
                            <Monitor className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{u.last_login_device}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-600">—</span>
                        )}
                      </td>
                    )
                  })()}
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Changing a login is the super admin's alone (fix160). An
                          administrator may reset the password of a partner or
                          supplier login — which forces a change at the next
                          sign-in — and nothing else. The database refuses the
                          same things, so hiding them here is courtesy, not the rule. */}
                      {isSuperAdmin && (
                      <button onClick={() => openEdit(u)} title="Edit"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100">
                        <Pencil className="w-4 h-4" />
                      </button>
                      )}
                      {(isSuperAdmin || ['partner', 'supplier'].includes(u.role)) && (
                      <button onClick={() => openReset(u)} title="Reset password — they must change it at the next sign-in"
                        className="btn-ghost p-1.5 text-slate-400 hover:text-amber-300">
                        <KeyRound className="w-4 h-4" />
                      </button>
                      )}
                      {isSuperAdmin && (
                      <button onClick={() => toggleStatus(u)} disabled={isSelf || busyId === u.id}
                        title={isSelf ? 'You cannot change your own status' : (u.status === 'active' ? 'Deactivate' : 'Activate')}
                        className={`btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${u.status === 'active' ? 'text-slate-400 hover:text-red-400' : 'text-slate-400 hover:text-green-400'}`}>
                        {busyId === u.id
                          ? <Loader className="w-4 h-4 animate-spin" />
                          : (u.status === 'active' ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />)}
                      </button>
                      )}
                      {/* Permanent removal — the super admin's alone, and never
                          on themselves or another super admin. */}
                      {isSuperAdmin && (
                        <button onClick={() => openPurge(u)}
                          disabled={isSelf || u.role === 'super_admin' || busyId === u.id}
                          title={isSelf ? 'You cannot delete your own account'
                            : u.role === 'super_admin' ? 'A super admin account cannot be deleted'
                            : 'Delete this account for good'}
                          className="btn-ghost p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Delete a user for good ─────────────────────────────── */}
      {purge && (() => {
        const sum = summariseReferences(purge.rows)
        const typedOk = purge.typed.trim().toLowerCase() === purge.user.username.toLowerCase()
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="card w-full max-w-xl flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  {purge.phase === 'done' ? 'Account deleted' : `Delete ${purge.user.username} for good`}
                </h3>
                <button onClick={() => setPurge(null)} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                {purge.phase === 'scanning' && (
                  <p className="flex items-center gap-2 text-sm text-slate-300">
                    <Loader className="w-4 h-4 animate-spin" /> Reading what this account is attached to…
                  </p>
                )}

                {purge.phase === 'review' && (
                  <>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {sum.clean
                        ? <>This account has left no trace in any other record. Deleting it removes the account and nothing else.</>
                        : <>This account appears in <span className="text-slate-100 font-semibold">{sum.tables}</span> table{sum.tables === 1 ? '' : 's'}. Their own records go with them; their name on other people’s work is cleared, and that work is kept.</>}
                    </p>

                    {!sum.clean && (
                      <div className="rounded-lg border border-surface-border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-surface-hover/40 border-b border-surface-border">
                              {['Where', 'As', 'Rows', 'On delete'].map(h => (
                                <th key={h} className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {purge.rows.map((r, i) => (
                              <tr key={i} className="border-b border-surface-border/50 last:border-0">
                                <td className="px-3 py-2 text-slate-200 text-xs">{tableLabel(r.table_name)}</td>
                                <td className="px-3 py-2 text-slate-400 text-xs">{columnLabel(r.column_name)}</td>
                                <td className="px-3 py-2 text-slate-300 text-xs tabular-nums">{Number(r.rows_found).toLocaleString()}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${
                                    r.kind === 'own'
                                      ? 'bg-red-500/10 text-red-300 border-red-500/30'
                                      : r.kind === 'blocking'
                                        ? 'bg-rose-500/15 text-rose-200 border-rose-400/40'
                                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
                                    {r.kind === 'own' ? 'deleted with the account'
                                      : r.kind === 'blocking' ? 'blocks the delete'
                                      : 'name cleared, record kept'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {sum.blocking.length > 0 && (
                      <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3">
                        <p className="text-xs text-rose-100 leading-relaxed">
                          This account cannot be deleted. {sum.blockingRows.toLocaleString()} record
                          {sum.blockingRows === 1 ? '' : 's'} in{' '}
                          {sum.blocking.map(r => tableLabel(r.table_name)).join(', ')} record who acted on them in a
                          column that cannot be emptied — removing the name would mean deleting the record itself,
                          and that record is real work. Deactivate the account instead, or ask for those rows to be
                          reassigned first.
                        </p>
                      </div>
                    )}

                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
                      <p className="text-xs text-red-200 leading-relaxed">
                        This cannot be undone. {sum.ownRows > 0 && <>{sum.ownRows.toLocaleString()} of their own record{sum.ownRows === 1 ? '' : 's'} will be deleted. </>}
                        {sum.auditRows > 0 && <>{sum.auditRows.toLocaleString()} record{sum.auditRows === 1 ? '' : 's'} will lose the name of who acted on them. </>}
                        If you only want to stop them signing in, deactivate the account instead.
                      </p>
                      <label className="block">
                        <span className="text-[11px] text-slate-400">
                          Type <span className="font-mono text-slate-200">{purge.user.username}</span> to confirm
                        </span>
                        <input className="input mt-1 font-mono" value={purge.typed} autoFocus
                          onChange={e => setPurge(p => ({ ...p, typed: e.target.value }))} />
                      </label>
                    </div>
                  </>
                )}

                {purge.phase === 'working' && (
                  <p className="flex items-center gap-2 text-sm text-slate-300">
                    <Loader className="w-4 h-4 animate-spin" /> Deleting…
                  </p>
                )}

                {purge.phase === 'done' && (
                  <>
                    <p className="text-sm text-slate-300">
                      <span className="text-slate-100 font-semibold">{purge.user.username}</span> has been deleted.
                      Here is what changed:
                    </p>
                    <div className="rounded-lg border border-surface-border overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody>
                          {purge.report.map((r, i) => (
                            <tr key={i} className="border-b border-surface-border/50 last:border-0">
                              <td className="px-3 py-2 text-slate-200 text-xs">{tableLabel(r.table_name)}</td>
                              <td className="px-3 py-2 text-slate-400 text-xs">{columnLabel(r.column_name)}</td>
                              <td className="px-3 py-2 text-slate-300 text-xs tabular-nums">{Number(r.rows_affected).toLocaleString()}</td>
                              <td className="px-3 py-2 text-[11px] text-slate-400">{r.action === 'deleted' ? 'deleted' : 'name cleared'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {purge.error && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-xs leading-relaxed">{purge.error}</p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
                <button onClick={() => setPurge(null)} className="btn-ghost px-4 py-2 text-sm border border-surface-border">
                  {purge.phase === 'done' ? 'Close' : 'Cancel'}
                </button>
                {purge.phase === 'review' && (
                  <button onClick={confirmPurge} disabled={!typedOk || sum.blocking.length > 0}
                    title={sum.blocking.length > 0 ? 'Blocked — see above' : undefined}
                    className="px-4 py-2 text-sm rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed">
                    Delete permanently
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
              {form.contact_id && isPartyRole && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/10 border border-brand-500/30 text-brand-300 text-[11px]">
                  <UserPlus className="w-3.5 h-3.5 flex-shrink-0" />
                  This login will be linked to the selected contact, so they’ll see only their own orders.
                </div>
              )}

              {/* An office login carries no scoping, but a linked contact still
                  supplies the name shown once signed in — so if it points at the
                  wrong person, that is what everyone sees. Always show it, and
                  let it be removed. */}
              {modal !== 'add' && !isPartyRole && form.contact_id && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">Linked contact</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-200 flex-1 truncate">
                      {linkedContacts[form.contact_id]
                        ? contactLabel(linkedContacts[form.contact_id])
                        : 'Unknown contact'}
                    </span>
                    <button type="button" onClick={() => setForm(f => ({ ...f, contact_id: '' }))}
                      className="btn-ghost py-1 px-2 text-[11px] text-slate-300 border border-surface-border hover:text-red-300">
                      <X className="w-3.5 h-3.5" /> Remove link
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    This account signs in under this name. Remove the link to sign in under the
                    username instead.
                  </p>
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
                <select className="input disabled:opacity-60 disabled:cursor-not-allowed" value={form.role}
                  disabled={modal !== 'add' && identityLocked(modal)}
                  onChange={e => {
                    const role = e.target.value
                    // Drop any linked contact when leaving a supplier/partner role.
                    const keepLink = role === 'supplier' || role === 'partner'
                    setForm(f => ({ ...f, role, contact_id: keepLink ? f.contact_id : '' }))
                    setFormErr('')
                  }}>
                  {ASSIGNABLE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {modal !== 'add' && identityLocked(modal) && (
                  <p className="text-[11px] mt-1 text-slate-500 leading-relaxed">
                    <span className="text-slate-300">Category and linked contact are fixed.</span> This account
                    first signed in on {String(modal.last_login_at).slice(0, 10)}. An account that has been used
                    cannot be moved to another category, nor re-pointed at another contact — deactivate it and
                    create a separate account instead. A super admin can still change both.
                  </p>
                )}

                {/* Where this role's seats stand, before the save is attempted.
                    An administrator sees the wall coming; a super admin sees the
                    price of stepping over it. */}
                {(() => {
                  const pos = seatPosition({
                    users, role: form.role, excludeId: modal === 'add' ? null : modal.id,
                  })
                  if (!pos) return null
                  const over = !pos.free
                  return (
                    <p className={`text-[11px] mt-1 ${
                      over ? (isSuperAdmin ? 'text-amber-400' : 'text-red-400') : 'text-slate-500'}`}>
                      {pos.used} of {pos.included} included {pos.label.toLowerCase()} seats used
                      {over && (isSuperAdmin
                        ? ` — seat ${pos.next} is chargeable at ${seatPrice(pos)}`
                        : ` — seat ${pos.next} needs a super admin (${seatPrice(pos)})`)}
                      {over && pos.provisional && ' · allowance agreed with the client, not an article of the licence'}
                    </p>
                  )
                })()}
              </div>

              {/* Supplier/Partner logins must be tied to a contact (contact_id). */}
              {isPartyRole && (
                <div>
                  <label className="label capitalize">{form.role} contact *</label>
                  <select className="input disabled:opacity-60 disabled:cursor-not-allowed"
                    value={form.contact_id || ''}
                    disabled={modal !== 'add' && identityLocked(modal)}
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
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Links the login to this contact so they only see their own orders.
                    {modal !== 'add' && identityLocked(modal) && (
                      <> <span className="text-slate-300">Fixed since this account first signed in</span> —
                      re-pointing it would hand this login somebody else’s orders and statement. Only a super
                      admin can change it.</>
                    )}
                  </p>
                </div>
              )}

              {/* ── Credentials (super admin, editing an existing account) ──
                  Reveal shows the USERNAME, which is stored as typed. It cannot
                  show the current password, and neither can anything else: the
                  column holds a bcrypt hash — crypt(pw, gen_salt('bf', 12)) —
                  which is one-way by design. Nobody, including the super admin
                  and including whoever runs the database, can read an existing
                  password back. What the panel offers instead is the thing that
                  is actually useful: set a new one, read it in clear, copy it,
                  hand it over. */}
              {modal !== 'add' && isSuperAdmin && (
                <div className="rounded-lg border border-surface-border bg-surface-hover/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="label mb-0 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-slate-400" /> Credentials
                    </span>
                    <button type="button"
                      onClick={() => setCredsOpen(o => !o)}
                      className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                      {credsOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {credsOpen ? 'Hide' : 'Reveal'}
                    </button>
                  </div>

                  {credsOpen && (
                    <div className="mt-2.5 space-y-2.5">
                      {/* Username — readable and copyable as it stands. */}
                      <div>
                        <label className="label text-[10px]">Username</label>
                        <div className="relative">
                          <input readOnly className="input pr-9 font-mono" value={form.username} />
                          <button type="button" title="Copy username"
                            onClick={() => copy(form.username, 'creds-user')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 btn-ghost p-1.5 text-slate-500 hover:text-slate-200">
                            {copied === 'creds-user' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Password — a NEW one, or nothing. */}
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="label text-[10px] mb-0">New password</label>
                          <button type="button"
                            onClick={() => { setCredsPw(generatePassword()); setShowPw(true); setFormErr('') }}
                            className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                            <RefreshCw className="w-3 h-3" /> Generate
                          </button>
                        </div>
                        <div className="relative mt-1">
                          <input type={showPw ? 'text' : 'password'} className="input pr-16 font-mono"
                            value={credsPw} placeholder="Leave blank to keep the current password"
                            onChange={e => { setCredsPw(e.target.value); setFormErr('') }} />
                          <button type="button" title={showPw ? 'Hide' : 'Show'}
                            onClick={() => setShowPw(v => !v)}
                            className="absolute right-8 top-1/2 -translate-y-1/2 btn-ghost p-1.5 text-slate-500 hover:text-slate-200">
                            {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button type="button" title="Copy password" disabled={!credsPw}
                            onClick={() => copy(credsPw, 'creds-pw')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 btn-ghost p-1.5 text-slate-500 hover:text-slate-200 disabled:opacity-30">
                            {copied === 'creds-pw' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                          The current password cannot be shown — only a one-way hash of it is stored, so it is
                          unreadable to everyone including you. Set a new one here and it is applied when you save.
                        </p>
                      </div>

                      {credsPw && (
                        <button type="button"
                          onClick={() => copy(`Username: ${form.username}
Password: ${credsPw}`, 'creds-both')}
                          className="inline-flex items-center gap-1.5 text-[11px] text-brand-400 hover:text-brand-300">
                          {copied === 'creds-both' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          Copy username and password together
                        </button>
                      )}
                    </div>
                  )}
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
                <div className="flex items-center justify-between">
                  <label className="label">New password *</label>
                  {/* Same convenience as creating an account: a strong password
                      in one click, shown so it can be handed over. */}
                  <button type="button"
                    onClick={() => { setResetPw(generatePassword()); setShowPw(true); setResetErr('') }}
                    className="text-[11px] text-brand-300 hover:text-brand-200 mb-1">
                    Generate
                  </button>
                </div>
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
                {copied === 'creds-both' ? <><Check className="w-4 h-4 text-green-400" /> Copied</> : <><Copy className="w-4 h-4" /> Copy both</>}
              </button>
              <button onClick={() => setCreated(null)} className="btn-primary px-4 py-2 text-sm">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
