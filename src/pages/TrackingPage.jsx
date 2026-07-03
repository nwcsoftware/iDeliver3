import React, { useState, useEffect } from 'react'
import { MapPin, Circle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { formatMobile } from '../lib/phone'
import Badge from '../components/ui/Badge'

let L            = null
let MapContainer = null
let TileLayer    = null
let Marker       = null
let Popup        = null

async function loadLeaflet() {
  if (L) return
  const leaflet = await import('leaflet')
  const rl      = await import('react-leaflet')
  L             = leaflet.default
  MapContainer  = rl.MapContainer
  TileLayer     = rl.TileLayer
  Marker        = rl.Marker
  Popup         = rl.Popup

  delete L.Icon.Default.prototype._getIconUrl
  L.Icon.Default.mergeOptions({
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })
}

function DriverMarker({ driver, position }) {
  const initials = `${driver.first_name?.[0] ?? ''}${driver.last_name?.[0] ?? ''}`.toUpperCase()
  const icon = L?.divIcon({
    className: '',
    html: `<div style="
      background:#4f46e5;border:2px solid #818cf8;border-radius:50%;
      width:34px;height:34px;display:flex;align-items:center;justify-content:center;
      color:white;font-size:11px;font-weight:700;box-shadow:0 0 14px #6366f180;
    ">${initials}</div>`,
    iconSize:   [34, 34],
    iconAnchor: [17, 17],
  })
  if (!Marker || !icon) return null
  return (
    <Marker position={position} icon={icon}>
      <Popup>
        <div style={{ color: '#f1f5f9', minWidth: 150 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{driver.first_name} {driver.last_name}</p>
          <p style={{ color: '#94a3b8', fontSize: 12 }}>{driver.driver_status?.replace('_', ' ')}</p>
          {driver.mobile && <p style={{ color: '#94a3b8', fontSize: 12 }}>{formatMobile(driver.mobile)}</p>}
          {driver.driver_license && <p style={{ color: '#94a3b8', fontSize: 12 }}>License: {driver.driver_license}</p>}
        </div>
      </Popup>
    </Marker>
  )
}

// Simulate lat/lng for demo — replace with real driver_locations rows from Supabase
function simulatePosition(id) {
  const seed = (id?.charCodeAt(0) ?? 0) + (id?.charCodeAt(4) ?? 0)
  return [
    40.7128 + Math.sin(seed * 137.508) * 0.06,
    -74.006 + Math.cos(seed * 137.508) * 0.06,
  ]
}

export default function TrackingPage() {
  const { drivers, orders } = useApp()
  const [mapReady,  setMapReady]  = useState(false)
  const [MapCmp,    setMapCmp]    = useState(null)
  const [map,       setMap]       = useState(null)   // Leaflet map instance
  const [selected,  setSelected]  = useState(null)
  const [latestVehicle, setLatestVehicle] = useState({})  // driver_id -> "code | make | model | color"
  const [positions, setPositions] = useState({})     // driver_id -> { pos:[lat,lng], at }

  useEffect(() => {
    loadLeaflet().then(() => { setMapCmp(() => MapContainer); setMapReady(true) })
  }, [])

  // Latest recorded GPS position per driver (driver_locations, newest first).
  useEffect(() => {
    supabase
      .from('driver_locations')
      .select('driver_id, latitude, longitude, recorded_at')
      .order('recorded_at', { ascending: false })
      .then(({ data }) => {
        const m = {}
        for (const r of (data ?? [])) {
          if (!m[r.driver_id] && r.latitude != null && r.longitude != null) {
            m[r.driver_id] = { pos: [Number(r.latitude), Number(r.longitude)], at: r.recorded_at }
          }
        }
        setPositions(m)
      })
  }, [drivers])

  // Latest assigned vehicle per driver (most recent assignment).
  useEffect(() => {
    supabase
      .from('driver_vehicle_assignments')
      .select('driver_id, start_date, created_at, vehicle:vehicles(asset_code, make, model, color)')
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const map = {}
        for (const a of (data ?? [])) {
          if (!map[a.driver_id] && a.vehicle) {
            map[a.driver_id] = [a.vehicle.asset_code, a.vehicle.make, a.vehicle.model, a.vehicle.color]
              .filter(Boolean).join(' | ')
          }
        }
        setLatestVehicle(map)
      })
  }, [drivers])

  const activeDrivers    = drivers.filter(d => d.driver_status === 'available' || d.driver_status === 'on_duty')
  const inTransitOrders  = orders.filter(o => o.status === 'in_transit')
  const selectedDriver   = selected ? drivers.find(d => d.id === selected) : null
  const selectedOrders   = selectedDriver
    ? orders.filter(o => o.driver_id === selectedDriver.id && ['assigned', 'picked_up', 'in_transit'].includes(o.status))
    : []

  // A driver's map position: real GPS if we have it, else the demo fallback.
  const positionOf = (d) => positions[d.id]?.pos || simulatePosition(d.id)

  // Clicking a driver flies the map to that driver's coordinates.
  useEffect(() => {
    if (!map || !selectedDriver) return
    map.flyTo(positionOf(selectedDriver), 15, { duration: 0.8 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selected, positions])

  // With no driver selected, frame all active drivers so their markers are visible.
  useEffect(() => {
    if (!map || selected) return
    const pts = activeDrivers.map(positionOf)
    if (pts.length === 0) return
    try { map.fitBounds(pts, { padding: [60, 60], maxZoom: 14 }) } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, positions])

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel */}
      <div className="w-72 flex-shrink-0 border-r border-surface-border flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Active Drivers</p>
          <p className="text-slate-200 text-sm mt-0.5">{activeDrivers.length} on the road</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeDrivers.map(driver => {
            const currentOrder = orders.find(o => o.driver_id === driver.id && o.status === 'in_transit')
            return (
              <button
                key={driver.id}
                onClick={() => setSelected(selected === driver.id ? null : driver.id)}
                className={`w-full text-left px-4 py-3 border-b border-surface-border/50 transition-colors ${
                  selected === driver.id ? 'bg-brand-600/10' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-brand-600/30 flex items-center justify-center text-brand-300 text-sm font-bold">
                      {driver.first_name?.[0]}{driver.last_name?.[0]}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-card ${
                      driver.driver_status === 'on_duty' ? 'bg-brand-500' : 'bg-green-500'
                    }`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-slate-100 text-sm font-medium truncate">{driver.first_name} {driver.last_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge status={driver.driver_status} />
                    </div>
                  </div>
                </div>
                {currentOrder && (
                  <div className="mt-2 pl-12">
                    <p className="text-xs text-slate-500">→ <span className="text-slate-300 truncate">{currentOrder.delivery_address}</span></p>
                    <p className="text-xs font-mono text-brand-500">{currentOrder.order_number}</p>
                  </div>
                )}
                {latestVehicle[driver.id] && (
                  <div className="mt-2 pl-12">
                    <p className="text-[11px] text-fuchsia-300 font-mono">
                      {latestVehicle[driver.id]}
                    </p>
                  </div>
                )}
              </button>
            )
          })}
          {activeDrivers.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">No active drivers</div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-surface-border bg-surface-card/50">
          <div className="flex items-center gap-2">
            <Circle className="w-3 h-3 text-brand-400 fill-brand-400" />
            <span className="text-xs text-slate-400">{inTransitOrders.length} orders in transit</span>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative overflow-hidden">
        {mapReady && MapCmp ? (
          <MapCmp ref={setMap} center={[40.7128, -74.006]} zoom={12} style={{ height: '100%', width: '100%' }} zoomControl>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {activeDrivers.map(driver => (
              <DriverMarker key={driver.id} driver={driver} position={positionOf(driver)} />
            ))}
          </MapCmp>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-500">
            <div className="text-center">
              <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Loading map…</p>
            </div>
          </div>
        )}

        {/* Selected driver detail */}
        {selectedDriver && (
          <div className="absolute bottom-4 left-4 card p-4 w-80 shadow-2xl max-h-64 overflow-y-auto">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Driver Detail</p>
            <p className="text-slate-100 font-semibold">{selectedDriver.first_name} {selectedDriver.last_name}</p>
            <p className="text-slate-400 text-sm">{formatMobile(selectedDriver.mobile)}</p>
            {selectedDriver.driver_license && (
              <p className="text-slate-500 text-xs">License: {selectedDriver.driver_license}</p>
            )}
            {(() => {
              const p    = positionOf(selectedDriver)
              const meta = positions[selectedDriver.id]
              return (
                <button type="button"
                  onClick={() => map && map.flyTo(p, 16, { duration: 0.6 })}
                  className="mt-1 flex items-center gap-1.5 text-xs text-brand-300 hover:text-brand-200">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="font-mono">{p[0].toFixed(5)}, {p[1].toFixed(5)}</span>
                  {!meta && <span className="text-slate-600">(demo)</span>}
                </button>
              )
            })()}
            {positions[selectedDriver.id]?.at && (
              <p className="text-slate-600 text-[11px]">Updated {new Date(positions[selectedDriver.id].at).toLocaleString()}</p>
            )}
            {selectedOrders.length > 0 ? (
              <div className="mt-3 pt-3 border-t border-surface-border space-y-2">
                <p className="text-xs text-slate-500">{selectedOrders.length} Active Order{selectedOrders.length > 1 ? 's' : ''}</p>
                {selectedOrders.map(o => (
                  <div key={o.id} className="space-y-0.5">
                    <p className="font-mono text-xs text-brand-400">{o.order_number}</p>
                    <p className="text-slate-300 text-xs truncate">{o.delivery_address}</p>
                    <p className="text-slate-500 text-xs">{o.recipient_name} · {formatMobile(o.recipient_mobile)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-xs mt-2">No active deliveries</p>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="absolute top-4 right-4 card px-3 py-2 text-xs text-slate-400 space-y-1">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-brand-500 inline-block" /> On Duty</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Available</div>
        </div>
      </div>
    </div>
  )
}
