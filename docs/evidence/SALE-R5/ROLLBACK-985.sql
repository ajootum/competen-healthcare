-- ROLLBACK-985. Drops the learning-effectiveness function 985 added. Never refuses: no table, column or row depends on it.
-- The HQ readout then reads "not measured" (it fails closed without the function).
drop function if exists public.ckri_scholar_effectiveness_stats(timestamptz, integer, integer);
notify pgrst, 'reload schema';
