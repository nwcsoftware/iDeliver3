import React from 'react'
import { Megaphone, Info, AlertTriangle, AlertOctagon, Check, X, CheckCheck } from 'lucide-react'
import { useApp, messageTargetsUser } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'

/* Visual treatment per priority. */
const PRIORITY = {
  info:     { icon: Info,          label: 'Announcement', chip: 'bg-brand-500/15 text-brand-300',  accent: 'border-l-brand-500' },
  warning:  { icon: AlertTriangle, label: 'Important',    chip: 'bg-amber-500/15 text-amber-300',  accent: 'border-l-amber-500' },
  critical: { icon: AlertOctagon,  label: 'Urgent',       chip: 'bg-red-500/15 text-red-300',      accent: 'border-l-red-500' },
}

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/* Global message center shown on top of everything. Opens automatically when a
   new broadcast arrives, and on demand from the sidebar messages icon. Lists all
   current broadcasts (newest first) with each one's read/unread state; unread
   ones can be marked read individually or all at once, which drops the sidebar
   badge count. Closing keeps unread messages unread. */
export default function BroadcastPopup() {
  const { messages, unreadMessages, unreadCount, messagesOpen, setMessagesOpen,
          markMessageRead, markAllMessagesRead } = useApp()
  const { currentUser } = useAuth()

  if (!messagesOpen) return null

  // Second line of defence on top of the fetch-time filter: a message aimed at
  // other roles/users is never rendered here, whatever ends up in `messages`.
  const visible   = messages.filter(m => messageTargetsUser(m, currentUser))
  const unreadIds = new Set(unreadMessages.filter(m => messageTargetsUser(m, currentUser)).map(m => m.id))

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setMessagesOpen(false)}>
      <div className="w-full max-w-lg max-h-[82vh] card border border-surface-border shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-surface-border bg-surface-hover/40 flex-shrink-0">
          <Megaphone className="w-5 h-5 text-brand-400" />
          <span className="text-sm font-semibold text-slate-100">Messages from administration</span>
          {unreadIds.size > 0 && (
            <span className="ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {unreadIds.size > 9 ? "9+" : unreadIds.size} new
            </span>
          )}
          <button onClick={() => setMessagesOpen(false)}
            title="Close"
            className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {visible.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-sm">No messages yet.</div>
          ) : visible.map(m => {
            const cfg    = PRIORITY[m.priority] || PRIORITY.info
            const Icon   = cfg.icon
            const unread = unreadIds.has(m.id)
            return (
              <div key={m.id}
                className={`rounded-lg border border-surface-border border-l-2 p-3.5 space-y-2 transition-colors ${
                  unread ? `${cfg.accent} bg-surface-hover/40` : 'border-l-surface-border opacity-70'}`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${cfg.chip}`}>
                    <Icon className="w-3 h-3" /> {cfg.label}
                  </span>
                  {unread
                    ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> NEW
                      </span>
                    : <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                        <Check className="w-3 h-3" /> Read
                      </span>}
                </div>

                <h3 className="text-sm font-semibold text-slate-100 leading-snug">{m.title}</h3>
                <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{m.body}</p>

                <div className="flex items-center justify-between pt-0.5">
                  <p className="text-[11px] text-slate-500">
                    {m.created_by_name ? `From ${m.created_by_name} · ` : ''}{fmtWhen(m.created_at)}
                  </p>
                  {unread && (
                    <button onClick={() => markMessageRead(m.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-300 hover:text-brand-200 transition-colors">
                      <Check className="w-3.5 h-3.5" /> Mark as read
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-surface-border bg-surface-hover/30 flex-shrink-0">
          {unreadIds.size > 0 && (
            <button onClick={markAllMessagesRead} className="btn-ghost text-slate-400 hover:text-slate-100">
              <CheckCheck className="w-4 h-4" /> Mark all as read
            </button>
          )}
          <button onClick={() => setMessagesOpen(false)} className="btn-primary">
            <X className="w-4 h-4" /> Close
          </button>
        </div>
      </div>
    </div>
  )
}
