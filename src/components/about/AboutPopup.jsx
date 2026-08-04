import React from 'react'
import { X, Cpu, Globe, Sparkles, ShieldCheck, Mail } from 'lucide-react'
import nxcoreLogo from '../../assets/nxcore-logo.png'
import { APP_NAME, APP_VERSION } from '../../lib/appVersion'

/*
  About _NXCORE — the company that builds this software.

  This popup deliberately breaks out of the app's dark theme and renders in the
  logo's own palette: pure black on white, dot-matrix wordmark, monospace type.
  Everything is scoped to `.nx-about` so it never leaks into the rest of the UI.
*/

const CAPABILITIES = [
  { icon: Cpu,         title: 'AI at the Core',        text: 'Intelligent automation and machine-learning baked into every product we ship.' },
  { icon: Globe,       title: 'Web · Desktop · Mobile', text: 'Multipurpose software and web applications built on the most advanced platforms.' },
  { icon: ShieldCheck, title: '30 Years of Craft',      text: 'Three decades of engineering experience turning ideas into systems that scale.' },
]

export default function AboutPopup({ open, onClose }) {
  if (!open) return null

  return (
    <div className="nx-about fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}>
      <style>{`
        .nx-about-card {
          font-family: 'Courier New', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          background: #ffffff;
          color: #0a0a0a;
        }
        @keyframes nx-scan {
          from { transform: translateY(-100%); }
          to   { transform: translateY(100%); }
        }
        .nx-scan::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(180deg, transparent, rgba(0,0,0,0.06) 50%, transparent);
          animation: nx-scan 4.5s linear infinite;
          pointer-events: none;
        }
      `}</style>

      <div className="nx-about-card nx-scan relative w-full max-w-xl overflow-hidden border-2 border-black shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} title="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center border border-black/20 text-black hover:bg-black hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>

        <div className="px-8 pt-12 pb-8">

          {/* Wordmark — the real _NXCORE dot-matrix logo */}
          <div className="flex flex-col items-center text-center">
            <img src={nxcoreLogo} alt="_NXCORE"
              className="w-full max-w-[380px] h-auto object-contain select-none" draggable="false" />
            <div className="mt-1 h-px w-40 bg-black/80" />
          </div>

          {/* Tagline */}
          <p className="mt-6 text-center text-[15px] font-bold uppercase tracking-[0.15em] leading-snug">
            Building the Next Core of Intelligent Software
          </p>
          <p className="mx-auto mt-3 max-w-md text-center text-[12.5px] leading-relaxed text-black/70">
            Multipurpose software and web applications, engineered on the most advanced
            platforms with AI integration at the core — backed by 30 years of experience
            turning ideas into systems that scale.
          </p>

          {/* Capabilities */}
          <div className="mt-7 grid grid-cols-1 gap-px border border-black/15 bg-black/15 sm:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="bg-white px-4 py-5 text-center">
                <Icon className="mx-auto h-6 w-6" strokeWidth={1.6} />
                <p className="mt-2.5 text-[11px] font-bold uppercase tracking-widest">{title}</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-black/60">{text}</p>
              </div>
            ))}
          </div>

          {/* Signature line */}
          <div className="mt-7 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.2em] text-black/60">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Designed &amp; Engineered by _NXCORE</span>
          </div>

          {/* Footer */}
          <div className="mt-6 flex flex-col items-center gap-2 border-t border-black/15 pt-5 text-[11px] text-black/55 sm:flex-row sm:justify-between">
            <span>© {new Date().getFullYear()} _NXCORE. All rights reserved.</span>
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> {APP_NAME} · Delivery Management Suite · v{APP_VERSION}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
