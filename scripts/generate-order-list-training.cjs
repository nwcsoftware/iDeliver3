/* Generates a branded training PDF for the Daily Order List (Deliveries page):
   how it works and what every feature does.  Uses the project's existing jspdf.
   Run: node scripts/generate-order-list-training.cjs */
const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT = path.join(__dirname, '..')
const LOGO = path.join(ROOT, 'src', 'assets', 'ideliver-logo-login.png')
const OUT  = path.join(ROOT, 'iDeliver-III-Daily-Order-List-Training.pdf')

function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } }

const BRAND = [99, 102, 241]   // indigo
const DARK  = [30, 41, 59]
const GREY  = [100, 116, 139]
const TEAL  = [13, 148, 136]
const BODY  = [55, 65, 81]

const doc = new jsPDF({ unit: 'mm', format: 'a4' })

// jsPDF's built-in helvetica only speaks WinAnsi; smart-quotes, dashes, arrows
// and math signs get mangled. Map them to plain ASCII for every text call.
const CLEAN = s => String(s)
  .replace(/[‘’‚‛]/g, "'")
  .replace(/[“”„‟]/g, '"')
  .replace(/[–—−]/g, '-')
  .replace(/→/g, '->').replace(/←/g, '<-')
  .replace(/≈/g, '~')
  .replace(/≤/g, '<=').replace(/≥/g, '>=')
  .replace(/·/g, '-').replace(/•/g, '-').replace(/…/g, '...')
  .replace(/ /g, ' ')
  .replace(/[^\x00-\x7F]/g, '')
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
  for (const ln of doc.splitTextToSize(text, contentW - indent)) {
    ensureSpace(gap + 1); doc.text(ln, marginX + indent, y); y += gap
  }
  y += after
}

// Numbered section heading with a coloured chip.
function sectionHeading(num, title) {
  ensureSpace(16); y += 2
  doc.setFillColor(238, 240, 255)
  doc.roundedRect(marginX, y - 4.8, contentW, 9, 1.6, 1.6, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...BRAND)
  doc.text(String(num), marginX + 4, y + 0.4)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...DARK)
  doc.text(title, marginX + 12, y + 0.4)
  y += 9
}

function subHeading(title) {
  ensureSpace(8)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.8); doc.setTextColor(...BRAND)
  doc.text(title, marginX, y); y += 5.2
}

// A labelled feature line: bold lead-in on the first line, then the explanation
// wrapped at full width with a hanging indent. Operates on cleaned text so the
// first-line measurement and the wrap stay aligned.
function feature(name, text) {
  ensureSpace(7)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.3); doc.setTextColor(...DARK)
  doc.text('-', marginX + 1, y)
  const lead = CLEAN(name) + '  '
  const leadW = doc.getStringUnitWidth(lead) * 9.3 / doc.internal.scaleFactor
  doc.text(name, marginX + 5, y)
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...BODY)
  const body = CLEAN(text)
  // First line shares the label line (narrower); remaining lines are full width.
  const firstFit = doc.splitTextToSize(body, contentW - 5 - leadW)[0] || ''
  doc.text(firstFit, marginX + 5 + leadW, y); y += 4.6
  const remainder = body.slice(firstFit.length).trimStart()
  if (remainder) for (const ln of doc.splitTextToSize(remainder, contentW - 5)) {
    ensureSpace(5); doc.text(ln, marginX + 5, y); y += 4.5
  }
  y += 1.6
}

// Key/value reference rows.
function defList(rows) {
  doc.setFontSize(8.8)
  for (const [k, v] of rows) {
    ensureSpace(6)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK); doc.text(k, marginX + 2, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...BODY)
    const lines = doc.splitTextToSize(v, contentW - 46)
    doc.text(lines, marginX + 46, y)
    y += Math.max(4.6, 4.4 * lines.length) + 0.6
  }
  y += 2
}

/* ════════════════════ HEADER ════════════════════ */
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
doc.text('Training Guide - The Daily Order List', marginX, y); y += 6
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
doc.text(`How the Orders page works and what every feature does.  Generated ${new Date().toLocaleDateString()}.`, marginX, y)
y += 9

para('The Daily Order List (the Orders page) is the call center’s main working screen. It shows every active '
  + 'order for the day, lets you create, find, edit, assign, charge, collect and close orders, and rolls the whole '
  + 'filtered view into live money totals at the bottom. Closed orders move to their own page; this screen shows the '
  + 'work still in progress. This guide walks the screen top to bottom.')

/* ════════════════════ 1 — ANATOMY ════════════════════ */
sectionHeading(1, 'Anatomy of the screen')
feature('Top toolbar (sticky)', 'Stays pinned as you scroll: search box, status filter chips, payment filter chips, and the two "New order" buttons, with the advanced filters on the row below.')
feature('The order table', 'One row per order: Order #, Recipient, Customer, Driver, Delivery Fee, Status, Payment, and the row action buttons.')
feature('Floating totals bar (sticky)', 'Pinned to the bottom: the count of orders in view and their live per-currency totals, with an expandable full breakdown.')
feature('Hover preview', 'Resting the mouse on any row pops up that order’s full amounts summary (totals, collected, balance, what is owed by the driver) without opening it.')

/* ════════════════════ 2 — FINDING ORDERS ════════════════════ */
sectionHeading(2, 'Finding orders - search & filters')
subHeading('Search')
para('The search box matches across order number, recipient name / mobile / WhatsApp, delivery and pickup address, '
  + 'the main account, and the customer name or account number. The X clears it.', { size: 9.2 })

subHeading('Status filter chips')
para('All, Scheduled, In Progress, Completed, Cancelled. The chips reuse the same colours as the status badges in the '
  + 'list, so the filter and the rows match at a glance.', { size: 9.2 })

subHeading('Payment filter chips')
para('All, Unpaid, Partial, With Driver, Paid - filter by how the order has been paid. These reuse the payment-badge '
  + 'colours. (With Driver = collected_by_driver; Paid = paid_to_office.)', { size: 9.2 })

subHeading('Advanced filters (second row)')
defList([
  ['Driver', 'Show only one driver’s orders.'],
  ['Customer', 'Show only one contact’s orders.'],
  ['Customer type', 'Credit customers, Regular customers, Partners, or Suppliers.'],
  ['Order source', 'Local orders (entered here) vs External orders (from the online app).'],
  ['Scheduled date', 'A single scheduled date, or a From / to range (inclusive). Orders with no scheduled date drop out once a date is set.'],
  ['Clear', 'Appears when any advanced filter is active; resets them all in one click.'],
])
para('All filters combine (AND). The floating totals bar and the Display Pendings popup always reflect exactly the '
  + 'filtered set, so you can total a single driver, day or customer.', { size: 9, color: GREY })

/* ════════════════════ 3 — SORTING ════════════════════ */
sectionHeading(3, 'Sorting the list')
para('Click any sortable column header - Order #, Recipient, Customer, Driver, Delivery Fee, Status or Payment - to '
  + 'sort. Each click cycles A->Z, then Z->A, then back to no sort; the active arrow shows the direction. Amounts sort '
  + 'numerically, text sorts naturally (so 2 comes before 10).')

/* ════════════════════ 4 — READING A ROW ════════════════════ */
sectionHeading(4, 'Reading a row')
feature('Order # cell', 'Scheduled date on top, then the order number (click to copy - a green tick confirms). A globe icon marks an online/external order. Below sits the confirmation chip: green "Confirmed" or fuchsia "Not confirmed". A green lock "Closed" tag shows once the order is closed.')
feature('Row colour cues', 'A not-confirmed order is tinted fuchsia. An overdue order (active and past its scheduled deadline) is tinted red. A deactivated (cancelled / failed) order is dimmed.')
feature('Recipient cell', 'Recipient name and mobile, plus "From:" pickup and "To:" delivery addresses.')
feature('Customer cell', 'The contact name (company name for companies / partners), a credit-card icon for credit customers, and the formatted account number.')
feature('Driver cell', 'The assigned driver and their current vehicle, or "Unassigned". The truck button opens the quick driver picker.')
feature('Delivery Fee cell', 'The fee with its currency (green when set). Any discount shows beneath it. The button opens the quick fee editor.')
feature('Status cell', 'The order-status badge (Scheduled / In Progress / Completed), with the physical delivery status (Awaiting Pickup, Picked Up, In Transit, Delivered) beneath it.')
feature('Payment cell', 'The payment badge (Unpaid / Partial / With Driver / Paid) and the collection note.')

/* ════════════════════ 5 — QUICK ACTIONS FROM THE ROW ════════════════════ */
sectionHeading(5, 'Quick actions - editing without opening the order')
para('Several cells are editable straight from the list via small pop-ups, so the common changes need no full form. '
  + 'All of these are blocked once a row is locked (closed, cancelled or failed).')
feature('Assign / change driver', 'Truck button -> pick a driver (searchable) or unassign. Locked once the order is picked up (delivery status past Awaiting Pickup) - the driver can no longer be swapped.')
feature('Change status', 'Click the status badge -> choose Scheduled / In Progress / Completed. Choosing Completed also sets the delivery status to Delivered automatically, keeping the two in sync.')
feature('Edit delivery fee', 'Click the fee chip -> type an amount and currency, Save (or Clear to zero). The order total is recomputed instantly so list totals and the Amount(s) sort stay correct.')
feature('Confirm / unconfirm', 'Click the confirmation chip (or the globe on online orders) -> Confirmed / Not confirmed. This sets the order_confirmed flag and stamps who/when; it does not change the order status.')

/* ════════════════════ 6 — ROW ACTION BUTTONS ════════════════════ */
sectionHeading(6, 'Row action buttons (right side)')
feature('Record payment (banknote)', 'Opens the quick-pay box to collect money against the order without opening the full form. It refuses an amount above the remaining balance and tells you the most you can still take in that currency. A payment recorded here is stamped with you as the collector - treated as paid to the office (not driver cash). Once fully paid the button becomes a green tick "Fully paid - nothing to collect".')
feature('Edit / View (pencil)', 'Opens the full order form. On a locked order it opens read-only ("View (locked)").')
feature('Mark Closed (lock)', 'One-click close. Enabled only when the order is fully collected (Paid) AND its delivery status is Delivered. It locks the order (isclosed) so it can no longer be edited and moves it off the daily list.')
feature('Deactivate / Reactivate (power)', 'Deactivating an active order opens a confirmation that lists every transaction to be removed; on confirm it deletes packages, services, local items, external retails and payments, zeroes the fee, marks it Cancelled, and records the reason and who/when. Reactivating a cancelled order restores it immediately. Closed orders cannot be deactivated.')

/* ════════════════════ 7 — CREATING ORDERS ════════════════════ */
sectionHeading(7, 'Creating an order')
feature('New Multipurpose Order', 'Opens a blank order form: customer & recipient, pickup / delivery locations (multiple tags), driver, scheduled date and time window, order type, delivery fee, discount and VAT, plus the line-item sub-sections (catalogue items, delivery packages, order services, external retail invoices) and a Payments section.')
feature('Add Credit Order', 'Same form in credit mode - the customer pickers list only credit-allowed contacts, for orders billed to an account rather than collected on delivery.')
para('Every new order gets its number automatically (ORD-YYYYMMDD plus a daily sequence) and opens as Scheduled / '
  + 'Awaiting Pickup / Unpaid. The payment status is then derived from money paid versus the order total per currency.',
  { size: 9, color: GREY })

/* ════════════════════ 8 — TOTALS ════════════════════ */
sectionHeading(8, 'The money totals (bottom bar & Pendings)')
feature('Order count', 'How many orders the current filter shows.')
feature('Total (fees + local retail)', 'Per-currency sum of delivery fees plus local retail items across the filtered orders - what is collectible from drivers for those lines.')
feature('Payments (collected)', 'Per-currency total already collected from customers across the filtered orders.')
feature('Totals breakdown (expand)', 'The receipt toggle grows a full per-currency table: packages, services, local & external retail, fees, discount, VAT, Total All, Collected, Balance, To collect from driver, and Order Pending - the same categories as the per-order popup, summed across the filter.')
feature('Display Pendings', 'A popup summarising, per currency, the ordered total, the amount paid, and what is still pending for the filtered set.')

/* ════════════════════ LOCKING NOTE ════════════════════ */
ensureSpace(34); y += 1
const boxTop = y
doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...TEAL)
y += 6; doc.text('Remember: when is a row locked?', marginX + 4, y); y += 5.5
doc.setFont('helvetica', 'normal'); doc.setFontSize(8.9); doc.setTextColor(...BODY)
for (const ln of doc.splitTextToSize(
  'A row is locked - no edit, payment, status change, driver assignment or deactivation - when the order is closed '
  + '(isclosed) or deactivated (cancelled / failed). On top of that, the driver cannot be changed once the order is '
  + 'picked up, and the quick Pay button disappears once the order is fully paid. The pencil still opens a locked order '
  + 'in read-only view.', contentW - 8)) {
  ensureSpace(5); doc.text(ln, marginX + 4, y); y += 4.6
}
y += 2
doc.setDrawColor(...TEAL); doc.setLineWidth(0.4)
doc.roundedRect(marginX, boxTop, contentW, y - boxTop, 2, 2, 'S')
y += 4

para('In short: search and filter to the orders you care about, read each row’s badges and colours at a glance, '
  + 'use the in-row pop-ups for quick changes, the action buttons to pay / close / cancel, and the bottom bar to watch '
  + 'the money - all without leaving the list.', { size: 9, color: GREY })

/* ════════════════════ FOOTERS ════════════════════ */
const pages = doc.internal.getNumberOfPages()
for (let i = 1; i <= pages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
  doc.text('iDeliver III - Daily Order List Training', marginX, pageH - 8)
  doc.text(`Page ${i} of ${pages}`, pageW - marginX, pageH - 8, { align: 'right' })
}

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('Wrote', OUT)
