import React, { useState, useEffect, useCallback } from 'react'
import { ClipboardList, X, FileDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { productIsStocked } from '../lib/productCode'
import SearchField from '../components/ui/SearchField'

function fmtPrice(value, currency) {
  const n = Number(value) || 0
  return `${currency || 'USD'} ${n.toLocaleString(undefined, {
    minimumFractionDigits: (currency || 'USD') === 'LBP' ? 0 : 2,
    maximumFractionDigits: (currency || 'USD') === 'LBP' ? 0 : 2,
  })}`
}

function fmtQty(n) {
  const v = Number(n) || 0
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/* ── page ─────────────────────────────────────────────────── */

export default function PriceListPage() {
  const { COMPANY_ID } = useApp()

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')

  const fetchRows = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('products')
      .select('id, code, name, description, unit_of_measure, unit_cost, unit_price, currency, is_active, is_retail, is_returnable, is_service, is_advertisement, inventory(quantity_available)')
      .eq('is_active', true)
      .order('code')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    const mapped = (data ?? []).map(p => ({
      ...p,
      // Only Retail and Returnable carry stock. A service isn't stored and an
      // advert isn't goods, so they have no stock figure at all — null reads as
      // "not applicable" rather than a misleading 0.
      qty_available: productIsStocked(p)
        ? (p.inventory ?? []).reduce((s, i) => s + (Number(i.quantity_available) || 0), 0)
        : null,
    }))
    setRows(mapped)
    setLoading(false)
  }, [COMPANY_ID])

  useEffect(() => { fetchRows() }, [fetchRows])

  const visible = rows.filter(p => {
    const s = search.trim().toLowerCase()
    return !s || [p.code, p.name, p.description, p.unit_of_measure]
      .some(v => String(v ?? '').toLowerCase().includes(s))
  })

  /* ── PDF export — exactly what's currently displayed (filtered) ─── */

  function exportPDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const now = new Date()
    const marginX = 14

    doc.setFontSize(14); doc.setTextColor(20)
    doc.text('Product Price List', marginX, 16)
    doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`Generated: ${now.toLocaleString()}`, marginX, 22)
    if (search.trim()) doc.text(`Search: "${search.trim()}"`, marginX, 27)

    autoTable(doc, {
      startY: 32,
      head: [['Product Code', 'Description', 'Unit', 'Basic Price', 'Selling Price', 'Qty Available']],
      body: visible.map(p => [
        p.code ?? '—',
        p.name ?? '—',
        p.unit_of_measure ?? '—',
        fmtPrice(p.unit_cost, p.currency),
        fmtPrice(p.unit_price, p.currency),
        p.qty_available === null ? '—' : fmtQty(p.qty_available),   // services aren't stocked
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    })

    const finalY = doc.lastAutoTable?.finalY ?? 32
    doc.setFontSize(10); doc.setTextColor(20)
    doc.text(`Products: ${visible.length}`, marginX, finalY + 8)
    doc.save(`price-list-${now.toISOString().slice(0, 10)}.pdf`)
  }

  /* ── render ──────────────────────────────────────────────── */

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <ClipboardList className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Price List</h1>
            <p className="text-xs text-slate-500 mt-0.5">{visible.length} of {rows.length} products</p>
          </div>
        </div>

        <div className="relative flex-1 max-w-sm ml-2">
          <SearchField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search code, description, unit…"
          />
        </div>

        <button className="btn-primary ml-auto" onClick={exportPDF} disabled={visible.length === 0}>
          <FileDown className="w-4 h-4" /> Export PDF
        </button>
      </div>

      {/* List */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-surface-border">
              {['Product Code', 'Description', 'Unit', 'Basic Price', 'Selling Price', 'Qty Available'].map((h, i) => (
                <th key={h} className={`px-4 py-3 text-slate-500 text-xs font-medium uppercase tracking-wider whitespace-nowrap ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No products found</td></tr>
            ) : visible.map(p => (
              <tr key={p.id} className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-brand-400 bg-brand-600/10 border border-brand-600/20 px-2 py-0.5 rounded">{p.code}</span>
                </td>
                <td className="px-4 py-3 text-slate-200 text-xs">
                  {p.name ?? <span className="text-slate-600">—</span>}
                  {p.description && <span className="block text-[11px] text-slate-500">{p.description}</span>}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{p.unit_of_measure ?? '—'}</td>
                <td className="px-4 py-3 text-slate-300 text-xs text-right whitespace-nowrap">{fmtPrice(p.unit_cost, p.currency)}</td>
                <td className="px-4 py-3 text-slate-100 text-xs font-medium text-right whitespace-nowrap">{fmtPrice(p.unit_price, p.currency)}</td>
                <td className={`px-4 py-3 text-xs font-medium text-right ${p.qty_available > 0 ? 'text-green-400' : 'text-slate-500'}`}>
                  {p.qty_available === null
                    ? <span className="text-slate-600" title="Service — not stocked">—</span>
                    : fmtQty(p.qty_available)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
