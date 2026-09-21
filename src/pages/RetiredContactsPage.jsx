import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Loader, Trash2, X, ShieldAlert,
  UserX, KeyRound, CheckSquare, Square, Search, RefreshCw, Archive,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import {
  scanContactReferences, summariseContactReferences, deleteContact,
  contactTableLabel, columnLabel, KIND_TEXT,
} from '../lib/contactDeletion'

/* Retired contacts — the shelf that deactivation puts things on, and the only
   door out of it (supabase-fix151.sql).

   Deactivating a contact hides it from everyone but the super admin. That was
   the whole story: hidden, and hidden for good, with no page that said what
   was on the shelf and no way to clear it. The plain delete on the Contacts
   page fails the moment anything still points at the row, and told the office
   only that something did — never what.

   So: the shelf, listed. And beside each one, a delete that reads the
   contact's footprint out of the database and shows it BEFORE asking, then
   removes the contact and everything that was only ever its own.

   Deleting is reachable from here and nowhere else, and only for contacts
   already retired. That is deliberate. Retiring runs a settlement check —
   open orders, unpaid package dues, an uncollected balance — so making this
   the only door means a contact that still owes money cannot be deleted, not
   because this page says so but because it could never have been retired. */

const nameOf = (c) =>
  (c?.company_name?.trim()) || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || '—'

const KIND_STYLE = {
  own:      'bg-red-500/10 text-red-300 border-red-500/30',
  orders:   'bg-orange-500/10 text-orange-300 border-orange-500/30',
  account:  'bg-red-500/10 text-red-300 border-red-500/30',
  audit:    'bg-amber-500/10 text-amber-300 border-amber-500/30',
  blocking: 'bg-rose-500/15 text-rose-200 border-rose-400/40',
}

export default function RetiredContactsPage() {
  const { refreshInactiveContacts, fetchOrders } = useApp()
  const { currentUser, hasRole } = useAuth()
  // Permanently erasing a counterparty and its history is the super admin's alone.
  const isSuper = hasRole('super_admin')

  const [list,    setList]    = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [search,  setSearch]  = useState('')

  const [target,       setTarget]       = useState(null)   // the contact under review
  const [phase,        setPhase]        = useState('idle') // idle|scanning|review|working|done
  const [rows,         setRows]         = useState([])
  const [report,       setReport]       = useState([])
  const [typed,        setTyped]        = useState('')
  const [deleteOrders, setDeleteOrders] = useState(false)
  const [error,        setError]        = useState('')

  /* Arriving from the Contacts page's delete button, which hands the contact
     over rather than keeping its own worse copy of this job. The review opens
     on that contact straight away — the super admin already said which one. */
  const [params, setParams] = useSearchParams()
  const wanted = params.get('contact')

  const load = useCallback(async () => {
    setLoading(true)
    /* Retired contacts only. Paged like every other contact read — the list is
       small today, but nothing here should be the one query that truncates.

       fetchAllRows hands back { data, error, partial }, not the rows. Taking
       the whole object for the list put a plain object where an array belongs,
       and the spread in `shown` below threw on the next render — which, with
       no error boundary anywhere in this app, blanked the screen rather than
       saying anything. */
    const { data, error: e, partial } = await fetchAllRows(() => supabase.from('contacts')
      .select('id, code, company_name, first_name, last_name, mobile, email, contact_types, account_number, updated_at, created_at')
      .eq('is_active', false)
      .order('id'))
    setList(Array.isArray(data) ? data : [])
    setListError(e ? `${e.message}${partial ? ' — showing what arrived.' : ''}` : '')
    setLoading(false)
  }, [])

  useEffect(() => { if (isSuper) load() }, [isSuper, load])

  /* Opening the named contact WITHOUT waiting for the shelf to load. Reading
     every retired contact first meant the page sat empty for as long as that
     query took, which read as the screen blinking blank on the way over. One
     row is all this needs, and it is fetched alongside the list rather than
     after it. */
  useEffect(() => {
    if (!isSuper || !wanted) return undefined
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('contacts')
        .select('id, code, company_name, first_name, last_name, mobile, email, contact_types, account_number')
        .eq('id', wanted).maybeSingle()
      if (!alive) return
      // Drop the parameter either way, so a reload does not reopen the review
      // and the back button does not walk into it again.
      setParams({}, { replace: true })
      if (data) review(data)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper, wanted])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rowsIn = q
      ? list.filter(c => [nameOf(c), c.code, c.mobile, c.email, c.account_number]
          .some(v => String(v ?? '').toLowerCase().includes(q)))
      : list
    return [...rowsIn].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  }, [list, search])

  const sum = useMemo(() => summariseContactReferences(rows), [rows])

  // What has to be typed back: the code when there is one, otherwise the name.
  const confirmWord = target?.code || nameOf(target)
  const armed = typed.trim().toLowerCase() === String(confirmWord).trim().toLowerCase()
  // Orders cannot be left behind — delivery_orders.customer_id is NOT NULL — so
  // when there are any, the tick is a condition of deleting at all.
  const ordersSettled = sum.orderRows === 0 || deleteOrders

  function close() {
    setTarget(null); setPhase('idle'); setRows([]); setReport([])
    setTyped(''); setError(''); setDeleteOrders(false)
  }

  async function review(c) {
    setTarget(c); setPhase('scanning'); setRows([]); setReport([])
    setTyped(''); setError(''); setDeleteOrders(false)
    const { rows: found, error: e } = await scanContactReferences(c.id, { actorId: currentUser?.user_id })
    setRows(found)
    setError(e || '')
    setPhase('review')
  }

  async function confirmDelete() {
    setPhase('working'); setError('')
    const { report: rep, error: e } = await deleteContact(target.id, {
      actorId: currentUser?.user_id,
      deleteOrders,
    })
    if (e) { setError(e); setPhase('review'); return }
    setReport(rep)
    setPhase('done')
    // The contact is gone and its orders with it — reload so nothing in the
    // app keeps pointing at either.
    load()
    refreshInactiveContacts?.()
    fetchOrders?.()
  }

  if (!isSuper) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        You don't have permission to access this page.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-5">

        <div className="flex items-start gap-3">
          <Archive className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 leading-relaxed">
            Contacts that have been deactivated. They are hidden from everyone else — from the lists, from every
            picker, and from the order lists — but nothing about them has been removed, and a super admin can bring
            any of them back from the Contacts page. Deleting one from here erases it and everything that was only
            ever its own. What is attached is read from the database and shown before anything is asked.
          </p>
        </div>

        {/* The shelf ──────────────────────────────────────────── */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-200">Deactivated contacts</h2>
            <span className="text-xs text-slate-500">
              {loading ? 'reading…' : `${shown.length}${shown.length !== list.length ? ` of ${list.length}` : ''}`}
            </span>
            <div className="relative ml-auto">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input className="input py-1.5 pl-7 text-xs w-56" value={search} placeholder="Search name, code, mobile…"
                onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn-ghost p-1.5 text-slate-500 hover:text-slate-200" onClick={load} title="Reload">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {listError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs">{listError}</p>
            </div>
          )}

          {loading ? (
            /* Rows in outline rather than a bare line of text: arriving here
               from the Contacts page replaces a full screen in one frame, and
               an almost-empty page reads as a blink. */
            <div className="rounded-lg border border-surface-border overflow-hidden divide-y divide-surface-border/50">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
                  <div className="h-3 w-20 rounded bg-surface-hover" />
                  <div className="h-3 w-40 rounded bg-surface-hover" />
                  <div className="h-3 w-16 rounded bg-surface-hover ml-auto" />
                </div>
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              {list.length === 0
                ? 'No contact has been deactivated. Nothing to clear.'
                : 'No retired contact matches that search.'}
            </p>
          ) : (
            <div className="rounded-lg border border-surface-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-hover/40 border-b border-surface-border">
                    {['Code', 'Name', 'Type', 'Mobile', 'Account', ''].map((h, i) => (
                      <th key={i} className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(c => (
                    <tr key={c.id} className={`border-b border-surface-border/50 last:border-0 hover:bg-surface-hover/30 transition-colors ${
                      target?.id === c.id ? 'bg-red-500/5' : ''}`}>
                      <td className="px-3 py-2 font-mono text-xs text-brand-400">{c.code || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-200">{nameOf(c)}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">{(c.contact_types ?? []).join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{c.mobile || '—'}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{c.account_number || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button className="btn-ghost text-xs px-2 py-1 text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => review(c)} disabled={phase === 'scanning' || phase === 'working'}>
                          {phase === 'scanning' && target?.id === c.id
                            ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Checking…</>
                            : <><Trash2 className="w-3.5 h-3.5" /> Review &amp; delete</>}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* The footprint ──────────────────────────────────────── */}
        {(phase === 'review' || phase === 'working') && target && (
          <div className="card p-5 border-red-600/30 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-300 space-y-1">
                <p className="font-semibold text-red-300">
                  Deleting {nameOf(target)} {target.code ? `(${target.code})` : ''} cannot be undone.
                </p>
                <p className="text-slate-400">
                  {sum.clean
                    ? 'This contact is not attached to a single other record. Deleting it removes the card and nothing else.'
                    : <>It appears in <span className="text-slate-100 font-semibold">{sum.tables}</span> table
                       {sum.tables === 1 ? '' : 's'}. Everything below happens in one go, or not at all.</>}
                </p>
              </div>
            </div>

            {!sum.clean && (
              <div className="rounded-lg border border-surface-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-hover/40 border-b border-surface-border">
                      {['Where', 'As', 'Rows', 'On delete'].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-surface-border/50 last:border-0">
                        <td className="px-3 py-2 text-slate-200 text-xs">{contactTableLabel(r.table_name)}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{columnLabel(r.column_name)}</td>
                        <td className="px-3 py-2 text-slate-300 text-xs tabular-nums">{Number(r.rows_found).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${KIND_STYLE[r.kind] || KIND_STYLE.audit}`}>
                            {KIND_TEXT[r.kind] || r.kind}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Their login, called out — it is the part people forget. */}
            {sum.hasAccount && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-200">
                <KeyRound className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  This contact holds a portal login. It is deleted with them, so nobody can sign in with it again.
                  Their own account records go too; their name on other people's work is cleared and that work is kept.
                </span>
              </div>
            )}

            {/* Orders: not a preference, a condition. */}
            {sum.orderRows > 0 && (
              <div className={`rounded-lg border p-3 ${
                deleteOrders ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/5'}`}>
                <button type="button" onClick={() => setDeleteOrders(v => !v)} disabled={phase === 'working'}
                  className="flex items-start gap-2 text-left w-full disabled:opacity-50">
                  {deleteOrders
                    ? <CheckSquare className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    : <Square className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />}
                  <span className="text-xs leading-relaxed">
                    <span className={deleteOrders ? 'text-red-200 font-semibold' : 'text-amber-200 font-medium'}>
                      Delete the {sum.orderRows.toLocaleString()} order{sum.orderRows === 1 ? '' : 's'} this contact placed
                    </span>
                    <span className="block text-slate-400 mt-0.5">
                      An order cannot outlive its customer, so this is not optional — it is the price of deleting the
                      contact at all. Each order goes completely: its items, services, packages, payments, tracking and
                      ledger entries. If those deliveries still matter, leave the contact retired instead.
                    </span>
                  </span>
                </button>
              </div>
            )}

            {/* Anything untouchable */}
            {sum.blocking.length > 0 && (
              <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3">
                <p className="text-xs text-rose-100 leading-relaxed">
                  This contact cannot be deleted. {sum.blockingRows.toLocaleString()} record
                  {sum.blockingRows === 1 ? '' : 's'} in{' '}
                  {sum.blocking.map(r => contactTableLabel(r.table_name)).join(', ')} must keep a contact and are not
                  this one's own — removing the reference would mean deleting somebody else's work. Leave the contact
                  retired, or have those records reassigned first.
                </p>
              </div>
            )}

            {/* Confirmation */}
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
              <p className="text-xs text-red-200 leading-relaxed">
                {sum.ownRows > 0 && <>{sum.ownRows.toLocaleString()} of its own record{sum.ownRows === 1 ? '' : 's'} will be deleted. </>}
                {sum.orderRows > 0 && <>{sum.orderRows.toLocaleString()} order{sum.orderRows === 1 ? '' : 's'} and everything on them will be deleted. </>}
                {sum.auditRows > 0 && <>{sum.auditRows.toLocaleString()} other record{sum.auditRows === 1 ? '' : 's'} will lose the reference to it. </>}
                There is no undo.
              </p>
              <label className="block">
                <span className="text-[11px] text-slate-400">
                  Type <span className="font-mono text-slate-200">{confirmWord}</span> to confirm
                </span>
                <input className="input mt-1 font-mono" value={typed} autoComplete="off"
                  disabled={phase === 'working'}
                  onChange={e => { setTyped(e.target.value); setError('') }} />
              </label>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-xs leading-relaxed">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost text-slate-400 hover:text-slate-100"
                onClick={close} disabled={phase === 'working'}>
                <X className="w-4 h-4" /> Cancel
              </button>
              <button
                className="btn-primary !bg-red-600 hover:!bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={confirmDelete}
                title={sum.blocking.length > 0 ? 'Blocked — see above'
                  : !ordersSettled ? 'Confirm the orders above first' : undefined}
                disabled={!armed || !ordersSettled || phase === 'working' || sum.blocking.length > 0}>
                {phase === 'working'
                  ? <><Loader className="w-4 h-4 animate-spin" /> Deleting…</>
                  : <><Trash2 className="w-4 h-4" /> Delete this contact permanently</>}
              </button>
            </div>
          </div>
        )}

        {/* What actually happened ─────────────────────────────── */}
        {phase === 'done' && (
          <div className="card p-5 space-y-3">
            <p className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="w-4 h-4" /> The contact has been deleted. Here is what changed:
            </p>
            <div className="rounded-lg border border-surface-border overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {report.map((r, i) => (
                    <tr key={i} className="border-b border-surface-border/50 last:border-0">
                      <td className="px-3 py-2 text-slate-200 text-xs">{contactTableLabel(r.table_name)}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{columnLabel(r.column_name)}</td>
                      <td className="px-3 py-2 text-slate-300 text-xs tabular-nums">{Number(r.rows_affected).toLocaleString()}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button className="btn-ghost border border-surface-border text-slate-300" onClick={close}>
                <UserX className="w-4 h-4" /> Back to the list
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
