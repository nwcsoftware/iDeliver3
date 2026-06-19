/* Generates a branded PDF of what's new in iDeliver III v3.00.012.
   Uses the project's existing jspdf. Run: node scripts/generate-release-notes-v3.00.012.cjs */
const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT = path.join(__dirname, '..')
const LOGO = path.join(ROOT, 'src', 'assets', 'ideliver-logo-login.png')
const VERSION = 'v3.00.012'
const OUT  = path.join(ROOT, `iDeliver-III-Release-Notes-${VERSION}.pdf`)

// Read PNG width/height from the IHDR chunk so we can scale without distortion.
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const BRAND = [99, 102, 241]      // indigo
const DARK  = [30, 41, 59]
const GREY  = [100, 116, 139]

const RELEASE_DATE = '2026-06-19'

const items = [
  ['Daily order list — smarter filters',
    'The order-status filter buttons now match the status badges in the list (same pill shape and colours), and the redundant "Confirmed" filter was removed. A new payment-status filter sits beside them: All · Unpaid · Partial · With Driver · Paid, coloured to match the payment badges, so the day’s orders can be narrowed by how they’ve been paid.'],
  ['Deactivate order with full clean-up',
    'Deactivating an order now opens a confirmation that lists every transaction it will remove (packages, services, local items, external retails, payments) and lets the user enter a cancellation reason. On confirm it deletes those transactions, sets the delivery fee to 0, marks the order Cancelled, and records who requested the cancellation and when.'],
  ['Payment collector tracking',
    'When a payment is recorded from the order list ("Record payment") or the order form, it is now stamped with the signed-in user as the collector. A payment taken by the office this way is treated as paid directly to the office — it is excluded from the driver’s settlement (the driver never handled that cash) and the amounts summary popup shows "Collected by <name>".'],
  ['Daily Cashier Box (new page)',
    'A new Cashier Box screen totals the money in and out for closed orders over a chosen day or range: collected (office-taken payments) versus spent (external retail invoices, delivery packages and services). It shows per-currency Collected / Spent / Net-in-box cards, a Collected-vs-Spent chart, a line-by-line statement, and a one-click PDF of the statement.'],
  ['Driver Settlements refinements',
    'The settlement list now shows each order’s full Total alongside Collected and Total dues, and lists only fully-paid orders. When an order’s total dues are zero, the Collect button explains that the driver must confirm collection in his app — or, if the customer paid the call center directly, that a payment should be recorded from the order form or daily list.'],
  ['Delete Order admin tool (new)',
    'Under Settings, admins can permanently delete a single order by number. A warning spells out exactly what will be removed, and the action is armed only after typing "Confirme". The order and all of its related data are erased from the database, and a history entry is written to the audit log with the acting user, the company, and a description naming the order number, type, customer and driver.'],
]

const BACKEND_NOTE = 'Backend: Supabase migrations fix59 (payment-collector columns on payment_collections) and fix60 (single-order delete function plus an audit-log description column), applied with the existing anon access policies.'

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
doc.text(`Release Notes — ${VERSION}`, marginX, y)
y += 6
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
doc.text(`What’s new in this version.  Released ${RELEASE_DATE}.  Generated ${new Date().toLocaleDateString()}.`, marginX, y)
y += 9

function ensureSpace(needed) {
  if (y + needed > pageH - 16) { doc.addPage(); y = 18 }
}

// version heading bar
ensureSpace(16)
doc.setFillColor(238, 240, 255)
doc.roundedRect(marginX, y - 4.5, pageW - marginX * 2, 8, 1.5, 1.5, 'F')
doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BRAND)
doc.text(VERSION, marginX + 3, y + 1)
doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
doc.text(RELEASE_DATE, pageW - marginX - 3, y + 1, { align: 'right' })
y += 10

for (const [title, desc] of items) {
  ensureSpace(12)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...DARK)
  doc.text('• ' + title, marginX + 3, y)
  y += 5.2
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60, 60, 60)
  const lines = doc.splitTextToSize(desc, pageW - marginX * 2 - 8)
  for (const ln of lines) {
    ensureSpace(6)
    doc.text(ln, marginX + 7, y)
    y += 4.8
  }
  y += 3.5
}

// ── Footer note ───────────────────────────────────────────────
ensureSpace(16)
doc.setDrawColor(225); doc.setLineWidth(0.3); doc.line(marginX, y, pageW - marginX, y); y += 6
doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
for (const ln of doc.splitTextToSize(BACKEND_NOTE, pageW - marginX * 2)) { doc.text(ln, marginX, y); y += 4.5 }

// page numbers
const pages = doc.internal.getNumberOfPages()
for (let i = 1; i <= pages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
  doc.text(`iDeliver III · ${VERSION}`, marginX, pageH - 8)
  doc.text(`Page ${i} of ${pages}`, pageW - marginX, pageH - 8, { align: 'right' })
}

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('Wrote', OUT)
