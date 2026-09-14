/* iDeliver III — v3.00.020 release notes, with the cash/credit explainer.

   Two documents in one PDF:

     Part 1  How cash and credit work now. The rule moved from the CUSTOMER to
             the ACCOUNT NUMBER, which changes some screens and deliberately
             leaves others alone. Written for the people who use the software,
             not for whoever maintains it.

     Part 2  Everything added since v3.00.019 (21 August 2026).

   Run with:  node scripts/generate-release-notes-v3.00.020.cjs                */

const fs   = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')
const { autoTable } = require('jspdf-autotable')

const ROOT = path.join(__dirname, '..')
const LOGO = path.join(ROOT, 'src', 'assets', 'ideliver-logo-login.png')
const VERSION = 'v3.00.020'
const OUT  = path.join(ROOT, `iDeliver-III-Release-Notes-${VERSION}.pdf`)

const pngSize = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) })

const BRAND = [99, 102, 241]
const DARK  = [30, 41, 59]
const GREY  = [100, 116, 139]
const BODY  = [60, 60, 60]
const CREDIT = [168, 62, 116]
const CASH   = [22, 128, 61]

const doc = new jsPDF({ unit: 'mm', format: 'a4' })
const pageW = doc.internal.pageSize.getWidth()
const pageH = doc.internal.pageSize.getHeight()
const MX = 18
const TEXT_W = pageW - MX * 2
let y = 18

const space = needed => { if (y + needed > pageH - 18) { doc.addPage(); y = 18 } }

function h1(text) {
  space(16)
  doc.setFillColor(238, 240, 255)
  doc.roundedRect(MX, y - 5, TEXT_W, 9, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...BRAND)
  doc.text(text, MX + 3, y + 1.5)
  y += 12
}

function h2(text) {
  space(12)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...DARK)
  doc.text(text, MX, y)
  y += 5.5
}

function para(text, { indent = 0, size = 9.5, color = BODY, gap = 3 } = {}) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
  for (const ln of doc.splitTextToSize(text, TEXT_W - indent)) {
    space(6)
    doc.text(ln, MX + indent, y)
    y += 4.6
  }
  y += gap
}

function bullet(title, desc) {
  space(10)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...DARK)
  doc.text('•', MX + 2, y)
  doc.text(doc.splitTextToSize(title, TEXT_W - 8)[0], MX + 6, y)
  y += 4.6
  if (desc) para(desc, { indent: 6, size: 9, gap: 2.5 })
  else y += 1
}

function table(head, body, widths) {
  space(24)
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: MX, right: MX },
    styles: { fontSize: 8.5, cellPadding: 2, overflow: 'linebreak', textColor: BODY, lineColor: [225, 228, 235], lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: widths,
  })
  y = doc.lastAutoTable.finalY + 6
}

/* ── cover ──────────────────────────────────────────────────────────────── */

const logoBuf = fs.readFileSync(LOGO)
const { w: iw, h: ih } = pngSize(logoBuf)
const logoW = 26, logoH = logoW * (ih / iw)
doc.addImage('data:image/png;base64,' + logoBuf.toString('base64'), 'PNG', MX, y, logoW, logoH)

doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...DARK)
doc.text('iDeliver III', MX + logoW + 6, y + 9)
doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...GREY)
doc.text('Delivery & Logistics Management', MX + logoW + 6, y + 16)

y += Math.max(logoH, 20) + 6
doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(MX, y, pageW - MX, y)
y += 9

doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...BRAND)
doc.text(`Release ${VERSION} — cash and credit now follow the account`, MX, y)
y += 6
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
doc.text('Part 1 explains the change and what it does to each financial screen. Part 2 lists everything', MX, y); y += 4.4
doc.text(`added since v3.00.019 (21 August 2026).  Generated ${new Date().toLocaleDateString('en-GB')}.`, MX, y)
y += 10

/* ── PART 1 ─────────────────────────────────────────────────────────────── */

h1('Part 1 — How cash and credit work now')

h2('What changed, in one sentence')
para('Whether an order is CASH or CREDIT used to be decided by a tick box on the customer’s card. '
   + 'It is now decided by the ACCOUNT NUMBER the order is billed to.')

para('That tick box could only ever give one answer per customer. A customer who pays cash for most '
   + 'deliveries but runs a monthly account for one branch had to be filed as one or the other, and every '
   + 'order they ever placed followed that single answer. Account numbers do not have that limit: a customer '
   + 'may hold a cash account and a credit account at the same time, and each order follows the account it '
   + 'was actually billed to. The same customer can therefore appear in the cash reports for some orders and '
   + 'in the credit reports for others — which is simply the truth about how they trade with you.')

h2('What you do differently when taking an order')
bullet('Every order must now name an account number',
  'After choosing the customer, the Account Number field lists that customer’s own accounts — nobody '
  + 'else’s — and each one says whether it is CASH or CREDIT, and whether it is their MAIN account or a '
  + 'SUB account beneath it. The order cannot be saved until one is chosen.')
bullet('A customer with only one account has it filled in for you',
  'There is nothing to decide, so the field fills itself. Today that is almost every customer. The choice is '
  + 'only asked for when a customer genuinely holds more than one account.')
bullet('The kind is recorded on the order, once',
  'Cash or Credit is written onto the order when it is taken, from the account itself. It cannot be typed by '
  + 'hand and it cannot disagree with the account number beside it. A closed order keeps what it was billed '
  + 'as for ever, even if the account is changed years later.')

h2('Closing an order — the rule')
table(
  ['The order is billed to', 'Can it be closed with money still owed?', 'What happens to the balance'],
  [
    ['A CASH account', 'No. It must be paid in full first — and in every currency, not just the main one.',
     'There is none. The money is collected as the order is delivered.'],
    ['A CREDIT account', 'Yes. It can be closed with nothing paid at all.',
     'It becomes a balance on the Credit Customers page, to be settled later.'],
  ],
  { 0: { cellWidth: 32, fontStyle: 'bold' }, 1: { cellWidth: 68 }, 2: { cellWidth: 'auto' } },
)
para('The second column is stricter than before in one respect worth knowing: an order charged in two '
   + 'currencies must now be clear in BOTH before it can close on a cash account. Previously only the '
   + 'order’s main currency was checked, so an order whose dollars were collected could close while its '
   + 'Lebanese pounds were still owed.', { size: 9 })

h2('Payments carry the account they settle')
para('Whether a payment is recorded on the order form, through the quick Pay button on the order list, or '
   + 'by the driver, it now carries the account number it settles and whether that account is cash or '
   + 'credit. A payment can no longer end up on a different account from the charge it was taken against.')

h1('Part 1 (continued) — what this does to each financial screen')

h2('Screens that now follow the account')
table(
  ['Screen', 'What it does now'],
  [
    ['Credit Customers',
     'Lists every customer who HOLDS a credit account — not only those already charged. 21 credit accounts '
     + 'had been granted and appeared nowhere. Each number is tagged MAIN or SUB, and a customer’s statement '
     + 'shows only the orders billed to their credit account; anything they paid on a cash account was '
     + 'settled at the door and has no place on a credit statement.'],
    ['Customer Categories report',
     'The two sides are now "Credit Accounts" and "Cash Accounts" rather than credit and regular customers. '
     + 'A customer holding both kinds appears on both sides, each order counted where its account says.'],
    ['Driver Dues',
     'An order billed to a credit account carries no cash for the driver to hand over, so it is excluded — '
     + 'unless the driver actually collected something, which is still reconciled.'],
    ['Driver Collections',
     'Orders billed to a credit account are settled on the account, not at the door, so they are not offered '
     + 'as collections for the driver.'],
    ['Orders list',
     'The customer-type filter now reads "Credit account orders" and "Cash account orders", and filters by '
     + 'what the order was billed to rather than by who the customer is.'],
    ['Contacts → Customers',
     'A new Cash / Credit filter, and every row now shows the customer’s account numbers with MAIN or SUB '
     + 'and CASH or CREDIT against each one.'],
  ],
  { 0: { cellWidth: 38, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
)

h2('Screens that did NOT change — and why')
para('Every screen below counts money that actually moved, or counts all finished work regardless of how it '
   + 'was billed. None of them ever asked whether a customer was cash or credit, so none of them behaves '
   + 'differently now. Their figures before and after this release are identical.', { size: 9 })
table(
  ['Screen', 'What it counts — unchanged'],
  [
    ['Cashier Box', 'The cash that physically moved through the office on closed orders.'],
    ['Daily Collection', 'Every payment recorded, with the order and the person who collected it.'],
    ['Closed Orders report', 'What finished work was worth, in four streams, per currency.'],
    ['Performance report', 'What the business earned and moved over a window.'],
    ['Account Transactions', 'The posted ledger entries.'],
    ['Partner Dues / Shop Settlements', 'What is owed to partners and shops for their goods.'],
    ['Contact Statements', 'A single contact’s running account.'],
  ],
  { 0: { cellWidth: 46, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
)

h2('The Cashier Box, in detail')
para('Because this is the screen most often asked about, it is worth setting out exactly what it shows.')
bullet('IN — every payment collected on a closed order',
  'Both the driver’s collections and the office’s. An order is only counted once it is closed, and an '
  + 'order closes when the driver has handed his cash over, so by then all of its money is genuinely in the box.')
bullet('OUT — what the box paid out on those orders',
  'Petty-cash retail purchases and order services. Invoices the customer settled directly with the shop are '
  + 'skipped, because the box never paid them.')
bullet('A credit order that closes unpaid adds nothing on the day it closes',
  'That is correct and is not new: no money moved, so there is nothing to put in the box. The charge sits on '
  + 'the Credit Customers page as a balance until it is settled.')
para('One boundary to be aware of, which has always been the case and is not affected by this release: when '
   + 'a credit balance is later collected on the Credit Customers page, that settlement is recorded against '
   + 'the customer’s ACCOUNT. It appears on their statement and clears their balance, but it does not appear '
   + 'as a cash movement in the Cashier Box. If you would like account settlements to show in the box as '
   + 'well, that is a change worth deciding on deliberately rather than assuming either way.',
  { size: 9 })

h2('What was corrected in your data when this was installed')
bullet('All 8,174 orders were given an account and a kind',
  '965 are billed to credit accounts and 7,209 to cash accounts. None is left undecided. 2,377 of them had '
  + 'never named an account at all — the software had been working it out afresh on every read.')
bullet('7,655 payments were matched to the account they settle', null)
bullet('Three customers were repaired',
  'Najwa Dandach, Rihab Darwich and Abby Mezher were marked as credit customers, but their only account was '
  + 'typed as cash — so 479 of their closed orders had dropped off the credit statement, carrying USD 283, '
  + 'LBP 2,700,000 and USD 24 still owed. Their accounts were corrected and the orders restored.')
bullet('A balance that had been hidden came to light',
  'Sama Hills holds a credit account but was not ticked as a credit customer, so LBP 3,000,000 still owed on '
  + 'a closed order had never appeared on the Credit Customers page. It does now.')

/* ── PART 2 ─────────────────────────────────────────────────────────────── */

doc.addPage(); y = 18
h1('Part 2 — What else is new since v3.00.019')
para('v3.00.019 was released on 21 August 2026. The items below are everything added since, newest first.',
  { size: 9, color: GREY })

const groups = [
  ['Orders and money', [
    ['Cash and credit follow the account number', '9 September. The change described in Part 1.'],
    ['Cancelled orders count for nothing',
     '1 September. A cancelled order is treated as work that never happened: it is kept out of every figure '
     + 'and every report, and has its own page for looking one up.'],
    ['An order records who took it',
     '23 August. The name and account of the user who raised the order are stamped on it when it is created, '
     + 'and never rewritten by a later edit.'],
    ['The call centre can settle a partner',
     '29 August. Partner payouts can be recorded from the office, and Partner Dues can be filtered to one partner.'],
    ['Retail invoices return',
     '23 August. The retail invoices page is back, with two more lists sorting under a frozen header.'],
  ]],
  ['Reports', [
    ['Closed Orders report',
     '2 September. What finished work was worth, in four streams per currency, with a breakdown by order type '
     + 'and by month. Story orders also gained a report of their own.'],
    ['Performance report',
     '25 August. What the business earned and moved across six time windows, drawn as charts and exported as a PDF.'],
    ['Customer Categories report',
     '27 August. Credit against cash across delivery fees, packages and invoices. Now split by account, as Part 1 describes.'],
    ['Driver settlements sort by column',
     '25 August. Sortable headers, and the filters fold away when they are not needed.'],
  ]],
  ['The public front page', [
    ['A visitor meets the company before the sign-in box',
     '2–6 September. A front page carrying the company’s mark, a year of work in numbers, news and event '
     + 'galleries, a background video, a QR code for the mobile application, and how to make contact. A '
     + 'visitor who came to buy is taken to the shop rather than to a login form.'],
  ]],
  ['Shop and the customer application', [
    ['Shop photographs moved into storage',
     '9 September. Photographs used to be stored inside the rows themselves, which made the customer '
     + 'application’s shop take almost a minute to open. They are now held as real image files: the same '
     + 'four items went from 2,423 KB to 3 KB of row data.'],
    ['Shops sell in options',
     '23 August. Items can be offered in options, colours and sizes, and partners hold seats.'],
  ]],
  ['Contacts and administration', [
    ['A contact is findable by its account number',
     '27 August. Searching a contact list by account number now finds them, as does searching by contact code.'],
    ['A driver can be deleted',
     '24 August. A super admin can scan what a driver is attached to, then remove the driver, their login and '
     + 'optionally their orders. The package pages also say what they are doing while they work.'],
    ['A user can be deleted', '23 August.'],
    ['Subscriptions start free for 90 days',
     '21 August. A partner or supplier begins on a free 90-day subscription and must accept an agreement '
     + 'before the portal opens. The agreement can be kept as a PDF.'],
  ]],
  ['Speed and accuracy', [
    ['The orders list says when it is working',
     '2 September. Applying a filter across the whole history takes a moment; the list now says so instead of '
     + 'appearing to freeze.'],
    ['The currency check stops reading everything',
     '24 August. It now reads only what it needs, rather than the entire order history.'],
    ['A feasibility study in two languages', '24 August.'],
  ]],
]

for (const [name, items] of groups) {
  h2(name)
  for (const [t, d] of items) bullet(t, d)
  y += 1
}

/* ── footer note + page numbers ─────────────────────────────────────────── */

space(16)
doc.setDrawColor(225); doc.setLineWidth(0.3); doc.line(MX, y, pageW - MX, y); y += 6
doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
for (const ln of doc.splitTextToSize(
  'Database changes delivered with this release: fix143 (shop photographs into storage), fix144 (an order '
  + 'names the account it bills to, and carries cash or credit) and fix145 (the correction of three '
  + 'mis-typed accounts). All three have been applied.', TEXT_W)) {
  doc.text(ln, MX, y); y += 4.5
}

const pages = doc.internal.getNumberOfPages()
for (let i = 1; i <= pages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
  doc.text(`iDeliver III · ${VERSION}`, MX, pageH - 8)
  doc.text(`Page ${i} of ${pages}`, pageW - MX, pageH - 8, { align: 'right' })
}

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('Wrote', path.basename(OUT), '·', pages, 'pages')
