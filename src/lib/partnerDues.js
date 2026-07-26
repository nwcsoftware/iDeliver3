import { orderOfficeCollectedByCurrency } from './orderAmounts'

/* Partner package accounting.

   A partner's package is money the customer owes for the partner's goods. Two
   ways it settles:
     • flagged paid  → the customer paid the partner directly; we never touch
                       that money and owe the partner nothing for it.
     • not flagged   → we collect it from the customer (normally via the driver)
                       and hold it on the partner's behalf until we pay it out.

   So, per partner per currency:
     dues = delivered − paid directly to partner − paid to partner

   "Collected by drivers" is reported for visibility but is deliberately NOT in
   the dues formula: whether our cash came in via a driver or the office doesn't
   change what we owe the partner — only a payout does. */

export const CURRENCIES = ['USD', 'LBP', 'EUR']

const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const norm   = c => (CURRENCIES.includes(c) ? c : 'USD')

export function partnerName(c) {
  if (!c) return '—'
  return (c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()) || '—'
}

/* The date a package lands on the partner's account = when the order closed. */
export function orderDate(o) {
  const raw = o?.closed_at || o?.scheduled_date || o?.created_at
  return raw ? String(raw).slice(0, 10) : ''
}

function emptyBucket() {
  return { delivered: 0, paidDirect: 0, collectedDrivers: 0, collectedOffice: 0, paidOut: 0, dues: 0 }
}

/**
 * Per-partner, per-currency package figures from closed orders + payout rows.
 *
 * Scoped to CLOSED orders: a package only becomes a real debt once the order is
 * done. Packages carry their own currency, so a partner can run several
 * balances at once and each is settled independently.
 *
 * @param orders    every order (closed ones are picked out here)
 * @param payouts   partner_payouts rows
 * @param from/to   'YYYY-MM-DD' bounds on the close date / payout date; blank = all time
 * @returns [{ id, name, code, curs, cur: { USD: {delivered, paidDirect, ...} } }]
 */
export function buildPartnerDues({ orders = [], payouts = [], from = '', to = '' } = {}) {
  const inRange = day => !day || ((!from || day >= from) && (!to || day <= to))
  const parties = new Map()

  const bucketFor = (id, name, code, cur) => {
    const p = parties.get(id) || { id, name, code: code || null, cur: {} }
    if (name && p.name === '—') p.name = name
    parties.set(id, p)
    return (p.cur[cur] ||= emptyBucket())
  }

  for (const o of orders) {
    if (!o.isclosed) continue
    const day = o.closed_at ? String(o.closed_at).slice(0, 10) : null
    if (!day || !inRange(day)) continue

    const packages = (o.delivery_packages ?? []).filter(pk => pk.provider_id)
    if (packages.length === 0) continue

    // Who took this order's cash. A payment stamped with an office user's name
    // means the driver never handled it — same rule the Cashier Box and driver
    // settlements use, so the three pages agree on the channel.
    const byOffice = Object.keys(orderOfficeCollectedByCurrency(o)).length > 0

    for (const pk of packages) {
      const amt = round2(pk.package_price)
      if (!amt) continue
      const cur = norm(pk.currency || o.currency)
      const g = bucketFor(pk.provider_id, partnerName(pk.provider), pk.provider?.code, cur)

      g.delivered += amt
      if (pk.paid) g.paidDirect += amt              // customer settled with the partner
      else if (byOffice) g.collectedOffice += amt   // we hold it — office took the cash
      else g.collectedDrivers += amt                // we hold it — driver took the cash
    }
  }

  for (const p of payouts) {
    const day = p.paid_at ? String(p.paid_at).slice(0, 10) : ''
    if (!inRange(day)) continue
    // Use the payout's joined partner contact for the name/code so a partner with
    // only payouts (no delivered packages in range) still shows their name.
    const g = bucketFor(p.partner_id, partnerName(p.partner), p.partner?.code || null, norm(p.currency))
    g.paidOut += Number(p.amount) || 0
  }

  const list = []
  for (const p of parties.values()) {
    for (const cur of Object.keys(p.cur)) {
      const g = p.cur[cur]
      for (const k of Object.keys(g)) g[k] = round2(g[k])
      g.dues = round2(g.delivered - g.paidDirect - g.paidOut)
    }
    // Only currencies this partner actually moved money in.
    p.curs = CURRENCIES.filter(c => p.cur[c] && Object.values(p.cur[c]).some(v => v !== 0))
    if (p.curs.length) list.push(p)
  }
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

/* Per-currency totals across every partner, for the summary bar. */
export function sumPartnerDues(list) {
  const t = Object.fromEntries(CURRENCIES.map(c => [c, emptyBucket()]))
  for (const p of list) for (const c of p.curs) {
    for (const k of Object.keys(t[c])) t[c][k] = round2(t[c][k] + p.cur[c][k])
  }
  return t
}
