/* Item options — the choices a shop offers on one product, and what each of
   them costs (supabase-fix129, fix130).

   fix106 hard-coded two of them, "colors" and "sizes", which fits a clothes
   shop and nothing else: a bakery sells flavours, a butcher sells weights, a
   phone shop sells storage. So the shop names the option itself, and each
   VALUE carries its own sold-out flag — size 43 can run out while 44 and 45
   stay on the shelf, which the single item-level stock figure could never say.

   Two kinds of option:

     choice   pick exactly one, required — Size, Color, Flavor
     extra    pick any number, optional, each adding to the price — food extras

   And availability is per COMBINATION, not only per value: black may come in
   41-45 while white comes in 44 and 45 only, and 43 in black may be finished
   this week. `combos` records the EXCEPTIONS — sold_out (offered, finished) and
   not_sold (never offered) — so a shop ticks the few it doesn't sell rather
   than confirming the many it does.

   Both sides of the app read items through these helpers, which understand the
   new columns and the old colours/sizes, so an item saved before any of this
   keeps working and nothing has to be re-entered. */

// What the option is called. Free text — these are only the quick picks.
export const OPTION_PRESETS = [
  'Size', 'Color', 'Flavor', 'Weight', 'Material', 'Length', 'Type', 'Capacity', 'Extras',
]

// 'swatch' = a photo tile per value (colours, patterns); 'chip' = a small pill.
export const OPTION_STYLES = [
  { key: 'chip',   label: 'Chips',   hint: 'Small pills — sizes, flavours, weights' },
  { key: 'swatch', label: 'Photos',  hint: 'A photo per value — colours, patterns' },
]

export const OPTION_KINDS = [
  { key: 'choice', label: 'Choose one', hint: 'The customer must pick exactly one' },
  { key: 'extra',  label: 'Extras',     hint: 'Optional add-ons, any number, each adds to the price' },
]

export const MAX_OPTIONS = 4
export const MAX_OPTION_VALUES = 24
// Above this many combinations the grid stops being something a person can
// read, so the editor offers per-value sold-out only.
export const MAX_COMBOS = 400

const str = v => String(v ?? '').trim()
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/* Which legacy column an option mirrors back into, so anything still reading
   `colors` / `sizes` keeps seeing what it expects. Matched on the label the
   shop typed, in the languages the customer app already speaks. */
const COLOR_WORDS = /^(colou?r|couleur|culoare|لون|اللون)$/i
const SIZE_WORDS  = /^(size|taille|marime|mărime|مقاس|المقاس|حجم)$/i
export const isColorOption = g => COLOR_WORDS.test(str(g?.label)) || (!g?.label && g?.style === 'swatch')
export const isSizeOption  = g => SIZE_WORDS.test(str(g?.label))

/* One option group, cleaned up. */
function cleanGroup(g) {
  const values = (Array.isArray(g?.values) ? g.values : [])
    .map(v => (typeof v === 'string'
      ? { name: str(v), image: null, sold_out: false, price_delta: 0 }
      : {
          name: str(v?.name),
          image: v?.image || null,
          sold_out: !!v?.sold_out,
          price_delta: num(v?.price_delta),
        }))
    .filter(v => v.name)
  return {
    label: str(g?.label) || 'Options',
    kind:  g?.kind === 'extra' ? 'extra' : 'choice',
    style: g?.style === 'swatch' ? 'swatch' : 'chip',
    values,
  }
}

/* Every option on an item, from `options` when it is there and from the old
   colours/sizes when it isn't. Groups with no values are dropped: an empty
   option is a question with no answers. */
export function itemOptions(item) {
  const raw = Array.isArray(item?.options) ? item.options : []
  if (raw.length) return raw.map(cleanGroup).filter(g => g.values.length)

  const out = []
  const colors = Array.isArray(item?.colors) ? item.colors : []
  const sizes  = Array.isArray(item?.sizes)  ? item.sizes  : []
  if (colors.length) out.push(cleanGroup({ label: 'Color', style: 'swatch', values: colors }))
  if (sizes.length)  out.push(cleanGroup({ label: 'Size',  style: 'chip',   values: sizes }))
  return out.filter(g => g.values.length)
}

export const choiceGroups = groups => groups.filter(g => g.kind !== 'extra')
export const extraGroups  = groups => groups.filter(g => g.kind === 'extra')

export const inStockValues = g => (g?.values ?? []).filter(v => !v.sold_out)

/* ── combinations ─────────────────────────────────────────────────────────
   `combos` is a list of exceptions: { picks: {Color:'Black', Size:'43'},
   state: 'sold_out' | 'not_sold' }. Anything not named is on sale. */

export const itemCombos = item => (Array.isArray(item?.combos) ? item.combos : [])
  .filter(c => c && c.picks && typeof c.picks === 'object')
  .map(c => ({ picks: c.picks, state: c.state === 'not_sold' ? 'not_sold' : 'sold_out' }))

/* Does an exception apply to these picks? It does when every option it names
   is picked the way it names it — so an exception about Black+43 says nothing
   while the colour is still unchosen. */
const comboApplies = (combo, picks) =>
  Object.entries(combo.picks).every(([label, value]) => str(picks[label]) === str(value))

/* The state of one candidate value, given what has been chosen so far.

   Judged over every combination still open: picking 43 is only possible if at
   least one colour still sells 43. So a size that is finished in black and
   never made in white is greyed out before a colour is chosen at all, rather
   than letting the customer pick it and discover the dead end afterwards.

   'not_sold' beats 'sold_out': a combination that is both never-sold and
   finished is simply not for sale. */
export function valueState(item, group, value, picks = {}) {
  if (value?.sold_out) return 'sold_out'
  const trial = { ...picks, [group.label]: value.name }

  const rows = matrixOf(item).filter(row =>
    Object.entries(trial).every(([label, v]) => !(label in row) || row[label] === v))
  if (rows.length === 0) return comboState(item, trial)

  let seenSoldOut = false
  for (const row of rows) {
    const st = comboState(item, { ...row, ...trial })
    if (st === 'available') return 'available'
    if (st === 'sold_out')  seenSoldOut = true
  }
  return seenSoldOut ? 'sold_out' : 'not_sold'
}

const matrixCache = new WeakMap()
function matrixOf(item) {
  if (!item || typeof item !== 'object') return []
  const hit = matrixCache.get(item)
  if (hit) return hit
  const rows = comboMatrix(itemOptions(item))
  matrixCache.set(item, rows)
  return rows
}

/* Every combination of the choice options, as [{ Color: 'Black', Size: '43' }].
   Used by the editor's grid and by the "is anything left?" test below. */
export function comboMatrix(groups) {
  const choices = choiceGroups(groups).filter(g => g.values.length)
  let rows = [{}]
  for (const g of choices) {
    const next = []
    for (const row of rows) {
      for (const v of g.values) next.push({ ...row, [g.label]: v.name })
    }
    rows = next
    if (rows.length > MAX_COMBOS) return rows.slice(0, MAX_COMBOS)
  }
  return choices.length ? rows : []
}

/* The state of a whole combination — what the grid cell shows. */
export function comboState(item, picks) {
  const groups = itemOptions(item)
  for (const g of choiceGroups(groups)) {
    const v = g.values.find(x => x.name === picks[g.label])
    if (v?.sold_out) return 'sold_out'
  }
  let state = 'available'
  for (const c of itemCombos(item)) {
    if (!comboApplies(c, picks)) continue
    if (c.state === 'not_sold') return 'not_sold'
    state = 'sold_out'
  }
  return state
}

/* Nothing left to buy: an option with no value on sale, or every combination
   ruled out. Both mean the customer is offered a choice they cannot complete,
   which has to read as out of stock rather than as a dead end. */
export function optionsExhausted(item) {
  const groups = Array.isArray(item) ? item : itemOptions(item)   // tolerate a bare group list
  const owner  = Array.isArray(item) ? { options: item } : item
  const choices = choiceGroups(groups).filter(g => g.values.length)
  if (choices.length === 0) return false
  if (choices.some(g => inStockValues(g).length === 0)) return true

  const matrix = comboMatrix(groups)
  if (!matrix.length) return false
  return matrix.every(picks => comboState(owner, picks) !== 'available')
}

/* Are all the required choices made, and still valid? Returns the first group
   that still needs an answer. Extras are optional and never block. */
export function missingChoice(groups = [], picks = {}, item = null) {
  const before = {}
  for (const g of choiceGroups(groups)) {
    if (g.values.length === 0) continue
    const chosen = str(picks[g.label])
    if (!chosen) return g
    if (item) {
      const v = g.values.find(x => x.name === chosen)
      // Judged against the EARLIER picks only. When a pair contradicts — white
      // with 43, which white never came in — the later choice is the one to
      // ask again, not the colour the customer just deliberately changed.
      if (!v || valueState(item, g, v, before) !== 'available') return g
    }
    before[g.label] = chosen
  }
  return null
}

/* Picks that a change elsewhere has invalidated — the customer chose 43, then
   switched to white, which doesn't come in 43. Cleared rather than silently
   carried into the cart. */
export function prunePicks(item, groups, picks) {
  const out = { ...picks }
  const before = {}
  for (const g of choiceGroups(groups)) {
    const chosen = str(out[g.label])
    if (!chosen) continue
    const v = g.values.find(x => x.name === chosen)
    if (!v || valueState(item, g, v, before) !== 'available') delete out[g.label]
    else before[g.label] = chosen
  }
  return out
}

/* ── extras ───────────────────────────────────────────────────────────────
   Picked as a list per group: { Extras: ['Cheese', 'Bacon'] }. */

export const pickedExtras = (g, picks) => (Array.isArray(picks?.[g.label]) ? picks[g.label] : [])

export function extrasTotal(groups = [], picks = {}) {
  let sum = 0
  for (const g of extraGroups(groups)) {
    for (const name of pickedExtras(g, picks)) {
      const v = g.values.find(x => x.name === name)
      if (v && !v.sold_out) sum += num(v.price_delta)
    }
  }
  return Math.round(sum * 100) / 100
}

/* "44 · Black + Cheese, Bacon" — what goes on the cart line and the order
   description, in the order the shop listed the options, which is the order it
   packs them. */
export function variantLabel(groups = [], picks = {}) {
  const chosen = choiceGroups(groups).map(g => str(picks[g.label])).filter(Boolean).join(' · ')
  const extras = extraGroups(groups).flatMap(g => pickedExtras(g, picks)).filter(Boolean).join(', ')
  return [chosen, extras && `+ ${extras}`].filter(Boolean).join(' ')
}

/* The chosen value's photo, when the option shows photos — the cart line then
   carries the picture the customer actually chose. */
export function pickedImage(groups = [], picks = {}) {
  for (const g of choiceGroups(groups)) {
    if (g.style !== 'swatch') continue
    const v = g.values.find(x => x.name === picks[g.label])
    if (v?.image) return v.image
  }
  return null
}

/* order_items has variant_color / variant_size from fix106. Options are free
   text now, so those columns are filled only when the shop's label really does
   mean colour or size; everything else lives in the line description. */
export function legacyVariantFields(groups = [], picks = {}) {
  let color = null
  let size  = null
  for (const g of choiceGroups(groups)) {
    const chosen = str(picks[g.label])
    if (!chosen) continue
    if (!color && isColorOption(g)) color = chosen
    else if (!size && isSizeOption(g)) size = chosen
  }
  return { color, size }
}

/* What to write back into the old columns when saving an item, so a reader
   that hasn't been updated — or an install without fix129 — still sees the
   choices. Sold-out values and extras are left out: they aren't a colour or a
   size on offer. */
export function legacyMirror(groups = []) {
  const choices = choiceGroups(groups)
  const colorGroup = choices.find(isColorOption) || choices.find(g => g.style === 'swatch')
  const sizeGroup  = choices.find(isSizeOption)  || choices.find(g => g.style === 'chip')
  return {
    colors: colorGroup ? inStockValues(colorGroup).map(v => ({ name: v.name, image: v.image || null })) : [],
    sizes:  sizeGroup  ? inStockValues(sizeGroup).map(v => v.name) : [],
  }
}
