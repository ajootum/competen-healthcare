-- ====================================================================================================
-- ROLLBACK FOR MIGRATION 389 (COMPETEN-SCHOLAR-01). Restores the three-layer checks of 387 and 388.
--
-- !! CHECK THE PROJECT BEFORE RUNNING. On STAGING (ref ezhvpgtcqcdsgylrxgdb).
-- !! IT FAILS, AND CHANGES NOTHING, IF ANY ROW ALREADY USES advanced OR context. Count first:
--    select layer, count(*) from individual_scholar_competency_map group by 1
--    and the same for individual_scholar_programme_framework. Those rows must be removed by their owner
--    first. This file deletes nothing.
-- ASCII only. No semicolons inside comments.
-- ====================================================================================================

alter table individual_scholar_programme_framework drop constraint if exists individual_scholar_programme_framework_layer_check;
alter table individual_scholar_programme_framework add constraint individual_scholar_programme_framework_layer_check
  check (layer in ('foundational', 'profession', 'specialty'));

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_layer_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_layer_check
  check (layer in ('foundational', 'profession', 'specialty'));

notify pgrst, 'reload schema';
