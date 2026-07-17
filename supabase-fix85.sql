-- =============================================================================
-- fix85 — Align every product code with its kind
--          Retail → PRD · Service → SRV · Returnable → RTN · Advertisement → ADD
-- -----------------------------------------------------------------------------
-- Codes were issued before kinds existed, so returnable items still carry PRD-
-- codes (PRD-0004 Gaz, PRD-0005 Arguile, PRD-0006 Ras Arguile). This renames
-- them to match the kind set by fix84.
--
-- WHY THIS IS SAFE: nothing in the database stores a product CODE. Every link is
-- by products.id (UUID) — order_items, inventory, inventory_transactions,
-- purchase_invoice_items, pos_transaction_items all use product_id, and the app
-- reads the code live through the join (product:products(id,name,code)). So a
-- rename cannot orphan a row, and every screen shows the new code immediately.
-- Order history keeps working; it simply displays the new code.
--
-- Step 1 removes the leftover 'ZZ probe' rows (created while testing the code
-- generator, never referenced by anything) — this frees RTN-0001 / SRV-0001 so
-- the renumber below can use them. The delete is guarded: a probe row that
-- somehow IS referenced is left alone rather than breaking a foreign key.
--
-- Only codes whose prefix is WRONG are touched. Retail items already on PRD-
-- keep their existing numbers, so the codes staff already recognise don't move.
-- This leaves gaps in the PRD sequence (0004–0006) — harmless: new codes are
-- issued from MAX+1, never by filling holes.
--
-- Safe to run multiple times: a second run finds nothing mismatched.
-- =============================================================================

-- ── Before ───────────────────────────────────────────────────────────────────
SELECT code, name, is_retail, is_returnable, is_service, is_advertisement, is_active
FROM products ORDER BY code;

-- ── 1. Drop the unreferenced probe rows ──────────────────────────────────────
DELETE FROM products
WHERE name LIKE 'ZZ probe%'
  AND NOT EXISTS (SELECT 1 FROM order_items            x WHERE x.product_id = products.id)
  AND NOT EXISTS (SELECT 1 FROM inventory              x WHERE x.product_id = products.id)
  AND NOT EXISTS (SELECT 1 FROM inventory_transactions x WHERE x.product_id = products.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_invoice_items x WHERE x.product_id = products.id)
  AND NOT EXISTS (SELECT 1 FROM pos_transaction_items  x WHERE x.product_id = products.id);

-- ── 2. Recode anything whose prefix doesn't match its kind ───────────────────
WITH kinded AS (
  SELECT id, code,
         CASE WHEN COALESCE(is_service,       FALSE) THEN 'SRV'
              WHEN COALESCE(is_advertisement, FALSE) THEN 'ADD'
              WHEN COALESCE(is_returnable,    FALSE) THEN 'RTN'
              ELSE 'PRD' END AS want
    FROM products
),
-- Highest number already in use for each target prefix, so we never reuse one.
maxes AS (
  SELECT w.want,
         COALESCE(MAX(CASE WHEN p.code LIKE w.want || '-%'
                           THEN CAST(substring(p.code from '(\d+)$') AS INTEGER) END), 0) AS max_seq
    FROM (SELECT DISTINCT want FROM kinded) w
    CROSS JOIN products p
   GROUP BY w.want
),
-- The rows to rename, numbered per prefix in a stable order.
todo AS (
  SELECT k.id, k.want,
         ROW_NUMBER() OVER (PARTITION BY k.want ORDER BY k.code) AS rn
    FROM kinded k
   WHERE k.code NOT LIKE k.want || '-%'
)
UPDATE products p
   SET code       = t.want || '-' || LPAD((m.max_seq + t.rn)::text, 4, '0'),
       updated_at = NOW()
  FROM todo t
  JOIN maxes m ON m.want = t.want
 WHERE p.id = t.id;

-- ── After: every code must match its kind (expect 0 rows back) ───────────────
SELECT code, name, is_retail, is_returnable, is_service, is_advertisement
FROM products
WHERE code NOT LIKE (CASE WHEN COALESCE(is_service,       FALSE) THEN 'SRV'
                          WHEN COALESCE(is_advertisement, FALSE) THEN 'ADD'
                          WHEN COALESCE(is_returnable,    FALSE) THEN 'RTN'
                          ELSE 'PRD' END) || '-%';

-- ── Final state ──────────────────────────────────────────────────────────────
SELECT code, name, is_retail, is_returnable, is_service, is_advertisement
FROM products ORDER BY code;
