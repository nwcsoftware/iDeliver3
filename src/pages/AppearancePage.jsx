import React from 'react'
import { Palette, Check, Monitor } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { THEMES, DEFAULT_THEME, applyTheme } from '../lib/appThemes'

/* Settings → Appearance — which palette the console is painted in.

   The choice is per DEVICE, stored alongside the other preferences in
   appSettings. Two people sharing a workstation share a screen, and a bright
   front office and a dim dispatch desk can reasonably want different looks.

   Choosing a theme repaints immediately, before anything is saved, because a
   colour scheme is the one setting you cannot judge from its name. What the
   swatches promise, the screen underneath delivers at the same moment.

   The palettes themselves — and the reasoning behind which end of each colour
   ramp moves — live in src/lib/appThemes.js. */

/* A miniature of the console, painted in a theme's own colours rather than the
   one currently applied. Every value is inline: these must NOT follow the live
   theme, or all three previews would look identical. */
function Preview({ theme }) {
  const [page, card, accent, ink] = theme.swatch
  const border = theme.key === 'standard' ? '#334155' : theme.key === 'light' ? '#d3dde8' : '#d4d4d4'
  const muted  = theme.key === 'standard' ? '#64748b' : theme.key === 'light' ? '#64748b' : '#737373'
  return (
    <div className="rounded-lg overflow-hidden border" style={{ background: page, borderColor: border }}>
      {/* header strip */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ borderBottom: `1px solid ${border}` }}>
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
        <span className="h-1.5 w-14 rounded-full" style={{ background: ink, opacity: 0.85 }} />
        <span className="ml-auto h-1.5 w-6 rounded-full" style={{ background: muted }} />
      </div>
      <div className="flex gap-2 p-2.5">
        {/* sidebar */}
        <div className="flex w-10 flex-col gap-1">
          {[0.9, 0.5, 0.5].map((o, i) => (
            <span key={i} className="h-1.5 rounded-full" style={{ background: i === 0 ? accent : muted, opacity: o }} />
          ))}
        </div>
        {/* a card with a row of text and a button */}
        <div className="flex-1 rounded-md p-2" style={{ background: card, border: `1px solid ${border}` }}>
          <span className="block h-1.5 w-2/3 rounded-full" style={{ background: ink, opacity: 0.9 }} />
          <span className="mt-1.5 block h-1.5 w-1/2 rounded-full" style={{ background: muted }} />
          <span className="mt-1.5 block h-1.5 w-5/6 rounded-full" style={{ background: muted, opacity: 0.6 }} />
          <span className="mt-2 block h-3 w-12 rounded" style={{ background: accent }} />
        </div>
      </div>
    </div>
  )
}

export default function AppearancePage() {
  const { appSettings, updateAppSettings } = useApp()
  const current = appSettings.theme || DEFAULT_THEME

  /* Paint first, then store. applyTheme is what the provider would do anyway on
     the next render; calling it here means the screen changes under the cursor
     rather than a moment later. */
  function choose(key) {
    applyTheme(key)
    updateAppSettings({ theme: key })
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
          <Palette className="w-4 h-4 text-brand-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-slate-100">Appearance</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            The colours of the office application. Applies to this device.
          </p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-100">Theme</h2>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">
          Choose one and the screen changes at once — nothing to save, and nothing to reload.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map(t => {
            const active = t.key === current
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => choose(t.key)}
                aria-pressed={active}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  active
                    ? 'border-brand-500 bg-brand-600/10'
                    : 'border-surface-border hover:border-brand-600/50 hover:bg-surface-hover/40'
                }`}
              >
                <Preview theme={t} />

                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100">{t.label}</span>
                  {t.key === DEFAULT_THEME && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-slate-500/20 text-slate-400">
                      Standard
                    </span>
                  )}
                  {active && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-brand-300">
                      <Check className="w-3.5 h-3.5" /> In use
                    </span>
                  )}
                </div>

                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{t.note}</p>

                {/* The four colours the theme is built from, in the open. */}
                <div className="mt-2 flex items-center gap-1.5">
                  {t.swatch.map(c => (
                    <span key={c} className="h-4 w-4 rounded border border-black/20" style={{ background: c }} title={c} />
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-start gap-2.5">
          <Monitor className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-xs text-slate-500 leading-relaxed">
            <p>
              <span className="text-slate-300 font-medium">This device only.</span> The theme is stored on this
              computer, like the other preferences in App Settings. Signing in elsewhere keeps that machine’s
              own choice.
            </p>
            <p>
              <span className="text-slate-300 font-medium">The office application only.</span> The public front
              page and the customer mobile application have palettes of their own and are not affected.
            </p>
            <p>
              <span className="text-slate-300 font-medium">Status colours stay put.</span> Green for delivered,
              amber for due, red for cancelled and the rest keep their meaning in every theme — they are the
              one thing a colour scheme must not repaint.
            </p>
          </div>
        </div>
      </div>

    </div>
  )
}
