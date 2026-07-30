-- =============================================================================
-- fix95 — ads.confirmed_ads (start confirmation)
-- -----------------------------------------------------------------------------
-- When an ad's start time arrives the app pops a reminder. If the user activates
-- it, confirmed_ads is set true and the ad's start date/time is locked in the
-- form so it can no longer be changed.
--
-- Safe to run multiple times.
-- =============================================================================

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS confirmed_ads boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
