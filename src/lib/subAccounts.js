import { supabase } from './supabase'
import { ACCOUNT_PREFIXES } from './accountNumber'

/**
 * A contact's account numbers (see supabase-fix81.sql).
 *
 * These are rows in sub_accounts — the Chart of Accounts table from section 5 of
 * supabase-schema.sql — so the column names here are ITS names, not new ones:
 *
 *   code          the account number
 *   name          the label ("Main", "Branch B")
 *   account_type  'cash' | 'credit'   (the existing enum already has both)
 *   currency      the limit's currency
 *   credit_limit  maximum outstanding amount. 0 or NULL = UNLIMITED.
 *   expires_on    null = NEVER expires
 *   is_primary    the contact's default account
 *
 * Every contact account hangs off the company's "CONTACTS" major account, since
 * sub_accounts.major_account_id is NOT NULL.
 *
 * Balances are per currency with no FX conversion anywhere in this app, so a
 * limit is only meaningful against one currency — each account carries its own.
 * current_balance on the row is never written: balances are derived live from
 * closed orders and settlements, so a stored copy would only drift.
 */

export const SUB_ACCOUNT_KINDS = ['cash', 'credit']
export const SUB_ACCOUNT_CURRENCIES = ['USD', 'LBP', 'EUR']

/** Code of the major account every contact account hangs off (created by fix81). */
const CONTACTS_MAJOR_CODE = 'CONTACTS'

/** Digits-only length of a generated account number (matches contacts.account_number). */
const NUMBER_LENGTH = 12
const MAX_GENERATION_ATTEMPTS = 25

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

/** Today as 'YYYY-MM-DD' in local time, for comparing against expires_on (a DATE). */
function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * An account is expired once its expires_on date has PASSED — it stays usable
 * throughout the expiry day itself. A null date never expires.
 */
export function isSubAccountExpired(a, asOf = todayYmd()) {
  const d = a?.expires_on ? String(a.expires_on).slice(0, 10) : null
  return d ? d < asOf : false
}

/** An account can take new charges when it's active and not expired. */
export function isSubAccountUsable(a, asOf = todayYmd()) {
  return !!a && a.is_active !== false && !isSubAccountExpired(a, asOf)
}

/** 0 or NULL means unlimited — there is no ceiling to check against. */
export function isUnlimited(a) {
  return !(Number(a?.credit_limit) > 0)
}

function randomDigits(prefix = '') {
  const head = String(prefix).replace(/\D/g, '').slice(0, NUMBER_LENGTH)
  const remaining = NUMBER_LENGTH - head.length
  const bytes = new Uint8Array(remaining)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < remaining; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = head
  for (let i = 0; i < remaining; i++) {
    out += (head.length === 0 && i === 0) ? String((bytes[i] % 9) + 1) : String(bytes[i] % 10)
  }
  return out
}

/**
 * Generate an account number for a new account, prefixed by contact type the
 * same way contacts.account_number is (customer 42 · supplier 34 · partner 60).
 *
 * Checked against BOTH sub_accounts.code and contacts.account_number: the two
 * share one number space (the backfill copies contact numbers into sub_accounts),
 * so a number free in one table but taken in the other is not actually free.
 */
export async function generateSubAccountNumber(contactType) {
  const prefix = ACCOUNT_PREFIXES[contactType] ?? ''
  let candidate = randomDigits(prefix)
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    candidate = randomDigits(prefix)
    const [{ data: subs, error: e1 }, { data: cons, error: e2 }] = await Promise.all([
      supabase.from('sub_accounts').select('id').eq('code', candidate).limit(1),
      supabase.from('contacts').select('id').eq('account_number', candidate).limit(1),
    ])
    if (e1) throw e1
    if (e2) throw e2
    if (!subs?.length && !cons?.length) return candidate
  }
  return candidate
}

/**
 * The company's "CONTACTS" major account id — the required parent for every
 * contact account (major_account_id is NOT NULL). Created by fix81, one per
 * company. Returns null when it's missing (i.e. fix81 hasn't been run).
 */
async function contactsMajorAccountId(companyId) {
  let q = supabase.from('major_accounts').select('id').eq('code', CONTACTS_MAJOR_CODE).limit(1)
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return data?.[0]?.id ?? null
}

/**
 * Load a contact's accounts, primary first, then oldest first.
 *
 * Maps the Chart of Accounts columns onto the form's shape. The two "unlimited"
 * values become BLANK fields rather than magic numbers, so the form reads as
 * "no limit" / "no expiry" instead of a limit that happens to be zero.
 */
export async function loadSubAccounts(contactId) {
  const { data, error } = await supabase
    .from('sub_accounts')
    .select('*')
    .eq('contact_id', contactId)
    .order('is_primary', { ascending: false })
    .order('created_at')
  if (error) return { rows: [], error: error.message }
  const rows = (data ?? []).map(a => ({
    _id: a.id,
    code:         a.code ?? '',
    name:         a.name ?? '',
    account_type: a.account_type || 'cash',
    currency:     a.currency || 'USD',
    credit_limit: Number(a.credit_limit) > 0 ? String(a.credit_limit) : '',
    expires_on:   a.expires_on ? String(a.expires_on).slice(0, 10) : '',
    is_primary:   !!a.is_primary,
    is_active:    a.is_active !== false,
    description:  a.description ?? '',
  }))
  return { rows, error: null }
}

/**
 * Persist a contact's account list (mirrors saveContactAddresses).
 *
 * - Deletes removed rows, updates existing ones, inserts new ones.
 * - Enforces a single primary by writing everything is_primary=false first and
 *   flipping the chosen row last, so the unique index never trips mid-save.
 * - Skips all DB work when there is nothing to write or delete, so contacts
 *   without accounts don't depend on fix81 having been run.
 *
 * Returns an error message string, or null on success.
 */
export async function saveSubAccounts({ contactId, accounts, origIds = [], companyId = null, userId = null }) {
  const valid    = (accounts ?? []).filter(a => String(a.code ?? '').trim())
  const keepIds  = valid.filter(a => a._id).map(a => a._id)
  const toDelete = origIds.filter(id => !keepIds.includes(id))

  if (valid.length === 0 && toDelete.length === 0) return null

  if (toDelete.length > 0) {
    const { error } = await supabase.from('sub_accounts').delete().in('id', toDelete)
    if (error) return error.message
  }

  // Only needed for inserts, but resolve once rather than per row.
  let majorId = null
  if (valid.some(a => !a._id)) {
    try {
      majorId = await contactsMajorAccountId(companyId)
    } catch (e) {
      return e?.message || 'Could not find the Contact Accounts chart-of-accounts entry.'
    }
    if (!majorId) {
      return 'The "Contact Accounts" major account is missing — run supabase-fix81.sql first.'
    }
  }

  let primaryId = null
  for (const a of valid) {
    const fields = {
      code:         String(a.code).replace(/\s/g, ''),
      name:         a.name?.trim() || 'Account',      // name is NOT NULL
      account_type: a.account_type === 'credit' ? 'credit' : 'cash',
      currency:     a.currency || 'USD',
      // Blank / 0 / nonsense all mean unlimited, stored as NULL.
      credit_limit: Number(a.credit_limit) > 0 ? round2(a.credit_limit) : null,
      expires_on:   a.expires_on ? a.expires_on : null,
      is_active:    a.is_active !== false,
      description:  a.description?.trim() || null,
      is_primary:   false,
      updated_at:   new Date().toISOString(),
    }
    let rowId = a._id
    if (a._id) {
      const { error } = await supabase.from('sub_accounts').update(fields).eq('id', a._id)
      if (error) return error.message
    } else {
      const { data, error } = await supabase.from('sub_accounts')
        .insert([{ contact_id: contactId, major_account_id: majorId, created_by: userId, ...fields }])
        .select('id').single()
      if (error) return error.message
      rowId = data.id
    }
    if (a.is_primary && rowId) primaryId = rowId
  }

  // No row was flagged primary (e.g. the primary was just deleted) → promote the
  // first, so "NULL sub_account_id = primary" always resolves to a real account.
  if (!primaryId && valid.length) {
    const first = valid.find(a => a._id) || valid[0]
    if (first?._id) primaryId = first._id
  }
  if (primaryId) {
    const { error } = await supabase.from('sub_accounts').update({ is_primary: true }).eq('id', primaryId)
    if (error) return error.message
  }
  return null
}

/**
 * Give a brand-new contact the same primary account the fix81 backfill gave
 * every existing one: its account_number as a primary account, unlimited and
 * never expiring, cash unless the contact is credit-allowed.
 *
 * Without this, contacts created after the migration would be the only ones with
 * no accounts at all — the backfill is a one-time catch-up, not a trigger.
 *
 * No-ops when the contact has no account number, or already has an account (the
 * user built one by hand on the Account Numbers tab). Failures are swallowed:
 * this must never block saving a contact, and the tab can add one later.
 *
 * Returns the created row (so callers holding an in-memory list can add it
 * without a refetch), or null when nothing was created.
 */
export async function ensurePrimarySubAccount({ contactId, accountNumber, creditAllowed = false, companyId = null, userId = null }) {
  const number = String(accountNumber ?? '').replace(/\s/g, '')
  if (!contactId || !number) return null
  try {
    const { data: existing } = await supabase
      .from('sub_accounts').select('id').eq('contact_id', contactId).limit(1)
    if (existing?.length) return null
    const majorId = await contactsMajorAccountId(companyId)
    if (!majorId) return null            // fix81 not run — the tab can add one later
    const { data } = await supabase.from('sub_accounts').insert([{
      major_account_id: majorId,
      contact_id:   contactId,
      code:         number,
      name:         'Main',
      account_type: creditAllowed ? 'credit' : 'cash',
      currency:     'USD',
      credit_limit: null,   // unlimited
      expires_on:   null,   // never expires
      is_primary:   true,
      is_active:    true,
      created_by:   userId,
      description:  'Created with the contact (fix81).',
    }]).select('*').single()
    return data ?? null
  } catch { /* contact is saved; the tab can add an account later */ }
  return null
}

/**
 * The account an order or payment belongs to. A NULL sub_account_id means the
 * contact's primary account — every row that predates fix81 is NULL, and the
 * backfill made each contact's existing number its primary, so historic data
 * resolves onto the account it already belonged to.
 */
export function resolveSubAccount(subAccountId, accounts) {
  const list = accounts ?? []
  if (subAccountId) return list.find(a => a.id === subAccountId) || null
  return list.find(a => a.is_primary) || list[0] || null
}

/**
 * Outstanding balance on one account, in that account's currency.
 *
 * Charges are the closed orders billed to it; payments are the credit
 * settlements applied to it. Both use resolveSubAccount, so untagged history
 * lands on the primary account rather than vanishing from every balance.
 *
 * Only amounts in the account's OWN currency count: balances are tracked per
 * currency with no FX rate anywhere in this app, so an LBP charge cannot be
 * measured against a USD limit and is deliberately not folded in.
 */
export function subAccountBalance({ account, orders = [], payments = [], accounts = [], orderTotal }) {
  if (!account) return 0
  const cur = account.currency || 'USD'
  let charged = 0
  for (const o of orders) {
    if (resolveSubAccount(o.sub_account_id, accounts)?.id !== account.id) continue
    charged += round2(orderTotal(o)[cur] || 0)
  }
  let paid = 0
  for (const p of payments) {
    if (resolveSubAccount(p.sub_account_id, accounts)?.id !== account.id) continue
    if ((p.currency || 'USD') !== cur) continue
    paid += round2(Number(p.amount) || 0)
  }
  return round2(charged - paid)
}

/**
 * Decide whether `amount` more may be charged to an account, and explain why not.
 * Returns { ok, reason } — reason is a user-facing sentence when ok is false.
 *
 * `amount` is the unpaid balance the order would leave behind, in `currency`.
 */
export function checkSubAccountCharge({ account, amount, currency, outstanding = 0 }) {
  if (!account) return { ok: true, reason: null }          // no account terms → nothing to enforce
  const owed = round2(amount)

  if (account.is_active === false) {
    return { ok: false, reason: `Account ${account.code} is inactive.` }
  }
  if (isSubAccountExpired(account)) {
    return { ok: false, reason: `Account ${account.code} expired on ${String(account.expires_on).slice(0, 10)}.` }
  }
  if (owed <= 0) return { ok: true, reason: null }         // nothing left owing → no limit to breach

  if (account.account_type !== 'credit') {
    return { ok: false, reason: `Account ${account.code} is a cash account — it must be paid in full to close.` }
  }
  if (isUnlimited(account)) return { ok: true, reason: null }

  // The limit is set in the account's currency, so it can only govern charges in
  // that currency. A charge in any other currency is outside its scope.
  const cur = account.currency || 'USD'
  if (currency !== cur) return { ok: true, reason: null }

  const limit = Number(account.credit_limit)
  const after = round2(outstanding + owed)
  if (after > limit) {
    return {
      ok: false,
      reason: `Over the credit limit on account ${account.code}: `
        + `${after.toLocaleString()} ${cur} would be owed against a ${limit.toLocaleString()} ${cur} limit `
        + `(${round2(outstanding).toLocaleString()} ${cur} already outstanding).`,
    }
  }
  return { ok: true, reason: null }
}
