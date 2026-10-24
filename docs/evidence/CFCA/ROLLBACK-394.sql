-- ROLLBACK 394 (STAGING ONLY). Drops the controlled-catalogue entry table, its guard trigger and function.
-- Catalogue entries made on staging are lost. No other table is touched. Run it whole.
drop trigger if exists competency_catalogue_entry_guard on competency_catalogue_entry;
drop function if exists public.competency_catalogue_entry_guard();
drop table if exists competency_catalogue_entry;
notify pgrst, 'reload schema';
