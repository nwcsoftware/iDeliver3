import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const SESSION_KEY = 'ideliver_session'

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading,     setLoading]     = useState(true)
  // user_ids of everyone currently signed in (live), via Supabase Realtime
  // presence. Every logged-in client announces itself on the shared channel,
  // so any client (e.g. the admin's User Accounts page) can see who's online.
  const [onlineUserIds, setOnlineUserIds] = useState([])

  // Announce this session on the shared presence channel while signed in, and
  // keep the live roster of online user_ids in sync as clients come and go.
  useEffect(() => {
    if (!currentUser?.user_id) { setOnlineUserIds([]); return }

    const channel = supabase.channel('online-users', {
      config: { presence: { key: String(currentUser.user_id) } },
    })

    const syncRoster = () => {
      const state = channel.presenceState()
      const ids = new Set()
      for (const metas of Object.values(state)) {
        for (const m of metas) if (m.user_id != null) ids.add(String(m.user_id))
      }
      setOnlineUserIds([...ids])
    }

    channel
      .on('presence', { event: 'sync' },  syncRoster)
      .on('presence', { event: 'join' },  syncRoster)
      .on('presence', { event: 'leave' }, syncRoster)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id:   currentUser.user_id,
            username:  currentUser.username,
            role:      currentUser.role,
            online_at: new Date().toISOString(),
          })
        }
      })

    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.user_id, currentUser?.username, currentUser?.role])

  // Rehydrate session from localStorage on mount
  useEffect(() => {
    let cancelled = false

    async function rehydrateSession() {
      const isCustomerMobileRoute =
        window.location.hash.startsWith('#/customer') ||
        window.location.pathname === '/customer' ||
        window.location.pathname.startsWith('/customer/')

      if (!isCustomerMobileRoute) {
        try {
          await supabase.auth.signOut({ scope: 'local' })
        } catch {
          // Staff auth is handled by verify_login; Supabase Auth is only used by
          // customer OAuth, so a failed local clear should not block staff login.
        }
      }

      if (cancelled) return

      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (raw) {
          const session = JSON.parse(raw)
          // Basic expiry check: 12-hour sessions
          const age = Date.now() - new Date(session.logged_in_at).getTime()
          if (age < 12 * 60 * 60 * 1000) {
            setCurrentUser(session)
          } else {
            localStorage.removeItem(SESSION_KEY)
          }
        }
      } catch {
        localStorage.removeItem(SESSION_KEY)
      }
      setLoading(false)
    }

    rehydrateSession()
    return () => { cancelled = true }
  }, [])

  // `mode` gates which tab the sign-in came from:
  //   'partner' → only partner/supplier (2nd-party) accounts may sign in
  //   'staff'   → only Call Center / office accounts may sign in
  //   null      → no restriction (legacy callers)
  const login = useCallback(async (identifier, password, mode = null) => {
    const { data, error } = await supabase.rpc('verify_login', {
      p_login:    identifier.trim(),
      p_password: password,
    })

    if (error) {
      const msg = error.message || ''
      if (msg.includes('INVALID_CREDENTIALS'))  return { success: false, error: 'Invalid username or password.' }
      if (msg.includes('ACCOUNT_SUSPENDED'))    return { success: false, error: 'This account has been suspended. Contact your administrator.' }
      if (msg.includes('ACCOUNT_LOCKED')) {
        const ts = msg.split(':')[1]
        const until = ts ? new Date(Number(ts) * 1000).toLocaleTimeString() : 'later'
        return { success: false, error: `Account locked due to too many failed attempts. Try again after ${until}.` }
      }
      return { success: false, error: 'Connection error. Please try again.' }
    }

    if (!data || data.length === 0) {
      return { success: false, error: 'Invalid username or password.' }
    }

    const user = {
      ...data[0],
      logged_in_at: new Date().toISOString(),
    }

    // Enforce the selected login tab against the account's role. The 2nd-party
    // roles are exactly partner/supplier; everything else is an office account.
    const isSecondParty = user.role === 'partner' || user.role === 'supplier'
    if (mode === 'partner' && !isSecondParty) {
      return { success: false, error: 'This is not a partner or supplier account. Use the Call Center tab.' }
    }
    if (mode === 'staff' && isSecondParty) {
      return { success: false, error: 'This is a partner/supplier account. Use the Partner / Supplier tab.' }
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    setCurrentUser(user)
    return { success: true }
  }, [])

  // Change the current user's own password. Used for the forced first-login
  // change and any voluntary change. Clears must_change_password on success.
  const changePassword = useCallback(async (oldPassword, newPassword) => {
    if (!currentUser?.user_id) return { success: false, error: 'Not signed in.' }
    const { data, error } = await supabase.rpc('change_password', {
      p_user_id:      currentUser.user_id,
      p_old_password: oldPassword,
      p_new_password: newPassword,
    })
    if (error)  return { success: false, error: 'Connection error. Please try again.' }
    if (!data)  return { success: false, error: 'Current password is incorrect.' }

    const updated = { ...currentUser, must_change_password: false }
    localStorage.setItem(SESSION_KEY, JSON.stringify(updated))
    setCurrentUser(updated)
    return { success: true }
  }, [currentUser])

  // Change the current user's own username. Reserved server-side for the
  // super_admin (the developer); requires the current password for confirmation.
  const changeUsername = useCallback(async (password, newUsername) => {
    if (!currentUser?.user_id) return { success: false, error: 'Not signed in.' }
    const trimmed = (newUsername || '').trim()
    const { data, error } = await supabase.rpc('change_username', {
      p_user_id:      currentUser.user_id,
      p_password:     password,
      p_new_username: trimmed,
    })
    if (error) return { success: false, error: 'Connection error. Please try again.' }

    if (data === 'OK') {
      const updated = { ...currentUser, username: trimmed }
      localStorage.setItem(SESSION_KEY, JSON.stringify(updated))
      setCurrentUser(updated)
      return { success: true }
    }
    const messages = {
      BAD_PASSWORD:      'Current password is incorrect.',
      USERNAME_TAKEN:    'That username is already taken.',
      USERNAME_REQUIRED: 'Enter a username.',
      NOT_AUTHORIZED:    'You are not allowed to change the username.',
      USER_NOT_FOUND:    'Account not found.',
    }
    return { success: false, error: messages[data] || 'Could not change username.' }
  }, [currentUser])

  const logout = useCallback(async () => {
    // Best-effort audit log. The supabase query builder is a thenable without a
    // .catch(), so guard with try/catch — otherwise a failure here would abort
    // before the session is actually cleared.
    try {
      if (currentUser?.user_id) {
        await supabase.rpc('logout_user', { p_user_id: currentUser.user_id })
      }
    } catch {
      // ignore — clearing the local session below is what matters
    }
    localStorage.removeItem(SESSION_KEY)
    setCurrentUser(null)
  }, [currentUser])

  const hasRole = useCallback((...roles) => {
    return roles.includes(currentUser?.role)
  }, [currentUser])

  return (
    <AuthContext.Provider value={{ currentUser, loading, login, logout, hasRole, changePassword, changeUsername, onlineUserIds }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
