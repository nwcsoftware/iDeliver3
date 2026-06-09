-- ============================================================================
-- Seed a default "GENERAL CUSTOMER" walk-in contact (one per company)
-- ----------------------------------------------------------------------------
-- New orders default their customer to the contact named "GENERAL CUSTOMER"
-- (first_name GENERAL + last_name CUSTOMER). Run this once if you don't already
-- have such a contact. It is idempotent — it skips any company that already has
-- a customer whose name (or company name) is "general customer".
--
-- Adjust mobile / fields afterwards from the Contacts page as you like.
-- ============================================================================

INSERT INTO contacts (
  company_id, contact_type, first_name, last_name, mobile,
  account_number, is_active, credit_debit_allowed, notes
)
SELECT
  c.id, 'customer', 'GENERAL', 'CUSTOMER',
  -- Unique numeric placeholder mobile (9990000001, 9990000002, …).
  (9990000000 + row_number() OVER (ORDER BY c.created_at))::text,
  public.generate_unique_contact_account_number('42'),
  TRUE, FALSE, 'Default walk-in customer for new orders'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM contacts x
  WHERE x.company_id = c.id
    AND x.contact_type = 'customer'
    AND lower(trim(coalesce(
          nullif(x.company_name, ''),
          trim(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, ''))
        ))) = 'general customer'
);
