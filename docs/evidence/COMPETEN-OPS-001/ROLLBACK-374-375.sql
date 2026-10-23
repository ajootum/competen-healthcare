-- ROLLBACK for the Individual batch 374 -> 375 (production, 2026-10-23).
-- USE ONLY IF A STEP FAILS VERIFICATION. Undo 375 first, then 374. Both created objects that held no
-- rows in production before the batch. Recovery reference: the pre-batch backup recorded in
-- COMPETEN-OPS-001 section 11 addendum (isolated restore PASS).

-- ---- undo 375 ----
drop table if exists public.individual_scholar_passport_item;

-- ---- undo 374 ----
alter table public.individual_professional_profile drop column if exists reminder_email;
alter table public.individual_professional_profile drop column if exists reminder_in_app;

notify pgrst, 'reload schema';
