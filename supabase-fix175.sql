-- ============================================================================
-- fix175 — a seat charge for each driver already beyond the free driver seats
-- ----------------------------------------------------------------------------
-- fix174 charges a driver seat when a driver is ADDED beyond the free ones.
-- Drivers added before that carried no charge, so the drivers already beyond
-- the free seats owed nothing on record (18 active against 15 free on
-- 2 Oct 2026: DRV-000018, DRV-000019, DRV-000020). Decided: they are charged,
-- and counted in what is owed to the super admin.
--
-- WHO. Active drivers in the order they were added; the earliest hold the
-- free seats (seat_settings.driver.included), and every driver after them gets
-- a charge — the same rule office seats follow.
--
-- WHAT. One year from today, at the driver seat price (seat_settings
-- extra_rate), unpaid; on the driver's contact, worded as a new driver's would
-- be ("Driver seat 16 — beyond the 15 included"). The driver's work is not
-- affected — a seat charge is the office's bill to the super admin.
--
-- Safe to re-run: a driver who already has a current driver seat charge is
-- skipped.
-- ============================================================================

INSERT INTO public.subscriptions (company_id, contact_id, description, start_date, end_date,
                                  amount, currency, is_paid, is_active, paid_by_note)
SELECT d.company_id, d.id,
       'Driver seat ' || d.seat || ' — beyond the ' || st.included || ' included',
       CURRENT_DATE, CURRENT_DATE + 364,
       st.extra_rate, st.currency, FALSE, FALSE,
       'Driver already beyond the free seats when driver charges began (fix175)'
  FROM (SELECT c.id, c.company_id,
               ROW_NUMBER() OVER (ORDER BY c.created_at, c.id) AS seat
          FROM public.contacts c
         WHERE c.contact_type::TEXT = 'driver' AND c.is_active IS NOT FALSE) d
  JOIN public.seat_settings st ON st.family = 'driver'
 WHERE d.seat > st.included
   AND NOT EXISTS (SELECT 1 FROM public.subscriptions s
                    WHERE s.contact_id = d.id
                      AND s.description ILIKE 'Driver seat %'
                      AND s.end_date >= CURRENT_DATE);

-- ── check ───────────────────────────────────────────────────────────────────
-- Expect: three charges — DRV-000018 seat 16, DRV-000019 seat 17, DRV-000020
-- seat 18 — 15 USD each, unpaid; 45 USD due in all.
SELECT c.code AS driver, TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS name,
       s.description, s.amount::TEXT || ' ' || s.currency AS amount,
       s.start_date::TEXT || ' to ' || s.end_date::TEXT AS period,
       CASE WHEN s.is_paid THEN 'paid' ELSE 'unpaid' END AS status
  FROM public.subscriptions s JOIN public.contacts c ON c.id = s.contact_id
 WHERE s.description ILIKE 'Driver seat %'
UNION ALL
SELECT 'TOTAL', COUNT(*)::TEXT || ' driver seat charges', '', SUM(amount)::TEXT || ' USD', '',
       SUM(CASE WHEN is_paid THEN 0 ELSE amount END)::TEXT || ' due'
  FROM public.subscriptions WHERE description ILIKE 'Driver seat %';
