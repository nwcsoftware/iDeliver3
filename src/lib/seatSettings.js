import { supabase } from './supabase'
import { SEATS } from './billing'

/* SEATS, AS THE SUPER ADMIN SETS THEM (fix174).

   How many seats of each kind come free with the annual package, and what one
   more costs a year, used to be constants in billing.js. The super admin now
   sets both in App Settings (seat_settings, written only through
   super_admin_set_seat). Every place that counts or prices a seat reads them
   through here, with the constants as the fallback — so before fix174 is run,
   nothing changes.

   The shape is billing.js's SEATS, with `included` and `extraRate` replaced by
   the stored figures, so code written against SEATS reads it unchanged. A
   partner's PRICE is not here: it is the partner minimum (subscriptionPrices);
   only the number of free partner seats is. */

export const SEAT_FAMILIES = [
  { family: 'admin',       label: 'Administrators' },
  { family: 'call_center', label: 'Call centre & Senior Call Center' },
  { family: 'driver',      label: 'Drivers' },
  { family: 'partner',     label: 'Partners' },
]

const missing = (msg = '') => /seat_settings/i.test(msg) && /not exist|schema cache/i.test(msg)

export function mergeSeats(rows = []) {
  const seats = { ...SEATS }
  for (const r of rows || []) {
    if (!seats[r.family]) continue
    seats[r.family] = {
      ...seats[r.family],
      included:  Number.isFinite(Number(r.included)) ? Number(r.included) : seats[r.family].included,
      extraRate: r.family === 'partner' ? seats[r.family].extraRate : (Number(r.extra_rate) || seats[r.family].extraRate),
      currency:  r.currency || 'USD',
    }
  }
  return seats
}

/* { seats, installed, error } */
export async function fetchSeatSettings() {
  try {
    const { data, error } = await supabase.from('seat_settings').select('*')
    if (error) return { seats: SEATS, installed: false, error: missing(error.message) ? null : error.message }
    return { seats: mergeSeats(data), installed: true, error: null }
  } catch (e) {
    return { seats: SEATS, installed: false, error: e?.message || null }
  }
}

/* The super admin sets one kind's free seats and price. */
export async function setSeat(actorId, family, included, rate) {
  const { data, error } = await supabase.rpc('super_admin_set_seat', {
    p_actor_id: actorId, p_family: family, p_included: Number(included), p_rate: Number(rate),
  })
  if (error) {
    const m = error.message || ''
    if (/super_admin_set_seat/i.test(m) && /not exist|schema cache/i.test(m)) return { error: 'Seat settings need supabase-fix174.sql.' }
    if (/NOT_AUTHORIZED/.test(m)) return { error: 'Only the super admin can change the seats.' }
    if (/PRICE_REQUIRED/.test(m)) return { error: 'Enter a price above 0.' }
    return { error: m }
  }
  return { row: data, error: null }
}
