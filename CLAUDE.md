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
  difference between the two ranks reads in one place. So far: the Reports menu
  and its six pages; deleting an order; reopening (so editing) a closed one; and
  most of Administration — App Settings, Front Page, User Accounts, Software
  Subscriptions, Change Requests. Subscriptions stays readable but not writable.
  Also every admin power on the shared pages: deactivating a contact, driver
  admin, editing the company, reactivating a cancelled order, erasing
  settlements, backdating, setting status by hand, bypassing the
  payment/invoice locks — the pages stay open, the powers do not.
  Products are read-only below admin (`canEditProducts`); the senior rank still
  sees costs, Call Center does not (`canSeeProductCosts`). Refilling empties
  on Inventory is admin and Senior Call Center (`canRefillEmpties`);
  correcting the empty COUNT is admin only (`canManageEmpties`); stock
  in / out stays open to call centre.
- **Not** excluded: closing an order, and seeing the licence and expiry notices.
  An ordinary call-centre user does both, and this rank is an upgrade of that
  job, not a demotion from it. Check that before restricting anything else —
  making the senior rank *more* limited than call centre is a sign the rule has
  been read backwards.
- **Logins (fix160).** A partner or supplier may hold several logins, each with
  its own subscription. Admin and Senior Call Center create them **only from the
  partner's profile** (`admin_create_party_login`, guarded by
  `_assert_login_creator` — the link is set by the database, never chosen), and
  afterwards may only reset the password (always forces a change). Editing,
  moving, activating/deactivating and deleting any login, and creating any login
  on User Accounts, is the super admin's alone — enforced in the SQL functions,
  not just hidden — with ONE exception (fix174): an **admin** (not Senior Call
  Center) may create **call-centre and Senior Call Center** logins with no
  contact, through `admin_create_staff_login`. Call Center has no login controls
  at all. These PORTAL logins are not the contact's own customer-app
  username/password on the same profile.
- **Seats (fix174).** How many seats of each kind come free with the annual
  package, and the yearly price of each one beyond, are the super admin's
  settings (`seat_settings` via `super_admin_set_seat`; App Settings →
  Subscription settings) — read them through `lib/seatSettings`
  (`fetchSeatSettings`, `mergeSeats`), never billing.js's `SEATS` directly
  (that is only the fallback). **Senior Call Center draws a CALL-CENTRE seat**
  at the call-centre price (`SEAT_BY_ROLE`), not an administrator seat. A seat
  beyond the free ones is accepted in a prompt (admin creating staff; anyone
  adding a driver — drivers are counted from active driver contacts) and
  recorded as an unpaid row: on the login for office seats, on the driver
  contact for driver seats. The yearly software fee is the Software
  Subscriptions record itself, shown and priced in the same section.
- **Subscriptions & seats (fix163)** — a subscription belongs to a LOGIN, and the
  login's ROLE decides it: partner logins need a partner seat, supplier logins a
  supplier plan (a partner adding supplier pays; a free partner seat never covers
  it). A contact that is both holds separate partner and supplier logins.
  **Free partner seats are records**, not a ranking: `is_free_seat` rows, one
  year, held by the partner (all its partner logins free) whatever happens to
  its logins; max 10 in date; assigned by hand via `assign_free_partner_seat`
  (admin/super admin) once one frees. Changing a contact's type changes no login
  and bills nobody. A contact's **mobile is fixed once set** (trigger
  `trg_contacts_mobile_lock`; only `super_admin_set_contact_mobile` gets
  through; drivers exempt; applies in the customer app too).
- **Customer-app login (fix162)** — the contact's own username/password for the
  customer mobile app. Admin, Senior Call Center and super admin set it and reset
  its password (`contact_login_set`); once saved, only the super admin may
  change the username or remove the login (`contact_login_clear`).
  The old unchecked `admin_set/clear_contact_credentials` are revoked.
- **Subscription prices (fix169).** The super admin sets a minimum per kind
  (partner per year, supplier per month) in App Settings —
  `subscription_price_floors`, written only by `super_admin_set_subscription_floor`.
  Admins add and price subscriptions at or above it; the trigger
  `trg_subscriptions_price_floor` refuses less, except free seats, trials and a
  price the super admin saved (`priced_by`). Read and check prices through
  `lib/subscriptionPrices` — never `SEATS.partner.extraRate` or a plan constant.
  Prices are shown to admin and super admin only — and to the portal user,
  about their own subscription.
- **Partner subscriptions run from the login (fix172).** The admin sets their
  own partner price in App Settings (`sale_amount`, via
  `admin_set_subscription_price`, never under the minimum; read it with
  `salePrice()`). Every new partner PORTAL LOGIN opens a one-year subscription
  at that price, **switched on at once with the payment due** (the `credit`
  state: `is_active`, unpaid, `credit_granted_at`) — the partner signs in
  straight away. Admin and Senior Call Center accept the charge in a prompt on
  Create login (senior sees no price); saving a partner charges nothing. Two
  accounts per row: partner → office (`is_paid`, recorded by admin or super
  admin) and office → super admin (`vendor_amount` = the minimum in force when
  the subscription was OPENED, filled by the trigger and never recalculated
  after (fix173) — changing the rates touches only new subscriptions; the
  super admin may correct one row; `vendor_settled_at` written only by
  `super_admin_settle_subscriptions` — the trigger refuses any other write).
  Admin may switch a partner's subscription on/off; suppliers stay the super
  admin's. Monitor and report on **Subscription Accounts**
  (`/settings/subscription-accounts`, admin + super admin; `lib/subscriptionAccounts`
  is the one calculation for the page and its PDF). Partners only — suppliers
  are unchanged.
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
- **Anything that closes or reopens an order must call `syncOrderStock(orderId)`**
  (lib/productStock). Driver Settlements closed orders without it for three
  months, and 98 orders' goods never left the shelf. Whether a product's sale
  reduces stock is `salesReduceStock()` — never re-derive it from the flags.
  **Returnables are stock too**: −1 when the order closes, +1 when the line is
  marked returned (`order_items.is_returned`, Returnable Items page), both
  posted by `syncOrderStock`. The old `returnable_issuances` table is not used.
  **Refillables (fix166)** — gas, 20 L water — are held filled *or* empty: a
  return posts `returned_empty` (empties +1, not on hand), a `refill` moves
  empties to filled. **A returnable is an ASSET** (rule of 2 Oct): its On hand
  is what is OWNED — in − out ± adjust ± empty count — and a sale or a return
  never changes it; they move the item between Available (the shelf,
  `summarise().onHand`) and the customer. With customers = On hand − Available
  − Empty. Read all four through `stockFigures(product, bucket)` — never derive
  them on a page. Retail is consumed when sold: On hand = Available. Switching
  Refillable OFF re-posts the orders holding `returned_empty` rows (ProductsPage),
  or those returns vanish from the shelf. Each type's effect on both counts is in
  `MOVEMENT_TYPES` (`sign`, `empty`); read them through `summarise()` /
  `movementEffect()`, never a hand-written sign table.
- Prefer one shared calculation over two that agree today. Where two pages show
  the same figure, they should be reading the same function.
