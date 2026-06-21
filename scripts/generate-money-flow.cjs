/* Generates a branded PDF that walks through iDeliver III's money lifecycle:
   order creation → driver collects cash (external app) → driver settlement →
   daily cashier box / daily cashier settlement.
   Uses the project's existing jspdf.  Run: node scripts/generate-money-flow.cjs */
const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT = path.join(__dirname, '..')
const LOGO = path.join(ROOT, 'src', 'assets', 'ideliver-logo-login.png')
const OUT  = path.join(ROOT, 'iDeliver-III-Money-Flow.pdf')

// Read PNG width/height from the IHDR chunk so we can scale without distortion.
function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } }

const BRAND  = [99, 102, 241]   // indigo
const DARK   = [30, 41, 59]
const GREY   = [100, 116, 139]
const GREEN  = [22, 130, 70]
const RED    = [180, 40, 40]
const TEAL   = [13, 148, 136]
const BODY   = [55, 65, 81]

const doc = new jsPDF({ unit: 'mm', format: 'a4' })

// jsPDF's built-in helvetica only speaks WinAnsi; smart-quotes, dashes, arrows
// and math signs get mangled (the stray "&" artefacts). Map them to plain ASCII
// for every text / splitTextToSize call so the output is clean everywhere.
const CLEAN = s => String(s)
  .replace(/[‘’‚‛]/g, "'")
  .replace(/[“”„‟]/g, '"')
  .replace(/[–—−]/g, '-')   // en/em dash, minus sign
  .replace(/→/g, '->')                 // right arrow
  .replace(/←/g, '<-')                 // left arrow
  .replace(/≈/g, '~')                  // approximately
  .replace(/[≤]/g, '<=').replace(/[≥]/g, '>=')
  .replace(/·/g, '-')                  // middle dot
  .replace(/•/g, '-')                  // bullet
  .replace(/…/g, '...')                // ellipsis
  .replace(/[ ]/g, ' ')                // non-breaking space
  .replace(/[^\x00-\x7F]/g, '')             // drop anything else non-ASCII
const _text  = doc.text.bind(doc)
const _split = doc.splitTextToSize.bind(doc)
doc.text = (txt, x, yy, opts) => _text(Array.isArray(txt) ? txt.map(CLEAN) : CLEAN(txt), x, yy, opts)
doc.splitTextToSize = (txt, w, opts) => _split(CLEAN(txt), w, opts)

const pageW = doc.internal.pageSize.getWidth()
const pageH = doc.internal.pageSize.getHeight()
const marginX = 18
const contentW = pageW - marginX * 2
let y = 18

function ensureSpace(needed) { if (y + needed > pageH - 16) { doc.addPage(); y = 18 } }

function para(text, { size = 9.5, color = BODY, gap = 4.6, indent = 0, after = 3 } = {}) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
  const lines = doc.splitTextToSize(text, contentW - indent)
  for (const ln of lines) { ensureSpace(gap + 1); doc.text(ln, marginX + indent, y); y += gap }
  y += after
}

function bullet(title, text) {
  ensureSpace(10)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.8); doc.setTextColor(...DARK)
  doc.text('•', marginX + 2, y)
  const head = doc.splitTextToSize(title, contentW - 8)
  doc.text(head, marginX + 7, y); y += 5 * head.length
  if (text) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.3); doc.setTextColor(...BODY)
    for (const ln of doc.splitTextToSize(text, contentW - 8)) { ensureSpace(5); doc.text(ln, marginX + 7, y); y += 4.5 }
  }
  y += 2.5
}

function sectionHeading(num, title) {
  ensureSpace(16)
  y += 2
  doc.setFillColor(238, 240, 255)
  doc.roundedRect(marginX, y - 4.8, contentW, 9, 1.6, 1.6, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...BRAND)
  doc.text(`STAGE ${num}`, marginX + 3, y - 0.3)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...DARK)
  doc.text(title, marginX + 22, y + 0.4)
  y += 9
}

function subHeading(title) {
  ensureSpace(8)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.8); doc.setTextColor(...BRAND)
  doc.text(title, marginX, y); y += 5.2
}

// A row of connected flow boxes: [label, sublabel][]
function flowRow(boxes, { fill = [245, 247, 255], stroke = BRAND } = {}) {
  const gap = 6
  const arrow = 5
  const n = boxes.length
  const boxW = (contentW - gap * (n - 1)) / n
  const boxH = 15
  ensureSpace(boxH + 6)
  let x = marginX
  doc.setFont('helvetica', 'normal')
  for (let i = 0; i < n; i++) {
    doc.setFillColor(...fill); doc.setDrawColor(...stroke); doc.setLineWidth(0.4)
    doc.roundedRect(x, y, boxW, boxH, 1.6, 1.6, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(...DARK)
    const t = doc.splitTextToSize(boxes[i][0], boxW - 4)
    doc.text(t, x + boxW / 2, y + 5.5, { align: 'center' })
    if (boxes[i][1]) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...GREY)
      const s = doc.splitTextToSize(boxes[i][1], boxW - 4)
      doc.text(s, x + boxW / 2, y + 5.5 + 4 * t.length, { align: 'center' })
    }
    if (i < n - 1) {
      doc.setDrawColor(...stroke); doc.setLineWidth(0.5)
      const ax = x + boxW + gap / 2
      doc.line(ax - arrow / 2, y + boxH / 2, ax + arrow / 2, y + boxH / 2)
      doc.line(ax + arrow / 2 - 1.4, y + boxH / 2 - 1.4, ax + arrow / 2, y + boxH / 2)
      doc.line(ax + arrow / 2 - 1.4, y + boxH / 2 + 1.4, ax + arrow / 2, y + boxH / 2)
    }
    x += boxW + gap
  }
  y += boxH + 6
}

// Simple key/value definition block
function defList(rows) {
  doc.setFontSize(8.8)
  for (const [k, v] of rows) {
    ensureSpace(6)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK)
    doc.text(k, marginX + 2, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...BODY)
    const vw = contentW - 42
    const lines = doc.splitTextToSize(v, vw)
    doc.text(lines, marginX + 42, y)
    y += Math.max(4.6, 4.4 * lines.length) + 0.6
  }
  y += 2
}

/* ════════════════════ COVER / HEADER ════════════════════ */
const logoBuf = fs.readFileSync(LOGO)
const { w: iw, h: ih } = pngSize(logoBuf)
const logoW = 26, logoH = logoW * (ih / iw)
doc.addImage('data:image/png;base64,' + logoBuf.toString('base64'), 'PNG', marginX, y, logoW, logoH)
doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...DARK)
doc.text('iDeliver III', marginX + logoW + 6, y + 9)
doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...GREY)
doc.text('Delivery & Logistics Management', marginX + logoW + 6, y + 16)
y += Math.max(logoH, 20) + 6
doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(marginX, y, pageW - marginX, y); y += 9

doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...BRAND)
doc.text('The Money Lifecycle', marginX, y); y += 6
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
doc.text(`From order creation to the daily cashier settlement.  Generated ${new Date().toLocaleDateString()}.`, marginX, y)
y += 9

para('This document follows a single order through its whole financial life: how it is created in the office, how '
  + 'the driver collects the customer’s money in the external driver app and that cash lands in the database, how the '
  + 'end-of-day Driver Settlement module reconciles each driver’s cash, and how the Daily Cashier Box rolls everything '
  + 'into one daily cashier settlement of money in versus money out.', { after: 3 })

// At-a-glance lifecycle strip
subHeading('At a glance')
flowRow([
  ['1  Order created', 'office / call center'],
  ['2  Driver collects', 'external driver app'],
  ['3  Driver settled', 'end of day'],
  ['4  Cashier box', 'daily settlement'],
])

para('Four data stores carry the money: payment_collections (every cash receipt, tagged with who took it), '
  + 'driver_daily_settlements (the end-of-day driver hand-over), and the order’s own isclosed / payment_status flags '
  + 'that lock it once the cash reaches the office.', { size: 9, color: GREY, after: 1 })

/* ════════════════════ STAGE 1 — ORDER CREATION ════════════════════ */
sectionHeading(1, 'How an order is created')

para('A call-center / office user creates a delivery order from the Deliveries page. The order is written to the '
  + 'delivery_orders table; a database trigger assigns the human-readable order number automatically.')

subHeading('Order number')
defList([
  ['Format', 'ORD-YYYYMMDD-00001 — the date plus a 5-digit sequence.'],
  ['Sequence', 'generate_order_number() counts the orders already created today and adds 1, so numbering restarts each day.'],
  ['Trigger', 'trg_generate_order_number fires BEFORE INSERT whenever no number was supplied.'],
])

subHeading('What the order carries')
bullet('Header & parties', 'Customer / recipient, driver (may be assigned later), scheduled date, delivery fee, optional discount and VAT, and the order currency (USD, LBP or EUR).')
bullet('Line items — order_items', 'Your own catalogue products (“local retail”), each with its own price and currency.')
bullet('Delivery packages — delivery_packages', 'Third-party parcels with a provider and a package price. A package already paid directly to its provider is flagged paid and dropped from the order total.')
bullet('Order services — order_services', 'Extra services with a supplier and a fee.')
bullet('External retail — retail_goods_invoices', 'Goods the driver buys from an outside shop on the customer’s behalf (shop name, reference, value). A paid invoice is excluded from the order total.')

subHeading('Opening state')
defList([
  ['status', 'scheduled'],
  ['delivery_status', 'Awaiting Pickup'],
  ['payment_status', 'unpaid — derived from money paid vs. the order total per currency (nothing paid → unpaid, part → partially_paid, all → paid_to_office).'],
])

para('At this point the order has a total (line items + packages + services + external retail + delivery fee − discount + VAT, '
  + 'each in its own currency) but nothing collected. The balance equals the full total.', { color: GREY, size: 9 })

/* ════════════════════ STAGE 2 — DRIVER COLLECTS ════════════════════ */
sectionHeading(2, 'How the driver collects the money (external app)')

para('The driver carries the order in the separate external driver application. When the goods are handed over, the '
  + 'driver records the cash the customer pays and marks the delivery complete. Those actions write straight back into '
  + 'the shared database that the office app reads.')

flowRow([
  ['Driver delivers', 'goods handed over'],
  ['Records cash', 'amount + currency'],
  ['payment_collections', 'new row inserted'],
  ['Order updated', 'Delivered / Paid'],
], { fill: [240, 253, 244], stroke: GREEN })

subHeading('What lands in the table')
bullet('A payment_collections row', 'Each receipt is one row: order_id, amount, currency, collected_at. Every payment carries its own currency, so a mixed USD + LBP collection is simply two rows.')
bullet('No collector name = driver cash', 'A payment the driver takes is left without a collected_by_name. That is the signal that the driver physically holds this cash — it is what the driver will owe the office at settlement. (Payments an office user records instead are stamped with collected_by_name; see the note below.)')
bullet('Order flags move forward', 'delivery_status becomes Delivered, and payment_status climbs from unpaid → partially_paid → paid_to_office (badge “Paid”) once the collected amount covers the order total in every currency. The intermediate collected_by_driver state is badged “With Driver”.')

subHeading('Two ways money can come in')
defList([
  ['Driver collects', 'payment_collections row with NO collector name. Counts as driver-held cash → appears in Driver Settlement.'],
  ['Office collects', 'If the customer pays the call center directly, an office user records the payment from the order form or daily list. It is stamped collected_by + collected_by_name → treated as paid straight to the office and EXCLUDED from the driver’s settlement (the driver never touched it). Instead it shows up as money IN on the Cashier Box.'],
])

para('This collector tag is the hinge between the two end-of-day modules: driver-collected cash flows into Stage 3 '
  + '(Driver Settlement); office-collected cash flows into Stage 4 (Cashier Box).', { color: TEAL, size: 9 })

/* ════════════════════ STAGE 3 — DRIVER SETTLEMENT ════════════════════ */
sectionHeading(3, 'End of day — the Driver Settlement module')

para('At day’s end each driver hands their collected cash to the office. The Driver Settlements page (Driver Dues) '
  + 'reconciles it, records the hand-over, and locks the orders.')

subHeading('Which orders appear')
para('An order is settlement-eligible once it is fully paid: either already closed, or Delivered AND fully collected '
  + '(payment_status = paid_to_office). Partially-paid orders have nothing to encash yet, so they are hidden.', { size: 9.2 })

subHeading('The reconciliation per order')
defList([
  ['Total', 'The full order value (for the user to confirm it is fully paid: collected ≈ total).'],
  ['Collected', 'Driver-collected cash only — sum of payment_collections rows with no collector name, per currency.'],
  ['Total dues', 'What the driver owes the office. Petty cash / external retail is no longer netted off, so dues = collected, per currency.'],
])

subHeading('Collecting the cash')
bullet('Pick one driver', 'Settlement is one driver at a time. Every outstanding order for that driver is selected by default; the user can narrow the selection.')
bullet('Enter the cash handed over', 'The amount-paid input per currency defaults to the expected dues. Any shortfall or overage is saved as the difference (“Short” / “Over”).')
bullet('Collect & Close — what gets written', 'On confirm the app creates, per driver:')
para('•  driver_daily_settlements — one header (driver, date, order count, received_by, received_at, status = completed).', { size: 8.8, indent: 6, gap: 4.2, after: 0 })
para('•  driver_settlement_currency_totals — one row per currency: total_collected, amount_paid, difference.', { size: 8.8, indent: 6, gap: 4.2, after: 0 })
para('•  driver_settlement_orders — one line per (order, currency): collected and retail.', { size: 8.8, indent: 6, gap: 4.2, after: 2 })

subHeading('And the orders are closed')
para('In the same click each settled order is locked: isclosed = true, closed_at / closed_by stamped, and '
  + 'payment_status = paid_to_office. The cash has moved from the driver to the office, so the order can no longer be '
  + 'edited. Settled orders drop off the Outstanding list and appear under the History tab, where the per-currency '
  + 'collected / received / difference and the order lines can be reviewed and exported to PDF.')

para('Result of Stage 3: every driver’s cash is accounted for, differences are on record, and the closed_at date is '
  + 'set — which is exactly what the Cashier Box keys off next.', { color: GREY, size: 9 })

/* ════════════════════ STAGE 4 — CASHIER BOX ════════════════════ */
sectionHeading(4, 'The Daily Cashier Box & daily cashier settlement')

para('The Daily Cashier Box totals the money that moved through the office for closed orders over a chosen day (or '
  + 'range), dated by each order’s closed_at. It nets office cash in against the third-party costs the office paid, per '
  + 'currency — that net is the daily cashier settlement.')

subHeading('Money IN (collected)')
para('Office-collected payments only — payment_collections rows that carry a collected_by_name. These are amounts the '
  + 'customer paid the office directly. (Driver-collected cash is deliberately excluded here; it was already reconciled '
  + 'in Stage 3.)', { size: 9.2 })

subHeading('Money OUT (spent)')
bullet('External retail invoices', 'retail_goods_invoices — goods bought from outside shops on the order.')
bullet('Delivery packages', 'delivery_packages — the price paid to each parcel provider.')
bullet('Order services', 'order_services — fees paid to service suppliers.')

subHeading('The daily settlement')
defList([
  ['Per currency', 'Collected (In), Spent (Out), and Net in Box = Collected − Spent — one card per currency (USD / LBP / EUR).'],
  ['Statement', 'A line-by-line list of every movement (date, order #, description, currency, In, Out), newest first.'],
  ['Output', 'A one-click PDF statement plus a Collected-vs-Spent chart. “Net in Box” is what the office cash drawer should hold for the day.'],
])

flowRow([
  ['Closed orders', 'dated by closed_at'],
  ['+ Office cash IN', 'collected payments'],
  ['− Costs OUT', 'retail + packages + services'],
  ['= Net in Box', 'daily settlement'],
], { fill: [240, 253, 250], stroke: TEAL })

/* ════════════════════ WORKED EXAMPLE ════════════════════ */
ensureSpace(40)
y += 1
doc.setFillColor(248, 250, 252); doc.setDrawColor(...BRAND); doc.setLineWidth(0.4)
const exTop = y
doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...BRAND)
y += 6; doc.text('Worked example — one day, one order', marginX + 4, y); y += 5.5
const exLines = [
  ['Morning', 'Order ORD-20260619-00007 is created: goods 100 USD + a 20 USD delivery fee. Driver Sami is assigned. Status: unpaid.'],
  ['Afternoon', 'Sami delivers and collects 120 USD cash in the driver app. A payment_collections row (120 USD, no collector name) is written; delivery_status → Delivered, payment_status → paid_to_office.'],
  ['On the way, the office', 'paid an outside shop 30 USD for part of the goods (a retail_goods_invoices line on the order).'],
  ['End of day — Driver Settlement', 'The office selects Sami, sees Collected 120 USD = Total dues 120 USD, and counts 120 USD from him. A driver_daily_settlements record is written (difference 0) and the order is closed (closed_at = today).'],
  ['End of day — Cashier Box', 'For today’s closed orders: office-collected IN = 0 (Sami’s 120 was driver cash, settled in Stage 3); Spent OUT = 30 USD (the shop invoice). Net in Box = −30 USD — the office paid out 30 for goods it will recover through the order total.'],
]
doc.setFontSize(8.8)
for (const [k, v] of exLines) {
  ensureSpace(7)
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK); doc.text(k, marginX + 4, y)
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...BODY)
  const lines = doc.splitTextToSize(v, contentW - 46)
  doc.text(lines, marginX + 44, y)
  y += Math.max(4.8, 4.5 * lines.length) + 1
}
y += 2
doc.setDrawColor(...BRAND); doc.setLineWidth(0.4)
doc.roundedRect(marginX, exTop, contentW, y - exTop, 2, 2, 'S')
y += 5

para('In short: the driver app feeds cash receipts into payment_collections; the Driver Settlement module reconciles '
  + 'the driver’s share and closes orders; and the Cashier Box rolls every closed order’s office cash and costs into a '
  + 'single per-currency net — the daily cashier settlement.', { size: 9, color: GREY })

/* ════════════════════ FOOTERS ════════════════════ */
const pages = doc.internal.getNumberOfPages()
for (let i = 1; i <= pages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
  doc.text('iDeliver III · Money Lifecycle', marginX, pageH - 8)
  doc.text(`Page ${i} of ${pages}`, pageW - marginX, pageH - 8, { align: 'right' })
}

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('Wrote', OUT)
