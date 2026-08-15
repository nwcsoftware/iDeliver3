import React, { useCallback, useEffect, useState } from 'react'
import { Clock, Loader, Save, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { DAYS, emptyHours, normalizeHours, shopOpenState, dayText } from '../lib/shopHours'

/* Working hours for one shop (supabase-fix121).

   The shop sets when it takes orders; the customer app shows Open/Closed on the
   shop card, and offers to schedule for the next opening when someone tries to
   buy from a shut shop. A shop that saves nothing keeps no schedule and is
   treated as always open, so this is opt-in. */
export default function ShopWorkingHours({ contactId }) {
  const [hours,   setHours]   = useState(() => emptyHours())
  const [note,    setNote]    = useState('')
  const [keeps,   setKeeps]   = useState(false)   // is a schedule being kept at all?
  const [contact, setContact] = useState(null)
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)

  const load = useCallback(async () => {
    if (!contactId) { setLoading(false); return }
    setLoading(true); setError('')
    const { data, error: e } = await supabase
      .from('contacts').select('id, opening_hours, hours_note').eq('id', contactId).maybeSingle()
    if (e) {
      setError(/opening_hours|hours_note/.test(e.message)
        ? 'Working hours aren’t installed yet — run supabase-fix121.sql.'
        : e.message)
      setLoading(false); return
    }
    const norm = normalizeHours(data?.opening_hours)
    setKeeps(!!norm)
    setHours(norm || emptyHours())
    setNote(data?.hours_note || '')
    setContact(data || null)
    setLoading(false)
  }, [contactId])

  useEffect(() => { load() }, [load])

  const setDay = (i, patch) => setHours(hs => hs.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  // Most shops keep the same hours all week — set one day, copy it down.
  const copyToAll = (i) => setHours(hs => hs.map(() => ({ ...hs[i] })))

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    const { error: e } = await supabase
      .from('contacts')
      .update({ opening_hours: keeps ? hours : null, hours_note: note.trim() || null })
      .eq('id', contactId)
    setSaving(false)
    if (e) {
      setError(/opening_hours|hours_note/.test(e.message)
        ? 'Working hours aren’t installed yet — run supabase-fix121.sql.'
        : e.message)
      return
    }
    setSaved(true); setTimeout(() => setSaved(false), 2500)
    load()
  }

  if (!contactId) return null

  const state = shopOpenState({ opening_hours: keeps ? hours : null })

  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-surface-hover/40 transition-colors text-left">
        <Clock className="w-4 h-4 text-brand-300 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-100">Working hours</span>
        {/* Folded away, the state still reads at a glance. */}
        <span className={`text-[11px] border rounded-full px-2 py-0.5 ${
          !keeps ? 'bg-slate-500/10 text-slate-400 border-slate-500/30'
          : state.open ? 'bg-green-500/10 text-green-300 border-green-500/30'
                       : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
          {!keeps ? 'Always open' : state.open ? 'Open now' : 'Closed now'}
        </span>
        {keeps && !open && (
          <span className="text-[11px] text-slate-500">Today: {dayText(state.today)}</span>
        )}
        <ChevronDown className={`w-4 h-4 text-slate-500 ml-auto transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>

      {open && (
        <div className="border-t border-surface-border p-4 space-y-3">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs">{error}</p>
            </div>
          )}

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={keeps} onChange={e => setKeeps(e.target.checked)}
              className="w-4 h-4 accent-brand-500" />
            <span className="text-xs text-slate-300">
              Keep opening hours — customers see <b>Open</b> or <b>Closed</b> on your shop
            </span>
          </label>
          {!keeps && (
            <p className="text-[11px] text-slate-500">
              With this off, your shop is shown as always available and customers can order at any time.
            </p>
          )}

          {keeps && (loading ? (
            <p className="text-xs text-slate-500 py-4 text-center">Loading…</p>
          ) : (
            <div className="space-y-1.5">
              {DAYS.map((d, i) => (
                <div key={d.key} className="flex items-center gap-2 flex-wrap">
                  <span className="w-10 text-xs text-slate-400">{d.short}</span>
                  <button type="button" onClick={() => setDay(i, { closed: !hours[i].closed })}
                    className={`text-[11px] border rounded-lg px-2 py-1 w-[68px] transition-colors ${
                      hours[i].closed
                        ? 'bg-slate-500/10 border-slate-500/30 text-slate-400'
                        : 'bg-green-500/10 border-green-500/30 text-green-300'}`}>
                    {hours[i].closed ? 'Closed' : 'Open'}
                  </button>
                  <input type="time" className="input py-1 text-xs w-[110px] disabled:opacity-40"
                    value={hours[i].from} disabled={hours[i].closed}
                    onChange={e => setDay(i, { from: e.target.value })} />
                  <span className="text-slate-600 text-xs">→</span>
                  <input type="time" className="input py-1 text-xs w-[110px] disabled:opacity-40"
                    value={hours[i].to} disabled={hours[i].closed}
                    onChange={e => setDay(i, { to: e.target.value })} />
                  <button type="button" onClick={() => copyToAll(i)}
                    title="Copy this day to the whole week"
                    className="btn-ghost py-1 px-2 text-[10px] text-slate-500 hover:text-slate-200">
                    Copy to all
                  </button>
                </div>
              ))}
              <p className="text-[11px] text-slate-500 pt-1">
                A closing time earlier than the opening time means the shop runs past midnight
                (18:00 → 02:00). Equal times mean 24 hours.
              </p>
            </div>
          ))}

          <div>
            <label className="label">Note for customers</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Closed on public holidays" />
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className="btn-primary py-1.5 text-xs disabled:opacity-60">
              {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save hours
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-green-300">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
