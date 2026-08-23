import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  console.warn(
    '[iDeliver] Supabase env vars missing. Copy .env.example → .env and add your project credentials.'
  )
}

/* The project's own address and publishable key. Exported because one upload
   path talks to the storage endpoint directly (XHR) to report progress on a
   large file — something the client's fetch-based upload cannot do. */
export const SUPABASE_URL      = supabaseUrl  || 'https://placeholder.supabase.co'
export const SUPABASE_ANON_KEY = supabaseAnon || 'placeholder'

export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnon || 'placeholder',
  {
    realtime: { params: { eventsPerSecond: 10 } },
  }
)

/* PostgREST silently truncates every response at 1000 rows — a table that grows past
   that loses its oldest rows from the app with no error. Any query that must return a
   whole table (orders, contacts) has to be paged through instead.

   `build` is called once per page and must return a fresh query builder:
     const { data, error } = await fetchAllRows(() =>
       supabase.from('contacts').select('*').order('first_name'))

   Order by a unique tiebreaker (id) alongside the sort key, otherwise rows with equal
   sort values can be skipped or duplicated across page boundaries. */
export const PAGE_SIZE = 1000

/* Heavy embedded selects need a smaller page. The `anon` role runs under a
   short Postgres statement timeout, and a page of orders WITH their items,
   packages, invoices, payments and ads is expensive per row. Measured against
   this database: 100 rows 1.5s, 150 rows 1.6s, 300 rows 2.6s, 1,000 rows 2.3s
   at the head but far worse in the tail — and anything near the timeout is
   cancelled outright ("canceling statement due to statement timeout"), losing
   the load. 150 leaves comfortable headroom for a few more round trips. */
export const HEAVY_PAGE_SIZE = 150

export async function fetchAllRows(build, pageSize = PAGE_SIZE) {
  const all = []
  for (let page = 0; ; page++) {
    // These are large embedded selects, so a page can be cancelled by the
    // server's statement timeout. Retry it — and if it failed on time, retry it
    // in halves, which usually gets under the limit.
    const from = page * pageSize
    let { data, error } = await build().range(from, from + pageSize - 1)
    if (error) {
      const timedOut = /timeout|canceling statement/i.test(error.message || '')
      if (timedOut && pageSize > 50) {
        const half = Math.ceil(pageSize / 2)
        const a = await build().range(from, from + half - 1)
        const b = a.error ? a : await build().range(from + half, from + pageSize - 1)
        if (!a.error && !b.error) {
          data = [...(a.data ?? []), ...(b.data ?? [])]
          error = null
        }
      } else {
        ;({ data, error } = await build().range(from, from + pageSize - 1))
      }
    }
    if (error) {
      // Hand back what DID arrive. A partial list beats an empty screen, and
      // the caller is told it is partial so it can say so.
      return { data: all.length ? all : null, error, partial: all.length > 0 }
    }
    all.push(...(data ?? []))
    if ((data?.length ?? 0) < pageSize) break
  }
  return { data: all, error: null, partial: false }
}

/* Page a large, heavy query WITHOUT offsets.

   `.range(9000, 9299)` forces Postgres to sort and discard 9,000 rows before
   returning anything, so each page is slower than the last and the deep ones
   are killed by the statement timeout (measured here: page 1 1.4s, page 10
   3.9s, page 30 a 500). Keyset paging instead asks for "the next N rows older
   than the last one I saw", which costs the same at any depth.

   `build(cursor)` receives the newest-first cursor (or null for the first
   page) and must apply it. Rows are de-duplicated by id, so a cursor that
   overlaps by a row or two — which is what keeps rows sharing a timestamp from
   being skipped — is harmless. */
export async function fetchAllRowsKeyset(build, { pageSize = HEAVY_PAGE_SIZE, cursorColumn = 'created_at' } = {}) {
  const all = []
  const seen = new Set()
  let cursor = null
  for (let guard = 0; guard < 500; guard++) {
    const { data, error } = await build(cursor).limit(pageSize)
    if (error) return { data: all.length ? all : null, error, partial: all.length > 0 }
    const rows = data ?? []
    let added = 0
    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id); all.push(r); added += 1
    }
    // Fewer rows than asked for = the end. Nothing new = the cursor cannot
    // advance (every row shares a timestamp), so stop rather than loop.
    if (rows.length < pageSize || added === 0) break
    cursor = rows[rows.length - 1][cursorColumn]
  }
  return { data: all, error: null, partial: false }
}
