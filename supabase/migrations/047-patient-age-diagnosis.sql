-- Migration 047: operational patient age + working diagnosis
--
-- op_patients stays an OPERATIONAL object (not an EMR). These two OPTIONAL fields
-- carry the ward-board essentials the Patient Operations register shows: age
-- (especially for paediatric wards) and a brief WORKING diagnosis label — the
-- kind written on a physical ward whiteboard, not the full clinical record.
-- Both nullable; existing rows and pre-migration inserts are unaffected.

alter table op_patients add column if not exists age_years int
  check (age_years is null or (age_years >= 0 and age_years <= 130));
alter table op_patients add column if not exists diagnosis text;
