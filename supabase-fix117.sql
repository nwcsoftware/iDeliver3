-- ============================================================================
-- fix117 — register the "Customer Mobile Application" order type
-- ----------------------------------------------------------------------------
-- Orders placed from the customer app now carry
-- order_type = 'Customer Mobile Application'. Adding it to the order_types
-- lookup makes it selectable in the office order form as well (the Deliveries
-- filter already picks up any type present on existing orders).
--
-- Safe to run multiple times.
-- ============================================================================

INSERT INTO public.order_types (name, is_active)
SELECT 'Customer Mobile Application', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.order_types
  WHERE lower(name) = lower('Customer Mobile Application')
);

NOTIFY pgrst, 'reload schema';
