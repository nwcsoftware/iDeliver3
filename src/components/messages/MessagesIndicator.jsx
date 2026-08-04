import React, { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useApp } from '../../context/AppContext'

/* Broadcast-message indicator: the messages icon with this user's unread count
   (10+ once it goes past ten). Clicking opens the global message popup.

   Shown in both shells — the office sidebar (collapsed rail and expanded Quick
   Stats panel) and the supplier/partner portal — so every role can reach their
   messages. When an "icon only" broadcast arrives (fix108) the icon plays a
   short nudge animation instead of a popup taking over the screen. */
export default function MessagesIndicator({ collapsed = false }) {
  const { unreadCount, setMessagesOpen, messagesNudge } = useApp()
  const [nudging, setNudging] = useState(false)

  // Replay the animation each time a quiet message lands.
  useEffect(() => {
    if (!messagesNudge) return undefined
    setNudging(true)
    const t = setTimeout(() => setNudging(false), 2800)
    return () => clearTimeout(t)
  }, [messagesNudge])

  const badge   = unreadCount > 10 ? '10+' : String(unreadCount)
  const iconCls = `${unreadCount ? 'text-brand-400' : 'text-slate-400'} ${nudging ? 'animate-msg-nudge' : ''}`
  const title   = unreadCount ? `${unreadCount} unread message${unreadCount > 1 ? 's' : ''}` : 'Messages'
  const open    = () => setMessagesOpen(true)

  if (collapsed) {
    return (
      <button onClick={open} title={title}
        className="relative p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-hover transition-colors">
        <MessageSquare className={`w-[18px] h-[18px] ${iconCls}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badge}
          </span>
        )}
      </button>
    )
  }

  return (
    <button onClick={open} title={title}
      className="w-full flex items-center justify-between mb-3 group">
      <span className="flex items-center gap-2 text-xs font-medium text-slate-300 group-hover:text-slate-100 transition-colors">
        <MessageSquare className={`w-4 h-4 ${iconCls}`} /> Messages
      </span>
      {unreadCount > 0
        ? <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">{badge}</span>
        : <span className="text-[10px] text-slate-600">None</span>}
    </button>
  )
}
