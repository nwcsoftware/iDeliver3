import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, UserPlus, Loader, Copy, Check, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  fetchLoginsForContact, ensureLoginSubscription, subscriptionScope, rowsForLogin,
  subscriptionStatus, STATUS_STYLES, SCOPE, TRIAL_DAYS, RATE_CURRENCY,
} from '../../lib/subscriptions'

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

export default function PartyLogins({ contact, role, isSuperAdmin, currentUser, companyId, suggestUsername }) {
  const navigate = useNavigate()
  const [logins,  setLogins]  = useState([])
  const [subs,    setSubs]    = useState([])
  const [scope,   setScope]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState({ username: '', mobile: '', email: '', password: '' })
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  // Credentials shown ONCE, right after they are set, to hand over.
  const [issued,  setIssued]  = useState(null)   // { username, password, note }

  const load = useCallback(async () => {
    if (!contact?.id) return
    setLoading(true)
    const [ls, sc, { data: rows }] = await Promise.all([
      fetchLoginsForContact(contact.id),
      subscriptionScope(contact.id),
      supabase.from('subscriptions').select('*').eq('contact_id', contact.id),
    ])
    setLogins(ls); setScope(sc); setSubs(rows ?? []); setLoading(false)
  }, [contact?.id])

  useEffect(() => { load() }, [load])

  function startAdd() {
    const base = (suggestUsername?.() || 'user').slice(0, 26)
    const taken = new Set(logins.map(l => l.username))
    let name = base, i = 2
    while (taken.has(name)) name = `${base}.${i++}`
    setForm({ username: name, mobile: contact?.mobile || '', email: contact?.email || '', password: generatePassword() })
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
    })
    if (error) { setBusy(false); setErr(friendly(error.message)); return }

    const types = Array.isArray(contact.contact_types) && contact.contact_types.length
      ? contact.contact_types : (contact.contact_type ? [contact.contact_type] : [])
    const sub = await ensureLoginSubscription(contact.id, loginId, types, {
      companyId, userId: currentUser?.user_id || null,
    })
    const payable = Number(sub.row?.amount) > 0
    const note = sub.error
      ? `The login works, but its subscription could not be opened (${sub.error}). Tell the super admin.`
      : sub.exempt
        ? 'Inside the ten free partner seats — no subscription is needed. They can sign in now.'
        : sub.attached
          ? 'The subscription already placed for this partner is now this login’s. It is unpaid: they can sign in once the super admin activates it or records the payment.'
          : payable
            ? `A payable seat of ${RATE_CURRENCY} ${sub.row.amount} a year is opened for this login, unpaid. `
              + 'They can sign in once the super admin activates it or records the payment.'
            : sub.created
              ? `A free ${TRIAL_DAYS}-day subscription starts today. They can sign in now.`
              : 'They can sign in now.'
    setIssued({ username: form.username.trim(), password: form.password, note })
    setBusy(false); setAdding(false)
    load()
  }

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
  const freeSeat = scope?.scope === SCOPE.partnerFree

  return (
    <div className="border border-surface-border rounded-lg p-3 bg-surface-hover/30 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-300 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-brand-400" /> Logins
        </p>
        <span className="text-[11px] text-slate-500">{logins.length}</span>
        {!adding && (
          <button type="button" onClick={startAdd} className="btn-primary ml-auto py-1.5 text-xs">
            <UserPlus className="w-3.5 h-3.5" /> Add login
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Each login signs in as this {role} and holds its own subscription. Once created it is fixed to this
        contact{isSuperAdmin ? '' : ': an administrator can reset its password but cannot edit, move or switch it off'}.
      </p>

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
            {freeSeat
              ? 'This partner is inside the ten free seats, so the login needs no subscription.'
              : role === 'supplier'
                ? `A supplier login starts with a free ${TRIAL_DAYS}-day subscription.`
                : `A payable seat of ${RATE_CURRENCY} 10 a year opens with it, unpaid — sign-in waits for the super admin to activate it.`}
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
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${l.status === 'active'
                  ? 'border-green-500/30 bg-green-500/10 text-green-300'
                  : 'border-slate-500/30 bg-slate-500/10 text-slate-400'}`}>{l.status}</span>
                {cfg ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cfg.cls}`}
                    title={`${r.description || 'Subscription'} · ${r.start_date} to ${r.end_date}`}>{cfg.label}</span>
                ) : (
                  <span className="text-[10px] text-slate-500">{freeSeat ? 'free partner seat' : 'no subscription'}</span>
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
