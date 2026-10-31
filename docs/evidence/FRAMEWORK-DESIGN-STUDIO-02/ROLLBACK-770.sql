-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK-770 (STAGING ONLY). It restores four function bodies verbatim and drops what 770
-- added. It refuses (nothing changed) while any revision or any revision version exists, because those records would
-- be lost.
-- Restored verbatim: clinical_content_version_guard from 761, clinical_content_version_sod_floor from 640,
-- clinical_review_decision_guard from 690, clinical_review_decision_sod_guard from 760, and the 690
-- clinical_content_version_subject_check.
-- ====================================================================================================

do $pre$
begin
  if to_regclass('public.framework_revision') is not null and exists (select 1 from framework_revision) then
    raise exception 'ROLLBACK-770: revisions exist. Nothing was changed';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_content_version' and column_name = 'revision_id')
     and exists (select 1 from clinical_content_version where revision_id is not null or proposed_competency_id is not null) then
    raise exception 'ROLLBACK-770: revision versions exist. Nothing was changed';
  end if;
end
$pre$;

drop trigger if exists frameworks_revision_apply_on_publish on frameworks;
drop trigger if exists frameworks_revision_release_on_publish on frameworks;

-- 761 body
create or replace function public.clinical_content_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_hospital uuid;
  v_case_hash text;
  v_case_content jsonb;
  v_method competency_verification_method_version%rowtype;
  v_problem text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'clinical_content_version is append-only: put forward a new version instead';
  end if;
  -- A method version (690): the database hash and content of the exact DRAFT, complete and pinned to its criteria.
  if new.content_kind = 'method' then
    select * into v_method from competency_verification_method_version where id = new.method_version_id;
    if not found or v_method.state <> 'draft' then
      raise exception 'clinical_content_version: an assessment method is put forward for review only as a draft version';
    end if;
    v_problem := coalesce(public.competency_method_content_problem(v_method.content), public.competency_method_criteria_problem(v_method.content));
    if v_problem is not null then
      raise exception 'clinical_content_version: the method is not ready for clinical review: %', v_problem;
    end if;
    if jsonb_array_length(coalesce(v_method.content #> '{applicability,frameworkIds}', '[]'::jsonb))
       + jsonb_array_length(coalesce(v_method.content #> '{applicability,competencyIds}', '[]'::jsonb)) = 0 then
      raise exception 'clinical_content_version: name the frameworks or competencies the method applies to, so a reviewer scope can cover it';
    end if;
    new.competency_id := null;
    new.content_hash := md5(v_method.content::text);
    new.content_snapshot := jsonb_build_object('method', (select jsonb_build_object('code', m.code, 'name', m.name, 'kind', m.kind)
                              from competency_verification_method m where m.id = v_method.method_id),
                              'version_no', v_method.version_no, 'content', v_method.content);
    new.authored_by := array(select distinct x from unnest(array[v_method.authored_by] || v_method.edited_by || array[new.submitted_by]) as t(x) where x is not null);
    new.created_at := now();
    return new;
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
      'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id and s.is_active is not false), '[]'::jsonb))
      from framework_competencies c where c.id = new.competency_id);
  new.created_at := now();
  return new;
end;
$$;

-- 640 body
create or replace function public.clinical_content_version_sod_floor()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_risk text;
  v_floor int;
begin
  if new.content_kind = 'competency' then
    select case when c.risk_category = 'high' or u.risk_category = 'high' then 'high' else 'standard' end into v_risk
      from framework_competencies c left join clinical_practice_units u on u.id = c.cpu_id where c.id = new.competency_id;
  elsif new.content_kind = 'case' then
    select cv.risk into v_risk from case_library_version cv where cv.id = new.case_version_id;
  elsif new.content_kind = 'resource' then
    select kv.risk into v_risk from ckri_knowledge_version kv where kv.id = new.knowledge_version_id;
  elsif new.content_kind = 'learning' then
    select lv.risk into v_risk from learning_offering_version lv where lv.id = new.learning_version_id;
  end if;
  v_floor := hq_sod_required_approvals(coalesce(v_risk, 'standard'));
  if new.required_approvals is null or new.required_approvals < v_floor then
    new.required_approvals := v_floor;
  end if;
  return new;
end;
$$;

-- 690 body
create or replace function public.clinical_review_decision_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_version clinical_content_version%rowtype;
  v_method competency_verification_method_version%rowtype;
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
  if v_version.content_kind = 'method' then
    -- An assessment method (690) is in scope only when an active scope covers EVERY framework and competency it names,
    -- and is decided only while its draft still has the content put forward.
    select * into v_method from competency_verification_method_version where id = v_version.method_version_id;
    if not public.competency_method_review_covers(new.appointment_id, v_method.content) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers every framework and competency the method applies to';
    end if;
    if v_method.state <> 'draft' or md5(v_method.content::text) is distinct from v_version.content_hash then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  elsif v_version.content_kind = 'learning' then
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

-- 760 body
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
           'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set',
           'reorder_layout', 'create_area', 'rename_area', 'delete_area', 'reorder_areas', 'set_domain_area', 'move_competency_domain'));
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

alter table clinical_content_version drop constraint if exists clinical_content_version_revision_check;
drop index if exists ux_clinical_content_version_proposed_hash;
drop index if exists idx_clinical_content_version_revision;
alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version drop column if exists proposed_competency_id;
alter table clinical_content_version drop column if exists revision_id;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and competency_id is not null and case_version_id is null and knowledge_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null and knowledge_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'resource' and knowledge_version_id is not null and competency_id is null and case_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'learning' and learning_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null and method_version_id is null)
      or (content_kind = 'method' and method_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null and learning_version_id is null));

drop table if exists framework_revision_criterion;
drop table if exists framework_revision_competency;
drop table if exists framework_revision;

drop function if exists public.frameworks_revision_apply_on_publish();
drop function if exists public.frameworks_revision_release_on_publish();
drop function if exists public.framework_revision_problem(uuid);
drop function if exists public.framework_revision_add_competency(uuid, uuid, uuid);
drop function if exists public.framework_revision_open(uuid, uuid);
drop function if exists public.framework_revision_criterion_guard();
drop function if exists public.framework_revision_competency_guard();
drop function if exists public.framework_revision_settled();
drop function if exists public.framework_revision_guard();
drop function if exists public.clinical_scope_covers_domain(uuid, uuid);
drop function if exists public.competency_review_current(uuid, text);
drop function if exists public.framework_revision_open_hashes(uuid[]);
drop function if exists public.framework_revision_hashes(uuid);
drop function if exists public.framework_revision_competency_snapshot(uuid, uuid);
drop function if exists public.framework_revision_competency_hash(uuid, uuid);

notify pgrst, 'reload schema';
