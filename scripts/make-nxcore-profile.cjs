/* The About _NXCORE screen, as a PDF.

   Mirrors the popup deliberately: the logo's own palette (black on white),
   monospace type, the dot-matrix wordmark, and the same words — so the printed
   sheet and the screen are recognisably one thing.

   Run with:  node scripts/make-nxcore-profile.cjs                            */

const fs   = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')

const ROOT = path.join(__dirname, '..')
const OUT  = path.join(ROOT, 'NXCORE_Profile.pdf')

const APP_NAME    = 'iDeliver III'
const APP_VERSION = '3.00.019'
const PHONE       = '+961 70 334 868'
const YEAR        = new Date().getFullYear()

const CAPABILITIES = [
  ['AI AT THE CORE', 'Intelligent automation and machine-learning baked into every product we ship.'],
  ['WEB · DESKTOP · MOBILE', 'Multipurpose software and web applications built on the most advanced platforms.'],
  ['30 YEARS OF CRAFT', 'Three decades of engineering experience turning ideas into systems that scale.'],
]

const W = 210, H = 297, M = 18
const INK = [10, 10, 10]
const SOFT = [110, 110, 110]
const RULE = [200, 200, 200]

const doc = new jsPDF({ unit: 'mm', format: 'a4' })
const inner = W - M * 2

/* The card's 2px black border, as a frame around the whole sheet. */
doc.setDrawColor(...INK); doc.setLineWidth(0.8)
doc.rect(M - 6, M - 6, inner + 12, H - (M - 6) * 2)

let y = M + 6

// ── wordmark, centred, at its own proportions
const logo = 'data:image/png;base64,'
  + fs.readFileSync(path.join(ROOT, 'src/assets/nxcore-logo.png')).toString('base64')
const props = doc.getImageProperties(logo)
const logoW = Math.min(inner - 30, 110)
const logoH = (props.height / props.width) * logoW
doc.addImage(logo, 'PNG', (W - logoW) / 2, y, logoW, logoH)
y += logoH + 4

doc.setDrawColor(...INK); doc.setLineWidth(0.4)
doc.line(W / 2 - 20, y, W / 2 + 20, y)
y += 12

// ── tagline: the line the screen leads with
doc.setFont('courier', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK)
doc.text('BUILDING THE NEXT CORE', W / 2, y, { align: 'center', charSpace: 0.6 })
y += 6.5
doc.text('OF INTELLIGENT SOFTWARE', W / 2, y, { align: 'center', charSpace: 0.6 })
y += 10

doc.setFont('courier', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60)
const intro = doc.splitTextToSize(
  'Multipurpose software and web applications, engineered on the most advanced '
  + 'platforms with AI integration at the core — backed by 30 years of experience '
  + 'turning ideas into systems that scale.', inner - 20)
doc.text(intro, W / 2, y, { align: 'center', lineHeightFactor: 1.6 })
y += intro.length * 5.4 + 10

// ── the three capabilities, in a row of boxes like the screen's grid
const gap = 4
const boxW = (inner - gap * 2) / 3
const boxH = 46
CAPABILITIES.forEach(([title, text], i) => {
  const x = M + i * (boxW + gap)
  doc.setDrawColor(...RULE); doc.setLineWidth(0.3)
  doc.rect(x, y, boxW, boxH)

  // A dot-matrix square stands in for the screen's icon — same visual language.
  const cx = x + boxW / 2
  doc.setFillColor(...INK)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if ((r + c) % 2 === 0) doc.rect(cx - 3 + c * 2.2, y + 6 + r * 2.2, 1.4, 1.4, 'F')
    }
  }

  doc.setFont('courier', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK)
  const heads = doc.splitTextToSize(title, boxW - 8)
  doc.text(heads, cx, y + 20, { align: 'center', charSpace: 0.4 })

  doc.setFont('courier', 'normal'); doc.setFontSize(7); doc.setTextColor(...SOFT)
  const body = doc.splitTextToSize(text, boxW - 8)
  doc.text(body, cx, y + 20 + heads.length * 3.6 + 3, { align: 'center', lineHeightFactor: 1.5 })
})
y += boxH + 14

// ── what this sheet accompanies
doc.setDrawColor(...RULE); doc.setLineWidth(0.3)
doc.line(M, y, W - M, y)
y += 8
doc.setFont('courier', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK)
doc.text('DESIGNED & ENGINEERED BY _NXCORE', W / 2, y, { align: 'center', charSpace: 1 })
y += 10

doc.setFont('courier', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK)
doc.text(`${APP_NAME} · Delivery Management Suite`, W / 2, y, { align: 'center' })
y += 5.5
doc.setFontSize(8); doc.setTextColor(...SOFT)
doc.text(`Version ${APP_VERSION}`, W / 2, y, { align: 'center' })

// ── footer
const fy = H - M - 4
doc.setDrawColor(...RULE); doc.setLineWidth(0.3)
doc.line(M, fy - 8, W - M, fy - 8)
doc.setFont('courier', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...SOFT)
doc.text(`© ${YEAR} _NXCORE. All rights reserved.`, M, fy - 3)
doc.text(PHONE, W - M, fy - 3, { align: 'right' })
doc.setFontSize(7); doc.setTextColor(150)
doc.text('North Lebanon', M, fy + 1.5)

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
console.log('written:', OUT)
