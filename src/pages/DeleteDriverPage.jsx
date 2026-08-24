import React, { useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Loader, Trash2, X, ShieldAlert,
  UserX, Truck, KeyRound, CheckSquare, Square,
} from 'lucide-react'
import ContactCombobox from '../components/orders/ContactCombobox'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import {
  scanDriverReferences, summariseDriverReferences, deleteDriver,
  driverTableLabel, columnLabel, KIND_TEXT,
} from '../lib/driverDeletion'

/* Delete a driver for good (supabase-fix138.sql).

   Deactivating a driver hides them; it does not remove them. This does — the
   contact, their petty cash and settlements, their vehicle assignments, their
   login, and (if the super admin says so) the orders they carried with
   everything on them.

   Never a single click. The driver's footprint is read from the database and
   shown first, the fate of their orders is an explicit choice, and their code
   has to be typed back before the button arms. Whatever the database refuses
   to give up is named in the review and blocks the delete there, rather than
   failing halfway through. */

const nameOf = (c) =>
  (c?.company_name?.trim()) || `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim() || '—'

/* The colours the review uses per kind — the eye should sort the list before
   the words are read. */
const KIND_STYLE = {
  own:      'bg-red-500/10 text-red-300 border-red-500/30',
  orders:   'bg-orange-500/10 text-orange-300 border-orange-500/30',
  account:  'bg-red-500/10 text-red-300 border-red-500/30',
  audit:    'bg-amber-500/10 text-amber-300 border-amber-500/30',
  blocking: 'bg-rose-500/15 text-rose-200 border-rose-400/40',
}

export default function DeleteDriverPage() {
  const { drivers, fetchDrivers, fetchOrders } = useApp()
  const { currentUser, hasRole } = useAuth()
  // Permanently removing a person and their history is the super admin's alone.
  const isSuper = hasRole('super_admin')

  const [driverId,     setDriverId]     = useState('')
  const [phase,        setPhase]        = useState('idle')  // idle|scanning|review|working|done
  const [rows,         setRows]         = useState([])
  const [report,       setReport]       = useState([])
  const [typed,        setTyped]        = useState('')
  // What happens to the orders they carried. Kept OFF by default: an order is
  // the customer's record of a delivery they paid for, and losing the driver
  // is not a reason to lose the order. Ticking it is a deliberate act.
  const [deleteOrders, setDeleteOrders] = useState(false)
  const [error,        setError]        = useState('')

  const driver = useMemo(() => drivers.find(d => d.id === driverId) || null, [drivers, driverId])
  const sum    = useMemo(() => summariseDriverReferences(rows), [rows])

  // What has to be typed back: the driver's code when they have one (short and
  // unambiguous), otherwise their name.
  const confirmWord = driver?.code || nameOf(driver)
  const armed = typed.trim().toLowerCase() === String(confirmWord).trim().toLowerCase()

  function pick(c) {
    setDriverId(c?.id || '')
    setPhase('idle'); setRows([]); setReport([]); setTyped(''); setError(''); setDeleteOrders(false)
  }

  async function runScan() {
    if (!driverId) return
    setPhase('scanning'); setError(''); setRows([])
    const { rows: found, error: e } = await scanDriverReferences(driverId, { actorId: currentUser.user_id })
    setRows(found)
    setError(e || '')
    setPhase('review')
  }

  async function confirmDelete() {
    setPhase('working'); setError('')
    const { report: rep, error: e } = await deleteDriver(driverId, {
      actorId: currentUser.user_id,
      deleteOrders,
    })
    if (e) { setError(e); setPhase('review'); return }
    setReport(rep)
    setPhase('done')
    // The driver is gone and their orders may be too — reload both so the rest
    // of the app doesn't keep showing them.
    fetchDrivers?.()
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
      <div className="max-w-3xl mx-auto space-y-5">

        <p className="text-xs text-slate-500">
          Permanently remove a driver — their profile, their records, their login, and optionally the orders they carried.
          Deactivate the driver instead if you only want to stop them working.
        </p>

        {/* Step 1 — who ─────────────────────────────────────── */}
        <div className="card p-5 space-y-3">
          <div>
            <label className="label">Driver</label>
            <div className="max-w-md">
              <ContactCombobox
                value={driverId}
                options={drivers}
                onSelect={pick}
                addLabel="driver"
                placeholder="Type a driver's name, code or mobile…"
              />
            </div>
          </div>

          {driver && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-slate-600" /> {nameOf(driver)}
              </span>
              {driver.code   && <span className="font-mono text-brand-400">{driver.code}</span>}
              {driver.mobile && <span>{driver.mobile}</span>}
              {driver.driver_license && <span>Licence {driver.driver_license}</span>}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button className="btn-primary" onClick={runScan}
              disabled={!driverId || phase === 'scanning' || phase === 'working'}>
              {phase === 'scanning'
                ? <><Loader className="w-4 h-4 animate-spin" /> Checking…</>
                : <>Check what is linked</>}
            </button>
          </div>
        </div>

        {/* Step 2 — the footprint ───────────────────────────── */}
        {(phase === 'review' || phase === 'working') && driver && (
          <div className="card p-5 border-red-600/30 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-300 space-y-1">
                <p className="font-semibold text-red-300">
                  Deleting {nameOf(driver)} {driver.code ? `(${driver.code})` : ''} cannot be undone.
                </p>
                <p className="text-slate-400">
                  {sum.clean
                    ? 'This driver is not attached to a single other record. Deleting them removes the profile and nothing else.'
                    : <>They appear in <span className="text-slate-100 font-semibold">{sum.tables}</span> table
                       {sum.tables === 1 ? '' : 's'}. Everything below happens in one go, or not at all.</>}
                </p>
              </div>
            </div>

            {/* What is attached */}
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
                        <td className="px-3 py-2 text-slate-200 text-xs">{driverTableLabel(r.table_name)}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{columnLabel(r.column_name)}</td>
                        <td className="px-3 py-2 text-slate-300 text-xs tabular-nums">{Number(r.rows_found).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] border rounded px-2 py-0.5 whitespace-nowrap ${KIND_STYLE[r.kind] || KIND_STYLE.audit}`}>
                            {r.kind === 'orders' && !deleteOrders ? 'kept, driver removed' : (KIND_TEXT[r.kind] || r.kind)}
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
                  This driver has a login. It is deleted with them, so they can no longer sign in to the driver app.
                  Their own account records go too; their name on other people's work is cleared and that work is kept.
                </span>
              </div>
            )}

            {/* The one real choice on this page */}
            {sum.orderRows > 0 && (
              <div className={`rounded-lg border p-3 space-y-2 ${
                deleteOrders ? 'border-red-500/40 bg-red-500/10' : 'border-surface-border bg-surface-hover/30'}`}>
                <button type="button" onClick={() => setDeleteOrders(v => !v)} disabled={phase === 'working'}
                  className="flex items-start gap-2 text-left w-full disabled:opacity-50">
                  {deleteOrders
                    ? <CheckSquare className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    : <Square className="w-4 h-4 text-slate-600 flex-shrink-0 mt-0.5" />}
                  <span className="text-xs leading-relaxed">
                    <span className={deleteOrders ? 'text-red-200 font-semibold' : 'text-slate-200 font-medium'}>
                      Also delete the {sum.orderRows.toLocaleString()} order{sum.orderRows === 1 ? '' : 's'} this driver carried
                    </span>
                    <span className="block text-slate-400 mt-0.5">
                      {deleteOrders
                        ? 'Each order goes completely — its items, services, packages, payments, tracking and ledger entries. The customers’ record of those deliveries goes with it.'
                        : 'Left unticked, the orders stay exactly as they are and simply lose their driver. This is the safe choice.'}
                    </span>
                  </span>
                </button>
              </div>
            )}

            {/* Anything untouchable */}
            {sum.blocking.length > 0 && (
              <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3">
                <p className="text-xs text-rose-100 leading-relaxed">
                  This driver cannot be deleted. {sum.blockingRows.toLocaleString()} record
                  {sum.blockingRows === 1 ? '' : 's'} in{' '}
                  {sum.blocking.map(r => driverTableLabel(r.table_name)).join(', ')} must keep a contact and are not this
                  driver's own — removing the reference would mean deleting real work. Deactivate the driver instead, or
                  have those records reassigned first.
                </p>
              </div>
            )}

            {/* Confirmation */}
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
              <p className="text-xs text-red-200 leading-relaxed">
                {sum.ownRows > 0 && <>{sum.ownRows.toLocaleString()} of their own record{sum.ownRows === 1 ? '' : 's'} will be deleted. </>}
                {sum.orderRows > 0 && (deleteOrders
                  ? <>{sum.orderRows.toLocaleString()} order{sum.orderRows === 1 ? '' : 's'} and everything on them will be deleted. </>
                  : <>{sum.orderRows.toLocaleString()} order{sum.orderRows === 1 ? '' : 's'} will be kept without a driver. </>)}
                {sum.auditRows > 0 && <>{sum.auditRows.toLocaleString()} other record{sum.auditRows === 1 ? '' : 's'} will lose the reference to them. </>}
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
                onClick={() => pick(null)} disabled={phase === 'working'}>
                <X className="w-4 h-4" /> Cancel
              </button>
              <button
                className="btn-primary !bg-red-600 hover:!bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={confirmDelete}
                title={sum.blocking.length > 0 ? 'Blocked — see above' : undefined}
                disabled={!armed || phase === 'working' || sum.blocking.length > 0}>
                {phase === 'working'
                  ? <><Loader className="w-4 h-4 animate-spin" /> Deleting…</>
                  : <><Trash2 className="w-4 h-4" /> Delete this driver permanently</>}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — what actually happened ──────────────────── */}
        {phase === 'done' && (
          <div className="card p-5 space-y-3">
            <p className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="w-4 h-4" /> The driver has been deleted. Here is what changed:
            </p>
            <div className="rounded-lg border border-surface-border overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {report.map((r, i) => (
                    <tr key={i} className="border-b border-surface-border/50 last:border-0">
                      <td className="px-3 py-2 text-slate-200 text-xs">{driverTableLabel(r.table_name)}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{columnLabel(r.column_name)}</td>
                      <td className="px-3 py-2 text-slate-300 text-xs tabular-nums">{Number(r.rows_affected).toLocaleString()}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button className="btn-ghost border border-surface-border text-slate-300"
                onClick={() => pick(null)}>
                <UserX className="w-4 h-4" /> Delete another driver
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
