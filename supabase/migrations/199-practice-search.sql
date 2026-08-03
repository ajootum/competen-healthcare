-- ============================================================
-- MIGRATION 199: SEARCH AND GLOBAL RETRIEVAL (CPR-350)
--
-- One box that finds anything in a practice: a patient, a consultation, a letter, a task, a commitment.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- GENERATED COLUMNS, NOT TRIGGERS. Migration 193 established this for patient identity: the normalised
-- name and contact columns are GENERATED, so a search index cannot drift from the text it indexes.
-- The same argument applies here and is stronger, because the text being indexed is a clinical note --
-- a search vector maintained by a trigger that somebody forgets to fire on one code path produces a
-- record that is silently unfindable, which is worse than one that cannot be searched at all.
--
-- `to_tsvector('english', ...)` with a literal configuration is IMMUTABLE, which is what makes a
-- generated column legal here.
--
-- THE ENGLISH ASSUMPTION IS REAL AND IS A LIMITATION. Stemming is why "diabetes" finds "diabetic", and
-- it is worth having. But this product is built for East African practice, and a note written in
-- Luganda or Swahili gets no stemming: those words still match exactly, they just do not match their
-- own variants. A multilingual configuration is a decision with a specification behind it, not a
-- string swap, so the limitation is named here rather than quietly accepted.
--
-- PATIENTS ARE DELIBERATELY ABSENT FROM THIS FILE. Migration 193 already gave practice_patient generated
-- normalised columns and a RANKED search with identity semantics -- identifier exact beats phone exact
-- beats name. Adding a second, fuzzier search over the same table would give two answers to "find this
-- person", and the one that matters for identity is the one 193 built. The search engine calls it.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- WHAT THIS MIGRATION DOES NOT DO: it does not decide who may see a result. Every table here is still
-- RLS deny-by-default and every read still goes through the engine with the caller's capabilities.
-- An index is not an access grant, and search is the single easiest place to accidentally make it one --
-- see src/lib/practice/search.ts, where the capability filter is applied BEFORE anything is counted.
--
-- Plain idempotent statements, ASCII only, no do-blocks. No plpgsql, so this file survives a splitter.
-- ============================================================

-- ---- 1. Clinical text --------------------------------------------------------------------------------

alter table practice_encounter add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(reason_for_visit, ''))) stored;
create index if not exists idx_practice_enc_search on practice_encounter using gin(search_vector);

-- THE BIG ONE. A SOAP segment is where "the patient with the mango allergy" actually lives, and until
-- now nothing could find it.
alter table practice_encounter_note add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;
create index if not exists idx_practice_note_search on practice_encounter_note using gin(search_vector);

alter table practice_diagnosis add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(label, '') || ' ' || coalesce(code, ''))) stored;
create index if not exists idx_practice_diag_search on practice_diagnosis using gin(search_vector);

alter table practice_problem add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(label, ''))) stored;
create index if not exists idx_practice_problem_search on practice_problem using gin(search_vector);

alter table practice_treatment add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(label, '') || ' ' || coalesce(notes, ''))) stored;
create index if not exists idx_practice_treat_search on practice_treatment using gin(search_vector);

alter table practice_procedure add column if not exists search_vector tsvector
  generated always as (to_tsvector('english',
    coalesce(label, '') || ' ' || coalesce(site, '') || ' ' || coalesce(indication, ''))) stored;
create index if not exists idx_practice_proc_search on practice_procedure using gin(search_vector);

-- ---- 2. Documents, commitments and work --------------------------------------------------------------

alter table practice_clinical_document add column if not exists search_vector tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(addressed_to, ''))) stored;
create index if not exists idx_practice_doc_search on practice_clinical_document using gin(search_vector);

alter table practice_follow_up add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(reason, '') || ' ' || coalesce(outcome, ''))) stored;
create index if not exists idx_practice_followup_search on practice_follow_up using gin(search_vector);

alter table practice_task add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(detail, ''))) stored;
create index if not exists idx_practice_task_search on practice_task using gin(search_vector);

-- ---- 3. Capability ------------------------------------------------------------------------------------
--
-- A SEPARATE CAPABILITY, not a free rider on the others. It would have been easy to say "search returns
-- whatever you could already see, so it needs no capability of its own" -- and that is true of the
-- RESULTS. It is not true of the ABILITY: a practice may reasonably want a role that can open a patient
-- record it is given a link to, and cannot go fishing across every note in the practice for a name.
--
-- Everyone who works clinically gets it. read_only_auditor and billing_reporting deliberately do not:
-- their access is to specific things they are pointed at, and free-text search across clinical notes is
-- a different power from reading a report.

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'search.use'),
  ('practice_assistant', 'search.use'),
  ('practice_owner', 'search.use')
on conflict (role_code, capability_code) do nothing;

insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

notify pgrst, 'reload schema';
