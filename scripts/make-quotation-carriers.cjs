/* Quotation for the third-party delivery company (carrier) module.

   iDeliver III currently knows three kinds of party: customers, partners and
   suppliers. This module adds a fourth — the delivery company an order is handed
   to when it falls outside the areas we cover ourselves — and the money that
   moves with it: what they delivered, what they collected, what we owe them for
   the run, what they owe us from the door, and the balance between.

   Two documents are produced from the same item list:

     · the core module, sections A–D, 10% discount
     · the same plus the optional carrier portal, sections A–E, 10% discount

   Prices follow the same ladder as the August change requests (individual items
   USD 90–575) and are corroborated by effort: about sixteen days for the core at
   the ~USD 200/day those quotations imply.

   Run with:  node scripts/make-quotation-carriers.cjs                         */

const { build, baseTerms, TERM_WARRANTY } = require('./lib/quotation.cjs')

/* ── the items ─────────────────────────────────────────────────────────── */

const sectionA = {
  title: 'Section A — The carrier and the handover',
  short: 'Carrier & handover',
  note:  'Recording the delivery companies themselves, the areas they cover, and '
       + 'the act of handing an order to one of them.',
  rows: [
    ['A1', 'Delivery company as a party in its own right',
           'A fourth party type beside customers, partners and suppliers, with its own list, form, contact details and account numbers.', 200],
    ['A2', 'Coverage areas',
           'The zones each delivery company serves, so the office is offered the right company for the address on the order.', 225],
    ['A3', 'Handing an order to a delivery company',
           'The order form records which company took it, the fee agreed for the run and the date of handover, and stops an order being given to a company and to one of our own drivers at the same time.', 375],
    ['A4', 'Handed-over orders in the order list',
           'A badge naming the company on the row, and a filter to read the day by company.', 150],
  ],
}

const sectionB = {
  title: 'Section B — The money',
  short: 'Money & settlement',
  note:  'What each delivery company owes us and what we owe them, per currency, '
       + 'with the record of every settlement between us.',
  rows: [
    ['B1', 'Delivery company account: delivered, collected, paid, balance',
           'One page per company: orders handed over, orders delivered, money collected, money settled and the balance outstanding — each figure per currency, with no conversion between currencies.', 550],
    ['B2', 'Who collected the money',
           'Handles both directions: the company collects at the door and owes us the balance less their fee, or we collect and owe them their fee. An order says which applies.', 225],
    ['B3', 'Settlements with the delivery company',
           'Recording a payment made to a company or received from one, with its date, currency, method and note, and the history of every settlement on the account.', 350],
    ['B4', 'Statement by date range, with PDF',
           'Any period, printed as a statement showing every order, every settlement and the closing balance — the same form as the partner and credit-customer statements already in use.', 275],
  ],
}

const sectionC = {
  title: 'Section C — Reports and integrity',
  short: 'Reports & integrity',
  note:  'Making sure an order carried by somebody else is counted correctly '
       + 'everywhere the existing reports already count orders.',
  rows: [
    ['C1', 'Handed-over orders in the existing reports',
           'Closed Orders, Performance and Customer Categories separate work we carried ourselves from work carried for us, so neither revenue nor volume is overstated.', 325],
    ['C2', 'Driver settlements and Cashier Box',
           'An order carried by an outside company is not a driver’s to answer for, and the money it produced enters the box by a different door. Both are corrected so the daily figures still reconcile.', 225],
    ['C3', 'Dashboard summary',
           'Orders out with delivery companies today, and what is owed in each direction, on the main screen.', 125],
  ],
}

const sectionD = {
  title: 'Section D — Delivery',
  short: 'Delivery',
  note:  'One release of the office application. No new version of the driver '
       + 'application is required: an order handed to an outside company never '
       + 'reaches a driver’s device.',
  rows: [
    ['D1', 'Data migration, testing and release',
           'Recording the delivery companies already in use, testing against real orders in each currency, and installing the release.', 275],
  ],
}

const sectionE = {
  title: 'Section E — Carrier portal (optional)',
  short: 'Carrier portal',
  note:  'A sign-in for the delivery companies themselves, on the same portal the '
       + 'partners and suppliers already use. Optional, and can be added later '
       + 'without reworking sections A to D.',
  rows: [
    ['E1', 'Sign-in scoped to their own orders',
           'A delivery company signs in and sees only the orders handed to them — never another company’s work, and never the customer list.', 350],
    ['E2', 'They declare delivery and collection',
           'The company marks an order delivered and states what was collected, which lands in the office as a figure to confirm rather than a phone call to write down.', 300],
    ['E3', 'They read their own statement',
           'The same statement as B4, for their own account only.', 150],
  ],
}

/* ── terms particular to this module ───────────────────────────────────── */

const TERM_FIGURES =
  'The delivery company account reports exactly these figures, each per currency: orders handed '
  + 'over, orders delivered, amounts collected by the company, amounts collected by our office, '
  + 'the company’s fees, amounts settled in each direction, and the outstanding balance. '
  + 'Figures beyond this list are quoted separately.';

const TERM_TARIFF =
  'The fee for a run is entered on the order. A tariff table, in which each delivery company '
  + 'carries its own price list by area, is not included in this quotation and is estimated at '
  + 'USD 300 to 400 if it is required.';

const TERM_CURRENCY =
  'Balances are held per currency and are never converted between currencies, matching how every '
  + 'other account in iDeliver III already works. A rate of exchange, if one is ever wanted, is a '
  + 'separate item.';

const TERM_PORTAL_LATER =
  'Section E is optional and is not included in the total above. It can be accepted later at the '
  + 'same price without any rework of the sections delivered before it.';

const TERM_NO_DRIVER_RELEASE =
  'No new version of the driver application is required, so no rollout to drivers’ devices is '
  + 'involved and none is charged for.';

/* ── the two documents ─────────────────────────────────────────────────── */

const DATE = '09 September 2026'
const SUBJECT = 'New module — third-party delivery companies (handover, collection, settlement and statements)'
const INTRO =
  'Orders that fall outside the areas we cover are handed to an outside delivery company. This '
  + 'module records that handover and the money that moves with it, so a delivery carried by '
  + 'somebody else is still a delivery we can account for. Each item is priced individually so that '
  + 'any of them may be accepted, deferred or declined without affecting the others.'

build({
  file: '_NXCORE_Quotation_CR_20260909_0003.pdf',
  quoteNo: 'CR-20260909-0003', date: DATE, validDays: 30, discount: 0.10,
  sections: [sectionA, sectionB, sectionC, sectionD],
  subject: SUBJECT,
  intro: INTRO,
  terms: [
    ...baseTerms(30),
    TERM_FIGURES, TERM_TARIFF, TERM_CURRENCY, TERM_NO_DRIVER_RELEASE,
    TERM_PORTAL_LATER, TERM_WARRANTY,
  ],
})

build({
  file: '_NXCORE_Quotation_CR_20260909_0003_with_portal.pdf',
  quoteNo: 'CR-20260909-0003-B', date: DATE, validDays: 30, discount: 0.10,
  sections: [sectionA, sectionB, sectionC, sectionD, sectionE],
  subject: SUBJECT + ', including the carrier portal',
  intro: INTRO,
  terms: [
    ...baseTerms(30),
    TERM_FIGURES, TERM_TARIFF, TERM_CURRENCY, TERM_NO_DRIVER_RELEASE,
    TERM_WARRANTY,
  ],
})
