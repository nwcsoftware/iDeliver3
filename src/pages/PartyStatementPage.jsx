import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Wallet, Package, Truck, Building, HandCoins, Clock, CheckCircle2, AlertCircle,
  Search, Calendar, Percent, Store, Smartphone, Headphones, X, FileDown,
} from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { buildPartyStatement, SOURCES, bagText, money } from '../lib/partyStatement'
import { partnerName } from '../lib/partnerDues'

const todayStr = (d = new Date()) => {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const monthStart = () => todayStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

const SOURCE_ICON = { partner: Store, customer: Smartphone, office: Headphones }
const SOURCE_TONE = {
  partner:  'bg-teal-500/10 text-teal-300 border-teal-500/30',
  customer: 'bg-brand-500/10 text-brand-300 border-brand-500/30',
  office:   'bg-amber-500/10 text-amber-300 border-amber-500/30',
}

/* Statement for one supplier / partner.

   The same page serves two readers:
     • the portal — `partyContactId` is fixed to the signed-in shop, which sees
       only itself;
     • the office — no id is passed, so a picker appears and the call centre can
       read any supplier's or partner's account.

   Everything is derived (lib/partyStatement); nothing here writes. */
export default function PartyStatementPage({ partyContactId = null }) {
  const { currentUser, hasRole } = useAuth()
  const { orders, loading, loadFullOrderHistory } = useApp()

  const isOffice = !partyContactId && hasRole('super_admin', 'admin', 'call_center')
  const ownId    = partyContactId || currentUser?.contact_id || null

  // A statement spans months, not the startup window.
  useEffect(() => { loadFullOrderHistory?.() }, [loadFullOrderHistory])

  const [parties,   setParties]   = useState([])
  const [pickedId,  setPickedId]  = useState(ownId || '')
  const [partySearch, setPartySearch] = useState('')
  const [payouts,   setPayouts]   = useState([])
  const [from,      setFrom]      = useState(monthStart())
  const [to,        setTo]        = useState(todayStr())
  const [sourceFilter, setSourceFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')   // '' | scheduled | delivered
  const [error,     setError]     = useState('')

  const contactId = partyContactId || pickedId || null
  const party = parties.find(p => p.id === contactId) || null

  // The office needs the list of shops to choose from; the portal never does.
  useEffect(() => {
    if (!isOffice) return undefined
    let alive = true
    ;(async () => {
      const { data, error: e } = await fetchAllRows(() => supabase
        .from('contacts')
        .select('id, first_name, last_name, company_name, code, contact_types, partner_percentage, partner_percentage_type')
        .overlaps('contact_types', ['supplier', 'partner'])
        .order('company_name'))
      if (!alive) return
      if (e) setError(e.message)
      else setParties(data ?? [])
    })()
    return () => { alive = false }
  }, [isOffice])

  // The portal still wants the party's own profile, for the commission rate.
  useEffect(() => {
    if (isOffice || !ownId) return undefined
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('contacts')
        .select('id, first_name, last_name, company_name, code, contact_types, partner_percentage, partner_percentage_type')
        .eq('id', ownId).maybeSingle()
      if (alive && data) setParties([data])
    })()
    return () => { alive = false }
  }, [isOffice, ownId])

  const loadPayouts = useCallback(async () => {
    if (!contactId) { setPayouts([]); return }
    const { data, error: e } = await supabase
      .from('partner_payouts').select('*')
      .eq('partner_id', contactId)
      .order('paid_at', { ascending: false })
    if (e) setError(e.message)
    else   { setPayouts(data ?? []); setError('') }
  }, [contactId])
  useEffect(() => { loadPayouts() }, [loadPayouts])

  const { rows, totals, bySource } = useMemo(
    () => buildPartyStatement({ orders, payouts, contactId, from, to }),
    [orders, payouts, contactId, from, to])

  const visibleRows = rows.filter(r =>
    (!sourceFilter || r.source === sourceFilter)
    && (!statusFilter || (statusFilter === 'delivered' ? r.delivered : !r.delivered)))

  const partyOptions = parties.filter(p => {
    const q = partySearch.trim().toLowerCase()
    if (!q) return true
    return [partnerName(p), p.code].some(v => String(v ?? '').toLowerCase().includes(q))
  })

  /* One CSV of exactly what is on screen — shops ask for this to reconcile. */
  function exportCsv() {
    const head = ['Order', 'Date', 'Placed by', 'Status', 'Packages', 'Goods', 'Paid to shop directly',
                  'Commission', 'Delivery fee', 'Collected by driver', 'Collected at office']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = visibleRows.map(r => [
      r.orderNumber, r.date, SOURCES.find(s => s.key === r.source)?.label,
      r.delivered ? 'Delivered' : 'Scheduled', r.packages,
      bagText(r.goods), bagText(r.paidDirect), bagText(r.commission),
      bagText(r.fees), bagText(r.collectedDriver), bagText(r.collectedOffice),
    ].map(esc).join(','))
    const csv = [head.map(esc).join(','), ...body].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `statement-${partnerName(party) || 'shop'}-${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const Card = ({ icon: Icon, label, bag, tone = 'text-slate-100', hint }) => (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className={`mt-1.5 text-sm font-semibold tabular-nums ${tone}`}>{bagText(bag)}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">
            {isOffice ? 'Supplier & Partner Statements' : 'My Statement'}
          </h2>
        </div>

        {isOffice && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input className="input pl-9 py-1.5 text-xs w-48" placeholder="Find a shop…"
                value={partySearch} onChange={e => setPartySearch(e.target.value)} />
            </div>
            <select className="input py-1.5 text-xs w-64" value={pickedId}
              onChange={e => setPickedId(e.target.value)}>
              <option value="">— Choose a supplier or partner —</option>
              {partyOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {partnerName(p)}{p.code ? ` · ${p.code}` : ''}
                  {(p.contact_types ?? []).includes('supplier') ? ' · supplier' : ''}
                  {(p.contact_types ?? []).includes('partner')  ? ' · partner'  : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <input type="date" className="input py-1.5 text-xs w-36" value={from} onChange={e => setFrom(e.target.value)} />
          <span className="text-slate-600 text-xs">to</span>
          <input type="date" className="input py-1.5 text-xs w-36" value={to} onChange={e => setTo(e.target.value)} />
          <button onClick={() => { setFrom(monthStart()); setTo(todayStr()) }}
            className="btn-ghost py-1.5 px-2.5 text-xs text-slate-400 border border-surface-border">This month</button>
          <button onClick={exportCsv} disabled={visibleRows.length === 0}
            className="btn-ghost py-1.5 px-2.5 text-xs text-slate-400 border border-surface-border disabled:opacity-40">
            <FileDown className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-300 text-xs">{error}</p>
        </div>
      )}

      {!contactId ? (
        <div className="card px-4 py-12 text-center">
          <Store className="w-9 h-9 mx-auto text-slate-600" />
          <p className="mt-2 text-sm text-slate-400">
            {isOffice ? 'Choose a supplier or partner to read their statement.'
                      : 'Your login isn’t linked to a shop yet — ask an administrator to link it.'}
          </p>
        </div>
      ) : (
        <>
          {/* Who, and on what terms */}
          <div className="card px-4 py-3 flex items-center gap-3 flex-wrap">
            <Building className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-100">{partnerName(party)}</span>
            {party?.code && <span className="text-[11px] font-mono text-slate-500">{party.code}</span>}
            {(party?.contact_types ?? []).map(t => (
              <span key={t} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-surface-border text-slate-400">{t}</span>
            ))}
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-400">
              <Percent className="w-3.5 h-3.5" />
              Commission {Number(party?.partner_percentage) > 0
                ? <b className="text-slate-200">{party.partner_percentage}%</b>
                : <b className="text-slate-200">none</b>}
              {party?.partner_percentage_type && <span className="text-slate-500">({party.partner_percentage_type})</span>}
            </span>
          </div>

          {/* Orders, by state */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card icon={Clock}        label={`Scheduled · ${totals.scheduledCount}`} bag={totals.scheduled} tone="text-amber-300" />
            <Card icon={CheckCircle2} label={`Delivered · ${totals.deliveredCount}`} bag={totals.delivered} tone="text-green-300" />
            <Card icon={Package}      label="Goods sold"  bag={totals.goods} />
            <Card icon={HandCoins}    label="Paid to the shop directly" bag={totals.paidDirect}
              hint="Customer paid the shop — never held by us" />
          </div>

          {/* Money movement */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card icon={Truck}     label="Collected by drivers"  bag={totals.collectedDriver} tone="text-emerald-300" />
            <Card icon={Headphones} label="Collected at the call centre" bag={totals.collectedOffice} tone="text-sky-300" />
            <Card icon={Percent}   label="Commission we earned"  bag={totals.commission} tone="text-rose-300/90" />
            <Card icon={Truck}     label="Delivery fees charged" bag={totals.fees} tone="text-rose-300/90" />
            <Card icon={Wallet}    label="Received by the shop"  bag={totals.received} tone="text-teal-300"
              hint="Payouts already made" />
          </div>

          {/* The number both sides care about */}
          <div className="card p-4 border-brand-500/30 bg-brand-500/5 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-brand-300 font-semibold">Pending balance</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Goods sold − commission − delivery fees − payouts already received
              </p>
            </div>
            <p className="ml-auto text-xl font-bold tabular-nums text-brand-200">{bagText(totals.pending)}</p>
          </div>

          {/* Where the orders came from — and why commission differs */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {SOURCES.map(s => {
              const b = bySource[s.key]
              const Icon = SOURCE_ICON[s.key]
              const count = b.scheduledCount + b.deliveredCount
              return (
                <button key={s.key} type="button"
                  onClick={() => setSourceFilter(sourceFilter === s.key ? '' : s.key)}
                  className={`card p-3 text-left transition-colors ${
                    sourceFilter === s.key ? 'border-brand-500/50 bg-brand-500/5' : 'hover:bg-surface-hover/40'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border ${SOURCE_TONE[s.key]}`}>
                      <Icon className="w-3.5 h-3.5" /> {s.label}
                    </span>
                    <span className="ml-auto text-xs text-slate-400">{count} order{count === 1 ? '' : 's'}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-100 tabular-nums">{bagText(b.goods)}</p>
                  <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                    <p>Commission: <span className={Object.keys(b.commission).length ? 'text-rose-300/90' : 'text-slate-500'}>{bagText(b.commission)}</span></p>
                    <p>Delivery fees: {bagText(b.fees)}</p>
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-500">{s.hint}</p>
                </button>
              )
            })}
          </div>

          {/* Filters + the orders themselves */}
          <div className="flex items-center gap-2 flex-wrap">
            {['', 'scheduled', 'delivered'].map(v => (
              <button key={v || 'all'} onClick={() => setStatusFilter(v)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  statusFilter === v ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
                                     : 'text-slate-400 border-surface-border hover:bg-surface-hover'}`}>
                {v === '' ? 'All orders' : v === 'scheduled' ? 'Scheduled' : 'Delivered'}
              </button>
            ))}
            {(sourceFilter || statusFilter) && (
              <button onClick={() => { setSourceFilter(''); setStatusFilter('') }}
                className="btn-ghost py-1.5 px-2.5 text-xs text-slate-400 border border-surface-border">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
            <span className="ml-auto text-[11px] text-slate-500">
              {visibleRows.length} of {rows.length} order{rows.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1000px]">
                <thead>
                  <tr className="border-b border-surface-border">
                    {['Order #', 'Date', 'Placed by', 'Status', 'Pkgs', 'Goods', 'Paid direct',
                      'Commission', 'Delivery fee', 'By driver', 'At office'].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading?.orders ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-500 text-xs">Loading…</td></tr>
                  ) : visibleRows.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-500 text-xs">
                      No orders for this shop in the selected period.
                    </td></tr>
                  ) : visibleRows.map(r => {
                    const Icon = SOURCE_ICON[r.source]
                    return (
                      <tr key={r.id} className="border-b border-surface-border/50 hover:bg-surface-hover/30">
                        <td className="px-3 py-2 font-mono text-xs text-brand-300 whitespace-nowrap">{r.orderNumber || '—'}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">{r.date || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${SOURCE_TONE[r.source]}`}>
                            <Icon className="w-3 h-3" />
                            {SOURCES.find(s => s.key === r.source)?.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${
                            r.delivered ? 'bg-green-500/10 text-green-300 border-green-500/30'
                                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
                            {r.delivered ? (r.closed ? 'Delivered · closed' : 'Delivered') : 'Scheduled'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-300 tabular-nums text-xs">{r.packages || '—'}</td>
                        <td className="px-3 py-2 text-slate-100 tabular-nums text-xs whitespace-nowrap">{bagText(r.goods)}</td>
                        <td className="px-3 py-2 text-slate-400 tabular-nums text-xs whitespace-nowrap">{bagText(r.paidDirect)}</td>
                        <td className="px-3 py-2 text-rose-300/90 tabular-nums text-xs whitespace-nowrap">{bagText(r.commission)}</td>
                        <td className="px-3 py-2 text-rose-300/90 tabular-nums text-xs whitespace-nowrap">{bagText(r.fees)}</td>
                        <td className="px-3 py-2 text-emerald-300/90 tabular-nums text-xs whitespace-nowrap">{bagText(r.collectedDriver)}</td>
                        <td className="px-3 py-2 text-sky-300/90 tabular-nums text-xs whitespace-nowrap">{bagText(r.collectedOffice)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payouts, so "received" can be checked line by line */}
          {payouts.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-surface-border bg-surface-hover/30 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-teal-300" />
                <span className="text-sm font-medium text-slate-100">Payments received by the shop</span>
                <span className="ml-auto text-xs text-slate-400 tabular-nums">{bagText(totals.received)}</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {payouts.slice(0, 12).map(p => (
                    <tr key={p.id} className="border-b border-surface-border/40 last:border-b-0">
                      <td className="px-4 py-2 text-slate-400 text-xs whitespace-nowrap">{String(p.paid_at || '').slice(0, 10)}</td>
                      <td className="px-4 py-2 text-slate-200 tabular-nums text-xs">{money(p.amount, p.currency)}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{p.method || '—'}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">{p.paid_by_name || '—'}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">{p.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
