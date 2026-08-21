import React, { useEffect, useState } from 'react'
import { Loader2, Check, Database } from 'lucide-react'

/* A "we are working on it" panel for pages that take a moment to assemble.

   Some screens — the statements, the financial pages — pull the whole order
   history before they can show a figure. That can run for several seconds, and
   a screen that simply sits there looks broken. This says what is happening,
   which step it is on, and how long it has been going, so waiting is a choice
   rather than a mystery.

   Steps are declarative: [{ label, done }]. The first step that is not done is
   the one in progress; everything after it is pending. */
export default function DataLoadingOverlay({
  open,
  title = 'Gathering data',
  subtitle = 'Reading the records this report is built from…',
  steps = [],
}) {
  // Elapsed seconds — a long wait is easier to accept when it is acknowledged.
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!open) { setSecs(0); return undefined }
    const t = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [open])

  if (!open) return null

  const currentIdx = steps.findIndex(s => !s.done)
  const doneCount = steps.filter(s => s.done).length
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div className="card w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          {/* A pulsing ring behind the icon: movement that isn't a spinner
              fighting for attention with the one below. */}
          <span className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-brand-500/20 animate-ping" />
            <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/15 border border-brand-500/30">
              <Database className="h-5 w-5 text-brand-300" />
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100">{title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* Progress: real where steps are known, sweeping where they are not. */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
          {steps.length ? (
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(pct, 6)}%` }} />
          ) : (
            <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,transparent_25%,rgb(99,102,241)_50%,transparent_75%)] bg-[length:300%_100%] animate-shimmer" />
          )}
        </div>

        {steps.length > 0 && (
          <ul className="mt-4 space-y-2">
            {steps.map((s, i) => {
              const active = i === currentIdx
              return (
                <li key={s.label} className="flex items-center gap-2.5 text-xs">
                  {s.done ? (
                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-400" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-brand-300" />
                  ) : (
                    <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-surface-border" />
                  )}
                  <span className={s.done ? 'text-slate-400' : active ? 'text-slate-100' : 'text-slate-600'}>
                    {s.label}
                  </span>
                  {s.hint && s.done && <span className="ml-auto text-[11px] text-slate-500">{s.hint}</span>}
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-4 text-[11px] text-slate-500">
          {secs < 5
            ? 'This usually takes a few seconds.'
            : `Still working — ${secs}s. Large histories take longer the first time; it is cached afterwards.`}
        </p>
      </div>
    </div>
  )
}
