-- ============================================================================
-- fix131 — the 3asari3 catalog gets the same options as the partner shops
-- ----------------------------------------------------------------------------
-- fix129/fix130 gave shop_inventory named options, per-value sold-out flags,
-- extras with prices, and per-combination availability. The office's own
-- catalog (`products`, fix116) still had only the fixed `colors` and `sizes`
-- from before — so a 3asari3 item couldn't offer a flavour, couldn't charge for
-- an add-on, and couldn't say that 43 has run out in black only.
--
-- Both sell through the same customer app, to the same customer, so they carry
-- the same two columns and the app reads them through one set of helpers:
--
--   options jsonb  [ { "label": "Size", "kind": "choice", "style": "chip",
--                      "values": [ { "name": "43", "sold_out": true }, … ] },
--                    { "label": "Extras", "kind": "extra",
--                      "values": [ { "name": "Cheese", "price_delta": 1 } ] } ]
--
--   combos  jsonb  [ { "picks": {"Color":"Black","Size":"43"}, "state": "sold_out" } ]
--
-- `colors` and `sizes` stay where they are and the app keeps writing them,
-- mirrored from the options, so anything still reading them keeps working.
--
-- Existing catalog colours/sizes are converted below — nothing to re-enter.
-- Safe to run multiple times: the backfill only touches rows with no options.
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS options jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS combos  jsonb DEFAULT '[]'::jsonb;

UPDATE public.products SET options = '[]'::jsonb WHERE options IS NULL;
UPDATE public.products SET combos  = '[]'::jsonb WHERE combos  IS NULL;

-- ── Carry the old colours/sizes over ────────────────────────────────────────
DO $$
DECLARE
  r      RECORD;
  v_opts jsonb;
BEGIN
  FOR r IN
    SELECT id, colors, sizes
    FROM public.products
    WHERE options IS NULL OR options = '[]'::jsonb
  LOOP
    v_opts := '[]'::jsonb;

    IF jsonb_typeof(r.colors) = 'array' AND jsonb_array_length(r.colors) > 0 THEN
      v_opts := v_opts || jsonb_build_array(jsonb_build_object(
        'label',  'Color',
        'kind',   'choice',
        'style',  'swatch',
        'values', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'name',        c->>'name',
                            'image',       c->'image',
                            'sold_out',    FALSE,
                            'price_delta', 0)), '[]'::jsonb)
                     FROM jsonb_array_elements(r.colors) AS c
                    WHERE COALESCE(c->>'name', '') <> '')));
    END IF;

    IF COALESCE(array_length(r.sizes, 1), 0) > 0 THEN
      v_opts := v_opts || jsonb_build_array(jsonb_build_object(
        'label',  'Size',
        'kind',   'choice',
        'style',  'chip',
        'values', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'name',        s,
                            'image',       NULL,
                            'sold_out',    FALSE,
                            'price_delta', 0)), '[]'::jsonb)
                     FROM unnest(r.sizes) AS s
                    WHERE COALESCE(s, '') <> '')));
    END IF;

    IF v_opts <> '[]'::jsonb THEN
      UPDATE public.products SET options = v_opts WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- What the catalog now offers.
SELECT count(*) FILTER (WHERE options <> '[]'::jsonb) AS products_with_options,
       count(*) FILTER (WHERE combos  <> '[]'::jsonb) AS products_with_combos,
       count(*)                                        AS products
FROM public.products;

NOTIFY pgrst, 'reload schema';
