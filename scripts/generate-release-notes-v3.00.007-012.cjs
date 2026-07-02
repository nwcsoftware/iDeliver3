/* Generates a branded PDF of everything added to iDeliver III after v3.00.006,
   up to and including v3.00.012.
   Uses the project's existing jspdf. Run: node scripts/generate-release-notes-v3.00.007-012.cjs */
const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT = path.join(__dirname, '..')
const LOGO = path.join(ROOT, 'src', 'assets', 'ideliver-logo-login.png')
const OUT  = path.join(ROOT, 'iDeliver-III-Release-Notes-v3.00.007-012.pdf')

// Read PNG width/height from the IHDR chunk so we can scale without distortion.
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const BRAND = [99, 102, 241]      // indigo
const DARK  = [30, 41, 59]
const GREY  = [100, 116, 139]

// Newest first.
const versions = [
  {
    v: 'v3.00.012', date: '2026-06-19',
    items: [
      ['Daily order list — smarter filters',
        'The order-status filter chips now match the status badges in the list (same pill shape and colours) and the redundant "Confirmed" filter was removed. A new payment-status filter sits beside them: All · Unpaid · Partial · With Driver · Paid, coloured to match the payment badges, so the day’s orders can be narrowed by how they’ve been paid.'],
      ['Deactivate order with full clean-up',
        'Deactivating an order now opens a confirmation that lists every transaction it will remove (packages, services, local items, external retails, payments) and lets the user enter a cancellation reason. On confirm it deletes those transactions, sets the delivery fee to 0, marks the order Cancelled, and records who requested the cancellation and when.'],
      ['Payment collector tracking',
        'A payment recorded from the order list ("Record payment") or the order form is now stamped with the signed-in user as the collector. A payment taken by the office this way is treated as paid directly to the office — it is excluded from the driver’s settlement (the driver never handled that cash) and the amounts popup shows "Collected by <name>".'],
      ['Daily Cashier Box (new page)',
        'A new Cashier Box screen totals the money in and out for closed orders over a chosen day or range: collected (office-taken payments) versus spent (external retail invoices, delivery packages and services). It shows per-currency Collected / Spent / Net-in-box cards, a Collected-vs-Spent chart, a line-by-line statement, and a one-click PDF of the statement.'],
      ['Driver Settlements refinements',
        'The settlement list now shows each order’s full Total alongside Collected and Total dues, and lists only fully-paid orders. When an order’s total dues are zero, the Collect button explains that the driver must confirm collection in his app — or, if the customer paid the call center directly, that a payment should be recorded from the order form or daily list.'],
      ['Delete Order admin tool (new)',
        'Under Settings, admins can permanently delete a single order by number. A warning spells out exactly what will be removed, and the action is armed only after typing "Confirme". The order and all of its related data are erased, and a history entry is written to the audit log with the acting user, the company, and a description naming the order number, type, customer and driver.'],
    ],
  },
  {
    v: 'v3.00.011', date: '2026-06-17',
    items: [
      ['Itemized amounts popup',
        'The order-amounts summary now itemizes delivery packages, order services and external retail invoices per source / partner. Paid lines are shown crossed-out and excluded from the running totals, so what is still owed is clear at a glance.'],
      ['Location tags & saved-locations library',
        'Pickup and delivery now use tag fields with a quick-pick popup backed by a saved-locations library, so common addresses can be reused. Selecting a retail shop automatically adds it as a pickup tag and keeps the two in sync.'],
      ['Activate / deactivate drivers',
        'The Drivers list replaces hard delete with an activate/deactivate toggle (driver records are kept, just marked inactive). Retail invoices now default the Paid toggle to on.'],
      ['Backend fixes',
        'SQL fix56 lets reset_all_orders tolerate missing tables, fix57 resolves an ambiguous "username" reference in admin_set_driver_credentials, and fix58 makes the retail-invoice Paid default true.'],
    ],
  },
  {
    v: 'v3.00.010', date: '2026-06-16',
    items: [
      ['List totals include fees + local retail',
        'The daily and closed-order floating totals bar now adds delivery fees and local retail items together, grouped per currency. The Driver Settlement bar gains a neon "To collect" figure (fees + local retail) shown beside Collected · Petty · Net, backed by a shared orderDriverCollectByCurrency helper.'],
    ],
  },
  {
    v: 'v3.00.009', date: '2026-06-16',
    items: [
      ['Highlight "To collect from driver"',
        'The "To collect from driver" figure in the amounts popup now stands out with a neon highlight, making the outstanding driver cash easier to spot.'],
    ],
  },
  {
    v: 'v3.00.008', date: '2026-06-16',
    items: [
      ['Driver login credentials',
        'The driver form gains a User Account & Security section where an admin can set the driver’s username and password, backed by the admin_set_driver_credentials function — so drivers can sign in to the driver app.'],
      ['Itemized order-amounts summary',
        'A reworked amounts popup breaks the order down per category (packages, services, local retail, external retail, fees) with a Total All, plus collected, balance, to-collect-from-driver and order-pending figures. The same component is shared across the daily list, closed orders and driver dues.'],
    ],
  },
  {
    v: 'v3.00.007', date: '2026-06-16',
    items: [
      ['Price List page (new)',
        'A new Price List screen for maintaining standard prices, reachable from the sidebar.'],
      ['Driver Dues page (new)',
        'A dedicated Driver Dues screen that totals what each driver owes and supports collection / settlement, sharing the same order-amounts logic as the order list.'],
      ['Returnable Items page (new)',
        'A new screen to track returnable items.'],
      ['Reset Orders page (new)',
        'An admin maintenance screen to reset/clear order data.'],
      ['Shared order-amounts engine',
        'A new orderAmounts helper centralizes how an order’s totals — items, packages, services, retail and fees — are computed, so every screen shows the same numbers. Order Packages and Order Services sub-forms were extended to feed it.'],
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
doc.text(`Everything added after v3.00.006, up to v3.00.012.  Generated ${new Date().toLocaleDateString()}.`, marginX, y)
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
const note = 'Backend: delivered with Supabase migrations fix40–fix60 — driver login credentials (fix54), saved-location and reset-order helpers (fix55–fix58), and the payment-collector columns plus single-order delete & audit-description (fix59–fix60), applied with the existing anon access policies.'
for (const ln of doc.splitTextToSize(note, pageW - marginX * 2)) { doc.text(ln, marginX, y); y += 4.5 }

// page numbers
const pages = doc.internal.getNumberOfPages()
for (let i = 1; i <= pages; i++) {
  doc.setPage(i)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
  doc.text(`iDeliver III · v3.00.007–v3.00.012`, marginX, pageH - 8)
  doc.text(`Page ${i} of ${pages}`, pageW - marginX, pageH - 8, { align: 'right' })
}

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('Wrote', OUT)
