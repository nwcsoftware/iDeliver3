/* The commercial model, in one place.

   Everything the software charges for is described here and nowhere else: the
   annual platform package, the seats it includes, and what each kind of account
   costs beyond them. The pages, the sign-in gate and the licence document all
   read from this file, so a price cannot be right on one screen and stale on
   another.

   It follows the Software Licence & Subscription Agreement (Appendix A) —
   V1.00.002 — and the annual subscription invoice NX-IDL3-INV-0002. Where a
   figure below has an article number beside it, that article is the authority;
   this file is only its expression in code.

   The three things worth understanding before changing anything here:

     · A PARTNER is a seat on the annual package. Ten of them are already paid
       for inside the USD 600 a year; the eleventh onward costs USD 10 a YEAR
       each, as external-module and mobile-application fees.

     · A SUPPLIER is not part of the annual package at all. It is a monthly
       subscription in its own right — 90 free days, then one of three plans,
       billed per month, per supplier.

     · Call-centre users and drivers are seats too, counted per subscription
       year, with an included allotment and a per-seat fee beyond it.

   Partners and suppliers used to share one flat "second party" rate. They no
   longer do, and nothing should put them back together: they are different
   arrangements with different periods, and mixing them is what made the old
   figures impossible to reconcile against the invoice. */

export const CURRENCY = 'USD'

/* The annual platform subscription — invoice NX-IDL3-INV-0002. */
export const ANNUAL_PACKAGE = {
  price: 600,
  period: 'year',
  reference: 'NX-IDL3-INV-0002',
  note: 'Platform infrastructure & managed services, billed annually in advance.',
}

/* ── seats inside the annual package ──────────────────────────────────── */

export const SEATS = {
  call_center: {
    label: 'Call-centre users',
    included: 6,
    includedRate: 10,          // per user, per year, inside the package (A5)
    extraRate: 15,             // per additional user, per year (A5)
    period: 'year',
    article: 'A5',
  },
  driver: {
    label: 'Driver seats',
    included: 15,
    includedRate: 0,           // inside the package (A6)
    extraRate: 15,             // per additional driver, per year (A6)
    period: 'year',
    article: 'A6',
  },
  partner: {
    label: 'Partners',
    included: 10,
    includedRate: 0,           // inside the package (A5A)
    extraRate: 10,             // per additional partner, per YEAR (A5A)
    period: 'year',
    article: 'A5A',
  },
}

/* ── the supplier subscription, outside the package ───────────────────── */

export const SUPPLIER_SUBSCRIPTION = {
  label: 'Suppliers',
  trialDays: 90,
  period: 'month',
  article: 'A5B',
  /* The plan a supplier renews onto after the free period. `key` matches what
     the subscription agreement stores on the row it was accepted under. */
  plans: [
    { key: 'basic',   name: 'Basic',   price: 10, blurb: 'Their shop, their orders and their statement.' },
    { key: 'pro',     name: 'Pro',     price: 18, blurb: 'Everything in Basic, with the wider shop listing.' },
    { key: 'pro_max', name: 'Pro Max', price: 25, blurb: 'Everything in Pro, with priority placement and support.' },
  ],
  defaultPlan: 'basic',
}

export const supplierPlan = (key) =>
  SUPPLIER_SUBSCRIPTION.plans.find(p => p.key === key) || SUPPLIER_SUBSCRIPTION.plans[0]

/* ── rates, normalised ────────────────────────────────────────────────────
   A partner is priced by the year and a supplier by the month, so nothing can
   be compared until both are expressed the same way. Everything downstream —
   is this subscription enough? what is the difference worth? — works in
   MONTHLY terms, because that is the shorter period and the one a subscription
   row is measured against. */

export const MONTHS_PER_YEAR = 12
/* A month is a twelfth of a year, not thirty days. Using 30 makes a yearly
   rate divided into months disagree with the same rate measured across a
   365-day subscription by about half a percent — enough to report a partner
   paying exactly the right amount as a cent short. */
export const DAYS_PER_MONTH = 365 / MONTHS_PER_YEAR
/* Money is compared to the cent, so anything inside half a cent is equal.
   Without this, arithmetic noise reads as an unpaid balance. */
export const RATE_TOLERANCE = 0.005
export const round2 = n => Math.round((Number(n) || 0) * 100) / 100

export const perMonth = (amount, period) =>
  round2(period === 'year' ? (Number(amount) || 0) / MONTHS_PER_YEAR : (Number(amount) || 0))

export const perYear = (amount, period) =>
  round2(period === 'year' ? (Number(amount) || 0) : (Number(amount) || 0) * MONTHS_PER_YEAR)

/* What one account of a given kind costs, once it is beyond the included
   allotment. Returns { amount, period, monthly, yearly, article }. */
export function rateFor(kind, { planKey = null } = {}) {
  if (kind === 'supplier') {
    const plan = supplierPlan(planKey || SUPPLIER_SUBSCRIPTION.defaultPlan)
    return {
      amount: plan.price, period: 'month',
      monthly: plan.price, yearly: perYear(plan.price, 'month'),
      article: SUPPLIER_SUBSCRIPTION.article, plan,
    }
  }
  const seat = SEATS[kind]
  if (!seat) return { amount: 0, period: 'month', monthly: 0, yearly: 0, article: null }
  return {
    amount: seat.extraRate, period: seat.period,
    monthly: perMonth(seat.extraRate, seat.period),
    yearly:  perYear(seat.extraRate, seat.period),
    article: seat.article,
  }
}

/* Seat usage for one kind: how many are in use, how many are inside the
   package, how many are chargeable, and what that comes to per year. */
export function seatUsage(kind, count = 0) {
  const seat = SEATS[kind]
  if (!seat) return null
  const used     = Math.max(0, Number(count) || 0)
  const included = Math.min(used, seat.included)
  const extra    = Math.max(0, used - seat.included)
  return {
    ...seat, kind, used, included, extra,
    remaining: Math.max(0, seat.included - used),
    includedCost: round2(included * seat.includedRate),
    extraCost:    round2(extra * seat.extraRate),
    totalCost:    round2(included * seat.includedRate + extra * seat.extraRate),
  }
}

/* The whole annual position: the package, the seats, and what the extras add
   to it. Suppliers are deliberately absent — they are billed monthly and are
   not part of this figure. */
export function annualSummary({ callCenterUsers = 0, drivers = 0, partners = 0 } = {}) {
  const seats = {
    call_center: seatUsage('call_center', callCenterUsers),
    driver:      seatUsage('driver', drivers),
    partner:     seatUsage('partner', partners),
  }
  const extras = round2(Object.values(seats).reduce((n, s) => n + s.extraCost, 0))
  return {
    package: ANNUAL_PACKAGE,
    seats,
    extras,
    total: round2(ANNUAL_PACKAGE.price + extras),
  }
}

/* What all live suppliers come to per month — reported beside the annual
   figure, never inside it. */
export function supplierMonthly(suppliers = []) {
  const total = suppliers.reduce((n, s) => n + (supplierPlan(s?.plan).price || 0), 0)
  return { count: suppliers.length, monthly: round2(total), yearly: round2(total * MONTHS_PER_YEAR) }
}
