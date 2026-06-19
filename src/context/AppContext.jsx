import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AppContext = createContext(null)

const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || null

// Normalize a contact row into a driver-shaped object for UI consumption
function normalizeDriver(c) {
  return {
    ...c,
    name:   `${c.first_name} ${c.last_name}`,
    phone:  c.mobile,
    status: c.driver_status ?? 'inactive',
  }
}

export function AppProvider({ children }) {
  const [drivers,    setDrivers]    = useState([])
  const [orders,     setOrders]     = useState([])
  const [zones,      setZones]      = useState([])
  const [loading,    setLoading]    = useState({ drivers: true, orders: true })

  const fetchDrivers = useCallback(async () => {
    setLoading(l => ({ ...l, drivers: true }))
    let q = supabase
      .from('contacts')
      .select(`
        *,
        assigned_vehicle:driver_vehicle_assignments(
          id,
          vehicle:vehicles(id, asset_code, make, model, color, type, plate_number)
        )
      `)
      .eq('contact_type', 'driver')
      .order('created_at', { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error } = await q
    if (!error && data) {
      setDrivers(data.map(d => {
        // Get the latest assigned vehicle (if any)
        const latestAssignment = d.assigned_vehicle?.sort((a, b) => 
          new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0)
        )[0]
        return {
          ...normalizeDriver(d),
          assigned_vehicle: latestAssignment?.vehicle ?? null
        }
      }))
    }
    setLoading(l => ({ ...l, drivers: false }))
  }, [])

  const fetchOrders = useCallback(async () => {
    setLoading(l => ({ ...l, orders: true }))
    let q = supabase
      .from('delivery_orders')
      .select(`
        *,
        driver:contacts!driver_id(id, first_name, last_name, mobile, driver_status),
        customer:contacts!customer_id(id, first_name, last_name, mobile, account_number, entity_type, contact_type, company_name, credit_debit_allowed),
        zone:delivery_zones(id, name),
        order_items(currency, line_total, is_deleted),
        delivery_packages(package_price, paid, currency, provider:contacts!provider_id(company_name, first_name, last_name)),
        order_services(service_fees, service_fees_currency, provider:contacts!provider_id(company_name, first_name, last_name)),
        retail_goods_invoices(invoice_value, currency, paid, shop_name),
        payment_collections(amount, currency, collected_by_name)
      `)
      .order('created_at', { ascending: false })
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error } = await q
    if (!error && data) setOrders(data)
    setLoading(l => ({ ...l, orders: false }))
  }, [])

  const fetchZones = useCallback(async () => {
    let q = supabase
      .from('delivery_zones')
      .select('*')
      .eq('is_active', true)
      .order('name')
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data } = await q
    if (data) setZones(data)
  }, [])

  useEffect(() => {
    fetchDrivers()
    fetchOrders()
    fetchZones()

    const driversChannel = supabase
      .channel('contacts-driver-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'contacts', filter: 'contact_type=eq.driver' },
        fetchDrivers)
      .subscribe()

    const ordersChannel = supabase
      .channel('delivery-orders-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_orders' },
        fetchOrders)
      .subscribe()

    return () => {
      supabase.removeChannel(driversChannel)
      supabase.removeChannel(ordersChannel)
    }
  }, [fetchDrivers, fetchOrders, fetchZones])

  const stats = {
    totalDrivers:      drivers.length,
    activeDrivers:     drivers.filter(d => d.driver_status === 'available' || d.driver_status === 'on_duty').length,
    totalOrders:       orders.length,
    pendingOrders:     orders.filter(o => o.status === 'pending').length,
    confirmedOrders:   orders.filter(o => o.status === 'confirmed').length,
    inTransit:         orders.filter(o => o.status === 'in_transit').length,
    delivered:         orders.filter(o => o.status === 'delivered').length,
    failed:            orders.filter(o => o.status === 'failed').length,
    cancelled:         orders.filter(o => o.status === 'cancelled').length,
  }

  return (
    <AppContext.Provider value={{
      drivers, fetchDrivers,
      orders,  fetchOrders,
      zones,   fetchZones,
      loading, stats,
      COMPANY_ID,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
