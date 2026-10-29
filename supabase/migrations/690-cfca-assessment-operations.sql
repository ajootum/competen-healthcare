-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes and replaces two 461 guards and one
-- 510 function. A runner that splits on the statement separator would cut a function in half, so paste and run
-- the entire file at once.
-- ====================================================================================================
-- MIGRATION 690: CCHU COMPETENCY ASSESSMENT OPERATIONS -- METHOD VERSIONS ON THE ONE CLINICAL-APPROVAL PROCESS,
-- CRITERIA PINNED TO THE COMPETENCY, REQUESTS BY PROGRAMME LEADS, SERVER DRAFTS, STAGE AT DECISION, SECOND ASSESSOR
--
-- COMPETEN CCHU Competency Assessment Implementation (owner GO, 29 Oct 2026), Engine B, over ENT-ASMT-REVIEW-01.
-- Phase 1 items 2-3, phase 2 items 6-10, phase 3 item 13. Over 510 (Verification Studio), 680 (components and
-- independent method publication), 395/422/442/461 (the one clinical-approval process), 640 (item-level SoD) and
-- 660/670 (components, stage mappings, criteria).
--
-- APPLY ON STAGING FIRST, AND ONLY AFTER 680. ADDITIVE OR WIDENING. One column and a widened subject CHECK on
-- clinical_content_version, the two 461 review guards REPLACED (their competency, case, resource and learning
-- branches byte-identical to 461, a method branch added), competency_verification_state REPLACED (510 logic kept,
-- confirmation added), nullable or defaulted columns on 510 tables, two new tables, new triggers BESIDE the 510 and
-- 680 guards (never replacing them), one capability and one position. No existing row is changed. Re-running it is a
-- no-op. OPS-001 s8: proposed Medium (replaced shared guards), with a staging rollback rehearsal.
-- DEPENDS ON 395, 422, 442, 461, 510, 640, 641, 660, 670, 680.
--
-- ORDER WITH 461. Like 461 after 442, this file carries every 461 branch of the two review guards unchanged, so it
-- must be applied after 461. A later migration replacing those guards must be based on this file.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
-- A. AUTHORITY. hq.competency.verification.request: ask for a competency assessment for a person, never decide one.
--    New position competency_programme_lead (Competency Programme Lead) holds it with home.view. The Verification
--    Studio Administrator holds it too. Nobody is appointed.
--
-- B. METHOD VERSIONS ON THE ONE CLINICAL-APPROVAL PROCESS (as 422 did for cases). clinical_content_version gains
--    kind method and method_version_id. A draft method version is put forward by an author or editor
--    (competency_method_submit_review). Its hash is md5 of the draft content, the hash 680 gives it on publication.
--    A reviewer holding hq.quality.clinical.approve decides it only when an active scope covers EVERY framework and
--    competency the method applies to, never as its author, editor or submitter or those of any version of the same
--    method, and only while the draft content still has that hash. Higher-risk methods (a safety-critical component)
--    take the governed higher approval count.
--    PUBLICATION REQUIRES THAT APPROVAL. A method version is published only when a review record of its exact
--    content has its approvals and no rejection, in addition to 680 independent publication. A verified or partial
--    decision is accepted only under a clinically approved method version. No switch turns this off.
--
-- C. CRITERIA PINNED TO THE COMPETENCY. A criterion or checklist item may carry criterionId (a competency_skills id,
--    670) and sourceRef. Where it does, its words and component must equal the criterion as the competency now has
--    it, and the criterion must belong to a competency the method applies to. Checked on clinical submission, on
--    publication and on every new request, so a method never drifts from the approved criteria it was made from.
--
-- D. REQUESTS BY A PROGRAMME LEAD. competency_verification_request.requested_by. The person own request names the
--    person. A request for somebody else needs hq.competency.verification.request. The person still adds the
--    evidence, may withdraw, and can never decide it.
--
-- E. SERVER DRAFTS. competency_verification_decision_draft: the assigned assessor own working copy of a decision,
--    saved and resumed on any device. A draft is not a record: it is replaced, and removed when the decision is made.
--
-- F. STAGE AT DECISION. A verified or partial decision states the stage of the PUBLISHED stage mapping (660) of the
--    method scale for the level found, with the mapping and its version pinned. No mapping published: no stage.
--
-- G. SECOND ASSESSOR. A method version may set workflow.secondAssessor. A verified or partial decision under it is
--    then not standing until a second appointed, in-scope assessor, who is neither the person nor the first assessor,
--    confirms it (competency_verification_confirmation). Not confirmed: the decision is set aside and the request is
--    decided again. competency_verification_state gains awaiting_confirmation.
--
-- NOT ACTIVATED. No method published, no reviewer, assessor or programme lead appointed or scoped.
-- RLS: on for the two new tables. The person reads their own confirmations. Drafts have no policy.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA-ASSESS-OPS/ROLLBACK-690.sql
-- ====================================================================================================


-- ---- A. AUTHORITY ---------------------------------------------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.competency.verification.request', 'quality', 'Request competency assessments',
   'Ask for a competency assessment for an eligible person under a published assessment method. Never decide one.')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('competency_programme_lead', 'quality', 'Competency Programme Lead',
   'Educator or programme lead who requests competency assessments for the people on their programme. Cannot assess, configure methods or review content.')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select g.position_code, g.capability_code, 'position_default'
from (values ('competency_programme_lead', 'hq.competency.verification.request'), ('competency_programme_lead', 'hq.platform.home.view'),
             ('competency_verification_administrator', 'hq.competency.verification.request')) as g(position_code, capability_code)
where exists (select 1 from hq_position x where x.code = g.position_code)
  and exists (select 1 from hq_capability y where y.code = g.capability_code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = g.position_code and x.capability_code = g.capability_code and x.effective_to is null
  );


-- ---- C. CRITERIA PINNED TO THE COMPETENCY (used by B and D) ---------------------------------------------

-- null, or why the pinned criteria of this content no longer match the competencies they came from.
create or replace function public.competency_method_criteria_problem(p_content jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_c jsonb;
  v_s record;
begin
  for v_c in select * from jsonb_array_elements(coalesce(p_content -> 'criteria', '[]'::jsonb) || coalesce(p_content -> 'checklist', '[]'::jsonb)) loop
    if coalesce(jsonb_typeof(v_c -> 'criterionId'), 'null') = 'null' then
      continue;
    end if;
    select s.name, s.component_code, s.competency_id, d.framework_id into v_s
      from competency_skills s join framework_competencies c on c.id = s.competency_id join framework_domains d on d.id = c.domain_id
     where s.id::text = v_c ->> 'criterionId';
    if not found then
      return format('criterion %s is no longer a criterion of its competency. Make a new version from the competency', v_c ->> 'id');
    end if;
    if btrim(v_s.name) is distinct from btrim(coalesce(v_c ->> 'text', ''))
       or v_s.component_code is distinct from nullif(v_c ->> 'component', '') then
      return format('criterion %s no longer matches the approved criterion of its competency. Make a new version from the competency', v_c ->> 'id');
    end if;
    if not ((coalesce(p_content #> '{applicability,competencyIds}', '[]'::jsonb)) ? v_s.competency_id::text
            or (coalesce(p_content #> '{applicability,frameworkIds}', '[]'::jsonb)) ? v_s.framework_id::text) then
      return format('criterion %s belongs to a competency this method does not apply to', v_c ->> 'id');
    end if;
  end loop;
  return null;
end
$$;

-- An active clinical reviewer scope of the appointment covers every framework and every competency the method names.
-- A method naming neither cannot be covered.
create or replace function public.competency_method_review_covers(p_appointment uuid, p_content jsonb)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select (jsonb_array_length(coalesce(p_content #> '{applicability,frameworkIds}', '[]'::jsonb))
          + jsonb_array_length(coalesce(p_content #> '{applicability,competencyIds}', '[]'::jsonb))) > 0
     and not exists (
       select 1 from jsonb_array_elements_text(coalesce(p_content #> '{applicability,frameworkIds}', '[]'::jsonb)) x
         left join frameworks f on f.id::text = x
        where f.id is null or not exists (
          select 1 from clinical_reviewer_scope s
           where s.appointment_id = p_appointment and s.ended_at is null
             and ((s.scope_kind = 'framework' and s.scope_ref = f.id)
               or (s.scope_kind = 'profession' and s.scope_ref = f.profession_term_id)
               or (s.scope_kind = 'specialty' and s.scope_ref = f.specialty_term_id))))
     and not exists (
       select 1 from jsonb_array_elements_text(coalesce(p_content #> '{applicability,competencyIds}', '[]'::jsonb)) x
        where not clinical_scope_covers(p_appointment, x::uuid))
$$;

revoke all on function public.competency_method_criteria_problem(jsonb) from public, anon, authenticated;
revoke all on function public.competency_method_review_covers(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.competency_method_criteria_problem(jsonb) to service_role;
grant execute on function public.competency_method_review_covers(uuid, jsonb) to service_role;


-- ---- B. METHOD VERSIONS ON THE ONE CLINICAL-APPROVAL PROCESS ---------------------------------------------

alter table clinical_content_version add column if not exists method_version_id uuid references competency_verification_method_version(id) on delete cascade;
alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and competency_id is not null and case_version_id is null and knowledge_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null and knowledge_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'resource' and knowledge_version_id is not null and competency_id is null and case_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'learning' and learning_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null and method_version_id is null)
      or (content_kind = 'method' and method_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null and learning_version_id is null));
create unique index if not exists ux_clinical_content_version_method_hash on clinical_content_version(method_version_id, content_hash);

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

-- 640 independence for a method: never the author, an editor or the submitter of ANY version of the same method.
-- Beside the 640 guard, which covers the other kinds.
create or replace function public.clinical_review_decision_method_sod_690()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v clinical_content_version%rowtype;
  v_method uuid;
begin
  select * into v from clinical_content_version where id = new.version_id;
  if not found or v.content_kind <> 'method' then
    return new;
  end if;
  select mv.method_id into v_method from competency_verification_method_version mv where mv.id = v.method_version_id;
  if exists (select 1 from competency_verification_method_version mv
              where mv.method_id = v_method and (new.reviewer_id = mv.authored_by or new.reviewer_id = any(mv.edited_by)))
     or exists (select 1 from clinical_content_version o join competency_verification_method_version mv on mv.id = o.method_version_id
              where mv.method_id = v_method and (new.reviewer_id = o.submitted_by or new.reviewer_id = any(o.authored_by)))
     or exists (select 1 from competency_verification_method m where m.id = v_method and m.created_by = new.reviewer_id) then
    raise exception 'clinical_review_decision: not independent. The reviewer authored, edited or submitted this method or an earlier version of it';
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_review_decision_method_sod_690 on clinical_review_decision;
create trigger clinical_review_decision_method_sod_690
  before insert on clinical_review_decision
  for each row execute function public.clinical_review_decision_method_sod_690();

-- Put a draft method version forward for clinical review: by its author or an editor, holding manage, with the
-- governed approval count for its risk (high when a component is safety critical).
create or replace function public.competency_method_submit_review(p_version uuid, p_submitter uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v competency_verification_method_version%rowtype;
  v_risk text;
  v_ccv uuid;
begin
  select * into v from competency_verification_method_version where id = p_version;
  if not found then raise exception 'competency_method_submit_review: unknown version'; end if;
  if v.state <> 'draft' then raise exception 'competency_method_submit_review: only a draft is put forward for clinical review'; end if;
  if p_submitter is null or not (p_submitter = v.authored_by or p_submitter = any(v.edited_by)) then
    raise exception 'competency_method_submit_review: only the author or an editor of the version puts it forward';
  end if;
  if not public.individual_holds_capability(p_submitter, 'hq.competency.verification.manage') then
    raise exception 'competency_method_submit_review: not authorised. It needs hq.competency.verification.manage';
  end if;
  if exists (select 1 from clinical_content_version where method_version_id = v.id and content_hash = md5(v.content::text)) then
    raise exception 'competency_method_submit_review: this exact draft is already with clinical review';
  end if;
  v_risk := case when exists (select 1 from jsonb_array_elements(coalesce(v.content -> 'components', '[]'::jsonb)) k
                               where coalesce((k ->> 'safetyCritical')::boolean, false)) then 'high' else 'standard' end;
  insert into clinical_content_version (content_kind, method_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
    values ('method', v.id, 'computed-by-trigger', '{}'::jsonb, array[p_submitter], p_submitter, hq_sod_required_approvals(v_risk), v_risk || ' risk assessment method')
    returning id into v_ccv;
  return v_ccv;
end;
$$;

-- Approved: a review record of the exact content hash of this method version, with its approvals and no rejection.
create or replace function public.competency_method_clinically_approved(p_version uuid, p_hash text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select p_hash is not null and exists (
    select 1 from clinical_content_version ccv
     where ccv.content_kind = 'method' and ccv.method_version_id = p_version and ccv.content_hash = p_hash
       and not exists (select 1 from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'rejected')
       and (select count(*) from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'approved') >= ccv.required_approvals
  )
$$;

revoke all on function public.competency_method_submit_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.competency_method_clinically_approved(uuid, text) from public, anon, authenticated;
grant execute on function public.competency_method_submit_review(uuid, uuid) to service_role;
grant execute on function public.competency_method_clinically_approved(uuid, text) to service_role;

-- Publication of a method version needs its clinical approval, beside the 680 guard (which runs first and keeps
-- independent publication). Also the pinned criteria, and a second-assessor setting that is true or false.
create or replace function public.competency_verification_method_version_review_690()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_problem text;
begin
  if old.state = 'draft' and new.state = 'published' then
    if coalesce(jsonb_typeof(new.content #> '{workflow,secondAssessor}'), 'null') not in ('boolean', 'null') then
      raise exception 'competency_verification_method_version: cannot publish: the second assessor setting is on or off';
    end if;
    v_problem := public.competency_method_criteria_problem(new.content);
    if v_problem is not null then
      raise exception 'competency_verification_method_version: cannot publish: %', v_problem;
    end if;
    if not public.competency_method_clinically_approved(new.id, md5(new.content::text)) then
      raise exception 'competency_verification_method_version: not clinically approved. Put this exact draft forward for clinical review, and publish it once it is approved';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists competency_verification_method_version_review_690 on competency_verification_method_version;
create trigger competency_verification_method_version_review_690
  before update on competency_verification_method_version
  for each row execute function public.competency_verification_method_version_review_690();


-- ---- D. REQUESTS BY A PROGRAMME LEAD --------------------------------------------------------------------

-- No foreign key: 510 refuses every update of a request, so an on-delete-set-null key would make the requester
-- profile impossible to erase. The guard below checks the requester when the request is made.
alter table competency_verification_request add column if not exists requested_by uuid;

-- Beside the 510 request guard (which runs first). The person, or somebody holding request, and the method still
-- matches the approved criteria it was made from.
create or replace function public.competency_verification_request_guard_690()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_problem text;
begin
  new.requested_by := coalesce(new.requested_by, new.user_id);
  if new.requested_by <> new.user_id and not public.individual_holds_capability(new.requested_by, 'hq.competency.verification.request') then
    raise exception 'competency_verification_request: not authorised. Asking for an assessment for somebody else needs hq.competency.verification.request';
  end if;
  select public.competency_method_criteria_problem(v.content) into v_problem from competency_verification_method_version v where v.id = new.method_version_id;
  if v_problem is not null then
    raise exception 'competency_verification_request: the assessment method is out of date: %', v_problem;
  end if;
  return new;
end;
$$;

drop trigger if exists competency_verification_request_guard_690 on competency_verification_request;
create trigger competency_verification_request_guard_690
  before insert on competency_verification_request
  for each row execute function public.competency_verification_request_guard_690();


-- ---- G (state) and F/G (decision columns) ---------------------------------------------------------------

alter table competency_verification_decision add column if not exists confirmation_required boolean not null default false;
alter table competency_verification_decision add column if not exists stage_code text;
alter table competency_verification_decision add column if not exists stage_label text;
alter table competency_verification_decision add column if not exists stage_mapping_id uuid references competency_stage_mapping(id) on delete restrict;
alter table competency_verification_decision add column if not exists stage_mapping_version integer;

create table if not exists competency_verification_confirmation (
  id              uuid primary key default gen_random_uuid(),
  decision_id     uuid not null,
  request_id      uuid not null,
  user_id         uuid not null references profiles(id) on delete cascade,
  assessor_id     uuid references profiles(id) on delete set null,
  appointment_id  uuid references ogs_office_appointments(id) on delete set null,
  result          text not null,
  rationale       text not null,
  created_at      timestamptz not null default now()
);

alter table competency_verification_confirmation drop constraint if exists competency_verification_confirmation_decision_fk;
alter table competency_verification_confirmation add constraint competency_verification_confirmation_decision_fk
  foreign key (decision_id, request_id) references competency_verification_decision(id, request_id) on delete cascade;
create unique index if not exists ux_competency_verification_confirmation_decision on competency_verification_confirmation(decision_id);
create index if not exists idx_competency_verification_confirmation_request on competency_verification_confirmation(request_id);

alter table competency_verification_confirmation drop constraint if exists competency_verification_confirmation_check;
alter table competency_verification_confirmation add constraint competency_verification_confirmation_check check (
  result in ('confirmed', 'not_confirmed')
  and char_length(btrim(rationale)) between 10 and 2000
);

-- The 510 derivation, with 690 confirmation: a decision a second assessor did not confirm is set aside, and a
-- standing decision awaiting its confirmation leaves the request awaiting_confirmation.
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
  select d.id, d.outcome_class, d.created_at, d.confirmation_required into v_last_decision from competency_verification_decision d
   where d.request_id = p_request
     and not exists (select 1 from competency_verification_confirmation c where c.decision_id = d.id and c.result = 'not_confirmed')
   order by d.created_at desc, d.id desc limit 1;
  if found and v_last_decision.outcome_class <> 'further_evidence' then
    if v_last_decision.confirmation_required
       and not exists (select 1 from competency_verification_confirmation c where c.decision_id = v_last_decision.id) then
      return 'awaiting_confirmation';
    end if;
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

-- Beside the 680 decision guard (which runs first and has set the outcome class, level and component outcome):
-- clinically approved method, confirmation requirement, stage at decision.
create or replace function public.competency_verification_decision_guard_690()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_version competency_verification_method_version%rowtype;
  v_level uuid;
  v_map record;
begin
  select * into v_version from competency_verification_method_version where id = new.method_version_id;
  if new.outcome_class in ('verified', 'partial') and not public.competency_method_clinically_approved(v_version.id, v_version.content_hash) then
    raise exception 'competency_verification_decision: the method version is not clinically approved, so it cannot produce a verification';
  end if;
  new.confirmation_required := new.outcome_class in ('verified', 'partial')
                               and coalesce((v_version.content #>> '{workflow,secondAssessor}')::boolean, false);
  new.stage_code := null; new.stage_label := null; new.stage_mapping_id := null; new.stage_mapping_version := null;
  if new.outcome_class in ('verified', 'partial') then
    v_level := new.level_id;
    if v_level is null and new.component_outcome ? 'overall' and jsonb_typeof(new.component_outcome -> 'overall') = 'number' then
      select l.id into v_level from scoring_levels l
       where l.scale_id::text = v_version.content ->> 'scaleId' and l.score = (new.component_outcome ->> 'overall')::integer limit 1;
    end if;
    if v_level is not null then
      select m.id, m.version, b.stage_code, s.label into v_map
        from competency_stage_mapping m
        join competency_stage_mapping_band b on b.mapping_id = m.id and b.level_id = v_level
        join competency_stage s on s.code = b.stage_code
       where m.scale_id::text = v_version.content ->> 'scaleId' and m.status = 'published'
       order by m.version desc limit 1;
      if found then
        new.stage_code := v_map.stage_code; new.stage_label := v_map.label;
        new.stage_mapping_id := v_map.id; new.stage_mapping_version := v_map.version;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists competency_verification_decision_guard_690 on competency_verification_decision;
create trigger competency_verification_decision_guard_690
  before insert on competency_verification_decision
  for each row execute function public.competency_verification_decision_guard_690();

-- A second assessor confirms, or does not confirm, a decision awaiting confirmation.
create or replace function public.competency_verification_confirmation_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_dec competency_verification_decision%rowtype;
  v_req competency_verification_request%rowtype;
  v_method uuid;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_confirmation is append-only: a confirmation is history';
  end if;
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1
       and (new.id, new.decision_id, new.request_id, new.user_id, new.result, new.rationale, new.created_at)
           is not distinct from (old.id, old.decision_id, old.request_id, old.user_id, old.result, old.rationale, old.created_at) then
      return new;
    end if;
    raise exception 'competency_verification_confirmation is append-only: a confirmation is history';
  end if;
  select * into v_dec from competency_verification_decision where id = new.decision_id and request_id = new.request_id;
  if not found then
    raise exception 'competency_verification_confirmation: unknown decision';
  end if;
  select * into v_req from competency_verification_request where id = v_dec.request_id;
  new.user_id := v_req.user_id;
  if not v_dec.confirmation_required then
    raise exception 'competency_verification_confirmation: this decision does not need a second assessor';
  end if;
  if public.competency_verification_state(v_dec.request_id) <> 'awaiting_confirmation' then
    raise exception 'competency_verification_confirmation: the request is not awaiting confirmation';
  end if;
  if exists (select 1 from competency_verification_event where decision_id = v_dec.id and event = 'revoked') then
    raise exception 'competency_verification_confirmation: that outcome is revoked';
  end if;
  if new.assessor_id is null or new.assessor_id = v_req.user_id or new.assessor_id = v_dec.assessor_id then
    raise exception 'competency_verification_confirmation: not independent. The second assessor is neither the person nor the first assessor';
  end if;
  if not public.competency_appointment_holds(new.appointment_id, new.assessor_id, 'hq.competency.verification.assess') then
    raise exception 'competency_verification_confirmation: not authorised. The appointment must be the assessor own, active, and hold hq.competency.verification.assess';
  end if;
  select method_id into v_method from competency_verification_method_version where id = v_dec.method_version_id;
  if not public.competency_assessor_covers(new.appointment_id, v_req.competency_id, v_method, coalesce(v_dec.level_id, v_req.target_level_id), v_req.context, current_date) then
    raise exception 'competency_verification_confirmation: out of scope. No live scope of this appointment covers this competency, method, level and context';
  end if;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists competency_verification_confirmation_guard on competency_verification_confirmation;
create trigger competency_verification_confirmation_guard before insert or update or delete on competency_verification_confirmation
  for each row execute function public.competency_verification_confirmation_guard();


-- ---- E. SERVER DRAFTS -----------------------------------------------------------------------------------

create table if not exists competency_verification_decision_draft (
  request_id      uuid not null references competency_verification_request(id) on delete cascade,
  assessor_id     uuid not null references profiles(id) on delete cascade,
  appointment_id  uuid not null references ogs_office_appointments(id) on delete cascade,
  content         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (request_id, assessor_id)
);

alter table competency_verification_decision_draft drop constraint if exists competency_verification_decision_draft_check;
alter table competency_verification_decision_draft add constraint competency_verification_decision_draft_check check (
  jsonb_typeof(content) = 'object' and pg_column_size(content) <= 262144
);

-- Only the assessor the request is assigned to, under that appointment, while it is with them. Removing is free.
create or replace function public.competency_verification_decision_draft_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_assigned record;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.request_id is distinct from old.request_id or new.assessor_id is distinct from old.assessor_id) then
    raise exception 'competency_verification_decision_draft: a draft belongs to one request and one assessor';
  end if;
  if public.competency_verification_state(new.request_id) <> 'assigned' then
    raise exception 'competency_verification_decision_draft: the request is not with an assessor now';
  end if;
  select assessor_id, appointment_id into v_assigned from competency_verification_event
   where request_id = new.request_id and event = 'assigned' order by created_at desc, id desc limit 1;
  if v_assigned.assessor_id is distinct from new.assessor_id or v_assigned.appointment_id is distinct from new.appointment_id then
    raise exception 'competency_verification_decision_draft: not the assigned assessor. Only the assessor assigned keeps a draft';
  end if;
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists competency_verification_decision_draft_guard on competency_verification_decision_draft;
create trigger competency_verification_decision_draft_guard before insert or update or delete on competency_verification_decision_draft
  for each row execute function public.competency_verification_decision_draft_guard();

-- The decision is the record: its working drafts go when it is made.
create or replace function public.competency_verification_decision_clears_drafts()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  delete from competency_verification_decision_draft where request_id = new.request_id;
  return null;
end;
$$;

drop trigger if exists competency_verification_decision_clears_drafts on competency_verification_decision;
create trigger competency_verification_decision_clears_drafts after insert on competency_verification_decision
  for each row execute function public.competency_verification_decision_clears_drafts();


-- ---- RLS ------------------------------------------------------------------------------------------------

alter table competency_verification_confirmation enable row level security;
alter table competency_verification_decision_draft enable row level security;
drop policy if exists competency_verification_confirmation_read_own on competency_verification_confirmation;
create policy competency_verification_confirmation_read_own on competency_verification_confirmation for select using (auth.uid() = user_id);

comment on column clinical_content_version.method_version_id is
  '690. A draft assessment method version put forward for clinical review. Its hash is md5 of the draft content, the hash 680 publishes it with.';
comment on column competency_verification_request.requested_by is
  '690. Who asked for the assessment: the person, or somebody holding hq.competency.verification.request.';
comment on column competency_verification_decision.stage_code is
  '690. The stage of the published stage mapping of the method scale for the level found, pinned with stage_mapping_id and its version.';
comment on table competency_verification_confirmation is
  '690. A second assessor confirmation of a decision whose method requires one. Not confirmed: the decision is set aside. Append-only.';
comment on table competency_verification_decision_draft is
  '690. The assigned assessor working copy of a decision. Not a record: replaced freely, removed when the decision is made.';


-- ---- VERIFICATION -----------------------------------------------------------------------------------

select 'subject_kinds_690' as item, (pg_get_constraintdef(c.oid) like '%method_version_id is not null%')::text as value
  from pg_constraint c where c.conname = 'clinical_content_version_subject_check'
union all select 'request_capability', count(*)::text from hq_capability where code = 'hq.competency.verification.request'
union all select 'programme_lead_grants', count(*)::text from hq_position_capability where position_code = 'competency_programme_lead' and effective_to is null
union all select 'triggers_690', count(*)::text from pg_trigger where tgname in ('competency_verification_method_version_review_690', 'competency_verification_request_guard_690',
  'competency_verification_decision_guard_690', 'competency_verification_decision_clears_drafts', 'competency_verification_confirmation_guard',
  'competency_verification_decision_draft_guard', 'clinical_review_decision_method_sod_690')
union all select 'published_methods', count(*)::text from competency_verification_method_version where state = 'published'
union all select 'method_reviews', count(*)::text from clinical_content_version where content_kind = 'method';

notify pgrst, 'reload schema';
