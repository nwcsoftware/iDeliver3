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
      },
      animation: {
        'bell-ring': 'bell-ring 2.2s ease-in-out infinite',
        'msg-nudge': 'msg-nudge 0.9s ease-in-out 3',
      },
    },
  },
  plugins: [],
}
