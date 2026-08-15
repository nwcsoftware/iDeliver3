import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  console.warn(
    '[iDeliver] Supabase env vars missing. Copy .env.example → .env and add your project credentials.'
  )
}

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
   short Postgres statement timeout, and one page of 1,000 orders WITH their
   items, packages, invoices, payments and ads sits right at that limit — under
   any load it is cancelled ("canceling statement due to statement timeout")
   and the whole load fails. A few hundred rows per page finishes comfortably
   and costs only a couple of extra round trips. */
export const HEAVY_PAGE_SIZE = 300

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
