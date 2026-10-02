import { subscriptionStatus, isFreeSeatRow, todayStr } from './subscriptions'

/* PARTNER SUBSCRIPTION ACCOUNTS (fix172).

   Every partner subscription is two accounts at once:

     the partner owes the OFFICE   the price it was sold at (row.amount) —
                                   received once the payment is recorded
                                   (is_paid, with its date and reference)
     the office owes the SUPER     the super admin's minimum for the years it
     ADMIN                         covers (row.vendor_amount, filled in by the
                                   database) — settled once the super admin
                                   records it (vendor_settled_at)

   What is left between the two is the office's margin. The admin may sell at
   the minimum and keep nothing; the super admin is owed the minimum either way.

   One calculation, read by the page and by its PDF, so the two cannot drift.
   Money is per currency and never added across currencies; a row whose
   super-admin share is unknown (NULL — another currency than the minimum, or a
   row from before fix172) is counted as unknown, never as zero. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

/* A partner's subscription, as opposed to a supplier's (not part of this). */
export const isPartnerSubscription = (r) =>
  r?.subscription_role === 'partner' || (r?.subscription_role == null && isFreeSeatRow(r))

/* Where a row stands, in the words this page uses. */
export const ACCOUNT_STATUS = {
  in_force:  { label: 'In force',            cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
  due:       { label: 'In force — unpaid',   cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  scheduled: { label: 'Not started',         cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  off:       { label: 'Switched off',        cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
  expired:   { label: 'Ended',               cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  free:      { label: 'Free seat',           cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
}

export function accountStatus(r, today = todayStr()) {
  if (isFreeSeatRow(r)) return 'free'
  const st = subscriptionStatus(r, today)
  if (st === 'active') return 'in_force'
  if (st === 'credit' || st === 'grace') return 'due'
  if (st === 'scheduled') return 'scheduled'
  if (st === 'expired') return 'expired'
  return 'off'                                  // unpaid & off, trust run out, deactivated
}

/* One row's two accounts. */
export function accountOf(r, today = todayStr()) {
  const currency = r?.currency || 'USD'
  const price = round2(r?.amount)
  const vendorKnown = r?.vendor_amount != null
  const vendor = vendorKnown ? round2(r.vendor_amount) : null
  const vendorCurrency = r?.vendor_currency || currency
  return {
    status: accountStatus(r, today),
    free: isFreeSeatRow(r),
    currency, price,
    received: !!r?.is_paid,
    vendor, vendorCurrency,
    settled: !!r?.vendor_settled_at,
    // Only when both sides are in one currency — there is no exchange rate here.
    margin: vendorKnown && vendorCurrency === currency ? round2(price - vendor) : null,
  }
}

const blank = () => ({ count: 0, charged: 0, received: 0, pending: 0, owed: 0, settled: 0, due: 0, margin: 0, unknown: 0, off: 0 })

/* Totals per currency over the rows given (the page passes what its filters
   show, so a year's filter gives that year's figures). */
export function accountTotals(rows = [], today = todayStr()) {
  const t = {}
  const bag = (c) => (t[c] ||= blank())
  for (const r of rows) {
    const a = accountOf(r, today)
    if (a.free) continue                         // nothing either way
    const c = bag(a.currency)
    c.count += 1
    if (a.status === 'off') c.off += 1
    c.charged += a.price
    if (a.received) c.received += a.price; else c.pending += a.price
    if (a.vendor == null) { c.unknown += 1; continue }
    const v = bag(a.vendorCurrency)
    v.owed += a.vendor
    if (a.settled) v.settled += a.vendor; else v.due += a.vendor
    if (a.margin != null) c.margin += a.margin
  }
  for (const c of Object.values(t)) for (const k of ['charged', 'received', 'pending', 'owed', 'settled', 'due', 'margin']) c[k] = round2(c[k])
  return t
}

export const fmtAccount = (v, c = 'USD') =>
  `${(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`
