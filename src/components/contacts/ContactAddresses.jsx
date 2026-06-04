import React, { useState } from 'react'
import { Plus, Trash2, MapPin, Star, Map } from 'lucide-react'
import MapPicker from './MapPicker'

/**
 * Editable list of a contact's addresses. The parent owns the array and
 * persists it on save. GPS coordinates are not edited here — they are filled
 * in later by the application.
 *
 * Props:
 *   addresses    - array of address objects
 *   setAddresses - state setter (accepts value or updater fn)
 */
export default function ContactAddresses({ addresses, setAddresses }) {
  const [pickerIndex, setPickerIndex] = useState(null)

  // Apply coordinates + place name collected from the map to the active row.
  function confirmPicker({ latitude, longitude, address_line }) {
    setAddresses(a => {
      if (pickerIndex == null) return a
      const n = [...a]
      n[pickerIndex] = {
        ...n[pickerIndex],
        latitude, longitude,
        address_line: address_line || n[pickerIndex].address_line,
      }
      return n
    })
    setPickerIndex(null)
  }

  function add() {
    setAddresses(a => [...a, {
      _key: Date.now(),
      address_name: '', reference: '',
      address_line: '', city: '', phone: '',
      is_primary: a.length === 0,   // first address defaults to primary
      notes: '',
    }])
  }

  function update(i, k, v) {
    setAddresses(a => { const n = [...a]; n[i] = { ...n[i], [k]: v }; return n })
  }

  function remove(i) {
    setAddresses(a => {
      const n = a.filter((_, idx) => idx !== i)
      // If the removed one was primary, promote the first remaining address.
      if (a[i]?.is_primary && n.length && !n.some(x => x.is_primary)) {
        n[0] = { ...n[0], is_primary: true }
      }
      return n
    })
  }

  // Only one address can be primary at a time.
  function setPrimary(i) {
    setAddresses(a => a.map((x, idx) => ({ ...x, is_primary: idx === i })))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Addresses</span>
        <button type="button" onClick={add}
          className="btn-ghost py-1 px-2 text-xs text-brand-400 hover:text-brand-300">
          <Plus className="w-3 h-3" /> Add Address
        </button>
      </div>

      {addresses.length === 0 ? (
        <p className="text-xs text-slate-600 border border-dashed border-surface-border rounded-lg px-3 py-4 text-center">
          No addresses yet — click "Add Address".
        </p>
      ) : addresses.map((a, i) => (
        <div key={a._id ?? a._key ?? i} className="border border-surface-border rounded-lg p-3 space-y-2 bg-surface-hover/30">
          <div className="flex items-center gap-2">
            <input className="input flex-1" placeholder="Address name * (e.g. Home, Warehouse)"
              value={a.address_name} onChange={e => update(i, 'address_name', e.target.value)} />
            <button type="button" onClick={() => setPrimary(i)}
              title={a.is_primary ? 'Primary address' : 'Set as primary'}
              className={`p-1.5 rounded-lg border flex-shrink-0 transition-colors ${a.is_primary
                ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
                : 'text-slate-500 border-surface-border hover:text-yellow-400'}`}>
              <Star className="w-4 h-4" fill={a.is_primary ? 'currentColor' : 'none'} />
            </button>
            <button type="button" onClick={() => remove(i)} title="Remove address"
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <input className="input" placeholder="Reference (landmark / directions)"
            value={a.reference} onChange={e => update(i, 'reference', e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Address line"
              value={a.address_line} onChange={e => update(i, 'address_line', e.target.value)} />
            <input className="input" placeholder="City"
              value={a.city} onChange={e => update(i, 'city', e.target.value)} />
          </div>

          <input className="input" placeholder="Phone (optional)"
            value={a.phone} onChange={e => update(i, 'phone', e.target.value)} />

          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setPickerIndex(i)}
              className="btn-ghost py-1.5 px-2.5 text-xs text-brand-400 border border-surface-border hover:border-brand-600/50">
              <Map className="w-3.5 h-3.5" /> Get from map
            </button>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              {a.latitude != null && a.longitude != null
                ? `${Number(a.latitude).toFixed(5)}, ${Number(a.longitude).toFixed(5)}`
                : 'No coordinates yet'}
            </span>
          </div>
        </div>
      ))}

      <MapPicker
        open={pickerIndex != null}
        initial={pickerIndex != null ? addresses[pickerIndex] : null}
        onCancel={() => setPickerIndex(null)}
        onConfirm={confirmPicker}
      />
    </div>
  )
}
