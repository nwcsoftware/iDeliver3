import { supabase } from './supabase'
import { todayStr, daysUntilDate } from './subscriptions'

/* The subscription agreement a supplier / partner accepts before the portal
   opens for them (supabase-fix128.sql).

   Signing in proves who they are; this proves they know what they are signing
   up to. Until they accept, the portal shows the agreement and nothing else —
   and if they decline, the office sees that on the Subscriptions page rather
   than being left to wonder why the shop went quiet.

   Everything shown here is COPIED INTO THE ROW when they answer: the prices,
   the trial length, the wording. An agreement records what someone accepted on
   a given day, so it must not silently re-write itself when the price list
   changes. Raising the prices later means publishing v2 — which asks everyone
   again — not editing v1 under their feet. */

export const AGREEMENT_VERSION = 'v1'

/* The published plans. Change a price here and you are changing what NEW
   signatures record; anyone who already agreed keeps the figures they saw. */
export const SUBSCRIPTION_PLANS = [
  { key: 'basic',   name: 'Basic',   price: 10, blurb: 'Your shop, your orders and your statement.' },
  { key: 'pro',     name: 'Pro',     price: 18, blurb: 'Everything in Basic, with the wider shop listing.' },
  { key: 'pro_max', name: 'Pro Max', price: 25, blurb: 'Everything in Pro, with priority placement and support.' },
]
export const PLAN_CURRENCY = 'USD'
export const DEFAULT_PLAN  = 'basic'
export const TRIAL_PLAN_DAYS = 90

export const planByKey = (key) =>
  SUBSCRIPTION_PLANS.find(p => p.key === key) || SUBSCRIPTION_PLANS[0]

const dmy = (d) => {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : String(d)
}

/* The agreement in plain words. Kept as one function so the text shown on
   screen and the text stored on the row can never disagree — the row is filled
   from this. */
export function agreementText({ trialEndsOn = null, planKey = DEFAULT_PLAN } = {}) {
  const plan = planByKey(planKey)
  const prices = SUBSCRIPTION_PLANS
    .map(p => `${p.name} ${p.price} ${PLAN_CURRENCY}/month`)
    .join(', ')
  const trial = trialEndsOn
    ? `The first ${TRIAL_PLAN_DAYS} days are free, ending ${dmy(trialEndsOn)}.`
    : `The first ${TRIAL_PLAN_DAYS} days are free.`
  return [
    `Subscription agreement (${AGREEMENT_VERSION}).`,
    `I agree to subscribe to the 3asari3 partner service and to pay the monthly subscription fee for my plan: ${prices}.`,
    `I am on the ${plan.name} plan at ${plan.price} ${PLAN_CURRENCY} per month. ${trial}`,
    `When the free period ends the monthly fee for my plan becomes payable, monthly in advance, until I ask to stop.`,
    `I may move to another plan by asking the office; the new fee applies from the next period.`,
    `If the fee is not settled my access can be suspended until it is.`,
  ].join('\n')
}

export const AGREEMENT_STATUS = {
  pending:  { label: 'Pending',  cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  agreed:   { label: 'Agreed',   cls: 'bg-green-500/10 text-green-300 border-green-500/30' },
  rejected: { label: 'Rejected', cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
}

const tableMissing = (err) =>
  !!err && /subscription_agreements/i.test(err.message || '') && /not exist|schema cache/i.test(err.message || '')

/* Where one contact stands. `missing` means the migration hasn't been run —
   the caller must treat that as "let them through", exactly as the sign-in
   check does, so an unrun migration can never lock the portal. */
export async function fetchAgreement(contactId, version = AGREEMENT_VERSION) {
  if (!contactId) return { row: null, status: 'pending', missing: false, error: null }
  try {
    const { data, error } = await supabase
      .from('subscription_agreements')
      .select('*')
      .eq('contact_id', contactId)
      .eq('version', version)
      .maybeSingle()
    if (error) return { row: null, status: 'pending', missing: tableMissing(error), error: error.message }
    return { row: data ?? null, status: data?.status || 'pending', missing: false, error: null }
  } catch (e) {
    return { row: null, status: 'pending', missing: false, error: e?.message || 'Could not read the agreement.' }
  }
}

/* Record an answer. Upserts on (contact_id, version): declining and later
   accepting updates the one row instead of leaving two contradictory ones. */
export async function saveAgreement(contactId, status, {
  version = AGREEMENT_VERSION,
  companyId = null,
  userId = null,
  userName = null,
  device = null,
  note = null,
  planKey = DEFAULT_PLAN,
  trialEndsOn = null,
} = {}) {
  if (!contactId) return { error: 'No contact.' }
  const plans = Object.fromEntries(SUBSCRIPTION_PLANS.map(p => [p.key, p.price]))
  try {
    const { error } = await supabase
      .from('subscription_agreements')
      .upsert({
        contact_id:     contactId,
        version,
        status,
        responded_at:   new Date().toISOString(),
        responded_by:   userId,
        responded_name: userName,
        device,
        note:           note?.trim() || null,
        plan:           planKey,
        basic_price:    plans.basic ?? null,
        pro_price:      plans.pro ?? null,
        pro_max_price:  plans.pro_max ?? null,
        currency:       PLAN_CURRENCY,
        trial_days:     TRIAL_PLAN_DAYS,
        trial_ends_on:  trialEndsOn || null,
        agreement_text: agreementText({ trialEndsOn, planKey }),
        updated_at:     new Date().toISOString(),
        ...(companyId ? { company_id: companyId } : {}),
      }, { onConflict: 'contact_id,version' })
    return { error: error ? error.message : null }
  } catch (e) {
    return { error: e?.message || 'Could not save your answer.' }
  }
}

/* Every answer on file, as { contactId → row }, for the office list. Returns an
   empty map (not an error) when the migration hasn't been run, so the
   Subscriptions page still works without it. */
export async function fetchAgreementMap(version = AGREEMENT_VERSION) {
  try {
    const { data, error } = await supabase
      .from('subscription_agreements')
      .select('*')                 // whole row: the PDF prints what was accepted
      .eq('version', version)
    if (error) return { map: new Map(), missing: tableMissing(error), error: error.message }
    const map = new Map()
    for (const r of data ?? []) map.set(r.contact_id, r)
    return { map, missing: false, error: null }
  } catch {
    return { map: new Map(), missing: false, error: null }
  }
}

/* The free period this contact is actually on, read from their subscriptions,
   so the agreement can name a real date rather than "90 days from whenever". */
export async function fetchTrialEnd(contactId) {
  if (!contactId) return null
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('end_date, amount, is_paid, is_active')
      .eq('contact_id', contactId)
    if (error) return null
    const today = todayStr()
    const covering = (data ?? [])
      .filter(r => r.is_paid && r.is_active && r.end_date && r.end_date >= today)
      .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)))
    const free = covering.filter(r => Number(r.amount) === 0).pop()
    return free?.end_date || covering.pop()?.end_date || null
  } catch {
    return null
  }
}

export const daysToTrialEnd = (endDate) => daysUntilDate(endDate)

/* The subscriber's own details, for the agreement document. Small enough to ask
   for on its own rather than threading a contact record through the portal. */
export async function fetchAgreementParty(contactId) {
  if (!contactId) return null
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, code, company_name, first_name, last_name, mobile')
      .eq('id', contactId)
      .maybeSingle()
    return error ? null : (data ?? null)
  } catch {
    return null
  }
}
