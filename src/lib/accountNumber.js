import { supabase } from './supabase'

/** How many digits every generated account number has (3 groups of 4 → "5821 6547 5917"). */
const ACCOUNT_NUMBER_LENGTH = 12
/** Safety cap on regeneration attempts when a random number collides with an existing one. */
const MAX_GENERATION_ATTEMPTS = 25

/**
 * Fixed 2-digit prefix each account category starts with, so the leading digits
 * identify the kind of account at a glance:
 *   customer 42 · supplier 34 · partner 60 · driver 40 · vehicle 58
 */
export const ACCOUNT_PREFIXES = {
  customer: '42',
  supplier: '34',
  partner:  '60',
  driver:   '40',
  vehicle:  '58',
}

/**
 * Generate a random ACCOUNT_NUMBER_LENGTH-digit string that starts with `prefix`.
 * The prefix occupies the leading digits and the rest are random 0–9, so e.g.
 * prefix "58" → "582165475917". Uses crypto when available.
 */
function randomAccountDigits(prefix = '') {
  const head = String(prefix).replace(/\D/g, '').slice(0, ACCOUNT_NUMBER_LENGTH)
  const remaining = ACCOUNT_NUMBER_LENGTH - head.length
  const bytes = new Uint8Array(remaining)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < remaining; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = head
  for (let i = 0; i < remaining; i++) {
    // When there is no prefix, force the first digit to 1–9 so it stays 12 digits.
    out += (head.length === 0 && i === 0) ? String((bytes[i] % 9) + 1) : String(bytes[i] % 10)
  }
  return out
}

/**
 * Generate a random unique account number (starting with `prefix`) for the given
 * table/column. Tries random numbers, checking the DB for collisions, until it
 * finds an unused one (or exhausts MAX_GENERATION_ATTEMPTS, after which it
 * returns the last candidate — collisions at 12 digits are extremely unlikely).
 */
async function generateUniqueNumber(table, column, prefix) {
  let candidate = randomAccountDigits(prefix)
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    candidate = randomAccountDigits(prefix)
    const { data, error } = await supabase.from(table).select(column).eq(column, candidate).limit(1)
    if (error) throw error
    if (!data || data.length === 0) return candidate   // no collision → unique
  }
  return candidate
}

/**
 * Generate a unique random 12-digit account number for a contact, prefixed by
 * the contact type (customer 42 · supplier 34 · partner 60 · driver 40).
 * Account numbers are unique across the whole contacts table.
 */
export async function generateAccountNumber(contactType) {
  return generateUniqueNumber('contacts', 'account_number', ACCOUNT_PREFIXES[contactType] ?? '')
}

/** Backwards-compatible helper for customer account numbers (prefix 42). */
export function generateCustomerAccountNumber() {
  return generateAccountNumber('customer')
}

/**
 * Save-time guard against duplicate account numbers. The number is usually
 * generated when a contact form opens, then saved later — by which point another
 * record could have taken it (or it may be blank). This re-checks the candidate
 * against the contacts table and, if it's empty or already in use, returns a
 * freshly generated unique number for the given contact type. Call this right
 * before inserting a NEW contact.
 */
export async function ensureUniqueAccountNumber(candidate, contactType) {
  const v = String(candidate ?? '').replace(/\D/g, '')
  if (v) {
    const { data, error } = await supabase.from('contacts').select('id').eq('account_number', v).limit(1)
    if (error) throw error
    if (!data || data.length === 0) return v   // still free → keep it
  }
  // Blank or already taken → generate a new collision-checked number.
  return generateAccountNumber(contactType)
}

/**
 * Generate a unique random 12-digit vehicle account number (prefix 58).
 * Checks the whole vehicles table (across companies) for collisions and
 * regenerates on conflict, so the number is globally unique.
 * `companyId` is accepted for call-site compatibility but intentionally unused.
 */
export async function generateVehicleAccountNumber(/* companyId */) {
  return generateUniqueNumber('vehicles', 'vehicle_account_number', ACCOUNT_PREFIXES.vehicle)
}

/**
 * Generate the next vehicle asset code in the format "VEH-XXX".
 * Queries the highest existing asset_code matching VEH-<digits>,
 * extracts the numeric suffix, increments by 1, and zero-pads to 3 digits.
 * Falls back to "VEH-001" when no codes exist.
 */
export async function generateVehicleCode(companyId) {
  let q = supabase
    .from('vehicles')
    .select('asset_code')
    .ilike('asset_code', 'VEH-%')
    .order('asset_code', { ascending: false })
    .limit(1)

  if (companyId) q = q.eq('company_id', companyId)

  const { data, error } = await q
  if (error) throw error

  const raw = data?.[0]?.asset_code
  const match = raw ? String(raw).match(/VEH-(\d+)/i) : null
  const maxNum = match ? parseInt(match[1], 10) : 0
  const next = (Number.isFinite(maxNum) ? maxNum : 0) + 1
  return `VEH-${String(next).padStart(3, '0')}`
}

/** Display a stored account number grouped in fours: 0000 0000 0000 */
export function formatAccountNumber(v) {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

/**
 * Human-readable contact code prefix per contact type (mirrors the DB trigger):
 *   customer CST · supplier SUP · partner PTN · driver DRV · employee EMP · contractor CON
 */
export const CONTACT_CODE_PREFIXES = {
  customer:   'CST',
  supplier:   'SUP',
  partner:    'PTN',
  driver:     'DRV',
  employee:   'EMP',
  contractor: 'CON',
}

/**
 * Generate a unique contact `code` (e.g. "PTN-000012") on the client and return
 * it, so it can be sent with the insert. Providing a code bypasses the DB
 * generate_contact_code trigger (which only runs when code IS NULL) and avoids
 * the historical COUNT-based duplicate-key collisions. Uniqueness is verified
 * against the contacts table, incrementing until an unused code is found.
 */
export async function generateContactCode(contactType) {
  const prefix = CONTACT_CODE_PREFIXES[contactType] || 'OTH'
  // Highest numeric suffix currently used for this prefix.
  const { data, error } = await supabase.from('contacts').select('code').like('code', `${prefix}-%`)
  if (error) throw error
  let max = 0
  for (const r of (data || [])) {
    const m = String(r.code || '').match(/(\d+)$/)
    if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > max) max = n }
  }
  let seq = max + 1
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = `${prefix}-${String(seq).padStart(6, '0')}`
    const { data: hit, error: e2 } = await supabase.from('contacts').select('id').eq('code', candidate).limit(1)
    if (e2) throw e2
    if (!hit || hit.length === 0) return candidate
    seq++
  }
  return `${prefix}-${String(seq).padStart(6, '0')}`
}
