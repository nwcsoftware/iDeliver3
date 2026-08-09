-- ============================================================================
-- fix119 — quotation PDF on a change request
-- ----------------------------------------------------------------------------
-- When the super admin prices a request he can attach the signed quotation as a
-- PDF. The requesting admin then sees the price AND can download the document
-- from the request itself, so the paper trail lives with the request.
--
-- The file is kept inline as a data URL (same approach as the app's images):
-- these are small documents, and it keeps them inside the row's own permissions
-- with no storage bucket to configure. The page refuses anything over 3 MB.
--
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.change_requests
  ADD COLUMN IF NOT EXISTS quotation_pdf         TEXT,        -- data:application/pdf;base64,…
  ADD COLUMN IF NOT EXISTS quotation_filename    TEXT,
  ADD COLUMN IF NOT EXISTS quotation_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quotation_uploaded_by TEXT;

NOTIFY pgrst, 'reload schema';
