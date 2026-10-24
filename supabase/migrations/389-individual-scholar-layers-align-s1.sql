-- ====================================================================================================
-- MIGRATION 389: COMPETEN SCHOLAR -- ALIGN THE SCHOLAR LAYER CHECKS WITH THE FIVE S1 LAYERS (384)
--
-- COMPETEN-SCHOLAR-01. Migration 384 (S1, the shared competency foundation) classifies a catalogue into
-- FIVE layers: foundational, profession, advanced, specialty, context. Migrations 387 and 388 were written
-- before 384 was readable and allow three. A mapping stores the layer of the competency it points at, so
-- a competency in an advanced or context catalogue could not be stored at all. This widens the two checks
-- to exactly the 384 list. Nothing else changes.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: two CHECK constraints are replaced by wider
-- ones. Every row valid before is valid after. It depends on 387 and 388. It does not depend on 384 --
-- it only repeats its list of values. Re-running it is a no-op.
-- Rollback: docs/evidence/COMPETEN-SCHOLAR-01/ROLLBACK-389.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

alter table individual_scholar_programme_framework drop constraint if exists individual_scholar_programme_framework_layer_check;
alter table individual_scholar_programme_framework add constraint individual_scholar_programme_framework_layer_check
  check (layer in ('foundational', 'profession', 'advanced', 'specialty', 'context'));

alter table individual_scholar_competency_map drop constraint if exists individual_scholar_competency_map_layer_check;
alter table individual_scholar_competency_map add constraint individual_scholar_competency_map_layer_check
  check (layer in ('foundational', 'profession', 'advanced', 'specialty', 'context'));

notify pgrst, 'reload schema';
