import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { contactLabel, subscriptionStatus, graceDaysLeft, todayStr } from './subscriptions'

/* DUE PAYMENTS — every partner / supplier subscription with money still owed.

   One row per subscription, not per party: a partner owing two periods owes
   two amounts, and folding them together would hide which period is unpaid.

   The column that matters most is ACCESS. A subscription can be owed and
   closed (nothing activated yet), owed and open for its whole term (activated
   on credit by the super admin), or owed and open on a clock (on trust). The
   first costs nothing while it waits; the other two are service already being
   given without the money, which is what this list exists to chase.

   Totals are per currency and never added across currencies. */

export function accessOf(row, today = todayStr()) {
  const st = subscriptionStatus(row, today)
  if (st === 'credit') {
    return {
      key: 'credit',
      label: 'Activated — payment due',
      detail: [
        row.credit_granted_at ? `since ${String(row.credit_granted_at).slice(0, 10)}` : '',
        row.credit_granted_by ? `by ${row.credit_granted_by}` : '',
      ].filter(Boolean).join(' '),
    }
  }
  if (st === 'grace') {
    const left = graceDaysLeft(row, today)
    return { key: 'grace', label: 'Activated on trust',
      detail: `${left} day${left === 1 ? '' : 's'} left to pay` }
  }
  if (st === 'grace_over') return { key: 'grace_over', label: 'Trust expired — closed', detail: '' }
  if (st === 'expired')    return { key: 'expired', label: 'Expired unpaid', detail: '' }
  if (st === 'scheduled')  return { key: 'scheduled', label: 'Not started yet', detail: '' }
  return { key: 'closed', label: 'Not activated', detail: 'sign-in closed until paid' }
}

/* Days since the period started, which is how long the money has been owed.
   Null for a period that has not started. */
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

export function downloadDuePaymentsPdf(rows, { generatedBy = '', today = todayStr() } = {}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const marginX = 12
  const now = new Date()

  doc.setFontSize(14); doc.setTextColor(20)
  doc.text('Subscriptions — Due Payments', marginX, 16)
  doc.setFontSize(9); doc.setTextColor(110)
  doc.text(`Generated: ${now.toLocaleString()}${generatedBy ? ` by ${generatedBy}` : ''}`, marginX, 22)
  const openCount = rows.filter(r => ['credit', 'grace'].includes(accessOf(r, today).key)).length
  doc.text(`${rows.length} subscription${rows.length === 1 ? '' : 's'} owing — `
    + `${openCount} already activated and in use without payment`, marginX, 27)

  autoTable(doc, {
    startY: 32,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 8, cellPadding: 1.8, valign: 'middle' },
    headStyles: { fillColor: [38, 50, 64], textColor: 255, fontStyle: 'bold' },
    head: [['Party', 'Code', 'Description', 'Period', 'Amount', 'Access', 'Owed for', 'Payment details']],
    body: rows.map(r => {
      const a = accessOf(r, today)
      const d = daysOutstanding(r, today)
      return [
        contactLabel(r.contact) || '—',
        r.contact?.code || '—',
        r.description || '—',
        `${r.start_date || '?'} → ${r.end_date || '?'}`,
        money(r.amount, r.currency),
        a.detail ? `${a.label}\n${a.detail}` : a.label,
        d == null ? '—' : `${d} day${d === 1 ? '' : 's'}`,
        // Left blank on purpose: the column is where the reference is written
        // by hand on the printed copy, until it is recorded in the system.
        '',
      ]
    }),
    columnStyles: {
      4: { halign: 'right' },
      6: { halign: 'right' },
      7: { cellWidth: 44 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 5) return
      const key = accessOf(rows[data.row.index], today).key
      if (key === 'credit' || key === 'grace') data.cell.styles.textColor = [176, 104, 0]
      if (key === 'grace_over' || key === 'expired') data.cell.styles.textColor = [185, 28, 28]
    },
  })

  let y = (doc.lastAutoTable?.finalY ?? 40) + 8
  doc.setFontSize(10); doc.setTextColor(20)
  doc.text('Total owed', marginX, y)
  doc.setFontSize(9)
  Object.entries(totalsByCurrency(rows)).forEach(([cur, amt]) => {
    y += 5
    doc.text(money(amt, cur), marginX + 4, y)
  })

  doc.save(`due-payments-${today}.pdf`)
}
