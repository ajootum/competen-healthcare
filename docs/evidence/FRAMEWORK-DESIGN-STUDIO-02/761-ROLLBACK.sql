-- ROLLBACK 761 (STAGING REHEARSAL ONLY). APPLY THIS FILE WHOLE.
-- Restores the 670 hash body, the 395 batch body and the 690 clinical_content_version_guard body, and drops the
-- 761 marker, so the server refuses retire and restore on reviewed competencies again. No row is changed. Any
-- version or request made while a criterion was retired keeps the hash it was made with, so after a rollback it
-- reads as stale until that criterion is restored or a new version is put forward.
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
    'expected_level_id', c.expected_level_id,
    'practice_id', c.practice_id,
    'cpu_id', c.cpu_id,
    'risk_category', c.risk_category,
    'skills', coalesce((select jsonb_agg(s.name || coalesce(' [' || s.component_code || ']', '') order by s.name, s.id)
                          from competency_skills s where s.competency_id = c.id), '[]'::jsonb)
  )::text)
  from framework_competencies c
  where c.id = p_competency
$$;

create or replace function public.competency_content_hashes(p_ids uuid[])
returns table (competency_id uuid, content_hash text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.id, competency_content_hash(c.id) from framework_competencies c where c.id = any(p_ids)
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
      'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb))
      from framework_competencies c where c.id = new.competency_id);
  new.created_at := now();
  return new;
end;
$$;


drop function if exists public.competency_content_hash_covers_retirement();

notify pgrst, 'reload schema';
