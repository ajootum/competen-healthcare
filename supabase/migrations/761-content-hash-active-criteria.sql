-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It replaces sql and plpgsql functions between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 761: THE CLINICAL CONTENT FINGERPRINT COVERS ONLY ACTIVE CRITERIA
--
-- FRAMEWORK-DESIGN-STUDIO-02, owner ruling D3 (31 Oct 2026): retiring a criterion is SUBSTANTIVE. It changes
-- what an assessor must see, so it must change the fingerprint and send the competency back to clinical review.
--
-- APPLY ON STAGING FIRST. No table, column, row or grant is changed. Three function bodies are replaced and one
-- marker function is added. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (functions replaced), so it carries a staging rollback rehearsal.
-- Depends on 395 (competency_content_hash, competency_content_hashes), 670 (the current hash body) and 690 (the
-- current clinical_content_version_guard body). Apply any time after 690. Independent of 760.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT CHANGES.
--
-- 1. competency_content_hash (670 body). The criteria list now reads only rows with is_active not false.
--    competency_skills.is_active is not null default true (007), so every existing row is active and every
--    competency with no retired criterion hashes EXACTLY as before. Every existing clinical approval, pending
--    version and verification request stays current. Retiring a criterion now changes the hash, and restoring
--    it returns the hash to its earlier value.
--
-- 2. competency_content_hashes (395 body). Re-created unchanged. It calls the single function, so it agrees with
--    it for every competency.
--
-- 3. clinical_content_version_guard (690 body). The competency snapshot the trigger stores beside the hash reads
--    only active criteria too, so a version still describes exactly the content its hash names (395) and a
--    reviewer is never shown a retired criterion as part of what they approve. Every other branch (method,
--    learning, resource, case) and every refusal is unchanged.
--
-- 4. competency_content_hash_covers_retirement(), a marker that returns true. The server probes it before it lets
--    a criterion of a reviewed competency be retired or restored. Before 761 the probe fails and the server
--    refuses, as it did before (fail closed).
--
-- CALLERS, UNCHANGED IN MEANING. Every caller compares the current hash with one stored when a record was made:
-- clinical_content_version (395, 422, 442, 461, 690 guards and decisions), publication (466), verification
-- requests and decisions (510, 680), the review queue, catalogue, layout and lifecycle reads in the app. With no
-- retired criterion anywhere the stored and current values are identical before and after, and a retirement now
-- reads as a content change to each of them, which is the ruling.
--
-- NOT ACTIVATED. Nothing is approved, published, retired or offered.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/761-ROLLBACK.sql restores the 670, 395 and 690
-- bodies and drops the marker.
-- ====================================================================================================

-- ---------- 1. THE HASH, OVER ACTIVE CRITERIA ONLY ----------

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
                          from competency_skills s where s.competency_id = c.id and s.is_active is not false), '[]'::jsonb)
  )::text)
  from framework_competencies c
  where c.id = p_competency
$$;

-- ---------- 2. THE BATCH FORM, UNCHANGED (it calls the single function) ----------

create or replace function public.competency_content_hashes(p_ids uuid[])
returns table (competency_id uuid, content_hash text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.id, competency_content_hash(c.id) from framework_competencies c where c.id = any(p_ids)
$$;

-- ---------- 3. THE VERSION SNAPSHOT, OVER ACTIVE CRITERIA ONLY (690 body, one line changed) ----------

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


-- ---------- 4. THE MARKER THE SERVER PROBES ----------

create or replace function public.competency_content_hash_covers_retirement()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select true
$$;

-- ---------- VERIFICATION ----------

select 'hash_filters_active' as item, (position('is_active is not false' in pg_get_functiondef('public.competency_content_hash(uuid)'::regprocedure)) > 0)::text as value
union all select 'snapshot_filters_active', (position('is_active is not false' in pg_get_functiondef('public.clinical_content_version_guard()'::regprocedure)) > 0)::text
union all select 'marker', public.competency_content_hash_covers_retirement()::text
union all select 'inactive_criteria', count(*)::text from competency_skills where is_active is false;

notify pgrst, 'reload schema';
