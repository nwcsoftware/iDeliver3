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

We paused after agreeing on the clean architecture:

```text
Develop Electron/React customer UI.
Use live Supabase directly.
Do not create a local database.
Do not create a separate backend now.
Keep staff workflow unchanged.
Customer-created orders should appear in the existing staff delivery workflow.
```

Next development step:

```text
Build the Customer App Shell at #/customer
```

The first visible screen should include:

```text
customer greeting
search bar
Shop Products action
Book Delivery action
My Orders shortcut
Profile shortcut
bottom navigation
```

After the screen is reviewed, commit the step on the customer app branch and continue one step at a time.

