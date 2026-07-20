-- RUN ME: Migration 047 - operational patient age + working diagnosis (idempotent)
-- Adds two OPTIONAL fields to op_patients so the Patient Operations register can
-- show age (esp. paediatric) and a brief WORKING diagnosis label. op_patients
-- stays operational (not an EMR); both fields are nullable, so existing rows and
-- pre-migration inserts are unaffected. Paste all into the Supabase SQL editor, Run.

alter table op_patients add column if not exists age_years int
  check (age_years is null or (age_years >= 0 and age_years <= 130));
alter table op_patients add column if not exists diagnosis text;
