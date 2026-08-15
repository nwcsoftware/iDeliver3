import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase, fetchAllRows, fetchAllRowsKeyset, HEAVY_PAGE_SIZE } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { fetchHeaderBackgrounds, pickCurrent } from '../lib/headerBackground'

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
  retail_goods_invoices(id, invoice_value, currency, exclude_calculation, shop_name, contact_id, is_procurement, commission_amount, commission_collected, commission_collected_at),
  payment_collections(amount, currency, collected_by_name, collected_by, collection_group),
  ads(id, price, currency, platform, start_at, end_at, confirmed_ads)
`

// Per-user UI preference: whether the order amounts summary popup is shown.
// Stored in localStorage keyed by the signed-in user so each user keeps their
// own view on this device. Defaults to shown.
/* Does a broadcast message target this user? (fix107)
   Empty audience_roles AND empty audience_user_ids = everyone, which is how
   every message sent before targeting existed. Otherwise the user matches on
   EITHER their role OR their account being listed. */
export function messageTargetsUser(m, user) {
  const roles = Array.isArray(m?.audience_roles)    ? m.audience_roles.filter(Boolean)    : []
  const ids   = Array.isArray(m?.audience_user_ids) ? m.audience_user_ids.filter(Boolean) : []
  if (roles.length === 0 && ids.length === 0) return true
  return roles.includes(user?.role) || ids.map(String).includes(String(user?.user_id))
}

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
  ordersWindowDays: 7,
  // Restriction (super-admin only): when true, a local-market retail invoice is
  // locked once the order is saved (cannot be edited/deleted, only new ones
  // added). When false, saved invoices stay editable until the order is closed.
  lockSavedLocalInvoices: true,
  // Restriction (super-admin only): when true, a saved payment can only be
  // edited/deleted by the user who recorded it — so a call-center user can't
  // touch a driver's (or another user's) collected payment. When false, anyone
  // can edit/delete any payment.
  protectOthersPayments: false,
}
function readAppSettings() {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY)
    return raw ? { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_APP_SETTINGS }
  } catch { return { ...DEFAULT_APP_SETTINGS } }
}

// The super-admin RESTRICTION settings are company-wide policy, not per-device
// preferences: when a super admin flips them they must apply to every signed-in
// user everywhere (any device, any location). These keys are therefore stored
// server-side (app_global_settings) and mirrored down to every client in
// realtime, overriding the local copy. All other keys stay per-device.
const GLOBAL_SETTINGS_ID  = 'global'
const GLOBAL_SETTING_KEYS = ['lockSavedLocalInvoices', 'protectOthersPayments']

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
  // Set once a real list has been fetched, and the reason if a fetch failed.
  // Until then a single-row refresh must not invent a list (see below).
  const ordersLoadedRef = useRef(false)
  const [ordersError, setOrdersError] = useState('')
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

  // App-wide settings. Per-device preferences live in localStorage; the super-admin
  // restriction keys (GLOBAL_SETTING_KEYS) live server-side so they apply to every
  // signed-in user everywhere. `appSettings` below is the merged view; the global
  // keys override the local copy.
  const [localSettings, setLocalSettingsState] = useState(readAppSettings)
  const [globalSettings, setGlobalSettings]    = useState(null)   // null until first server load

  // Load the global restriction settings from the server, and keep every client in
  // sync via realtime — a super admin toggling on one device updates all others.
  const fetchGlobalSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_global_settings')
      .select('settings')
      .eq('id', GLOBAL_SETTINGS_ID)
      .maybeSingle()
    if (error) return   // table may not exist yet (migration not run) — fall back to local
    setGlobalSettings(data?.settings || {})
  }, [])

  useEffect(() => {
    fetchGlobalSettings()
    const ch = supabase
      .channel('app-global-settings-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_global_settings' }, fetchGlobalSettings)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchGlobalSettings])

  // Merged settings: local as the base, with any server-set restriction keys
  // overriding. Until the global row loads (globalSettings === null) the local
  // copy is used so the UI is never blocked.
  const appSettings = useMemo(() => {
    const overlay = {}
    const g = globalSettings || {}
    for (const k of GLOBAL_SETTING_KEYS) if (k in g) overlay[k] = g[k]
    return { ...localSettings, ...overlay }
  }, [localSettings, globalSettings])

  // `updateAppSettings` accepts a partial object (or updater fn) and routes each
  // key to the right store: restriction keys are written server-side (applying to
  // all users everywhere), everything else stays on this device.
  const updateAppSettings = useCallback((partial) => {
    const patch = typeof partial === 'function' ? partial(appSettings) : partial
    const globalPatch = {}
    const localPatch  = {}
    for (const [k, v] of Object.entries(patch)) {
      if (GLOBAL_SETTING_KEYS.includes(k)) globalPatch[k] = v
      else                                 localPatch[k]  = v
    }
    if (Object.keys(globalPatch).length) {
      const nextGlobal = { ...(globalSettings || {}), ...globalPatch }
      setGlobalSettings(nextGlobal)   // optimistic; realtime confirms for other clients
      supabase.from('app_global_settings')
        .upsert(
          { id: GLOBAL_SETTINGS_ID, settings: nextGlobal, updated_at: new Date().toISOString(), updated_by: currentUser?.user_id ?? null },
          { onConflict: 'id' },
        )
        .then(({ error }) => { if (error) fetchGlobalSettings() })   // revert to server truth on failure
    }
    if (Object.keys(localPatch).length) {
      setLocalSettingsState(prev => {
        const next = { ...prev, ...localPatch }
        try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    }
  }, [appSettings, globalSettings, currentUser?.user_id, fetchGlobalSettings])

  // Recent-window size (days) for the shared order load, mirrored into a ref so
  // fetchOrders can read it without becoming a new function on every settings edit
  // (which would otherwise re-subscribe the realtime channels).
  const ordersWindowRef = useRef(Number(appSettings.ordersWindowDays) || 0)
  useEffect(() => {
    ordersWindowRef.current = Number(appSettings.ordersWindowDays) || 0
  }, [appSettings.ordersWindowDays])

  /* ── Broadcast messages (admin → chosen audience) ─────────────────────────
     Active messages plus this user's read receipts, so the sidebar badge can
     show this user's unread count and the global popup can display them. */
  const [messages,     setMessages]     = useState([])              // active broadcast_messages (newest first)
  const [readIds,      setReadIds]      = useState(() => new Set()) // message ids this user has read
  const [messagesOpen, setMessagesOpen] = useState(false)          // global popup open state
  const [messagesNudge, setMessagesNudge] = useState(0)            // bumps to animate the sidebar icon
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
    setMessages((msgs ?? []).filter(m => messageTargetsUser(m, currentUser)))
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
  const sendMessage = useCallback(async ({ title, body, priority = 'info', audienceRoles = [], audienceUserIds = [], displayMode = 'popup' }) => {
    const payload = {
      title:           (title || '').trim(),
      body:            (body  || '').trim(),
      priority,
      display_mode:    displayMode,      // 'popup' | 'icon'
      is_active:       true,
      // Empty on both = everyone (see messageTargetsUser).
      audience_roles:    audienceRoles,
      audience_user_ids: audienceUserIds,
      company_id:      currentUser?.company_id ?? null,
      created_by:      currentUser?.user_id    ?? null,
      created_by_name: `${currentUser?.first_name ?? ''} ${currentUser?.last_name ?? ''}`.trim()
                         || currentUser?.username || null,
    }
    let { data, error } = await supabase
      .from('broadcast_messages').insert([payload]).select('id').single()
    // Targeting columns arrive with fix107 — still send to everyone rather than
    // failing outright when that migration hasn't been run.
    if (error && /audience_(roles|user_ids)|display_mode/.test(error.message)) {
      const { audience_roles: _r, audience_user_ids: _u, display_mode: _d, ...rest } = payload
      ;({ data, error } = await supabase.from('broadcast_messages').insert([rest]).select('id').single())
    }
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

  // A new message announces itself the way its sender chose (fix108):
  //   'popup' → open the message centre immediately (the original behaviour)
  //   'icon'  → stay quiet; the sidebar icon badges + nudges instead
  useEffect(() => {
    const arrived = messages.filter(m => !readIds.has(m.id) && !seenMsgIdsRef.current.has(m.id))
    seenMsgIdsRef.current = new Set(messages.map(m => m.id))
    if (arrived.length === 0) return
    if (arrived.some(m => (m.display_mode || 'popup') === 'popup')) setMessagesOpen(true)
    else setMessagesNudge(n => n + 1)          // icon-only: animate the sidebar icon
  }, [messages, readIds])

  /* ── Header background image (super-admin scheduled, fix109) ──────────────
     Decorative banner behind the app header while its date window is current.
     Re-evaluated every minute so a window opening/closing takes effect without
     a reload, and refetched live when the super admin changes the schedule. */
  const [headerBgRows, setHeaderBgRows] = useState([])
  const [headerBgNow,  setHeaderBgNow]  = useState(() => Date.now())

  const fetchHeaderBg = useCallback(async () => {
    const { rows } = await fetchHeaderBackgrounds(COMPANY_ID)
    setHeaderBgRows(rows)
  }, [])

  useEffect(() => {
    if (!currentUser?.user_id) { setHeaderBgRows([]); return undefined }
    fetchHeaderBg()
    const tick = setInterval(() => setHeaderBgNow(Date.now()), 60 * 1000)
    const ch = supabase
      .channel('header-backgrounds-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'header_backgrounds' }, fetchHeaderBg)
      .subscribe()
    return () => { clearInterval(tick); supabase.removeChannel(ch) }
  }, [currentUser?.user_id, fetchHeaderBg])

  const headerBackground = useMemo(
    () => pickCurrent(headerBgRows, headerBgNow),
    [headerBgRows, headerBgNow],
  )

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
    // One week is all the daily desk needs, and it lands in a couple of
    // seconds. Anything looking further back calls loadFullOrderHistory(),
    // which lifts this cap — see the history pages.
    const MAX_STARTUP_WINDOW_DAYS = 7
    const requested = ordersWindowRef.current || 0
    const windowDays = effectiveFull
      ? 0
      : (requested === 0 ? MAX_STARTUP_WINDOW_DAYS : Math.min(requested, MAX_STARTUP_WINDOW_DAYS))
    const { data, error } = await fetchAllRowsKeyset((cursor) => {
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
      // `lte` rather than `lt` so orders sharing a timestamp are never skipped;
      // the helper drops the duplicate rows that overlap causes.
      if (cursor) q = q.lte('created_at', cursor)
      return q
    }, { pageSize: HEAVY_PAGE_SIZE })
    if (data) {
      // `data` is present even when the fetch ended early, so a slow page never
      // leaves the app with an empty list it will happily render.
      setOrders(data)
      const nowFull = windowDays === 0 && !error
      ordersFullyLoadedRef.current = nowFull
      setOrdersFullyLoaded(nowFull)
    }
    ordersLoadedRef.current = ordersLoadedRef.current || !!data
    setOrdersError(error ? (error.message || 'Could not load all orders.') : '')
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
      if (i === -1) {
        // Never prepend into a list that was never loaded: an empty list plus a
        // few refreshed rows looks like "today has 3 orders", which is worse
        // than showing nothing. Wait for a real fetch instead.
        if (!ordersLoadedRef.current || prev.length === 0) return prev
        return [row, ...prev]                       // new order → front (newest-first)
      }
      const next = [...prev]; next[i] = row; return next
    })
  }, [fetchOneOrder])

  /* Refresh several orders in one round trip and splice them in. Used after a
     bulk action, so confirming twenty orders costs one small query instead of
     re-downloading the whole table. Ids that come back empty are dropped from
     the list — they no longer exist, or are no longer visible to us. */
  const refreshOrdersIntoState = useCallback(async (ids) => {
    const wanted = [...new Set((ids || []).filter(Boolean))]
    if (wanted.length === 0) return
    const rows = []
    for (let i = 0; i < wanted.length; i += 100) {          // stay well inside URL limits
      let q = supabase.from('delivery_orders').select(ORDER_SELECT).in('id', wanted.slice(i, i + 100))
      if (COMPANY_ID) q = q.eq('company_id', COMPANY_ID)
      const { data, error } = await q
      if (error) return
      if (data) rows.push(...data)
    }
    const byId = new Map(rows.map(r => [r.id, r]))
    const asked = new Set(wanted)
    setOrders(prev => {
      const seen = new Set(prev.map(o => o.id))
      const kept = prev
        .filter(o => !asked.has(o.id) || byId.has(o.id))     // vanished rows fall out
        .map(o => byId.get(o.id) ?? o)
      const added = (ordersLoadedRef.current && prev.length > 0)
        ? rows.filter(r => !seen.has(r.id))                 // brand-new rows go to the front
        : []
      return added.length ? [...added, ...kept] : kept
    })
  }, [])

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
      orders,  fetchOrders, ordersError,
      // Targeted refreshes — always prefer these to fetchOrders() after a
      // mutation: they fetch only the rows that changed.
      refreshOrder: refreshOrderIntoState, refreshOrders: refreshOrdersIntoState,
      ordersFullyLoaded, loadFullOrderHistory,
      zones,   fetchZones,
      loading, stats,
      COMPANY_ID,
      showSummary, setShowSummary, toggleShowSummary,
      appSettings, updateAppSettings,
      messages, unreadMessages, unreadCount,
      messagesOpen, setMessagesOpen, messagesNudge,
      headerBackground, refreshHeaderBackground: fetchHeaderBg,
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
