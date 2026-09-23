# Working on iDeliver III

Vite + React + Supabase. Runs as an Electron desktop app, a web app on Netlify,
and a customer mobile app under `src/customer-mobile/`.

## Database changes

- Every schema change is its own numbered file: `supabase-fixNNN.sql`, next number up.
- **I never run migrations.** The user runs them in the Supabase SQL editor and
  pastes back the result. Write each file so that is enough: a header saying what
  it does and why, and a `SELECT` at the end whose numbers prove it worked.
- Make them safe to re-run — `IF NOT EXISTS`, conditional updates.
- A new enum value cannot be *used* in the transaction that adds it. Split those
  into two files (`fixNNNa` / `fixNNNb`); an instruction at the top of one file is
  not enough, because the file is one click away from running whole.
- New tables need an anon RLS policy or the app silently reads nothing.

## Verifying

- **Check against the live database; don't assert.** Write a throwaway Node script
  in the scratchpad using the anon key from `.env`, and say what it found.
- Verify *independently* of a migration's own check query — confirm the thing,
  not the claim.
- PostgREST silently truncates at 1000 rows. Use `fetchAllRows()` (which returns
  `{ data, error, partial }`, not an array) or page by hand.
- Enum columns compared to text need `::TEXT` on both sides.

## Money

- **Never sum across currencies.** There is no exchange rate anywhere in this
  application, and there must not be one. Report per currency or not at all.
- Cash vs credit follows the **account the order bills to**, never the customer's
  flag. Same for payments.
- `NULL` is not zero. A missing cost is not a free item; a missing reference is
  not a blank one. Report what is unknown rather than averaging it away.

## Roles

Ranked: super admin → admin → **Senior Call Center** → call centre.

**A Senior Call Center user is not a member of administration.** They are an
upgraded normal user — above call centre, below admin. Nothing about the rank
is administrative, and it should not be described or designed as "an admin with
restrictions".

The implementation currently says otherwise, and that is temporary scaffolding,
not the intent: `hasRole()` honours inheritance, so the rank satisfies `admin`
until each exception is carved out. It was started that way so nobody lost work
overnight and so each removal would be deliberate and visible.

What that means when building:

- **Do not assume the rank gets an admin-level feature. Ask.** The default is
  "this is administration, so probably not", even though the code would let them
  through today.
- Exceptions live in `src/lib/roles.js` (`isStrictAdmin`), so the whole
  difference between the two ranks reads in one place.
- Gate on the **route**, not inside the page — a hidden menu entry is not a
  restriction while the address still opens.
- Say plainly when a restriction is client-side only. Users sign in against
  `user_accounts`, not Supabase auth, so every client reaches the database under
  one anon key and no RLS policy can tell an admin from a super admin. Server-side
  enforcement means a `SECURITY DEFINER` RPC that checks the actor.

## Running and shipping

- `npm run dev` — first `Remove-Item Env:ELECTRON_RUN_AS_NODE`, and make sure
  nothing is squatting on port 5173. Closing the Electron window exits 1; that is
  a normal shutdown, not a crash.
- `npm run build` before committing. Git is not on PATH:
  `"C:/Program Files/Git/cmd/git.exe"`.
- **Netlify deploys `main` only.** Pushing a branch reaches no user.
- **Never push unless asked.** Commit freely; publishing is the user's call.
- Bump the version in `src/lib/appVersion.js` *and* `package.json` together
  (npm needs `3.0.20`, the app shows `3.00.020`).

## Writing code here

- Match the surrounding comment style: comments explain *why*, and name the
  mistake being avoided. Code that reads as obvious needs none.
- There is **no error boundary** in this app. A render error blanks the whole
  screen with no message, so a wrong data shape looks like a dead app.
- Prefer one shared calculation over two that agree today. Where two pages show
  the same figure, they should be reading the same function.
