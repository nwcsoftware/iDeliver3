#!/usr/bin/env node
/* Lift the photographs out of the rows and into the shop-media bucket.
 *
 *   node scripts/lift-shop-images.cjs --dry-run     see what would move
 *   node scripts/lift-shop-images.cjs               move it
 *
 * Run ONCE, after supabase-fix143.sql.
 *
 * Why a script and not SQL: the pictures are base64 data URLs sitting inside
 * `shop_inventory.images`, `products.images` and the swatch entries inside
 * `options` / `colors` / `sizes`. Postgres cannot decode one and hand the bytes
 * to the storage API, so something has to read each row, POST the decoded bytes
 * to the bucket, and write the URL back.
 *
 * Measured on this install before running it: four displayed shop items came to
 * 2423 KB and took 55 seconds to fetch. The same rows without the image columns
 * were 3 KB and half a second.
 *
 * SAFE TO RE-RUN. A row whose pictures are already URLs is skipped, so an
 * interrupted run continues where it stopped rather than duplicating anything.
 * Nothing is deleted: the row is only rewritten once its uploads have all
 * succeeded, and a row that fails is left exactly as it was.
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const env = {}
for (const f of ['.env', '.env.local']) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
const URL_BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL_BASE || !KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found in .env or .env.local')
  process.exit(1)
}

const BUCKET = 'shop-media'
const DRY = process.argv.includes('--dry-run')
const H = { apikey: KEY, authorization: 'Bearer ' + KEY }
const kb = n => (n / 1024).toFixed(0) + ' KB'

async function rest(pathname, opts = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${pathname}`, {
    ...opts,
    headers: { ...H, 'content-type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const isData = v => typeof v === 'string' && /^data:image\//i.test(v)

/* One data URL -> one object in the bucket. Returns its public URL. */
async function upload(dataUrl, folder) {
  const m = /^data:(image\/[a-z.+-]+);base64,(.*)$/is.exec(dataUrl)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const bytes = Buffer.from(m[2], 'base64')
  const ext = mime.includes('png') ? 'png'
    : mime.includes('webp') ? 'webp'
    : mime.includes('gif') ? 'gif' : 'jpg'
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8)
  const objectPath = `${folder}/${stamp}-${rand}.${ext}`

  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { ...H, 'content-type': mime, 'cache-control': 'max-age=31536000', 'x-upsert': 'false' },
    body: bytes,
  })
  if (!r.ok) {
    const t = await r.text()
    if (/bucket not found|nosuchbucket/i.test(t)) {
      throw new Error('The shop-media bucket is missing — run supabase-fix143.sql first.')
    }
    throw new Error(`upload failed ${r.status}: ${t.slice(0, 200)}`)
  }
  return { url: `${URL_BASE}/storage/v1/object/public/${BUCKET}/${objectPath}`, size: bytes.length }
}

/* Walk anything — array, object, string — swapping data URLs for uploaded ones.
   Used for `options`, `colors` and `sizes`, where the swatch photograph is one
   field of one value of one group and the shape has changed twice already. */
async function liftDeep(value, folder, stats) {
  if (isData(value)) {
    if (DRY) { stats.found += 1; stats.bytes += Buffer.byteLength(value); return value }
    const up = await upload(value, folder)
    if (!up) return value
    stats.found += 1
    stats.bytes += Buffer.byteLength(value)
    stats.uploaded += 1
    return up.url
  }
  if (Array.isArray(value)) {
    const out = []
    for (const v of value) out.push(await liftDeep(v, folder, stats))
    return out
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = await liftDeep(v, folder, stats)
    return out
  }
  return value
}

async function liftTable(table, cols) {
  console.log(`\n── ${table} ─────────────────────────────────────────────`)
  const rows = await rest(`${table}?select=id,name,${cols.join(',')}`)
  let moved = 0
  const total = { found: 0, uploaded: 0, bytes: 0 }

  for (const row of rows) {
    const stats = { found: 0, uploaded: 0, bytes: 0 }
    const patch = {}

    for (const col of cols) {
      if (row[col] === undefined) continue
      const folder = col === 'images' ? 'items' : 'options'
      const next = await liftDeep(row[col], folder, stats)
      if (JSON.stringify(next) !== JSON.stringify(row[col])) patch[col] = next
    }
    if (stats.found === 0) continue

    // The cover mirror follows whatever `images` ended up as.
    if (patch.images && Array.isArray(patch.images)) patch.image_url = patch.images[0] || null

    const label = String(row.name || row.id).slice(0, 30).padEnd(32)
    if (DRY) {
      console.log(`  ${label}${String(stats.found).padStart(2)} picture(s)  ${kb(stats.bytes).padStart(10)}   would move`)
    } else {
      await rest(`${table}?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      console.log(`  ${label}${String(stats.uploaded).padStart(2)} picture(s)  ${kb(stats.bytes).padStart(10)}   moved`)
      moved += 1
    }
    total.found += stats.found; total.uploaded += stats.uploaded; total.bytes += stats.bytes
  }

  if (total.found === 0) console.log('  nothing stored as base64 — already clean')
  else console.log(`  ${total.found} picture(s), ${kb(total.bytes)} ${DRY ? 'would come' : 'came'} out of ${DRY ? rows.length : moved} row(s)`)
  return total
}

;(async () => {
  console.log(DRY ? 'DRY RUN — nothing will be written\n' : 'Lifting shop photographs into storage\n')
  const a = await liftTable('shop_inventory', ['images', 'options', 'colors', 'sizes'])
  const b = await liftTable('products', ['images', 'options', 'colors', 'sizes'])
  const bytes = a.bytes + b.bytes
  console.log(`\n${DRY ? 'Would move' : 'Moved'} ${a.found + b.found} picture(s), ${kb(bytes)} out of the database.`)
  if (DRY) console.log('Run again without --dry-run to do it.')
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1) })
