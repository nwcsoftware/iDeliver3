-- ============================================================================
-- fix130 — options that depend on each other, and extras that add to the price
-- ----------------------------------------------------------------------------
-- fix129 let a shop name its options and mark a single value sold out. Two
-- things real shops still couldn't say:
--
--   1. "Black comes in 41-45, White only in 44 and 45, and 43 in black is
--      finished." Availability is per COMBINATION, not per value.
--   2. "Add cheese +1.00, add bacon +1.50." Extras are chosen alongside the
--      size, as many as the customer likes, and they change the price.
--
-- The second needs no new column — an option group carries `kind` and its
-- values carry `price_delta`, both inside the existing `options` jsonb:
--
--   { "label": "Extras", "kind": "extra", "style": "chip",
--     "values": [ { "name": "Cheese", "price_delta": 1 }, … ] }
--
--   kind  'choice' (default) — pick exactly one, required
--         'extra'            — pick any number, optional, adds to the price
--
-- The first gets one:
--
--   combos jsonb  [ { "picks": {"Color":"Black","Size":"43"}, "state": "sold_out" },
--                   { "picks": {"Color":"White","Size":"41"}, "state": "not_sold" } ]
--
--   sold_out  offered, but finished for now — shown struck through
--   not_sold  this shop never sells that combination — not shown at all
--
-- It is a list of EXCEPTIONS: anything not named is on sale. A shop with five
-- colours and ten sizes therefore ticks the handful it doesn't sell, instead of
-- confirming fifty combinations it does.
--
-- Safe to run multiple times. Items with no combos behave exactly as they do
-- now: every combination of their option values is available.
-- ============================================================================

ALTER TABLE public.shop_inventory
  ADD COLUMN IF NOT EXISTS combos jsonb DEFAULT '[]'::jsonb;

UPDATE public.shop_inventory SET combos = '[]'::jsonb WHERE combos IS NULL;

-- Existing option groups are all plain choices; naming it makes the reader's
-- job easier and lets the app tell a choice from an extra without guessing.
UPDATE public.shop_inventory AS si
SET options = (
      SELECT jsonb_agg(
               CASE WHEN g ? 'kind' THEN g ELSE g || jsonb_build_object('kind', 'choice') END
               ORDER BY ord)
      FROM jsonb_array_elements(si.options) WITH ORDINALITY AS t(g, ord)
    )
WHERE jsonb_typeof(options) = 'array'
  AND jsonb_array_length(options) > 0
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(si.options) AS g WHERE NOT (g ? 'kind'));

-- What the shops now offer.
SELECT count(*) FILTER (WHERE options <> '[]'::jsonb) AS items_with_options,
       count(*) FILTER (WHERE combos  <> '[]'::jsonb) AS items_with_combos,
       count(*)                                        AS items
FROM public.shop_inventory;

NOTIFY pgrst, 'reload schema';
