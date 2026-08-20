/* Export the application menu to Excel, so it can be reorganised by hand and
   handed back.

   The structure is READ FROM Sidebar.jsx rather than retyped here — an export
   that drifts from the real menu is worse than no export. Run with:

     node scripts/export-menu.cjs                                            */

const fs   = require('fs')
const path = require('path')
const { buildWorkbook } = require('./lib/xlsx-min.cjs')

const ROOT    = path.join(__dirname, '..')
const SIDEBAR = path.join(ROOT, 'src/components/layout/Sidebar.jsx')
const OUT     = path.join(ROOT, 'iDeliver-Menu-Structure.xlsx')

const src = fs.readFileSync(SIDEBAR, 'utf8')

/* Pull `{ to: '…', icon: X, label: '…', superOnly: true }` out of a block. */
function parseItems(block) {
  const items = []
  const re = /\{\s*to:\s*'([^']*)'\s*,\s*icon:\s*([A-Za-z0-9_]+)\s*,\s*label:\s*'([^']*)'([^}]*)\}/g
  let m
  while ((m = re.exec(block)) !== null) {
    const [, to, icon, label, rest] = m
    items.push({
      to, icon, label,
      superOnly: /superOnly:\s*true/.test(rest),
      adminOnly: /adminOnly:\s*true/.test(rest),
    })
  }
  return items
}

/* The block of text between a marker and the line that closes its array. */
function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker)
  if (a === -1) throw new Error('not found in Sidebar.jsx: ' + startMarker)
  const b = src.indexOf(endMarker, a)
  return src.slice(a, b === -1 ? undefined : b)
}

const pinned = parseItems(slice('const pinnedNav = [', '\n]'))

/* Each group: its key/label/flags, then the items inside it.

   Scanned rather than matched with one large regular expression: a group may
   open with a comment before `key:` (the Super Admin one does), and a pattern
   that quietly skips such a group would drop nine entries from the export
   without anyone noticing. */
const groupsBlock = slice('const navGroups = [', '\nconst GROUPS_KEY')
const groups = []

const keyRe = /key:\s*'([^']+)'/g
let k
while ((k = keyRe.exec(groupsBlock)) !== null) {
  const rest      = groupsBlock.slice(k.index)
  const itemsAt   = rest.indexOf('items: [')
  if (itemsAt === -1) continue
  const head      = rest.slice(0, itemsAt)              // label, icon, flags
  const itemsEnd  = rest.indexOf('\n    ],', itemsAt)
  const itemsBody = rest.slice(itemsAt, itemsEnd === -1 ? undefined : itemsEnd)

  const label = /label:\s*'([^']+)'/.exec(head)?.[1] || k[1]
  const icon  = /icon:\s*([A-Za-z0-9_]+)/.exec(head)?.[1] || ''
  groups.push({
    key: k[1], label, icon,
    adminOnly: /adminOnly:\s*true/.test(head),
    superOnly: /superOnly:\s*true/.test(head),
    items: parseItems(itemsBody),
  })
}

// The export is only useful if it is complete — say so loudly if it is not.
const expectedGroups = (groupsBlock.match(/key:\s*'/g) || []).length
if (groups.length !== expectedGroups) {
  throw new Error(`parsed ${groups.length} groups but Sidebar.jsx declares ${expectedGroups}`)
}

const who = (it, group) => {
  if (it.superOnly || group?.superOnly) return 'Super admin only'
  if (it.adminOnly || group?.adminOnly) return 'Admin + Super admin'
  return 'Everyone with office access'
}

/* ── Sheet 1: the menu, one row per destination ───────────────────────── */

const header = [
  'Row', 'Where', 'Group', 'Group #', 'Item', 'Item #', 'Route', 'Icon', 'Visible to',
  'NEW Group', 'NEW Group #', 'NEW Item #', 'Rename to', 'Remove?', 'Notes',
]
const widths = [6, 12, 24, 9, 26, 8, 30, 18, 26, 24, 12, 12, 22, 10, 34]

const rows = []
let n = 0

for (const [i, it] of pinned.entries()) {
  rows.push([++n, 'Rail (pinned)', '—', '', it.label, i + 1, it.to, it.icon, who(it), '', '', '', '', '', ''])
}
for (const [gi, group] of groups.entries()) {
  for (const [ii, it] of group.items.entries()) {
    rows.push([
      ++n, 'Menu fly-out', group.label, gi + 1, it.label, ii + 1, it.to, it.icon, who(it, group),
      '', '', '', '', '', '',
    ])
  }
}

/* ── Sheet 2: how to use it, so the file explains itself ──────────────── */

const guide = [
  ['1', 'Reorganise by filling the blue columns on the right — leave the left ones as they are. They are how I match each row back to the real screen.'],
  ['2', 'NEW Group — type the group a row should move to. A group name that does not exist yet creates it; leave blank to keep it where it is.'],
  ['3', 'NEW Group # — the order of the groups themselves, top to bottom (1, 2, 3 …). Only needs filling on one row per group.'],
  ['4', 'NEW Item # — the order of items inside their group.'],
  ['5', 'Rename to — a different label for the menu entry. The screen it opens does not change, only its name.'],
  ['6', 'Remove? — put "yes" to take an entry out of the menu. The page itself stays in the app and keeps working if someone has its address.'],
  ['7', 'Where — "Rail (pinned)" is the narrow strip always on screen; "Menu fly-out" is the panel that opens from the Menu button. Change this cell to move a row between them.'],
  ['8', 'Route and Icon are for my use — please leave them untouched. Icons come from a fixed set; ask in Notes if you want a different one.'],
  ['9', 'Visible to is not editable here. Permissions are set in the code, not in the menu; tell me in Notes if one is wrong.'],
  ['10', 'Save the file and send it back. I will apply it and show you the result before anything is committed.'],
]

const sheets = [
  { name: 'Menu', header, rows, widths },
  {
    name: 'How to use',
    header: ['#', 'What to do'],
    rows: guide,
    widths: [5, 120],
  },
]

fs.writeFileSync(OUT, buildWorkbook(sheets))
console.log('written:', OUT)
console.log('pinned items:', pinned.length)
console.log('groups:', groups.length, '→', groups.map(x => `${x.label} (${x.items.length})`).join(', '))
console.log('total destinations:', rows.length)
