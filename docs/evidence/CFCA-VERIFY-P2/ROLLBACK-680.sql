-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql DO block and plpgsql function bodies between dollar quotes.
-- Paste the entire file into the SQL editor and run it once.
-- ====================================================================================================
-- ROLLBACK 680 (STAGING REHEARSAL ONLY). Restores the four 510 function bodies and the two 510 CHECK constraints
-- exactly as 510 wrote them, and drops only what 680 added (three functions, seven columns, two constraints).
--
-- IT REFUSES, AND CHANGES NOTHING, when anything 680 made possible is on the record: a method of a 680 kind,
-- evidence of a 680 kind, a decision with component results or a consolidated outcome, or a published or retired
-- method version whose content lists components (510 would then decide it without the component rule). Fix
-- forward instead.
-- ====================================================================================================

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from competency_verification_method where kind in ('knowledge_exam', 'clinical_reasoning');
  if v_n > 0 then raise exception 'ROLLBACK-680 refused: % method(s) of a 680 kind exist', v_n; end if;
  select count(*) into v_n from competency_verification_evidence where kind in ('assessor_observation', 'exam_result');
  if v_n > 0 then raise exception 'ROLLBACK-680 refused: % assessor evidence row(s) exist', v_n; end if;
  select count(*) into v_n from competency_verification_decision where jsonb_array_length(component_results) > 0 or component_outcome is not null;
  if v_n > 0 then raise exception 'ROLLBACK-680 refused: % decision(s) carry component results', v_n; end if;
  select count(*) into v_n from competency_verification_method_version
   where state <> 'draft' and jsonb_typeof(content -> 'components') = 'array' and jsonb_array_length(content -> 'components') > 0;
  if v_n > 0 then raise exception 'ROLLBACK-680 refused: % published or retired method version(s) list components', v_n; end if;
end
$$;

-- ---- the 510 bodies, verbatim from supabase/migrations/510-competency-verification-studio.sql ----

-- The published content must be complete enough to decide against: at least one outcome, each of a known
-- class and a code, a proficiency scale that exists, and well-formed criteria and checklist entries.
create or replace function public.competency_method_content_problem(p_content jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_o jsonb;
  v_c jsonb;
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
  return null;
end
$$;

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
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  -- UPDATE. First the foreign keys clearing authored_by, published_by or retired_by when that profile is erased.
  if pg_trigger_depth() > 1
     and (new.id, new.method_id, new.version_no, new.state, new.content, new.content_hash, new.published_at, new.retired_at, new.created_at)
         is not distinct from (old.id, old.method_id, old.version_no, old.state, old.content, old.content_hash, old.published_at, old.retired_at, old.created_at)
     and (new.authored_by is null or new.authored_by = old.authored_by)
     and (new.published_by is null or new.published_by = old.published_by)
     and (new.retired_by is null or new.retired_by = old.retired_by) then
    return new;
  end if;
  if new.method_id is distinct from old.method_id or new.version_no is distinct from old.version_no
     or new.authored_by is distinct from old.authored_by or new.created_at is distinct from old.created_at then
    raise exception 'competency_verification_method_version: a version identity cannot be rewritten';
  end if;

  if old.state = 'draft' and new.state = 'draft' then
    new.content_hash := null; new.updated_at := now();
    return new;
  end if;

  if old.state = 'draft' and new.state = 'published' then
    if not public.individual_holds_capability(new.published_by, 'hq.competency.verification.manage') then
      raise exception 'competency_verification_method_version: not authorised to publish. It needs hq.competency.verification.manage';
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

-- Evidence: the person own record, snapshotted now, while the request can still take evidence.
create or replace function public.competency_verification_evidence_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_state text;
  v_snap jsonb;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_evidence is append-only: evidence submitted stays with the request';
  end if;
  if tg_op = 'UPDATE' then
    -- The person removed the source record: its reference clears, and the provenance snapshot stays as submitted.
    if pg_trigger_depth() > 1
       and (new.id, new.request_id, new.user_id, new.kind, new.outcome_indexes, new.provenance, new.created_at)
           is not distinct from (old.id, old.request_id, old.user_id, old.kind, old.outcome_indexes, old.provenance, old.created_at)
       and new.portfolio_link_id is not distinct from old.portfolio_link_id
       and num_nonnulls(new.cpd_id, new.learning_record_id, new.evidence_id, new.profile_item_id, new.reflection_id, new.study_achievement_id) = 0 then
      return new;
    end if;
    raise exception 'competency_verification_evidence is append-only: evidence submitted stays with the request';
  end if;
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

-- The decision: the assigned, appointed, in-scope, independent assessor, against the pinned criteria.
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
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_decision is append-only: a decision is history. Revoke it or decide again on a new request';
  end if;
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1
       and (new.id, new.request_id, new.user_id, new.method_version_id, new.method_content_hash, new.competency_hash, new.outcome_code, new.outcome_class,
            new.level_id, new.criteria_results, new.checklist_results, new.evidence_reviewed, new.rationale, new.valid_from, new.valid_until, new.created_at)
           is not distinct from
           (old.id, old.request_id, old.user_id, old.method_version_id, old.method_content_hash, old.competency_hash, old.outcome_code, old.outcome_class,
            old.level_id, old.criteria_results, old.checklist_results, old.evidence_reviewed, old.rationale, old.valid_from, old.valid_until, old.created_at) then
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

-- ---- the 510 CHECK constraints, verbatim ----

alter table competency_verification_method drop constraint if exists competency_verification_method_check;
alter table competency_verification_method add constraint competency_verification_method_check check (
  code ~ '^[a-z][a-z0-9_]{2,60}$'
  and char_length(btrim(name)) between 3 and 160
  and kind in ('direct_observation', 'simulation', 'portfolio_review', 'practical_assessment', 'oral_assessment',
               'structured_assessment', 'other')
);

alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_check;
alter table competency_verification_evidence add constraint competency_verification_evidence_check check (
  kind in ('cpd', 'learning_record', 'evidence', 'profile_item', 'reflection', 'study_achievement')
  and num_nonnulls(cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, study_achievement_id) <= 1
  and cardinality(outcome_indexes) between 1 and 200
  and -1 <= all(outcome_indexes)
);

-- ---- what 680 added ----

alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_assessor_check;
alter table competency_verification_decision drop constraint if exists competency_verification_decision_component_check;
alter table competency_verification_decision drop column if exists component_outcome;
alter table competency_verification_decision drop column if exists component_results;
alter table competency_verification_evidence drop column if exists assessor_record;
alter table competency_verification_evidence drop column if exists method_version_id;
alter table competency_verification_evidence drop column if exists appointment_id;
alter table competency_verification_evidence drop column if exists recorded_by;
alter table competency_verification_method_version drop column if exists edited_by;
alter table competency_verification_method_version drop column if exists last_edited_by;
drop function if exists public.competency_assessor_record_problem(text, jsonb, jsonb);
drop function if exists public.competency_component_outcome(jsonb, jsonb, integer);
drop function if exists public.competency_method_components(jsonb);

notify pgrst, 'reload schema';
