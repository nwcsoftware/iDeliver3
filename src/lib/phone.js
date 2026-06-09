// Lebanese mobile number helpers — display formatting + input default (+961).

export const COUNTRY_CODE = '+961'
export const MOBILE_PREFIX = '+961 '

/**
 * Format a mobile number for display as "+961 70 334 868".
 * Accepts any stored form (raw digits, leading 0, 961/+961 prefix, already spaced).
 * Falls back to a best-effort "+961 <digits>" (or the original) for odd lengths.
 */
export function formatMobile(value) {
  if (value == null || value === '') return ''
  const raw = String(value).trim()
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('961')) digits = digits.slice(3)
  digits = digits.replace(/^0+/, '')
  if (digits.length === 8) return `+961 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`
  if (digits.length === 7) return `+961 ${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4)}`
  if (!digits) return raw
  return `+961 ${digits}`
}

/** True when a value is empty or only the country code (no local number entered yet). */
export function isBlankMobile(value) {
  const d = String(value ?? '').replace(/\D/g, '')
  return d === '' || d === '961'
}
