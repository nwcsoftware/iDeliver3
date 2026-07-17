import { supabase, fetchAllRows } from './supabase'

/* Serial product codes: PRD-0001 / SRV-0001 / RTN-0001 / ADD-0001.

   Mirrors the contacts approach in accountNumber.js — generate the code on the
   client, verify it against the table, and retry on the duplicate-key error a
   concurrent save can still cause. Each prefix runs its own sequence. */

/** Safety cap on regeneration attempts when a candidate collides. */
const MAX_GENERATION_ATTEMPTS = 25
/** Digits in the numeric suffix — matches the existing PRD-0001 … PRD-0008 rows. */
const CODE_DIGITS = 4

export const PRODUCT_CODE_PREFIXES = {
  retail:        'PRD',
  returnable:    'RTN',
  service:       'SRV',
  advertisement: 'ADD',
}

/** Kinds that carry stock. A service is never stored; an advert isn't goods. */
export const STOCKED_KINDS = ['retail', 'returnable']
export const isStockedKind = kind => STOCKED_KINDS.includes(kind)
/** True when this product's stock should move / be shown at all. */
export const productIsStocked = form => isStockedKind(productKind(form))

/** The four kinds, in the order the form offers them. */
export const PRODUCT_KINDS = [
  { value: 'retail',        flag: 'is_retail',        label: 'Retail',        color: 'purple' },
  { value: 'returnable',    flag: 'is_returnable',    label: 'Returnable',    color: 'amber'  },
  { value: 'service',       flag: 'is_service',       label: 'Service',       color: 'cyan'   },
  { value: 'advertisement', flag: 'is_advertisement', label: 'Advertisement', color: 'purple' },
]

/**
 * An item's kind from its flags. Exactly one flag is set by the form, but older
 * rows can carry several — resolve deterministically, most specific first, so a
 * legacy row never lands on a different prefix from one read to the next.
 */
export function productKind(form) {
  if (form?.is_service)       return 'service'
  if (form?.is_advertisement) return 'advertisement'
  if (form?.is_returnable)    return 'returnable'
  return 'retail'
}

/** Flags for a kind, with the other three cleared — kind is a single choice. */
export function kindFlags(kind) {
  return Object.fromEntries(PRODUCT_KINDS.map(k => [k.flag, k.value === kind]))
}

export const codePrefix = form => PRODUCT_CODE_PREFIXES[productKind(form)]

/** True once a code already looks like one of ours, for the given prefix. */
export const codeMatchesPrefix = (code, prefix) =>
  new RegExp(`^${prefix}-\\d+$`).test(String(code || '').trim())

/**
 * Next unused code for a kind, e.g. "SRV-0003". Scans the highest numeric suffix
 * in use for that prefix and counts up from it, checking each candidate against
 * the table. `minSeq` lets a caller restart above a code that just collided.
 *
 * Paged: a plain select truncates at 1000 rows, which would silently restart the
 * sequence low and hand out a duplicate.
 */
export async function generateProductCode(kind = 'retail', minSeq = 0) {
  const prefix = PRODUCT_CODE_PREFIXES[kind] || PRODUCT_CODE_PREFIXES.retail
  const { data, error } = await fetchAllRows(() =>
    supabase.from('products').select('code').like('code', `${prefix}-%`))
  if (error) throw error

  let max = minSeq
  for (const r of (data || [])) {
    const m = String(r.code || '').match(/(\d+)$/)
    if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > max) max = n }
  }

  let seq = max + 1
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = `${prefix}-${String(seq).padStart(CODE_DIGITS, '0')}`
    const { data: hit, error: e2 } = await supabase.from('products').select('id').eq('code', candidate).limit(1)
    if (e2) throw e2
    if (!hit || hit.length === 0) return candidate
    seq++
  }
  return `${prefix}-${String(seq).padStart(CODE_DIGITS, '0')}`
}

/** True when a Supabase error is a duplicate-key violation on products.code. */
function isDuplicateProductCode(err) {
  if (!err) return false
  const text = `${err.code ?? ''} ${err.message ?? ''} ${err.details ?? ''}`
  return err.code === '23505' || /products_code_key/i.test(text)
}

/**
 * Insert a NEW product, guaranteeing a unique `code`. A code generated moments
 * before the insert can still be taken by a concurrent save, which surfaces as a
 * duplicate-key error — on that specific error we generate a fresh code starting
 * above the one that clashed and retry. Any other error is returned untouched.
 *
 * `onProgress(text)` is called as it works, so the caller can show the user what
 * is happening instead of leaving the button dead.
 *
 * Returns Supabase's { data, error } for the inserted row.
 */
export async function insertProductWithUniqueCode(payload, kind, { onProgress } = {}) {
  let body = { ...payload }
  let lastResult = null

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    if (!body.code) {
      onProgress?.(attempt === 0 ? 'Generating code…' : 'Code taken — generating a new one…')
      try { body = { ...body, code: await generateProductCode(kind) } } catch { /* retry below */ }
    }
    onProgress?.(`Saving ${body.code || 'item'}…`)
    lastResult = await supabase.from('products').insert([body]).select('id, code').single()
    if (!isDuplicateProductCode(lastResult.error)) return lastResult

    // Collided → regenerate past the clash and try again.
    const clashed = String(body.code || '').match(/(\d+)$/)
    const minSeq = clashed ? parseInt(clashed[1], 10) : 0
    body = { ...body, code: null }
    try { body.code = await generateProductCode(kind, minSeq) } catch { /* next pass regenerates */ }
  }
  return lastResult
}
