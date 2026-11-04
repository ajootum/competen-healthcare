-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains functions between dollar quotes (two sql functions, one plpgsql trigger
-- function). A runner that splits on the statement separator would cut a function in half, so paste and run
-- the entire file at once.
-- ====================================================================================================
-- MIGRATION 998: CKRI LIBRARY QUESTIONS -- EXPLICIT CLINICAL APPROVAL OF SAFETY MARKERS AND THEIR SCORING SCOPE
--
-- Owner decision 1 of 4 Nov 2026 (CLINICAL-GOVERNANCE-ACTIVATION): the rules-v3 scoring caps (unsafe at most 50 percent,
-- safety-critical failure 0 percent, each at the rubric's own scope) apply ONLY to clinically reviewed and approved library
-- questions, and the independent reviewer must EXPLICITLY approve the safety-critical markers, the unsafe-response markers
-- and their scoring scope. AI-generated markers on personal practice questions stay formative only.
-- Build record: docs/evidence/SQIE-HQ/998-build-record.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO.
-- DEPENDS ON 395 (clinical_review_decision), 442 (clinical_content_version for a knowledge resource version,
-- ckri_knowledge_approved) and 997 (the marker fields it reads). Application order: 997, then 998. Independent of 995 and 996.
-- OPS-001 s8: proposed Low (one added column with a default, one added trigger, two added functions), with rollback SQL.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES. The existing review and decision path is kept. No new approval body, table or committee.
--
-- A. clinical_review_decision gains safety_markers_approved (boolean, not null, default false). It is recorded on the
--    reviewer's own decision row, which the 395/442 guards already bind to that exact version and content hash
--    (independence, authority, scope and staleness are checked there, unchanged). Every existing decision reads false.
-- B. ckri_question_has_safety_markers(content) says whether a revision question carries any safety marker: answerKey
--    safetyCritical true, a non-empty answerKey unsafe list, non-empty safetyCriticalPoints, or a structured part that is
--    safety-critical, lists unsafe answers or has a safety-critical criterion.
-- C. A second BEFORE INSERT trigger on clinical_review_decision refuses safety_markers_approved true unless the decision is
--    an approval of a knowledge resource version that is a revision question whose reviewed content carries markers.
-- D. ckri_library_caps_approved(version) is true only when the version is a PUBLISHED revision question, clinically approved
--    on its current content (ckri_knowledge_approved, 442), it carries markers, and at least the required number of approving
--    decisions on that exact content confirmed the markers and their scoring scope. Service role only.
--
-- FAIL CLOSED WITHOUT IT. Scholar applies a cap only when this function says true AND HQ policy scholar_clinical_scoring_caps
-- is on. Where the function is absent (998 not applied) the read fails and nothing is capped: every flag is still recorded and
-- shown as formative feedback.
--
-- RLS: unchanged (clinical_review_decision keeps RLS on with no policy, service role only).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.

-- ---- A. the confirmation, on the reviewer's own decision ------------------------------------------------------

alter table clinical_review_decision add column if not exists safety_markers_approved boolean not null default false;

comment on column clinical_review_decision.safety_markers_approved is
  'SQIE 998. The reviewer explicitly approved this version''s safety-critical and unsafe-response markers and their scoring scope. Only on an approval of a revision question that carries markers.';

-- ---- B. whether a revision question carries any safety marker ---------------------------------------------------

create or replace function public.ckri_question_has_safety_markers(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(
       (p -> 'answerKey' -> 'safetyCritical') = 'true'::jsonb
    or (jsonb_typeof(p -> 'answerKey' -> 'unsafe') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'unsafe') > 0)
    or (jsonb_typeof(p -> 'answerKey' -> 'safetyCriticalPoints') = 'array' and jsonb_array_length(p -> 'answerKey' -> 'safetyCriticalPoints') > 0)
    or exists (
         select 1
           from jsonb_array_elements(case when jsonb_typeof(p -> 'answerKey' -> 'parts') = 'array' then p -> 'answerKey' -> 'parts' else '[]'::jsonb end) part
          where (part -> 'safetyCritical') = 'true'::jsonb
             or (jsonb_typeof(part -> 'unsafe') = 'array' and jsonb_array_length(part -> 'unsafe') > 0)
             or exists (
                  select 1
                    from jsonb_array_elements(case when jsonb_typeof(part -> 'criteria') = 'array' then part -> 'criteria' else '[]'::jsonb end) c
                   where (c -> 'safetyCritical') = 'true'::jsonb)),
    false)
$$;

-- ---- C. the confirmation is valid only on an approval of a marked revision question ------------------------------

create or replace function public.clinical_review_decision_marker_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_kind text;
  v_resource_kind text;
  v_snapshot jsonb;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op <> 'INSERT' or not coalesce(new.safety_markers_approved, false) then
    return new;
  end if;
  if new.decision <> 'approved' then
    raise exception 'clinical_review_decision: safety markers are approved only with an approval of the version';
  end if;
  select ccv.content_kind, ccv.content_snapshot, r.kind into v_kind, v_snapshot, v_resource_kind
    from clinical_content_version ccv
    left join ckri_knowledge_version kv on kv.id = ccv.knowledge_version_id
    left join ckri_knowledge_resource r on r.id = kv.resource_id
   where ccv.id = new.version_id;
  if v_kind is distinct from 'resource' or v_resource_kind is distinct from 'revision_question' then
    raise exception 'clinical_review_decision: safety markers are approved only on a library revision question';
  end if;
  if not ckri_question_has_safety_markers(v_snapshot) then
    raise exception 'clinical_review_decision: this version carries no safety marker to approve';
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_review_decision_marker_guard on clinical_review_decision;
create trigger clinical_review_decision_marker_guard
  before insert on clinical_review_decision
  for each row execute function public.clinical_review_decision_marker_guard();

-- ---- D. whether scoring caps may apply to a library version -------------------------------------------------------

create or replace function public.ckri_library_caps_approved(p_version uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from ckri_knowledge_version kv
      join ckri_knowledge_resource r on r.id = kv.resource_id
      join clinical_content_version ccv on ccv.content_kind = 'resource' and ccv.knowledge_version_id = kv.id and ccv.content_hash = kv.content_hash
     where kv.id = p_version
       and kv.state = 'published'
       and r.kind = 'revision_question'
       and ckri_knowledge_approved(kv.id)
       and ckri_question_has_safety_markers(kv.content)
       and not exists (select 1 from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'rejected')
       and (select count(*) from clinical_review_decision d
             where d.version_id = ccv.id and d.decision = 'approved' and d.safety_markers_approved) >= ccv.required_approvals
  )
$$;

revoke all on function public.ckri_library_caps_approved(uuid) from public;
revoke all on function public.ckri_question_has_safety_markers(jsonb) from public;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ckri_library_caps_approved(uuid) from anon';
    execute 'revoke all on function public.ckri_question_has_safety_markers(jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ckri_library_caps_approved(uuid) from authenticated';
    execute 'revoke all on function public.ckri_question_has_safety_markers(jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ckri_library_caps_approved(uuid) to service_role';
    execute 'grant execute on function public.ckri_question_has_safety_markers(jsonb) to service_role';
  end if;
end
$grants$;

comment on function public.ckri_library_caps_approved(uuid) is
  'SQIE 998. True only for a published, clinically approved revision question that carries safety markers which the required number of approving reviewers explicitly confirmed, with their scoring scope, on its current content. Scholar caps nothing otherwise. Service role only.';

notify pgrst, 'reload schema';
