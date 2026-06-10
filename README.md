# iDeliver III

iDeliver III is an Electron desktop application with a React/Vite renderer and a live Supabase database.

## Current Development Focus

The current workstream is the customer-level application. It will be built inside the existing Electron/React app and will use the existing Supabase project directly.

Architecture decision:

```text
Electron App
-> React Customer UI
-> Supabase JS Client
-> Supabase Database / RPC / RLS
```

No separate backend is planned for the current customer app phase. Supabase is the backend for database access, RPC functions, and security policies.

## Customer App Data Model

Customer information is stored in:

```text
contacts
```

Customer rows are identified by:

```text
contacts.contact_type = 'customer'
```

Saved customer addresses are stored in:

```text
contact_addresses
```

Customer orders use:

```text
delivery_orders
order_items
```

Customer product browsing uses:

```text
products
product_categories
```

Credit/COD behavior should use:

```text
contacts.credit_debit_allowed
```

Delivery fee remains staff-controlled in the existing internal app.

## Customer App Screens To Build

Planned customer route:

```text
#/customer
```

Planned screens:

```text
Customer Home
Customer Login
Customer Registration / OTP
Shop Products
Book Delivery
My Orders
Profile
Saved Addresses
```

## Design Direction

The earlier mobile design image is a visual reference only. Use its general UI/UX feel, not its grocery content or structure.

Design cues to adapt:

```text
mobile-first layout
rounded search field
customer action shortcuts
compact cards
offer/status panels
bottom navigation
soft customer-friendly colors
```

Do not copy the image as a template.

## Resume Here

Current pause point:

```text
We are working in the customer mobile login screen / new user registration flow.
```

Recent customer mobile changes:

```text
Login screen logo restored from customer-app-step1.
Login uses contacts username/password path, not user_accounts.
New user registration collects username and password for contacts.
Google login button added to both login and new-user registration screens.
New-user registration layout was tightened for smaller mobile screens.
My Orders now displays and filters by delivery_status instead of order status.
Customer mobile language switching was added for English, Arabic, French, and Romanian.
```

Current changed files to keep in scope:

```text
src/customer-mobile/CustomerMobileApp.jsx
src/assets/ideliver-logo-login.png
supabase-fix27.sql
```

Important database/auth setup still pending:

```text
Run supabase-fix27.sql in the Supabase SQL Editor before deploying the latest auth changes.
It adds contacts.username and contacts.password and creates the customer_contact_* RPC functions.
Without this SQL, login/register will fail because the frontend calls RPCs that do not exist yet.
```

Google login setup in Supabase:

```text
Updated in Supabase.
Supabase Authentication > Providers > Google is enabled.
Google OAuth Client ID and Client Secret have been added.
Google Cloud redirect URI:
https://zwcrmkgixdarkwppsgzl.supabase.co/auth/v1/callback
```

Allowed redirect URLs to add in Supabase:

```text
http://127.0.0.1:5176/#/customer/login
https://mobile-chi-six.vercel.app/#/customer/login
```

Local customer mobile URL used during this work:

```text
http://127.0.0.1:5176/#/customer/login
```

Build status:

```text
npm run build passed after the login/register changes.
Supabase Google provider setup was updated after that build; run npm run build again after the next code change.
```

Earlier architecture agreement:

```text
Develop Electron/React customer UI.
Use live Supabase directly.
Do not create a local database.
Do not create a separate backend now.
Keep staff workflow unchanged.
Customer-created orders should appear in the existing staff delivery workflow.
```
