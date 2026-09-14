/* The NXCORE quotation letterhead, as a reusable builder.

   This is the same layout scripts/make-quotation.cjs draws — logo, blue rule,
   FROM / PREPARED FOR block, itemised sections, the discount box, terms and the
   two signature lines. It lives here so a new quotation is a list of items and
   nothing else.

   make-quotation.cjs deliberately keeps its own copy: it produced documents that
   have already been sent to the client, so it is a record rather than live code,
   and re-running it would only stamp today's date into last month's PDFs.

   A section is:
     { title, short, note, rows: [[ref, title, detail, price, listPrice?], …] }

   A price of 0 prints as "No charge" with the listPrice shown beneath it, which
   is how already-delivered work is carried at value without being billed.      */

const fs   = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT = path.join(__dirname, '..', '..')

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

/* Terms every quotation carries. */
const baseTerms = (validDays) => ([
  'Prices are in US Dollars and exclude any third-party or platform fees (application '
  + 'store accounts, hosting, SMS or mapping charges), which are billed at cost if incurred.',
  'This quotation is valid for ' + validDays + ' days from the date above.',
  'Payment terms: 50% on acceptance, 50% on delivery.',
])

const TERM_WARRANTY =
  'Defects in the delivered items are corrected free of charge for 30 days after delivery. '
  + 'New requirements raised after acceptance are quoted separately.'

function build({
  file, quoteNo, date, validDays, discount, sections, subject, terms,
  client = 'iDeliver III — Operations',
  clientLine = 'iDeliver III delivery management suite',
  intro = 'The following changes have been reviewed and estimated. Each item is priced individually so that '
        + 'any of them may be accepted, deferred or declined without affecting the others.',
}) {
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
  doc.text(client, M + INNER / 2, y)
  y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  doc.text('North Lebanon', M, y)
  doc.text(clientLine, M + INNER / 2, y)
  y += 4
  doc.text('+961 81 585 255', M, y)
  y += 4
  doc.text('Date: ' + date, M, y)
  doc.text('Valid for ' + validDays + ' days', M + INNER / 2, y)
  y += 9

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
  const subj = doc.splitTextToSize('Subject: ' + subject, INNER)
  doc.text(subj, M, y)
  y += subj.length * 4.4 + 1
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  const introLines = doc.splitTextToSize(intro, INNER)
  doc.text(introLines, M, y)
  y += introLines.length * 3.6 + 5.5

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
  doc.text('Accepted for ' + client, W - M - 70, y + 16)
  doc.text('Name, signature and date', M, y + 20)
  doc.text('Name, signature and date', W - M - 70, y + 20)

  footer()
  const out = path.join(ROOT, file)
  fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')))
  console.log(file.padEnd(52), 'gross', money(gross), '· discount', money(cut), '· net', money(net))
  return { gross, cut, net }
}

module.exports = { build, baseTerms, TERM_WARRANTY, money }
