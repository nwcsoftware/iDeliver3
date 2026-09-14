/* Office console themes — the whole look of the application, in three palettes.
 *
 * WHY THIS WORKS WITHOUT TOUCHING A SINGLE SCREEN
 *
 * The console paints with three token families and almost nothing else:
 *
 *   surface-*   the grounds — the page, the cards, the hover, the borders
 *   slate-*     the text — 2,500 of its 2,900 uses are `text-slate-N`
 *   brand-*     the accent — buttons and fills at 500/600, accent TEXT at 200–400
 *
 * tailwind.config resolves all three through CSS variables, so a theme is a set
 * of variable values written onto the root element. No component knows a theme
 * exists — the same trick the customer app already uses for its own palette.
 *
 * TWO RULES THE PALETTES BELOW FOLLOW, AND WHY
 *
 * 1. The LOW end of a ramp is text; the HIGH end is a ground. On the dark
 *    standard theme `text-slate-100` is near-white against a near-black page.
 *    On a light theme the same class must be near-BLACK against a white page,
 *    so the light palettes darken 100–600 rather than leaving them pale. The
 *    same applies to brand 200–400, which carry accent text.
 *
 * 2. 700–950 are deliberately NOT inverted. They are scrims: `bg-slate-950/70`
 *    is the dimmer behind a modal, and a dimmer has to stay dark or the dialog
 *    stops standing out. A light theme still dims with black.
 *
 * The standard palette reproduces the shipped values exactly, so choosing it is
 * indistinguishable from having no theme at all.
 */

/* Tailwind's own slate, as "r g b". Shared by every theme for the shades that
   are grounds and scrims rather than text. */
const SLATE_BASE = {
  '--slate-50':  '248 250 252',
  '--slate-700': '51 65 85',
  '--slate-800': '30 41 59',
  '--slate-900': '15 23 42',
  '--slate-950': '2 6 23',
}

/* The text end of the ramp, dark-on-light. Shared by the two light themes
   except for the hue: `neutral` drops the blue cast for Mono. */
const inkRamp = (neutral = false) => (neutral ? {
  '--slate-100': '10 10 10',
  '--slate-200': '23 23 23',
  '--slate-300': '38 38 38',
  '--slate-400': '64 64 64',
  '--slate-500': '115 115 115',
  '--slate-600': '163 163 163',
} : {
  '--slate-100': '15 23 42',
  '--slate-200': '30 41 59',
  '--slate-300': '51 65 85',
  '--slate-400': '71 85 105',
  '--slate-500': '100 116 139',
  '--slate-600': '148 163 184',
})


/* Status hues shifted for a light ground. `text-green-400` is a tint chosen to
   glow on near-black; on white it is barely there. Each text shade moves to a
   darker sibling of the SAME hue, so "delivered" is still green and "cancelled"
   still red — only legible. Solid fills (500 and up) are untouched. */
const STATUS_ON_LIGHT = {
      '--red-100': '153 27 27',
      '--red-200': '185 28 28',
      '--red-300': '185 28 28',
      '--red-400': '220 38 38',
      '--green-100': '22 101 52',
      '--green-200': '21 128 61',
      '--green-300': '21 128 61',
      '--green-400': '22 163 74',
      '--amber-100': '146 64 14',
      '--amber-200': '180 83 9',
      '--amber-300': '180 83 9',
      '--amber-400': '217 119 6',
      '--emerald-100': '6 95 70',
      '--emerald-200': '4 120 87',
      '--emerald-300': '4 120 87',
      '--emerald-400': '5 150 105',
      '--cyan-100': '21 94 117',
      '--cyan-200': '14 116 144',
      '--cyan-300': '14 116 144',
      '--cyan-400': '8 145 178',
      '--fuchsia-100': '134 25 143',
      '--fuchsia-200': '162 28 175',
      '--fuchsia-300': '162 28 175',
      '--fuchsia-400': '192 38 211',
      '--yellow-100': '133 77 14',
      '--yellow-200': '161 98 7',
      '--yellow-300': '161 98 7',
      '--yellow-400': '202 138 4',
      '--teal-100': '17 94 89',
      '--teal-200': '15 118 110',
      '--teal-300': '15 118 110',
      '--teal-400': '13 148 136',
      '--rose-100': '159 18 57',
      '--rose-200': '190 18 60',
      '--rose-300': '190 18 60',
      '--rose-400': '225 29 72',
      '--sky-100': '7 89 133',
      '--sky-200': '3 105 161',
      '--sky-300': '3 105 161',
      '--sky-400': '2 132 199',
      '--purple-100': '107 33 168',
      '--purple-200': '126 34 206',
      '--purple-300': '126 34 206',
      '--purple-400': '147 51 234',
      '--orange-100': '154 52 18',
      '--orange-200': '194 65 12',
      '--orange-300': '194 65 12',
      '--orange-400': '234 88 12',
      '--blue-100': '30 64 175',
      '--blue-200': '29 78 216',
      '--blue-300': '29 78 216',
      '--blue-400': '37 99 235',
      '--indigo-100': '55 48 163',
      '--indigo-200': '67 56 202',
      '--indigo-300': '67 56 202',
      '--indigo-400': '79 70 229',
      '--lime-100': '63 98 18',
      '--lime-200': '77 124 15',
      '--lime-300': '77 124 15',
      '--lime-400': '101 163 13',
      '--violet-100': '91 33 182',
      '--violet-200': '109 40 217',
      '--violet-300': '109 40 217',
      '--violet-400': '124 58 237',
      '--pink-100': '157 23 77',
      '--pink-200': '190 24 93',
      '--pink-300': '190 24 93',
      '--pink-400': '219 39 119',
}

export const THEMES = [
  {
    key: 'standard',
    label: 'Standard',
    note: 'The dark console as it has always looked. Indigo on deep navy.',
    /* Swatches for the picker: page, card, accent, text. */
    swatch: ['#0f172a', '#1e293b', '#6366f1', '#f1f5f9'],
    vars: {
      '--surface':        '15 23 42',
      '--surface-card':   '30 41 59',
      '--surface-hover':  '51 65 85',
      '--surface-border': '51 65 85',

      '--brand-50':  '238 242 255',
      '--brand-100': '224 231 255',
      '--brand-200': '199 210 254',
      '--brand-300': '165 180 252',
      '--brand-400': '129 140 248',
      '--brand-500': '99 102 241',
      '--brand-600': '79 70 229',
      '--brand-700': '67 56 202',
      '--brand-800': '55 48 163',
      '--brand-900': '49 46 129',

      ...SLATE_BASE,
      '--slate-100': '241 245 249',
      '--slate-200': '226 232 240',
      '--slate-300': '203 213 225',
      '--slate-400': '148 163 184',
      '--slate-500': '100 116 139',
      '--slate-600': '71 85 105',
    },
  },

  {
    key: 'light',
    label: 'Light',
    note: 'White and pastel — a soft blue page, white cards, silver edges.',
    swatch: ['#f5f8fc', '#ffffff', '#1f74ad', '#0f172a'],
    vars: {
      '--surface':        '245 248 252',   // the page: white with a blue breath in it
      '--surface-card':   '255 255 255',   // cards are plain white, so they lift
      '--surface-hover':  '230 238 247',   // pastel blue on hover
      '--surface-border': '211 221 232',   // silver

      /* Light blue. 200–400 are accent TEXT on white, so they are the deep end;
         500/600 stay saturated because they are filled buttons with white on them. */
      '--brand-50':  '239 246 255',
      '--brand-100': '219 234 254',
      '--brand-200': '30 95 138',
      '--brand-300': '23 96 143',
      '--brand-400': '27 111 168',
      '--brand-500': '43 138 201',
      '--brand-600': '31 116 173',
      '--brand-700': '24 92 138',
      '--brand-800': '19 70 99',
      '--brand-900': '13 49 71',

      ...SLATE_BASE,
      ...inkRamp(false),
      ...STATUS_ON_LIGHT,
    },
  },

  {
    key: 'mono',
    label: 'Mono',
    note: 'White and black. No colour but the status badges.',
    swatch: ['#fafafa', '#ffffff', '#000000', '#0a0a0a'],
    vars: {
      '--surface':        '250 250 250',
      '--surface-card':   '255 255 255',
      '--surface-hover':  '240 240 240',
      '--surface-border': '212 212 212',

      '--brand-50':  '245 245 245',
      '--brand-100': '229 229 229',
      '--brand-200': '38 38 38',
      '--brand-300': '28 28 28',
      '--brand-400': '43 43 43',
      '--brand-500': '23 23 23',
      '--brand-600': '0 0 0',
      '--brand-700': '0 0 0',
      '--brand-800': '0 0 0',
      '--brand-900': '0 0 0',

      ...SLATE_BASE,
      ...inkRamp(true),
      ...STATUS_ON_LIGHT,
    },
  },
]

export const DEFAULT_THEME = 'standard'

export const themeByKey = key => THEMES.find(t => t.key === key) || THEMES[0]

/** Is this a light-grounded theme? Used for the one thing a variable cannot
 *  carry: telling the browser to draw light scrollbars and form controls. */
export const isLightTheme = key => key === 'light' || key === 'mono'

/**
 * Paint a theme onto the document.
 *
 * The variables go on the ROOT element rather than the console's own wrapper
 * because two panels — the order drawer and the order quick view — render into
 * <body> through a portal. A portal inherits CSS from where it is mounted, not
 * from where it was written, so anything short of the root would leave those
 * two painted in the previous theme.
 *
 * The office console, the public front page and the customer application are
 * three separate branches of App.jsx and never mount together, so putting the
 * console's palette on the root cannot reach the other two.
 */
export function applyTheme(key, el = null) {
  const target = el || (typeof document !== 'undefined' ? document.documentElement : null)
  if (!target) return
  const theme = themeByKey(key)
  for (const [k, v] of Object.entries(theme.vars)) target.style.setProperty(k, v)
  target.dataset.officeTheme = theme.key
  // Scrollbars, date pickers and select popups are drawn by the browser, not by
  // us; this is the only way to stop them arriving black on a white page.
  target.style.colorScheme = isLightTheme(theme.key) ? 'light' : 'dark'
}

/** Hand the document back to the stylesheet's own defaults (the standard look). */
export function clearTheme(el = null) {
  const target = el || (typeof document !== 'undefined' ? document.documentElement : null)
  if (!target) return
  for (const theme of THEMES) {
    for (const k of Object.keys(theme.vars)) target.style.removeProperty(k)
  }
  delete target.dataset.officeTheme
  target.style.colorScheme = ''
}
