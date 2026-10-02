import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { loadNxcoreLogo, drawLetterhead, drawFooters, drawPreparedBlock, PDF_COLORS } from './nxcoreLetterhead'
import { contactLabel, TRIAL_DAYS } from './subscriptions'
import { ACCOUNT_STATUS, accountStatus } from './subscriptionAccounts'
import { KIND_LABEL } from './subscriptionReport'

/* SUBSCRIPTIONS — STATUS REPORT, the super admin's final account of every
   subscription (lib/subscriptionReport builds the figures; this only draws
   them). Same letterhead as the other reports. Money per currency, never
   combined; unknown amounts said, never counted as zero. */

const { BRAND, INK, MUTED, LINE, SOFT } = PDF_COLORS
const GREEN = [21, 128, 61], AMBER = [180, 83, 9], RED = [185, 28, 28]
const ymd = (ts) => (ts ? String(ts).slice(0, 10) : '')
const fmt = (v, c) => `${(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c || 'USD'}`
// Every currency the kind has, zero included — "0.00 USD paid" is a fact; a dash would read as unknown.
const moneyLines = (bag, key) => {
  const parts = Object.entries(bag || {}).map(([c, m]) => fmt(m[key], c))
  return parts.length ? parts.join('\n') : '—'
}
const STATE_WORD = { free: 'Free', paid: 'Paid', pending: 'Pending', unknown: 'Amount not recorded' }
const stateColor = (t) => (/^(Paid|Settled)/.test(t) ? GREEN : /^Pending/.test(t) ? AMBER : /not recorded/.test(t) ? RED : MUTED)

export async function downloadSubscriptionReportPdf(rep, { generatedBy = '', loginName = () => '' } = {}) {
  const logo = await loadNxcoreLogo()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 12
  const docNo = `SR-${rep.today.replace(/-/g, '')}`
  const K = rep.kinds

  let y = drawLetterhead(doc, { logo, title: 'Subscriptions — status report', subtitle: `Every subscription · ${docNo}`, margin: M })

  // ── left: as of / prepared by; right: what is owed to the super admin ─────
  const topY = y
  drawPreparedBlock(doc, { x: M, y, asOf: rep.today, preparedBy: generatedBy })
  const boxW = 120, boxX = W - M - boxW
  const cur = Object.keys(rep.total)
  const panelH = 10 + Math.max(1, cur.length) * 17
  doc.setFillColor(...SOFT); doc.rect(boxX, topY - 4, boxW, panelH, 'F')
  let py = topY + 1
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('OWED TO THE SUPER ADMIN — ALL SUBSCRIPTIONS', boxX + 4, py)
  py += 6
  if (!cur.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Nothing owed.', boxX + 4, py) }
  for (const c of cur) {
    const t = rep.total[c]
    const col = (x, label, v, color, big = false) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(label, x, py)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(big ? 12 : 10); doc.setTextColor(...color); doc.text(fmt(v, c), x, py + 5.5)
    }
    col(boxX + 4, 'Total', t.owed, BRAND, true)
    col(boxX + 46, 'Paid', t.paid, GREEN)
    col(boxX + 84, 'Pending', t.pending, AMBER)
    if (t.unknown) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...RED); doc.text(`${t.unknown} with no amount recorded`, boxX + 4, py + 10) }
    py += 17
  }
  y = Math.max(topY + 30, topY - 4 + panelH + 6)

  // ── overview: one line per kind ───────────────────────────────────────────
  const kindsShown = ['partner', 'supplier', 'office', 'driver', 'other'].filter(k => k !== 'other' || K.other.count || K.other.historyCount)
  const ov = [
    ['Software — yearly fee', rep.software.lines.length, 0, rep.software.lines.filter(l => l.state === 'paid').length,
     rep.software.lines.filter(l => l.state === 'pending').length, moneyLines(rep.software.money, 'owed'), moneyLines(rep.software.money, 'paid'), moneyLines(rep.software.money, 'pending')],
    ...kindsShown.map(k => [K[k].label, K[k].count, K[k].free, K[k].paid, K[k].pending + (K[k].unknown ? ` (+${K[k].unknown} not recorded)` : ''),
      moneyLines(K[k].money, 'owed'), moneyLines(K[k].money, 'paid'), moneyLines(K[k].money, 'pending')]),
  ]
  autoTable(doc, {
    startY: y, margin: { left: M, right: M, bottom: 18 }, theme: 'plain',
    styles: { fontSize: 8, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, valign: 'middle' },
    headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold' },
    head: [['Kind', 'Subscriptions', 'Free', 'Paid', 'Pending', 'Owed to the super admin', 'Paid', 'Pending']],
    body: ov,
    foot: [['Total', '', '', '', '', moneyLines(rep.total, 'owed'), moneyLines(rep.total, 'paid'), moneyLines(rep.total, 'pending')]],
    columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
                    5: { halign: 'right', fontStyle: 'bold' }, 6: { halign: 'right', textColor: GREEN }, 7: { halign: 'right', textColor: AMBER } },
    didParseCell: (d) => { if (d.section !== 'body' && [1, 2, 3, 4, 5, 6, 7].includes(d.column.index)) d.cell.styles.halign = 'right' },
    didDrawCell: (d) => { if (d.section === 'body') { doc.setDrawColor(...LINE); doc.setLineWidth(0.15); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height) } },
  })
  y = (doc.lastAutoTable?.finalY ?? y) + 6

  // ── the free allowances, in words ─────────────────────────────────────────
  const notes = [
    `Partners: ${K.partner.freeSeatsIncluded ?? '—'} free seats in the package — ${K.partner.freeSeatsHeld} held this year.`,
    `Suppliers: ${K.supplier.inTrial} in their free ${TRIAL_DAYS}-day trial.`,
    ...rep.seatUse.map(s => `${s.label}: ${s.active} active of ${s.included} free — ${s.beyond} beyond, ${s.charged} with a seat charge on record${s.beyond ? ` (${fmt(s.rate, s.currency)} a year each)` : ''}.`),
    `Drivers: ${rep.driverUse.active} active of ${rep.driverUse.included} free — ${rep.driverUse.beyond} beyond, ${rep.driverUse.charged} with a seat charge on record${rep.driverUse.beyond ? ` (${fmt(rep.driverUse.rate, rep.driverUse.currency)} a year each)` : ''}.`,
    `Past periods, ended and paid or free, counted but not listed: ${kindsShown.reduce((n, k) => n + K[k].historyCount, 0)}.`,
  ]
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
  doc.text('Free seats and trials', M, y); y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...INK)
  for (const n of notes) { doc.text(`•  ${n}`, M + 1, y); y += 4.4 }

  // ── the detail, one table per kind ────────────────────────────────────────
  const section = (title, head, body, colStyles = {}, colorCols = []) => {
    if (!body.length) return
    y += 4
    if (y > H - 40) { doc.addPage(); y = M + 8 }
    doc.setFillColor(...BRAND); doc.rect(M, y - 3.6, 1.4, 5.2, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
    doc.text(`${title}  (${body.length})`, M + 3.5, y)
    y += 2.5
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, bottom: 18 }, theme: 'plain',
      styles: { fontSize: 7.6, cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 }, textColor: INK, valign: 'middle' },
      headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: 'bold', fontSize: 6.8 },
      head: [head], body, columnStyles: colStyles,
      didParseCell: (d) => {
        if (d.section === 'body' && colorCols.includes(d.column.index)) d.cell.styles.textColor = stateColor(String(d.cell.raw || ''))
        if (d.section === 'head' && colStyles[d.column.index]?.halign === 'right') d.cell.styles.halign = 'right'
      },
      didDrawCell: (d) => { if (d.section === 'body') { doc.setDrawColor(...LINE); doc.setLineWidth(0.15); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height) } },
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 4
  }
  const period = (r) => `${r.start_date || '?'}\nto ${r.end_date || '?'}`
  // The same words as Subscription Accounts: in force, unpaid, switched off, ended.
  const access = (l) => ACCOUNT_STATUS[accountStatus(l.row, rep.today)]?.label || l.access
  // Money still owed first, then paid, then free — by name within each.
  const RANK = { pending: 0, unknown: 1, paid: 2, free: 3 }
  const ordered = (list) => list.slice().sort((a, b) => (RANK[a.state] - RANK[b.state])
    || contactLabel(a.row.contact).localeCompare(contactLabel(b.row.contact)))
  const settled = (l) => (l.state === 'paid' ? `Paid ${ymd(l.row.vendor_settled_at || l.row.paid_at)}${(l.row.vendor_reference || l.row.payment_reference) ? `\n${l.row.vendor_reference || l.row.payment_reference}` : ''}`
    : STATE_WORD[l.state])
  const who = (l) => contactLabel(l.row.contact) + (loginName(l.row) ? `\n@${loginName(l.row)}` : '')

  section(KIND_LABEL.software, ['Software', 'Period', 'Yearly fee', 'Status'],
    rep.software.lines.map(s => [s.name, `${s.start || '?'}\nto ${s.end || '?'}`, fmt(s.owed, s.owedCurrency),
      s.state === 'paid' ? `Paid to ${s.paidThrough}` : `Pending${s.paidThrough ? ` (paid to ${s.paidThrough})` : ''}`]),
    { 0: { cellWidth: 110 }, 2: { halign: 'right' } }, [3])

  section(KIND_LABEL.partner, ['Partner', 'Period', 'Access', 'Sold at', 'Partner paid the office', 'Owed to the super admin', 'Status'],
    ordered(K.partner.listed).map(l => [who(l), period(l.row), isFree(l) ? 'Free seat' : access(l),
      l.sold == null ? '—' : fmt(l.sold, l.soldCurrency),
      l.sold == null ? '—' : l.partnerPaid ? `Paid ${ymd(l.row.paid_at)}` : 'Pending',
      l.owed == null ? 'not recorded' : fmt(l.owed, l.owedCurrency), settled(l)]),
    { 0: { cellWidth: 62, fontStyle: 'bold' }, 3: { halign: 'right' }, 5: { halign: 'right' } }, [4, 6])

  section(KIND_LABEL.supplier, ['Supplier', 'Period', 'Kind', 'Access', 'Amount', 'Status'],
    ordered(K.supplier.listed).map(l => [who(l), period(l.row), l.trial ? `Free ${TRIAL_DAYS}-day trial` : (l.row.description || 'Plan'), access(l),
      fmt(l.owed, l.owedCurrency), settled(l)]),
    { 0: { cellWidth: 62, fontStyle: 'bold' }, 4: { halign: 'right' } }, [5])

  section(KIND_LABEL.office, ['Login', 'Period', 'Seat', 'Amount', 'Status'],
    ordered(K.office.listed).map(l => [`@${loginName(l.row) || '?'}`, period(l.row), l.row.description || 'Seat', fmt(l.owed, l.owedCurrency), settled(l)]),
    { 3: { halign: 'right' } }, [4])

  section(KIND_LABEL.driver, ['Driver', 'Period', 'Seat', 'Amount', 'Status'],
    ordered(K.driver.listed).map(l => [contactLabel(l.row.contact), period(l.row), l.row.description || 'Seat', fmt(l.owed, l.owedCurrency), settled(l)]),
    { 3: { halign: 'right' } }, [4])

  section(KIND_LABEL.other, ['Contact / login', 'Period', 'Description', 'Amount', 'Status'],
    ordered(K.other.listed).map(l => [l.row.contact ? contactLabel(l.row.contact) : `@${loginName(l.row) || '?'}`, period(l.row), l.row.description || '—',
      fmt(l.owed, l.owedCurrency), settled(l)]),
    { 3: { halign: 'right' } }, [4])

  drawFooters(doc, { reference: `${docNo} · owed to the super admin, per currency, never combined`, margin: M })
  doc.save(`subscriptions-status-${rep.today}.pdf`)
}

const isFree = (l) => l.state === 'free' && l.owed === 0 && l.sold == null
