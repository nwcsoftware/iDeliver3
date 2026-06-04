import { supabase } from './supabase'

/**
 * Generate the next 12-digit account number for a given contact type, client-side.
 * Strategy: take the highest existing account_number for that contact_type and
 * add 1, zero-padded to 12 digits (0000 0000 0000). Falls back to 1 when none exist.
 * Each contact_type (customer, supplier, …) keeps its own independent sequence.
 */
export async function generateAccountNumber(contactType) {
  const { data, error } = await supabase
    .from('contacts')
    .select('account_number')
    .eq('contact_type', contactType)
    .not('account_number', 'is', null)
    .order('account_number', { ascending: false })
    .limit(1)
  if (error) throw error

  const raw = data?.[0]?.account_number
  const maxNum = raw ? parseInt(String(raw).replace(/\D/g, ''), 10) : 0
  const next = (Number.isFinite(maxNum) ? maxNum : 0) + 1
  return String(next).padStart(12, '0')
}

/** Backwards-compatible helper for customer account numbers. */
export function generateCustomerAccountNumber() {
  return generateAccountNumber('customer')
}

/** Display a stored account number grouped in fours: 0000 0000 0000 */
export function formatAccountNumber(v) {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}
