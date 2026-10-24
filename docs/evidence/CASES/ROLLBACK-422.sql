-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It recreates plpgsql functions between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 422 (STAGING ONLY). Returns clinical-content approval to exactly what 395 left: its two guards (copied byte
-- for byte from 395-clinical-content-approval.sql), competency_id required, no content_kind or case_version_id, and no
-- case library, functions, capabilities or educator position. It refuses once a case, a case review version or an
-- educator appointment exists, because those are records.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'case_library_case') then
    if exists (select 1 from case_library_case) then raise exception 'ROLLBACK-422 refused: cases exist'; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'clinical_content_version' and column_name = 'content_kind') then
    if exists (select 1 from clinical_content_version where content_kind <> 'competency' or competency_id is null) then
      raise exception 'ROLLBACK-422 refused: case review versions exist';
    end if;
  end if;
  if exists (select 1 from ogs_office_appointments where role = 'clinical_case_educator') then
    raise exception 'ROLLBACK-422 refused: somebody is appointed to the Clinical Case Educator position';
  end if;
end $$;

drop function if exists public.case_library_retire(uuid);
drop function if exists public.case_library_deliverable(uuid);
drop function if exists public.case_library_publish(uuid, uuid);
drop function if exists public.case_library_approved(uuid);
drop function if exists public.case_library_submit(uuid, uuid, int);
drop index if exists ux_clinical_content_version_case_hash;
alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version drop column if exists case_version_id;
alter table clinical_content_version drop column if exists content_kind;
alter table clinical_content_version alter column competency_id set not null;
drop table if exists case_library_version_competency;
drop table if exists case_library_version;
drop table if exists case_library_case;
drop function if exists public.case_library_version_competency_guard();
drop function if exists public.case_library_version_guard();
drop function if exists public.case_library_case_guard();
delete from hq_position_capability where capability_code in ('hq.quality.case.author', 'hq.quality.case.publish');
delete from hq_position_capability where position_code = 'clinical_case_educator';
delete from hq_position where code = 'clinical_case_educator';
delete from hq_capability where code in ('hq.quality.case.author', 'hq.quality.case.publish');

create or replace function public.clinical_content_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_hospital uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'clinical_content_version is append-only: put forward a new version instead';
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
  if not clinical_scope_covers(new.appointment_id, v_version.competency_id) then
    raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers the competency';
  end if;
  if competency_content_hash(v_version.competency_id) is distinct from v_version.content_hash then
    raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
  end if;
  new.created_at := now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
