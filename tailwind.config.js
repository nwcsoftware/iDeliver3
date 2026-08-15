/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
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
        shop: {
          50:  '#FFF8EF',   // cream ground
          100: '#FDEBE4',   // warm tint for cards / chips
          200: '#F6CFC4',
          300: '#EDA396',
          400: '#DC6A5C',
          500: '#C1272D',
          600: '#B3122B',   // primary
          700: '#8E0F22',
          800: '#6B0B19',
          900: '#4A0711',
        },
        fresh: {
          50:  '#F3F5EC',
          100: '#E4E9D6',
          200: '#C9D3AD',
          300: '#A8B77F',
          400: '#859B57',
          500: '#6B8043',
          600: '#5A6E3A',   // olive — stock, confirmations
          700: '#45542C',
          800: '#333F21',
          900: '#232C17',
        },
        accent: {
          400: '#EFCB5C',
          500: '#E4B429',   // souk gold
          600: '#C2951A',
        },
        surface: {
          DEFAULT: '#0f172a',
          card:    '#1e293b',
          hover:   '#334155',
          border:  '#334155',
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
