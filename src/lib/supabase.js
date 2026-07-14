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
    const { data, error } = await build()
      .range(page * pageSize, page * pageSize + pageSize - 1)
    if (error) return { data: null, error }
    all.push(...(data ?? []))
    if ((data?.length ?? 0) < pageSize) break
  }
  return { data: all, error: null }
}
