-- ====================================================================================================
-- MIGRATION 427: COMPETEN SCHOLAR -- AN EDUCATIONAL EVALUATION THE STUDENT CHOSE TO SHOW IN THEIR PASSPORT
--
-- COMPETEN-SCHOLAR-PROGRESS-01 (Progress, Stage 8 of 8), P5 Passport and lifelong continuity, owner GO 2026-10-25:
-- development and staging authorised, production activation on hold. Build record:
-- docs/COMPETEN-SCHOLAR-PROGRESS-01.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: one new table. No function, no trigger. No existing
-- row is changed. It depends on profiles and 426 (individual_scholar_evaluation and its (id, user_id) index).
-- Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- The Competen Passport keeps three kinds of evidence apart. Personal learning activity is the study achievements
-- a student chooses (375). Independently verified clinical competence is what an organisation issued or verified.
-- Between them sits EDUCATIONAL EVALUATION -- a formative evaluation of the learning of the student (426) -- which
-- had no way into the Passport.
--
--   individual_scholar_passport_evaluation   one evaluation the student chose to show, with the label they gave
--                                            it. The row is the choice. No row, not shown: nothing is in the
--                                            Passport by default, and taking one off deletes only that choice.
--
-- DERIVED, NEVER COPIED. What the Passport shows is read from the evaluation record each time (its scope, method,
-- date, the band or state of each dimension, its confidence and how many limitations it lists), labelled as an
-- educational evaluation: formative, not an assessment of competence, not verified. It never becomes a credential:
-- nothing here, or anywhere, turns it into a verified competency.
--
-- PRIVACY. Own rows only (RLS, own-row read). Only the service role writes. Removing the evaluation, or erasing
-- everything, removes the choice with it (the cascade from 426 and from profiles).
-- ====================================================================================================

create table if not exists individual_scholar_passport_evaluation (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  evaluation_id  uuid not null,
  label          text not null,
  included_at    timestamptz not null default now(),
  constraint individual_scholar_passport_evaluation_eval_fk foreign key (evaluation_id, user_id)
    references individual_scholar_evaluation(id, user_id) on delete cascade
);

create unique index if not exists ux_individual_scholar_passport_evaluation_one
  on individual_scholar_passport_evaluation(user_id, evaluation_id);

alter table individual_scholar_passport_evaluation drop constraint if exists individual_scholar_passport_evaluation_check;
alter table individual_scholar_passport_evaluation add constraint individual_scholar_passport_evaluation_check
  check (char_length(btrim(label)) between 1 and 120 and label = btrim(label));

alter table individual_scholar_passport_evaluation enable row level security;
drop policy if exists individual_scholar_passport_evaluation_read_own on individual_scholar_passport_evaluation;
create policy individual_scholar_passport_evaluation_read_own on individual_scholar_passport_evaluation
  for select using (auth.uid() = user_id);

comment on table individual_scholar_passport_evaluation is
  'COMPETEN-SCHOLAR-PROGRESS-01 (427). An educational evaluation (426) the student chose to show in their Passport, with their label. The row is the choice. What is shown is derived from the evaluation each time, labelled formative and not verified. Never a credential. Private, own-row.';

notify pgrst, 'reload schema';
