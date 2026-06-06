import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Home,
  LogOut,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Trash2,
  Upload,
  User,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const CUSTOMER_MOBILE_MODULE = 'iDeliver Customer Mobile'
const COMPANY_ID = import.meta.env.VITE_COMPANY_ID || null
const CUSTOMER_SESSION_KEY = 'ideliver_customer_mobile_session'

const initialRequirements = [
  'Buy 1 packet milk',
  'Buy 2 water bottles',
  'Pick up from school',
]

const emptyAddressForm = {
  address_name: '',
  reference: '',
  address_line: '',
  city: '',
  phone: '',
  notes: '',
  is_primary: false,
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

function statusClass(status) {
  const key = status?.toLowerCase()
  if (key === 'pending') return 'bg-amber-100 text-amber-700'
  if (key === 'confirmed') return 'bg-blue-100 text-blue-700'
  if (key === 'completed') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-600'
}

function customerRouteFromHash() {
  const hash = window.location.hash.replace(/^#\/customer\/?/, '')
  const route = hash.split('?')[0] || 'home'
  if (['login', 'otp', 'home', 'book', 'orders', 'profile'].includes(route)) return route
  return 'home'
}

function isDevelopmentBypass() {
  return window.location.hash.includes('dev=1')
}

function setCustomerHash(screen) {
  const route = screen === 'home' ? '#/customer' : `#/customer/${screen}`
  if (window.location.hash !== route) window.history.replaceState(null, '', route)
}

function loadCustomerSession() {
  try {
    const raw = localStorage.getItem(CUSTOMER_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    const age = Date.now() - new Date(session.logged_in_at).getTime()
    if (age > 12 * 60 * 60 * 1000) {
      localStorage.removeItem(CUSTOMER_SESSION_KEY)
      return null
    }
    return session
  } catch {
    localStorage.removeItem(CUSTOMER_SESSION_KEY)
    return null
  }
}

function saveCustomerSession(user) {
  const session = { ...user, logged_in_at: new Date().toISOString() }
  localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(session))
  return session
}

function clearCustomerSession() {
  localStorage.removeItem(CUSTOMER_SESSION_KEY)
}

function Shell({ children, activeTab, onTab }) {
  const nav = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'book', label: 'Book', icon: Plus },
    { id: 'profile', label: 'Profile', icon: User },
  ]

  return (
    <div className="h-screen overflow-hidden bg-[#eaf8fb] text-[#071923]">
      <div className="relative mx-auto flex h-screen max-w-md flex-col overflow-hidden bg-[#f8fdff] shadow-2xl shadow-cyan-950/10">
        <div className="flex-1 overflow-y-auto">{children}</div>
        <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-sky-100 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="grid grid-cols-4 gap-2">
            {nav.map(item => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTab(item.id)}
                  className={cx(
                    'flex h-11 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition',
                    active ? 'bg-sky-100 text-sky-700' : 'text-slate-400 hover:bg-sky-50 hover:text-sky-700'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}

function Header({ title, subtitle, right, back, onBack }) {
  return (
    <header className="sticky top-0 z-10 rounded-b-[2rem] border-b border-sky-50 bg-white/95 px-5 pb-6 pt-5 shadow-sm shadow-sky-100/70 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {back && (
            <button type="button" onClick={onBack} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
            {subtitle && <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
    </header>
  )
}

function DeliveryStatusNotice({ notice, onClose, onOpenOrders }) {
  if (!notice) return null

  return (
    <div className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-sky-200 bg-white p-4 shadow-lg shadow-sky-200/70">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-950">Delivery status updated</p>
          <p className="mt-1 text-sm text-slate-500">
            {notice.orderNumber || 'Your order'} is now {notice.deliveryStatus}.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onOpenOrders} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">
              View Orders
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs font-bold text-slate-500">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, subtitle, children, action }) {
  return (
    <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function LoginScreen({ onLogin, onOtp }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submitLogin(event) {
    event.preventDefault()
    setError('')

    if (!identifier.trim()) {
      setError('Enter your mobile number or email.')
      return
    }
    if (!password) {
      setError('Enter your password.')
      return
    }

    setLoading(true)
    const { data, error: loginError } = await supabase.rpc('verify_login', {
      p_login: identifier.trim(),
      p_password: password,
    })
    setLoading(false)

    if (loginError) {
      const msg = loginError.message || ''
      if (msg.includes('INVALID_CREDENTIALS')) setError('Invalid mobile/email or password.')
      else if (msg.includes('ACCOUNT_LOCKED')) setError('Account locked. Please try again later.')
      else if (msg.includes('ACCOUNT_SUSPENDED')) setError('This account is suspended. Please contact support.')
      else setError('Login failed. Please try again.')
      return
    }

    const user = data?.[0]
    if (!user) {
      setError('Invalid mobile/email or password.')
      return
    }
    if (user.role !== 'customer') {
      setError('This login is not a customer account.')
      return
    }
    if (!user.contact_id) {
      setError('Customer profile is not linked to this login.')
      return
    }

    onLogin(saveCustomerSession(user))
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-[#eaf8fb] px-5 py-10 text-[#071923]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <div className="mb-9 rounded-lg bg-white p-8 text-center shadow-sm shadow-sky-100">
          <div className="mx-auto flex h-16 w-24 items-center justify-center rounded-lg bg-sky-100 text-3xl font-bold text-sky-600">3</div>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-500">Login with mobile/email and password</p>
        </div>

        <form onSubmit={submitLogin} className="rounded-lg border border-sky-100 bg-white p-5 shadow-sm shadow-sky-100/70">
          <label className="block text-xs font-semibold text-slate-500">Mobile number or Email</label>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-sky-300"
            value={identifier}
            onChange={event => { setIdentifier(event.target.value); setError('') }}
            placeholder="Mobile number or email"
            autoComplete="username"
            disabled={loading}
          />

          <label className="mt-5 block text-xs font-semibold text-slate-500">Password</label>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-sky-300"
            type="password"
            value={password}
            onChange={event => { setPassword(event.target.value); setError('') }}
            placeholder="Password"
            autoComplete="current-password"
            disabled={loading}
          />

          {error && (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="mt-8 flex h-12 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white shadow-sm shadow-sky-200 disabled:cursor-not-allowed disabled:bg-slate-300">
            {loading ? 'Logging in...' : 'Login'}
          </button>
          <button type="button" onClick={onOtp} className="mt-4 flex h-10 w-full items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">
            First-time customer? Register with OTP
          </button>
        </form>
      </div>
    </div>
  )
}

function OtpScreen({ onDone, onBack }) {
  const [step, setStep] = useState('details')
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [otpChannel, setOtpChannel] = useState('whatsapp')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function sendOtp(event) {
    event.preventDefault()
    setError('')

    if (!fullName.trim()) {
      setError('Enter your full name.')
      return
    }
    if (!mobile.trim()) {
      setError('Enter your mobile number.')
      return
    }
    if (otpChannel === 'email' && !email.trim()) {
      setError('Enter your email address to receive OTP by email.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Password and confirmation do not match.')
      return
    }

    setStep('otp')
  }

  function updateOtp(index, value) {
    const digit = value.replace(/\D/g, '').slice(-1)
    setOtp(current => current.map((item, i) => (i === index ? digit : item)))
  }

  async function verifyOtp(event) {
    event.preventDefault()
    setError('')

    if (otp.some(digit => !digit)) {
      setError('Enter the 4 digit OTP.')
      return
    }
    if (otp.join('') !== '1234') {
      setError('Invalid OTP. Use the temporary development OTP 1234.')
      return
    }

    setSaving(true)
    try {
      await onDone({
        mobile: mobile.trim(),
        email: email.trim() || null,
        otp_channel: otpChannel,
        full_name: fullName.trim(),
        password,
      })
    } catch (registrationError) {
      setError(registrationError.message || 'Customer registration failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-[#eaf8fb] text-[#071923]">
      <div className="mx-auto max-w-md bg-[#f8fdff] pb-8">
        <Header title="Customer Registration" subtitle="First-time customer setup" back onBack={step === 'otp' ? () => setStep('details') : onBack} />
        <main className="space-y-5 px-5 py-6">
          {step === 'details' ? (
            <form onSubmit={sendOtp}>
              <Section title="Create Account" subtitle="Temporary development OTP is 1234.">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-500">Full name</span>
                  <input
                    className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    value={fullName}
                    onChange={event => { setFullName(event.target.value); setError('') }}
                    placeholder="Enter full name"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-slate-500">Mobile number</span>
                  <input
                    className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    value={mobile}
                    onChange={event => { setMobile(event.target.value); setError('') }}
                    placeholder="Enter mobile number"
                    autoComplete="username"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-slate-500">Email address</span>
                  <input
                    className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    type="email"
                    value={email}
                    onChange={event => { setEmail(event.target.value); setError('') }}
                    placeholder="Required only for email OTP"
                    autoComplete="email"
                  />
                </label>

                <div className="mt-4">
                  <span className="text-xs font-semibold text-slate-500">Send OTP through</span>
                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                    {[
                      ['whatsapp', 'WhatsApp'],
                      ['email', 'Email'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => { setOtpChannel(value); setError('') }}
                        className={cx(
                          'h-10 rounded-md text-sm font-bold',
                          otpChannel === value ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-slate-500">Password</span>
                  <input
                    className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    type="password"
                    value={password}
                    onChange={event => { setPassword(event.target.value); setError('') }}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold text-slate-500">Confirm password</span>
                  <input
                    className="mt-2 h-12 w-full rounded-lg border border-sky-100 bg-slate-50 px-4 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                    type="password"
                    value={confirmPassword}
                    onChange={event => { setConfirmPassword(event.target.value); setError('') }}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                  />
                </label>

                {error && (
                  <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {error}
                  </div>
                )}

                <button type="submit" className="mt-7 flex h-12 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">
                  Send OTP
                </button>
              </Section>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <Section title="Verify OTP" subtitle={`Enter temporary OTP 1234 sent by ${otpChannel === 'email' ? 'Email' : 'WhatsApp'}.`}>
                <div className="grid grid-cols-4 gap-2">
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      className="flex h-14 min-w-0 rounded-lg border border-sky-100 bg-slate-50 text-center text-xl font-bold outline-none focus:ring-2 focus:ring-sky-300"
                      inputMode="numeric"
                      value={digit}
                      onChange={event => { updateOtp(index, event.target.value); setError('') }}
                      aria-label={`OTP digit ${index + 1}`}
                      disabled={saving}
                    />
                  ))}
                </div>

                {error && (
                  <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={saving} className="mt-7 flex h-12 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:opacity-60">
                  {saving ? 'Creating account...' : 'Verify OTP & Create Account'}
                </button>
              </Section>
            </form>
          )}
        </main>
      </div>
    </div>
  )
}

function HomeScreen({ customerSession, onBook, onOrders, onProfile, onViewOrder, onEditOrder }) {
  const [profile, setProfile] = useState(null)
  const [latestOrder, setLatestOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadHome() {
      setLoading(true)
      setError('')

      if (!customerSession?.contact_id) {
        setProfile(null)
        setLatestOrder(null)
        setError('Customer profile is not linked to this login.')
        setLoading(false)
        return
      }

      const [profileResult, orderResult] = await Promise.all([
        supabase
          .from('contacts')
          .select('id,first_name,last_name,company_name,mobile,whatsapp_number,email,credit_debit_allowed')
          .eq('id', customerSession.contact_id)
          .single(),
        supabase
          .from('delivery_orders')
          .select(`
            id,
            order_number,
            order_source,
            pickup_address,
            delivery_address,
            scheduled_date,
            scheduled_time_from,
            scheduled_time_to,
            order_details_text,
            status,
            delivery_status,
            payment_status,
            currency,
            total_amount,
            created_at,
            order_items (
              id,
              item_type,
              parcel_description,
              quantity,
              line_total,
              is_deleted
            )
          `)
          .eq('customer_id', customerSession.contact_id)
          .order('created_at', { ascending: false })
          .limit(1),
      ])

      if (cancelled) return

      if (profileResult.error) {
        setError(profileResult.error.message)
        setLoading(false)
        return
      }
      if (orderResult.error) {
        setError(orderResult.error.message)
        setLoading(false)
        return
      }

      setProfile(profileResult.data)
      setLatestOrder(orderResult.data?.[0] ? mapCustomerOrder(orderResult.data[0]) : null)
      setLoading(false)
    }

    loadHome()
    return () => { cancelled = true }
  }, [customerSession])

  const displayName = customerName(profile) || customerSession?.first_name || 'Customer'

  return (
    <>
      <Header
        title={`Hi, ${displayName.split(' ')[0]}`}
        subtitle={CUSTOMER_MOBILE_MODULE}
        right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><Bell className="h-5 w-5" /></button>}
      />
      <main className="space-y-5 px-5 py-6">
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-500">
            Loading account...
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
        {!loading && profile && (
          <Section title={displayName} subtitle={profile.mobile || customerSession?.mobile || 'Customer account'}>
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-slate-50 p-3">
              <div>
                <p className="text-xs text-slate-500">Credit/Debit</p>
                <p className="mt-1 text-sm font-semibold">{profile.credit_debit_allowed ? 'Allowed' : 'Not allowed'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Notifications</p>
                <p className="mt-1 text-sm font-semibold">{profile.email ? 'WhatsApp + Email' : 'WhatsApp'}</p>
              </div>
            </div>
          </Section>
        )}

        <section className="grid grid-cols-2 gap-3">
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100" onClick={onBook}>
            <Package className="h-6 w-6 text-sky-600" />
            <p className="mt-4 text-sm font-bold">Book Delivery</p>
            <p className="mt-1 text-xs text-slate-500">External request</p>
          </button>
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100">
            <ShoppingBag className="h-6 w-6 text-emerald-600" />
            <p className="mt-4 text-sm font-bold">Shop Products</p>
            <p className="mt-1 text-xs text-slate-500">Future module</p>
          </button>
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100" onClick={onOrders}>
            <ClipboardList className="h-6 w-6 text-blue-600" />
            <p className="mt-4 text-sm font-bold">My Orders</p>
            <p className="mt-1 text-xs text-slate-500">Track status</p>
          </button>
          <button type="button" className="rounded-lg border border-sky-100 bg-white p-4 text-left shadow-sm shadow-sky-100" onClick={onProfile}>
            <User className="h-6 w-6 text-cyan-600" />
            <p className="mt-4 text-sm font-bold">Profile</p>
            <p className="mt-1 text-xs text-slate-500">Saved addresses</p>
          </button>
        </section>

        <Section title="Latest Order" subtitle="Most recent delivery request">
          {latestOrder ? (
            <OrderCard order={latestOrder} onView={() => onViewOrder(latestOrder)} onEdit={latestOrder.status === 'pending' ? () => onEditOrder(latestOrder) : undefined} />
          ) : (
            <div className="rounded-lg border border-sky-100 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-bold text-slate-950">No orders yet</p>
              <button type="button" onClick={onBook} className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white">
                Book Delivery
              </button>
            </div>
          )}
        </Section>
      </main>
    </>
  )
}

function customerName(customer) {
  if (!customer) return ''
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Customer'
}

function addressText(address) {
  if (!address) return ''
  return [address.address_line, address.city].filter(Boolean).join(', ') || address.reference || address.address_name || ''
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function formatMoney(value, currency = 'USD') {
  const amount = Number(value || 0)
  return `${currency || 'USD'} ${amount.toFixed(2)}`
}

function formatOrderSchedule(order) {
  const date = order.scheduled_date || order.created_at?.slice(0, 10) || ''
  const from = order.scheduled_time_from ? String(order.scheduled_time_from).slice(0, 5) : ''
  const to = order.scheduled_time_to ? String(order.scheduled_time_to).slice(0, 5) : ''
  if (date && from && to) return `${date}, ${from} - ${to}`
  if (date && from) return `${date}, ${from}`
  return date || 'Not scheduled'
}

function formatDateTime(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function deliveryTimelineState(order, step) {
  const deliveryStatus = order.deliveryStatus || order.raw?.delivery_status || 'Awaiting Pickup'
  const sequence = ['Awaiting Pickup', 'Picked Up', 'In Transit', 'Delivered']
  const currentIndex = sequence.indexOf(deliveryStatus)
  const stepIndex = sequence.indexOf(step)
  if (order.status === 'cancelled' || order.status === 'failed') return 'Stopped'
  if (currentIndex > stepIndex) return 'Done'
  if (currentIndex === stepIndex) return 'Now'
  return 'Waiting'
}

function timelineTone(state) {
  if (state === 'Done') return 'text-emerald-600 bg-emerald-500'
  if (state === 'Now') return 'text-sky-600 bg-sky-500'
  if (state === 'Stopped') return 'text-rose-600 bg-rose-500'
  return 'text-slate-400 bg-slate-400'
}

function orderTypeLabel(order) {
  return order.order_source === 'external' || order.order_details_text ? 'Book Delivery' : 'Delivery Order'
}

function mapCustomerOrder(order, invoices = [], payments = []) {
  const activeItems = (order.order_items || []).filter(item => !item.is_deleted)
  const requirements = activeItems
    .map(item => item.parcel_description || item.item_type || 'Item')
    .filter(Boolean)
  const invoiceTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.invoice_value || 0), 0)
  const invoiceCurrency = invoices[0]?.currency || order.currency || 'USD'
  const paidUsd = payments.reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0)
  const paidLbp = payments.reduce((sum, payment) => sum + Number(payment.amount_lbp || 0), 0)

  return {
    id: order.id,
    orderNumber: order.order_number,
    type: orderTypeLabel(order),
    status: order.status,
    deliveryStatus: order.delivery_status || 'Awaiting Pickup',
    paymentStatus: order.payment_status,
    pickup: order.pickup_address || '',
    drop: order.delivery_address || '',
    schedule: formatOrderSchedule(order),
    invoice: invoices.length
      ? `${invoices.length} invoice${invoices.length > 1 ? 's' : ''} / ${formatMoney(invoiceTotal, invoiceCurrency)}`
      : 'Waiting for quotation',
    payment: payments.length
      ? `Collected USD ${paidUsd.toFixed(2)}${paidLbp ? ` / LBP ${paidLbp.toFixed(0)}` : ''}`
      : order.payment_status || 'Unpaid',
    requirements: requirements.length ? requirements : (order.order_details_text ? order.order_details_text.split('\n').filter(Boolean) : []),
    raw: order,
    invoices,
    payments,
  }
}

function BookDeliveryScreen({ onSubmit, requirements, setRequirements, customerSession }) {
  const [customers, setCustomers] = useState([])
  const [addresses, setAddresses] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [pickupDate, setPickupDate] = useState(todayDate())
  const [pickupTime, setPickupTime] = useState('16:30')
  const [deliveryDate, setDeliveryDate] = useState(todayDate())
  const [deliveryTime, setDeliveryTime] = useState('18:00')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedOrder, setSavedOrder] = useState(null)

  const selectedCustomer = customers.find(customer => customer.id === customerId) || null

  useEffect(() => {
    let cancelled = false

    async function loadCustomers() {
      setLoading(true)
      setError('')

      let query = supabase
        .from('contacts')
        .select('*')
        .eq('contact_type', 'customer')
      if (customerSession?.contact_id) {
        query = query.eq('id', customerSession.contact_id)
      } else {
        query = query.order('created_at', { ascending: false }).limit(1)
      }
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

      const { data, error: customerError } = await query
      if (cancelled) return

      if (customerError) {
        setError(customerError.message)
        setLoading(false)
        return
      }

      const rows = data || []
      setCustomers(rows)
      if (rows.length > 0) setCustomerId(current => current || rows[0].id)
      setLoading(false)
    }

    loadCustomers()
    return () => { cancelled = true }
  }, [customerSession])

  useEffect(() => {
    if (!selectedCustomer) return

    setPickupAddress(current => current || selectedCustomer.default_pickup_address || selectedCustomer.address || '')
    setDeliveryAddress(current => current || selectedCustomer.default_delivery_address || selectedCustomer.address || '')

    let cancelled = false
    async function loadAddresses() {
      let query = supabase
        .from('contact_addresses')
        .select('*')
        .eq('contact_id', selectedCustomer.id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

      const { data, error: addressError } = await query
      if (cancelled) return

      if (addressError) {
        setAddresses([])
        return
      }

      setAddresses(data || [])
      const primary = data?.find(address => address.is_primary) || data?.[0]
      const primaryText = addressText(primary)
      if (primaryText) {
        setPickupAddress(current => current || primaryText)
        setDeliveryAddress(current => current || primaryText)
      }
    }

    loadAddresses()
    return () => { cancelled = true }
  }, [selectedCustomer])

  function addRequirement() {
    setRequirements(items => [...items, ''])
  }

  function updateRequirement(index, value) {
    setRequirements(items => items.map((item, i) => (i === index ? value : item)))
  }

  function removeRequirement(index) {
    setRequirements(items => items.filter((_, i) => i !== index))
  }

  async function submitRequest() {
    setSaving(true)
    setError('')
    setSavedOrder(null)

    const customer = selectedCustomer
    const cleanRequirements = requirements.map(item => item.trim()).filter(Boolean)

    if (!customer) {
      setError('Select a customer before submitting.')
      setSaving(false)
      return
    }
    if (cleanRequirements.length === 0) {
      setError('Add at least one requirement row.')
      setSaving(false)
      return
    }
    if (!pickupAddress.trim()) {
      setError('Pickup location is required.')
      setSaving(false)
      return
    }
    if (!deliveryAddress.trim()) {
      setError('Delivery/drop location is required.')
      setSaving(false)
      return
    }

    const customerDisplayName = customerName(customer)
    const orderDetailsText = cleanRequirements.join('\n')

    const orderPayload = {
      ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
      customer_id: customer.id,
      pickup_address: pickupAddress.trim(),
      delivery_address: deliveryAddress.trim(),
      recipient_name: customerDisplayName,
      recipient_mobile: customer.mobile || customer.whatsapp_number || customer.whatsapp || 'not provided',
      recipient_whatsapp: customer.whatsapp_number || customer.whatsapp || customer.mobile || null,
      scheduled_date: deliveryDate || pickupDate || null,
      scheduled_time_from: pickupTime || null,
      scheduled_time_to: deliveryTime || null,
      order_details_text: orderDetailsText,
      special_instructions: notes.trim() || null,
      order_source: 'external',
      status: 'pending',
      payment_status: 'unpaid',
      driver_id: null,
      delivery_fee: 0,
      currency: 'USD',
      items_total: 0,
      total_amount: 0,
    }

    const { data: order, error: orderError } = await supabase
      .from('delivery_orders')
      .insert([orderPayload])
      .select('id, order_number')
      .single()

    if (orderError) {
      setError(orderError.message)
      setSaving(false)
      return
    }

    const itemRows = cleanRequirements.map(item => ({
      order_id: order.id,
      item_type: 'external_request',
      parcel_description: item,
      quantity: 1,
      unit_price: 0,
      currency: 'USD',
      discount: 0,
      line_total: 0,
    }))

    const { error: itemError } = await supabase.from('order_items').insert(itemRows)
    if (itemError) {
      setError(itemError.message)
      setSaving(false)
      return
    }

    setSavedOrder(order)
    setSaving(false)
    onSubmit?.(order)
  }

  return (
    <>
      <Header
        title="Book Delivery"
        subtitle="Tell us what you need"
      />
      <main className="space-y-4 px-5 pb-40 pt-5">
        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-950">Tell us what you need</h2>
              <p className="mt-0.5 text-xs text-slate-500">Add one or more request lines</p>
            </div>
            <button type="button" onClick={addRequirement} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">
              Add
            </button>
          </div>
          <div className="space-y-3">
            {requirements.map((item, index) => (
              <div key={index} className="flex min-h-[3.4rem] items-center gap-2 rounded-lg border border-sky-100 bg-slate-50 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span>
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-950 outline-none placeholder:text-slate-400"
                  value={item}
                  onChange={event => updateRequirement(index, event.target.value)}
                  placeholder="Type customer requirement"
                />
                <button type="button" onClick={() => removeRequirement(index)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950">Pickup</h2>
              <p className="mt-0.5 text-xs text-slate-500">Choose saved address or type new</p>
            </div>
            <MapPin className="h-5 w-5 text-sky-600" />
          </div>
          <AddressQuickPick
            addresses={addresses}
            fallback={selectedCustomer?.default_pickup_address || selectedCustomer?.address}
            onSelect={setPickupAddress}
          />
          <ControlledField label="Pickup location" value={pickupAddress} onChange={setPickupAddress} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ControlledField label="Pickup date" value={pickupDate} onChange={setPickupDate} type="date" />
            <ControlledField label="Pickup time" value={pickupTime} onChange={setPickupTime} type="time" />
          </div>
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950">Delivery / Drop</h2>
              <p className="mt-0.5 text-xs text-slate-500">Final delivery location</p>
            </div>
            <Package className="h-5 w-5 text-emerald-600" />
          </div>
          <AddressQuickPick
            addresses={addresses}
            fallback={selectedCustomer?.default_delivery_address || selectedCustomer?.address}
            onSelect={setDeliveryAddress}
          />
          <ControlledField label="Delivery / drop location" value={deliveryAddress} onChange={setDeliveryAddress} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ControlledField label="Delivery date" value={deliveryDate} onChange={setDeliveryDate} type="date" />
            <ControlledField label="Delivery time" value={deliveryTime} onChange={setDeliveryTime} type="time" />
          </div>
        </section>

        <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/70">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Notes, if needed</span>
            <textarea
              className="mt-2 min-h-20 w-full resize-none rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-300"
              value={notes}
              onChange={event => setNotes(event.target.value)}
            />
          </label>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {savedOrder && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            Created real order {savedOrder.order_number || savedOrder.id}.
          </div>
        )}

        <div className="fixed bottom-[76px] left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-sky-100 bg-white/95 px-5 py-3 shadow-lg shadow-sky-100 backdrop-blur">
          <button type="button" onClick={submitRequest} disabled={saving || loading} className="flex h-12 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            {saving ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </main>
    </>
  )
}

function AddressQuickPick({ addresses = [], fallback = '', onSelect }) {
  const options = [
    ...addresses.map(address => ({
      id: address.id,
      label: address.address_name || address.reference || 'Saved',
      value: addressText(address),
    })),
    ...(fallback ? [{ id: 'fallback', label: 'Default', value: fallback }] : []),
  ].filter(option => option.value)

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {options.map(option => (
        <button key={option.id} type="button" onClick={() => onSelect?.(option.value)} className="shrink-0 rounded-full border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
          {option.label}
        </button>
      ))}
      <button type="button" className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
        Type new
      </button>
    </div>
  )
}

function ControlledField({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        type={type}
        className="mt-2 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-sky-300"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  )
}

function Field({ label, value, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input type={type} className="mt-2 h-11 w-full rounded-lg border border-sky-100 bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-sky-300" defaultValue={value} />
    </label>
  )
}

function OrdersScreen({ customerSession, onView, onEdit }) {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase()
    return orders.filter(order => {
      const statusMatch = filter === 'all' || order.status === filter
      const textMatch = !text || order.orderNumber?.toLowerCase().includes(text) || order.drop?.toLowerCase().includes(text)
      return statusMatch && textMatch
    })
  }, [filter, orders, search])

  useEffect(() => {
    let cancelled = false

    async function loadOrders() {
      setLoading(true)
      setError('')

      if (!customerSession?.contact_id) {
        setOrders([])
        setError('Customer profile is not linked to this login.')
        setLoading(false)
        return
      }

      let orderQuery = supabase
        .from('delivery_orders')
        .select(`
          id,
          order_number,
          customer_id,
          order_source,
          pickup_address,
          delivery_address,
          scheduled_date,
          scheduled_time_from,
          scheduled_time_to,
          order_details_text,
          special_instructions,
          recipient_name,
          recipient_mobile,
          status,
          delivery_status,
          payment_status,
          currency,
          total_amount,
          delivery_fee,
          items_total,
          created_at,
          confirmed_at,
          delivered_at,
          order_items (
            id,
            item_type,
            parcel_description,
            quantity,
            line_total,
            is_deleted
          )
        `)
        .eq('customer_id', customerSession.contact_id)
        .order('created_at', { ascending: false })
      if (COMPANY_ID) orderQuery = orderQuery.eq('company_id', COMPANY_ID)

      const { data: orderRows, error: orderError } = await orderQuery
      if (cancelled) return

      if (orderError) {
        setOrders([])
        setError(orderError.message)
        setLoading(false)
        return
      }

      const ids = (orderRows || []).map(order => order.id)
      let invoicesByOrder = {}
      let paymentsByOrder = {}

      if (ids.length) {
        const [invoiceResult, paymentResult] = await Promise.all([
          supabase
            .from('retail_goods_invoices')
            .select('id, order_id, shop_name, invoice_reference, invoice_date, invoice_value, currency, paid')
            .in('order_id', ids),
          supabase
            .from('payment_collections')
            .select('id, order_id, collection_type, amount_usd, amount_lbp, collected_at')
            .in('order_id', ids),
        ])
        if (cancelled) return

        if (invoiceResult.error) {
          setError(invoiceResult.error.message)
        }
        if (paymentResult.error) {
          setError(paymentResult.error.message)
        }

        invoicesByOrder = (invoiceResult.data || []).reduce((acc, invoice) => {
          acc[invoice.order_id] = [...(acc[invoice.order_id] || []), invoice]
          return acc
        }, {})
        paymentsByOrder = (paymentResult.data || []).reduce((acc, payment) => {
          acc[payment.order_id] = [...(acc[payment.order_id] || []), payment]
          return acc
        }, {})
      }

      setOrders((orderRows || []).map(order => mapCustomerOrder(order, invoicesByOrder[order.id] || [], paymentsByOrder[order.id] || [])))
      setLoading(false)
    }

    loadOrders()
    return () => { cancelled = true }
  }, [customerSession])

  return (
    <>
      <Header title="My Orders" subtitle="Track bookings, invoices and payments" right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><Search className="h-5 w-5" /></button>} />
      <main className="space-y-5 px-5 py-6">
        <label className="flex h-12 items-center gap-3 rounded-full border border-sky-100 bg-sky-50 px-4 text-sm text-slate-500">
          <Search className="h-4 w-4 text-sky-600" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search order number"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['all', 'pending', 'confirmed', 'assigned', 'delivered'].map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cx('shrink-0 rounded-full px-4 py-2 text-xs font-bold capitalize', filter === item ? 'bg-sky-600 text-white' : 'border border-sky-100 bg-white text-slate-500')}
            >
              {item}
            </button>
          ))}
        </div>
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            Loading orders...
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center">
            <p className="text-sm font-bold text-slate-950">No orders found</p>
            <p className="mt-1 text-sm text-slate-500">Your submitted delivery requests will appear here.</p>
          </div>
        )}
        <div className="space-y-4">
          {filtered.map(order => <OrderCard key={order.id} order={order} onView={() => onView(order)} onEdit={() => onEdit(order)} />)}
        </div>
      </main>
    </>
  )
}

function OrderCard({ order, onView, onEdit }) {
  const editable = order.status === 'pending' && order.type === 'Book Delivery'
  return (
    <article className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-100/80">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-700">{order.type === 'Book Delivery' ? 'B' : 'S'}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">{order.orderNumber}</p>
            <p className="text-sm text-slate-500">{order.type}</p>
          </div>
        </div>
        <span className={cx('shrink-0 rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.status))}>{order.status}</span>
      </div>
      <p className="mt-5 text-sm font-semibold text-slate-950">
        {order.pickup ? `Pickup: ${order.pickup} to Drop: ${order.drop}` : `Delivery: ${order.drop}`}
      </p>
      <p className="mt-1 text-sm text-slate-500">{order.schedule}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-slate-50 p-3">
        <div>
          <p className="text-xs text-slate-500">Invoice</p>
          <p className="mt-1 text-xs font-semibold text-slate-950">{order.invoice}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Payment</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{order.payment}</p>
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={onView} className="rounded-lg bg-sky-100 px-5 py-2 text-sm font-bold text-sky-700">View</button>
        {editable && <button type="button" onClick={onEdit} className="rounded-lg bg-emerald-100 px-5 py-2 text-sm font-bold text-emerald-700">Edit</button>}
      </div>
    </article>
  )
}

function OrderDetailsScreen({ order, onEdit, onBack }) {
  if (!order) {
    return (
      <>
        <Header title="Order Details" subtitle="No order selected" back onBack={onBack} />
        <main className="px-5 py-6">
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            Select an order from My Orders.
          </div>
        </main>
      </>
    )
  }

  const timeline = [
    ['Awaiting Pickup', 'Awaiting Pickup'],
    ['Picked Up', 'Picked Up'],
    ['In Transit', 'In Transit'],
    ['Delivered', 'Delivered'],
  ].map(([label, step]) => {
    const state = deliveryTimelineState(order, step)
    return [label, state, timelineTone(state)]
  })
  const raw = order.raw || {}
  const invoices = order.invoices || []
  const payments = order.payments || []

  return (
    <>
      <Header title="Order Details" subtitle={order.orderNumber} back onBack={onBack} right={<span className={cx('rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.status))}>{order.status}</span>} />
      <main className="space-y-5 px-5 py-6">
        <Section title={order.type} subtitle={raw.order_source === 'external' ? 'Customer-created external request' : 'Delivery order'}>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-slate-50 p-3">
            <div>
              <p className="text-xs text-slate-500">Pickup</p>
              <p className="mt-1 text-sm font-semibold">{order.pickup || 'Not provided'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Drop</p>
              <p className="mt-1 text-sm font-semibold">{order.drop || 'Not provided'}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-white p-3">
            <div>
              <p className="text-xs text-slate-500">Payment status</p>
              <p className="mt-1 text-sm font-semibold capitalize">{order.paymentStatus || 'unpaid'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Delivery status</p>
              <p className="mt-1 text-sm font-semibold">{order.deliveryStatus || 'Awaiting Pickup'}</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3">
            <p className="text-xs text-slate-500">Total amount</p>
            <p className="mt-1 text-sm font-semibold">{formatMoney(raw.total_amount, raw.currency)}</p>
          </div>
          <div className="mt-3 space-y-2">
            <InfoLine label="Created" value={formatDateTime(raw.created_at)} />
            {raw.special_instructions && <InfoLine label="Notes" value={raw.special_instructions} />}
          </div>
        </Section>
        <Section title="Schedule">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <CalendarClock className="h-5 w-5 text-sky-600" />
            {order.schedule}
          </div>
        </Section>
        <Section title="Items / Requirements" subtitle="from order_items">
          <div className="space-y-2">
            {(raw.order_items || []).filter(item => !item.is_deleted).length > 0 ? (
              (raw.order_items || []).filter(item => !item.is_deleted).map((item, index) => (
                <div key={item.id || index} className="flex items-start gap-3 rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-950">{item.parcel_description || item.item_type || 'Item'}</p>
                    <p className="mt-1 text-xs text-slate-500">Qty {Number(item.quantity || 0).toFixed(0)} / {formatMoney(item.line_total, raw.currency)}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm text-slate-500">No item rows available.</div>
            )}
          </div>
        </Section>
        <Section title="Retail Goods Invoices" subtitle="retail_goods_invoices">
          <div className="space-y-3">
            {invoices.length > 0 ? invoices.map(invoice => (
              <div key={invoice.id} className="rounded-lg border border-sky-100 bg-slate-50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-950">{invoice.shop_name || 'Invoice'}</p>
                    <p className="mt-1 text-xs text-slate-500">{invoice.invoice_reference || 'No reference'} / {invoice.invoice_date || 'No date'}</p>
                  </div>
                  <span className={cx('shrink-0 rounded-full px-2 py-1 text-[11px] font-bold', invoice.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700')}>
                    {invoice.paid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold">{formatMoney(invoice.invoice_value, invoice.currency)}</p>
              </div>
            )) : (
              <InfoLine label="Invoice" value="Waiting for quotation" />
            )}
          </div>
        </Section>
        <Section title="Payment Collections" subtitle="payment_collections">
          <div className="space-y-3">
            {payments.length > 0 ? payments.map(payment => (
              <div key={payment.id} className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-3">
                <p className="text-sm font-bold capitalize text-orange-800">{payment.collection_type || 'Payment'}</p>
                <p className="mt-1 text-xs text-orange-700">{formatDateTime(payment.collected_at)}</p>
                <p className="mt-3 text-sm font-semibold text-slate-950">
                  USD {Number(payment.amount_usd || 0).toFixed(2)}
                  {Number(payment.amount_lbp || 0) > 0 ? ` / LBP ${Number(payment.amount_lbp).toFixed(0)}` : ''}
                </p>
              </div>
            )) : (
              <InfoLine label="Collection" value="No payment collected yet" tone="amber" />
            )}
          </div>
        </Section>
        <Section title="Status Timeline">
          <div className="space-y-4">
            {timeline.map(([label, state, classes]) => (
              <div key={label} className="flex items-center gap-3">
                <span className={cx('h-4 w-4 rounded-full', classes.split(' ')[1])} />
                <span className="flex-1 text-sm font-medium">{label}</span>
                <span className={cx('text-xs font-semibold', classes.split(' ')[0])}>{state}</span>
              </div>
            ))}
          </div>
        </Section>
        {order.status === 'pending' && order.type === 'Book Delivery' && (
          <button type="button" onClick={() => onEdit(order)} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-100 text-sm font-bold text-emerald-700">
            <Pencil className="h-4 w-4" />
            Edit Order
          </button>
        )}
      </main>
    </>
  )
}

function InfoLine({ label, value, tone }) {
  return (
    <div className={cx('rounded-lg border px-3 py-3', tone === 'amber' ? 'border-orange-200 bg-orange-50' : 'border-sky-100 bg-slate-50')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('mt-1 text-sm font-semibold', tone === 'amber' ? 'text-orange-700' : 'text-slate-950')}>{value}</p>
    </div>
  )
}

function EditOrderScreen({ order, requirements, setRequirements, customerSession, onSave, onBack }) {
  const raw = order?.raw || {}
  const [pickupAddress, setPickupAddress] = useState(raw.pickup_address || order?.pickup || '')
  const [deliveryAddress, setDeliveryAddress] = useState(raw.delivery_address || order?.drop || '')
  const [scheduledDate, setScheduledDate] = useState(raw.scheduled_date || todayDate())
  const [scheduledFrom, setScheduledFrom] = useState(raw.scheduled_time_from ? String(raw.scheduled_time_from).slice(0, 5) : '')
  const [scheduledTo, setScheduledTo] = useState(raw.scheduled_time_to ? String(raw.scheduled_time_to).slice(0, 5) : '')
  const [notes, setNotes] = useState(raw.special_instructions || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!order) return
    const current = order.raw || {}
    setPickupAddress(current.pickup_address || order.pickup || '')
    setDeliveryAddress(current.delivery_address || order.drop || '')
    setScheduledDate(current.scheduled_date || todayDate())
    setScheduledFrom(current.scheduled_time_from ? String(current.scheduled_time_from).slice(0, 5) : '')
    setScheduledTo(current.scheduled_time_to ? String(current.scheduled_time_to).slice(0, 5) : '')
    setNotes(current.special_instructions || '')
  }, [order])

  function addRequirement() {
    setRequirements(items => [...items, ''])
  }

  function updateRequirement(index, value) {
    setRequirements(items => items.map((item, i) => (i === index ? value : item)))
  }

  function removeRequirement(index) {
    setRequirements(items => items.filter((_, i) => i !== index))
  }

  async function saveChanges() {
    setError('')

    if (!order?.id) {
      setError('Select an order before saving.')
      return
    }
    if (order.status !== 'pending') {
      setError('This order is already confirmed and cannot be edited.')
      return
    }

    const cleanRequirements = requirements.map(item => item.trim()).filter(Boolean)
    if (!deliveryAddress.trim()) {
      setError('Delivery/drop location is required.')
      return
    }
    if (cleanRequirements.length === 0) {
      setError('Add at least one requirement row.')
      return
    }

    setSaving(true)

    const { data: latest, error: latestError } = await supabase
      .from('delivery_orders')
      .select('status')
      .eq('id', order.id)
      .single()

    if (latestError) {
      setError(latestError.message)
      setSaving(false)
      return
    }
    if (latest?.status !== 'pending') {
      setError('This order is no longer pending. Please reopen My Orders.')
      setSaving(false)
      return
    }

    const orderDetailsText = cleanRequirements.join('\n')
    const updatePayload = {
      pickup_address: pickupAddress.trim() || null,
      delivery_address: deliveryAddress.trim(),
      scheduled_date: scheduledDate || null,
      scheduled_time_from: scheduledFrom || null,
      scheduled_time_to: scheduledTo || null,
      order_details_text: orderDetailsText,
      special_instructions: notes.trim() || null,
      updated_at: new Date().toISOString(),
    }

    const { error: orderError } = await supabase
      .from('delivery_orders')
      .update(updatePayload)
      .eq('id', order.id)
      .eq('status', 'pending')

    if (orderError) {
      setError(orderError.message)
      setSaving(false)
      return
    }

    const { error: softDeleteError } = await supabase
      .from('order_items')
      .update({
        is_deleted: true,
        deleted_by: customerSession?.user_id || null,
        deleted_at: new Date().toISOString(),
      })
      .eq('order_id', order.id)
      .eq('is_deleted', false)

    if (softDeleteError) {
      setError(softDeleteError.message)
      setSaving(false)
      return
    }

    const itemRows = cleanRequirements.map(item => ({
      order_id: order.id,
      item_type: 'external_request',
      parcel_description: item,
      quantity: 1,
      unit_price: 0,
      currency: raw.currency || 'USD',
      line_total: 0,
      added_by: customerSession?.user_id || null,
    }))

    const { data: insertedItems, error: itemError } = await supabase
      .from('order_items')
      .insert(itemRows)
      .select('id,item_type,parcel_description,quantity,line_total,is_deleted')

    if (itemError) {
      setError(itemError.message)
      setSaving(false)
      return
    }

    const updatedRaw = {
      ...raw,
      ...updatePayload,
      status: 'pending',
      order_items: insertedItems || [],
    }
    onSave(mapCustomerOrder(updatedRaw, order.invoices || [], order.payments || []))
    setSaving(false)
  }

  if (!order) {
    return (
      <>
        <Header title="Edit Order" subtitle="No order selected" back onBack={onBack} />
        <main className="px-5 py-6">
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            Select an order from My Orders.
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header title="Edit Order" subtitle={order.orderNumber} back onBack={onBack} right={<span className={cx('rounded-full px-3 py-1 text-xs font-bold capitalize', statusClass(order.status))}>{order.status}</span>} />
      <main className="space-y-5 px-5 py-6">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Changes update the same order. No new order number.
        </div>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <Section
          title="Requirement Rows"
          subtitle="Saved back to order_items"
          action={<button type="button" onClick={addRequirement} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">Add</button>}
        >
          <div className="space-y-3">
            {requirements.map((item, index) => (
              <div key={index} className="flex items-center gap-2 rounded-lg border border-sky-100 bg-slate-50 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-xs font-bold text-sky-700">{index + 1}</span>
                <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={item} onChange={event => updateRequirement(index, event.target.value)} placeholder="Enter requirement" />
                <button type="button" onClick={() => removeRequirement(index)} className="text-rose-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Pickup & Drop">
          <div className="space-y-4">
            <ControlledField label="Pickup location" value={pickupAddress} onChange={setPickupAddress} />
            <ControlledField label="Delivery / drop location" value={deliveryAddress} onChange={setDeliveryAddress} />
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Notes</span>
              <textarea
                className="mt-2 min-h-24 w-full rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-300"
                value={notes}
                onChange={event => setNotes(event.target.value)}
              />
            </label>
          </div>
        </Section>

        <Section title="Schedule">
          <div className="grid grid-cols-2 gap-3">
            <ControlledField label="Delivery date" value={scheduledDate} onChange={setScheduledDate} type="date" />
            <ControlledField label="Start time" value={scheduledFrom} onChange={setScheduledFrom} type="time" />
            <ControlledField label="End time" value={scheduledTo} onChange={setScheduledTo} type="time" />
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={saveChanges} disabled={saving || order.status !== 'pending'} className="flex h-12 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button type="button" onClick={onBack} disabled={saving} className="flex h-12 items-center justify-center rounded-lg border border-sky-100 bg-white text-sm font-bold text-slate-500 disabled:opacity-60">
            Cancel
          </button>
        </div>
      </main>
    </>
  )
}

function ProfileScreen({ customerSession, onSessionUpdate, onLogout }) {
  const [profile, setProfile] = useState(null)
  const [addresses, setAddresses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingAddress, setEditingAddress] = useState(null)
  const [addressForm, setAddressForm] = useState(emptyAddressForm)
  const [mobileInput, setMobileInput] = useState(customerSession?.mobile || '')

  async function loadProfile() {
    setLoading(true)
    setError('')

    if (!customerSession?.contact_id) {
      setProfile(null)
      setAddresses([])
      setError('Customer profile is not linked to this login.')
      setLoading(false)
      return
    }

    const [profileResult, addressResult] = await Promise.all([
      supabase
        .from('contacts')
        .select('id,code,account_number,first_name,last_name,mobile,whatsapp_number,email,address,city,credit_debit_allowed,profile_photo_url')
        .eq('id', customerSession.contact_id)
        .single(),
      supabase
        .from('contact_addresses')
        .select('*')
        .eq('contact_id', customerSession.contact_id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

    if (profileResult.error) {
      setError(profileResult.error.message)
      setLoading(false)
      return
    }
    if (addressResult.error) {
      setError(addressResult.error.message)
      setLoading(false)
      return
    }

    setProfile(profileResult.data)
    setMobileInput(profileResult.data?.mobile || customerSession?.mobile || '')
    setAddresses(addressResult.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadProfile()
  }, [customerSession])

  function startAddAddress() {
    setEditingAddress('new')
    setAddressForm(emptyAddressForm)
    setError('')
  }

  function startEditAddress(address) {
    setEditingAddress(address.id)
    setAddressForm({
      address_name: address.address_name || '',
      reference: address.reference || '',
      address_line: address.address_line || '',
      city: address.city || '',
      phone: address.phone || '',
      notes: address.notes || '',
      is_primary: !!address.is_primary,
    })
    setError('')
  }

  function addressField(key, value) {
    setAddressForm(current => ({ ...current, [key]: value }))
    setError('')
  }

  async function uploadProfilePhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')

    if (!file.type.startsWith('image/')) {
      setError('Select an image file.')
      return
    }
    if (file.size > 750 * 1024) {
      setError('Photo must be below 750 KB for now.')
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      setSaving(true)
      const photoUrl = String(reader.result || '')
      const { error: photoError } = await supabase
        .from('contacts')
        .update({ profile_photo_url: photoUrl, updated_at: new Date().toISOString() })
        .eq('id', customerSession.contact_id)

      if (photoError) {
        setError(photoError.message)
        setSaving(false)
        return
      }

      setProfile(current => current ? { ...current, profile_photo_url: photoUrl } : current)
      setSaving(false)
    }
    reader.readAsDataURL(file)
  }

  async function saveMobileChange() {
    setError('')
    if (!mobileInput.trim()) {
      setError('Mobile number is required.')
      return
    }

    setSaving(true)
    const { data, error: mobileError } = await supabase.rpc('customer_update_mobile', {
      p_user_id: customerSession.user_id,
      p_contact_id: customerSession.contact_id,
      p_mobile: mobileInput.trim(),
    })

    if (mobileError) {
      const message = mobileError.message || ''
      if (message.includes('MOBILE_ALREADY_EXISTS')) setError('This mobile number is already used by another customer.')
      else if (message.includes('MOBILE_REQUIRED')) setError('Mobile number is required.')
      else setError('Mobile number update failed. Please try again.')
      setSaving(false)
      return
    }

    const updatedMobile = data?.[0]?.mobile || mobileInput.trim()
    const nextSession = saveCustomerSession({
      ...customerSession,
      username: updatedMobile,
      mobile: updatedMobile,
    })
    onSessionUpdate(nextSession)
    setProfile(current => current ? { ...current, mobile: updatedMobile, whatsapp_number: updatedMobile } : current)
    setSaving(false)
  }

  async function saveAddress() {
    setError('')
    if (!customerSession?.contact_id) {
      setError('Customer profile is not linked to this login.')
      return
    }
    if (!addressForm.address_name.trim()) {
      setError('Address name is required.')
      return
    }
    if (!addressForm.address_line.trim()) {
      setError('Address line is required.')
      return
    }

    setSaving(true)

    if (addressForm.is_primary) {
      const { error: clearError } = await supabase
        .from('contact_addresses')
        .update({ is_primary: false, updated_by: customerSession.user_id || null })
        .eq('contact_id', customerSession.contact_id)
      if (clearError) {
        setError(clearError.message)
        setSaving(false)
        return
      }
    }

    const payload = {
      address_name: addressForm.address_name.trim(),
      reference: addressForm.reference.trim() || null,
      address_line: addressForm.address_line.trim(),
      city: addressForm.city.trim() || null,
      phone: addressForm.phone.trim() || null,
      notes: addressForm.notes.trim() || null,
      is_primary: !!addressForm.is_primary,
      is_active: true,
      updated_by: customerSession.user_id || null,
      updated_at: new Date().toISOString(),
    }

    const result = editingAddress === 'new'
      ? await supabase
          .from('contact_addresses')
          .insert([{
            contact_id: customerSession.contact_id,
            ...(COMPANY_ID ? { company_id: COMPANY_ID } : {}),
            created_by: customerSession.user_id || null,
            ...payload,
          }])
      : await supabase
          .from('contact_addresses')
          .update(payload)
          .eq('id', editingAddress)
          .eq('contact_id', customerSession.contact_id)

    if (result.error) {
      setError(result.error.message)
      setSaving(false)
      return
    }

    setEditingAddress(null)
    setAddressForm(emptyAddressForm)
    await loadProfile()
    setSaving(false)
  }

  async function setPrimaryAddress(address) {
    setSaving(true)
    setError('')
    const { error: clearError } = await supabase
      .from('contact_addresses')
      .update({ is_primary: false, updated_by: customerSession?.user_id || null })
      .eq('contact_id', customerSession.contact_id)
    if (clearError) {
      setError(clearError.message)
      setSaving(false)
      return
    }
    const { error: setErrorResult } = await supabase
      .from('contact_addresses')
      .update({ is_primary: true, updated_by: customerSession?.user_id || null, updated_at: new Date().toISOString() })
      .eq('id', address.id)
      .eq('contact_id', customerSession.contact_id)
    if (setErrorResult) setError(setErrorResult.message)
    await loadProfile()
    setSaving(false)
  }

  async function deleteAddress(address) {
    setSaving(true)
    setError('')
    const { error: deleteError } = await supabase
      .from('contact_addresses')
      .update({ is_active: false, updated_by: customerSession?.user_id || null, updated_at: new Date().toISOString() })
      .eq('id', address.id)
      .eq('contact_id', customerSession.contact_id)
    if (deleteError) setError(deleteError.message)
    await loadProfile()
    setSaving(false)
  }

  const profileName = profile ? customerName(profile) : customerSession?.first_name || 'Customer'

  return (
    <>
      <Header title="Profile" subtitle="Account and saved addresses" right={<button className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><User className="h-5 w-5" /></button>} />
      <main className="space-y-5 px-5 py-6">
        {loading && (
          <div className="rounded-lg border border-sky-100 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
            Loading profile...
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {!loading && (
          <Section title={profileName} subtitle={profile?.code || profile?.account_number || 'Customer account'}>
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sky-100 text-2xl font-bold text-sky-700">
              {profile?.profile_photo_url ? (
                <img src={profile.profile_photo_url} alt={profileName} className="h-full w-full object-cover" />
              ) : (
                profileName.slice(0, 1).toUpperCase()
              )}
            </div>
            <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white">
              <Upload className="h-4 w-4" />
              Photo
              <input type="file" accept="image/*" className="hidden" onChange={uploadProfilePhoto} disabled={saving} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={cx('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold', profile?.credit_debit_allowed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {profile?.credit_debit_allowed ? 'Credit/Debit Allowed' : 'Cash Only'}
            </span>
          </div>
          <div className="mt-4 rounded-lg border border-sky-100 bg-slate-50 p-3">
            <p className="text-sm font-semibold">Mobile {profile?.mobile || customerSession?.mobile || 'Not set'}</p>
            <p className="mt-1 text-xs text-slate-500">WhatsApp {profile?.whatsapp_number || profile?.mobile || 'Not set'}</p>
            <p className="mt-1 text-xs text-slate-500">Email {profile?.email || 'Not set'}</p>
          </div>
          </Section>
        )}

        {!loading && (
          <Section title="Mobile Number" subtitle="Used for login and WhatsApp">
            <div className="space-y-3">
              <ControlledField label="Mobile number" value={mobileInput} onChange={setMobileInput} />
              <button type="button" onClick={saveMobileChange} disabled={saving || mobileInput.trim() === (profile?.mobile || '').trim()} className="flex h-11 w-full items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
                {saving ? 'Saving...' : 'Update Mobile Number'}
              </button>
            </div>
          </Section>
        )}

        {editingAddress && (
          <Section title={editingAddress === 'new' ? 'Add Address' : 'Edit Address'}>
            <div className="space-y-4">
              <ControlledField label="Address name" value={addressForm.address_name} onChange={value => addressField('address_name', value)} />
              <ControlledField label="Reference" value={addressForm.reference} onChange={value => addressField('reference', value)} />
              <ControlledField label="Address line" value={addressForm.address_line} onChange={value => addressField('address_line', value)} />
              <div className="grid grid-cols-2 gap-3">
                <ControlledField label="City" value={addressForm.city} onChange={value => addressField('city', value)} />
                <ControlledField label="Phone" value={addressForm.phone} onChange={value => addressField('phone', value)} />
              </div>
              <label className="flex items-center gap-3 rounded-lg border border-sky-100 bg-slate-50 px-3 py-3 text-sm font-semibold">
                <input type="checkbox" checked={addressForm.is_primary} onChange={event => addressField('is_primary', event.target.checked)} />
                Primary address
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={saveAddress} disabled={saving} className="flex h-11 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white disabled:bg-slate-300">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditingAddress(null)} disabled={saving} className="flex h-11 items-center justify-center rounded-lg border border-sky-100 bg-white text-sm font-bold text-slate-500 disabled:opacity-60">
                  Cancel
                </button>
              </div>
            </div>
          </Section>
        )}

        <Section title="Saved Addresses" subtitle="Used for pickup and drop locations" action={<button type="button" onClick={startAddAddress} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white">Add</button>}>
          <div className="space-y-3">
            {addresses.length === 0 && (
              <div className="rounded-lg border border-sky-100 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                No saved addresses yet.
              </div>
            )}
            {addresses.map(address => (
              <div key={address.id} className="rounded-lg border border-sky-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold">{address.address_name}</p>
                      <p className="mt-1 text-sm text-slate-500">{addressText(address) || 'No address line'}</p>
                      {address.reference && <p className="mt-1 text-xs text-slate-400">{address.reference}</p>}
                    </div>
                  </div>
                  {address.is_primary && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">Primary</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!address.is_primary && <button type="button" onClick={() => setPrimaryAddress(address)} disabled={saving} className="rounded-lg bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Set primary</button>}
                  <button type="button" onClick={() => startEditAddress(address)} disabled={saving} className="rounded-lg border border-sky-100 bg-white px-3 py-1 text-xs font-semibold text-slate-500">Edit</button>
                  <button type="button" onClick={() => deleteAddress(address)} disabled={saving} className="rounded-lg bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Preferences">
          <InfoLine label="Default payment" value={profile?.credit_debit_allowed ? 'Credit/Debit allowed' : 'Cash on delivery'} />
          <div className="mt-3">
            <InfoLine label="Notifications" value={profile?.email ? 'WhatsApp + Email' : 'WhatsApp'} />
          </div>
        </Section>

        <button type="button" onClick={onLogout} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white text-sm font-bold text-rose-600">
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </main>
    </>
  )
}

export default function CustomerMobileApp() {
  const initialRoute = customerRouteFromHash()
  const initialSession = loadCustomerSession()
  const devBypass = isDevelopmentBypass()
  const [customerSession, setCustomerSession] = useState(initialSession)
  const [isLoggedIn, setIsLoggedIn] = useState(!!initialSession || devBypass)
  const [screen, setScreen] = useState(initialRoute)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [requirements, setRequirements] = useState(initialRequirements)
  const [deliveryStatusByOrder, setDeliveryStatusByOrder] = useState({})
  const [deliveryNotice, setDeliveryNotice] = useState(null)

  useEffect(() => {
    if (!isLoggedIn || !customerSession?.contact_id) return undefined

    let cancelled = false

    async function loadInitialDeliveryStatuses() {
      let query = supabase
        .from('delivery_orders')
        .select('id,delivery_status')
        .eq('customer_id', customerSession.contact_id)
      if (COMPANY_ID) query = query.eq('company_id', COMPANY_ID)

      const { data } = await query
      if (cancelled) return

      setDeliveryStatusByOrder((data || []).reduce((acc, order) => {
        acc[order.id] = order.delivery_status || 'Awaiting Pickup'
        return acc
      }, {}))
    }

    loadInitialDeliveryStatuses()

    const channel = supabase
      .channel(`customer-delivery-status-${customerSession.contact_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'delivery_orders',
          filter: `customer_id=eq.${customerSession.contact_id}`,
        },
        payload => {
          const updatedOrder = payload.new
          const nextStatus = updatedOrder.delivery_status || 'Awaiting Pickup'

          setDeliveryStatusByOrder(current => {
            const previousStatus = current[updatedOrder.id]
            if (previousStatus && previousStatus !== nextStatus) {
              setDeliveryNotice({
                orderId: updatedOrder.id,
                orderNumber: updatedOrder.order_number,
                deliveryStatus: nextStatus,
              })
            }
            return { ...current, [updatedOrder.id]: nextStatus }
          })

          setSelectedOrder(current => {
            if (!current || current.id !== updatedOrder.id) return current
            return {
              ...current,
              deliveryStatus: nextStatus,
              status: updatedOrder.status || current.status,
              paymentStatus: updatedOrder.payment_status || current.paymentStatus,
              raw: {
                ...(current.raw || {}),
                ...updatedOrder,
              },
            }
          })
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [isLoggedIn, customerSession])

  if (!isLoggedIn && screen === 'otp') {
    return (
      <OtpScreen
        onDone={async customer => {
          if (!COMPANY_ID) throw new Error('Company is not configured for customer registration.')

          const { data, error } = await supabase.rpc('customer_register_with_password', {
            p_company_id: COMPANY_ID,
            p_full_name: customer.full_name,
            p_mobile: customer.mobile,
            p_email: customer.email,
            p_otp_channel: customer.otp_channel,
            p_password: customer.password,
          })

          if (error) {
            const message = error.message || ''
            if (message.includes('CUSTOMER_ALREADY_EXISTS')) {
              throw new Error('This customer already exists. Please login with the same email/mobile and password.')
            }
            if (message.includes('PASSWORD_TOO_SHORT')) {
              throw new Error('Password must be at least 8 characters.')
            }
            if (message.includes('COMPANY_REQUIRED')) {
              throw new Error('Company is not configured for customer registration.')
            }
            throw new Error('Customer registration failed. Please try again.')
          }

          const user = data?.[0]
          if (!user?.contact_id) throw new Error('Customer registration did not return a customer profile.')

          const session = saveCustomerSession(user)
          setCustomerSession(session)
          setIsLoggedIn(true)
          setScreen('home')
          setCustomerHash('home')
        }}
        onBack={() => setScreen('login')}
      />
    )
  }

  if (!isLoggedIn) {
    return <LoginScreen onLogin={session => { setCustomerSession(session); setIsLoggedIn(true); setScreen('home'); setCustomerHash('home') }} onOtp={() => setScreen('otp')} />
  }

  function goTab(tab) {
    setScreen(tab)
    setCustomerHash(tab)
  }

  function openOrder(order) {
    setSelectedOrder(order)
    setScreen('orderDetails')
  }

  function editOrder(order) {
    if (!order) return
    setSelectedOrder(order)
    setRequirements(order.requirements || initialRequirements)
    setScreen('editOrder')
  }

  function finishOrderEdit(updatedOrder) {
    setSelectedOrder(updatedOrder)
    setRequirements(updatedOrder.requirements || initialRequirements)
    setScreen('orderDetails')
  }

  async function logoutCustomer() {
    if (customerSession?.user_id) {
      try {
        await supabase.rpc('logout_user', { p_user_id: customerSession.user_id })
      } catch {
        // Local logout should still proceed even if audit logging is unavailable.
      }
    }
    clearCustomerSession()
    setCustomerSession(null)
    setIsLoggedIn(false)
    setSelectedOrder(null)
    setDeliveryNotice(null)
    setDeliveryStatusByOrder({})
    setScreen('login')
    setCustomerHash('login')
  }

  let content
  let activeTab = screen

  if (screen === 'book') {
    content = <BookDeliveryScreen requirements={requirements} setRequirements={setRequirements} customerSession={customerSession} />
  } else if (screen === 'orders') {
    content = <OrdersScreen customerSession={customerSession} onView={openOrder} onEdit={editOrder} />
  } else if (screen === 'orderDetails') {
    activeTab = 'orders'
    content = <OrderDetailsScreen order={selectedOrder} onEdit={editOrder} onBack={() => setScreen('orders')} />
  } else if (screen === 'editOrder') {
    activeTab = 'orders'
    content = <EditOrderScreen order={selectedOrder} requirements={requirements} setRequirements={setRequirements} customerSession={customerSession} onBack={() => setScreen('orderDetails')} onSave={finishOrderEdit} />
  } else if (screen === 'profile') {
    content = <ProfileScreen customerSession={customerSession} onSessionUpdate={setCustomerSession} onLogout={logoutCustomer} />
  } else {
    activeTab = 'home'
    content = (
      <HomeScreen
        customerSession={customerSession}
        onBook={() => setScreen('book')}
        onOrders={() => setScreen('orders')}
        onProfile={() => setScreen('profile')}
        onViewOrder={openOrder}
        onEditOrder={editOrder}
      />
    )
  }

  return (
    <Shell activeTab={activeTab} onTab={goTab}>
      <DeliveryStatusNotice
        notice={deliveryNotice}
        onClose={() => setDeliveryNotice(null)}
        onOpenOrders={() => {
          setDeliveryNotice(null)
          setScreen('orders')
          setCustomerHash('orders')
        }}
      />
      {content}
    </Shell>
  )
}
