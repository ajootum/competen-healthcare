-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK-751, STAGING ONLY. It restores the 640 body of clinical_review_decision_sod_guard
-- (between dollar quotes, copied byte for byte from migration 640) and removes everything else 751 added: three
-- triggers, five functions, four checks and four columns. The outcome ids are derived data, so nothing original
-- is lost. Re-running it is a no-op.
-- ====================================================================================================

drop trigger if exists framework_competencies_outcome_ids on framework_competencies;
drop trigger if exists competency_verification_request_outcome_ids on competency_verification_request;
drop trigger if exists competency_verification_evidence_outcome_ids on competency_verification_evidence;
drop function if exists public.framework_competencies_outcome_ids();
drop function if exists public.competency_verification_request_outcome_ids();
drop function if exists public.competency_verification_evidence_outcome_ids();

alter table framework_competencies drop constraint if exists framework_competencies_learning_outcome_ids_check;
alter table competency_verification_request drop constraint if exists competency_verification_request_outcome_ids_check;
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_outcome_ids_check;
alter table framework_competencies drop column if exists learning_outcome_ids;
alter table competency_verification_request drop column if exists outcome_map;
alter table competency_verification_request drop column if exists outcome_ids;
alter table competency_verification_evidence drop column if exists outcome_ids;

drop function if exists public.competency_outcome_ids_of(integer[], jsonb);
drop function if exists public.competency_outcome_map(jsonb, jsonb);
drop function if exists public.competency_outcome_ids_match(jsonb, jsonb, jsonb);
drop function if exists public.competency_outcome_ids_valid(jsonb, jsonb);

-- The 640 body, restored.
create or replace function public.clinical_review_decision_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v clinical_content_version%rowtype;
  v_conflict boolean := false;
  v_parent uuid;
begin
  select * into v from clinical_content_version where id = new.version_id;
  if not found then
    return new;
  end if;
  -- Every version of the same subject, whatever was recorded on this one.
  v_conflict := exists (
    select 1 from clinical_content_version o
     where (new.reviewer_id = o.submitted_by or new.reviewer_id = any(o.authored_by))
       and ((v.content_kind = 'competency' and o.competency_id = v.competency_id)
         or (v.content_kind = 'case' and o.case_version_id in (select cv.id from case_library_version cv
               where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)))
         or (v.content_kind = 'resource' and o.knowledge_version_id in (select kv.id from ckri_knowledge_version kv
               where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)))
         or (v.content_kind = 'learning' and o.learning_version_id in (select lv.id from learning_offering_version lv
               where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)))));

  if not v_conflict and v.content_kind = 'competency' then
    -- The audit trail of the competency and its framework, as authorsOf reads it (src/lib/competency/clinical-review.ts).
    select d.framework_id into v_parent from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = v.competency_id;
    v_conflict := exists (
      select 1 from audit_log a
       where a.actor_id = new.reviewer_id and a.entity_id in (v.competency_id, v_parent)
         and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
           'catalogue_entry_add', 'catalogue_entry_status', 'catalogue_entry_remove', 'catalogue_entry_review',
           'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set'));
  elsif not v_conflict and v.content_kind = 'case' then
    v_conflict := exists (select 1 from case_library_version cv
      where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)
        and (new.reviewer_id = any(cv.authored_by) or new.reviewer_id is not distinct from cv.submitted_by));
  elsif not v_conflict and v.content_kind = 'resource' then
    v_conflict := exists (select 1 from ckri_knowledge_version kv
      where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)
        and (new.reviewer_id = any(kv.authored_by) or new.reviewer_id is not distinct from kv.submitted_by
          or new.reviewer_id is not distinct from kv.educator_reviewed_by));
  elsif not v_conflict and v.content_kind = 'learning' then
    v_conflict := exists (select 1 from learning_offering_version lv
      where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)
        and (new.reviewer_id = any(lv.authored_by) or new.reviewer_id is not distinct from lv.submitted_by));
  end if;

  if v_conflict then
    raise exception 'clinical_review_decision: not independent. The reviewer authored, edited or submitted this content or an earlier version of it';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
