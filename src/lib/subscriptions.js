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
