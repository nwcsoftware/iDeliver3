import { jsPDF } from 'jspdf'
import logoUrl from '../assets/ideliver-logo-login.png'
import {
  SUBSCRIPTION_PLANS, PLAN_CURRENCY, DEFAULT_PLAN, TRIAL_PLAN_DAYS,
  AGREEMENT_VERSION, agreementText, planByKey,
} from './subscriptionAgreement'
import { daysUntilDate, todayStr, contactLabel } from './subscriptions'

/* The subscription agreement as a document.

   The screen version exists to be accepted; this one exists to be kept — by the
   shop, and by the office in a folder that outlives any screen. So it is built
   from the STORED row wherever there is one: the prices, the trial dates and
   the wording as they were on the day it was accepted, not as they stand today.
   A copy printed a year from now must still say what the shop actually agreed
   to. Where no answer has been given yet it prints the current terms with
   signature lines, so it can be read, signed and returned on paper instead. */

const W = 210, H = 297, M = 16          // A4 portrait
const BRAND = [37, 99, 235]
const INK   = [17, 24, 39]
const MUTED = [107, 114, 128]
const LINE  = [209, 213, 219]
const GREEN = [22, 128, 61]
const RED   = [185, 28, 28]
const AMBER = [180, 83, 9]

const ISSUER       = '3asari3'
const ISSUER_PHONE = '+961 81 585 255'

const dmy = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : String(d)
}
const fmtWhen = (ts) => (ts
  ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : '—')

/* Stable, readable reference: AGR-<contact code>-<version>. */
export function agreementRef(contact, version = AGREEMENT_VERSION) {
  const code = String(contact?.code || 'PARTY').toUpperCase()
  return `AGR-${code}-${String(version).toUpperCase()}`
}

let logoPromise = null
function loadLogo() {
  if (!logoPromise) {
    logoPromise = fetch(logoUrl)
      .then(r => r.blob())
      .then(b => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload  = () => resolve(String(fr.result))
        fr.onerror = reject
        fr.readAsDataURL(b)
      }))
      .catch(() => null)              // no logo → the agreement still prints
  }
  return logoPromise
}

const STATUS_LOOK = {
  agreed:   { label: 'ACCEPTED', color: GREEN, fill: [236, 253, 245] },
  rejected: { label: 'DECLINED', color: RED,   fill: [254, 242, 242] },
  pending:  { label: 'AWAITING ACCEPTANCE', color: AMBER, fill: [255, 251, 235] },
}

/* One agreement as a jsPDF document.

   `agreement` is the stored row (may be null — then the current terms print).
   `trialEnd` is only used when the row doesn't carry its own. */
export async function buildAgreementPdf({
  contact = null, agreement = null, trialEnd = null, company = ISSUER,
} = {}) {
  const logo = await loadLogo()
  const doc  = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const inner = W - M * 2

  const status  = agreement?.status || 'pending'
  const look    = STATUS_LOOK[status] || STATUS_LOOK.pending
  const version = agreement?.version || AGREEMENT_VERSION
  const planKey = agreement?.plan || DEFAULT_PLAN
  const plan    = planByKey(planKey)
  const cur     = agreement?.currency || PLAN_CURRENCY
  const days    = Number(agreement?.trial_days) || TRIAL_PLAN_DAYS
  const ends    = agreement?.trial_ends_on || trialEnd || null
  // Prices as accepted, falling back to what is published today.
  const priceOf = (key) => {
    const stored = key === 'basic' ? agreement?.basic_price
      : key === 'pro' ? agreement?.pro_price : agreement?.pro_max_price
    return Number(stored) || planByKey(key).price
  }

  let y = M

  // ── header ──────────────────────────────────────────────────────────────
  if (logo) {
    try {
      const props = doc.getImageProperties(logo)
      const h = 13
      doc.addImage(logo, 'PNG', M, y, (props.width / props.height) * h, h)
    } catch { /* printed without it */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK)
  doc.text('SUBSCRIPTION AGREEMENT', W - M, y + 6, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text(`${agreementRef(contact, version)}  ·  version ${version}`, W - M, y + 11, { align: 'right' })

  y += 17
  doc.setDrawColor(...BRAND); doc.setLineWidth(0.8)
  doc.line(M, y, W - M, y)
  y += 9

  // ── the two parties ─────────────────────────────────────────────────────
  const col = inner / 2
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('SERVICE PROVIDER', M, y)
  doc.text('SUBSCRIBER', M + col, y)
  y += 5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK)
  doc.text(String(company), M, y)
  doc.text(doc.splitTextToSize(contactLabel(contact), col - 6)[0], M + col, y)
  y += 4.8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text(ISSUER_PHONE, M, y)
  doc.text(String(contact?.mobile || '—'), M + col, y)
  y += 10

  // ── where it stands ─────────────────────────────────────────────────────
  doc.setFillColor(...look.fill)
  doc.rect(M, y, inner, 22, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('STATUS', M + 5, y + 6)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...look.color)
  doc.text(look.label, M + 5, y + 15)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  if (agreement?.responded_at) {
    doc.text(`${status === 'agreed' ? 'Accepted' : 'Answered'} ${fmtWhen(agreement.responded_at)}`,
      W - M - 5, y + 9, { align: 'right' })
    doc.text(`by ${agreement.responded_name || '—'}${agreement.device ? ` · ${agreement.device}` : ''}`,
      W - M - 5, y + 14, { align: 'right' })
    doc.setFontSize(7)
    doc.text('Accepted electronically in the partner portal', W - M - 5, y + 18.5, { align: 'right' })
  } else {
    doc.text('Not yet answered', W - M - 5, y + 12, { align: 'right' })
  }
  y += 29

  // ── the fees ────────────────────────────────────────────────────────────
  const heading = (text) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
    doc.text(text, M, y); y += 2.4
    doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.line(M, y, W - M, y); y += 6
  }

  heading('MONTHLY SUBSCRIPTION FEES')
  for (const p of SUBSCRIPTION_PLANS) {
    const mine = p.key === planKey
    if (mine) {
      doc.setFillColor(243, 246, 252)
      doc.rect(M - 1.5, y - 4.2, inner + 3, 8, 'F')
    }
    doc.setFont('helvetica', mine ? 'bold' : 'normal'); doc.setFontSize(9.5)
    doc.setTextColor(...(mine ? BRAND : INK))
    doc.text(p.name, M + 1, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(p.blurb, M + 32, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.setTextColor(...(mine ? BRAND : INK))
    doc.text(`${priceOf(p.key)} ${cur} / month`, W - M - 1, y, { align: 'right' })
    y += 8
  }
  y += 2

  // ── the free period ─────────────────────────────────────────────────────
  heading('FREE INTRODUCTORY PERIOD')
  const left = ends ? daysUntilDate(ends, todayStr()) : null
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK)
  const trialLine = ends
    ? `${days} free days on the ${plan.name} plan, ending ${dmy(ends)}`
      + (left != null ? (left >= 0 ? ` (${left} day${left === 1 ? '' : 's'} remaining)` : ' (ended)') : '')
    : `${days} free days on the ${plan.name} plan`
  doc.text(trialLine, M, y); y += 5.5
  doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(
    `Nothing is charged during the free period. When it ends the ${plan.name} fee of `
    + `${priceOf(planKey)} ${cur} per month becomes payable unless the subscriber asks to change plan.`,
    inner), M, y)
  y += 11

  // ── the terms, as accepted ──────────────────────────────────────────────
  heading('TERMS')
  const stored = agreement?.agreement_text || agreementText({ trialEndsOn: ends, planKey })
  // The first line is the title of the agreement, which the page already says.
  const clauses = String(stored).split('\n').map(s => s.trim()).filter(Boolean).slice(1)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK)
  clauses.forEach((clause, i) => {
    const lines = doc.splitTextToSize(clause, inner - 7)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...MUTED)
    doc.text(`${i + 1}.`, M, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK)
    doc.text(lines, M + 7, y)
    y += lines.length * 4.6 + 2.6
  })

  // What they said when declining belongs on the document, in their words.
  if (status === 'rejected' && agreement?.note) {
    y += 3
    heading('SUBSCRIBER’S NOTE')
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...INK)
    const note = doc.splitTextToSize(`“${agreement.note}”`, inner)
    doc.text(note, M, y)
    y += note.length * 4.6
  }

  // ── acceptance / signature ──────────────────────────────────────────────
  const fy = H - 46
  if (y < fy) y = fy
  doc.setDrawColor(...LINE); doc.setLineWidth(0.25)
  doc.line(M, y, W - M, y); y += 7

  if (status === 'agreed' || status === 'rejected') {
    const accepted = status === 'agreed'
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.setTextColor(...(accepted ? GREEN : RED))
    doc.text(accepted ? 'Accepted by the subscriber' : 'Declined by the subscriber', M, y); y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(
      `${agreement?.responded_name || contactLabel(contact)} · ${fmtWhen(agreement?.responded_at)}`
      + `${agreement?.device ? ` · ${agreement.device}` : ''}`, M, y)
    y += 4.5
    // A declined agreement gets no signature lines: they answered, and the
    // answer was no. Signing a copy of it would say the opposite.
    doc.text(accepted
      ? 'Accepted in the partner portal; no signature is required on this copy.'
      : 'Declined in the partner portal. The subscriber may accept it at any later sign-in.', M, y)
  } else {
    // Not accepted on screen → the paper route stays open.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text('Subscriber’s name', M, y)
    doc.text('Signature', M + inner * 0.42, y)
    doc.text('Date', W - M - 28, y)
    y += 11
    doc.setDrawColor(...LINE)
    doc.line(M, y, M + inner * 0.36, y)
    doc.line(M + inner * 0.42, y, M + inner * 0.78, y)
    doc.line(W - M - 28, y, W - M, y)
  }

  // ── footer ──────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text(`${ISSUER} · ${ISSUER_PHONE}`, M, H - 12)
  doc.text(`${agreementRef(contact, version)} · printed ${fmtWhen(new Date().toISOString())}`,
    W - M, H - 12, { align: 'right' })
  return doc
}

const fileName = (contact, agreement) =>
  `${agreementRef(contact, agreement?.version)}.pdf`

export async function downloadAgreementPdf(opts) {
  const doc = await buildAgreementPdf(opts)
  doc.save(fileName(opts?.contact, opts?.agreement))
}

/* Open it in a new tab instead of saving — "view" rather than "download". */
export async function openAgreementPdf(opts) {
  const doc = await buildAgreementPdf(opts)
  window.open(doc.output('bloburl'), '_blank', 'noopener')
}
