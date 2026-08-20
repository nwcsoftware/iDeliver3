import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Tags, Search, Printer, FileDown, AlertCircle, Calendar, CheckSquare, Square, Package,
} from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { orderTotalsByCurrency } from '../lib/orderAmounts'
import logoUrl from '../assets/ideliver-logo-login.png'

/* Package labels — pick a delivery date, tick the packages, print 5.8 × 6 cm
   labels carrying the order number, recipient, delivery location, the customer
   sending the parcel, and the package reference both as text and as a barcode. */

// Xprinter XP-365B stock: 5.8 × 6 cm.
const LABEL_W_MM = 58
const LABEL_H_MM = 60
// Printed on every label so the recipient can reach us.
const COMPANY_PHONE = '+961 81 585 255'

/* The app's own logo file, read once and kept as a data URL so jsPDF can embed
   it. The image is used exactly as it ships — only scaled, never redrawn. */
let logoDataPromise = null
function loadLogoData() {
  if (!logoDataPromise) {
    logoDataPromise = fetch(logoUrl)
      .then(r => r.blob())
      .then(b => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = reject
        fr.readAsDataURL(b)
      }))
      .catch(() => null)   // no logo → the label simply prints without it
  }
  return logoDataPromise
}

const localToday = () => {
  const d = new Date(), pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const money = (v, c) => `${Number(v || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`
/* An order's total can span currencies — "12.00 USD + 300,000 LBP". */
const totalsText = (totals) => Object.entries(totals || {})
  .filter(([, v]) => Math.round((Number(v) || 0) * 100) !== 0)
  .map(([c, v]) => money(v, c)).join(' + ')

const customerName = (c) =>
  (c?.company_name?.trim() || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || '—')

/* The same label as a PDF: one 58 × 60 mm page per package, so it can be saved,
   e-mailed or sent to a label printer without going through the browser's
   print dialog. Barcodes are rendered to a canvas and placed as images. */
function barcodePng(value) {
  try {
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, String(value), {
      format: 'CODE128', displayValue: false, height: 70, width: 2,
      margin: 0, background: '#ffffff', lineColor: '#000000',
    })
    return canvas.toDataURL('image/png')
  } catch {
    return null   // unencodable reference → label prints without a barcode
  }
}

function buildLabelsPdf(labels, logoData) {
  // 2.5mm all round — the printed label's margin, kept in step so the PDF
  // and the browser print land in the same place on the sticker.
  const W = LABEL_W_MM, H = LABEL_H_MM, M = 2.5
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'portrait' })

  // Logo size, kept to the file's own aspect ratio.
  let logoW = 0, logoH = 0
  if (logoData) {
    try {
      const props = doc.getImageProperties(logoData)
      logoH = 7.5
      logoW = (props.width / props.height) * logoH
    } catch { logoData = null }
  }

  labels.forEach((r, i) => {
    if (i > 0) doc.addPage([W, H], 'portrait')
    const inner = W - M * 2

    // Logo on the left; order number with our phone under it on the right.
    if (logoData) doc.addImage(logoData, 'PNG', M, M - 1, logoW, logoH)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0)
    doc.text(String(r.orderNumber || '—'), W - M, M + 2.6, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(60)
    doc.text(COMPANY_PHONE, W - M, M + 6.4, { align: 'right' })
    doc.setLineWidth(0.5); doc.setDrawColor(0)
    doc.line(M, M + 8.6, W - M, M + 8.6)

    // Recipient + mobile — each block is spaced so the label reads in bands.
    let y = M + 12.2
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(90)
    doc.text('TO', M, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(0)
    doc.text(doc.splitTextToSize(String(r.recipient || '—'), inner)[0], M, y + 3.6)
    y += 3.6
    if (r.recipientMobile) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60)
      doc.text(String(r.recipientMobile), M, y + 3.4)
      y += 3.4
    }

    // Delivery location — two lines, then it is cut.
    y += 3.4
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(0)
    const addr = doc.splitTextToSize(String(r.address || '—'), inner).slice(0, 2)
    doc.text(addr, M, y)
    y += (addr.length - 1) * 3.1

    // Who is sending it + mobile
    y += 4.2
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(90)
    doc.text('FROM', M, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0)
    doc.text(doc.splitTextToSize(String(r.customer || '—'), inner - 11)[0], M + 10, y)
    if (r.customerMobile) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60)
      doc.text(String(r.customerMobile), M, y + 3.4)
      y += 3.4
    }

    // Money block: package, delivery fee, order total (all currencies).
    y += 2
    doc.setLineWidth(0.2); doc.setDrawColor(150)
    doc.line(M, y, W - M, y)
    y += 3.2
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(90)
    doc.text('PACKAGE', M, y)
    doc.text('DELIVERY', M, y + 3.6)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0)
    doc.text(money(r.packageAmount, r.packageCurrency), W - M, y, { align: 'right' })
    doc.text(money(r.deliveryFee, r.feeCurrency), W - M, y + 3.6, { align: 'right' })

    // Rule under the delivery fee, then the total centred between that rule
    // and the top of the barcode.
    const ruleY = y + 5.6
    doc.setLineWidth(0.4); doc.setDrawColor(0)
    doc.line(M, ruleY, W - M, ruleY)

    const barTop = H - 12.5, barH = 9.5
    const totalY = ruleY + (barTop - ruleY) / 2 + 1.2   // +1.2 → optical centre
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(90)
    doc.text('TOTAL', M, totalY)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0)
    doc.text(doc.splitTextToSize(totalsText(r.totals) || money(0, r.feeCurrency), inner - 12)[0],
      W - M, totalY, { align: 'right' })

    // Barcode at the foot of the label, with the reference laid over its base
    // on a white patch so neither obscures the other.
    const png = r.tracking_number ? barcodePng(r.tracking_number) : null
    if (png) doc.addImage(png, 'PNG', M, barTop, inner, barH)
    if (r.tracking_number) {
      doc.setFont('courier', 'normal'); doc.setFontSize(8)
      const label = String(r.tracking_number)
      const textW = doc.getTextWidth(label) + 2
      doc.setFillColor(255, 255, 255)
      doc.rect(W / 2 - textW / 2, barTop + barH - 3.2, textW, 3.4, 'F')
      doc.setTextColor(0)
      doc.text(label, W / 2, barTop + barH - 0.6, { align: 'center' })
    }
  })

  return doc
}

export default function PackageLabelsPage() {
  const { COMPANY_ID } = useApp()

  const [date,    setDate]    = useState(localToday())
  const [rows,    setRows]    = useState([])
  const [picked,  setPicked]  = useState(() => new Set())
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  /* Packages ride on orders, and the delivery date lives on the order — so the
     orders for the chosen day are loaded with their packages embedded. */
  const load = useCallback(async () => {
    setLoading(true); setPicked(new Set())
    let q = supabase
      .from('delivery_orders')
      .select(`
        id, order_number, recipient_name, recipient_mobile, delivery_address,
        scheduled_date, isclosed, currency, delivery_fee, discount_amount,
        discount_currency, vat_amount, is_free_order,
        customer:contacts!customer_id(id, first_name, last_name, company_name, mobile, whatsapp_number),
        order_items(currency, line_total, is_deleted),
        order_services(service_fees, service_fees_currency),
        retail_goods_invoices(invoice_value, currency, exclude_calculation),
        ads(price, currency),
        delivery_packages(id, tracking_number, description, quantity, provider_id,
          package_price, currency, paid,
          provider:contacts!provider_id(id, first_name, last_name, company_name, mobile))
      `)
      .eq('scheduled_date', date)
      .order('order_number')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)

    const { data, error: e } = await q
    if (e) { setError(e.message); setRows([]); setLoading(false); return }

    // Flatten to one row per package — a label is per package, not per order.
    const flat = []
    for (const o of data ?? []) {
      for (const pk of (o.delivery_packages ?? [])) {
        flat.push({
          id: pk.id,
          tracking_number: pk.tracking_number || '',
          description: pk.description || '',
          quantity: pk.quantity ?? 1,
          orderNumber: o.order_number,
          recipient: o.recipient_name || '',
          recipientMobile: o.recipient_mobile || '',
          address: o.delivery_address || '',
          customer: customerName(o.customer),
          customerMobile: o.customer?.mobile || o.customer?.whatsapp_number || '',
          provider: customerName(pk.provider),
          // This package's own price, the order's delivery fee, and the order
          // total per currency (an order can mix currencies).
          packageAmount: Number(pk.package_price) || 0,
          packageCurrency: pk.currency || o.currency || 'USD',
          deliveryFee: Number(o.delivery_fee) || 0,
          feeCurrency: o.currency || 'USD',
          totals: orderTotalsByCurrency(o),
        })
      }
    }
    setRows(flat); setError(''); setLoading(false)
  }, [date, COMPANY_ID])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const shown = useMemo(() => rows.filter(r => !q || [
    r.orderNumber, r.tracking_number, r.recipient, r.address, r.customer, r.provider,
  ].some(v => String(v ?? '').toLowerCase().includes(q))), [rows, q])

  const allShownPicked = shown.length > 0 && shown.every(r => picked.has(r.id))
  const toggleAll = () => setPicked(prev => {
    const next = new Set(prev)
    if (allShownPicked) shown.forEach(r => next.delete(r.id))
    else                shown.forEach(r => next.add(r.id))
    return next
  })
  const toggle = (id) => setPicked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const labels = rows.filter(r => picked.has(r.id))

  async function savePdf() {
    if (labels.length === 0) return
    const logoData = await loadLogoData()
    buildLabelsPdf(labels, logoData).save(`package-labels-${date}.pdf`)
  }

  /* Print the PDF, not an HTML copy of it.

     Keeping a second layout in CSS meant two things had to be kept identical by
     hand, and they drifted — the browser rendered its own version while the PDF
     was right. Printing the generated document instead makes them the same
     thing by construction, and the printer receives exact 58 × 60 mm pages
     rather than whatever the browser decides to scale to. */
  const [printing, setPrinting] = useState(false)
  async function printLabels() {
    if (labels.length === 0 || printing) return
    setPrinting(true)
    try {
      const logoData = await loadLogoData()
      const url = buildLabelsPdf(labels, logoData).output('bloburl')
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
      frame.src = url
      frame.onload = () => {
        try {
          frame.contentWindow.focus()
          frame.contentWindow.print()
        } catch {
          // Some browsers refuse to print an embedded PDF — open it instead, so
          // the operator is never left with a button that does nothing.
          window.open(url, '_blank', 'noopener')
        }
        // Long enough for the print dialog to have taken what it needs.
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60000)
      }
      document.body.appendChild(frame)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* ── Toolbar (not printed) ───────────────────────────── */}
      <div className="print:hidden space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Tags className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-semibold text-slate-100">Package Labels</h2>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> Delivery date</label>
              <input type="date" className="input py-1.5 text-xs w-40" value={date}
                onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input className="input pl-9" placeholder="Search order, reference, recipient…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={savePdf} disabled={labels.length === 0}
              title="Create a PDF of the selected labels (58 × 60 mm per page)"
              className="btn-ghost h-9 px-3 text-sm border border-surface-border text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
              <FileDown className="w-4 h-4" /> PDF
            </button>
            <button onClick={printLabels} disabled={labels.length === 0 || printing}
              title="Print the labels — the same document as the PDF, at 58 × 60 mm"
              className="btn-primary h-9 py-0 px-3 disabled:opacity-40 disabled:cursor-not-allowed">
              <Printer className="w-4 h-4" /> Print {labels.length || ''} label{labels.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-xs leading-relaxed">{error}</p>
          </div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border">
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleAll} title={allShownPicked ? 'Clear selection' : 'Select all'}
                    className="text-slate-400 hover:text-slate-100">
                    {allShownPicked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>
                </th>
                {['Package reference', 'Order #', 'Recipient', 'Delivery location', 'Customer'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  {rows.length === 0 ? 'No packages scheduled for this date.' : 'No packages match your search.'}
                </td></tr>
              ) : shown.map(r => {
                const on = picked.has(r.id)
                return (
                  <tr key={r.id} onClick={() => toggle(r.id)}
                    className={`border-b border-surface-border/50 cursor-pointer transition-colors ${
                      on ? 'bg-brand-500/10' : 'hover:bg-surface-hover/40'}`}>
                    <td className="px-4 py-3">
                      {on ? <CheckSquare className="w-4 h-4 text-brand-400" /> : <Square className="w-4 h-4 text-slate-600" />}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-200">{r.tracking_number || <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs text-brand-300">{r.orderNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{r.recipient || '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[16rem] truncate">{r.address || '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{r.customer}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-slate-500">
          Labels are {LABEL_W_MM} × {LABEL_H_MM} mm, one per page — the same size in the PDF and when printing.
          Set your printer to that label size (or to “actual size”, no scaling) so the barcode stays readable.
        </p>
      </div>

      {/* The labels are no longer rendered as HTML: printing goes through the
          generated PDF (see printLabels), so there is only one layout to keep
          right, and the printer gets exact 58 × 60 mm pages. */}
    </div>
  )
}
