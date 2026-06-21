import React from 'react'
import { Megaphone, Info, AlertTriangle, AlertOctagon, Check, X, CheckCheck } from 'lucide-react'
import { useApp } from '../../context/AppContext'

/* Visual treatment per priority. */
const PRIORITY = {
  info:     { icon: Info,         label: 'Announcement', ring: 'border-brand-500/40',   chip: 'bg-brand-500/15 text-brand-300',   iconColor: 'text-brand-400' },
  warning:  { icon: AlertTriangle,label: 'Important',     ring: 'border-amber-500/40',   chip: 'bg-amber-500/15 text-amber-300',   iconColor: 'text-amber-400' },
  critical: { icon: AlertOctagon, label: 'Urgent',        ring: 'border-red-500/50',     chip: 'bg-red-500/15 text-red-300',       iconColor: 'text-red-400' },
}

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/* Global overlay shown on top of everything whenever the signed-in user has
   unread broadcast messages and the panel is open. Shows the newest unread first;
   "Mark as read" removes it (and drops the sidebar badge count). Closing keeps the
   messages unread — the sidebar bell re-opens the panel. */
export default function BroadcastPopup() {
  const { unreadMessages, messagesOpen, setMessagesOpen, markMessageRead, markAllMessagesRead } = useApp()

  if (!messagesOpen || unreadMessages.length === 0) return null

  const msg   = unreadMessages[0]                       // newest unread
  const count = unreadMessages.length
  const cfg   = PRIORITY[msg.priority] || PRIORITY.info
  const Icon  = cfg.icon

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-lg card border ${cfg.ring} shadow-2xl overflow-hidden`}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-surface-border bg-surface-hover/40">
          <Megaphone className={`w-5 h-5 ${cfg.iconColor}`} />
          <span className="text-sm font-semibold text-slate-100">Message from administration</span>
          {count > 1 && (
            <span className="ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {count > 9 ? '9+' : count} new
            </span>
          )}
          <button onClick={() => setMessagesOpen(false)}
            title="Close (keeps it unread)"
            className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-surface-hover transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${cfg.chip}`}>
              <Icon className="w-3 h-3" /> {cfg.label}
            </span>
          </div>

          <h2 className="text-base font-semibold text-slate-100 leading-snug">{msg.title}</h2>
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{msg.body}</p>

          <p className="text-[11px] text-slate-500 pt-1">
            {msg.created_by_name ? `From ${msg.created_by_name} · ` : ''}{fmtWhen(msg.created_at)}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-surface-border bg-surface-hover/30">
          {count > 1 && (
            <button onClick={markAllMessagesRead} className="btn-ghost text-slate-400 hover:text-slate-100">
              <CheckCheck className="w-4 h-4" /> Mark all as read
            </button>
          )}
          <button onClick={() => markMessageRead(msg.id)} className="btn-primary">
            <Check className="w-4 h-4" /> Mark as read
          </button>
        </div>
      </div>
    </div>
  )
}
