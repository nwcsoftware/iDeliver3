/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Resolved through CSS variables so the office console can be
           repainted at runtime (src/lib/appThemes.js). The defaults in
           index.css reproduce the indigo scale exactly, so an installation
           with no theme chosen looks precisely as it always has. */
        brand: {
          50:  'rgb(var(--brand-50)  / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        /* The console's text ramp. Overriding Tailwind's own `slate` means the
           2,500 `text-slate-N` classes already written across the screens
           become theme-aware without one of them being edited. */
        slate: {
          50:  'rgb(var(--slate-50)  / <alpha-value>)',
          100: 'rgb(var(--slate-100) / <alpha-value>)',
          200: 'rgb(var(--slate-200) / <alpha-value>)',
          300: 'rgb(var(--slate-300) / <alpha-value>)',
          400: 'rgb(var(--slate-400) / <alpha-value>)',
          500: 'rgb(var(--slate-500) / <alpha-value>)',
          600: 'rgb(var(--slate-600) / <alpha-value>)',
          700: 'rgb(var(--slate-700) / <alpha-value>)',
          800: 'rgb(var(--slate-800) / <alpha-value>)',
          900: 'rgb(var(--slate-900) / <alpha-value>)',
          950: 'rgb(var(--slate-950) / <alpha-value>)',
        },
        /* ── Customer app palette ───────────────────────────────────────
           The app paints with ROLES, not colour names: `shop` carries the
           actions, `fresh` the confirmations and stock, `accent` the
           highlights. Swapping the whole look is therefore this block alone.

           ACTIVE: "Pomegranate & Olive" — pomegranate on cream, olive for
           anything confirming, souk gold for highlights.
           Also drafted: "Cedar & Saffron" —
             shop  600 #0F5132 / 500 #14603A / 100 #E7EFE8 / 50 #FFF7EC
             fresh 500 #DC9200 · accent 500 #F4A300
           The page ground (#FFF8EF) and the shadow rgba values in
           CustomerMobileApp.jsx follow whichever palette is active. */
        /* Resolved through CSS variables so a scheduled theme can repaint the
           whole customer app at runtime (src/lib/customerThemes.js) without a
           single component knowing a theme exists. The defaults live in
           index.css and reproduce "Pomegranate & Olive" exactly, so an app
           with no theme scheduled looks precisely as it always has. */
        shop: {
          50:  'rgb(var(--shop-50)  / <alpha-value>)',
          100: 'rgb(var(--shop-100) / <alpha-value>)',
          200: 'rgb(var(--shop-200) / <alpha-value>)',
          300: 'rgb(var(--shop-300) / <alpha-value>)',
          400: 'rgb(var(--shop-400) / <alpha-value>)',
          500: 'rgb(var(--shop-500) / <alpha-value>)',
          600: 'rgb(var(--shop-600) / <alpha-value>)',
          700: 'rgb(var(--shop-700) / <alpha-value>)',
          800: 'rgb(var(--shop-800) / <alpha-value>)',
          900: 'rgb(var(--shop-900) / <alpha-value>)',
        },
        fresh: {
          50:  'rgb(var(--fresh-50)  / <alpha-value>)',
          100: 'rgb(var(--fresh-100) / <alpha-value>)',
          200: 'rgb(var(--fresh-200) / <alpha-value>)',
          300: 'rgb(var(--fresh-300) / <alpha-value>)',
          400: 'rgb(var(--fresh-400) / <alpha-value>)',
          500: 'rgb(var(--fresh-500) / <alpha-value>)',
          600: 'rgb(var(--fresh-600) / <alpha-value>)',
          700: 'rgb(var(--fresh-700) / <alpha-value>)',
          800: 'rgb(var(--fresh-800) / <alpha-value>)',
          900: 'rgb(var(--fresh-900) / <alpha-value>)',
        },
        // The customer app's page ground — the cream (or Ramadan indigo-tinted
        // cream, or…) behind every screen.
        ground: 'rgb(var(--app-ground) / <alpha-value>)',
        accent: {
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
        },
        /* Status hues. Only the 100-400 shades are routed through variables:
           those are the TEXT tints, picked to read on a dark ground, and a
           light theme has to darken them or "Delivered" turns pale green on
           white. 500 upwards are solid fills and keep Tailwind's own values in
           every theme, so a green badge stays the same green. */
        red: {
          100: 'rgb(var(--red-100) / <alpha-value>)',
          200: 'rgb(var(--red-200) / <alpha-value>)',
          300: 'rgb(var(--red-300) / <alpha-value>)',
          400: 'rgb(var(--red-400) / <alpha-value>)',
        },
        green: {
          100: 'rgb(var(--green-100) / <alpha-value>)',
          200: 'rgb(var(--green-200) / <alpha-value>)',
          300: 'rgb(var(--green-300) / <alpha-value>)',
          400: 'rgb(var(--green-400) / <alpha-value>)',
        },
        amber: {
          100: 'rgb(var(--amber-100) / <alpha-value>)',
          200: 'rgb(var(--amber-200) / <alpha-value>)',
          300: 'rgb(var(--amber-300) / <alpha-value>)',
          400: 'rgb(var(--amber-400) / <alpha-value>)',
        },
        emerald: {
          100: 'rgb(var(--emerald-100) / <alpha-value>)',
          200: 'rgb(var(--emerald-200) / <alpha-value>)',
          300: 'rgb(var(--emerald-300) / <alpha-value>)',
          400: 'rgb(var(--emerald-400) / <alpha-value>)',
        },
        cyan: {
          100: 'rgb(var(--cyan-100) / <alpha-value>)',
          200: 'rgb(var(--cyan-200) / <alpha-value>)',
          300: 'rgb(var(--cyan-300) / <alpha-value>)',
          400: 'rgb(var(--cyan-400) / <alpha-value>)',
        },
        fuchsia: {
          100: 'rgb(var(--fuchsia-100) / <alpha-value>)',
          200: 'rgb(var(--fuchsia-200) / <alpha-value>)',
          300: 'rgb(var(--fuchsia-300) / <alpha-value>)',
          400: 'rgb(var(--fuchsia-400) / <alpha-value>)',
        },
        yellow: {
          100: 'rgb(var(--yellow-100) / <alpha-value>)',
          200: 'rgb(var(--yellow-200) / <alpha-value>)',
          300: 'rgb(var(--yellow-300) / <alpha-value>)',
          400: 'rgb(var(--yellow-400) / <alpha-value>)',
        },
        teal: {
          100: 'rgb(var(--teal-100) / <alpha-value>)',
          200: 'rgb(var(--teal-200) / <alpha-value>)',
          300: 'rgb(var(--teal-300) / <alpha-value>)',
          400: 'rgb(var(--teal-400) / <alpha-value>)',
        },
        rose: {
          100: 'rgb(var(--rose-100) / <alpha-value>)',
          200: 'rgb(var(--rose-200) / <alpha-value>)',
          300: 'rgb(var(--rose-300) / <alpha-value>)',
          400: 'rgb(var(--rose-400) / <alpha-value>)',
        },
        sky: {
          100: 'rgb(var(--sky-100) / <alpha-value>)',
          200: 'rgb(var(--sky-200) / <alpha-value>)',
          300: 'rgb(var(--sky-300) / <alpha-value>)',
          400: 'rgb(var(--sky-400) / <alpha-value>)',
        },
        purple: {
          100: 'rgb(var(--purple-100) / <alpha-value>)',
          200: 'rgb(var(--purple-200) / <alpha-value>)',
          300: 'rgb(var(--purple-300) / <alpha-value>)',
          400: 'rgb(var(--purple-400) / <alpha-value>)',
        },
        orange: {
          100: 'rgb(var(--orange-100) / <alpha-value>)',
          200: 'rgb(var(--orange-200) / <alpha-value>)',
          300: 'rgb(var(--orange-300) / <alpha-value>)',
          400: 'rgb(var(--orange-400) / <alpha-value>)',
        },
        blue: {
          100: 'rgb(var(--blue-100) / <alpha-value>)',
          200: 'rgb(var(--blue-200) / <alpha-value>)',
          300: 'rgb(var(--blue-300) / <alpha-value>)',
          400: 'rgb(var(--blue-400) / <alpha-value>)',
        },
        indigo: {
          100: 'rgb(var(--indigo-100) / <alpha-value>)',
          200: 'rgb(var(--indigo-200) / <alpha-value>)',
          300: 'rgb(var(--indigo-300) / <alpha-value>)',
          400: 'rgb(var(--indigo-400) / <alpha-value>)',
        },
        lime: {
          100: 'rgb(var(--lime-100) / <alpha-value>)',
          200: 'rgb(var(--lime-200) / <alpha-value>)',
          300: 'rgb(var(--lime-300) / <alpha-value>)',
          400: 'rgb(var(--lime-400) / <alpha-value>)',
        },
        violet: {
          100: 'rgb(var(--violet-100) / <alpha-value>)',
          200: 'rgb(var(--violet-200) / <alpha-value>)',
          300: 'rgb(var(--violet-300) / <alpha-value>)',
          400: 'rgb(var(--violet-400) / <alpha-value>)',
        },
        pink: {
          100: 'rgb(var(--pink-100) / <alpha-value>)',
          200: 'rgb(var(--pink-200) / <alpha-value>)',
          300: 'rgb(var(--pink-300) / <alpha-value>)',
          400: 'rgb(var(--pink-400) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface)        / <alpha-value>)',
          card:    'rgb(var(--surface-card)   / <alpha-value>)',
          hover:   'rgb(var(--surface-hover)  / <alpha-value>)',
          border:  'rgb(var(--surface-border) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Header bell "ringing" while orders await confirmation: a quick swing
      // every couple of seconds rather than a constant wobble.
      keyframes: {
        /* Customer app motion. Content arrives rather than appearing: a short
           rise with a fade, staggered per card by an inline delay. */
        'rise-in': {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        /* Loading placeholders sweep instead of blinking. */
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        /* The promo band's slow zoom keeps the hero alive without motion sickness. */
        'ken-burns': {
          '0%':   { transform: 'scale(1) translateX(0)' },
          '100%': { transform: 'scale(1.08) translateX(-1.5%)' },
        },
        /* Press feedback for cards on touch. */
        'pop': {
          '0%':   { transform: 'scale(1)' },
          '50%':  { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)' },
        },
        'bell-ring': {
          '0%, 70%, 100%': { transform: 'rotate(0deg)' },
          '75%':           { transform: 'rotate(14deg)' },
          '80%':           { transform: 'rotate(-12deg)' },
          '85%':           { transform: 'rotate(9deg)' },
          '90%':           { transform: 'rotate(-6deg)' },
          '95%':           { transform: 'rotate(3deg)' },
        },
        // Short nudge on the messages icon when an icon-only broadcast lands.
        'msg-nudge': {
          '0%, 100%':      { transform: 'scale(1) rotate(0deg)' },
          '15%':           { transform: 'scale(1.25) rotate(-10deg)' },
          '35%':           { transform: 'scale(1.15) rotate(8deg)' },
          '55%':           { transform: 'scale(1.2) rotate(-6deg)' },
          '75%':           { transform: 'scale(1.1) rotate(3deg)' },
        },
        // Decorative backdrop in the customer app: parcels bobbing about and a
        // cart drifting across behind the content.
        'bg-float': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%':      { transform: 'translateY(-14px) rotate(6deg)' },
        },
        'bg-drift': {
          '0%':   { transform: 'translateX(-30%)' },
          '100%': { transform: 'translateX(130%)' },
        },
        'bg-sway': {
          '0%, 100%': { transform: 'translateX(0) rotate(-4deg)' },
          '50%':      { transform: 'translateX(18px) rotate(4deg)' },
        },
      },
      animation: {
        'bell-ring': 'bell-ring 2.2s ease-in-out infinite',
        'msg-nudge': 'msg-nudge 0.9s ease-in-out 3',
        'bg-float':  'bg-float 7s ease-in-out infinite',
        'bg-drift':  'bg-drift 26s linear infinite',
        'bg-sway':   'bg-sway 9s ease-in-out infinite',
        'rise-in':   'rise-in .45s cubic-bezier(.22,1,.36,1) both',
        'shimmer':   'shimmer 1.6s linear infinite',
        'ken-burns': 'ken-burns 12s ease-in-out infinite alternate',
        'pop':       'pop .25s ease-out',
      },
    },
  },
  plugins: [],
}
