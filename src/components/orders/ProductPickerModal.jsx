import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X, Package, ArrowLeft, Check, Wrench } from 'lucide-react'
import SearchField from '../ui/SearchField'
import {
  itemOptions, choiceGroups, valueState, missingChoice, prunePicks,
  pickedExtras, optionsTotal, priceDeltaText, variantLabel, pickedImage, optionsExhausted,
} from '../../lib/shopOptions'

/* PICKING A 3ASARI3 ITEM FOR AN ORDER — in as few clicks as the item allows.

     1. the catalog as cards, photo first, with a search box already focused;
        Enter takes the first card;
     2. an item with options opens them at once — photos as cards, the rest as
        chips, extras as toggles — with anything that has only one answer left
        already chosen; OK (or Enter) adds the line.
   An item without options is added the moment its card is clicked.

   The options are the same ones the customer app offers, read through the same
   helpers (lib/shopOptions), so a sold-out size or a combination the shop does
   not make is just as unavailable here. */

const coverOf = (p) => (Array.isArray(p?.images) && p.images.find(Boolean)) || p?.image_url || null
const fmt = (v, c) => `${(Number(v) || 0).toLocaleString(undefined, {
  minimumFractionDigits: c === 'LBP' ? 0 : 2, maximumFractionDigits: c === 'LBP' ? 0 : 2 })} ${c || 'USD'}`

/* Every choice that has exactly one answer left is answered — nobody should
   click "Large" when Large is all there is. */
function autoPicks(product, picks = {}) {
  const out = { ...picks }
  for (const g of choiceGroups(itemOptions(product))) {
    if (out[g.label]) continue
    const open = g.values.filter(v => valueState(product, g, v, out) === 'available')
    if (open.length === 1) out[g.label] = open[0].name
  }
  return out
}

export default function ProductPickerModal({ products = [], initial = null, onPick, onClose }) {
  const startProduct = initial?.product_id ? products.find(p => p.id === initial.product_id) || null : null
  const startsInOptions = !!startProduct && itemOptions(startProduct).length > 0
  const [step, setStep]       = useState(startsInOptions ? 'options' : 'products')
  const [product, setProduct] = useState(startProduct)
  const [picks, setPicks]     = useState(() => (startsInOptions ? autoPicks(startProduct, initial?.picks || {}) : {}))
  const [query, setQuery]     = useState('')
  const [err, setErr]         = useState('')
  const okRef = useRef(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(p => !q || [p.name, p.code, p.category?.name].some(v => String(v ?? '').toLowerCase().includes(q)))
  }, [products, query])

  const groups = useMemo(() => (product ? itemOptions(product) : []), [product])
  const missing = product ? missingChoice(groups, picks, product) : null
  const price = product ? (Number(product.unit_price) || 0) + optionsTotal(groups, picks) : 0

  // Escape steps back, then closes — never loses the line being built by surprise.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (step === 'options' && !initial?.product_id) { setStep('products'); setErr('') } else onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, initial, onClose])

  // The OK button takes the focus in the options step, so Enter confirms.
  useEffect(() => { if (step === 'options') okRef.current?.focus() }, [step])

  function finish(p, pk) {
    const gs = itemOptions(p)
    onPick?.({
      product: p,
      picks: gs.length ? pk : null,
      variant: variantLabel(gs, pk),
      // What the options add: the chosen values' prices and the extras.
      optionsPrice: optionsTotal(gs, pk),
      image: pickedImage(gs, pk) || coverOf(p),
    })
  }

  function choose(p) {
    if (itemOptions(p).length === 0) { finish(p, {}); return }
    setProduct(p)
    setPicks(autoPicks(p, product?.id === p.id ? picks : {}))
    setErr('')
    setStep('options')
  }

  function pickChoice(g, v) {
    setPicks(prev => autoPicks(product, prunePicks(product, groups, { ...prev, [g.label]: v.name })))
    setErr('')
  }
  function toggleExtra(g, v) {
    setPicks(prev => {
      const have = pickedExtras(g, prev)
      return { ...prev, [g.label]: have.includes(v.name) ? have.filter(x => x !== v.name) : [...have, v.name] }
    })
  }
  function confirm() {
    if (missing) { setErr(`Choose the ${missing.label.toLowerCase()}.`); return }
    finish(product, picks)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[85] p-4"
      role="dialog" aria-label="Choose a 3asari3 item">
      <div className="card w-full max-w-3xl max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-surface-border">
          {step === 'options' ? (
            <>
              <button type="button" onClick={() => { setStep('products'); setErr('') }} title="All items"
                className="btn-ghost p-1.5 text-slate-400 hover:text-slate-100"><ArrowLeft className="w-4 h-4" /></button>
              {coverOf(product)
                ? <img src={pickedImage(groups, picks) || coverOf(product)} alt="" className="w-10 h-10 rounded-lg object-cover border border-surface-border" />
                : <span className="w-10 h-10 rounded-lg bg-surface-hover flex items-center justify-center"><Package className="w-5 h-5 text-slate-500" /></span>}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-100 truncate">{product?.name}</p>
                <p className="text-[11px] text-slate-400 tabular-nums">{fmt(price, product?.currency)}</p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-100 whitespace-nowrap">Add a 3asari3 item</p>
              <div className="relative flex-1 max-w-xs">
                <SearchField value={query} onChange={e => setQuery(e.target.value)} autoFocus
                  aria-label="Search the items" placeholder="Search item or code…" className="input pl-9 py-1.5 text-sm"
                  onKeyDown={e => { if (e.key === 'Enter' && shown[0] && !optionsExhausted(shown[0])) choose(shown[0]) }} />
              </div>
            </>
          )}
          <button type="button" onClick={onClose} className="btn-ghost p-1.5 ml-auto" title="Close"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4">
          {step === 'products' ? (
            shown.length === 0 ? (
              <p className="text-xs text-slate-500 px-1 py-6 text-center">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {shown.map(p => {
                  const img = coverOf(p)
                  const out = optionsExhausted(p)
                  const nOpts = itemOptions(p).length
                  return (
                    <button key={p.id} type="button" disabled={out} onClick={() => choose(p)}
                      className="group text-left rounded-xl border border-surface-border bg-surface-hover/30 overflow-hidden
                                 hover:border-brand-500/50 hover:bg-surface-hover/60 transition-colors
                                 disabled:opacity-40 disabled:cursor-not-allowed">
                      <div className="aspect-[4/3] bg-surface-hover flex items-center justify-center overflow-hidden">
                        {img
                          ? <img src={img} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform" />
                          : (p.is_service ? <Wrench className="w-7 h-7 text-slate-600" /> : <Package className="w-7 h-7 text-slate-600" />)}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-xs font-medium text-slate-100 truncate" title={p.name}>{p.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-emerald-300 tabular-nums">{fmt(p.unit_price, p.currency)}</span>
                          {nOpts > 0 && (
                            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-brand-500/15 text-brand-300">
                              {nOpts} option{nOpts === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono">{p.code}{out ? ' · out of stock' : ''}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            <div className="space-y-4">
              {groups.map(g => {
                const extra = g.kind === 'extra'
                const photos = g.style === 'swatch' || g.values.some(v => v.image)
                return (
                  <div key={g.label}>
                    <p className="text-xs font-semibold text-slate-200 mb-2">
                      {g.label}
                      <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                        {extra ? 'optional — any number' : 'choose one'}
                      </span>
                    </p>
                    <div className={photos ? 'grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2' : 'flex flex-wrap gap-1.5'}>
                      {g.values.map(v => {
                        const state = extra ? (v.sold_out ? 'sold_out' : 'available') : valueState(product, g, v, picks)
                        const on = extra ? pickedExtras(g, picks).includes(v.name) : picks[g.label] === v.name
                        const off = state !== 'available'
                        const delta = Number(v.price_delta) || 0
                        const note = state === 'sold_out' ? 'sold out' : state === 'not_sold' ? 'not available' : ''
                        const click = () => (extra ? toggleExtra(g, v) : pickChoice(g, v))
                        return photos ? (
                          <button key={v.name} type="button" disabled={off} onClick={click} aria-pressed={on}
                            className={`relative text-left rounded-lg border overflow-hidden transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                              on ? 'border-brand-400 ring-2 ring-brand-500/40' : 'border-surface-border hover:border-slate-500'}`}>
                            <div className="aspect-square bg-surface-hover flex items-center justify-center">
                              {v.image ? <img src={v.image} alt="" loading="lazy" className="w-full h-full object-cover" />
                                       : <span className="text-[11px] text-slate-500 px-1 text-center">{v.name}</span>}
                            </div>
                            <p className="px-1.5 py-1 text-[11px] text-slate-200 truncate">
                              {v.name}{delta ? <span className={delta > 0 ? 'text-emerald-300' : 'text-amber-300'}> {priceDeltaText(delta, x => fmt(x, product.currency))}</span> : null}
                            </p>
                            {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center"><Check className="w-3 h-3 text-white" /></span>}
                            {note && <span className="absolute inset-x-0 top-1 text-center text-[9px] text-rose-200">{note}</span>}
                          </button>
                        ) : (
                          <button key={v.name} type="button" disabled={off} onClick={click} aria-pressed={on}
                            title={note || undefined}
                            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border transition-colors disabled:opacity-35 disabled:cursor-not-allowed disabled:line-through ${
                              on ? 'bg-brand-500/20 border-brand-400 text-brand-200' : 'bg-surface-hover border-surface-border text-slate-300 hover:text-slate-100'}`}>
                            {on && <Check className="w-3.5 h-3.5" />}
                            {v.name}
                            {delta ? <span className={delta > 0 ? 'text-emerald-300' : 'text-amber-300'}>{priceDeltaText(delta, x => fmt(x, product.currency))}</span> : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer — the options step only */}
        {step === 'options' && (
          <div className="flex items-center gap-3 px-5 py-3 border-t border-surface-border">
            <p className={`text-xs truncate ${err ? 'text-rose-300' : 'text-slate-400'}`}>
              {err || (missing ? `Choose the ${missing.label.toLowerCase()}.` : (variantLabel(groups, picks) || 'Ready'))}
            </p>
            <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm border border-surface-border ml-auto">Cancel</button>
            <button ref={okRef} type="button" onClick={confirm} disabled={!!missing}
              className="btn-primary px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <Check className="w-4 h-4" /> OK
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
