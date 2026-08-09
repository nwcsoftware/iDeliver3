/* Builds the NXCORE change-request quotations as PDFs.

   Prices are the mid-point of the estimated ranges. Three documents are
   produced from the same item list:

     · the combined quotation, both sections, 60% discount
     · change request 0001 — Section A only, 10% discount
     · change request 0002 — Section B only, 10% discount

   Run with:  node scripts/make-quotation.cjs                                */

const fs   = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT   = path.join(__dirname, '..')
const CLIENT = 'iDeliver III — Operations'

/* ── the items ─────────────────────────────────────────────────────────── */

const sectionA = {
  title: 'Section A — Driver Application',
  short: 'Driver Application',
  note:  'Changes to the driver mobile application. Includes one full build, test '
       + 'and distribution cycle to the drivers’ devices.',
  rows: [
    ['A1', 'Returnable items scoped per driver',
           'Each driver sees and collects only his own returnable items, instead of the whole company list.', 175],
    ['A2', 'Delivery-fee and order totals on the driver app',
           'The driver sees his own running total and order count, saving time during money collection.', 175],
    ['A3', 'Block payment on a closed order',
           'Prevents the driver from collecting money against an order that is already closed.', 100],
    ['A4', 'Arabic delivery addresses',
           'Arabic address field carried through the office, customer app and driver app, so drivers who do not read English can work from the address.', 575],
    ['A5', 'Application build, testing and rollout',
           'One release cycle covering the changes above.', 125],
  ],
}

const sectionB = {
  title: 'Section B — Partner Portal & Office Application',
  short: 'Partner Portal & Office',
  note:  'Changes to the partner portal and the office application. No mobile '
       + 'release cycle is required.',
  rows: [
    ['B1', 'Package label printing',
           'Select packages by delivery date and print or export labels carrying the order, recipient, sender, amounts, reference and barcode.', 0, 250],
    ['B2', 'Bulk confirmation of partner orders',
           'Select several orders, or a whole day, and confirm them in one action.', 0, 150],
    ['B3', 'Call-centre orders shown under the partner’s username',
           'A partner order raised by the call centre appears in that partner’s own account.', 175],
    ['B4', 'Delivery fees restricted to the partner’s username',
           'Fees are visible only to the partner they belong to.', 115],
    ['B5', 'Partner statement by date range',
           'The partner selects a from/to date and reads his own statement for that period.', 140],
    ['B6', 'Confirmed orders only in the calculated amount',
           'Unconfirmed orders no longer affect the partner’s figures.', 90],
    ['B7', 'Totals for completed and scheduled orders',
           'Both totals shown on the partner account for day-to-day monitoring.', 125],
  ],
}

/* Terms that apply everywhere, plus the ones tied to a particular section. */
const baseTerms = (validDays) => ([
  'Prices are in US Dollars and exclude any third-party or platform fees (application '
  + 'store accounts, hosting, SMS or mapping charges), which are billed at cost if incurred.',
  'This quotation is valid for ' + validDays + ' days from the date above.',
  'Payment terms: 50% on acceptance, 50% on delivery.',
])
const TERM_A4 =
  'Item A4 is quoted at the fuller scope: a dedicated Arabic address field carried through '
  + 'the office, customer and driver applications. If the requirement is only to display an '
  + 'address that is already typed in Arabic, this item reduces to USD 100.'
const TERM_ROLLOUT =
  'This section requires a new version of the driver application to be installed on each '
  + 'driver’s device. Delivery is complete once the new version is published.'
const TERM_DELIVERED =
  'Items B1 and B2 have already been developed and are in service. They are listed at their '
  + 'value and carried at no charge.'
const TERM_WARRANTY =
  'Defects in the delivered items are corrected free of charge for 30 days after delivery. '
  + 'New requirements raised after acceptance are quoted separately.'

/* ── drawing ───────────────────────────────────────────────────────────── */

const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const W = 210, H = 297, M = 16
const INNER = W - M * 2
const BRAND = [37, 99, 235]
const INK   = [17, 24, 39]
const MUTED = [107, 114, 128]
const LINE  = [209, 213, 219]
const GREEN = [22, 128, 61]

const LOGO = 'data:image/png;base64,'
  + fs.readFileSync(path.join(ROOT, 'src/assets/nxcore-logo.png')).toString('base64')

function build({ file, quoteNo, date, validDays, discount, sections, subject, terms }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 0, page = 1

  const footer = () => {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2)
    doc.line(M, H - 16, W - M, H - 16)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    doc.text('NXCORE Software · Quotation ' + quoteNo, M, H - 11.5)
    doc.text('This document is a quotation, not an invoice.', W / 2, H - 11.5, { align: 'center' })
    doc.text('Page ' + page, W - M, H - 11.5, { align: 'right' })
  }
  const newPage = () => { footer(); doc.addPage(); page += 1; y = M + 4 }
  const room = mm => { if (y + mm > H - 22) newPage() }

  // ── header
  const props = doc.getImageProperties(LOGO)
  const logoH = 12, logoW = (props.width / props.height) * logoH
  doc.addImage(LOGO, 'PNG', M, M, logoW, logoH)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK)
  doc.text('QUOTATION', W - M, M + 6, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED)
  doc.text(quoteNo, W - M, M + 11.5, { align: 'right' })

  y = M + logoH + 8
  doc.setDrawColor(...BRAND); doc.setLineWidth(0.8)
  doc.line(M, y, W - M, y)
  y += 8

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('FROM', M, y)
  doc.text('PREPARED FOR', M + INNER / 2, y)
  y += 4.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK)
  doc.text('NXCORE Software', M, y)
  doc.text(CLIENT, M + INNER / 2, y)
  y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  doc.text('North Lebanon', M, y)
  doc.text('iDeliver III delivery management suite', M + INNER / 2, y)
  y += 4
  doc.text('+961 81 585 255', M, y)
  y += 4
  doc.text('Date: ' + date, M, y)
  doc.text('Valid for ' + validDays + ' days', M + INNER / 2, y)
  y += 9

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
  doc.text('Subject: ' + subject, M, y)
  y += 5.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  const intro = doc.splitTextToSize(
    'The following changes have been reviewed and estimated. Each item is priced individually so that '
    + 'any of them may be accepted, deferred or declined without affecting the others.', INNER)
  doc.text(intro, M, y)
  y += intro.length * 3.6 + 5.5

  // ── item tables
  const COL_REF = M, COL_DESC = M + 12, COL_PRICE = W - M
  const DESC_W = INNER - 12 - 24
  const subtotals = []

  for (const section of sections) {
    room(30)
    doc.setFillColor(243, 244, 246)
    doc.rect(M, y - 4.5, INNER, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
    doc.text(section.title, M + 2, y)
    y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    const note = doc.splitTextToSize(section.note, INNER)
    doc.text(note, M, y)
    y += note.length * 3.6 + 3.5

    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    doc.text('REF', COL_REF, y)
    doc.text('DESCRIPTION', COL_DESC, y)
    doc.text('PRICE (USD)', COL_PRICE, y, { align: 'right' })
    y += 2
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
    doc.line(M, y, W - M, y)
    y += 5

    let subtotal = 0
    for (const [ref, title, detail, price, listPrice] of section.rows) {
      const body = doc.splitTextToSize(detail, DESC_W)
      room(body.length * 3.5 + 10)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
      doc.text(ref, COL_REF, y)
      doc.text(doc.splitTextToSize(title, DESC_W)[0], COL_DESC, y)
      if (price === 0) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GREEN)
        doc.text('No charge', COL_PRICE, y, { align: 'right' })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
        doc.text('value ' + money(listPrice), COL_PRICE, y + 3.4, { align: 'right' })
      } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
        doc.text(money(price), COL_PRICE, y, { align: 'right' })
      }
      y += 4
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
      doc.text(body, COL_DESC, y)
      y += body.length * 3.5 + 3.5
      doc.setDrawColor(235, 237, 240); doc.setLineWidth(0.2)
      doc.line(M, y - 1.5, W - M, y - 1.5)
      y += 2.5
      subtotal += price
    }

    // A single-section quotation carries its total in the totals box below, so
    // the per-section subtotal line only earns its place when there are two.
    if (sections.length > 1) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
      doc.text('Subtotal — ' + section.short, COL_DESC, y)
      doc.text(money(subtotal), COL_PRICE, y, { align: 'right' })
      y += 9
    } else {
      y += 3
    }
    subtotals.push({ section, subtotal })
  }

  // ── totals
  const gross = subtotals.reduce((n, s) => n + s.subtotal, 0)
  const cut   = gross * discount
  const net   = gross - cut

  const boxH = 18 + subtotals.length * 5.5 + (sections.length > 1 ? 0 : -3)
  room(boxH + 22)
  doc.setFillColor(249, 250, 251)
  doc.rect(M + INNER / 2 - 6, y - 2, INNER / 2 + 6, boxH + 20, 'F')

  const LX = M + INNER / 2, RX = W - M
  y += 4
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK)
  for (const { section, subtotal } of subtotals) {
    doc.text(section.short, LX, y)
    doc.text(money(subtotal), RX, y, { align: 'right' })
    y += 5.5
  }
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
  doc.line(LX, y - 2, RX, y - 2)
  doc.setFont('helvetica', 'bold')
  doc.text('Total before discount', LX, y + 2)
  doc.text(money(gross), RX, y + 2, { align: 'right' })
  y += 8
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREEN)
  doc.text('Special discount (' + Math.round(discount * 100) + '%)', LX, y)
  doc.text('- ' + money(cut), RX, y, { align: 'right' })
  y += 5
  doc.setDrawColor(...BRAND); doc.setLineWidth(0.6)
  doc.line(LX, y, RX, y)
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...BRAND)
  doc.text('TOTAL PAYABLE', LX, y)
  doc.text('USD ' + money(net), RX, y, { align: 'right' })
  y += 10

  const freeValue = sections
    .flatMap(s => s.rows)
    .filter(r => r[3] === 0)
    .reduce((n, r) => n + (r[4] || 0), 0)
  if (freeValue > 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    const t = doc.splitTextToSize(
      'Items carried at no charge, valued at USD ' + money(freeValue)
      + ', have already been delivered and are not included in the totals above.', INNER)
    doc.text(t, M, y)
    y += t.length * 3.4 + 6
  }

  // ── terms
  room(20)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK)
  doc.text('Terms and conditions', M, y)
  y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  terms.forEach((term, i) => {
    const t = doc.splitTextToSize(term, INNER - 5)
    room(t.length * 3.4 + 4)
    doc.text(String(i + 1) + '.', M, y)
    doc.text(t, M + 5, y)
    y += t.length * 3.4 + 2.2
  })
  y += 8

  // ── signatures
  room(26)
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
  doc.line(M, y + 12, M + 70, y + 12)
  doc.line(W - M - 70, y + 12, W - M, y + 12)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('For NXCORE Software', M, y + 16)
  doc.text('Accepted for ' + CLIENT, W - M - 70, y + 16)
  doc.text('Name, signature and date', M, y + 20)
  doc.text('Name, signature and date', W - M - 70, y + 20)

  footer()
  const out = path.join(ROOT, file)
  fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')))
  console.log(file.padEnd(46), 'gross', money(gross), '· discount', money(cut), '· net', money(net))
}

/* ── the three documents ───────────────────────────────────────────────── */

build({
  file: 'NXCORE_Quotation_iDeliver_2026-08-09.pdf',
  quoteNo: 'NXC-Q-2026-014', date: '09 August 2026', validDays: 30, discount: 0.60,
  sections: [sectionA, sectionB],
  subject: 'Change requests — driver application and partner portal',
  terms: [...baseTerms(30), TERM_A4, TERM_ROLLOUT, TERM_DELIVERED, TERM_WARRANTY],
})

build({
  file: '_NXCORE_Quotation_CR_20260808_0001.pdf',
  quoteNo: 'CR-20260808-0001', date: '08 August 2026', validDays: 30, discount: 0.10,
  sections: [sectionA],
  subject: 'Change request — driver application (returnable items, totals, closed-order payments, Arabic addresses)',
  terms: [...baseTerms(30), TERM_A4, TERM_ROLLOUT, TERM_WARRANTY],
})

build({
  file: '_NXCORE_Quotation_CR_20260808_0002.pdf',
  quoteNo: 'CR-20260808-0002', date: '08 August 2026', validDays: 30, discount: 0.10,
  sections: [sectionB],
  subject: 'Change request — partner portal and office application (statements, visibility, order totals)',
  terms: [...baseTerms(30), TERM_DELIVERED, TERM_WARRANTY],
})
