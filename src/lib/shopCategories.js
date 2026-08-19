import { supabase } from './supabase'

/* Shop item categories — the tag list suppliers pick from when stocking their
   shop, and what the customer app filters by.

   This is deliberately SEPARATE from the admin `product_categories` used by the
   internal Products catalog: shop categories describe a storefront (Food,
   Electronics, Tools & Hardware…), and the super admin curates them from
   Settings → Shop Categories.

   DEFAULT_SHOP_CATEGORIES below is the seed list — supabase-fix104.sql inserts
   it into the `shop_categories` table, and it is also the fallback used when
   that table is empty or missing, so the item form is never left with nothing
   to pick from. */

export const DEFAULT_SHOP_CATEGORIES = [
  'Food & Beverages',
  'Restaurants & Takeaway',
  'Bakery & Sweets',
  'Fruits & Vegetables',
  'Meat & Poultry',
  'Fish & Seafood',
  'Dairy & Eggs',
  'Grocery & Supermarket',
  'Frozen Foods',
  'Snacks & Confectionery',
  'Coffee & Tea',
  'Water & Soft Drinks',
  'Health & Pharmacy',
  'Beauty & Personal Care',
  'Baby & Kids',
  'Household & Cleaning',
  'Home & Kitchen',
  'Furniture & Decor',
  'Tools & Hardware',
  'Building Materials',
  'Garden & Outdoor',
  'Electronics',
  'Mobile Phones & Accessories',
  'Computers & Accessories',
  'Gaming',
  'Fashion & Clothing',
  'Shoes & Bags',
  'Watches & Jewelry',
  'Sports & Fitness',
  'Toys & Games',
  'Books & Stationery',
  'Pet Supplies',
  'Automotive & Parts',
  'Flowers & Gifts',
  'Other',
]

/* Active categories, ordered. Returns { rows, usedFallback }:
   `rows` are { id, name } — id is null for fallback entries (nothing to delete
   in the DB yet). Never throws; a missing table just yields the defaults. */
export async function fetchShopCategories(companyId = null) {
  try {
    let q = supabase.from('shop_categories').select('id,name,sort_order,company_id').eq('is_active', true)
    // The seeded defaults (fix104) carry company_id NULL, meaning "shared by
    // every company" — and NULL never equals anything in SQL, so filtering on
    // the company alone hid all 35 of them and the page fell back to the
    // built-in list. Shared rows plus this company's own is what we want.
    if (companyId) q = q.or(`company_id.eq.${companyId},company_id.is.null`)
    const { data, error } = await q
    if (error || !data || data.length === 0) return { rows: fallbackRows(), usedFallback: true }
    // A company may add a category that duplicates a shared one by name; its own
    // row wins so renaming or removing it behaves as expected.
    const byName = new Map()
    for (const r of data) {
      const key = String(r.name || '').trim().toLowerCase()
      const kept = byName.get(key)
      if (!kept || (!kept.company_id && r.company_id)) byName.set(key, r)
    }
    const rows = [...byName.values()].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)))
    return { rows: rows.map(r => ({ id: r.id, name: r.name })), usedFallback: false }
  } catch {
    return { rows: fallbackRows(), usedFallback: true }
  }
}

function fallbackRows() {
  return DEFAULT_SHOP_CATEGORIES.map(name => ({ id: null, name }))
}

/* Just the names — what the item form needs. */
export async function fetchShopCategoryNames(companyId = null) {
  const { rows } = await fetchShopCategories(companyId)
  return rows.map(r => r.name)
}

/* Add a category. Returns an error message, or null on success. */
export async function addShopCategory(name, { companyId = null, sortOrder = null } = {}) {
  const clean = String(name ?? '').trim()
  if (!clean) return 'Enter a category name.'
  const { error } = await supabase.from('shop_categories').insert([{
    name: clean,
    is_active: true,
    ...(sortOrder != null ? { sort_order: sortOrder } : {}),
    ...(companyId ? { company_id: companyId } : {}),
  }])
  if (error) {
    return error.message.includes('duplicate key')
      ? 'That category already exists.'
      : error.message
  }
  return null
}

/* Remove a category. Items already tagged with it keep their tag — the tag is
   stored as text on the item, so deleting only stops it being offered. */
export async function deleteShopCategory(id) {
  const { error } = await supabase.from('shop_categories').delete().eq('id', id)
  return error ? error.message : null
}

/* Re-insert any missing default categories (used by "Restore defaults"). */
export async function restoreDefaultShopCategories(companyId = null) {
  const { rows } = await fetchShopCategories(companyId)
  const have = new Set(rows.map(r => r.name.toLowerCase()))
  const missing = DEFAULT_SHOP_CATEGORIES
    .map((name, i) => ({ name, sort_order: i }))
    .filter(c => !have.has(c.name.toLowerCase()))
  if (missing.length === 0) return null
  const { error } = await supabase.from('shop_categories').insert(
    missing.map(c => ({ ...c, is_active: true, ...(companyId ? { company_id: companyId } : {}) })))
  return error ? error.message : null
}
