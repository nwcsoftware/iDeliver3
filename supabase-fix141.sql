-- =============================================================================
-- fix141 — "Contact us": the ways a customer can reach the company
-- -----------------------------------------------------------------------------
-- The front page (fix140) could publish a phone number and an email as a short
-- strip of label/value pairs, and nothing else. A visitor who wanted to ask a
-- question had no way to do it from where they were standing — which for most
-- people now means a message on one of half a dozen apps, not a phone call.
--
-- Two columns on the existing landing_settings row:
--
--   socials      — the accounts, one entry per platform:
--                    [{ "platform": "whatsapp",  "handle": "96170123456" },
--                     { "platform": "instagram", "handle": "3asari3" }]
--                  The HANDLE is stored, not the address: the client builds
--                  the link (lib/landingPage.js SOCIAL_PLATFORMS), so a change
--                  of domain — twitter.com to x.com, say — is one line in the
--                  app rather than a row edit on every install. A full URL
--                  pasted into the box is honoured as-is, for the accounts
--                  whose address does not follow the usual shape.
--                  An entry with a blank handle is simply not shown.
--
--   contact_note — the line of words under the "Contact us" heading. Optional;
--                  the page has its own sentence when this is empty.
--
-- The existing `contacts` column is unchanged and still holds the direct lines
-- (phone, email, address) as label/value pairs. It is now drawn INSIDE the new
-- section rather than as a strip of its own, so there is one place on the page
-- that answers "how do I reach you".
--
-- READ BY THE PUBLIC, like the rest of fix140: this is deliberately the company
-- address book it wants strangers to have. Nothing private belongs here — and
-- note that a WhatsApp handle is a real phone number, published to anyone.
--
-- Safe to run multiple times. Requires supabase-fix140.sql.
-- =============================================================================

ALTER TABLE public.landing_settings
  ADD COLUMN IF NOT EXISTS socials      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_note TEXT;

-- A row written before this column existed has NULL rather than an empty list.
-- The client copes, but every reader would then have to; normalise it once.
UPDATE public.landing_settings SET socials = '[]'::jsonb WHERE socials IS NULL;

-- No accounts are seeded. A handle nobody has typed is a guess, and a guessed
-- handle on a public page is a dead link with the company's name on it — the
-- admin fills these in under Administration → Front Page, and the section only
-- shows the platforms that have one.

NOTIFY pgrst, 'reload schema';
