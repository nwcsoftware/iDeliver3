import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { loadNxcoreLogo, drawLetterhead, drawFooters, drawPreparedBlock, PDF_COLORS } from './nxcoreLetterhead'

/* USER ACCOUNTS — the logins on the page, as the page is filtered.

   The export is exactly what the super admin is looking at: the same search,
   the same role / status / online chips, the same sort. The filters are
   printed at the top, because a list of "all partners that are inactive" read
   later without that line looks like a list of everybody.

   Each row carries its ACCOUNT STATUS in two parts, the way the page does:
   whether the login is switched on (Active / Inactive / Suspended), and what
   its seat is doing — included, free trial, paid, payment due, or none, in
   which case sign-in is refused whatever the status says. */

const { INK, MUTED, LINE, SOFT, GREEN, AMBER, RED, FUCHSIA } = PDF_COLORS

const STATUS_COLOR = { active: GREEN, inactive: MUTED, suspended: RED }
const SEAT_COLOR   = { included: MUTED, trial: AMBER, paid: GREEN, due: FUCHSIA, none: RED }

const when = (ts) => (ts
  ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : 'Never')

/* rows: [{ username, contact, role, mobile, email, status, online, seat: { key, label, until },
           lastLogin, device }]
   filters: human-readable strings, one per active filter. */
export async function downloadUserAccountsPdf(rows, { filters = [], preparedBy = '', today = new Date().toISOString().slice(0, 10), showDevice = true } = {}) {
  const logo = await loadNxcoreLogo()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 12
  const docNo = `UA-${today.replace(/-/g, '')}`

  let y = drawLetterhead(doc, { logo, title: 'User accounts', subtitle: `Account status · ${docNo}`, margin: M })

  // ── left: as of, prepared by, and the filters this list is cut by ──────────
  const boxW = 104
  const boxX = W - M - boxW
  const topY = y
  const afterPrepared = drawPreparedBlock(doc, { x: M, y, asOf: today, preparedBy })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('FILTERS', M, afterPrepared - 1)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK)
  const filterText = filters.length ? filters.join('  ·  ') : 'None — every account shown'
  const fLines = doc.splitTextToSize(filterText, boxX - M - 8)
  doc.text(fLines, M, afterPrepared + 4)

  // ── right: the counts panel ────────────────────────────────────────────────
  const count = (fn) => rows.filter(fn).length
  const panel = [
    ['Active',             count(r => r.status === 'active'),   GREEN],
    ['Inactive',           count(r => r.status === 'inactive'), MUTED],
    ['Suspended',          count(r => r.status === 'suspended'), RED],
    ['Online now',         count(r => r.online),                 GREEN],
    ['Seat — payment due', count(r => r.seat?.key === 'due'),   FUCHSIA],
    ['Seat — none (refused)', count(r => r.seat?.key === 'none'), RED],
  ].filter(([label, n]) => n > 0 || ['Active', 'Inactive'].includes(label))
  const lineH = 5.2
  const panelH = 8 + panel.length * lineH + 11
  doc.setFillColor(...SOFT)
  doc.rect(boxX, topY - 4, boxW, panelH, 'F')
  let py = topY + 1
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('SUMMARY', boxX + 4, py)
  doc.text('ACCOUNTS', boxX + boxW - 4, py, { align: 'right' })
  py += 5
  panel.forEach(([label, n, color]) => {
    doc.setFillColor(...color); doc.circle(boxX + 5.2, py - 1.1, 1, 'F')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...INK)
    doc.text(label, boxX + 8, py)
    doc.setFont('helvetica', 'bold')
    doc.text(String(n), boxX + boxW - 4, py, { align: 'right' })
    py += lineH
  })
  doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.line(boxX + 4, py - 2, boxX + boxW - 4, py - 2)
  py += 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('TOTAL LISTED', boxX + 4, py)
  doc.setFontSize(13); doc.setTextColor(...PDF_COLORS.BRAND)
  doc.text(String(rows.length), boxX + boxW - 4, py + 0.5, { align: 'right' })

  y = Math.max(afterPrepared + 6 + fLines.length * 4, topY - 4 + panelH + 6)

  // ── the list ───────────────────────────────────────────────────────────────
  // Mobile and email share a cell; the widest column goes to what the account
  // IS — its subscription, or its level and seat.
  const head = [['Username', 'Linked to', 'Role', 'Contact', 'Status', 'Subscription / level',
                 'Last login', ...(showDevice ? ['Device'] : [])]]
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 20 },
    theme: 'plain',
    rowPageBreak: 'avoid',        // an account is never split across two pages
    styles: { fontSize: 7.8, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, textColor: INK, valign: 'middle' },
    headStyles: { fillColor: SOFT, textColor: MUTED, fontStyle: 'bold', fontSize: 7 },
    head,
    body: rows.map(r => [
      r.username || '—',
      r.contact || '—',
      r.role || '—',
      [r.mobile, r.email].filter(Boolean).join('\n') || '—',
      `${r.status ? r.status[0].toUpperCase() + r.status.slice(1) : '—'}${r.online ? '\nonline now' : ''}`,
      `${r.level || '—'}${r.levelDetail ? `\n${r.levelDetail}` : ''}`,
      when(r.lastLogin),
      ...(showDevice ? [r.device || '—'] : []),
    ]),
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 34 },
      1: { cellWidth: 40 },
      2: { cellWidth: 24 },
      3: { cellWidth: 30 },
      4: { cellWidth: 17 },
      6: { cellWidth: 30 },
      7: { cellWidth: 27 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const r = rows[data.row.index]
      if (data.column.index === 4) {
        data.cell.styles.textColor = STATUS_COLOR[r.status] || INK
        data.cell.styles.fontStyle = 'bold'
      }
      // The level in the seat's colour: money owed reads fuchsia, refused red.
      if (data.column.index === 5 && r.seat) data.cell.styles.textColor = SEAT_COLOR[r.seat.key] || INK
      if (data.column.index === 6 && !r.lastLogin) data.cell.styles.textColor = MUTED
    },
    didDrawCell: (data) => {
      if (data.section === 'body') {
        doc.setDrawColor(...LINE); doc.setLineWidth(0.15)
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height)
      }
    },
  })

  drawFooters(doc, { reference: `${docNo} · ${rows.length} account${rows.length === 1 ? '' : 's'}`
    + `${filters.length ? ' · filtered' : ''}`, margin: M })

  doc.save(`user-accounts-${today}.pdf`)
}
