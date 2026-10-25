-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 442 (STAGING ONLY): CKRI K3 educator knowledge improvement.
--
-- Restores the two 422 review guards BYTE FOR BYTE (copied from migration 422 by scripts, never retyped) and the
-- two-kind subject CHECK, then drops the resource column, the four CKRI K3 tables, their functions, the grants, the
-- position and the two capabilities. It REFUSES while any clinical_content_version of kind resource exists, because
-- those rows carry clinical review decisions. Run ROLLBACK-443 first if 443 was applied.
-- ====================================================================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'clinical_content_version' and column_name = 'knowledge_version_id')
     and exists (select 1 from clinical_content_version where content_kind = 'resource') then
    raise exception 'ROLLBACK-442 refused: clinical_content_version holds resource versions with review records';
  end if;
end;
$$;

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
  if v_version.content_kind = 'case' then
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


alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and competency_id is not null and case_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null));
drop index if exists ux_clinical_content_version_resource_hash;
alter table clinical_content_version drop column if exists knowledge_version_id;

drop table if exists ckri_knowledge_version_competency cascade;
alter table if exists ckri_knowledge_resource drop constraint if exists ckri_knowledge_resource_need_fk;
drop table if exists ckri_learning_need cascade;
drop table if exists ckri_knowledge_version cascade;
drop table if exists ckri_knowledge_resource cascade;

drop function if exists public.ckri_knowledge_retire(uuid);
drop function if exists public.ckri_knowledge_publish(uuid, uuid);
drop function if exists public.ckri_knowledge_approved(uuid);
drop function if exists public.ckri_knowledge_submit(uuid, uuid, int);
drop function if exists public.ckri_knowledge_review(uuid, uuid);
drop function if exists public.ckri_learning_need_guard();
drop function if exists public.ckri_knowledge_version_competency_guard();
drop function if exists public.ckri_knowledge_version_guard();
drop function if exists public.ckri_knowledge_resource_guard();
drop function if exists public.ckri_knowledge_content_ok(text, jsonb);

delete from hq_position_capability where capability_code in ('hq.learning.ckri.educator', 'hq.quality.knowledge.publish');
delete from hq_position_capability where position_code = 'knowledge_educator';
delete from hq_position where code = 'knowledge_educator' and not exists (select 1 from ogs_office_appointments a where a.role = hq_position.code);
delete from hq_capability where code in ('hq.learning.ckri.educator', 'hq.quality.knowledge.publish');

notify pgrst, 'reload schema';
