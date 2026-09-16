-- =============================================================================
-- fix149 — a subscription can be switched on before it is paid, but only for
--          fifteen days
-- -----------------------------------------------------------------------------
-- Until now the Activate button was refused while a subscription was unpaid:
-- money first, access second, no exceptions. That is the right default and it
-- stays the default — but it does not survive contact with a Thursday
-- afternoon. A partner says the transfer has gone, the office believes them,
-- and the choice is between blocking a working shop over a payment that is
-- probably in flight, or marking the row PAID on trust and losing the fact that
-- it was never actually collected.
--
-- The second is what people do, and it is the dangerous one: once a row says
-- paid, nothing anywhere remembers that it is not.
--
-- So there is now a third option. A super admin may activate an unpaid
-- subscription on trust, and the software starts a clock:
--
--   · the party signs in immediately
--   · the row still says UNPAID, because it is
--   · fifteen days later, if the money has not arrived, access closes again
--
-- The clock is what makes it safe. An indulgence with no end date is just a
-- discount nobody approved; this one expires by itself, and while it runs the
-- Subscriptions page carries the count of days left so it cannot be forgotten.
--
-- One column holds it. grace_started_on is the day the row was switched on
-- while unpaid, and is cleared the moment it is paid or switched off again —
-- so a NULL means "no indulgence running", which is the normal state of every
-- row in the table.
--
-- The fifteen days live in src/lib/billing.js (UNPAID_GRACE_DAYS) so the gate,
-- the page and this comment cannot drift apart.
--
-- Run once in the Supabase SQL editor, AFTER fix146. Safe to re-run.
-- =============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS grace_started_on DATE;

COMMENT ON COLUMN public.subscriptions.grace_started_on IS
  'The day an UNPAID subscription was activated on trust by a super admin (fix149). Access is allowed for UNPAID_GRACE_DAYS from this date and then closes again. NULL = no grace running, which is the normal state: cleared when the row is paid or deactivated.';

-- Who granted the indulgence, so a decision to let somebody in without payment
-- has a name against it rather than appearing from nowhere.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS grace_granted_by TEXT;

COMMENT ON COLUMN public.subscriptions.grace_granted_by IS
  'Name of the super admin who activated this subscription while it was unpaid (fix149).';

CREATE INDEX IF NOT EXISTS idx_subscriptions_grace
  ON public.subscriptions (grace_started_on) WHERE grace_started_on IS NOT NULL;

-- -----------------------------------------------------------------------------
-- CHECK
-- -----------------------------------------------------------------------------
-- Nothing is backfilled: no row has ever been activated unpaid, because until
-- now the button refused. Every count below should be 0 on a first run, and the
-- middle two are the ones to watch afterwards.

SELECT
  (SELECT COUNT(*) FROM public.subscriptions WHERE grace_started_on IS NOT NULL) AS on_trust_total,
  (SELECT COUNT(*) FROM public.subscriptions
    WHERE grace_started_on IS NOT NULL AND NOT is_paid
      AND CURRENT_DATE <= grace_started_on + 15)                                 AS on_trust_running,
  (SELECT COUNT(*) FROM public.subscriptions
    WHERE grace_started_on IS NOT NULL AND NOT is_paid
      AND CURRENT_DATE >  grace_started_on + 15)                                 AS on_trust_lapsed,
  -- A row that is paid should carry no clock; if this is not 0 something set
  -- the flag without clearing the date.
  (SELECT COUNT(*) FROM public.subscriptions
    WHERE grace_started_on IS NOT NULL AND is_paid)                              AS paid_but_clock_left_running;
