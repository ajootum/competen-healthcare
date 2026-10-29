-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It replaces plpgsql functions of migration 510 between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 680: CFCA GOVERNED VERIFICATION -- CCHU COMPONENTS, INDEPENDENT METHOD PUBLICATION, ASSESSOR
-- EVIDENCE AND THE CONSOLIDATED COMPONENT OUTCOME ON A VERIFICATION DECISION
--
-- COMPETEN Competency Framework Consolidation and Integration (owner directive 29 Oct 2026), item 3, over the
-- 510 Verification Studio and the 660 CCHU component registry. CFCA-REVIEW-01 gaps P2-1, P2-2, P2-4, P2-6.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Two method kinds, two evidence kinds, nullable or defaulted columns, three
-- new functions and four 510 function bodies replaced, each keeping every 510 rule and adding to it. No row is
-- written or changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (trigger functions replaced), so it carries a staging rollback rehearsal.
-- DEPENDS ON 510 (the Verification Studio), 641 (competency_appointment_holds, individual_holds_capability) and
-- 660 (competency_assessment_component).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT CHANGES.
--
-- A. METHOD KINDS. knowledge_exam and clinical_reasoning join the kinds of competency_verification_method.
--
-- B. COMPONENTS IN METHOD CONTENT (configuration, not code). A method version may list components, each a code
--    of competency_assessment_component (660) with its own pass level (a level of the method scale), mandatory,
--    safety critical (always mandatory) and weight, exactly the settings 660 gives a catalogue entry. A criterion
--    or checklist item may carry a component key naming one of them. competency_method_content_problem refuses to
--    publish anything else. Nothing is defaulted: a component used by an item must be configured explicitly.
--
-- C. INDEPENDENT PUBLICATION OF A METHOD VERSION. last_edited_by and edited_by on the version. Every draft edit
--    names its editor, who holds hq.competency.verification.manage, and the database keeps the list of editors.
--    The person who created the version, or edited it, can never publish it, and publishing never changes the
--    content (it publishes exactly the draft the editors left).
--
-- D. ASSESSOR EVIDENCE. Two evidence kinds recorded by the ASSIGNED assessor, not the person: an assessor
--    observation and an exam result. Each names the method version of the request, is recorded under the
--    assessor own active, in-scope appointment while the request is with them, never on their own request, and
--    is snapshotted into provenance like the person own records. The 510 person-record kinds and their
--    provenance rule are unchanged.
--
-- E. THE CONSOLIDATED COMPONENT OUTCOME. When the pinned method version lists components, the decision states a
--    level (or not assessed) per component, and the database computes the consolidated outcome by the rule of
--    componentOutcome (src/lib/competency/studio-components.ts): a weighted level never overrides a failed
--    mandatory or safety-critical component, and a missing mandatory component leaves it incomplete. The target
--    is the level verified for a verified outcome, otherwise the level the request asked about. A verified outcome
--    needs the consolidated outcome achieved. A method with no components decides exactly as under 510.
--
-- 510 FUNCTIONS REPLACED (every 510 rule kept): competency_method_content_problem,
-- competency_verification_method_version_guard, competency_verification_evidence_guard,
-- competency_verification_decision_guard. NEW: competency_method_components, competency_component_outcome,
-- competency_assessor_record_problem.
--
-- NOT ACTIVATED. No method is published, no assessor is appointed or scoped, verification stays OFF.
-- RLS unchanged: no new table. The new columns sit on 510 tables whose RLS and own-row policies stand.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA-VERIFY-P2/ROLLBACK-680.sql
-- ====================================================================================================


-- ---- A. METHOD KINDS -----------------------------------------------------------------------------------

alter table competency_verification_method drop constraint if exists competency_verification_method_check;
alter table competency_verification_method add constraint competency_verification_method_check check (
  code ~ '^[a-z][a-z0-9_]{2,60}$'
  and char_length(btrim(name)) between 3 and 160
  and kind in ('direct_observation', 'simulation', 'portfolio_review', 'practical_assessment', 'oral_assessment',
               'structured_assessment', 'other', 'knowledge_exam', 'clinical_reasoning')
);


-- ---- B. COMPONENTS IN METHOD CONTENT ----------------------------------------------------------------------

-- The 510 rules, then the 680 component rules, in that order.
create or replace function public.competency_method_content_problem(p_content jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_o jsonb;
  v_c jsonb;
  v_k jsonb;
  v_components jsonb := coalesce(p_content -> 'components', '[]'::jsonb);
begin
  if jsonb_typeof(p_content -> 'outcomes') is distinct from 'array' or jsonb_array_length(p_content -> 'outcomes') = 0 then
    return 'name at least one outcome';
  end if;
  for v_o in select * from jsonb_array_elements(p_content -> 'outcomes') loop
    if coalesce(v_o ->> 'code', '') !~ '^[a-z][a-z0-9_]{1,40}$'
       or coalesce(v_o ->> 'class', '') not in ('verified', 'partial', 'further_evidence', 'not_demonstrated', 'unable_to_determine')
       or char_length(btrim(coalesce(v_o ->> 'label', ''))) < 3 then
      return 'every outcome needs a code, a known class and a label';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_content -> 'outcomes') e) <>
     (select count(distinct e ->> 'code') from jsonb_array_elements(p_content -> 'outcomes') e) then
    return 'outcome codes must be distinct';
  end if;
  if exists (select 1 from jsonb_array_elements(p_content -> 'outcomes') e where e ->> 'class' = 'verified') then
    if not exists (select 1 from scoring_scales s where s.id::text = p_content ->> 'scaleId') then
      return 'an outcome that verifies at a level needs the proficiency scale';
    end if;
  end if;
  if jsonb_typeof(coalesce(p_content -> 'criteria', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_content -> 'checklist', '[]'::jsonb)) <> 'array' then
    return 'criteria and checklist are lists';
  end if;
  for v_c in select * from jsonb_array_elements(coalesce(p_content -> 'criteria', '[]'::jsonb) || coalesce(p_content -> 'checklist', '[]'::jsonb)) loop
    if coalesce(v_c ->> 'id', '') !~ '^[a-z0-9][a-z0-9_-]{0,40}$' or char_length(btrim(coalesce(v_c ->> 'text', ''))) < 3 then
      return 'every criterion and checklist item needs an id and its words';
    end if;
  end loop;
  if coalesce(p_content #>> '{workflow,assignment}', 'administrator') not in ('administrator', 'self_claim') then
    return 'assignment is by an administrator or claimed by the assessor';
  end if;

  -- 680: the CCHU components, each configured explicitly.
  if jsonb_typeof(v_components) <> 'array' then
    return 'components are a list';
  end if;
  for v_k in select * from jsonb_array_elements(v_components) loop
    if jsonb_typeof(v_k) <> 'object' then
      return 'every component is an active assessment component';
    end if;
    if not exists (select 1 from competency_assessment_component a where a.code = v_k ->> 'code' and a.is_active) then
      return 'every component is an active assessment component';
    end if;
    if coalesce(jsonb_typeof(v_k -> 'mandatory'), 'null') not in ('boolean', 'null')
       or coalesce(jsonb_typeof(v_k -> 'safetyCritical'), 'null') not in ('boolean', 'null') then
      return 'component mandatory and safety-critical settings are true or false';
    end if;
    if coalesce((v_k ->> 'safetyCritical')::boolean, false) and coalesce((v_k ->> 'mandatory')::boolean, true) is false then
      return 'a safety-critical component is always mandatory';
    end if;
    if coalesce(jsonb_typeof(v_k -> 'weight'), 'null') not in ('number', 'null') then
      return 'a component weight is above 0 and at most 100, to two decimal places, or blank';
    end if;
    if jsonb_typeof(v_k -> 'weight') = 'number' then
      if not ((v_k ->> 'weight')::numeric > 0 and (v_k ->> 'weight')::numeric <= 100
              and (v_k ->> 'weight')::numeric * 100 = trunc((v_k ->> 'weight')::numeric * 100)) then
        return 'a component weight is above 0 and at most 100, to two decimal places, or blank';
      end if;
    end if;
    if coalesce(jsonb_typeof(v_k -> 'passLevelId'), 'null') not in ('string', 'null') then
      return 'a component pass level is a level of the proficiency scale of the method';
    end if;
    if jsonb_typeof(v_k -> 'passLevelId') = 'string' and not exists (
      select 1 from scoring_levels l where l.id::text = v_k ->> 'passLevelId' and l.scale_id::text = p_content ->> 'scaleId') then
      return 'a component pass level is a level of the proficiency scale of the method';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_components) e) <>
     (select count(distinct e ->> 'code') from jsonb_array_elements(v_components) e) then
    return 'each component is listed once';
  end if;
  if jsonb_array_length(v_components) > 0
     and not exists (select 1 from scoring_scales s where s.id::text = p_content ->> 'scaleId') then
    return 'components are scored on the proficiency scale of the method';
  end if;
  for v_c in select * from jsonb_array_elements(coalesce(p_content -> 'criteria', '[]'::jsonb) || coalesce(p_content -> 'checklist', '[]'::jsonb)) loop
    if coalesce(jsonb_typeof(v_c -> 'component'), 'null') <> 'null' and not exists (
      select 1 from jsonb_array_elements(v_components) k where k ->> 'code' = v_c ->> 'component') then
      return 'the component of every criterion and checklist item is configured in the components of the method';
    end if;
  end loop;
  return null;
end
$$;

-- The component requirements of PUBLISHED method content, in order, with each pass level as its score. The
-- same shape as ComponentRequirement in studio-components.ts. Only called on content that passed the rules above.
create or replace function public.competency_method_components(p_content jsonb)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', k ->> 'code',
           'pass', (select l.score from scoring_levels l where l.id::text = k ->> 'passLevelId'),
           'mandatory', coalesce((k ->> 'mandatory')::boolean, true) or coalesce((k ->> 'safetyCritical')::boolean, false),
           'safetyCritical', coalesce((k ->> 'safetyCritical')::boolean, false),
           'weight', case when jsonb_typeof(k -> 'weight') = 'number' then (k ->> 'weight')::numeric end
         ) order by t.o), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_content -> 'components', '[]'::jsonb)) with ordinality as t(k, o)
$$;

-- THE ROLL-UP RULE, line for line with componentOutcome() in src/lib/competency/studio-components.ts.
-- p_reqs [{code, pass, mandatory, safetyCritical, weight}], p_results [{code, score}] (the last result for a code
-- counts, as a Map does), p_target the target score or null.
create or replace function public.competency_component_outcome(p_reqs jsonb, p_results jsonb, p_target integer)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_r jsonb;
  v_code text;
  v_mandatory boolean;
  v_score integer;
  v_pass integer;
  v_w numeric;
  v_sum numeric := 0;
  v_weights numeric := 0;
  v_overall integer;
  v_failed text[] := '{}';
  v_safety text[] := '{}';
  v_missing text[] := '{}';
  v_status text;
begin
  for v_r in select t.e from jsonb_array_elements(coalesce(p_reqs, '[]'::jsonb)) with ordinality as t(e, o) order by t.o loop
    v_code := v_r ->> 'code';
    v_mandatory := coalesce((v_r ->> 'mandatory')::boolean, false);
    v_score := null;
    select (x.e ->> 'score')::integer into v_score
      from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) with ordinality as x(e, o)
     where x.e ->> 'code' = v_code order by x.o desc limit 1;
    v_pass := coalesce((v_r ->> 'pass')::integer, p_target);
    if v_score is null then
      if v_mandatory then v_missing := v_missing || v_code; end if;
      continue;
    end if;
    v_w := coalesce((v_r ->> 'weight')::numeric, 1);
    v_sum := v_sum + v_score * v_w;
    v_weights := v_weights + v_w;
    if v_pass is null then
      if v_mandatory then v_missing := v_missing || v_code; end if;
      continue;
    end if;
    if v_score < v_pass and v_mandatory then
      v_failed := v_failed || v_code;
      if coalesce((v_r ->> 'safetyCritical')::boolean, false) then v_safety := v_safety || v_code; end if;
    end if;
  end loop;
  v_overall := case when v_weights > 0 then floor(v_sum / v_weights)::integer end;
  v_status := case when cardinality(v_failed) > 0 then 'not_achieved'
                   when cardinality(v_missing) > 0 then 'incomplete'
                   when v_overall is null then 'incomplete'
                   when p_target is not null and v_overall < p_target then 'not_achieved'
                   else 'achieved' end;
  return jsonb_build_object('status', v_status, 'overall', v_overall, 'target', p_target,
    'failedMandatory', to_jsonb(v_failed), 'failedSafetyCritical', to_jsonb(v_safety), 'missingMandatory', to_jsonb(v_missing));
end
$$;

revoke all on function public.competency_method_components(jsonb) from public, anon, authenticated;
revoke all on function public.competency_component_outcome(jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.competency_method_components(jsonb) to service_role;
grant execute on function public.competency_component_outcome(jsonb, jsonb, integer) to service_role;


-- ---- C. INDEPENDENT PUBLICATION OF A METHOD VERSION ----------------------------------------------------------

alter table competency_verification_method_version add column if not exists last_edited_by uuid references profiles(id) on delete set null;
alter table competency_verification_method_version add column if not exists edited_by uuid[] not null default '{}';

create or replace function public.competency_verification_method_version_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_problem text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.state = 'draft' then return old; end if;
    raise exception 'competency_verification_method_version: a published version is the record of the criteria applied. Retire it instead';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'competency_verification_method_version: a version starts as a draft';
    end if;
    if not public.individual_holds_capability(new.authored_by, 'hq.competency.verification.manage') then
      raise exception 'competency_verification_method_version: not authorised. It needs an active appointment holding hq.competency.verification.manage';
    end if;
    new.version_no := coalesce((select max(version_no) from competency_verification_method_version where method_id = new.method_id), 0) + 1;
    new.content_hash := null;
    new.published_by := null; new.published_at := null; new.retired_by := null; new.retired_at := null;
    new.last_edited_by := null; new.edited_by := '{}';
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  -- UPDATE. First the foreign keys clearing authored_by, published_by, retired_by or last_edited_by when that
  -- profile is erased.
  if pg_trigger_depth() > 1
     and (new.id, new.method_id, new.version_no, new.state, new.content, new.content_hash, new.published_at, new.retired_at, new.created_at, new.edited_by)
         is not distinct from (old.id, old.method_id, old.version_no, old.state, old.content, old.content_hash, old.published_at, old.retired_at, old.created_at, old.edited_by)
     and (new.authored_by is null or new.authored_by = old.authored_by)
     and (new.published_by is null or new.published_by = old.published_by)
     and (new.retired_by is null or new.retired_by = old.retired_by)
     and (new.last_edited_by is null or new.last_edited_by = old.last_edited_by) then
    return new;
  end if;
  if new.method_id is distinct from old.method_id or new.version_no is distinct from old.version_no
     or new.authored_by is distinct from old.authored_by or new.created_at is distinct from old.created_at then
    raise exception 'competency_verification_method_version: a version identity cannot be rewritten';
  end if;
  if new.edited_by is distinct from old.edited_by then
    raise exception 'competency_verification_method_version: the editors of a version are recorded by the database, never written';
  end if;

  if old.state = 'draft' and new.state = 'draft' then
    -- 680: every edit names its editor, who holds manage, and the editor joins the record of editors.
    if not public.individual_holds_capability(new.last_edited_by, 'hq.competency.verification.manage') then
      raise exception 'competency_verification_method_version: not authorised to edit. A draft edit names its editor, who needs hq.competency.verification.manage';
    end if;
    if not (new.last_edited_by = any(old.edited_by)) then
      new.edited_by := old.edited_by || new.last_edited_by;
    end if;
    new.content_hash := null; new.updated_at := now();
    return new;
  end if;

  if new.last_edited_by is distinct from old.last_edited_by then
    raise exception 'competency_verification_method_version: only a draft edit names an editor';
  end if;

  if old.state = 'draft' and new.state = 'published' then
    if not public.individual_holds_capability(new.published_by, 'hq.competency.verification.manage') then
      raise exception 'competency_verification_method_version: not authorised to publish. It needs hq.competency.verification.manage';
    end if;
    -- 680: independent publication of exactly the draft the editors left.
    if new.published_by = old.authored_by or new.published_by = any(old.edited_by) then
      raise exception 'competency_verification_method_version: not independent. The person who created or edited a method version cannot publish it';
    end if;
    if new.content is distinct from old.content then
      raise exception 'competency_verification_method_version: publishing never changes the criteria. Save the draft, then another administrator publishes it';
    end if;
    v_problem := public.competency_method_content_problem(new.content);
    if v_problem is not null then
      raise exception 'competency_verification_method_version: cannot publish: %', v_problem;
    end if;
    new.content_hash := md5(new.content::text);
    new.published_at := now(); new.updated_at := now();
    -- A newer published version retires the one before it.
    update competency_verification_method_version
       set state = 'retired', retired_at = now(), retired_by = new.published_by, updated_at = now()
     where method_id = new.method_id and state = 'published' and id <> new.id;
    return new;
  end if;

  if old.state = 'published' and new.state = 'retired' then
    if new.content is distinct from old.content or new.content_hash is distinct from old.content_hash
       or new.published_by is distinct from old.published_by or new.published_at is distinct from old.published_at then
      raise exception 'competency_verification_method_version: a published version never changes. Retiring it changes only its state';
    end if;
    if pg_trigger_depth() <= 1 and not public.individual_holds_capability(new.retired_by, 'hq.competency.verification.manage') then
      raise exception 'competency_verification_method_version: not authorised to retire. It needs hq.competency.verification.manage';
    end if;
    new.retired_at := coalesce(new.retired_at, now()); new.updated_at := now();
    return new;
  end if;

  raise exception 'competency_verification_method_version: a % version cannot become %. Published criteria never change: make a new version', old.state, new.state;
end
$$;

drop trigger if exists competency_verification_method_version_guard on competency_verification_method_version;
create trigger competency_verification_method_version_guard before insert or update or delete on competency_verification_method_version
  for each row execute function public.competency_verification_method_version_guard();


-- ---- D. ASSESSOR EVIDENCE --------------------------------------------------------------------------------

alter table competency_verification_evidence add column if not exists recorded_by uuid references profiles(id) on delete set null;
alter table competency_verification_evidence add column if not exists appointment_id uuid references ogs_office_appointments(id) on delete set null;
alter table competency_verification_evidence add column if not exists method_version_id uuid references competency_verification_method_version(id) on delete restrict;
alter table competency_verification_evidence add column if not exists assessor_record jsonb;

alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_check;
alter table competency_verification_evidence add constraint competency_verification_evidence_check check (
  kind in ('cpd', 'learning_record', 'evidence', 'profile_item', 'reflection', 'study_achievement', 'assessor_observation', 'exam_result')
  and num_nonnulls(cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, study_achievement_id) <= 1
  and cardinality(outcome_indexes) between 1 and 200
  and -1 <= all(outcome_indexes)
);

-- An assessor record names no record of the person, and a person record carries nothing of an assessor.
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_assessor_check;
alter table competency_verification_evidence add constraint competency_verification_evidence_assessor_check check (
  case when kind in ('assessor_observation', 'exam_result')
       then assessor_record is not null and jsonb_typeof(assessor_record) = 'object' and method_version_id is not null
            and num_nonnulls(cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, study_achievement_id) = 0
       else recorded_by is null and appointment_id is null and method_version_id is null and assessor_record is null
  end
);

-- What an assessor record says, for the method it was recorded under.
create or replace function public.competency_assessor_record_problem(p_kind text, p_record jsonb, p_content jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_on date;
  v_day text;
begin
  if jsonb_typeof(p_record) is distinct from 'object' or char_length(p_record::text) > 8000 then
    return 'an assessor record is a record of at most 8000 characters';
  end if;
  if coalesce(jsonb_typeof(p_record -> 'component'), 'null') <> 'null' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_content -> 'components', '[]'::jsonb)) k where k ->> 'code' = p_record ->> 'component') then
    return 'the component named is not one this method assesses';
  end if;
  if p_kind = 'assessor_observation' then
    if char_length(btrim(coalesce(p_record ->> 'summary', ''))) not between 10 and 4000 then
      return 'an observation says what was observed, in 10 to 4000 characters';
    end if;
    if char_length(coalesce(p_record ->> 'setting', '')) > 200 then
      return 'keep the setting under 200 characters';
    end if;
    v_day := p_record ->> 'observedOn';
  elsif p_kind = 'exam_result' then
    if char_length(btrim(coalesce(p_record ->> 'title', ''))) not between 3 and 200 then
      return 'an exam result names the examination, in 3 to 200 characters';
    end if;
    if coalesce(jsonb_typeof(p_record -> 'score'), '') <> 'number' or coalesce(jsonb_typeof(p_record -> 'maxScore'), '') <> 'number'
       or coalesce(jsonb_typeof(p_record -> 'passMark'), 'null') not in ('number', 'null') then
      return 'an exam result states the score and the maximum score as numbers';
    end if;
    if (p_record ->> 'maxScore')::numeric <= 0 or (p_record ->> 'score')::numeric < 0
       or (p_record ->> 'score')::numeric > (p_record ->> 'maxScore')::numeric then
      return 'the score is between 0 and the maximum score';
    end if;
    if jsonb_typeof(p_record -> 'passMark') = 'number' then
      if (p_record ->> 'passMark')::numeric < 0 or (p_record ->> 'passMark')::numeric > (p_record ->> 'maxScore')::numeric then
        return 'the pass mark is between 0 and the maximum score';
      end if;
    end if;
    v_day := p_record ->> 'takenOn';
  else
    return 'unknown assessor record';
  end if;
  if coalesce(v_day, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return 'the record states the day, as a date';
  end if;
  begin
    v_on := v_day::date;
  exception when others then
    return 'the record states the day, as a date';
  end;
  if v_on > current_date then
    return 'the record cannot be dated in the future';
  end if;
  return null;
end
$$;

revoke all on function public.competency_assessor_record_problem(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.competency_assessor_record_problem(text, jsonb, jsonb) to service_role;

-- Evidence: the person own record, snapshotted now, while the request can still take evidence (510, unchanged), or
-- (680) an assessor record by the assigned assessor, snapshotted with the method version it was recorded under.
create or replace function public.competency_verification_evidence_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_state text;
  v_snap jsonb;
  v_req competency_verification_request%rowtype;
  v_version competency_verification_method_version%rowtype;
  v_assigned record;
  v_problem text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_evidence is append-only: evidence submitted stays with the request';
  end if;
  if tg_op = 'UPDATE' then
    -- The person removed the source record, or a profile was erased: its reference clears, and the provenance
    -- snapshot stays as submitted.
    if pg_trigger_depth() > 1
       and (new.id, new.request_id, new.user_id, new.kind, new.outcome_indexes, new.provenance, new.created_at, new.method_version_id, new.assessor_record)
           is not distinct from (old.id, old.request_id, old.user_id, old.kind, old.outcome_indexes, old.provenance, old.created_at, old.method_version_id, old.assessor_record)
       and new.portfolio_link_id is not distinct from old.portfolio_link_id
       and (new.recorded_by is null or new.recorded_by = old.recorded_by)
       and (new.appointment_id is null or new.appointment_id = old.appointment_id)
       and num_nonnulls(new.cpd_id, new.learning_record_id, new.evidence_id, new.profile_item_id, new.reflection_id, new.study_achievement_id) = 0 then
      return new;
    end if;
    raise exception 'competency_verification_evidence is append-only: evidence submitted stays with the request';
  end if;

  -- 680: an assessor observation or exam result.
  if new.kind in ('assessor_observation', 'exam_result') then
    select * into v_req from competency_verification_request where id = new.request_id and user_id = new.user_id;
    if not found then
      raise exception 'competency_verification_evidence: unknown request';
    end if;
    if new.recorded_by is null or new.recorded_by = v_req.user_id then
      raise exception 'competency_verification_evidence: no self-verification. Assessor evidence is recorded by the assessor, never on your own request';
    end if;
    v_state := public.competency_verification_state(new.request_id);
    if v_state <> 'assigned' then
      raise exception 'competency_verification_evidence: this request is %, and assessor evidence is recorded while it is with the assessor', v_state;
    end if;
    select assessor_id, appointment_id into v_assigned from competency_verification_event
     where request_id = new.request_id and event = 'assigned' order by created_at desc, id desc limit 1;
    if v_assigned.assessor_id is distinct from new.recorded_by or v_assigned.appointment_id is distinct from new.appointment_id then
      raise exception 'competency_verification_evidence: not the assigned assessor. Only the assessor assigned, under that appointment, records assessor evidence';
    end if;
    if not public.competency_appointment_holds(new.appointment_id, new.recorded_by, 'hq.competency.verification.assess') then
      raise exception 'competency_verification_evidence: not authorised. The appointment must be the assessor own, active, and hold hq.competency.verification.assess';
    end if;
    if new.method_version_id is distinct from v_req.method_version_id then
      raise exception 'competency_verification_evidence: assessor evidence is recorded against the method version of the request';
    end if;
    select * into v_version from competency_verification_method_version where id = new.method_version_id;
    if v_version.content_hash is null then
      raise exception 'competency_verification_evidence: the method version has no published criteria';
    end if;
    if not public.competency_assessor_covers(new.appointment_id, v_req.competency_id, v_version.method_id, v_req.target_level_id, v_req.context, current_date) then
      raise exception 'competency_verification_evidence: out of scope. No live scope of this appointment covers this competency, method, level and context';
    end if;
    v_problem := public.competency_assessor_record_problem(new.kind, new.assessor_record, v_version.content);
    if v_problem is not null then
      raise exception 'competency_verification_evidence: %', v_problem;
    end if;
    v_snap := jsonb_build_object(
      'title', case when new.kind = 'assessor_observation' then 'Assessor observation' else btrim(new.assessor_record ->> 'title') end,
      'evidence_class', 'assessor_recorded',
      'date', coalesce(new.assessor_record ->> 'observedOn', new.assessor_record ->> 'takenOn'),
      'recorded_by', new.recorded_by, 'appointment_id', new.appointment_id,
      'method_version_id', v_version.id, 'method_version_no', v_version.version_no, 'method_content_hash', v_version.content_hash,
      'record', new.assessor_record);
    new.provenance := v_snap || jsonb_build_object('kind', new.kind, 'snapshot_at', now());
    new.created_at := clock_timestamp();
    return new;
  end if;

  -- The 510 person-record path, unchanged.
  if (case new.kind when 'cpd' then new.cpd_id when 'learning_record' then new.learning_record_id when 'evidence' then new.evidence_id
                    when 'profile_item' then new.profile_item_id when 'reflection' then new.reflection_id else new.study_achievement_id end) is null
     or num_nonnulls(new.cpd_id, new.learning_record_id, new.evidence_id, new.profile_item_id, new.reflection_id, new.study_achievement_id) <> 1 then
    raise exception 'competency_verification_evidence: name exactly one record, of the kind given';
  end if;
  v_state := public.competency_verification_state(new.request_id);
  if v_state in ('withdrawn', 'decided') then
    raise exception 'competency_verification_evidence: this request is % and takes no more evidence', v_state;
  end if;

  if new.kind = 'cpd' then
    select jsonb_build_object('title', c.title, 'type', c.activity_type, 'date', c.activity_date, 'hours', c.hours, 'credits', c.cpd_points,
      'evidence_class', c.evidence_class, 'document_path', c.document_path, 'document_name', c.document_name, 'recorded_at', c.created_at)
      into v_snap from individual_professional_cpd c where c.id = new.cpd_id and c.user_id = new.user_id;
  elsif new.kind = 'learning_record' then
    select jsonb_build_object('title', o.title, 'code', o.code, 'version_no', v.version_no, 'status', r.status, 'completed_at', r.completed_at,
      'completion_kind', r.completion_kind, 'evidence_class', r.evidence_class)
      into v_snap from learning_record r join learning_offering o on o.id = r.offering_id join learning_offering_version v on v.id = r.version_id
     where r.id = new.learning_record_id and r.user_id = new.user_id and r.status = 'completed';
    if v_snap is null then
      raise exception 'competency_verification_evidence: only a completed learning record can be evidence';
    end if;
  elsif new.kind = 'evidence' then
    select jsonb_build_object('title', e.title, 'kind', e.kind, 'issuing_body', e.issuing_body, 'issued_on', e.issued_on, 'expires_on', e.expires_on,
      'evidence_class', e.evidence_class, 'document_path', e.document_path, 'document_name', e.document_name, 'recorded_at', e.created_at)
      into v_snap from individual_professional_evidence e where e.id = new.evidence_id and e.user_id = new.user_id;
  elsif new.kind = 'profile_item' then
    select jsonb_build_object('title', i.title, 'section', i.section, 'organisation', i.organisation, 'started_on', i.started_on, 'ended_on', i.ended_on,
      'evidence_class', i.evidence_class, 'document_path', i.document_path, 'document_name', i.document_name, 'current', (i.superseded_at is null and i.withdrawn_at is null))
      into v_snap from individual_professional_profile_item i where i.id = new.profile_item_id and i.user_id = new.user_id;
  elsif new.kind = 'reflection' then
    select jsonb_build_object('template', r.template_label, 'body', left(r.body, 5000), 'evidence_class', 'self_declared', 'written_at', r.created_at)
      into v_snap from individual_professional_reflection r where r.id = new.reflection_id and r.user_id = new.user_id;
  elsif new.kind = 'study_achievement' then
    -- Scholar educational evidence keeps its educational context and class: formative, never a verification.
    select jsonb_build_object('title', p.label, 'achievement', p.achievement, 'included_at', p.included_at,
      'evidence_class', 'scholar_formative', 'context', 'Competen Scholar study, formative and self-directed. Not a verification')
      into v_snap from individual_scholar_passport_item p where p.id = new.study_achievement_id and p.user_id = new.user_id;
  end if;
  if v_snap is null then
    raise exception 'competency_verification_evidence: that record is not the person own';
  end if;
  new.provenance := v_snap || jsonb_build_object('kind', new.kind, 'snapshot_at', now());
  new.created_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists competency_verification_evidence_guard on competency_verification_evidence;
create trigger competency_verification_evidence_guard before insert or update or delete on competency_verification_evidence
  for each row execute function public.competency_verification_evidence_guard();


-- ---- E. THE CONSOLIDATED COMPONENT OUTCOME ON A DECISION ------------------------------------------------------

alter table competency_verification_decision add column if not exists component_results jsonb not null default '[]'::jsonb;
alter table competency_verification_decision add column if not exists component_outcome jsonb;

alter table competency_verification_decision drop constraint if exists competency_verification_decision_component_check;
alter table competency_verification_decision add constraint competency_verification_decision_component_check check (
  jsonb_typeof(component_results) = 'array'
  and (component_outcome is null or jsonb_typeof(component_outcome) = 'object')
);

-- The decision: the assigned, appointed, in-scope, independent assessor, against the pinned criteria (510), and
-- (680) the consolidated component outcome where the method version assesses components.
create or replace function public.competency_verification_decision_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_req competency_verification_request%rowtype;
  v_version competency_verification_method_version%rowtype;
  v_state text;
  v_assigned record;
  v_outcome jsonb;
  v_item jsonb;
  v_months integer;
  v_min integer;
  v_reqs jsonb;
  v_target integer;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_decision is append-only: a decision is history. Revoke it or decide again on a new request';
  end if;
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1
       and (new.id, new.request_id, new.user_id, new.method_version_id, new.method_content_hash, new.competency_hash, new.outcome_code, new.outcome_class,
            new.level_id, new.criteria_results, new.checklist_results, new.evidence_reviewed, new.rationale, new.valid_from, new.valid_until, new.created_at,
            new.component_results, new.component_outcome)
           is not distinct from
           (old.id, old.request_id, old.user_id, old.method_version_id, old.method_content_hash, old.competency_hash, old.outcome_code, old.outcome_class,
            old.level_id, old.criteria_results, old.checklist_results, old.evidence_reviewed, old.rationale, old.valid_from, old.valid_until, old.created_at,
            old.component_results, old.component_outcome) then
      return new;
    end if;
    raise exception 'competency_verification_decision is append-only: a decision is history. Revoke it or decide again on a new request';
  end if;

  select * into v_req from competency_verification_request where id = new.request_id and user_id = new.user_id;
  if not found then
    raise exception 'competency_verification_decision: unknown request';
  end if;
  if new.assessor_id is null or new.assessor_id = v_req.user_id then
    raise exception 'competency_verification_decision: no self-verification. A person can never decide their own request';
  end if;
  v_state := public.competency_verification_state(new.request_id);
  if v_state <> 'assigned' then
    raise exception 'competency_verification_decision: the request is % and cannot be decided now', v_state;
  end if;
  select assessor_id, appointment_id into v_assigned from competency_verification_event
   where request_id = new.request_id and event = 'assigned' order by created_at desc, id desc limit 1;
  if v_assigned.assessor_id is distinct from new.assessor_id or v_assigned.appointment_id is distinct from new.appointment_id then
    raise exception 'competency_verification_decision: not the assigned assessor. Only the assessor assigned, under that appointment, decides';
  end if;
  if not public.competency_appointment_holds(new.appointment_id, new.assessor_id, 'hq.competency.verification.assess') then
    raise exception 'competency_verification_decision: not authorised. The appointment must be the assessor own, active, and hold hq.competency.verification.assess';
  end if;

  if new.method_version_id is distinct from v_req.method_version_id then
    raise exception 'competency_verification_decision: a decision applies the method version the request was made under';
  end if;
  select * into v_version from competency_verification_method_version where id = new.method_version_id;
  if v_version.content_hash is null then
    raise exception 'competency_verification_decision: the method version has no published criteria';
  end if;
  if not public.competency_assessor_covers(new.appointment_id, v_req.competency_id, v_version.method_id, coalesce(new.level_id, v_req.target_level_id), v_req.context, current_date) then
    raise exception 'competency_verification_decision: out of scope. No live scope of this appointment covers this competency, method, level and context';
  end if;
  if competency_content_hash(v_req.competency_id) is distinct from v_req.competency_hash then
    raise exception 'competency_verification_decision: stale. The competency content has changed since the request, so it needs a new request';
  end if;

  select e into v_outcome from jsonb_array_elements(v_version.content -> 'outcomes') e where e ->> 'code' = new.outcome_code limit 1;
  if v_outcome is null then
    raise exception 'competency_verification_decision: % is not an outcome of this method version', new.outcome_code;
  end if;
  new.outcome_class := v_outcome ->> 'class';
  new.outcome_label := v_outcome ->> 'label';
  if (new.outcome_class = 'verified') <> (new.level_id is not null) then
    raise exception 'competency_verification_decision: a verified outcome states the level verified, and only a verified outcome does';
  end if;
  if new.level_id is not null then
    if not exists (select 1 from scoring_levels l where l.id = new.level_id and l.scale_id::text = v_version.content ->> 'scaleId') then
      raise exception 'competency_verification_decision: the level is not on the proficiency scale of the method';
    end if;
    if coalesce(jsonb_array_length(v_version.content -> 'levelIds'), 0) > 0 and not ((v_version.content -> 'levelIds') ? new.level_id::text) then
      raise exception 'competency_verification_decision: the method does not verify at that level';
    end if;
  end if;
  if new.outcome_class = 'further_evidence' and coalesce((v_version.content #>> '{workflow,allowFurtherEvidence}')::boolean, true) is false then
    raise exception 'competency_verification_decision: this method does not ask for further evidence. Decide on what was submitted';
  end if;

  -- Every required criterion and every critical checklist item is answered, met or not.
  for v_item in select * from jsonb_array_elements(coalesce(v_version.content -> 'criteria', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'required')::boolean, true) and not exists (
      select 1 from jsonb_array_elements(new.criteria_results) r
       where r ->> 'id' = v_item ->> 'id' and r ->> 'result' in ('met', 'not_met', 'not_applicable')) then
      raise exception 'competency_verification_decision: criterion % is not answered', v_item ->> 'id';
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(v_version.content -> 'checklist', '[]'::jsonb)) loop
    if coalesce((v_item ->> 'critical')::boolean, false) and not exists (
      select 1 from jsonb_array_elements(new.checklist_results) r
       where r ->> 'id' = v_item ->> 'id' and r ->> 'result' in ('done', 'not_done')) then
      raise exception 'competency_verification_decision: critical checklist item % is not answered', v_item ->> 'id';
    end if;
  end loop;
  if new.outcome_class = 'verified' and exists (
    select 1 from jsonb_array_elements(coalesce(v_version.content -> 'criteria', '[]'::jsonb)) c
      join jsonb_array_elements(new.criteria_results) r on r ->> 'id' = c ->> 'id'
     where coalesce((c ->> 'required')::boolean, true) and r ->> 'result' = 'not_met') then
    raise exception 'competency_verification_decision: a verified outcome cannot leave a required criterion not met';
  end if;

  -- 680: the CCHU components of the pinned method version, consolidated by the componentOutcome rule.
  v_reqs := public.competency_method_components(v_version.content);
  if jsonb_array_length(v_reqs) = 0 then
    if jsonb_array_length(new.component_results) > 0 then
      raise exception 'competency_verification_decision: this method version assesses no components, so the decision states no component results';
    end if;
    new.component_outcome := null;
  else
    if exists (
      select 1 from jsonb_array_elements(new.component_results) x
       where jsonb_typeof(x) <> 'object'
          or not exists (select 1 from jsonb_array_elements(v_reqs) r where r ->> 'code' = x ->> 'code')
          or coalesce(jsonb_typeof(x -> 'levelId'), 'null') not in ('string', 'null')
          or (jsonb_typeof(x -> 'levelId') = 'string' and not exists (
               select 1 from scoring_levels l where l.id::text = x ->> 'levelId' and l.scale_id::text = v_version.content ->> 'scaleId'))
          or char_length(coalesce(x ->> 'note', '')) > 500) then
      raise exception 'competency_verification_decision: each component result names a component of this method and a level of its proficiency scale, or not assessed';
    end if;
    if (select count(*) from jsonb_array_elements(new.component_results) x) <>
       (select count(distinct x ->> 'code') from jsonb_array_elements(new.component_results) x) then
      raise exception 'competency_verification_decision: each component is answered once';
    end if;
    -- The record keeps what was found in the words of the scale on the day, in the order of the method.
    new.component_results := (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('code', r ->> 'code', 'levelId', l.id, 'score', l.score, 'label', l.label, 'note', nullif(btrim(x ->> 'note'), '')))
                                order by t.o), '[]'::jsonb)
        from jsonb_array_elements(v_reqs) with ordinality as t(r, o)
        join jsonb_array_elements(new.component_results) x on x ->> 'code' = r ->> 'code'
        left join scoring_levels l on l.id::text = x ->> 'levelId');
    v_target := (select l.score from scoring_levels l where l.id = coalesce(new.level_id, v_req.target_level_id));
    new.component_outcome := public.competency_component_outcome(v_reqs, new.component_results, v_target);
    if new.outcome_class = 'verified' and new.component_outcome ->> 'status' <> 'achieved' then
      raise exception 'competency_verification_decision: a verified outcome needs the consolidated component outcome achieved. A weighted level never overrides a failed or missing mandatory or safety-critical component';
    end if;
  end if;

  -- The evidence reviewed is evidence of this request, and there is at least as much as the method requires.
  if exists (select 1 from unnest(new.evidence_reviewed) x where not exists (
    select 1 from competency_verification_evidence e where e.id = x and e.request_id = new.request_id)) then
    raise exception 'competency_verification_decision: evidence reviewed must be evidence submitted with this request';
  end if;
  v_min := coalesce((v_version.content ->> 'minEvidence')::integer, 0);
  if new.outcome_class in ('verified', 'partial') and cardinality(new.evidence_reviewed) < v_min then
    raise exception 'competency_verification_decision: this method needs at least % evidence items reviewed', v_min;
  end if;

  new.method_content_hash := v_version.content_hash;
  new.competency_hash := v_req.competency_hash;
  new.valid_from := current_date;
  v_months := nullif((v_version.content #>> '{validity,months}'), '')::integer;
  new.valid_until := case when new.outcome_class in ('verified', 'partial') and v_months is not null and v_months > 0
                          then (current_date + make_interval(months => v_months))::date - 1 else null end;
  new.created_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists competency_verification_decision_guard on competency_verification_decision;
create trigger competency_verification_decision_guard before insert or update or delete on competency_verification_decision
  for each row execute function public.competency_verification_decision_guard();

comment on column competency_verification_method_version.edited_by is
  '680. Every profile that edited this draft, kept by the guard. None of them, nor the author, may publish it.';
comment on column competency_verification_evidence.assessor_record is
  '680. An assessor observation or exam result, recorded by the assigned assessor under the method version of the request. Snapshotted into provenance.';
comment on column competency_verification_decision.component_outcome is
  '680. The consolidated CCHU outcome, computed by competency_component_outcome (the componentOutcome rule). Null when the method version assesses no components.';


-- ---- VERIFICATION -----------------------------------------------------------------------------------

select 'method_kinds_680' as item, (pg_get_constraintdef(c.oid) like '%knowledge_exam%clinical_reasoning%')::text as value
  from pg_constraint c where c.conname = 'competency_verification_method_check'
union all select 'evidence_kinds_680', (pg_get_constraintdef(c.oid) like '%assessor_observation%exam_result%')::text
  from pg_constraint c where c.conname = 'competency_verification_evidence_check'
union all select 'rule_parity_sample', public.competency_component_outcome(
  '[{"code":"clinical_skills","pass":4,"mandatory":true,"safetyCritical":true,"weight":1},{"code":"knowledge","pass":3,"mandatory":true,"safetyCritical":false,"weight":3}]'::jsonb,
  '[{"code":"clinical_skills","score":3},{"code":"knowledge","score":6}]'::jsonb, 4) ->> 'status'
union all select 'published_methods', count(*)::text from competency_verification_method_version where state = 'published'
union all select 'assessors_appointed', count(*)::text from ogs_office_appointments where role = 'competency_assessor' and status = 'active';

notify pgrst, 'reload schema';
