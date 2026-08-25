import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import logoUrl from '../assets/Logo.png'
import { fmtAmount } from './orderAmounts'
import { MONEY_SERIES, COUNT_SERIES, compact, niceTicks } from './performanceReport'

/* The Performance report as a document you can hand to someone.

   The charts are DRAWN, not screenshotted: the same numbers re-plotted as vector
   graphics on white paper. Capturing the dark UI would put a black rectangle in
   the middle of a printed page and turn crisp text into a blurry raster at any
   zoom. Drawing them costs a page of geometry and gives a file that prints, is
   selectable, and stays sharp.

   Category colours come from MONEY_SERIES.print — the same hues as the screen,
   re-stepped for white — so the reader who saw it on screen recognises it. */

const W = 297, H = 210, M = 12          // A4 landscape: a wide report, wide paper
const BRAND  = [37, 99, 235]
const BRAND_D= [30, 64, 175]
const INK    = [17, 24, 39]
const BODY   = [55, 65, 81]
const MUTED  = [107, 114, 128]
const FAINT  = [156, 163, 175]
const LINE   = [226, 232, 240]
const CARD   = [248, 250, 252]
const GREEN  = [22, 128, 61]
const WHITE  = [255, 255, 255]

/* A missing or malformed colour must cost the reader one grey bar, not the whole
   document: jsPDF throws on a NaN channel, which would take the export down. */
const hex = (h) => {
  const s = String(h ?? '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(s)) return [148, 163, 184]
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/* The logo is optional furniture — a missing file must never cost the report. */
let logoPromise = null
function loadLogo() {
  if (!logoPromise) {
    logoPromise = fetch(logoUrl)
      .then(r => r.blob())
      .then(b => new Promise((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result))
        fr.onerror = rej
        fr.readAsDataURL(b)
      }))
      .catch(() => null)
  }
  return logoPromise
}

const setFill   = (doc, c) => doc.setFillColor(c[0], c[1], c[2])
const setText   = (doc, c) => doc.setTextColor(c[0], c[1], c[2])
const setStroke = (doc, c) => doc.setDrawColor(c[0], c[1], c[2])

/* Trim a string to fit a width, with an ellipsis — a label that overruns its box
   is worse than one that admits it was too long. */
function fit(doc, text, maxW) {
  let s = String(text ?? '')
  if (doc.getTextWidth(s) <= maxW) return s
  while (s.length > 1 && doc.getTextWidth(s + '…') > maxW) s = s.slice(0, -1)
  return s + '…'
}

/* ── chart primitives ─────────────────────────────────────────────────────── */

/* Title + subtitle above a plot, returning the y the plot may start at. */
function chartHeading(doc, x, y, title, note) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(doc, INK)
  doc.text(title, x, y)
  if (note) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); setText(doc, MUTED)
    doc.text(note, x, y + 3.6)
    return y + 7
  }
  return y + 4
}

/* Horizontal gridlines + y labels. Returns the plot geometry the marks use. */
function drawYAxis(doc, { x, y, w, h, max, format }) {
  const ticks = niceTicks(max, 4)
  const top   = ticks[ticks.length - 1] || 1
  const labelW = 15
  const plot = { x: x + labelW, y, w: w - labelW, h }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6)
  for (const t of ticks) {
    const ty = y + h - (t / top) * h
    setStroke(doc, LINE); doc.setLineWidth(0.15)
    doc.line(plot.x, ty, plot.x + plot.w, ty)
    setText(doc, FAINT)
    doc.text(format(t), plot.x - 1.6, ty + 0.9, { align: 'right' })
  }
  return { ...plot, top }
}

/* Category labels along the bottom, thinned so they never collide. */
function drawXLabels(doc, plot, rows, band) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); setText(doc, FAINT)
  const widest = rows.reduce((m, r) => Math.max(m, doc.getTextWidth(r.label)), 0)
  const every  = Math.max(1, Math.ceil((widest + 2.5) / band))
  rows.forEach((r, i) => {
    if (i % every !== 0 && i !== rows.length - 1) return
    doc.text(r.label, plot.x + band * i + band / 2, plot.y + plot.h + 3.4, { align: 'center' })
  })
}

/* A legend row under a plot: swatch + name, wrapping across the width. */
function drawLegend(doc, x, y, w, items) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4)
  const gap = 4
  const widths = items.map(it => 3 + 1.4 + doc.getTextWidth(it.label) + gap)
  const total  = widths.reduce((a, b) => a + b, 0) - gap
  let cx = x + Math.max(0, (w - total) / 2)
  items.forEach((it, i) => {
    setFill(doc, hex(it.print || it.color))
    doc.roundedRect(cx, y - 2, 3, 3, 0.6, 0.6, 'F')
    setText(doc, BODY)
    doc.text(it.label, cx + 4.4, y + 0.4)
    cx += widths[i]
  })
}

/* Stacked columns: one column per bucket, one segment per money category.
   Segments are separated by a hairline of paper rather than a drawn border —
   a stroke around every rect reads as a cage. */
function drawStackedBars(doc, { x, y, w, h, rows, series, currency }) {
  const max = rows.reduce((m, r) => Math.max(m, series.reduce((s, k) => s + (Number(r[k.key]) || 0), 0)), 0)
  const plot = drawYAxis(doc, { x, y, w, h, max, format: compact })
  const band = plot.w / Math.max(rows.length, 1)
  const barW = Math.min(band * 0.62, 9)
  const GAP  = 0.3

  rows.forEach((r, i) => {
    const cx = plot.x + band * i + (band - barW) / 2
    let bottom = plot.y + plot.h
    for (const s of series) {
      const v = Number(r[s.key]) || 0
      if (v <= 0) continue
      const segH = (v / plot.top) * plot.h
      const drawH = Math.max(segH - GAP, 0.25)
      setFill(doc, hex(s.print))
      doc.rect(cx, bottom - segH, barW, drawH, 'F')
      bottom -= segH
    }
  })

  // Baseline last, so it sits on top of the columns rather than under them.
  setStroke(doc, LINE); doc.setLineWidth(0.25)
  doc.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h)
  drawXLabels(doc, plot, rows, band)
  drawLegend(doc, x, y + h + 7.5, w, series)
}

/* Two count series as lines. Counts and money never share an axis, so this is
   its own plot rather than a second scale on the one above. */
function drawLines(doc, { x, y, w, h, rows, series, labels }) {
  const max = rows.reduce((m, r) => Math.max(m, ...series.map(s => Number(r[s.key]) || 0)), 0)
  const plot = drawYAxis(doc, { x, y, w, h, max, format: v => String(Math.round(v)) })
  const band = plot.w / Math.max(rows.length, 1)
  const px = i => plot.x + band * i + band / 2
  const py = v => plot.y + plot.h - ((Number(v) || 0) / plot.top) * plot.h

  for (const s of series) {
    setStroke(doc, hex(s.print)); doc.setLineWidth(0.6)
    doc.setLineJoin('round'); doc.setLineCap('round')
    for (let i = 1; i < rows.length; i++) {
      doc.line(px(i - 1), py(rows[i - 1][s.key]), px(i), py(rows[i][s.key]))
    }
    // Markers only when they can breathe; past that the line carries it.
    if (rows.length <= 20) {
      setFill(doc, hex(s.print))
      rows.forEach((r, i) => doc.circle(px(i), py(r[s.key]), 0.55, 'F'))
    } else if (rows.length === 1) {
      setFill(doc, hex(s.print))
      doc.circle(px(0), py(rows[0][s.key]), 0.8, 'F')
    }
  }

  setStroke(doc, LINE); doc.setLineWidth(0.25)
  doc.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h)
  drawXLabels(doc, plot, rows, band)
  drawLegend(doc, x, y + h + 7.5, w, series.map(s => ({ ...s, label: labels[s.key] || s.label })))
}

/* Category totals as horizontal bars, each labelled with its own figure — the
   relief that lets the lighter print hues be read without relying on colour. */
function drawMix(doc, { x, y, w, h, mix, currency }) {
  if (!mix.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); setText(doc, FAINT)
    doc.text('No revenue in this window.', x, y + 6)
    return
  }
  const labelW = 34
  const valueW = 24
  const barsW  = Math.max(w - labelW - valueW, 20)
  const max    = Math.max(...mix.map(d => Math.abs(d.value)), 1)
  const rowH   = Math.min(h / mix.length, 9)
  const barH   = Math.min(rowH * 0.55, 4)

  doc.setFontSize(6.6)
  mix.forEach((d, i) => {
    const cy = y + rowH * i + rowH / 2
    doc.setFont('helvetica', 'normal'); setText(doc, BODY)
    doc.text(fit(doc, d.label, labelW - 2), x + labelW - 2, cy + 0.8, { align: 'right' })

    const bw = Math.max((Math.abs(d.value) / max) * barsW, 0.6)
    setFill(doc, hex(d.print))
    doc.roundedRect(x + labelW, cy - barH / 2, bw, barH, 0.5, 0.5, 'F')

    doc.setFont('helvetica', 'bold'); setText(doc, INK)
    doc.text(`${compact(d.value)}`, x + labelW + bw + 1.8, cy + 0.8)
    doc.setFont('helvetica', 'normal'); setText(doc, FAINT)
    doc.text(`${d.share}%`, x + w, cy + 0.8, { align: 'right' })
  })
}

/* ── document furniture ───────────────────────────────────────────────────── */

function drawHeader(doc, logo, { title, subtitle, generated, by }) {
  setFill(doc, BRAND);   doc.rect(0, 0, W, 26, 'F')
  setFill(doc, BRAND_D); doc.rect(0, 26, W, 1.2, 'F')

  let tx = M
  if (logo) {
    try {
      setFill(doc, WHITE)
      doc.roundedRect(M, 5.5, 15, 15, 2.2, 2.2, 'F')
      const p = doc.getImageProperties(logo)
      const box = 11.5
      const scale = Math.min(box / p.width, box / p.height)
      const iw = p.width * scale, ih = p.height * scale
      /* Alias + FAST: without them jsPDF stores the bitmap raw and once per
         page, which turned a two-page report into a 5 MB file. The alias makes
         both pages point at one image object. */
      doc.addImage(logo, 'PNG', M + (15 - iw) / 2, 5.5 + (15 - ih) / 2, iw, ih, 'ideliver-logo', 'FAST')
      tx = M + 19
    } catch { /* header still prints without it */ }
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); setText(doc, WHITE)
  doc.text(title, tx, 13)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(206, 222, 253)
  doc.text(subtitle, tx, 19.5)

  doc.setFontSize(7); doc.setTextColor(206, 222, 253)
  doc.text(generated, W - M, 12, { align: 'right' })
  if (by) doc.text(by, W - M, 16.5, { align: 'right' })
}

/* The window and every filter, spelled out. A report that does not say what it
   covers gets asked "for which dates?" every single time it is sent. */
function drawChips(doc, y, chips) {
  doc.setFontSize(6.8)
  let cx = M
  for (const c of chips) {
    doc.setFont('helvetica', 'bold')
    const kw = doc.getTextWidth(c.k + ' ')
    doc.setFont('helvetica', 'normal')
    const vw = doc.getTextWidth(c.v)
    const w  = kw + vw + 5
    setFill(doc, CARD); setStroke(doc, LINE); doc.setLineWidth(0.2)
    doc.roundedRect(cx, y - 3.4, w, 5.6, 1.2, 1.2, 'FD')
    doc.setFont('helvetica', 'bold'); setText(doc, MUTED)
    doc.text(c.k, cx + 2.5, y)
    doc.setFont('helvetica', 'normal'); setText(doc, INK)
    doc.text(c.v, cx + 2.5 + kw, y)
    cx += w + 2.5
  }
}

function drawTiles(doc, y, tiles) {
  const cols = 4
  const gapX = 4, gapY = 4
  const cw = (W - M * 2 - gapX * (cols - 1)) / cols
  const ch = 16
  tiles.forEach((t, i) => {
    const cx = M + (cw + gapX) * (i % cols)
    const cy = y + (ch + gapY) * Math.floor(i / cols)
    setFill(doc, CARD); setStroke(doc, LINE); doc.setLineWidth(0.2)
    doc.roundedRect(cx, cy, cw, ch, 1.6, 1.6, 'FD')
    setFill(doc, hex(t.accent))
    doc.roundedRect(cx, cy, 1.4, ch, 0.7, 0.7, 'F')

    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); setText(doc, MUTED)
    doc.text(fit(doc, t.label.toUpperCase(), cw - 8), cx + 4, cy + 4.6)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); setText(doc, INK)
    doc.text(fit(doc, t.value, cw - 8), cx + 4, cy + 10.4)
    if (t.sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.6); setText(doc, FAINT)
      doc.text(fit(doc, t.sub, cw - 6), cx + 4, cy + 13.8)
    }
  })
  return y + (ch + gapY) * Math.ceil(tiles.length / cols)
}

function stampFooters(doc, title) {
  const n = doc.internal.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    setStroke(doc, LINE); doc.setLineWidth(0.2)
    doc.line(M, H - 9, W - M, H - 9)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4); setText(doc, FAINT)
    doc.text(title, M, H - 5.5)
    doc.text(`Page ${i} of ${n}`, W - M, H - 5.5, { align: 'right' })
  }
}

/* ── the report ───────────────────────────────────────────────────────────── */

export async function buildPerformancePdf({
  rows, totals, totalMoney, mix, grossTotal,
  period, from, to, grain, currency, closedOnly,
  otherCurrencies = [], company = null, generatedBy = '',
}) {
  const logo = await loadLogo()
  // compress: the document is mostly vector geometry and text, which deflates well.
  const doc  = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const now  = new Date()

  const grainWord = grain === 'month' ? 'month' : grain === 'week' ? 'week' : 'day'
  const day = d => new Date(`${d}T00:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
  const title = 'Performance Report'
  const money = v => fmtAmount(v, currency)

  drawHeader(doc, logo, {
    title,
    subtitle: `${company?.name || 'iDeliver III'}  ·  ${period.label}  ·  ${day(from)} – ${day(to)}`,
    generated: `Generated ${now.toLocaleString()}`,
    by: generatedBy ? `by ${generatedBy}` : '',
  })

  let y = 34
  drawChips(doc, y, [
    { k: 'Period', v: period.label },
    // An en dash, not an arrow: jsPDF's built-in Helvetica is WinAnsi-encoded
    // and has no "→" — it prints as mojibake and mismeasures the chip around it.
    { k: 'Range',  v: `${from} – ${to}` },
    { k: 'Grouped by', v: grainWord },
    { k: 'Scope',  v: closedOnly ? 'Delivered (closed) orders' : 'All orders' },
    { k: 'Currency', v: currency },
  ])
  y += 6

  // Only one currency can be plotted at a time, so say plainly what is missing
  // rather than letting the total read as the whole business.
  if (otherCurrencies.length) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.4); setText(doc, MUTED)
    doc.text(`Figures below are ${currency} only — this window also holds ${otherCurrencies.join(' and ')} amounts, reported separately.`, M, y + 2)
    y += 4
  }
  y += 4

  const pkgPer = totals.orderCount ? (totals.packageCount / totals.orderCount).toFixed(1) : '0.0'
  y = drawTiles(doc, y, [
    { label: `Total revenue · ${currency}`, value: money(totalMoney.total), accent: '#2a78d6',
      sub: totalMoney.discount || totalMoney.vat
        ? `gross ${money(grossTotal)} · disc ${money(totalMoney.discount)} · VAT ${money(totalMoney.vat)}`
        : `across ${totals.orderCount.toLocaleString()} orders` },
    { label: 'Delivery fees', value: money(totalMoney.fees), accent: '#2a78d6',
      sub: grossTotal ? `${Math.round((totalMoney.fees / grossTotal) * 100)}% of gross revenue` : '' },
    { label: closedOnly ? 'Packages delivered' : 'Packages', value: totals.packageCount.toLocaleString(), accent: '#eb6834',
      sub: `${currency} ${money(totalMoney.packages)} of package value` },
    { label: closedOnly ? 'Orders delivered' : 'Orders', value: totals.orderCount.toLocaleString(), accent: '#2a78d6',
      sub: `~${pkgPer} packages each` },
    { label: 'Retail invoices', value: totals.invoiceCount.toLocaleString(), accent: '#eda100',
      sub: `${currency} ${money(totalMoney.externalRetail)} invoiced` },
    { label: 'Local retail items', value: money(totalMoney.localRetail), accent: '#1baf7a',
      sub: `own-catalogue sales, ${currency}` },
    { label: 'Order services', value: money(totalMoney.services), accent: '#e87ba4',
      sub: `${currency}` },
    { label: 'Collected', value: money(totalMoney.collected), accent: '#1baf7a',
      sub: `${currency} ${money(Math.round((totalMoney.total - totalMoney.collected) * 100) / 100)} outstanding` },
  ])
  y += 4

  // Only categories that carry a figure get a slot — colour is bound to the
  // category, so leaving an empty one out never recolours the others.
  const activeMoney = MONEY_SERIES.filter(s => rows.some(r => Number(r[s.key]) !== 0))

  const chartY = chartHeading(doc, M, y + 3,
    `Revenue by ${grainWord} · ${currency}`,
    'Gross revenue, stacked by what earned it. Discount, VAT and the net total are in the table.')
  // Tall enough to use the page it is on: the revenue chart is the headline
  // picture, and a 44mm plot floating above 90mm of white reads as a mistake.
  const chartH = Math.max(H - 20 - chartY - 12, 40)
  if (activeMoney.length && rows.length) {
    drawStackedBars(doc, { x: M, y: chartY, w: W - M * 2, h: chartH, rows, series: activeMoney, currency })
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); setText(doc, FAINT)
    doc.text('No revenue in this window.', M, chartY + 8)
  }

  // ── page 2: volume, mix, and every figure
  doc.addPage()
  drawHeader(doc, logo, {
    title,
    subtitle: `${company?.name || 'iDeliver III'}  ·  ${period.label}  ·  ${day(from)} – ${day(to)}`,
    generated: `Generated ${now.toLocaleString()}`,
    by: generatedBy ? `by ${generatedBy}` : '',
  })

  const halfW = (W - M * 2 - 8) / 2
  const volY = chartHeading(doc, M, 36, `Volume by ${grainWord}`, 'Counts, not money — orders and the packages inside them.')
  drawLines(doc, {
    x: M, y: volY, w: halfW, h: 40, rows, series: COUNT_SERIES,
    labels: closedOnly
      ? { orderCount: 'Orders delivered', packageCount: 'Packages delivered' }
      : { orderCount: 'Orders', packageCount: 'Packages' },
  })

  const mixY = chartHeading(doc, M + halfW + 8, 36, 'Where the revenue came from', `Window total, ${currency}.`)
  drawMix(doc, { x: M + halfW + 8, y: mixY, w: halfW, h: 40, mix, currency })

  autoTable(doc, {
    startY: volY + 54,
    head: [[
      'Period', 'Orders', 'Packages', 'Invoices',
      ...MONEY_SERIES.map(s => s.label),
      'Net total', 'Collected',
    ]],
    body: rows.map(r => [
      r.title,
      r.orderCount.toLocaleString(), r.packageCount.toLocaleString(), r.invoiceCount.toLocaleString(),
      ...MONEY_SERIES.map(s => money(r[s.key])),
      money(r.total), money(r.collected),
    ]),
    foot: [[
      period.label,
      totals.orderCount.toLocaleString(), totals.packageCount.toLocaleString(), totals.invoiceCount.toLocaleString(),
      ...MONEY_SERIES.map(s => money(totalMoney[s.key])),
      money(totalMoney.total), money(totalMoney.collected),
    ]],
    margin: { left: M, right: M, bottom: 14 },
    // The totals row belongs at the END of the table, not repeated on every
    // page: a "Current month" total sitting under a part of the rows reads as
    // the total OF those rows, which it is not.
    showFoot: 'lastPage',
    styles:            { fontSize: 6.4, cellPadding: 1.3, valign: 'middle', textColor: BODY, lineColor: LINE, lineWidth: 0.1 },
    // No halign here: alignment is set per column below, and a section style
    // would override it and right-align the Period heading over left-aligned dates.
    headStyles:        { fillColor: BRAND, textColor: 255, fontSize: 6.2 },
    footStyles:        { fillColor: [232, 240, 254], textColor: INK, fontStyle: 'bold' },
    alternateRowStyles:{ fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: 'left', cellWidth: 42, textColor: INK },
      ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i + 1, { halign: 'right' }])),
      10: { halign: 'right', fontStyle: 'bold', textColor: INK },
      11: { halign: 'right', textColor: GREEN },
    },
    // The table can run past one page; give the continuation a running head so a
    // loose sheet still says what it is.
    didDrawPage: (data) => {
      if (data.pageNumber === 1) return
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setText(doc, INK)
      doc.text(`${title} — every figure by ${grainWord} (${currency})`, M, 12)
      setStroke(doc, LINE); doc.setLineWidth(0.3)
      doc.line(M, 14.5, W - M, 14.5)
    },
    willDrawPage: (data) => { if (data.pageNumber > 1) data.settings.margin.top = 19 },
  })

  stampFooters(doc, `${title} · ${period.label} · ${from} – ${to} · ${currency}`)
  return doc
}

/* Filename that says what it holds, so a folder of these stays sortable. */
export function performancePdfName(period, currency, to) {
  return `ideliver-performance-${period.key}-${currency}-${to}.pdf`
}
