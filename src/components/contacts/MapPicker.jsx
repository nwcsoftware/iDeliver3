import React, { useState, useEffect } from 'react'
import { X, Check, MapPin } from 'lucide-react'
import SearchField from '../ui/SearchField'
import 'leaflet/dist/leaflet.css'   // bundle locally so the map renders even offline

/* Lazy-load leaflet / react-leaflet the same way TrackingPage does. */
let L, MapContainer, TileLayer, Marker, useMapEvents, useMap
async function loadLeaflet() {
  if (L) return
  const leaflet = await import('leaflet')
  const rl      = await import('react-leaflet')
  L            = leaflet.default
  MapContainer = rl.MapContainer
  TileLayer    = rl.TileLayer
  Marker       = rl.Marker
  useMapEvents = rl.useMapEvents
  useMap       = rl.useMap

  delete L.Icon.Default.prototype._getIconUrl
  L.Icon.Default.mergeOptions({
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })
}

// Default map center when no coordinates yet (Beirut, Lebanon).
const DEFAULT_CENTER = [33.8938, 35.5018]

/* Captures map clicks → drops a pin. */
function ClickCapture({ onPick }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

/* Fixes leaflet sizing inside a modal and recenters when the pin moves. */
function MapInit({ position }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 150)
    return () => clearTimeout(t)
  }, [map])
  useEffect(() => { if (position) map.setView(position, Math.max(map.getZoom(), 15)) }, [map, position])
  return null
}

export default function MapPicker({ open, initial, onCancel, onConfirm }) {
  const [ready,       setReady]       = useState(false)
  const [pos,         setPos]         = useState(null)   // [lat, lng]
  const [name,        setName]        = useState('')
  const [query,       setQuery]       = useState('')
  const [searching,   setSearching]   = useState(false)
  const [loadingName, setLoadingName] = useState(false)

  useEffect(() => { if (open) loadLeaflet().then(() => setReady(true)) }, [open])

  useEffect(() => {
    if (!open) return
    const hasCoords = initial?.latitude != null && initial?.longitude != null
    setPos(hasCoords ? [Number(initial.latitude), Number(initial.longitude)] : null)
    setName(initial?.address_line || '')
    setQuery('')
  }, [open, initial])

  async function reverseGeocode(lat, lng) {
    setLoadingName(true)
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
      const d = await r.json()
      if (d?.display_name) setName(d.display_name)
    } catch { /* keep whatever name we have */ }
    finally { setLoadingName(false) }
  }

  function pick(lat, lng) {
    setPos([lat, lng])
    reverseGeocode(lat, lng)
  }

  async function runSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`)
      const d = await r.json()
      if (d?.[0]) {
        setPos([Number(d[0].lat), Number(d[0].lon)])
        setName(d[0].display_name || '')
      }
    } catch { /* ignore */ }
    finally { setSearching(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="card w-full max-w-2xl flex flex-col" style={{ maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brand-400" />
            <h3 className="text-sm font-semibold text-slate-100">Pick location on map</h3>
          </div>
          <button onClick={onCancel} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
        </div>

        {/* Search */}
        <form onSubmit={runSearch} className="px-4 py-3 border-b border-surface-border flex-shrink-0 flex gap-2">
          <div className="relative flex-1">
            <SearchField
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search a place or address…"
              className="input pl-9"
            />
          </div>
          <button type="submit" className="btn-ghost px-3 border border-surface-border" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {/* Map */}
        <div className="relative flex-shrink-0" style={{ height: '55vh' }}>
          {ready && MapContainer ? (
            <MapContainer center={pos || DEFAULT_CENTER} zoom={pos ? 15 : 12} style={{ height: '100%', width: '100%' }} zoomControl>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ClickCapture onPick={pick} />
              <MapInit position={pos} />
              {pos && <Marker position={pos} />}
            </MapContainer>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">Loading map…</div>
          )}
          {ready && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
              <span className="bg-slate-900/90 border border-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg shadow">
                Click on the map to drop a pin
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-surface-border space-y-3">
          <div className="text-xs text-slate-400 space-y-1">
            <p className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-500" />
              {pos ? `${pos[0].toFixed(6)}, ${pos[1].toFixed(6)}` : 'No location selected yet'}
            </p>
            {(name || loadingName) && (
              <p className="text-slate-500 truncate">{loadingName ? 'Finding place name…' : name}</p>
            )}
          </div>
          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" disabled={!pos}
              onClick={() => onConfirm({ latitude: pos[0], longitude: pos[1], address_line: name })}>
              <Check className="w-4 h-4" /> OK
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
