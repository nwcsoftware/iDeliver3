import React, { useState } from 'react'
import { Settings, Bell, Save, CheckCircle2, Clock } from 'lucide-react'
import { useApp } from '../context/AppContext'

/* General application settings. Currently holds the order-confirmation reminder
   time; built as a list of cards so more settings can be added over time. */
export default function AppSettingsPage() {
  const { appSettings, updateAppSettings } = useApp()

  // Order-confirmation reminder (minutes). Edited as a draft string so the field
  // can be cleared while typing; saved (clamped to a whole number ≥ 0) on Save.
  const [reminderMins, setReminderMins] = useState(
    String(appSettings.orderConfirmReminderMinutes ?? 15)
  )
  const [savedMsg, setSavedMsg] = useState('')

  // Minutes before an order's scheduled (start) time at which its row turns red
  // in the daily order list. Edited as a draft string like above.
  const [highlightMins, setHighlightMins] = useState(
    String(appSettings.highlightBeforeScheduledMinutes ?? 5)
  )
  const [highlightSavedMsg, setHighlightSavedMsg] = useState('')

  const reminderDirty =
    String(appSettings.orderConfirmReminderMinutes ?? 15) !== reminderMins.trim()

  const highlightDirty =
    String(appSettings.highlightBeforeScheduledMinutes ?? 5) !== highlightMins.trim()

  function saveReminder() {
    const n = Math.max(0, Math.round(Number(reminderMins) || 0))
    updateAppSettings({ orderConfirmReminderMinutes: n })
    setReminderMins(String(n))
    setSavedMsg('Saved')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  function saveHighlight() {
    const n = Math.max(0, Math.round(Number(highlightMins) || 0))
    updateAppSettings({ highlightBeforeScheduledMinutes: n })
    setHighlightMins(String(n))
    setHighlightSavedMsg('Saved')
    setTimeout(() => setHighlightSavedMsg(''), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
            <Settings className="w-4 h-4 text-brand-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100 leading-none">Settings</h1>
            <p className="text-xs text-slate-500 mt-0.5">Application preferences and behaviour</p>
          </div>
        </div>

        {/* Order confirmation reminder */}
        <div className="card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
              <Bell className="w-4 h-4 text-fuchsia-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Order confirmation reminder</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                When a newly-placed order stays unconfirmed for longer than this time,
                its row in the daily order list starts blinking to remind you to confirm it.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-[12rem]">
              <label className="label">Waiting time before blinking (minutes)</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={reminderMins}
                onChange={e => { setReminderMins(e.target.value); setSavedMsg('') }}
                onKeyDown={e => { if (e.key === 'Enter') saveReminder() }}
              />
            </div>
            <button
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={saveReminder}
              disabled={!reminderDirty}
            >
              <Save className="w-4 h-4" /> Save
            </button>
            {savedMsg && (
              <span className="text-xs text-green-400 flex items-center gap-1.5 pb-2.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {savedMsg}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Set to <span className="font-mono text-slate-400">0</span> to turn the blinking reminder off.
          </p>
        </div>

        {/* Highlight before scheduled time */}
        <div className="card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-red-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Highlight orders before their scheduled time</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                A reminder before pickup: when an active order's scheduled start time is
                this many minutes away, its row in the daily order list turns red — so you
                can see at a glance which orders are about to start.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-[12rem]">
              <label className="label">Highlight starts before scheduled time (minutes)</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={highlightMins}
                onChange={e => { setHighlightMins(e.target.value); setHighlightSavedMsg('') }}
                onKeyDown={e => { if (e.key === 'Enter') saveHighlight() }}
              />
            </div>
            <button
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={saveHighlight}
              disabled={!highlightDirty}
            >
              <Save className="w-4 h-4" /> Save
            </button>
            {highlightSavedMsg && (
              <span className="text-xs text-green-400 flex items-center gap-1.5 pb-2.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {highlightSavedMsg}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500">
            Example: <span className="font-mono text-slate-400">5</span> turns a row red 5 minutes before
            its scheduled time. Set to <span className="font-mono text-slate-400">0</span> to turn it off.
          </p>
        </div>

      </div>
    </div>
  )
}
