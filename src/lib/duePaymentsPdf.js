import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { loadNxcoreLogo, drawLetterhead, drawFooters, drawPreparedBlock, PDF_COLORS } from './nxcoreLetterhead'
import { contactLabel, subscriptionStatus, graceDaysLeft, todayStr } from './subscriptions'

/* DUE PAYMENTS — every partner / supplier subscription with money still owed.

   Laid out like the _NXCORE receipt (subscriptionReceipt.js): logo left, the
   document's name and number right, a brand rule under it, and the issuer in
   the footer. Same issuer, same look, so the two read as one house's papers.

   The rows are GROUPED BY WHAT THE MONEY IS HOLDING BACK, because that is the
   question the paper is printed to answer:

     Activated — full term     open until the end date, money still pending
     Activated — limited days  open on trust, closes by itself on a date
     Access closed             trust ran out, or the period ended unpaid
     Not activated             nothing given yet; sign-in waits on payment

   The first two are service already being given without the money. Each group
   carries its own subtotal, and the totals sit on the right of the page.
   Money is per currency and never added across currencies. */

const { BRAND, INK, MUTED, LINE, SOFT } = PDF_COLORS

export const DUE_GROUPS = [
  { key: 'credit',  label: 'Activated — full term, payment pending', short: 'Full term, pending',
    note: 'Open until the end date. Payment still to be recorded.', color: [180, 83, 9] },
  { key: 'grace',   label: 'Activated — limited days (on trust)', short: 'Limited days, on trust',
    note: 'Open on trust. Access closes by itself on the date shown.', color: [202, 138, 4] },
  { key: 'lapsed',  label: 'Access closed — unpaid', short: 'Access closed',
    note: 'Trust period over, or the subscription ran out unpaid.', color: [185, 28, 28] },
  { key: 'closed',  label: 'Not activated — awaiting payment', short: 'Not activated',
    note: 'Nothing given yet. Sign-in opens once payment is confirmed.', color: [75, 85, 99] },
]

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/* Access, as the report groups and words it. */
export function accessOf(row, today = todayStr()) {
  const st = subscriptionStatus(row, today)
  if (st === 'credit') {
    return {
      key: 'credit', group: 'credit',
      label: 'Activated — payment due',
      detail: [
        row.credit_granted_at ? `on ${String(row.credit_granted_at).slice(0, 10)}` : '',
        row.credit_granted_by ? `by ${row.credit_granted_by}` : '',
        row.end_date ? `· open to ${row.end_date}` : '',
      ].filter(Boolean).join(' '),
    }
  }
  if (st === 'grace') {
    const left = graceDaysLeft(row, today)
    return {
      key: 'grace', group: 'grace',
      label: 'Activated on trust',
      detail: `${left} day${left === 1 ? '' : 's'} left · closes ${addDays(today, left)}`
        + (row.grace_granted_by ? ` · by ${row.grace_granted_by}` : ''),
    }
  }
  if (st === 'grace_over') return { key: 'grace_over', group: 'lapsed', label: 'Trust expired', detail: 'access closed' }
  if (st === 'expired')    return { key: 'expired', group: 'lapsed', label: 'Expired unpaid', detail: `ended ${row.end_date || ''}`.trim() }
  if (st === 'scheduled')  return { key: 'scheduled', group: 'closed', label: 'Not started', detail: `starts ${row.start_date || ''}`.trim() }
  return { key: 'closed', group: 'closed', label: 'Not activated', detail: 'sign-in closed' }
}

/* Days since the period started — how long the money has been owed. */
export function daysOutstanding(row, today = todayStr()) {
  if (!row?.start_date || row.start_date > today) return null
  return Math.round((new Date(today) - new Date(row.start_date)) / 86400000)
}

export function totalsByCurrency(rows) {
  const t = {}
  for (const r of rows) {
    const c = String(r.currency || 'USD').toUpperCase()
    t[c] = (t[c] || 0) + (Number(r.amount) || 0)
  }
  return t
}

const money = (n, cur) =>
  `${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || ''}`.trim()
const moneyLines = (t) => Object.entries(t).map(([c, a]) => money(a, c))

export async function downloadDuePaymentsPdf(rows, { generatedBy = '', today = todayStr() } = {}) {
  const logo = await loadNxcoreLogo()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 12
  const docNo = `DP-${today.replace(/-/g, '')}`

  const grouped = DUE_GROUPS.map(g => ({
    ...g,
    rows: rows.filter(r => accessOf(r, today).group === g.key),
  }))

  // ── the _NXCORE letterhead, shared with every report ───────────────────
  let y = drawLetterhead(doc, { logo, title: 'Due payments', subtitle: `Partner & supplier subscriptions · ${docNo}`, margin: M })

  // ── left: as of / prepared by ─────────────────────────────────────────────
  const boxW = 104                        // the totals panel on the right
  const boxX = W - M - boxW
  const topY = y
  drawPreparedBlock(doc, { x: M, y, asOf: today, preparedBy: generatedBy })
  const openCount = grouped[0].rows.length + grouped[1].rows.length
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(
    `${rows.length} subscription${rows.length === 1 ? '' : 's'} owing. ${openCount} ${openCount === 1 ? 'is' : 'are'} `
    + 'already activated and in use without payment.', boxX - M - 10), M, y + 26)

  // ── right: the totals panel ───────────────────────────────────────────────
  const lineH = 5.2
  const panelRows = grouped.filter(g => g.rows.length)
  const grand = totalsByCurrency(rows)
  const panelH = 8 + panelRows.length * lineH + 4 + Object.keys(grand).length * 6.5 - 1
  doc.setFillColor(...SOFT)
  doc.rect(boxX, topY - 4, boxW, panelH, 'F')
  let py = topY + 1
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('SUMMARY', boxX + 4, py)
  doc.text('AMOUNT DUE', boxX + boxW - 4, py, { align: 'right' })
  py += 5
  panelRows.forEach(g => {
    doc.setFillColor(...g.color); doc.circle(boxX + 5.2, py - 1.1, 1, 'F')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...INK)
    doc.text(`${g.short} (${g.rows.length})`, boxX + 8, py)
    doc.setFont('helvetica', 'bold')
    doc.text(moneyLines(totalsByCurrency(g.rows)).join('  ·  '), boxX + boxW - 4, py, { align: 'right' })
    py += lineH
  })
  py += 1
  doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.line(boxX + 4, py - 2, boxX + boxW - 4, py - 2)
  py += 3
  Object.entries(grand).forEach(([c, a]) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(`TOTAL DUE${Object.keys(grand).length > 1 ? ` (${c})` : ''}`, boxX + 4, py)
    doc.setFontSize(13); doc.setTextColor(...BRAND)
    doc.text(money(a, c), boxX + boxW - 4, py + 0.5, { align: 'right' })
    py += 6.5
  })

  y = Math.max(topY + 34, topY - 4 + panelH + 6)

  // ── one table per group ───────────────────────────────────────────────────
  // The party label already carries its code, so there is no Code column.
  const head = [['Party', 'Description', 'Period', 'Access', 'Owed for', 'Amount', 'Payment ref.']]
  for (const g of grouped) {
    if (!g.rows.length) continue
    if (y > H - 40) { doc.addPage(); y = M + 6 }

    // group heading
    doc.setFillColor(...g.color); doc.rect(M, y - 3.6, 1.4, 5.2, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
    doc.text(`${g.label}  (${g.rows.length})`, M + 3.5, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    doc.text(g.note, W - M, y, { align: 'right' })
    y += 2.5

    const sub = totalsByCurrency(g.rows)
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 20 },
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, valign: 'middle' },
      headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold' },
      head,
      body: g.rows.map(r => {
        const a = accessOf(r, today)
        const d = daysOutstanding(r, today)
        return [
          contactLabel(r.contact) || '—',
          r.description || '—',
          // No arrow: the standard PDF fonts have no → and print it as "!'".
          `${r.start_date || '?'}
to ${r.end_date || '?'}`,
          a.detail ? `${a.label}\n${a.detail}` : a.label,
          d == null ? '—' : `${d} day${d === 1 ? '' : 's'}`,
          money(r.amount, r.currency),
          '',                         // written in by hand on the printed copy
        ]
      }),
      foot: [[
        { content: `Subtotal — ${g.short.toLowerCase()}`,
          colSpan: 5, styles: { halign: 'right', textColor: MUTED, fontStyle: 'normal', fontSize: 7.5 } },
        { content: moneyLines(sub).join('\n'), styles: { halign: 'right', textColor: g.color } },
        '',
      ]],
      columnStyles: {
        0: { cellWidth: 52, fontStyle: 'bold' },
        2: { cellWidth: 26 },
        3: { cellWidth: 70 },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: 32 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) data.cell.styles.textColor = g.color
      },
      didDrawCell: (data) => {
        // a line to write the reference on, and hairlines between rows
        if (data.section === 'body') {
          doc.setDrawColor(...LINE); doc.setLineWidth(0.15)
          doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height)
        }
      },
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 9
  }

  drawFooters(doc, { reference: `${docNo} · amounts per currency, never combined`, margin: M })

  doc.save(`due-payments-${today}.pdf`)
}
