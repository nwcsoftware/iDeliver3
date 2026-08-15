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

export async function fetchAllRows(build, pageSize = PAGE_SIZE) {
  const all = []
  for (let page = 0; ; page++) {
    // One retry per page: these are large embedded selects and a single slow
    // response (or a dropped connection) used to lose the whole fetch.
    let { data, error } = await build()
      .range(page * pageSize, page * pageSize + pageSize - 1)
    if (error) {
      ;({ data, error } = await build()
        .range(page * pageSize, page * pageSize + pageSize - 1))
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
