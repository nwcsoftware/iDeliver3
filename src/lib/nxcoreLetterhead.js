import logoUrl from '../assets/nxcore-logo.png'

/* The _NXCORE letterhead, shared by every report the super admin prints.

   Taken from the subscription receipt (subscriptionReceipt.js): logo left, the
   document's name and number right, a brand rule beneath, and "Issued by
   _NXCORE" in the footer of every page. One definition, so two reports cannot
   drift into two letterheads — which is how a house's papers stop looking like
   they come from the same house. */

export const ISSUER       = '_NXCORE'
export const ISSUER_PHONE = '+961 70 334 868'

export const PDF_COLORS = {
  BRAND: [37, 99, 235],
  INK:   [17, 24, 39],
  MUTED: [107, 114, 128],
  LINE:  [209, 213, 219],
  SOFT:  [243, 246, 252],
  GREEN: [22, 128, 61],
  AMBER: [180, 83, 9],
  RED:   [185, 28, 28],
  FUCHSIA: [162, 28, 175],
}

let logoPromise = null
export function loadNxcoreLogo() {
  if (!logoPromise) {
    logoPromise = fetch(logoUrl)
      .then(r => r.blob())
      .then(b => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = reject
        fr.readAsDataURL(b)
      }))
      .catch(() => null)          // no logo → the document still prints
  }
  return logoPromise
}

/* Draws the header and returns the y where the body can start. */
export function drawLetterhead(doc, { logo, title, subtitle, margin = 12 }) {
  const { BRAND, INK, MUTED } = PDF_COLORS
  const W = doc.internal.pageSize.getWidth()
  const M = margin
  let y = M
  if (logo) {
    try {
      const p = doc.getImageProperties(logo)
      const h = 11
      doc.addImage(logo, 'PNG', M, y, (p.width / p.height) * h, h)
    } catch { /* printed without it */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...INK)
  doc.text(String(title || '').toUpperCase(), W - M, y + 5.5, { align: 'right' })
  if (subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
    doc.text(String(subtitle), W - M, y + 10.5, { align: 'right' })
  }
  y += 15
  doc.setDrawColor(...BRAND); doc.setLineWidth(0.7)
  doc.line(M, y, W - M, y)
  return y + 7
}

/* Footer on every page: issuer, a reference line, page n of N. Call last. */
export function drawFooters(doc, { reference = '', margin = 12 } = {}) {
  const { INK, MUTED, LINE } = PDF_COLORS
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = margin
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    const fy = H - 12
    doc.setDrawColor(...LINE); doc.setLineWidth(0.25)
    doc.line(M, fy - 4, W - M, fy - 4)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK)
    doc.text(`Issued by ${ISSUER} · ${ISSUER_PHONE}`, M, fy)
    if (reference) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
      doc.text(String(reference), M, fy + 4)
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
    doc.text(`Page ${i} of ${pages}`, W - M, fy, { align: 'right' })
  }
}

/* "As of" and "Prepared by" at the top left, as both reports open. Returns y. */
export function drawPreparedBlock(doc, { x = 12, y, asOf, preparedBy }) {
  const { INK, MUTED } = PDF_COLORS
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('AS OF', x, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
  doc.text(new Date(`${asOf}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'long' }), x, y + 5)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('PREPARED BY', x, y + 13)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK)
  doc.text(`${preparedBy || '—'} · ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
    x, y + 18)
  return y + 26
}
