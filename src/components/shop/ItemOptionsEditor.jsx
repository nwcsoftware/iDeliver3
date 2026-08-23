import React, { useState } from 'react'
import { Plus, Trash2, X, Image as ImageIcon } from 'lucide-react'
import {
  OPTION_PRESETS, OPTION_STYLES, OPTION_KINDS,
  MAX_OPTIONS, MAX_OPTION_VALUES, MAX_COMBOS,
  choiceGroups, comboMatrix,
} from '../../lib/shopOptions'

/* The options editor, shared by the supplier's My Shop and the office Products
   catalog (supabase-fix129, fix130, fix131).

   Both sell the same way to the same customer app, so they have to offer the
   same thing: an option the seller names (Size, Color, Flavor, Extras), each
   value able to run out on its own, and a grid of which combinations are
   actually sold. One editor rather than two, because two would drift — and the
   customer app reads them through one set of helpers either way.

   Controlled: `options` and `combos` come in, `onChange({ options, combos })`
   goes out, so the parent's form stays the single source of truth. */

const EMPTY_VALUE = () => ({ name: '', image: null, sold_out: false, price_delta: 0 })

/* Two combinations are the same when they name the same values for the same
   options — the object key order a grid cell was built in means nothing. */
const samePicks = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every(k => a[k] === b[k])
}
const COMBO_CYCLE = { available: 'sold_out', sold_out: 'not_sold', not_sold: 'available' }
const COMBO_LOOK = {
  available: { label: 'On sale',  cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
  sold_out:  { label: 'Sold out', cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  not_sold:  { label: 'Not sold', cls: 'bg-slate-500/10 text-slate-500 border-surface-border' },
}

export default function ItemOptionsEditor({
  options = [], combos = [], currency = 'USD', onChange, onError = () => {},
}) {
  const emit = (patch) => onChange({ options, combos, ...patch })
  const patchGroups = (fn) => emit({ options: fn(options) })

  function addGroup() {
    patchGroups(gs => (gs.length >= MAX_OPTIONS
      ? gs
      : [...gs, { label: '', kind: 'choice', style: 'chip', values: [EMPTY_VALUE()] }]))
  }
  function setGroup(gi, patch) {
    patchGroups(gs => gs.map((g, i) => (i === gi ? { ...g, ...patch } : g)))
  }
  function removeGroup(gi) {
    patchGroups(gs => gs.filter((_, i) => i !== gi))
  }
  function addValue(gi) {
    patchGroups(gs => gs.map((g, i) => (i !== gi || g.values.length >= MAX_OPTION_VALUES
      ? g
      : { ...g, values: [...g.values, EMPTY_VALUE()] })))
  }
  function setValue(gi, vi, patch) {
    patchGroups(gs => gs.map((g, i) => (i !== gi
      ? g
      : { ...g, values: g.values.map((v, j) => (j === vi ? { ...v, ...patch } : v)) })))
  }
  function removeValue(gi, vi) {
    patchGroups(gs => gs.map((g, i) => (i !== gi ? g : { ...g, values: g.values.filter((_, j) => j !== vi) })))
  }
  // A photo per value, for options shown as swatches. Stored as a data URL like
  // the item photos, so nothing depends on an upload bucket.
  function onPickValueImage(gi, vi, e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { onError('Please choose an image file.'); return }
    if (file.size > 400 * 1024) { onError('An option photo must be under 400 KB.'); return }
    const reader = new FileReader()
    reader.onload = () => { setValue(gi, vi, { image: String(reader.result || '') }); onError('') }
    reader.readAsDataURL(file)
  }

  /* The grid is built from the first two CHOICE options; a third splits it
     into pages so the table stays two-dimensional and readable. Extras never
     appear — they are add-ons, not combinations. */
  const [gridSlice, setGridSlice] = useState('')
  const gridGroups   = choiceGroups(options).filter(g => g.values.some(v => v.name.trim()))
  const gridRowGroup = gridGroups[0] || null
  const gridColGroup = gridGroups[1] || null
  const gridSliceGroup = gridGroups[2] || null
  const gridTooBig   = comboMatrix(options).length >= MAX_COMBOS
  const gridRows = !gridTooBig && gridRowGroup ? gridRowGroup.values.filter(v => v.name.trim()) : []
  const gridCols = !gridTooBig && gridColGroup ? gridColGroup.values.filter(v => v.name.trim()) : []
  const gridSliceValue = gridSliceGroup
    ? (gridSliceGroup.values.some(v => v.name === gridSlice) ? gridSlice : gridSliceGroup.values[0]?.name || '')
    : ''

  /* One cell of the availability grid, cycled On sale → Sold out → Not sold.
     Only the exceptions are stored, so an untouched grid costs nothing. */
  function cycleCombo(picks) {
    const i = combos.findIndex(c => samePicks(c.picks || {}, picks))
    const now  = i < 0 ? 'available' : (combos[i].state || 'sold_out')
    const next = COMBO_CYCLE[now] || 'available'
    const rest = combos.filter((_, j) => j !== i)
    emit({ combos: next === 'available' ? rest : [...rest, { picks, state: next }] })
  }
  const comboAt = (picks) =>
    combos.find(c => samePicks(c.picks || {}, picks))?.state || 'available'

  return (
    <>
      {/* ── Options (optional) ─────────────────────────────
          The shop decides what the choice is called. Each value can be
          marked sold out on its own — one size finishing does not take
          the whole item off sale. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="label mb-0">
            Options <span className="text-slate-600 normal-case">(optional — size, colour, flavour…)</span>
          </label>
          {options.length < MAX_OPTIONS && (
            <button type="button" onClick={addGroup}
              className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
              <Plus className="w-3 h-3" /> Add option
            </button>
          )}
        </div>

        {options.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            No options — the item is sold as it is. Add one if customers must choose
            a size, a colour, a flavour or anything else.
          </p>
        ) : options.map((g, gi) => {
          const left = g.values.filter(v => v.name.trim() && !v.sold_out).length
          const gone = g.values.filter(v => v.name.trim() && v.sold_out).length
          return (
            <div key={gi} className="rounded-lg border border-surface-border bg-surface-hover/20 p-3 space-y-2.5">

              {/* What this option is called, what kind it is, how it looks */}
              <div className="flex items-center gap-2">
                <input className="input flex-1 py-1.5 text-sm" value={g.label} list="option-presets"
                  placeholder="What is this choice called? e.g. Size, Color, Flavor, Extras"
                  onChange={e => setGroup(gi, { label: e.target.value })} />
                <button type="button" onClick={() => removeGroup(gi)} title="Remove this option"
                  className="btn-ghost p-1.5 text-slate-400 hover:text-red-400 flex-shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  {OPTION_KINDS.map(k => (
                    <button key={k.key} type="button" title={k.hint}
                      onClick={() => setGroup(gi, { kind: k.key })}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                        (g.kind || 'choice') === k.key
                          ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                          : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                      {k.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {OPTION_STYLES.map(st => (
                    <button key={st.key} type="button" title={st.hint}
                      onClick={() => setGroup(gi, { style: st.key })}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                        g.style === st.key
                          ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                          : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                      {st.label}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-500">
                  {(g.kind || 'choice') === 'extra'
                    ? 'Optional add-ons — the customer may take any number, and each adds to the price.'
                    : 'The customer must pick exactly one.'}
                </span>
              </div>

              {/* Its values */}
              <div className="space-y-1.5">
                {g.values.map((v, vi) => (
                  <div key={vi} className="flex items-center gap-2">
                    {g.style === 'swatch' && (
                      <label className="w-10 h-10 flex-shrink-0 rounded-md border border-surface-border bg-surface-hover overflow-hidden cursor-pointer flex items-center justify-center"
                        title="Photo for this value (optional)">
                        {v.image
                          ? <img src={v.image} alt="" className="w-full h-full object-cover" />
                          : <ImageIcon className="w-4 h-4 text-slate-600" />}
                        <input type="file" accept="image/*" className="hidden"
                          onChange={e => onPickValueImage(gi, vi, e)} />
                      </label>
                    )}
                    <input className={`input flex-1 py-1.5 text-sm ${v.sold_out ? 'line-through text-slate-500' : ''}`}
                      value={v.name} placeholder={g.style === 'swatch' ? 'e.g. Navy Blue' : 'e.g. 43'}
                      onChange={e => setValue(gi, vi, { name: e.target.value })} />

                    {/* What this add-on costs on top of the item price. */}
                    {(g.kind || 'choice') === 'extra' && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-[11px] text-slate-500">+</span>
                        <input type="number" min="0" step="0.01" className="input py-1.5 text-xs w-20"
                          value={v.price_delta || ''} placeholder="0.00"
                          onChange={e => setValue(gi, vi, { price_delta: e.target.value })} />
                        <span className="text-[11px] text-slate-500">{currency}</span>
                      </div>
                    )}

                    {/* The whole point: this one value is finished. */}
                    <button type="button" onClick={() => setValue(gi, vi, { sold_out: !v.sold_out })}
                      title={v.sold_out ? 'Sold out — click when it is back' : 'In stock — click when it runs out'}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border whitespace-nowrap transition-colors ${
                        v.sold_out
                          ? 'bg-red-500/10 text-red-300 border-red-500/30'
                          : 'bg-green-500/10 text-green-300 border-green-500/30'}`}>
                      {v.sold_out ? 'Sold out' : 'In stock'}
                    </button>

                    {v.image && g.style === 'swatch' && (
                      <button type="button" onClick={() => setValue(gi, vi, { image: null })}
                        title="Remove photo"
                        className="btn-ghost p-1 text-slate-500 hover:text-slate-300 text-[11px]">clear</button>
                    )}
                    <button type="button" onClick={() => removeValue(gi, vi)} title="Remove this value"
                      className="btn-ghost p-1.5 text-slate-500 hover:text-red-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                {g.values.length < MAX_OPTION_VALUES ? (
                  <button type="button" onClick={() => addValue(gi)}
                    className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                    <Plus className="w-3 h-3" /> Add {g.label.trim() ? g.label.trim().toLowerCase() : 'value'}
                  </button>
                ) : <span className="text-[10px] text-slate-600">Up to {MAX_OPTION_VALUES} values.</span>}
                <span className="text-[10px] text-slate-500">
                  {left} available{gone > 0 && <span className="text-red-300/80"> · {gone} sold out</span>}
                </span>
              </div>

              {left === 0 && g.values.some(v => v.name.trim()) && (
                <p className="text-[11px] text-amber-300/90">
                  Every {g.label.trim().toLowerCase() || 'value'} is sold out — the item shows as out of
                  stock in the customer app until one comes back.
                </p>
              )}
            </div>
          )
        })}

        {/* ── Which combinations you actually sell ──────────
            Two or more choices multiply: black may come in 41-45 while
            white comes in 44 and 45 only, and 43 in black may be
            finished this week. Everything starts on sale and the shop
            ticks the exceptions — the other way round would mean
            confirming dozens of combinations it does sell. */}
        {gridRows.length > 0 && gridCols.length > 0 && (
          <div className="rounded-lg border border-surface-border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                {gridRowGroup.label} × {gridColGroup.label}
              </p>
              <p className="text-[10px] text-slate-500">Click a cell: on sale → sold out → not sold</p>
            </div>

            {/* A third choice splits the grid into one page per value. */}
            {gridSliceGroup && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-slate-500 mr-1">{gridSliceGroup.label}:</span>
                {gridSliceGroup.values.map(v => (
                  <button key={v.name} type="button" onClick={() => setGridSlice(v.name)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                      gridSliceValue === v.name
                        ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                        : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                    {v.name}
                  </button>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                      {gridRowGroup.label}
                    </th>
                    {gridCols.map(c => (
                      <th key={c.name} className="px-1.5 py-1.5 text-[11px] text-slate-300 font-medium whitespace-nowrap">
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridRows.map(r => (
                    <tr key={r.name}>
                      <td className="px-2 py-1 text-[11px] text-slate-300 whitespace-nowrap">{r.name}</td>
                      {gridCols.map(c => {
                        const picks = {
                          [gridRowGroup.label]: r.name,
                          [gridColGroup.label]: c.name,
                          ...(gridSliceGroup && gridSliceValue ? { [gridSliceGroup.label]: gridSliceValue } : {}),
                        }
                        // A value switched off everywhere outranks the grid.
                        const off = r.sold_out || c.sold_out
                        const st = off ? 'sold_out' : comboAt(picks)
                        const look = COMBO_LOOK[st]
                        return (
                          <td key={c.name} className="px-1 py-1">
                            <button type="button" disabled={off}
                              onClick={() => cycleCombo(picks)}
                              title={off
                                ? 'This value is sold out everywhere'
                                : `${r.name} · ${c.name} — ${look.label}`}
                              className={`w-full min-w-[4.5rem] px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${look.cls} ${
                                off ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-125'}`}>
                              {look.label}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {gridTooBig && (
          <p className="text-[11px] text-amber-300/90">
            That is more than {MAX_COMBOS} combinations — too many to show as a grid. Per-value
            sold-out still works, so mark whole sizes or colours as finished instead.
          </p>
        )}

        <datalist id="option-presets">
          {OPTION_PRESETS.map(o => <option key={o} value={o} />)}
        </datalist>

        <p className="text-[10px] text-slate-500">
          Customers must pick one value from every option before they can add the item to their
          cart. Sold-out values stay visible but cannot be chosen.
        </p>
      </div>
    </>
  )
}
