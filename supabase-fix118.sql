-- ═══════════════════════════════════════════════════════════════════════════
-- fix118 — Software subscriptions
--
-- The subscriptions the company itself pays for (this application, hosting,
-- a mapping key, an SMS gateway…). Each one carries a due/expiry date and is
-- either a one-time purchase or renews on a cycle. Payments are recorded
-- against the subscription, so dues are the difference between what a period
-- costs and what has been confirmed as paid.
--
--   • super admin  — creates, edits and deletes subscriptions and payments
--   • admin        — reads the list, statuses, payments and totals
--   • admin + call center — get the "your subscription is due" reminder from
--     10 days before expiry, unless a confirmed payment already covers past it
--
-- Run in the Supabase SQL editor, then sign out/in of the app.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists software_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid,
  software_name text        not null,
  vendor        text,
  description   text,
  -- one_time | monthly | quarterly | semiannual | annual
  billing_cycle text        not null default 'one_time',
  start_date    date,
  expiry_date   date        not null,
  amount        numeric(12,2) not null default 0,
  currency      text        not null default 'USD',
  is_active     boolean     not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

-- Money paid against a subscription. `covers_until` is what makes a payment a
-- RENEWAL: a confirmed payment reaching past the current expiry date silences
-- the reminder and is what the super admin uses to roll the expiry forward.
create table if not exists software_subscription_payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references software_subscriptions(id) on delete cascade,
  amount          numeric(12,2) not null default 0,
  currency        text not null default 'USD',
  paid_on         date not null default current_date,
  covers_until    date,
  method          text,
  reference       text,
  is_confirmed    boolean not null default false,
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

create index if not exists software_subscriptions_expiry_idx
  on software_subscriptions (expiry_date);
create index if not exists software_subscription_payments_sub_idx
  on software_subscription_payments (subscription_id);

-- Columns added after the first run of this file (safe to re-run).
alter table software_subscriptions            add column if not exists vendor      text;
alter table software_subscriptions            add column if not exists notes       text;
alter table software_subscriptions            add column if not exists updated_by  uuid;
alter table software_subscription_payments    add column if not exists covers_until date;
alter table software_subscription_payments    add column if not exists reference    text;

-- RLS: tables created from the SQL editor come with RLS on and no policy, which
-- makes every anon read come back empty. The app authenticates in its own layer,
-- so mirror what the other tables do here.
alter table software_subscriptions         enable row level security;
alter table software_subscription_payments enable row level security;

drop policy if exists dev_anon on software_subscriptions;
create policy dev_anon on software_subscriptions
  for all to anon, authenticated using (true) with check (true);

drop policy if exists dev_anon on software_subscription_payments;
create policy dev_anon on software_subscription_payments
  for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
