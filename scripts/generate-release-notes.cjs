/* Generates a branded PDF of what has been added to iDeliver III since v3.0.1.
   Uses the project's existing jspdf + jspdf-autotable. Run: node scripts/generate-release-notes.cjs */
const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT = path.join(__dirname, '..')
const LOGO = path.join(ROOT, 'src', 'assets', 'ideliver-logo-login.png')
const OUT  = path.join(ROOT, 'iDeliver-III-Release-Notes-v3.00.006.pdf')

// Read PNG width/height from the IHDR chunk so we can scale without distortion.
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const BRAND = [99, 102, 241]      // indigo
const DARK  = [30, 41, 59]
const GREY  = [100, 116, 139]

const versions = [
  {
    v: 'v3.00.006', date: '2026-06-10',
    items: [
      ['Account Transactions page',
        'New screen listing every posted account transaction from the Account Transaction Summary View. Includes a search box, filters (transaction type, currency, account number, order number, date range), per-currency Credit / Debit / Net totals, and a one-click PDF export of the filtered list.'],
      ['Quick "Pay" on the order list',
        'A Pay button on each order row opens a compact payment dialog (method, amount, currency, date, notes) that records the payment and automatically recomputes the order’s payment status and collected totals — the same effect as the order form’s Payments section, without opening the full order.'],
    ],
  },
  {
    v: 'v3.00.005', date: '2026-06-09',
    items: [
      ['Accounting entries on order close',
        'When an order is marked Closed, every line — delivery packages, services, local items, external retail invoice references, and the delivery fee — is posted to the account_transactions ledger. Each row carries the order number and the customer’s account number, and amounts are recorded in their own currency.'],
    ],
  },
  {
    v: 'Account numbers, order totals, vehicles & general customer', date: '2026-06-09',
    items: [
      ['Smart account numbers',
        'Customers, suppliers, partners, drivers and vehicles get auto-generated, unique 12-digit account numbers with a 2-digit category prefix (customer 42, supplier 34, partner 60, driver 40, vehicle 58), displayed grouped like a card number. Duplicates are detected and re-issued automatically.'],
      ['Complete order totals, multi-currency',
        'The order total now sums items + packages + services + external retail invoices + delivery fee, grouped by currency. The Delivery Packages section is always available on the order form.'],
      ['Default customer & more',
        'New orders default the customer to "GENERAL CUSTOMER". Added a Vehicles management page, an Order Services sub-form, and phone/mobile input helpers.'],
    ],
  },
  {
    v: 'v3.00.004', date: '2026-06-08',
    items: [
      ['Retail invoices & customer mobile app',
        'Retail goods invoices, supplier business types, and the customer-facing mobile app experience (registration, login and account view).'],
    ],
  },
  {
    v: 'v3.0.1', date: '2026-06-04',
    items: [
      ['Initial release',
        'Core delivery & logistics management: orders, drivers, live tracking, contacts (customers / suppliers / partners), products, purchase invoices, reports, dashboard, and user accounts with secure sign-in.'],
    ],
  },
]

const doc = new jsPDF({ unit: 'mm', format: 'a4' })
const pageW = doc.internal.pageSize.getWidth()
const pageH = doc.internal.pageSize.getHeight()
const marginX = 18
let y = 18

// ── Header with logo ──────────────────────────────────────────
const logoBuf = fs.readFileSync(LOGO)
const { w: iw, h: ih } = pngSize(logoBuf)
const logoW = 26
const logoH = logoW * (ih / iw)
doc.addImage('data:image/png;base64,' + logoBuf.toString('base64'), 'PNG', marginX, y, logoW, logoH)

doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...DARK)
doc.text('iDeliver III', marginX + logoW + 6, y + 9)
doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...GREY)
doc.text('Delivery & Logistics Management', marginX + logoW + 6, y + 16)

y += Math.max(logoH, 20) + 6
doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(marginX, y, pageW - marginX, y)
y += 9

doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...BRAND)
doc.text('Release Notes — What’s New', marginX, y)
y += 6
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
doc.text(`Everything added since v3.0.1, up to the current v3.00.006.  Generated ${new Date().toLocaleDateString()}.`, marginX, y)
y += 8

function ensureSpace(needed) {
  if (y + needed > pageH - 16) { doc.addPage(); y = 18 }
}

for (const ver of versions) {
  ensureSpace(16)
  // version heading bar
  doc.setFillColor(238, 240, 255)
  doc.roundedRect(marginX, y - 4.5, pageW - marginX * 2, 8, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BRAND)
  doc.text(ver.v, marginX + 3, y + 1)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
  doc.text(ver.date, pageW - marginX - 3, y + 1, { align: 'right' })
  y += 9

  for (const [title, desc] of ver.items) {
    ensureSpace(10)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...DARK)
    doc.text('• ' + title, marginX + 3, y)
    y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60)
    const lines = doc.splitTextToSize(desc, pageW - marginX * 2 - 8)
    for (const ln of lines) {
      ensureSpace(6)
      doc.text(ln, marginX + 7, y)
      y += 4.8
    }
    y += 2.5
  }
  y += 3
}

// ── Footer note ───────────────────────────────────────────────
ensureSpace(14)
doc.setDrawColor(225); doc.setLineWidth(0.3); doc.line(marginX, y, pageW - marginX, y); y += 6
doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
const note = 'Backend: delivered with Supabase migrations (fix17–fix39) adding user accounts, contact account numbers, order services, the account_transactions ledger and its summary view, plus the required access policies.'
for (const ln of doc.splitTextToSize(note, pageW - marginX * 2)) { doc.text(ln, marginX, y); y += 4.5 }

// page numbers
const pages = doc.internal.getNumberOfPages()
for (let i = 1; i <= pages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
  doc.text(`iDeliver III · v3.00.006`, marginX, pageH - 8)
  doc.text(`Page ${i} of ${pages}`, pageW - marginX, pageH - 8, { align: 'right' })
}

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('Wrote', OUT)
