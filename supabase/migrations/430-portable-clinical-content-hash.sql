-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 430: A PORTABLE CLINICAL CONTENT HASH, AND A REVIEWED-COPY ROUTE WITH PROVENANCE
--
-- Owner decision (25 October 2026), CF-FOUND: "Use a reviewed-copy route from staging to production. Preserve approved
-- content versions, identifiers, hashes and review provenance. Do not reauthor the eight competencies." Option (b),
-- approved by the coordinator. Coordinator range 430-434. Fixes forward from 395 and 422, which are frozen.
--
-- APPLY ON STAGING FIRST. 395 hashed environment-specific record ids into the content hash of a competency, so identical
-- content hashed differently in staging and production and an approval could never be carried across. This replaces
-- that one function, and adds two columns and two functions. Re-running it is a no-op. OPS-001 s8: proposed Medium (it
-- changes what approval is judged against), with a rollback rehearsal.
--
-- PRE-CONDITION, CHECKED BY THE COORDINATOR (read-only, 25 October 2026): production has 0 clinical_content_version and
-- 0 clinical_review_decision rows, so no production approval goes stale. On staging the eight CF-FOUND versions (0
-- decisions) become stale and are put forward again later, which the owner accepted.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
--   competency_content_hash   REPLACED. The same content, but the three record ids that differ between environments
--                             are hashed by what they ARE, not by their row id:
--                               expected level   its scale and score (the default scale is seeded with a fixed id in
--                                                every environment, and a level is unique by scale and score)
--                               practice, CPU    their code (their id only where a code is missing, which then
--                                                stays environment-specific and says so in the hash)
--                             The 395 and 422 guards call this function by name, so every version and decision now
--                             uses the portable hash. Nothing else about review changes.
--   clinical_content_version.provenance, clinical_review_decision.provenance
--                             Null for a version or decision made here. For one recorded from another environment:
--                             where it came from (environment, original ids, hash, original time, recorded by).
--   clinical_version_import   Records a version reviewed elsewhere, under its ORIGINAL id and authorship, and only
--                             if this environment computes the SAME hash for the competency now.
--   clinical_review_import    Records a decision made elsewhere, under the same reviewer appointment HERE.
--                             The 395 decision guard still judges it: independence, an active appointment holding
--                             approve, a scope covering the competency, and the content still current. Only the
--                             original time and ids are carried, in provenance.
--
-- Execute on the two import functions: the service role only. They are run by the owner, by hand.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CLINICAL/ROLLBACK-430.sql restores the hash function of 395 byte for byte and
--   drops the columns and functions. It refuses once any provenance is recorded.
-- ====================================================================================================


create or replace function public.competency_content_hash(p_competency uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select md5(jsonb_build_object(
    'name', c.name,
    'description', c.description,
    'learning_outcomes', c.learning_outcomes,
    'expected_level', (select jsonb_build_object('scale', l.scale_id, 'score', l.score) from scoring_levels l where l.id = c.expected_level_id),
    'practice', (select coalesce(p.code, 'id:' || p.id::text) from practices p where p.id = c.practice_id),
    'cpu', (select coalesce(u.code, 'id:' || u.id::text) from clinical_practice_units u where u.id = c.cpu_id),
    'risk_category', c.risk_category,
    'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb)
  )::text)
  from framework_competencies c
  where c.id = p_competency
$$;

alter table clinical_content_version add column if not exists provenance jsonb;
alter table clinical_review_decision add column if not exists provenance jsonb;
alter table clinical_content_version drop constraint if exists clinical_content_version_provenance_check;
alter table clinical_content_version add constraint clinical_content_version_provenance_check
  check (provenance is null or (jsonb_typeof(provenance) = 'object' and provenance ->> 'environment' in ('staging')
     and char_length(coalesce(provenance ->> 'original_version_id', '')) = 36 and char_length(coalesce(provenance ->> 'original_hash', '')) = 32
     and char_length(coalesce(provenance ->> 'original_created_at', '')) between 10 and 40 and char_length(coalesce(provenance ->> 'recorded_by', '')) between 2 and 200));
alter table clinical_review_decision drop constraint if exists clinical_review_decision_provenance_check;
alter table clinical_review_decision add constraint clinical_review_decision_provenance_check
  check (provenance is null or (jsonb_typeof(provenance) = 'object' and provenance ->> 'environment' in ('staging')
     and char_length(coalesce(provenance ->> 'original_decision_id', '')) = 36 and char_length(coalesce(provenance ->> 'original_version_id', '')) = 36
     and char_length(coalesce(provenance ->> 'original_hash', '')) = 32 and char_length(coalesce(provenance ->> 'original_decided_at', '')) between 10 and 40
     and char_length(coalesce(provenance ->> 'reviewer_name', '')) between 2 and 200 and char_length(coalesce(provenance ->> 'recorded_by', '')) between 2 and 200));

-- A competency version reviewed in another environment, recorded here under its original id and authorship. The 395
-- version guard computes the hash and the snapshot from the content in THIS environment, and the import stands only if
-- that hash is the one the version was reviewed at.
create or replace function public.clinical_version_import(p_version_id uuid, p_competency uuid, p_authored_by uuid[], p_submitted_by uuid,
  p_required int, p_risk_basis text, p_provenance jsonb)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_hash text;
begin
  if p_provenance is null or p_provenance ->> 'original_version_id' is distinct from p_version_id::text then
    raise exception 'clinical_version_import: the provenance must name the original version id';
  end if;
  v_hash := competency_content_hash(p_competency);
  if v_hash is null then raise exception 'clinical_version_import: unknown competency'; end if;
  if v_hash is distinct from p_provenance ->> 'original_hash' then
    raise exception 'clinical_version_import: the content here does not hash to the reviewed version (here %, reviewed %)', v_hash, p_provenance ->> 'original_hash';
  end if;
  insert into clinical_content_version (id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis, provenance)
    values (p_version_id, p_competency, 'computed-by-trigger', '{}'::jsonb, p_authored_by, p_submitted_by, p_required, p_risk_basis, p_provenance);
  return p_version_id;
end;
$$;

-- A decision made in another environment, recorded here under the same reviewer appointment HERE. The 395
-- decision guard judges it exactly as a decision made here.
create or replace function public.clinical_review_import(p_version uuid, p_reviewer uuid, p_appointment uuid, p_decision text, p_comment text, p_provenance jsonb)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_hash text;
  v_id uuid;
begin
  select content_hash into v_hash from clinical_content_version where id = p_version;
  if not found then raise exception 'clinical_review_import: unknown version'; end if;
  if p_provenance is null or p_provenance ->> 'original_version_id' is distinct from p_version::text or p_provenance ->> 'original_hash' is distinct from v_hash then
    raise exception 'clinical_review_import: the provenance must name this version and its hash';
  end if;
  insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision, comment, provenance)
    values (p_version, p_reviewer, p_appointment, p_decision, p_comment, p_provenance)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.clinical_version_import(uuid, uuid, uuid[], uuid, int, text, jsonb) from public, anon, authenticated;
revoke all on function public.clinical_review_import(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.clinical_version_import(uuid, uuid, uuid[], uuid, int, text, jsonb) to service_role;
grant execute on function public.clinical_review_import(uuid, uuid, uuid, text, text, jsonb) to service_role;


-- Verification: the provenance columns, and a hash that no longer names the level row id.
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and table_name in ('clinical_content_version', 'clinical_review_decision') and column_name = 'provenance' order by 1;

select position('expected_level_id' in pg_get_functiondef('public.competency_content_hash(uuid)'::regprocedure)) = 0 as portable;

notify pgrst, 'reload schema';
