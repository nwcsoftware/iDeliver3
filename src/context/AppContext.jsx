import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from './AuthContext'

const AppContext = createContext(null)

const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || null

// Columns + nested relations loaded for every order. Shared by the full-table load
// (fetchOrders) and the single-row realtime refresh (fetchOneOrder) so both keep the
// exact same shape.
const ORDER_SELECT = `
  *,
  driver:contacts!driver_id(id, first_name, last_name, mobile, driver_status),
  customer:contacts!customer_id(id, first_name, last_name, mobile, account_number, entity_type, contact_type, contact_types, company_name, credit_debit_allowed),
  zone:delivery_zones(id, name),
  order_items(currency, line_total, is_deleted),
  delivery_packages(package_price, paid, currency, provider_id, provider:contacts!provider_id(id, code, company_name, first_name, last_name)),
  order_services(service_fees, service_fees_currency, provider:contacts!provider_id(company_name, first_name, last_name)),
  retail_goods_invoices(id, invoice_value, currency, paid, shop_name, contact_id, is_procurement, commission_amount, commission_collected, commission_collected_at),
  payment_collections(amount, currency, collected_by_name, collected_by)
`

// Per-user UI preference: whether the order amounts summary popup is shown.
// Stored in localStorage keyed by the signed-in user so each user keeps their
// own view on this device. Defaults to shown.
const summaryKey = (userId) => `ideliver:showSummary:${userId || 'anon'}`
function readShowSummary(userId) {
  try {
    const v = localStorage.getItem(summaryKey(userId))
    return v === null ? true : v === '1'
  } catch { return true }
}

// App-wide operational settings, shared on this workstation and persisted in
// localStorage (not keyed per user — these are operator/company-level configs,
// not personal preferences). Stored as one JSON object so new settings can be
// added over time without new keys. Unknown/missing keys fall back to defaults.
const APP_SETTINGS_KEY = 'ideliver:appSettings'
const DEFAULT_APP_SETTINGS = {
  // Minutes an unconfirmed order may sit (since creation) before its row starts
  // blinking a reminder to confirm it. 0 disables the reminder.
  orderConfirmReminderMinutes: 15,
  // Minutes before an order's scheduled (start) time at which its row turns red
  // in the daily order list — a reminder that the order is about to start.
  // 0 disables the highlight.
  highlightBeforeScheduledMinutes: 5,
  // How many days of orders the shared (global) load pulls from the server, to
  // keep egress down on login. Operational pages (Deliveries, Dashboard) only need
  // recent orders; financial pages call loadFullOrderHistory() to pull everything.
  // 0 = unlimited (load the whole table, the pre-window behaviour).
  ordersWindowDays: 90,
}
function readAppSettings() {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY)
    return raw ? { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_APP_SETTINGS }
  } catch { return { ...DEFAULT_APP_SETTINGS } }
}

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
  const { currentUser } = useAuth()
  const userId = currentUser?.user_id || 'anon'

  const [drivers,    setDrivers]    = useState([])
  const [orders,     setOrders]     = useState([])
  const [zones,      setZones]      = useState([])
  const [loading,    setLoading]    = useState({ drivers: true, orders: true })

  // True once the full order history (not just the recent window) is loaded into
  // `orders`. Financial pages wait for this before trusting balances.
  const [ordersFullyLoaded, setOrdersFullyLoaded] = useState(false)
  const ordersFullyLoadedRef = useRef(false)

  // Amounts summary popup show/hide preference (per user, persisted locally).
  const [showSummary, setShowSummaryState] = useState(() => readShowSummary(userId))
  useEffect(() => { setShowSummaryState(readShowSummary(userId)) }, [userId])
  const setShowSummary = useCallback((val) => {
    setShowSummaryState(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      try { localStorage.setItem(summaryKey(userId), next ? '1' : '0') } catch {}
      return next
    })
  }, [userId])
  const toggleShowSummary = useCallback(() => setShowSummary(p => !p), [setShowSummary])

  // App-wide settings (persisted locally). `updateAppSettings` accepts a partial
  // object (or updater fn) and merges it, so each setting can be saved on its own.
  const [appSettings, setAppSettingsState] = useState(readAppSettings)
  const updateAppSettings = useCallback((partial) => {
    setAppSettingsState(prev => {
      const next = { ...prev, ...(typeof partial === 'function' ? partial(prev) : partial) }
      try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // Recent-window size (days) for the shared order load, mirrored into a ref so
  // fetchOrders can read it without becoming a new function on every settings edit
  // (which would otherwise re-subscribe the realtime channels).
  const ordersWindowRef = useRef(Number(appSettings.ordersWindowDays) || 0)
  useEffect(() => {
    ordersWindowRef.current = Number(appSettings.ordersWindowDays) || 0
  }, [appSettings.ordersWindowDays])

  /* ── Broadcast messages (admin → all users) ───────────────────────────────
     Active messages plus this user's read receipts, so the sidebar badge can
     show this user's unread count and the global popup can display them. */
  const [messages,     setMessages]     = useState([])              // active broadcast_messages (newest first)
  const [readIds,      setReadIds]      = useState(() => new Set()) // message ids this user has read
  const [messagesOpen, setMessagesOpen] = useState(false)          // global popup open state
  const seenMsgIdsRef = useRef(new Set())                          // ids already seen (to detect new arrivals)

  const fetchMessages = useCallback(async () => {
    if (!currentUser?.user_id) { setMessages([]); setReadIds(new Set()); return }
    let mq = supabase
      .from('broadcast_messages')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (currentUser.company_id) mq = mq.eq('company_id', currentUser.company_id)
    const { data: msgs, error } = await mq
    if (error) return   // table may not exist yet (migration not run) — fail quiet
    const { data: reads } = await supabase
      .from('broadcast_message_reads')
      .select('message_id')
      .eq('user_id', currentUser.user_id)
    setMessages(msgs ?? [])
    setReadIds(new Set((reads ?? []).map(r => r.message_id)))
  }, [currentUser?.user_id, currentUser?.company_id])

  const unreadMessages = messages.filter(m => !readIds.has(m.id))
  const unreadCount    = unreadMessages.length

  // Mark one message read for the current user (optimistic + upsert).
  const markMessageRead = useCallback(async (messageId) => {
    if (!currentUser?.user_id) return
    setReadIds(prev => new Set(prev).add(messageId))
    try {
      await supabase.from('broadcast_message_reads').upsert(
        { message_id: messageId, user_id: currentUser.user_id, read_at: new Date().toISOString() },
        { onConflict: 'message_id,user_id' },
      )
    } catch { /* badge will resync on next fetch */ }
  }, [currentUser?.user_id])

  // Mark every currently-unread message read for the current user.
  const markAllMessagesRead = useCallback(async () => {
    if (!currentUser?.user_id) return
    const ids = messages.filter(m => !readIds.has(m.id)).map(m => m.id)
    if (!ids.length) return
    setReadIds(prev => { const n = new Set(prev); ids.forEach(i => n.add(i)); return n })
    try {
      await supabase.from('broadcast_message_reads').upsert(
        ids.map(id => ({ message_id: id, user_id: currentUser.user_id, read_at: new Date().toISOString() })),
        { onConflict: 'message_id,user_id' },
      )
    } catch { /* badge will resync on next fetch */ }
  }, [messages, readIds, currentUser?.user_id])

  // Send a new broadcast (admin). The sender is auto-marked read so they don't
  // get their own popup. Returns { id } or { error }.
  const sendMessage = useCallback(async ({ title, body, priority = 'info' }) => {
    const payload = {
      title:           (title || '').trim(),
      body:            (body  || '').trim(),
      priority,
      is_active:       true,
      company_id:      currentUser?.company_id ?? null,
      created_by:      currentUser?.user_id    ?? null,
      created_by_name: `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
                         || currentUser?.username || null,
    }
    const { data, error } = await supabase
      .from('broadcast_messages').insert([payload]).select('id').single()
    if (error) return { error: error.message }
    try {
      await supabase.from('broadcast_message_reads').upsert(
        { message_id: data.id, user_id: currentUser?.user_id, read_at: new Date().toISOString() },
        { onConflict: 'message_id,user_id' },
      )
    } catch { /* non-fatal */ }
    await fetchMessages()
    return { id: data.id }
  }, [currentUser, fetchMessages])

  // Recall a broadcast (admin) — hides it for everyone.
  const deactivateMessage = useCallback(async (id) => {
    const { error } = await supabase.from('broadcast_messages').update({ is_active: false }).eq('id', id)
    await fetchMessages()
    return error ? { error: error.message } : {}
  }, [fetchMessages])

  // Initial load + realtime: refetch on any broadcast change, or on this user's
  // own read receipts (keeps the badge in sync across the user's open tabs).
  useEffect(() => {
    if (!currentUser?.user_id) { setMessages([]); setReadIds(new Set()); return }
    fetchMessages()
    const ch = supabase
      .channel('broadcast-messages-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_messages' }, fetchMessages)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'broadcast_message_reads', filter: `user_id=eq.${currentUser.user_id}` },
        fetchMessages)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [currentUser?.user_id, fetchMessages])

  // Auto-open the popup whenever a not-yet-seen unread message appears (on login
  // for existing unread, and instantly when an admin sends a new one).
  useEffect(() => {
    const hasNew = messages.some(m => !readIds.has(m.id) && !seenMsgIdsRef.current.has(m.id))
    seenMsgIdsRef.current = new Set(messages.map(m => m.id))
    if (hasNew) setMessagesOpen(true)
  }, [messages, readIds])

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

  // Paged — the order table is well past PostgREST's 1000-row response cap, and a
  // plain select would silently drop the oldest orders from every page that reads
  // `orders` (Deliveries, Cashier Box, driver settlements).
  // Load the shared orders array. By default it is limited to the recent window
  // (appSettings.ordersWindowDays) to keep login egress down; pass { full: true }
  // (or set the window to 0) to pull the entire table. The window keeps any order
  // whose creation OR scheduled date is within range, so today's list and
  // future-scheduled orders are never dropped.
  const fetchOrders = useCallback(async ({ full } = {}) => {
    setLoading(l => ({ ...l, orders: true }))
    // Default (full undefined): keep whatever scope is already loaded, so a plain
    // refresh after a mutation on a financial page never shrinks the full history
    // back to the recent window.
    const effectiveFull = full === undefined ? ordersFullyLoadedRef.current : full
    const windowDays = effectiveFull ? 0 : (ordersWindowRef.current || 0)
    const { data, error } = await fetchAllRows(() => {
      let q = supabase
        .from('delivery_orders')
        .select(ORDER_SELECT)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      if (windowDays > 0) {
        const cutoff = new Date(Date.now() - windowDays * 86400000)
        q = q.or(`created_at.gte.${cutoff.toISOString()},scheduled_date.gte.${cutoff.toISOString().slice(0, 10)}`)
      }
      return q
    })
    if (!error && data) {
      setOrders(data)
      const nowFull = windowDays === 0
      ordersFullyLoadedRef.current = nowFull
      setOrdersFullyLoaded(nowFull)
    }
    setLoading(l => ({ ...l, orders: false }))
  }, [])

  // Ensure the whole order history is loaded (called by financial pages on mount).
  // No-op if it is already fully loaded, so navigating between financial pages does
  // not refetch. Returns once `orders` holds every order.
  const loadFullOrderHistory = useCallback(async () => {
    if (ordersFullyLoadedRef.current) return
    await fetchOrders({ full: true })
  }, [fetchOrders])

  // Fetch a single order (with the full nested shape) by id. Used by the realtime
  // handler so an insert/update pulls only that one row instead of re-downloading
  // the whole orders table. Returns the row, or null if not found / not visible.
  const fetchOneOrder = useCallback(async (id) => {
    let q = supabase.from('delivery_orders').select(ORDER_SELECT).eq('id', id)
    if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
    const { data, error } = await q.maybeSingle()
    if (error) return null
    return data ?? null
  }, [])

  // Pending debounce timers, keyed by order id. A burst of realtime updates to the
  // same order (rapid saves, or nested writes that each touch the parent row) is
  // collapsed into a single fetchOneOrder instead of one fetch per event.
  const orderRefreshTimers = useRef(new Map())
  const ORDER_REFRESH_DEBOUNCE_MS = 1200

  // Fetch one order and splice the fresh row into state (or drop it if it vanished).
  const refreshOrderIntoState = useCallback(async (id) => {
    const row = await fetchOneOrder(id)
    setOrders(prev => {
      const i = prev.findIndex(o => o.id === id)
      if (!row) return i === -1 ? prev : prev.filter(o => o.id !== id)
      if (i === -1) return [row, ...prev]           // new order → front (list is newest-first)
      const next = [...prev]; next[i] = row; return next
    })
  }, [fetchOneOrder])

  // Apply a realtime change to the orders array in place. The postgres_changes
  // payload only carries delivery_orders columns (not the nested relations we
  // render), so for insert/update we fetch just that one row; delete removes by id.
  // Insert/update fetches are debounced per id to coalesce edit bursts.
  const applyOrderChange = useCallback((payload) => {
    const timers = orderRefreshTimers.current
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id
      if (id == null) return
      const t = timers.get(id)                       // cancel any pending refresh for a now-deleted row
      if (t) { clearTimeout(t); timers.delete(id) }
      setOrders(prev => prev.filter(o => o.id !== id))
      return
    }
    const id = payload.new?.id
    if (id == null) return
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)             // reset the window on each new event → coalesce
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      refreshOrderIntoState(id)
    }, ORDER_REFRESH_DEBOUNCE_MS))
  }, [refreshOrderIntoState])

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
        applyOrderChange)
      .subscribe()

    return () => {
      supabase.removeChannel(driversChannel)
      supabase.removeChannel(ordersChannel)
      orderRefreshTimers.current.forEach(clearTimeout)   // drop any pending debounced refreshes
      orderRefreshTimers.current.clear()
    }
  }, [fetchDrivers, fetchOrders, fetchZones, applyOrderChange])

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
      ordersFullyLoaded, loadFullOrderHistory,
      zones,   fetchZones,
      loading, stats,
      COMPANY_ID,
      showSummary, setShowSummary, toggleShowSummary,
      appSettings, updateAppSettings,
      messages, unreadMessages, unreadCount,
      messagesOpen, setMessagesOpen,
      markMessageRead, markAllMessagesRead, sendMessage, deactivateMessage, fetchMessages,
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
