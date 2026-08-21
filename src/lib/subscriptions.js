import { supabase } from './supabase'

/* Supplier / partner subscriptions (supabase-fix110.sql).

   A 2nd party may only sign in while they have a subscription that is active,
   paid, and inside its date window — the super admin flips `is_paid` once the
   money is confirmed and `is_active` to let them in. */

/* Local YYYY-MM-DD (dates are stored as DATE, i.e. day-precision, no timezone). */
export function todayStr(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* Status of one subscription row, as shown in the list. */
export function subscriptionStatus(row, today = todayStr()) {
  if (!row) return 'none'
  if (row.is_active === false) return 'deactivated'
  if (!row.is_paid)            return 'unpaid'
  if (row.start_date && today < row.start_date) return 'scheduled'
  if (row.end_date   && today > row.end_date)   return 'expired'
  return 'active'
}

export const isSubscriptionActive = (row, today = todayStr()) =>
  subscriptionStatus(row, today) === 'active'

export const STATUS_STYLES = {
  active:      { label: 'Active',       cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
  scheduled:   { label: 'Scheduled',    cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  expired:     { label: 'Expired',      cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  unpaid:      { label: 'Unpaid',       cls: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30' },
  deactivated: { label: 'Deactivated',  cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
}

/* All subscriptions with their contact, newest first. */
export async function fetchSubscriptions(companyId = null) {
  try {
    let q = supabase
      .from('subscriptions')
      .select('*, contact:contacts!contact_id(id,first_name,last_name,company_name,code,contact_types,mobile)')
      .order('created_at', { ascending: false })
    if (companyId) q = q.eq('company_id', companyId)
    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load subscriptions.' }
  }
}

/* One 2nd party's own subscriptions (their "My Subscription" screen), newest
   period first. */
export async function fetchSubscriptionsForContact(contactId) {
  if (!contactId) return { rows: [], error: null }
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('contact_id', contactId)
      .order('end_date', { ascending: false })
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load your subscription.' }
  }
}

/* Whole days left until a subscription ends (0 on the last day, negative once
   it has passed). */
export function daysLeft(endDate, today = todayStr()) {
  if (!endDate) return null
  const ms = new Date(`${endDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()
  return Math.round(ms / 86400000)
}

/* Does this contact have a subscription letting them in right now?
   Returns { allowed, reason }. When the table doesn't exist yet (migration not
   run) access is ALLOWED, so installing the app doesn't lock out every partner
   before the super admin has entered any subscription. */
export async function checkSubscriptionAccess(contactId) {
  if (!contactId) return { allowed: false, reason: 'no-contact', row: null }
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id,description,start_date,end_date,amount,currency,is_paid,is_active')
      .eq('contact_id', contactId)
    if (error) {
      if (/subscriptions/i.test(error.message) && /not exist|schema cache/i.test(error.message)) {
        return { allowed: true, reason: 'not-installed', row: null }
      }
      return { allowed: true, reason: 'lookup-failed', row: null }   // never lock someone out on a network blip
    }
    const rows = data ?? []
    if (rows.length === 0) return { allowed: false, reason: 'none', row: null }

    const active = rows.find(r => isSubscriptionActive(r))
    if (active) return { allowed: true, reason: 'active', row: active }

    // Nothing lets them in — report on the most relevant blocked subscription
    // (the one that ran/runs latest) so the message can name real dates.
    const byEnd = rows.slice().sort((a, b) => String(b.end_date || '').localeCompare(String(a.end_date || '')))
    const pick = st => byEnd.find(r => subscriptionStatus(r) === st)
    for (const st of ['unpaid', 'scheduled', 'expired', 'deactivated']) {
      const row = pick(st)
      if (row) return { allowed: false, reason: st, row }
    }
    return { allowed: false, reason: 'deactivated', row: byEnd[0] ?? null }
  } catch {
    return { allowed: true, reason: 'lookup-failed', row: null }
  }
}

export const ACCESS_MESSAGES = {
  none:        'Your subscription hasn’t been set up yet. Please contact the administrator.',
  unpaid:      'Your subscription is awaiting payment confirmation. Please contact the administrator.',
  scheduled:   'Your subscription hasn’t started yet. Please contact the administrator.',
  expired:     'Your subscription has expired. Please contact the administrator to renew it.',
  deactivated: 'Your subscription is not active. Please contact the administrator.',
  'no-contact': 'Your login isn’t linked to a supplier/partner contact. Please contact the administrator.',
}

const money = (v, c) => `${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`

const dmy = (d) => {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : String(d)
}

/* The sign-in refusal shown to a supplier/partner: why they're blocked, plus
   the details of the subscription it refers to (or that none exists). */
export function accessDeniedMessage(reason, row) {
  const base = ACCESS_MESSAGES[reason] || ACCESS_MESSAGES.deactivated
  if (!row) {
    return reason === 'none'
      ? 'You don’t have a subscription yet, so sign-in is not allowed. Please contact the administrator to set one up.'
      : base
  }
  const label  = row.description ? `“${row.description}”` : 'Your subscription'
  const period = `${dmy(row.start_date)} → ${dmy(row.end_date)}`
  const amount = Number(row.amount) > 0 ? ` · ${money(row.amount, row.currency)}` : ''
  const detail = `${label}: ${period}${amount}`

  switch (reason) {
    case 'expired':
      return `Your subscription expired on ${dmy(row.end_date)}.\n${detail}\nPlease contact the administrator to renew it.`
    case 'unpaid':
      return `Your subscription is awaiting payment confirmation.\n${detail}\nIt will be activated once the administrator confirms the payment.`
    case 'scheduled':
      return `Your subscription starts on ${dmy(row.start_date)}.\n${detail}\nYou can sign in from that date.`
    case 'deactivated':
      return `Your subscription has been deactivated by the administrator.\n${detail}\nPlease contact them to reactivate it.`
    default:
      return `${base}\n${detail}`
  }
}

export async function saveSubscription(row, { companyId = null, userId = null } = {}) {
  const payload = {
    contact_id:   row.contact_id,
    description:  row.description?.trim() || null,
    start_date:   row.start_date,
    end_date:     row.end_date,
    amount:       Number(row.amount) || 0,
    currency:     row.currency || 'USD',
    is_paid:      !!row.is_paid,
    paid_at:      row.is_paid ? (row.paid_at || new Date().toISOString()) : null,
    paid_by_note: row.paid_by_note?.trim() || null,
    is_active:    !!row.is_active,
    updated_at:   new Date().toISOString(),
  }
  if (row.id) {
    const { error } = await supabase.from('subscriptions').update(payload).eq('id', row.id)
    return error ? error.message : null
  }
  const { error } = await supabase.from('subscriptions').insert([{
    ...payload,
    ...(companyId ? { company_id: companyId } : {}),
    created_by: userId,
  }])
  return error ? error.message : null
}

export async function deleteSubscription(id) {
  const { error } = await supabase.from('subscriptions').delete().eq('id', id)
  return error ? error.message : null
}

/* Display name for a subscription's contact. */
export function contactLabel(c) {
  if (!c) return 'Unknown contact'
  const name = (c.company_name?.trim()) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unnamed'
  return c.code ? `${name} (${c.code})` : name
}

/* ── expiry notice (the bar in the portal header) ───────────────────────── */

export const SUBSCRIPTION_NOTICE_DAYS = 30

/* Whole days from `today` to `dateStr`; negative once the date has passed. */
export function daysUntilDate(dateStr, today = todayStr()) {
  if (!dateStr) return null
  const a = new Date(`${today}T00:00:00`)
  const b = new Date(`${dateStr}T00:00:00`)
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

/* What a 2nd party should be warned about, from their own subscription rows.

   Only a subscription that is PAID and ACTIVE counts as cover, so the notice
   follows the same rule that lets them sign in. The furthest such end date is
   their real expiry — a renewal already paid and activated therefore clears the
   notice by itself. A later row that is not yet paid/activated does not count
   as cover, but is reported as a pending renewal so the wording can say so.

   Returns null when there is nothing to say. */
export function subscriptionNotice(rows, today = todayStr(), withinDays = SUBSCRIPTION_NOTICE_DAYS) {
  const list = rows ?? []
  const covering = list.filter(r => r.is_paid && r.is_active && r.end_date)
  const current  = covering.sort((a, b) => String(a.end_date).localeCompare(String(b.end_date))).pop() || null

  // Anything dated past the cover that hasn't been paid/activated yet.
  const pendingRenewal = list.some(r =>
    r.end_date && (!current || r.end_date > current.end_date) && !(r.is_paid && r.is_active))

  if (!current) return { row: null, days: null, expired: true, pendingRenewal, none: true }

  const days = daysUntilDate(current.end_date, today)
  if (days == null || days > withinDays) return null
  return { row: current, days, expired: days < 0, pendingRenewal, none: false }
}

/* ── renewal stage (the four steps shown in the Subscriptions list) ────────

   The status column answers "does this let them in today?"; this answers "when
   does it need renewing?", which is a different question and the one the super
   admin plans around. Four steps, by days left on the end date:

     ok       more than 30 days  — nothing to do
     due      30 days or less    — needs attention
     urgent   15 days or less    — needs attention now
     expired  the date has passed and nothing has replaced it

   A row whose date has passed but which a later paid-and-active period covers
   is 'renewed', not expired: the money came in, this one simply had its turn.
   That distinction is why the list can strike out only what really lapsed. */

export const RENEWAL_WARN_DAYS   = 30
export const RENEWAL_URGENT_DAYS = 15

export const RENEWAL_STAGES = {
  ok:      { label: 'Active',   cls: 'text-green-300  bg-green-500/10  border-green-500/30' },
  due:     { label: 'Due soon', cls: 'text-amber-300  bg-amber-500/10  border-amber-500/30' },
  urgent:  { label: 'Urgent',   cls: 'text-red-300    bg-red-500/10    border-red-500/30' },
  expired: { label: 'Expired',  cls: 'text-red-400    bg-red-500/15    border-red-500/40' },
  renewed: { label: 'Renewed',  cls: 'text-slate-400  bg-slate-500/10  border-slate-500/30' },
  idle:    { label: 'Not in force', cls: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
  unknown: { label: 'No end date', cls: 'text-slate-500 bg-slate-500/10 border-slate-500/20' },
}

/* Contacts that hold cover reaching today or beyond — i.e. someone whose older
   periods have been renewed rather than left to lapse. Paid AND active only,
   because that is what actually lets them sign in. */
export function coveredContactIds(rows = [], today = todayStr()) {
  const ids = new Set()
  for (const r of rows) {
    if (r?.is_paid && r?.is_active && r?.end_date && r.end_date >= today) ids.add(r.contact_id)
  }
  return ids
}

/* One row's renewal stage. `covered` = this contact has later cover in place. */
export function renewalStage(row, today = todayStr(), covered = false) {
  const days = daysUntilDate(row?.end_date, today)
  if (days == null) return { stage: 'unknown', days: null }
  if (days < 0)                      return { stage: covered ? 'renewed' : 'expired', days }
  if (days <= RENEWAL_URGENT_DAYS)   return { stage: 'urgent',  days }
  if (days <= RENEWAL_WARN_DAYS)     return { stage: 'due',     days }
  return { stage: 'ok', days }
}

/* "12 days", "today", "3 days ago" — the days column reads as a sentence. */
export function daysLeftLabel(days) {
  if (days == null) return '—'
  if (days === 0)   return 'ends today'
  if (days < 0)     return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  return `${days} day${days === 1 ? '' : 's'}`
}

/* Everything the super admin's summary strip shows, in one pass over the list.

   Money is kept per currency and never added across them: a total that mixed
   USD and LBP would be a number with no meaning. */
export function subscriptionsSummary(rows = [], today = todayStr()) {
  const covered = coveredContactIds(rows, today)
  const out = {
    total: rows.length,
    active: 0, unpaid: 0, scheduled: 0, expired: 0, deactivated: 0,
    renewed: 0,                              // ran out, but a newer period covers them
    due: 0, urgent: 0,                       // renewals coming up (still in date)
    value: {}, activeValue: {}, expiredValue: {},   // { USD: n, LBP: n, … }
    parties: new Set(),
  }
  const add = (bucket, cur, amt) => {
    const c = String(cur || 'USD').toUpperCase()
    bucket[c] = (bucket[c] || 0) + (Number(amt) || 0)
  }
  for (const r of rows) {
    const st = subscriptionStatus(r, today)
    const { stage } = renewalStage(r, today, covered.has(r.contact_id))
    if (r.contact_id) out.parties.add(r.contact_id)

    // 'expired' counts what actually lapsed. A period that ended and was then
    // renewed is history, not a hole — counting it as expired would keep the
    // figure climbing for customers who never missed a day.
    if (st === 'expired') { if (stage === 'renewed') out.renewed += 1; else out.expired += 1 }
    else if (out[st] != null) out[st] += 1

    add(out.value, r.currency, r.amount)
    if (st === 'active')                            add(out.activeValue,  r.currency, r.amount)
    if (st === 'expired' && stage === 'expired')    add(out.expiredValue, r.currency, r.amount)

    // Only a live subscription can be "coming up for renewal".
    if (st === 'active') {
      if (stage === 'due')    out.due    += 1
      if (stage === 'urgent') out.urgent += 1
    }
  }
  out.partyCount = out.parties.size
  return out
}

/* ── the free introductory subscription ────────────────────────────────────

   A supplier or partner cannot sign in without a subscription, so a brand-new
   one would be created and immediately locked out until the super admin got
   round to entering a period by hand. Instead the system issues a free 90-day
   subscription the moment the contact is created: paid (there is nothing to
   pay), activated, starting today.

   After that it is manual — only the super admin renews it, on the
   Subscriptions page, which is where the countdown and the renewal warnings
   already live.

   Deliberately narrow: it fires only for supplier/partner contacts, and only
   when that contact has NO subscription row at all, so it can never issue a
   second trial, extend an expired one, or overwrite a paid period. That makes
   it safe to call after any contact save. */

export const TRIAL_DAYS = 90
export const TRIAL_DESCRIPTION = `Free ${TRIAL_DAYS}-day introductory subscription`

/* YYYY-MM-DD, `days` after the given day. */
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return dateStr
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

export const isTrialSubscription = (row) =>
  Number(row?.amount) === 0 && /introductory|trial/i.test(String(row?.description || ''))

/* Give a newly created 2nd party their free period. Returns
   { created, row, error }; `error` is for logging only — the contact itself is
   already saved and must not be rolled back over this. */
export async function ensureTrialSubscription(contactId, contactTypes = [], { companyId = null, userId = null } = {}) {
  const types = Array.isArray(contactTypes) ? contactTypes : [contactTypes]
  const isSecondParty = types.some(t => t === 'supplier' || t === 'partner')
  if (!contactId || !isSecondParty) return { created: false, row: null, error: null }

  try {
    // Anything already on file — paid, expired or awaiting payment — means this
    // contact has been dealt with; the trial is for genuinely new parties only.
    const { data: existing, error: readErr } = await supabase
      .from('subscriptions').select('id').eq('contact_id', contactId).limit(1)
    if (readErr) {
      const missing = /subscriptions/i.test(readErr.message) && /not exist|schema cache/i.test(readErr.message)
      return { created: false, row: null, error: missing ? null : readErr.message }
    }
    if (existing?.length) return { created: false, row: null, error: null }

    const start = todayStr()
    const { data, error } = await supabase.from('subscriptions').insert([{
      contact_id:   contactId,
      description:  TRIAL_DESCRIPTION,
      start_date:   start,
      end_date:     addDays(start, TRIAL_DAYS),
      amount:       0,
      currency:     'USD',
      is_paid:      true,                      // nothing to collect — it is free
      paid_at:      new Date().toISOString(),
      paid_by_note: 'Issued automatically when the contact was created',
      is_active:    true,                      // they can sign in straight away
      ...(companyId ? { company_id: companyId } : {}),
      created_by:   userId,
    }]).select('*').single()

    if (error) return { created: false, row: null, error: error.message }
    return { created: true, row: data, error: null }
  } catch (e) {
    return { created: false, row: null, error: e?.message || 'Could not issue the trial subscription.' }
  }
}
