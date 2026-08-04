import React, { useState, useEffect, useCallback } from 'react'
import {
  Megaphone, Send, Info, AlertTriangle, AlertOctagon, Loader, CheckCircle2,
  Users, Eye, Ban, Clock, MessageSquare, MonitorSmartphone,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import SearchMultiSelect from '../components/SearchMultiSelect'

// Who a broadcast can be aimed at. Empty selection = everyone.
const AUDIENCE_ROLES = [
  { value: 'call_center', label: 'Call Center' },
  { value: 'admin',       label: 'Admins' },
  { value: 'driver',      label: 'Drivers' },
  { value: 'partner',     label: 'Partners' },
  { value: 'supplier',    label: 'Suppliers' },
  { value: 'customer',    label: 'Customers' },
]
const roleLabel = Object.fromEntries(AUDIENCE_ROLES.map(r => [r.value, r.label]))

const PRIORITIES = [
  { value: 'info',     label: 'Info',    icon: Info,          cls: 'text-brand-300 border-brand-500/40 bg-brand-500/10' },
  { value: 'warning',  label: 'Important', icon: AlertTriangle, cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  { value: 'critical', label: 'Urgent',  icon: AlertOctagon,  cls: 'text-red-300 border-red-500/40 bg-red-500/10' },
]

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function MessagesPage() {
  const { sendMessage, deactivateMessage } = useApp()
  const { currentUser, hasRole } = useAuth()
  // Broadcast messaging is reserved for the super_admin (the developer).
  const isAdmin = hasRole('super_admin')

  const [title,    setTitle]    = useState('')
  const [body,     setBody]     = useState('')
  const [priority, setPriority] = useState('info')
  const [displayMode, setDisplayMode] = useState('popup')   // popup | icon
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState('')
  const [sent,     setSent]     = useState('')

  const [list,        setList]        = useState([])   // [{ ...message, readCount }]
  const [audience,    setAudience]    = useState(0)    // active accounts (read target size)
  const [loadingList, setLoadingList] = useState(true)
  const [busyId,      setBusyId]      = useState(null)

  // Audience: roles and/or specific accounts. Both empty = everyone.
  const [toRoles,   setToRoles]   = useState([])
  const [toUserIds, setToUserIds] = useState([])
  const [users,     setUsers]     = useState([])       // active accounts, for the picker

  useEffect(() => {
    if (!isAdmin) return
    ;(async () => {
      let q = supabase.from('user_accounts')
        .select('id,username,role,status')
        .eq('status', 'active')
        .order('username')
      if (currentUser?.company_id) q = q.eq('company_id', currentUser.company_id)
      const { data } = await q
      setUsers(data ?? [])
    })()
  }, [isAdmin, currentUser?.company_id])

  // How many active accounts the current selection reaches.
  const targetCount = (toRoles.length === 0 && toUserIds.length === 0)
    ? users.length
    : users.filter(u => toRoles.includes(u.role) || toUserIds.includes(u.id)).length

  const userOptions = users.map(u => ({
    value: u.id,
    label: `${u.username}${roleLabel[u.role] ? ` · ${roleLabel[u.role]}` : ''}`,
  }))

  // How many active accounts a sent message was aimed at, for "X of Y read".
  // Falls back to the whole audience for messages sent before targeting.
  function messageAudience(m) {
    const roles = m.audience_roles ?? []
    const ids   = (m.audience_user_ids ?? []).map(String)
    if (roles.length === 0 && ids.length === 0) return audience
    if (users.length === 0) return 0
    return users.filter(u => roles.includes(u.role) || ids.includes(String(u.id))).length
  }

  function toggleRole(r) {
    setToRoles(cur => (cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r]))
    setError('')
  }

  // Load this company's messages (active + recalled) with per-message read counts,
  // plus the size of the audience so each row can show "X of Y read".
  const fetchList = useCallback(async () => {
    setLoadingList(true)
    let mq = supabase.from('broadcast_messages').select('*').order('created_at', { ascending: false })
    if (currentUser?.company_id) mq = mq.eq('company_id', currentUser.company_id)
    const { data: msgs, error: e } = await mq
    if (e) { setError(e.message); setLoadingList(false); return }

    const ids = (msgs ?? []).map(m => m.id)
    let counts = {}
    if (ids.length) {
      const { data: reads } = await supabase
        .from('broadcast_message_reads').select('message_id').in('message_id', ids)
      for (const r of reads ?? []) counts[r.message_id] = (counts[r.message_id] || 0) + 1
    }

    let uq = supabase.from('user_accounts').select('id', { count: 'exact', head: true }).eq('status', 'active')
    if (currentUser?.company_id) uq = uq.eq('company_id', currentUser.company_id)
    const { count } = await uq
    setAudience(count || 0)

    setList((msgs ?? []).map(m => ({ ...m, readCount: counts[m.id] || 0 })))
    setLoadingList(false)
  }, [currentUser?.company_id])

  useEffect(() => { fetchList() }, [fetchList])

  async function handleSend() {
    if (!title.trim() || !body.trim()) { setError('Title and message are required.'); return }
    setSending(true); setError(''); setSent('')
    const res = await sendMessage({ title, body, priority, displayMode, audienceRoles: toRoles, audienceUserIds: toUserIds })
    setSending(false)
    if (res.error) { setError(res.error); return }
    const who = (toRoles.length === 0 && toUserIds.length === 0)
      ? 'all users'
      : [toRoles.map(r => roleLabel[r]).join(', '), toUserIds.length ? `${toUserIds.length} selected user${toUserIds.length === 1 ? '' : 's'}` : '']
          .filter(Boolean).join(' + ')
    setTitle(''); setBody(''); setPriority('info'); setDisplayMode('popup'); setToRoles([]); setToUserIds([])
    setSent(`Message sent — it will pop up for ${who}.`)
    setTimeout(() => setSent(''), 3000)
    fetchList()
  }

  async function handleRecall(id) {
    setBusyId(id)
    await deactivateMessage(id)
    await fetchList()
    setBusyId(null)
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-slate-400">You don't have permission to view this page.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Megaphone className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Broadcast Messages</h1>
            <p className="text-xs text-slate-500 mt-0.5">Send a popup message to every signed-in user</p>
          </div>
        </div>

        {/* Compose */}
        <div className="card p-5 space-y-4">
          <div>
            <label className="label">Title</label>
            <input className="input" value={title} maxLength={200}
              onChange={e => { setTitle(e.target.value); setError('') }}
              placeholder="e.g. System maintenance tonight" />
          </div>

          <div>
            <label className="label">Message</label>
            <textarea className="input min-h-[110px] resize-y" value={body}
              onChange={e => { setBody(e.target.value); setError('') }}
              placeholder="Write the message all users will see…" />
          </div>

          {/* Audience — roles and/or specific accounts; nothing picked = all */}
          <div>
            <label className="label flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Send to</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setToRoles([]); setToUserIds([]); setError('') }}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  toRoles.length === 0 && toUserIds.length === 0
                    ? 'text-brand-300 border-brand-500/40 bg-brand-500/10'
                    : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                All users
              </button>
              {AUDIENCE_ROLES.map(r => (
                <button key={r.value} type="button" onClick={() => toggleRole(r.value)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    toRoles.includes(r.value)
                      ? 'text-brand-300 border-brand-500/40 bg-brand-500/10'
                      : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                  {r.label}
                </button>
              ))}
            </div>

            <div className="mt-2 flex items-end gap-3 flex-wrap">
              <SearchMultiSelect
                label="Specific users" Icon={Users} width="w-56"
                allLabel="None — by role only" searchPlaceholder="Search users…"
                options={userOptions}
                value={toUserIds} onChange={v => { setToUserIds(v); setError('') }}
              />
              <p className="text-[11px] text-slate-500 pb-2">
                {toRoles.length === 0 && toUserIds.length === 0
                  ? `Goes to everyone — ${targetCount} active account${targetCount === 1 ? '' : 's'}.`
                  : `Reaches ${targetCount} active account${targetCount === 1 ? '' : 's'}.`}
              </p>
            </div>
          </div>

          <div>
            <label className="label">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => {
                const Icon = p.icon
                const active = priority === p.value
                return (
                  <button key={p.value} type="button" onClick={() => setPriority(p.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      active ? p.cls : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                    <Icon className="w-3.5 h-3.5" /> {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* How it announces itself on the recipient's screen */}
          <div>
            <label className="label">How it appears</label>
            <div className="flex gap-2">
              {[
                { value: 'popup', label: 'Popup on screen', Icon: MonitorSmartphone, hint: 'Takes over the screen as soon as it arrives' },
                { value: 'icon',  label: 'Icon notification', Icon: MessageSquare,   hint: 'No popup — the messages icon badges and nudges' },
              ].map(o => (
                <button key={o.value} type="button" onClick={() => setDisplayMode(o.value)} title={o.hint}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    displayMode === o.value
                      ? 'text-brand-300 border-brand-500/40 bg-brand-500/10'
                      : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                  <o.Icon className="w-3.5 h-3.5" /> {o.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {displayMode === 'popup'
                ? 'Interrupts whatever the user is doing — best for urgent notices.'
                : 'Quiet delivery: the sidebar messages icon shows the unread count and animates once.'}
            </p>
          </div>

          {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {error}</p>}
          {sent  && <p className="text-xs text-green-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> {sent}</p>}

          <div className="flex justify-end">
            <button className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleSend} disabled={sending || !title.trim() || !body.trim()}>
              {sending
                ? <><Loader className="w-4 h-4 animate-spin" /> Sending…</>
                : <><Send className="w-4 h-4" /> Send to {targetCount} user{targetCount === 1 ? '' : 's'}</>}
            </button>
          </div>
        </div>

        {/* Sent messages */}
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Sent messages
          </p>

          {loadingList ? (
            <div className="card p-6 text-center text-slate-500 text-sm">Loading…</div>
          ) : list.length === 0 ? (
            <div className="card p-6 text-center text-slate-500 text-sm">No messages sent yet.</div>
          ) : list.map(m => {
            const cfg = PRIORITIES.find(p => p.value === m.priority) || PRIORITIES[0]
            const Icon = cfg.icon
            return (
              <div key={m.id} className={`card p-4 space-y-2 ${m.is_active ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-2">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border flex-shrink-0 ${cfg.cls}`}>
                    <Icon className="w-3 h-3" /> {cfg.label}
                  </span>
                  <p className="text-sm font-semibold text-slate-100 flex-1">{m.title}</p>
                  {!m.is_active && <span className="text-[10px] text-slate-500 flex-shrink-0">Recalled</span>}
                </div>
                {/* Who it went to */}
                <div className="flex flex-wrap items-center gap-1">
                  <Users className="w-3 h-3 text-slate-500" />
                  {(m.audience_roles?.length || m.audience_user_ids?.length) ? (<>
                    {(m.audience_roles ?? []).map(r => (
                      <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover border border-surface-border text-slate-300">
                        {roleLabel[r] ?? r}
                      </span>
                    ))}
                    {m.audience_user_ids?.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover border border-surface-border text-slate-300">
                        {m.audience_user_ids.length} selected user{m.audience_user_ids.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </>) : (
                    <span className="text-[10px] text-slate-500">All users</span>
                  )}
                  <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-slate-500">
                    {(m.display_mode || 'popup') === 'icon'
                      ? <><MessageSquare className="w-3 h-3" /> Icon only</>
                      : <><MonitorSmartphone className="w-3 h-3" /> Popup</>}
                  </span>
                </div>
                <p className="text-sm text-slate-400 whitespace-pre-wrap">{m.body}</p>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span>{m.created_by_name || 'Admin'} · {fmtWhen(m.created_at)}</span>
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <Eye className="w-3 h-3" /> {m.readCount}{messageAudience(m) ? ` / ${messageAudience(m)}` : ''} read
                    </span>
                  </div>
                  {m.is_active && (
                    <button onClick={() => handleRecall(m.id)} disabled={busyId === m.id}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-300 transition-colors disabled:opacity-50">
                      {busyId === m.id ? <Loader className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} Recall
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
