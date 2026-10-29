-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK OF MIGRATION 690 (STAGING REHEARSAL ONLY). It restores the two review guards
-- exactly as 461 left them and competency_verification_state exactly as 510 left it, and drops every 690 table,
-- column, trigger, function, capability and position. It refuses once a 690 record exists.
-- ====================================================================================================

do $r$
begin
  if exists (select 1 from clinical_content_version where content_kind = 'method') then raise exception 'ROLLBACK-690 refused: method review versions exist'; end if;
  if exists (select 1 from competency_verification_confirmation) then raise exception 'ROLLBACK-690 refused: confirmations exist'; end if;
  if exists (select 1 from competency_verification_request where requested_by is not null and requested_by <> user_id) then raise exception 'ROLLBACK-690 refused: requests by programme leads exist'; end if;
  if exists (select 1 from ogs_office_appointments where role = 'competency_programme_lead' and status = 'active') then raise exception 'ROLLBACK-690 refused: somebody is appointed Competency Programme Lead'; end if;
end
$r$;

drop trigger if exists competency_verification_method_version_review_690 on competency_verification_method_version;
drop trigger if exists competency_verification_request_guard_690 on competency_verification_request;
drop trigger if exists competency_verification_decision_guard_690 on competency_verification_decision;
drop trigger if exists competency_verification_decision_clears_drafts on competency_verification_decision;
drop trigger if exists clinical_review_decision_method_sod_690 on clinical_review_decision;
drop table if exists competency_verification_confirmation;
drop table if exists competency_verification_decision_draft;
drop function if exists public.competency_verification_method_version_review_690();
drop function if exists public.competency_verification_request_guard_690();
drop function if exists public.competency_verification_decision_guard_690();
drop function if exists public.competency_verification_decision_clears_drafts();
drop function if exists public.competency_verification_confirmation_guard();
drop function if exists public.competency_verification_decision_draft_guard();
drop function if exists public.clinical_review_decision_method_sod_690();
drop function if exists public.competency_method_submit_review(uuid, uuid);
drop function if exists public.competency_method_clinically_approved(uuid, text);

create or replace function public.clinical_content_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_hospital uuid;
  v_case_hash text;
  v_case_content jsonb;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'clinical_content_version is append-only: put forward a new version instead';
  end if;
  -- A learning version (461): the database's hash and content of the exact learning version, submitted on the clinical route.
  if new.content_kind = 'learning' then
    select lv.content_hash, lv.content into v_case_hash, v_case_content from learning_offering_version lv
     where lv.id = new.learning_version_id and lv.state = 'submitted' and lv.review_route = 'clinical';
    if not found then
      raise exception 'clinical_content_version: learning is put forward for review only as a submitted version on the clinical route';
    end if;
    new.competency_id := null;
    new.content_hash := v_case_hash;
    new.content_snapshot := v_case_content;
    new.created_at := now();
    return new;
  end if;
  -- A knowledge resource version (442): the database's hash and content of the exact resource version, which must be submitted.
  if new.content_kind = 'resource' then
    select kv.content_hash, kv.content into v_case_hash, v_case_content from ckri_knowledge_version kv where kv.id = new.knowledge_version_id and kv.state = 'submitted';
    if not found then
      raise exception 'clinical_content_version: a knowledge resource is put forward for review only as a submitted resource version';
    end if;
    new.competency_id := null;
    new.content_hash := v_case_hash;
    new.content_snapshot := v_case_content;
    new.created_at := now();
    return new;
  end if;
  -- A case version (422): the database's hash and content of the exact case version, which must be submitted.
  if new.content_kind = 'case' then
    select cv.content_hash, cv.content into v_case_hash, v_case_content from case_library_version cv where cv.id = new.case_version_id and cv.state = 'submitted';
    if not found then
      raise exception 'clinical_content_version: a case is put forward for review only as a submitted case version';
    end if;
    new.competency_id := null;
    new.content_hash := v_case_hash;
    new.content_snapshot := v_case_content;
    new.created_at := now();
    return new;
  end if;
  select f.hospital_id into v_hospital
    from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
   where c.id = new.competency_id;
  if not found then
    raise exception 'clinical_content_version: unknown competency';
  end if;
  if v_hospital is not null then
    raise exception 'clinical_content_version: only competencies of shared frameworks are clinically reviewed here';
  end if;
  new.content_hash := competency_content_hash(new.competency_id);
  new.content_snapshot := (
    select jsonb_build_object('name', c.name, 'description', c.description, 'learning_outcomes', c.learning_outcomes,
      'expected_level_id', c.expected_level_id, 'practice_id', c.practice_id, 'cpu_id', c.cpu_id, 'risk_category', c.risk_category,
      'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb))
      from framework_competencies c where c.id = new.competency_id);
  new.created_at := now();
  return new;
end;
$$;

create or replace function public.clinical_review_decision_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_version clinical_content_version%rowtype;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'clinical_review_decision is append-only: record a new decision on a new version instead';
  end if;
  select * into v_version from clinical_content_version where id = new.version_id;
  if not found then
    raise exception 'clinical_review_decision: unknown version';
  end if;
  if new.reviewer_id = v_version.submitted_by or new.reviewer_id = any(v_version.authored_by) then
    raise exception 'clinical_review_decision: not independent. The author, an editor or the submitter of a version cannot review it';
  end if;
  if not exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.id = new.appointment_id
       and a.person_id = new.reviewer_id
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = 'hq.quality.clinical.approve'
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
  ) then
    raise exception 'clinical_review_decision: not authorised. The appointment must be the reviewer''s own, active, and hold hq.quality.clinical.approve';
  end if;
  if v_version.content_kind = 'learning' then
    -- Learning (461) is in scope only when an active scope of the appointment covers EVERY competency the version serves.
    if not exists (select 1 from learning_offering_version_outcome l where l.version_id = v_version.learning_version_id) then
      raise exception 'clinical_review_decision: out of scope. The learning names no CFCA competency, so no scope can cover it';
    end if;
    if exists (select 1 from learning_offering_version_outcome l where l.version_id = v_version.learning_version_id and not clinical_scope_covers(new.appointment_id, l.competency_id)) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers every competency the learning serves';
    end if;
    if (select lv.content_hash from learning_offering_version lv where lv.id = v_version.learning_version_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  elsif v_version.content_kind = 'resource' then
    -- A knowledge resource (442) is in scope only when an active scope of the appointment covers EVERY competency it teaches.
    if not exists (select 1 from ckri_knowledge_version_competency l where l.version_id = v_version.knowledge_version_id) then
      raise exception 'clinical_review_decision: out of scope. The resource names no CFCA competency, so no scope can cover it';
    end if;
    if exists (select 1 from ckri_knowledge_version_competency l where l.version_id = v_version.knowledge_version_id and not clinical_scope_covers(new.appointment_id, l.competency_id)) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers every competency the resource teaches';
    end if;
    if (select kv.content_hash from ckri_knowledge_version kv where kv.id = v_version.knowledge_version_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  elsif v_version.content_kind = 'case' then
    -- A case is in scope only when an active scope of the appointment covers EVERY CFCA competency it teaches.
    if not exists (select 1 from case_library_version_competency l where l.version_id = v_version.case_version_id) then
      raise exception 'clinical_review_decision: out of scope. The case names no CFCA competency, so no scope can cover it';
    end if;
    if exists (select 1 from case_library_version_competency l where l.version_id = v_version.case_version_id and not clinical_scope_covers(new.appointment_id, l.competency_id)) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers every competency the case teaches';
    end if;
    if (select cv.content_hash from case_library_version cv where cv.id = v_version.case_version_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  else
    if not clinical_scope_covers(new.appointment_id, v_version.competency_id) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers the competency';
    end if;
    if competency_content_hash(v_version.competency_id) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  end if;
  new.created_at := now();
  return new;
end;
$$;

create or replace function public.competency_verification_state(p_request uuid)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_last_decision record;
  v_assigned boolean;
begin
  if exists (select 1 from competency_verification_event where request_id = p_request and event = 'withdrawn') then
    return 'withdrawn';
  end if;
  select outcome_class, created_at into v_last_decision from competency_verification_decision
   where request_id = p_request order by created_at desc, id desc limit 1;
  if found and v_last_decision.outcome_class <> 'further_evidence' then
    return 'decided';
  end if;
  if found and not exists (select 1 from competency_verification_evidence where request_id = p_request and created_at > v_last_decision.created_at) then
    return 'awaiting_evidence';
  end if;
  select (event = 'assigned') into v_assigned from competency_verification_event
   where request_id = p_request and event in ('assigned', 'assignment_declined') order by created_at desc, id desc limit 1;
  return case when coalesce(v_assigned, false) then 'assigned' else 'open' end;
end
$$;

drop index if exists ux_clinical_content_version_method_hash;
alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and competency_id is not null and case_version_id is null and knowledge_version_id is null and learning_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null and knowledge_version_id is null and learning_version_id is null)
      or (content_kind = 'resource' and knowledge_version_id is not null and competency_id is null and case_version_id is null and learning_version_id is null)
      or (content_kind = 'learning' and learning_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null));
alter table clinical_content_version drop column if exists method_version_id;
drop function if exists public.competency_method_review_covers(uuid, jsonb);
drop function if exists public.competency_method_criteria_problem(jsonb);

alter table competency_verification_decision drop column if exists confirmation_required;
alter table competency_verification_decision drop column if exists stage_code;
alter table competency_verification_decision drop column if exists stage_label;
alter table competency_verification_decision drop column if exists stage_mapping_id;
alter table competency_verification_decision drop column if exists stage_mapping_version;
alter table competency_verification_request drop column if exists requested_by;

delete from hq_position_capability where capability_code = 'hq.competency.verification.request';
delete from hq_position_capability where position_code = 'competency_programme_lead';
delete from hq_position where code = 'competency_programme_lead';
delete from hq_capability where code = 'hq.competency.verification.request';

notify pgrst, 'reload schema';
