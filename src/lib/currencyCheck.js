/* Currency sanity checks.

   The two currencies are three orders of magnitude apart, so a figure typed
   against the wrong one is obvious to a person and invisible to the software:
   90,000 LBP entered as 90,000 USD looks like a fortune; 5 USD entered as 5 LBP
   looks like nothing. Both happen when the currency selector is left where the
   last order put it.

   The rules are therefore about PLAUSIBILITY, not correctness — every hit is
   "look at this", never "this is wrong". Each currency carries a minimum and a
   maximum, set in App Settings and shared by every user; 0 means no bound on
   that side. Out of the box:

     • an LBP amount UNDER  50,000    — probably meant to be USD
     • a USD amount  OVER   2,000     — probably meant to be LBP

   Zero is never flagged: an empty fee or a free order is a legitimate nothing,
   and flagging it would bury the real hits in noise. */

/* The shipped defaults. An admin overrides them in App Settings, where the
   limits are stored globally so every user checks against the same rule. */
export const DEFAULT_CURRENCY_LIMITS = {
  USD: { min: 0,     max: 2000 },
  LBP: { min: 50000, max: 0 },
  EUR: { min: 0,     max: 2000 },
}

// Kept for anything still importing them directly.
export const LBP_MIN_PLAUSIBLE = DEFAULT_CURRENCY_LIMITS.LBP.min
export const USD_MAX_PLAUSIBLE = DEFAULT_CURRENCY_LIMITS.USD.max

const num = n => Number(n) || 0
const round2 = n => Math.round(num(n) * 100) / 100

/* The configured bounds for one currency. 0, blank or missing = no bound on
   that side, so a currency can be limited from below only, or not at all. */
export function limitsFor(currency, limits = DEFAULT_CURRENCY_LIMITS) {
  const cur = String(currency || 'USD').toUpperCase()
  const row = (limits && limits[cur]) || DEFAULT_CURRENCY_LIMITS[cur] || {}
  return { min: num(row.min), max: num(row.max) }
}

/* Which currency an out-of-range amount was probably meant to be: the other
   currency whose range it would fall inside. With the usual setup — LBP from
   50,000, USD up to 2,000 — a small LBP figure suggests USD and a large USD
   figure suggests LBP, but the answer follows whatever the limits are set to
   rather than being hard-coded. */
function likelyCurrency(value, currency, limits) {
  const cur = String(currency || 'USD').toUpperCase()
  const others = Object.keys(limits || DEFAULT_CURRENCY_LIMITS).filter(c => c !== cur)
  const fits = others.filter(c => {
    const { min, max } = limitsFor(c, limits)
    return (!min || value >= min) && (!max || value <= max)
  })
  return fits.length === 1 ? fits[0] : (fits[0] || null)
}

/* Does this single amount look like the wrong currency? Returns null when it
   is fine, otherwise { severity, note, suggests }. */
export function currencyIssue(amount, currency, limits = DEFAULT_CURRENCY_LIMITS) {
  const v = Math.abs(round2(amount))
  if (v === 0) return null
  const cur = String(currency || 'USD').toUpperCase()
  const { min, max } = limitsFor(cur, limits)

  if (min && v < min) {
    return {
      severity: 'warning',
      note: `Under ${min.toLocaleString()} ${cur} — check the currency`,
      suggests: likelyCurrency(v, cur, limits) || '—',
    }
  }
  if (max && v > max) {
    return {
      severity: 'error',
      note: `Over ${max.toLocaleString()} ${cur} — very likely the wrong currency`,
      suggests: likelyCurrency(v, cur, limits) || '—',
    }
  }
  return null
}

/* Every money field on one order, so each can be judged on its own. A single
   order may carry several currencies legitimately, which is exactly why the
   check has to run per line rather than per order. */
export function orderMoneyLines(order) {
  const lines = []
  const push = (kind, label, amount, currency, ref) => {
    if (num(amount) === 0) return
    lines.push({ kind, label, amount: round2(amount), currency: currency || order?.currency || 'USD', ref })
  }

  push('fee', 'Delivery fee', order?.delivery_fee, order?.currency)
  push('discount', 'Discount', order?.discount_amount, order?.discount_currency || order?.currency)
  push('vat', 'VAT', order?.vat_amount, order?.currency)

  for (const p of order?.delivery_packages ?? []) {
    push('package', 'Package', p.package_price, p.currency, p.tracking_number)
  }
  for (const it of order?.order_items ?? []) {
    if (it.is_deleted) continue
    push('item', 'Item', it.line_total, it.currency, it.parcel_description)
  }
  for (const s of order?.order_services ?? []) {
    push('service', 'Service', s.service_fees, s.service_fees_currency)
  }
  for (const r of order?.retail_goods_invoices ?? []) {
    push('invoice', 'Local market invoice', r.invoice_value, r.currency, r.shop_name || r.invoice_reference)
  }
  for (const a of order?.ads ?? []) {
    push('ad', 'Ad', a.price, a.currency, a.platform)
  }
  for (const pc of order?.payment_collections ?? []) {
    push('payment', 'Payment', pc.amount, pc.currency, pc.collected_by_name || pc.collection_group)
  }
  return lines
}

/* Every suspect amount on one order. */
export function orderCurrencyIssues(order, limits = DEFAULT_CURRENCY_LIMITS) {
  const out = []
  for (const line of orderMoneyLines(order)) {
    const issue = currencyIssue(line.amount, line.currency, limits)
    if (issue) out.push({ ...line, ...issue })
  }
  return out
}

/* One-line summaries for the daily "Check orders" audit. */
export function currencyWarnings(order, limits = DEFAULT_CURRENCY_LIMITS) {
  return orderCurrencyIssues(order, limits).map(i =>
    `${i.label}${i.ref ? ` (${String(i.ref).slice(0, 24)})` : ''}: `
    + `${i.amount.toLocaleString()} ${i.currency} — ${i.note}`)
}

/* Scan a list of orders, newest first, flattened to one row per suspect line. */
export function scanCurrencyIssues(orders = [], limits = DEFAULT_CURRENCY_LIMITS) {
  const rows = []
  for (const o of orders) {
    for (const issue of orderCurrencyIssues(o, limits)) {
      rows.push({
        orderId: o.id,
        orderNumber: o.order_number,
        date: o.scheduled_date || String(o.created_at || '').slice(0, 10),
        closed: !!o.isclosed,
        customer: o.customer,
        ...issue,
      })
    }
  }
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)))
}
