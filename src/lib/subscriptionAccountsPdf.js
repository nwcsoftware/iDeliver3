import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { loadNxcoreLogo, drawLetterhead, drawFooters, drawPreparedBlock, PDF_COLORS } from './nxcoreLetterhead'
import { contactLabel, todayStr } from './subscriptions'
import { accountOf, accountTotals, ACCOUNT_STATUS, fmtAccount } from './subscriptionAccounts'

/* PARTNER SUBSCRIPTIONS — STATUS. The Subscription Accounts page on paper:
   who has paid the office, what the office owes the super admin, and what is
   left between the two. Same letterhead as Due Payments, so the house's papers
   read as one. Totals per currency, never combined. */

const { BRAND, INK, MUTED, LINE, SOFT } = PDF_COLORS
const GREEN = [21, 128, 61], AMBER = [180, 83, 9], RED = [185, 28, 28]
const ymd = (ts) => (ts ? String(ts).slice(0, 10) : '')

export async function downloadSubscriptionAccountsPdf(rows, { loginName = () => '', filterNote = '', generatedBy = '', today = todayStr() } = {}) {
  const logo = await loadNxcoreLogo()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 12
  const docNo = `PS-${today.replace(/-/g, '')}`

  let y = drawLetterhead(doc, { logo, title: 'Partner subscriptions', subtitle: `Payments and settlement · ${docNo}`, margin: M })

  // ── left: as of / prepared by / what is shown ──────────────────────────────
  const totals = accountTotals(rows, today)
  const currencies = Object.keys(totals)
  const panelW = 150
  const panelX = W - M - panelW
  const topY = y
  drawPreparedBlock(doc, { x: M, y, asOf: today, preparedBy: generatedBy })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  const freeCount = rows.filter(r => accountOf(r, today).free).length
  doc.text(doc.splitTextToSize(
    `${rows.length - freeCount} partner subscription${rows.length - freeCount === 1 ? '' : 's'}`
    + (freeCount ? `, plus ${freeCount} free seat${freeCount === 1 ? '' : 's'} (nothing owed either way)` : '')
    + (filterNote ? `. Shown: ${filterNote}.` : '.'), panelX - M - 8), M, y + 26)

  // ── right: the two accounts, per currency ─────────────────────────────────
  const lineH = 5.4
  const panelH = 9 + currencies.length * (lineH * 3 + 3)
  doc.setFillColor(...SOFT)
  doc.rect(panelX, topY - 4, panelW, Math.max(panelH, 18), 'F')
  const cols = [panelX + 4, panelX + 54, panelX + 104]
  let py = topY + 1
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('CHARGED TO PARTNERS', cols[0], py)
  doc.text('OWED TO THE SUPER ADMIN', cols[1], py)
  doc.text('OFFICE MARGIN', cols[2], py)
  py += 5.5
  if (!currencies.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text('No partner subscriptions in this view.', cols[0], py)
  }
  for (const c of currencies) {
    const t = totals[c]
    const line = (x, label, value, color) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
      doc.text(label, x, py)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...color)
      doc.text(fmtAccount(value, c), x + 44, py, { align: 'right' })
    }
    line(cols[0], 'Total', t.charged, INK);   line(cols[1], 'Total', t.owed, INK)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...BRAND)
    doc.text(fmtAccount(t.margin, c), cols[2] + 40, py + 2, { align: 'right' })
    py += lineH
    line(cols[0], 'Received', t.received, GREEN); line(cols[1], 'Settled', t.settled, GREEN)
    py += lineH
    line(cols[0], 'Pending', t.pending, AMBER);   line(cols[1], 'Due', t.due, AMBER)
    if (t.unknown) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...RED)
      doc.text(`${t.unknown} with no amount owed set`, cols[2], py)
    }
    py += lineH + 3
  }

  y = Math.max(topY + 34, topY - 4 + panelH + 6)

  // ── the subscriptions ─────────────────────────────────────────────────────
  // No arrows: the standard PDF fonts have no → and print it as "!'".
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 20 },
    theme: 'plain',
    styles: { fontSize: 7.8, cellPadding: { top: 1.7, bottom: 1.7, left: 1.8, right: 1.8 }, textColor: INK, valign: 'middle' },
    headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: 'bold', fontSize: 6.8 },
    head: [['Partner', 'Period', 'Status', 'Price', 'Partner payment', 'Owed to super admin', 'Settlement', 'Margin']],
    body: rows.map(r => {
      const a = accountOf(r, today)
      const login = loginName(r)
      return [
        contactLabel(r.contact) + (login ? `\n@${login}` : ''),
        `${r.start_date || '?'}\nto ${r.end_date || '?'}`,
        ACCOUNT_STATUS[a.status].label,
        a.free ? '—' : fmtAccount(a.price, a.currency),
        a.free ? 'nothing to pay'
          : a.received ? `Paid ${ymd(r.paid_at)}${r.payment_method ? `\n${r.payment_method}` : ''}${r.payment_reference ? ` · ${r.payment_reference}` : ''}`
          : 'Pending',
        a.vendor == null ? 'not set' : fmtAccount(a.vendor, a.vendorCurrency),
        a.free || a.vendor === 0 ? '—'
          : a.settled ? `Settled ${ymd(r.vendor_settled_at)}${r.vendor_reference ? `\n${r.vendor_reference}` : ''}`
          : 'Due',
        a.margin == null ? '—' : fmtAccount(a.margin, a.currency),
      ]
    }),
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold' },
      1: { cellWidth: 24 },
      2: { cellWidth: 28 },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 40 },
      5: { cellWidth: 28, halign: 'right' },
      6: { cellWidth: 40 },
      7: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      // Money headings sit over their figures.
      if (data.section === 'head' && [3, 5, 7].includes(data.column.index)) data.cell.styles.halign = 'right'
      if (data.section !== 'body') return
      const t = String(data.cell.raw || '')
      if (data.column.index === 4 || data.column.index === 6) {
        data.cell.styles.textColor = /^(Paid|Settled)/.test(t) ? GREEN : /^(Pending|Due)/.test(t) ? AMBER : MUTED
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body') {
        doc.setDrawColor(...LINE); doc.setLineWidth(0.15)
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height)
      }
    },
  })

  drawFooters(doc, { reference: `${docNo} · amounts per currency, never combined`, margin: M })
  doc.save(`partner-subscriptions-${today}.pdf`)
}
