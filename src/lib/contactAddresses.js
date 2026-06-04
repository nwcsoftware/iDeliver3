import { supabase } from './supabase'

/**
 * Persist a contact's address list to contact_addresses.
 *
 * - Deletes removed rows (those in origIds but no longer present).
 * - Updates existing rows, inserts new ones.
 * - Writes latitude/longitude (collected from the map picker); existing
 *   coordinates round-trip because they are loaded into the rows on edit.
 * - Enforces a single primary by writing everything with is_primary=false
 *   first, then flipping the chosen row last (avoids the unique-index clash).
 *
 * Skips all DB work when there is nothing to write or delete, so contacts
 * without addresses don't depend on the contact_addresses table existing.
 *
 * Returns an error message string, or null on success.
 */
export async function saveContactAddresses({ contactId, addresses, origIds = [], companyId = null, userId = null }) {
  const valid    = addresses.filter(a => a.address_name?.trim())
  const keepIds  = valid.filter(a => a._id).map(a => a._id)
  const toDelete = origIds.filter(id => !keepIds.includes(id))

  if (valid.length === 0 && toDelete.length === 0) return null

  if (toDelete.length > 0) {
    const { error } = await supabase.from('contact_addresses').delete().in('id', toDelete)
    if (error) return error.message
  }

  let primaryId = null
  for (const a of valid) {
    const fields = {
      address_name: a.address_name.trim(),
      reference:    a.reference?.trim()     || null,
      address_line: a.address_line?.trim()  || null,
      city:         a.city?.trim()          || null,
      phone:        a.phone?.trim()          || null,
      notes:        a.notes?.trim()          || null,
      latitude:     a.latitude  ?? null,
      longitude:    a.longitude ?? null,
      is_primary:   false,
      updated_by:   userId,
    }
    let rowId = a._id
    if (a._id) {
      const { error } = await supabase.from('contact_addresses').update(fields).eq('id', a._id)
      if (error) return error.message
    } else {
      const { data, error } = await supabase.from('contact_addresses')
        .insert([{ contact_id: contactId, created_by: userId, ...(companyId ? { company_id: companyId } : {}), ...fields }])
        .select('id').single()
      if (error) return error.message
      rowId = data.id
    }
    if (a.is_primary && rowId) primaryId = rowId
  }

  if (primaryId) {
    const { error } = await supabase.from('contact_addresses').update({ is_primary: true }).eq('id', primaryId)
    if (error) return error.message
  }
  return null
}
