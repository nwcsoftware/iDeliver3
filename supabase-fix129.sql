-- ============================================================================
-- fix129 — shop items carry NAMED options, each value in or out of stock
-- ----------------------------------------------------------------------------
-- fix106 gave every item exactly two variant lists: `colors` and `sizes`. Real
-- shops don't divide that way — a bakery sells flavours, a butcher sells
-- weights, a phone shop sells storage — and there was no way to say that size
-- 43 has run out while 44 and 45 are still on the shelf.
--
-- So one column replaces both, and the shop names the option itself:
--
--   options jsonb  [
--     { "label": "Size",   "style": "chip",                       -- chip | swatch
--       "values": [ { "name": "43", "image": null, "sold_out": true  },
--                   { "name": "44", "image": null, "sold_out": false } ] },
--     { "label": "Flavor", "style": "chip", "values": [ … ] }
--   ]
--
--   label     free text — Size, Color, Flavor, Weight, whatever the shop sells
--   style     'swatch' shows each value as a photo tile, 'chip' as a small pill
--   sold_out  this ONE value is finished; the rest of the option stays on sale
--
-- `colors` and `sizes` stay exactly where they are. The app writes both — the
-- new column and, mirrored from it, the old two — so anything still reading
-- them keeps working, and an item saved before this migration is not lost.
--
-- Existing colours/sizes are converted below into the equivalent options, so
-- nothing has to be re-entered. Safe to run multiple times: the backfill only
-- touches rows that have no options yet.
-- ============================================================================

ALTER TABLE public.shop_inventory
  ADD COLUMN IF NOT EXISTS options jsonb DEFAULT '[]'::jsonb;

UPDATE public.shop_inventory SET options = '[]'::jsonb WHERE options IS NULL;

-- ── Carry the old colours/sizes over ────────────────────────────────────────
DO $$
DECLARE
  r      RECORD;
  v_opts jsonb;
BEGIN
  FOR r IN
    SELECT id, colors, sizes
    FROM public.shop_inventory
    WHERE options IS NULL OR options = '[]'::jsonb
  LOOP
    v_opts := '[]'::jsonb;

    IF jsonb_typeof(r.colors) = 'array' AND jsonb_array_length(r.colors) > 0 THEN
      v_opts := v_opts || jsonb_build_array(jsonb_build_object(
        'label',  'Color',
        'style',  'swatch',
        'values', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'name',     c->>'name',
                            'image',    c->'image',
                            'sold_out', FALSE)), '[]'::jsonb)
                     FROM jsonb_array_elements(r.colors) AS c
                    WHERE COALESCE(c->>'name', '') <> '')));
    END IF;

    IF COALESCE(array_length(r.sizes, 1), 0) > 0 THEN
      v_opts := v_opts || jsonb_build_array(jsonb_build_object(
        'label',  'Size',
        'style',  'chip',
        'values', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'name',     s,
                            'image',    NULL,
                            'sold_out', FALSE)), '[]'::jsonb)
                     FROM unnest(r.sizes) AS s
                    WHERE COALESCE(s, '') <> '')));
    END IF;

    IF v_opts <> '[]'::jsonb THEN
      UPDATE public.shop_inventory SET options = v_opts WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- What the shops now offer.
SELECT count(*) FILTER (WHERE options <> '[]'::jsonb) AS items_with_options,
       count(*)                                        AS items
FROM public.shop_inventory;

NOTIFY pgrst, 'reload schema';
