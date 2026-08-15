import { jsPDF } from 'jspdf'
import logoUrl from '../assets/nxcore-logo.png'
import {
  fmtMoney, paymentSummary, daysUntil, todayStr, cycleLabel,
} from './softwareSubscriptions'

/* Payment receipt for a software subscription (fix118).

   The receipt is BUILT FROM THE PAYMENT ROW each time it is asked for, rather
   than stored: the numbers can never drift from the record, and a receipt
   downloaded by an admin months later still reads correctly. The receipt
   number is derived from the payment so it stays the same on every download.

   The super admin issues it when recording the money; admins open or download
   the same document from the payments list. */

/* A receipt is always issued by _NXCORE — never by whoever happened to be
   signed in — so the issuer and its contact number are fixed here. */
const ISSUER       = '_NXCORE'
const ISSUER_PHONE = '+961 70 334 868'

const W = 148, H = 210, M = 12          // A5 portrait — a receipt, not a report
const BRAND = [37, 99, 235]
const INK   = [17, 24, 39]
const MUTED = [107, 114, 128]
const LINE  = [209, 213, 219]
const GREEN = [22, 128, 61]

/* Stable, human-readable number: RCP-<paid on>-<first 4 of the payment id>. */
export function receiptNo(payment) {
  const day = String(payment?.paid_on || todayStr()).replace(/-/g, '')
  const tail = String(payment?.id || '').replace(/-/g, '').slice(0, 4).toUpperCase() || '0001'
  return `RCP-${day}-${tail}`
}

let logoPromise = null
function loadLogo() {
  if (!logoPromise) {
    logoPromise = fetch(logoUrl)
      .then(r => r.blob())
      .then(b => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = reject
        fr.readAsDataURL(b)
      }))
      .catch(() => null)          // no logo → the receipt still prints
  }
  return logoPromise
}

const fmtWhen = (ts) => (ts
  ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : '—')

/* The receipt as a jsPDF document. `issuedBy` is the user issuing it. */
export async function buildReceipt(subscription, payment, { issuedBy = '', company = 'iDeliver III — Operations' } = {}) {
  const logo = await loadLogo()
  const doc  = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait' })
  const inner = W - M * 2
  let y = M

  // ── header
  if (logo) {
    try {
      const props = doc.getImageProperties(logo)
      const h = 9
      doc.addImage(logo, 'PNG', M, y, (props.width / props.height) * h, h)
    } catch { /* printed without it */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK)
  doc.text('RECEIPT', W - M, y + 5, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text(receiptNo(payment), W - M, y + 9.5, { align: 'right' })

  y += 14
  doc.setDrawColor(...BRAND); doc.setLineWidth(0.7)
  doc.line(M, y, W - M, y)
  y += 7

  // ── who / when
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('RECEIVED FROM', M, y)
  doc.text('PAID ON', W - M, y, { align: 'right' })
  y += 4.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
  doc.text(String(company), M, y)
  doc.text(String(payment?.paid_on || '—'), W - M, y, { align: 'right' })
  y += 9

  // ── the money, in a box: this is what the reader came for
  doc.setFillColor(243, 246, 252)
  doc.rect(M, y, inner, 20, 'F')
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('AMOUNT RECEIVED', M + 4, y + 6)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...BRAND)
  doc.text(fmtMoney(payment?.amount, payment?.currency), M + 4, y + 14.5)
  // Confirmed money is money in; a pending line says so in the open.
  const confirmed = !!payment?.is_confirmed
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.setTextColor(...(confirmed ? GREEN : [180, 83, 9]))
  doc.text(confirmed ? 'CONFIRMED' : 'PENDING CONFIRMATION', W - M - 4, y + 14.5, { align: 'right' })
  y += 26

  // ── what it was for
  const row = (label, value, opts = {}) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(label, M, y)
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(8.5)
    doc.setTextColor(...(opts.color || INK))
    const text = doc.splitTextToSize(String(value ?? '—'), inner - 42)
    doc.text(text[0], W - M, y, { align: 'right' })
    y += opts.gap ?? 5.4
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK)
  doc.text('PAYMENT DETAILS', M, y); y += 2
  doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.line(M, y, W - M, y); y += 5

  row('Subscription',   subscription?.software_name, { bold: true })
  if (subscription?.vendor)   row('Vendor',   subscription.vendor)
  row('Billing cycle',  cycleLabel(subscription?.billing_cycle))
  row('Method',         payment?.method || '—')
  row('Reference',      payment?.reference || '—')
  if (payment?.notes)   row('Notes', payment.notes)
  y += 3

  // ── what it buys: the validity the admin actually needs to see
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK)
  doc.text('SUBSCRIPTION VALIDITY', M, y); y += 2
  doc.setDrawColor(...LINE); doc.line(M, y, W - M, y); y += 5

  const today   = todayStr()
  const left    = daysUntil(subscription?.expiry_date, today)
  const expired = left != null && left < 0
  const validity = subscription?.expiry_date
    ? (expired
        ? `${subscription.expiry_date} — expired ${Math.abs(left)} day${Math.abs(left) === 1 ? '' : 's'} ago`
        : `${subscription.expiry_date} — ${left} day${left === 1 ? '' : 's'} left`)
    : '—'

  row('Period starts',  subscription?.start_date || '—')
  row('Expires on',     validity, { bold: true, color: expired ? [185, 28, 28] : INK })
  // A payment reaching past the expiry date is the renewal that stops the
  // expiry reminders — worth stating plainly on the receipt.
  row('This payment covers until', payment?.covers_until || '—',
    { bold: !!payment?.covers_until, color: payment?.covers_until ? GREEN : INK })
  if (payment?.covers_until && subscription?.expiry_date && payment.covers_until > subscription.expiry_date) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREEN)
    doc.text('Counts as a renewal — expiry reminders stop once confirmed.', M, y)
    y += 5
  }
  y += 3

  // ── the account position, so the receipt stands alone
  const sum = paymentSummary(subscription)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK)
  doc.text('ACCOUNT AFTER THIS PAYMENT', M, y); y += 2
  doc.setDrawColor(...LINE); doc.line(M, y, W - M, y); y += 5

  row('Subscription value', fmtMoney(subscription?.amount, subscription?.currency))
  row('Confirmed paid',     fmtMoney(sum.paid, subscription?.currency), { color: GREEN })
  row('Outstanding',        fmtMoney(sum.due, subscription?.currency), { bold: true, color: sum.due > 0 ? [180, 83, 9] : GREEN })

  // ── footer
  const fy = H - 26
  doc.setDrawColor(...LINE); doc.setLineWidth(0.25)
  doc.line(M, fy, W - M, fy)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK)
  doc.text(`Issued by ${ISSUER} · ${ISSUER_PHONE}`, M, fy + 5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  // Who keyed the payment in stays on the receipt as an audit line, below the
  // issuer — it never replaces it.
  doc.text(`Recorded by ${issuedBy || '—'} · ${fmtWhen(new Date().toISOString())}`, M, fy + 9.5)
  doc.text(
    confirmed
      ? 'This receipt confirms the payment recorded above.'
      : 'This payment is recorded but not yet confirmed.',
    M, fy + 14)
  return doc
}

export async function downloadReceipt(subscription, payment, opts) {
  const doc = await buildReceipt(subscription, payment, opts)
  doc.save(`${receiptNo(payment)}.pdf`)
}

/* Open it in a new tab instead of saving — "view" rather than "download". */
export async function openReceipt(subscription, payment, opts) {
  const doc = await buildReceipt(subscription, payment, opts)
  const url = doc.output('bloburl')
  window.open(url, '_blank', 'noopener')
}
