-- ====================================================================================================
-- !! APPLY THIS FILE WHOLE. It defines a plpgsql trigger function. A runner that splits on semicolons
-- !! would cut the function body apart. Paste the whole file, or use scripts/apply-migrations.ts.
--
-- MIGRATION 426: COMPETEN SCHOLAR -- THE EVALUATION RECORD (STAGE 6, INTELLIGENT LEARNING EVALUATION)
--
-- COMPETEN-SCHOLAR-EVALUATION-01 (Stage 6), E5 evaluation history, owner GO 2026-10-25: development and staging
-- authorised, production activation on hold. Build record: docs/COMPETEN-SCHOLAR-EVALUATION-01.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. MEDIUM: one new table and one trigger function. No
-- existing table or row is changed. It depends on profiles and 417 (individual_scholar_revision_session and its
-- (id, user_id) key). Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- An evaluation interprets the evidence a student already has (Teach Me checks, revision answers, spaced review,
-- clinical reasoning, coverage), and optionally a fresh knowledge check, across a scope the student chose. The
-- evidence itself stays where it is: nothing is copied or rewritten. What did not exist is the RECORD of an
-- evaluation -- what was evaluated, how, against which rules, what it found, how confident it can be, and
-- what it could not say -- kept so the student (and Stage 7 Progress) can look back at it.
--
--   individual_scholar_evaluation   one evaluation, as it was made. Its results and interpretation are a
--                                   snapshot (results, cfca, limitations, confidence), with REFERENCES to the
--                                   evidence it read (evidence_refs: ids and counts, never the evidence copied),
--                                   the configuration it applied (config_version, criteria), and any AI used
--                                   (ai_provenance). A fresh knowledge check is a revision session (417) the
--                                   evaluation names in fresh_session_id.
--
-- AS IT WAS MADE. An evaluation is never rewritten. A trigger refuses UPDATE. A later evaluation of the same
-- scope, or a correction, is a NEW row, and supersedes_id names the one it follows, so the earlier record is
-- preserved. DELETE is allowed: the student may remove an evaluation, and erase-all removes every one -- a
-- privacy right, not an edit.
--
-- NOT COMPETENCE. An evaluation is formative, educational self-evaluation. verified is never set by this table:
-- the column does not exist. Verified clinical competence stays in its own, independently governed records.
--
-- PRIVACY. Own rows only (RLS, own-row read). Only the service role writes. It holds no uploaded text, no
-- student answer text and no AI explanation: results are figures, states and labels, the evidence is named by
-- id, and the scope names what the student chose (a topic as typed, material ids and titles). It goes with the
-- person (profiles cascade).
-- ====================================================================================================

create table if not exists individual_scholar_evaluation (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  kind              text not null,
  method            text not null,
  scope             jsonb not null,
  context           jsonb,
  fresh_session_id  uuid,
  config_version    text not null,
  criteria          jsonb not null,
  results           jsonb not null,
  confidence        text not null,
  limitations       jsonb not null default '[]'::jsonb,
  evidence_refs     jsonb not null,
  cfca              jsonb,
  ai_provenance     jsonb not null default '{}'::jsonb,
  supersedes_id     uuid,
  created_at        timestamptz not null default now(),
  constraint individual_scholar_evaluation_fresh_fk foreign key (fresh_session_id, user_id)
    references individual_scholar_revision_session(id, user_id) on delete set null (fresh_session_id)
);

create unique index if not exists ux_individual_scholar_evaluation_id_user
  on individual_scholar_evaluation(id, user_id);

alter table individual_scholar_evaluation drop constraint if exists individual_scholar_evaluation_supersedes_fk;
alter table individual_scholar_evaluation add constraint individual_scholar_evaluation_supersedes_fk
  foreign key (supersedes_id, user_id) references individual_scholar_evaluation(id, user_id) on delete set null (supersedes_id);

alter table individual_scholar_evaluation drop constraint if exists individual_scholar_evaluation_check;
alter table individual_scholar_evaluation add constraint individual_scholar_evaluation_check
  check (kind in ('continuous', 'student')
     and method in ('existing', 'fresh', 'combined')
     and (kind = 'student' or method = 'existing')
     and confidence in ('strong', 'moderate', 'limited', 'insufficient')
     and jsonb_typeof(scope) = 'object' and jsonb_typeof(criteria) = 'object' and jsonb_typeof(results) = 'object'
     and jsonb_typeof(limitations) = 'array' and jsonb_typeof(evidence_refs) = 'object' and jsonb_typeof(ai_provenance) = 'object'
     and (context is null or jsonb_typeof(context) = 'object') and (cfca is null or jsonb_typeof(cfca) = 'object')
     and char_length(config_version) between 1 and 200
     and octet_length(results::text) <= 200000 and octet_length(evidence_refs::text) <= 200000
     and (supersedes_id is null or supersedes_id <> id));

create index if not exists idx_individual_scholar_evaluation_user
  on individual_scholar_evaluation(user_id, created_at desc);

create or replace function public.individual_scholar_evaluation_as_made()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  raise exception 'individual_scholar_evaluation is kept as it was made: a later evaluation or a correction is a new record';
end;
$$;

drop trigger if exists individual_scholar_evaluation_as_made on individual_scholar_evaluation;
create trigger individual_scholar_evaluation_as_made
  before update on individual_scholar_evaluation
  for each row execute function public.individual_scholar_evaluation_as_made();

alter table individual_scholar_evaluation enable row level security;
drop policy if exists individual_scholar_evaluation_read_own on individual_scholar_evaluation;
create policy individual_scholar_evaluation_read_own on individual_scholar_evaluation
  for select using (auth.uid() = user_id);

comment on table individual_scholar_evaluation is
  'COMPETEN-SCHOLAR-EVALUATION-01 (426). One formative learning evaluation as it was made: scope, method, the rules applied (config_version, criteria), results and interpretation as a snapshot, confidence and limitations, references to the evidence read (never copies), and any AI used. Never rewritten (a correction is a new row that supersedes it). Never verified competence. Private, own-row.';

notify pgrst, 'reload schema';
