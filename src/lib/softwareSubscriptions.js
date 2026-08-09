import { supabase } from './supabase'

/* Software subscriptions — what the company itself pays for (supabase-fix118).

   A subscription costs `amount` per period and expires on `expiry_date`.
   Payments are recorded against it; a payment whose `covers_until` reaches past
   the expiry date is a RENEWAL, and a confirmed renewal is what stops the
   "your subscription is due" reminder from nagging everyone.

   Only the super admin writes here; admins read. */

export const REMINDER_DAYS = 10          // how early the reminder starts

export const CYCLES = [
  { value: 'one_time',   label: 'One-time payment', months: 0  },
  { value: 'monthly',    label: 'Monthly',          months: 1  },
  { value: 'quarterly',  label: 'Every 3 months',   months: 3  },
  { value: 'semiannual', label: 'Every 6 months',   months: 6  },
  { value: 'annual',     label: 'Every 12 months',  months: 12 },
]
export const cycleLabel  = v => CYCLES.find(c => c.value === v)?.label ?? 'One-time payment'
export const cycleMonths = v => CYCLES.find(c => c.value === v)?.months ?? 0

/* Local YYYY-MM-DD — these are DATE columns, so day precision, no timezone. */
export function todayStr(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* Whole days from `today` to `dateStr`. Negative once the date has passed. */
export function daysUntil(dateStr, today = todayStr()) {
  if (!dateStr) return null
  const a = new Date(`${today}T00:00:00`)
  const b = new Date(`${dateStr}T00:00:00`)
  if (isNaN(a) || isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}

/* Move a date on by one billing cycle — the default expiry when renewing. */
export function nextExpiry(dateStr, cycle) {
  const months = cycleMonths(cycle)
  if (!dateStr || months === 0) return dateStr || ''
  const d = new Date(`${dateStr}T00:00:00`)
  if (isNaN(d)) return dateStr
  d.setMonth(d.getMonth() + months)
  return todayStr(d)
}

/* ── money ─────────────────────────────────────────────────────────────── */

export const fmtMoney = (v, c) =>
  `${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: c === 'LBP' ? 0 : 2,
    maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`

/* Several currencies read as "120.00 USD + 3,000,000 LBP". */
export const totalsText = (totals) => {
  const parts = Object.entries(totals || {})
    .filter(([, v]) => Math.round((Number(v) || 0) * 100) !== 0)
    .map(([c, v]) => fmtMoney(v, c))
  return parts.length ? parts.join(' + ') : null
}

/* What a subscription has been paid, and what is still owed for the CURRENT
   period. Only confirmed payments count — an unconfirmed one is a claim, not
   money in. Payments in another currency are reported on their own so nothing
   is silently converted. */
export function paymentSummary(row) {
  const list = row?.payments ?? []
  const confirmed = list.filter(p => p.is_confirmed)
  const paidByCurrency = {}
  for (const p of confirmed) {
    const c = p.currency || row?.currency || 'USD'
    paidByCurrency[c] = (paidByCurrency[c] || 0) + Number(p.amount || 0)
  }
  const cur  = row?.currency || 'USD'
  const paid = paidByCurrency[cur] || 0
  const due  = Math.max(0, Number(row?.amount || 0) - paid)
  // The furthest a confirmed payment reaches — the renewal that silences the
  // reminder and tells the super admin the next period is already settled.
  const coveredUntil = confirmed
    .map(p => p.covers_until)
    .filter(Boolean)
    .sort()
    .pop() || null
  const pending = list.filter(p => !p.is_confirmed).length
  return { paid, due, paidByCurrency, coveredUntil, pending, confirmedCount: confirmed.length }
}

/* ── status ────────────────────────────────────────────────────────────── */

export const STATUS_STYLES = {
  active:   { label: 'Active',        cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
  due_soon: { label: 'Due soon',      cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  expired:  { label: 'Expired',       cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  unpaid:   { label: 'Payment due',   cls: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30' },
  inactive: { label: 'Not in use',    cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
}

/* One subscription's headline state. Expiry beats money: a subscription that
   has run out matters more than one that still owes a balance. */
export function subscriptionStatus(row, today = todayStr()) {
  if (!row) return 'inactive'
  if (row.is_active === false) return 'inactive'
  const days = daysUntil(row.expiry_date, today)
  if (days != null && days < 0)             return 'expired'
  if (days != null && days <= REMINDER_DAYS) return 'due_soon'
  if (paymentSummary(row).due > 0)          return 'unpaid'
  return 'active'
}

/* Does this subscription still need chasing?

   From REMINDER_DAYS before expiry (and after it), unless a CONFIRMED payment
   already covers past the expiry date — that is the "valid renewal, payment
   confirmed" that the reminder must respect. */
export function needsReminder(row, today = todayStr()) {
  if (!row || row.is_active === false || !row.expiry_date) return false
  const days = daysUntil(row.expiry_date, today)
  if (days == null || days > REMINDER_DAYS) return false
  const { coveredUntil } = paymentSummary(row)
  if (coveredUntil && coveredUntil > row.expiry_date) return false
  return true
}

/* Totals across the list, per currency: what the subscriptions cost, what has
   been confirmed as paid, and what is still owed. */
export function summarise(rows, today = todayStr()) {
  const total = {}, paid = {}, due = {}
  const counts = { active: 0, due_soon: 0, expired: 0, unpaid: 0, inactive: 0 }
  for (const r of rows) {
    counts[subscriptionStatus(r, today)] += 1
    if (r.is_active === false) continue          // retired lines don't owe anything
    const cur = r.currency || 'USD'
    const s = paymentSummary(r)
    total[cur] = (total[cur] || 0) + Number(r.amount || 0)
    due[cur]   = (due[cur]   || 0) + s.due
    for (const [c, v] of Object.entries(s.paidByCurrency)) paid[c] = (paid[c] || 0) + v
  }
  return { total, paid, due, counts }
}

/* ── data access ───────────────────────────────────────────────────────── */

const NOT_INSTALLED = /software_subscription/i
export const installHint = (msg) =>
  msg && NOT_INSTALLED.test(msg) && /not exist|schema cache/i.test(msg)
    ? 'Software subscriptions aren’t installed yet — run supabase-fix118.sql in Supabase.'
    : (msg || '')

const SELECT = '*, payments:software_subscription_payments(*)'

/* Every subscription with its payments, soonest expiry first. */
export async function fetchSoftwareSubscriptions(companyId = null) {
  try {
    let q = supabase.from('software_subscriptions').select(SELECT).order('expiry_date', { ascending: true })
    if (companyId) q = q.eq('company_id', companyId)
    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    return { rows: data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load software subscriptions.' }
  }
}

/* Just what the start-up reminder needs: live subscriptions at or past their
   reminder window, with the payments that might excuse them. */
export async function fetchDueSoftwareSubscriptions(companyId = null, today = todayStr()) {
  const limit = new Date(`${today}T00:00:00`)
  limit.setDate(limit.getDate() + REMINDER_DAYS)
  try {
    let q = supabase.from('software_subscriptions').select(SELECT)
      .eq('is_active', true)
      .lte('expiry_date', todayStr(limit))
      .order('expiry_date', { ascending: true })
    if (companyId) q = q.eq('company_id', companyId)
    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    return { rows: (data ?? []).filter(r => needsReminder(r, today)), error: null }
  } catch (e) {
    return { rows: [], error: e?.message || '' }
  }
}

export async function saveSoftwareSubscription(form, { companyId = null, userId = null } = {}) {
  const payload = {
    software_name: String(form.software_name || '').trim(),
    vendor:        form.vendor?.trim()      || null,
    description:   form.description?.trim() || null,
    billing_cycle: form.billing_cycle || 'one_time',
    start_date:    form.start_date  || null,
    expiry_date:   form.expiry_date || null,
    amount:        Number(form.amount) || 0,
    currency:      form.currency || 'USD',
    is_active:     form.is_active !== false,
    notes:         form.notes?.trim() || null,
    updated_at:    new Date().toISOString(),
    updated_by:    userId,
    ...(companyId ? { company_id: companyId } : {}),
  }
  try {
    if (form.id) {
      const { error } = await supabase.from('software_subscriptions').update(payload).eq('id', form.id)
      return error ? installHint(error.message) : null
    }
    const { error } = await supabase.from('software_subscriptions')
      .insert([{ ...payload, created_by: userId }])
    return error ? installHint(error.message) : null
  } catch (e) {
    return e?.message || 'Could not save the subscription.'
  }
}

export async function deleteSoftwareSubscription(id) {
  try {
    const { error } = await supabase.from('software_subscriptions').delete().eq('id', id)
    return error ? installHint(error.message) : null
  } catch (e) {
    return e?.message || 'Could not delete the subscription.'
  }
}

export async function savePayment(form, { userId = null } = {}) {
  const payload = {
    subscription_id: form.subscription_id,
    amount:       Number(form.amount) || 0,
    currency:     form.currency || 'USD',
    paid_on:      form.paid_on || todayStr(),
    covers_until: form.covers_until || null,
    method:       form.method?.trim()    || null,
    reference:    form.reference?.trim() || null,
    notes:        form.notes?.trim()     || null,
    is_confirmed: !!form.is_confirmed,
    confirmed_by: form.is_confirmed ? userId : null,
    confirmed_at: form.is_confirmed ? new Date().toISOString() : null,
  }
  try {
    if (form.id) {
      const { error } = await supabase.from('software_subscription_payments').update(payload).eq('id', form.id)
      return error ? installHint(error.message) : null
    }
    const { error } = await supabase.from('software_subscription_payments')
      .insert([{ ...payload, created_by: userId }])
    return error ? installHint(error.message) : null
  } catch (e) {
    return e?.message || 'Could not save the payment.'
  }
}

export async function deletePayment(id) {
  try {
    const { error } = await supabase.from('software_subscription_payments').delete().eq('id', id)
    return error ? installHint(error.message) : null
  } catch (e) {
    return e?.message || 'Could not delete the payment.'
  }
}
