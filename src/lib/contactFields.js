/* Shared definition of the per-type "extra" fields on a contact form, so the
   Contacts page and the quick "add contact" popup inside the order form render
   the exact same fields for customers / suppliers / partners. */

export const DEFAULT_BUSINESS_TYPES = ['supermarket', 'grocery', 'bakery', 'restaurant', 'sweets', 'flowers', 'other']

/* Type-specific fields beyond the shared name/contact/location block. */
export const CONTACT_EXTRA_FIELDS = {
  customer: [],
  supplier: [
    { key: 'supplier_code',    label: 'Supplier Code',        type: 'text',   placeholder: 'SUP-001' },
    { key: 'payment_terms',    label: 'Payment Terms (days)', type: 'number', placeholder: '30' },
    { key: 'shop_type',        label: 'Business Type',        type: 'select', placeholder: '— Select —', options: DEFAULT_BUSINESS_TYPES },
    { key: 'contact_category', label: 'Contact Category',     type: 'select', placeholder: '— Select —', options: [] },
  ],
  partner: [
    { key: 'partner_percentage', label: 'Commission %',     type: 'number', placeholder: '10' },
    { key: 'shop_type',          label: 'Business Type',    type: 'select', placeholder: '— Select —', options: DEFAULT_BUSINESS_TYPES },
    { key: 'contact_category',   label: 'Contact Category', type: 'select', placeholder: '— Select —', options: [] },
  ],
}

/* All type-specific keys — used to initialise/clear form state. */
export const CONTACT_EXTRA_KEYS = ['supplier_code', 'payment_terms', 'shop_type', 'contact_category', 'partner_percentage']

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

/* Build the contacts payload fragment for the type-specific fields. */
export function contactTypeExtras(type, form) {
  if (type === 'supplier') return {
    supplier_code:    form.supplier_code?.trim() || null,
    payment_terms:    Number(form.payment_terms) || null,
    shop_type:        form.shop_type?.trim() || null,
    contact_category: form.contact_category?.trim() || null,
  }
  if (type === 'partner') return {
    partner_percentage: Number(form.partner_percentage) || null,
    shop_type:          form.shop_type?.trim() || null,
    contact_category:   form.contact_category?.trim() || null,
  }
  return {}
}
