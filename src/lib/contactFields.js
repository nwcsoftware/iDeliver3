/* Shared definition of the per-type "extra" fields on a contact form, so the
   Contacts page and the quick "add contact" popup inside the order form render
   the exact same fields for customers / suppliers / partners. */

/* What kind of shop a supplier/partner runs. Drives the shop-type strip in the
   customer app, so every value here needs an icon in SHOP_TYPE_META there.
   Users may still add their own (persisted in business_types); anything unknown
   simply falls back to a generic shop icon. */
export const DEFAULT_BUSINESS_TYPES = [
  'restaurant', 'fast food', 'cafe', 'sweets', 'bakery', 'butcher',
  'supermarket', 'grocery', 'fruits & vegetables',
  'pharmacy', 'beauty & cosmetics', 'flowers & gifts',
  'tools & hardware', 'power tools', 'electronics', 'mobile & accessories',
  'sportswear', 'gym equipment', 'bicycles',
  'home & furniture', 'toys & kids', 'pet supplies',
  'stationery & books', 'auto parts', 'watches & jewellery',
  'other',
]

/* How a supplier/partner's commission % is applied to an order line:
   addition  → added on top of the line price (the shop earns above the price)
   deduction → taken off the line price (the shop's cut comes out of it) */
export const COMMISSION_TYPE_OPTIONS = [
  { value: 'addition',  label: 'Addition percentage (added on top)' },
  { value: 'deduction', label: 'Deduction percentage (taken off)' },
]

/* Readable label for a stored partner_percentage_type value. */
export function commissionTypeLabel(v) {
  return COMMISSION_TYPE_OPTIONS.find(o => o.value === v)?.label ?? (v || '')
}

/* Every non-driver contact type (customer/supplier/partner) shares ONE form —
   the former Partner form: Commission %, Business Type, Contact Category. */
const GENERAL_EXTRA_FIELDS = [
  { key: 'partner_percentage',      label: 'Commission %',    type: 'number', placeholder: '10' },
  { key: 'partner_percentage_type', label: 'Commission Type', type: 'select', placeholder: '— Select —', options: COMMISSION_TYPE_OPTIONS },
  { key: 'shop_type',          label: 'Business Type',    type: 'select', placeholder: '— Select —', options: DEFAULT_BUSINESS_TYPES },
  { key: 'contact_category',   label: 'Contact Category', type: 'select', placeholder: '— Select —', options: [] },
]

export const CONTACT_EXTRA_FIELDS = {
  customer: GENERAL_EXTRA_FIELDS,
  supplier: GENERAL_EXTRA_FIELDS,
  partner:  GENERAL_EXTRA_FIELDS,
}

/* All type-specific keys — used to initialise/clear form state. */
export const CONTACT_EXTRA_KEYS = ['shop_type', 'contact_category', 'partner_percentage', 'partner_percentage_type']

/* Enrich the addable lookup selects (business type, contact category) with their
   live options and an inline "add new" handler. `addBusinessType` /
   `addContactCategory` are async (name) => savedName|null. */
export function buildContactExtraFields(type, { businessTypes = [], contactCategories = [], addBusinessType, addContactCategory } = {}) {
  const ADDABLE = {
    shop_type:        { defaults: DEFAULT_BUSINESS_TYPES, current: businessTypes,     add: addBusinessType,    placeholder: 'New business type' },
    contact_category: { defaults: [],                     current: contactCategories, add: addContactCategory, placeholder: 'New contact category' },
  }
  return (CONTACT_EXTRA_FIELDS[type] || []).map(ef => {
    const a = ADDABLE[ef.key]
    if (!a || !a.add) return ef
    return { ...ef, options: [...new Set([...a.defaults, ...a.current])], addable: true, addPlaceholder: a.placeholder, onAddOption: a.add }
  })
}

/* Build the contacts payload fragment for the shared form fields. Saved for
   every non-driver contact type (customer/supplier/partner). */
export function contactTypeExtras(_type, form) {
  return {
    partner_percentage:      Number(form.partner_percentage) || null,
    partner_percentage_type: form.partner_percentage_type?.trim() || null,
    shop_type:               form.shop_type?.trim() || null,
    contact_category:        form.contact_category?.trim() || null,
  }
}
