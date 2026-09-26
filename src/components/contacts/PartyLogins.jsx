import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, UserPlus, Loader, Copy, Check, AlertCircle, RefreshCw, ExternalLink, MonitorSmartphone, Gift } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  fetchLoginsForContact, ensureLoginSubscription, rowsForLogin, freeSeatMap,
  subscriptionStatus, STATUS_STYLES, TRIAL_DAYS, RATE_CURRENCY, PARTNER_FREE_LIMIT,
} from '../../lib/subscriptions'
import { SEATS, SUPPLIER_SUBSCRIPTION } from '../../lib/billing'

/* A PARTNER'S OR SUPPLIER'S LOGINS, managed from its own profile (fix160).

   This is the only place an administrator creates one. A login made here is
   linked to THIS contact by the database — the caller cannot choose another —
   and once made, an administrator cannot edit, move, switch off or delete it.
   What an administrator can still do is reset its password, and that always
   forces the holder to set their own at the next sign-in. Everything else is
   the super admin's, on User Accounts.

   Each login carries its own subscription, opened the moment it is created:
   nothing for a partner inside the free ten, a payable seat for a partner
   beyond it (unpaid and switched off until the super admin activates it or
   records the payment), the free trial for a supplier. */

const PW_MIN = 8

function generatePassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(len)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

function friendly(msg = '') {
  if (/admin_create_party_login/i.test(msg) && /not exist|schema cache/i.test(msg)) {
    return 'Creating logins from the profile is not installed yet — run supabase-fix160.sql.'
  }
  if (/duplicate key/i.test(msg) && /username/i.test(msg)) return 'That username is already taken — choose another.'
  if (/duplicate key/i.test(msg) && /email/i.test(msg))    return 'That email is already used by another login.'
  if (/NOT_AUTHORIZED/.test(msg))       return 'Only an administrator or the super admin can do this.'
  if (/PASSWORD_TOO_SHORT/.test(msg))   return `The password must be at least ${PW_MIN} characters.`
  if (/USERNAME_REQUIRED/.test(msg))    return 'Enter a username.'
  if (/MOBILE_REQUIRED/.test(msg))      return 'Enter a mobile number.'
  if (/CONTACT_INACTIVE/.test(msg))     return 'This contact is deactivated, so it cannot be given a login.'
  if (/NOT_A_PARTY/.test(msg))          return 'Only a partner or a supplier can be given a portal login.'
  if (/ROLE_REQUIRED/.test(msg))        return 'Choose whether this is a partner login or a supplier login.'
  if (/ROLE_NOT_ON_CONTACT/.test(msg))  return 'This contact is not marked with that type — tick it on the profile first.'
  if (/NO_FREE_SEAT/.test(msg))         return `All ${PARTNER_FREE_LIMIT} free seats are in use.`
  if (/ALREADY_HOLDS_SEAT/.test(msg))   return 'This partner already holds a free seat.'
  if (/NOT_A_PARTNER/.test(msg))        return 'Only a partner can be given a free seat.'
  if (/assign_free_partner_seat/i.test(msg) && /not exist|schema cache/i.test(msg)) {
    return 'Assigning free seats needs supabase-fix163.sql.'
  }
  return msg || 'Something went wrong.'
}

function Copyable({ value }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* select it by hand */ }
      }}
      className="inline-flex items-center gap-1 text-[11px] text-brand-300 hover:text-brand-200">
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{done ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function PartyLogins({ contact, role, isSuperAdmin, canAssignSeat = false, currentUser, companyId, suggestUsername }) {
  const navigate = useNavigate()
  const [logins,  setLogins]  = useState([])
  const [subs,    setSubs]    = useState([])
  // Free seats across ALL partners, to know whether one is available (fix163).
  const [seatRows, setSeatRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState({ role: 'partner', username: '', mobile: '', email: '', password: '' })
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  // Credentials shown ONCE, right after they are set, to hand over.
  const [issued,  setIssued]  = useState(null)   // { username, password, note }

  const load = useCallback(async () => {
    if (!contact?.id) return
    setLoading(true)
    const [ls, { data: rows }, seatQ] = await Promise.all([
      fetchLoginsForContact(contact.id),
      supabase.from('subscriptions').select('*').eq('contact_id', contact.id),
      supabase.from('subscriptions').select('contact_id, start_date, end_date, is_active, is_free_seat, amount, description')
        .eq('is_free_seat', true),
    ])
    setLogins(ls); setSubs(rows ?? []); setSeatRows(seatQ.error ? null : (seatQ.data ?? []))
    setLoading(false)
  }, [contact?.id])

  useEffect(() => { load() }, [load])

  /* The kinds of portal login this contact can have: one per type it carries.
     A partner that is also a supplier holds SEPARATE partner and supplier
     logins, each with its own subscription (fix163). */
  const contactTypes = Array.isArray(contact?.contact_types) && contact.contact_types.length
    ? contact.contact_types : (contact?.contact_type ? [contact.contact_type] : [])
  const roles = ['partner', 'supplier'].filter(r => contactTypes.includes(r))

  function suggestFor(r) {
    // Its own name per kind, so a partner login and a supplier login are never
    // confused (usernames are unique anyway).
    const base = (suggestUsername?.() || 'user').slice(0, 22) + (roles.length > 1 ? `.${r}` : '')
    const taken = new Set(logins.map(l => l.username))
    let name = base, i = 2
    while (taken.has(name)) name = `${base}.${i++}`
    return name
  }

  function startAdd() {
    const r = roles[0] || role || 'partner'
    setForm({ role: r, username: suggestFor(r), mobile: contact?.mobile || '', email: contact?.email || '', password: generatePassword() })
    setErr(''); setIssued(null); setAdding(true)
  }

  async function createLogin() {
    if (form.username.trim().length < 3) { setErr('The username must be at least 3 characters.'); return }
    if (!form.mobile.trim())              { setErr('Enter a mobile number.'); return }
    if (form.password.length < PW_MIN)    { setErr(`The password must be at least ${PW_MIN} characters.`); return }
    setBusy(true); setErr('')
    const { data: loginId, error } = await supabase.rpc('admin_create_party_login', {
      p_actor_id:   currentUser?.user_id,
      p_contact_id: contact.id,
      p_username:   form.username.trim(),
      p_email:      form.email.trim(),
      p_mobile:     form.mobile.trim(),
      p_password:   form.password,
      p_role:       form.role,
    })
    if (error) { setBusy(false); setErr(friendly(error.message)); return }

    const sub = await ensureLoginSubscription(contact.id, loginId, form.role, {
      companyId, userId: currentUser?.user_id || null, contactTypes,
    })
    const payable = Number(sub.row?.amount) > 0
    const note = sub.error
      ? `The login works, but its subscription could not be opened (${sub.error}). Tell the super admin.`
      : sub.exempt
        ? `This partner holds a free seat, so the login is free until ${sub.row?.end_date}. They can sign in now.`
        : sub.attached
          ? 'The subscription already placed for this partner is now this login’s. It is unpaid: they can sign in once the super admin activates it or records the payment.'
          : payable
            ? `A payable subscription of ${RATE_CURRENCY} ${sub.row.amount} is opened for this login, unpaid. `
              + 'They can sign in once the super admin activates it or records the payment.'
            : sub.created
              ? `A free ${TRIAL_DAYS}-day subscription starts today. They can sign in now.`
              : 'They can sign in now.'
    setIssued({ username: form.username.trim(), password: form.password, note })
    setBusy(false); setAdding(false)
    load()
  }

  /* Give this partner one of the free seats for a year (fix163). The database
     refuses an eleventh seat or a second one for the same partner. */
  async function assignSeat() {
    setBusy(true); setErr('')
    const { data: end, error } = await supabase.rpc('assign_free_partner_seat', {
      p_actor_id: currentUser?.user_id, p_contact_id: contact.id,
    })
    setBusy(false)
    if (error) { setErr(friendly(error.message)); return }
    setIssued(null)
    setErr('')
    await load()
    setSeatNote(`Free seat assigned until ${end}. All this partner’s partner logins are free for the year.`)
  }
  const [seatNote, setSeatNote] = useState('')

  async function resetPassword(l) {
    const pw = generatePassword()
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('admin_reset_password', {
      p_actor_id: currentUser?.user_id, p_user_id: l.id, p_new_password: pw,
    })
    setBusy(false)
    if (error) { setErr(friendly(error.message)); return }
    setIssued({ username: l.username, password: pw,
      note: 'Temporary password — they must choose their own at the next sign-in.' })
    load()
  }

  const subFor = (l) => {
    const mine = rowsForLogin(subs, l.id)
    return mine.find(r => ['active', 'credit', 'grace'].includes(subscriptionStatus(r))) || mine[0] || null
  }
  /* This partner's free seat, and how many of the ten are held across all
     partners. seatRows is null before fix163 (no is_free_seat column yet). */
  const seat = freeSeatMap(subs).get(contact?.id) || null
  const freeSeat = !!seat?.active
  const seatsInUse = seatRows ? freeSeatMap(seatRows).size : null
  const seatsLeft  = seatsInUse == null ? null : Math.max(0, PARTNER_FREE_LIMIT - seatsInUse)
  const isPartner  = roles.includes('partner')
  const roleName   = roles.length > 1 ? 'partner and supplier' : (roles[0] || role)

  return (
    <div className="border border-surface-border rounded-lg p-3 bg-surface-hover/30 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-300 flex items-center gap-1.5">
          <MonitorSmartphone className="w-3.5 h-3.5 text-brand-400" /> Portal logins
        </p>
        <span className="text-[11px] text-slate-500">{logins.length}</span>
        {!adding && (
          <button type="button" onClick={startAdd} className="btn-primary ml-auto py-1.5 text-xs">
            <UserPlus className="w-3.5 h-3.5" /> Add login
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        For this {roleName}’s staff to sign in to the <span className="text-slate-300">portal</span> and see their
        own orders, packages and statements — one login per person, each with its own subscription.
        {roles.length > 1 && <> A partner login and a supplier login are separate, with separate usernames.</>}
        {' '}These are not the customer app login below.
      </p>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {isSuperAdmin
          ? 'You can edit, move, switch off or delete a login on User Accounts.'
          : 'Once created, a login is fixed: you cannot edit, move, switch off or delete it — that is the super admin’s. '
            + 'If the user forgets the password, reset it here; they choose a new one at their next sign-in.'}
      </p>

      {isPartner && (
        <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 flex-wrap ${freeSeat
          ? 'border-green-500/30 bg-green-500/5' : 'border-surface-border'}`}>
          <Gift className={`w-3.5 h-3.5 ${freeSeat ? 'text-green-400' : 'text-slate-500'}`} />
          <span className="text-[11px] text-slate-300">
            {freeSeat
              ? <>Holds a free partner seat until <span className="font-medium">{seat.end}</span> — its partner logins are free.</>
              : seat
                ? <>Holds a free seat until {seat.end}, but it is switched off — partner logins are refused.</>
                : <>No free seat — each partner login pays {RATE_CURRENCY} {SEATS.partner.extraRate} a year.</>}
          </span>
          {seatsInUse != null && (
            <span className="text-[10px] text-slate-500">{seatsInUse} of {PARTNER_FREE_LIMIT} seats in use</span>
          )}
          {canAssignSeat && !seat && seatsLeft > 0 && (
            <button type="button" onClick={assignSeat} disabled={busy}
              className="ml-auto text-[11px] px-2 py-1 rounded border border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20 disabled:opacity-40">
              Assign a free seat for one year
            </button>
          )}
        </div>
      )}
      {seatNote && <p className="text-[11px] text-green-300">{seatNote}</p>}

      {issued && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 space-y-1.5">
          <p className="text-[11px] text-green-300 font-medium">Hand these over now — the password is not shown again.</p>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-400 w-20">Username</span>
            <span className="font-mono text-slate-100">{issued.username}</span>
            <Copyable value={issued.username} />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-400 w-20">Password</span>
            <span className="font-mono text-slate-100">{issued.password}</span>
            <Copyable value={issued.password} />
          </div>
          <p className="text-[11px] text-slate-400">{issued.note}</p>
        </div>
      )}

      {err && (
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />{err}
        </p>
      )}

      {adding && (
        <div className="rounded-lg border border-surface-border p-3 space-y-2.5">
          {roles.length > 1 && (
            <div>
              <label className="label">Login for *</label>
              <div className="flex gap-1.5">
                {roles.map(r => (
                  <button key={r} type="button"
                    onClick={() => setForm(f => ({ ...f, role: r, username: suggestFor(r) }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${form.role === r
                      ? 'bg-brand-500/15 border-brand-500/40 text-brand-200' : 'border-surface-border text-slate-400 hover:text-slate-200'}`}>
                    {r} portal
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="label" htmlFor="pl-user">Username *</label>
              <input id="pl-user" className="input font-mono" value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value.trim().toLowerCase() }))} />
            </div>
            <div>
              <label className="label" htmlFor="pl-mobile">Mobile *</label>
              <input id="pl-mobile" className="input" value={form.mobile}
                onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="pl-email">Email</label>
              <input id="pl-email" className="input" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="pl-pw">Temporary password *</label>
              <div className="flex gap-1.5">
                <input id="pl-pw" className="input font-mono" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                <button type="button" title="Generate another"
                  onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}
                  className="btn-ghost p-2 text-slate-400 hover:text-slate-100"><RefreshCw className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            {form.role === 'partner'
              ? (freeSeat
                  ? `This partner holds a free seat until ${seat.end}, so the login is free until then.`
                  : `A payable seat of ${RATE_CURRENCY} ${SEATS.partner.extraRate} a year opens with it, unpaid — sign-in waits for the super admin to activate it.`)
              : (isPartner
                  ? `A partner adding supplier access pays for it: a ${SUPPLIER_SUBSCRIPTION.plans[0].name} plan of ${RATE_CURRENCY} ${SUPPLIER_SUBSCRIPTION.plans[0].price} a month opens with it, unpaid — the free partner seat does not cover it.`
                  : `A supplier login starts with a free ${TRIAL_DAYS}-day subscription.`)}
            {' '}The holder must change the password at the first sign-in.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={createLogin} disabled={busy}>
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Create login
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Loader className="w-3.5 h-3.5 animate-spin" /> Loading…</p>
      ) : logins.length === 0 ? (
        <p className="text-[11px] text-slate-500">No login yet.</p>
      ) : (
        <div className="divide-y divide-surface-border/60">
          {logins.map(l => {
            const r  = subFor(l)
            const st = r ? subscriptionStatus(r) : null
            const cfg = st ? STATUS_STYLES[st] : null
            return (
              <div key={l.id} className="flex items-center gap-3 py-2 flex-wrap">
                <span className="font-mono text-xs text-slate-100">{l.username}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-surface-border text-slate-400 capitalize">{l.role}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${l.status === 'active'
                  ? 'border-green-500/30 bg-green-500/10 text-green-300'
                  : 'border-slate-500/30 bg-slate-500/10 text-slate-400'}`}>{l.status}</span>
                {cfg ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cfg.cls}`}
                    title={`${r.description || 'Subscription'} · ${r.start_date} to ${r.end_date}`}>{cfg.label}</span>
                ) : (
                  <span className="text-[10px] text-slate-500">{l.role === 'partner' && freeSeat ? 'free partner seat' : 'no subscription'}</span>
                )}
                {l.must_change_password && <span className="text-[10px] text-amber-400">password to change</span>}
                <span className="text-[10px] text-slate-500 ml-auto">
                  {l.last_login_at ? `last in ${new Date(l.last_login_at).toLocaleDateString()}` : 'never signed in'}
                </span>
                <button type="button" onClick={() => resetPassword(l)} disabled={busy}
                  title="Reset the password — they must set their own at the next sign-in"
                  className="btn-ghost p-1.5 text-slate-400 hover:text-amber-300 disabled:opacity-40">
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                {isSuperAdmin && (
                  <button type="button" title="Edit, switch off or delete on User Accounts"
                    onClick={() => navigate('/settings/users', { state: { search: l.username } })}
                    className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
