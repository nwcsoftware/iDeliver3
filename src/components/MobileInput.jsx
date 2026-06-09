import React from 'react'
import { MOBILE_PREFIX, isBlankMobile } from '../lib/phone'

/**
 * Controlled text input for Lebanese mobile numbers.
 * Pre-fills the "+961 " country code when focused empty, and clears back to ''
 * if the user leaves only the prefix (so required/uniqueness checks still work).
 *
 * Usage: <MobileInput value={form.mobile} onChange={v => setField('mobile', v)} />
 */
export default function MobileInput({
  value,
  onChange,
  className = 'input',
  placeholder = '+961 70 334 868',
  ...rest
}) {
  return (
    <input
      type="tel"
      inputMode="tel"
      className={className}
      placeholder={placeholder}
      value={value ?? ''}
      onFocus={() => { if (isBlankMobile(value)) onChange(MOBILE_PREFIX) }}
      onChange={e => onChange(e.target.value)}
      onBlur={() => { if (isBlankMobile(value)) onChange('') }}
      {...rest}
    />
  )
}
