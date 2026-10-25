-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql function bodies between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 510: COMPETEN HOLDINGS COMPETENCY VERIFICATION STUDIO (C5)
--
-- COMPETEN-PROFESSIONAL-COMPETENCY-01, Stage 5, C5 (owner GO, P0). A REUSABLE Holdings capability, not a
-- Professional-only workflow. Development and staging authorised. Production, real assessor appointments and
-- the activation of competency verification each need a separate owner GO.
-- Build record: docs/evidence/COMPETEN-PROFESSIONAL-COMPETENCY-01/510-build-record.md
--
-- DEPENDS ON 264 (hq_capability, hq_position, hq_position_capability), 117 (ogs_office_appointments,
-- ogs_offices), 451 (individual_holds_capability), 395 (competency_content_hash), 384 (learning_outcomes,
-- scoring_levels as the CFCA proficiency scale), 007 (scoring_scales, scoring_levels), 013 (taxonomy_terms),
-- 373 and 393 (individual_professional_cpd and _evidence with their (id, user_id) keys), 450
-- (individual_professional_profile_item), 470 (individual_professional_reflection), 462 (learning_record) and 375
-- (individual_scholar_passport_item).
-- Additive. Re-running it is a no-op. It appoints NOBODY and grants its capabilities to NO existing position.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
--   AUTHORITY. Two capabilities, each held only by a NEW position:
--     hq.competency.verification.manage   Verification Studio Administrator: assessment methods, their
--                                          criteria and versions, assessor scopes, assignment, revocation
--     hq.competency.verification.assess   Competency Assessor: decide assigned verifications in scope
--   Competency Assessor is NOT Clinical Content Reviewer. Approving competency content (395) authorises no
--   verification of a person, and 511 adds the separation-of-duties pairs to the 500 guard.
--
--   CONFIGURATION, NO CODE. competency_verification_method (a named method of a kind) and its VERSIONS. A
--   version holds the whole criteria as data: where it applies (profession, specialty, framework, competency,
--   context), the CFCA proficiency scale and levels, the outcomes offered (each of a fixed class), the rubric
--   criteria, the checklist, the evidence required, the workflow (who assigns), validity and reassessment.
--   A version is edited only as a draft. Published, it never changes, so every decision pins the exact
--   criteria it applied. A newer published version retires the older one.
--
--   ASSESSOR SCOPE. competency_assessor_scope, per APPOINTMENT, as 395 scopes a clinical reviewer: what it
--   covers (profession, specialty, framework, domain or competency) and what narrows it (method, highest
--   level, context), with its own validity dates. Granted by a Studio Administrator, never by the assessor.
--
--   THE WORKFLOW, AS RECORDS. A request (one person, one competency, one published method version, the
--   outcomes and level asked about), the evidence the person attaches (references to their OWN records with
--   a provenance snapshot taken by the trigger), events (assigned, assignment declined, withdrawn, revoked)
--   and decisions. All append-only. State is derived from them, never stored and never rewritten.
--
-- THE INTEGRITY CONTROLS (F). Enforced here, by trigger, for every writer. No configuration can remove them.
--   no self-verification            an assessor never decides, and nobody assigns, a request of their own
--   valid appointment and scope     the decision names the assessor own ACTIVE appointment, whose position
--                                   holds assess today, and a live scope of it covers the competency, the
--                                   method, the level and the context
--   independent decision authority  only the assigned assessor decides. Assignment needs manage (or the
--                                   method allows the assessor to claim). Scope is granted by manage, not
--                                   by the assessor
--   evidence provenance             evidence is the person own record by composite key, snapshotted on insert
--   criteria and version            the decision is bound to the published version and its content hash, and
--                                   must answer every required criterion and critical checklist item
--   immutable history               no UPDATE or DELETE except the cascade path (pg_trigger_depth() > 1)
--   privacy and access              RLS on, own-row read for the person. Assessors read through the server
--   revocation and expiry           validity is computed from the version, revocation is a new event with a
--                                   reason, and only a standing decision can be revoked
--   content approval apart          the stale check (395 hash) refuses a decision on content that changed
--                                   since the request. Approval and assessment are separate capabilities
--
-- NOT REUSED, AND WHY. assessment_method_configs, assessment_requests and competency_assessments (007, 177,
-- 003) are hospital-scoped, mutable, hard-code their methods and are read by hospital analytics. Holdings
-- verification of an individual cannot live in rows an employer reads or can rewrite.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. RLS on with own-row SELECT only. Append-only with the cascade allowance. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-COMPETENCY-01/ROLLBACK-510.sql
-- ====================================================================================================


-- ---- 1. AUTHORITY: TWO CAPABILITIES, TWO NEW POSITIONS, NO APPOINTMENT ----------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.competency.verification.manage', 'quality', 'Competency verification studio',
   'Define competency assessment methods, their criteria and versions, scope competency assessors, assign verification requests and revoke decisions. Never decide one.'),
  ('hq.competency.verification.assess', 'quality', 'Competency assessment',
   'Decide competency verification requests assigned to you, within the scope of your appointment. Never your own, and never content approval.')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('competency_verification_administrator', 'quality', 'Verification Studio Administrator',
   'Configures competency assessment methods and criteria, scopes competency assessors and assigns requests. Cannot assess.'),
  ('competency_assessor', 'quality', 'Competency Assessor',
   'Assesses the competency verification requests assigned to them, within the scope of their appointment. Separate from clinical content review.')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('competency_verification_administrator')) as p(code)
cross join (values ('hq.competency.verification.manage'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('competency_assessor')) as p(code)
cross join (values ('hq.competency.verification.assess'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- ---- 2. METHODS AND THEIR VERSIONS (configuration as data) ---------------------------------------------

create table if not exists competency_verification_method (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  kind        text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table competency_verification_method drop constraint if exists competency_verification_method_check;
alter table competency_verification_method add constraint competency_verification_method_check check (
  code ~ '^[a-z][a-z0-9_]{2,60}$'
  and char_length(btrim(name)) between 3 and 160
  and kind in ('direct_observation', 'simulation', 'portfolio_review', 'practical_assessment', 'oral_assessment',
               'structured_assessment', 'other')
);

create table if not exists competency_verification_method_version (
  id            uuid primary key default gen_random_uuid(),
  method_id     uuid not null references competency_verification_method(id) on delete cascade,
  version_no    integer not null,
  state         text not null default 'draft',
  content       jsonb not null default '{}'::jsonb,
  content_hash  text,
  authored_by   uuid references profiles(id) on delete set null,
  published_by  uuid references profiles(id) on delete set null,
  published_at  timestamptz,
  retired_by    uuid references profiles(id) on delete set null,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists ux_competency_verification_method_version_no
  on competency_verification_method_version(method_id, version_no);

alter table competency_verification_method_version drop constraint if exists competency_verification_method_version_check;
alter table competency_verification_method_version add constraint competency_verification_method_version_check check (
  version_no >= 1
  and state in ('draft', 'published', 'retired')
  and jsonb_typeof(content) = 'object'
  and (state = 'draft' or (content_hash is not null and published_at is not null))
  and (state <> 'retired' or retired_at is not null)
);


-- ---- 3. ASSESSOR SCOPE, PER APPOINTMENT ----------------------------------------------------------------

create table if not exists competency_assessor_scope (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references ogs_office_appointments(id) on delete cascade,
  scope_kind      text not null,
  scope_ref       uuid,
  scope_value     text,
  valid_from      date not null default current_date,
  valid_until     date,
  granted_by      uuid references profiles(id) on delete set null,
  grant_reason    text,
  created_at      timestamptz not null default now(),
  ended_at        timestamptz,
  ended_by        uuid references profiles(id) on delete set null,
  end_reason      text
);

create index if not exists idx_competency_assessor_scope_appointment on competency_assessor_scope(appointment_id);

alter table competency_assessor_scope drop constraint if exists competency_assessor_scope_check;
alter table competency_assessor_scope add constraint competency_assessor_scope_check check (
  scope_kind in ('profession', 'specialty', 'framework', 'domain', 'competency', 'method', 'max_level', 'context')
  and ((scope_kind = 'context') = (scope_value is not null))
  and ((scope_kind = 'context') = (scope_ref is null))
  and (scope_value is null or scope_value ~ '^[a-z][a-z0-9_]{1,40}$')
  and (valid_until is null or valid_until >= valid_from)
  and (ended_at is null or char_length(btrim(coalesce(end_reason, ''))) between 3 and 500)
  and char_length(coalesce(grant_reason, '')) <= 500
);


-- ---- 4. REQUESTS, EVIDENCE, EVENTS AND DECISIONS -------------------------------------------------------

create table if not exists competency_verification_request (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  competency_id      uuid not null references framework_competencies(id) on delete restrict,
  method_version_id  uuid not null references competency_verification_method_version(id) on delete restrict,
  outcome_indexes    integer[] not null default '{-1}',
  target_level_id    uuid references scoring_levels(id) on delete restrict,
  context            text not null default 'independent',
  note               text,
  renews_decision_id uuid,
  competency_hash    text,
  competency_snapshot jsonb,
  framework_id       uuid,
  framework_version  text,
  created_at         timestamptz not null default now()
);

create unique index if not exists ux_competency_verification_request_id_user on competency_verification_request(id, user_id);
create index if not exists idx_competency_verification_request_user on competency_verification_request(user_id, created_at desc);
create index if not exists idx_competency_verification_request_competency on competency_verification_request(competency_id);

alter table competency_verification_request drop constraint if exists competency_verification_request_check;
alter table competency_verification_request add constraint competency_verification_request_check check (
  cardinality(outcome_indexes) between 1 and 200
  and -1 <= all(outcome_indexes)
  and context ~ '^[a-z][a-z0-9_]{1,40}$'
  and char_length(coalesce(note, '')) <= 2000
);

create table if not exists competency_verification_evidence (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null,
  user_id            uuid not null references profiles(id) on delete cascade,
  kind               text not null,
  cpd_id             uuid,
  learning_record_id uuid,
  evidence_id        uuid,
  profile_item_id    uuid,
  reflection_id      uuid,
  study_achievement_id uuid,
  portfolio_link_id  uuid,
  outcome_indexes    integer[] not null default '{-1}',
  provenance         jsonb,
  created_at         timestamptz not null default now()
);

alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_request_fk;
alter table competency_verification_evidence add constraint competency_verification_evidence_request_fk
  foreign key (request_id, user_id) references competency_verification_request(id, user_id) on delete cascade;
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_cpd_fk;
alter table competency_verification_evidence add constraint competency_verification_evidence_cpd_fk
  foreign key (cpd_id, user_id) references individual_professional_cpd(id, user_id) on delete set null (cpd_id);
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_learning_fk;
alter table competency_verification_evidence add constraint competency_verification_evidence_learning_fk
  foreign key (learning_record_id, user_id) references learning_record(id, user_id) on delete set null (learning_record_id);
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_evidence_fk;
alter table competency_verification_evidence add constraint competency_verification_evidence_evidence_fk
  foreign key (evidence_id, user_id) references individual_professional_evidence(id, user_id) on delete set null (evidence_id);
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_item_fk;
alter table competency_verification_evidence add constraint competency_verification_evidence_item_fk
  foreign key (profile_item_id, user_id) references individual_professional_profile_item(id, user_id) on delete set null (profile_item_id);
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_reflection_fk;
alter table competency_verification_evidence add constraint competency_verification_evidence_reflection_fk
  foreign key (reflection_id, user_id) references individual_professional_reflection(id, user_id) on delete set null (reflection_id);

-- A Scholar Passport achievement (375) has no (id, user_id) key, so the trigger checks that it is the person own.
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_study_fk;
alter table competency_verification_evidence add constraint competency_verification_evidence_study_fk
  foreign key (study_achievement_id) references individual_scholar_passport_item(id) on delete set null;

create index if not exists idx_competency_verification_evidence_request on competency_verification_evidence(request_id, created_at);

alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_check;
alter table competency_verification_evidence add constraint competency_verification_evidence_check check (
  kind in ('cpd', 'learning_record', 'evidence', 'profile_item', 'reflection', 'study_achievement')
  and num_nonnulls(cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, study_achievement_id) <= 1
  and cardinality(outcome_indexes) between 1 and 200
  and -1 <= all(outcome_indexes)
);

create table if not exists competency_verification_event (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null,
  user_id         uuid not null references profiles(id) on delete cascade,
  event           text not null,
  actor_id        uuid references profiles(id) on delete set null,
  assessor_id     uuid references profiles(id) on delete set null,
  appointment_id  uuid references ogs_office_appointments(id) on delete set null,
  decision_id     uuid,
  reason          text,
  created_at      timestamptz not null default now()
);

alter table competency_verification_event drop constraint if exists competency_verification_event_request_fk;
alter table competency_verification_event add constraint competency_verification_event_request_fk
  foreign key (request_id, user_id) references competency_verification_request(id, user_id) on delete cascade;
create index if not exists idx_competency_verification_event_request on competency_verification_event(request_id, created_at);

alter table competency_verification_event drop constraint if exists competency_verification_event_check;
alter table competency_verification_event add constraint competency_verification_event_check check (
  event in ('assigned', 'assignment_declined', 'withdrawn', 'revoked')
  and ((event = 'assigned') = (assessor_id is not null and appointment_id is not null))
  and ((event = 'revoked') = (decision_id is not null))
  and (event not in ('revoked', 'assignment_declined') or char_length(btrim(coalesce(reason, ''))) between 3 and 1000)
  and char_length(coalesce(reason, '')) <= 1000
);

create table if not exists competency_verification_decision (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null,
  user_id              uuid not null references profiles(id) on delete cascade,
  assessor_id          uuid references profiles(id) on delete set null,
  appointment_id       uuid references ogs_office_appointments(id) on delete set null,
  method_version_id    uuid not null references competency_verification_method_version(id) on delete restrict,
  method_content_hash  text,
  competency_hash      text,
  outcome_code         text not null,
  outcome_class        text,
  outcome_label        text,
  level_id             uuid references scoring_levels(id) on delete restrict,
  criteria_results     jsonb not null default '[]'::jsonb,
  checklist_results    jsonb not null default '[]'::jsonb,
  evidence_reviewed    uuid[] not null default '{}',
  rationale            text not null,
  valid_from           date,
  valid_until          date,
  created_at           timestamptz not null default now()
);

alter table competency_verification_decision drop constraint if exists competency_verification_decision_request_fk;
alter table competency_verification_decision add constraint competency_verification_decision_request_fk
  foreign key (request_id, user_id) references competency_verification_request(id, user_id) on delete cascade;
create unique index if not exists ux_competency_verification_decision_id_request on competency_verification_decision(id, request_id);
create index if not exists idx_competency_verification_decision_request on competency_verification_decision(request_id, created_at);
create index if not exists idx_competency_verification_decision_user on competency_verification_decision(user_id, created_at desc);

alter table competency_verification_event drop constraint if exists competency_verification_event_decision_fk;
alter table competency_verification_event add constraint competency_verification_event_decision_fk
  foreign key (decision_id, request_id) references competency_verification_decision(id, request_id) on delete cascade;

alter table competency_verification_request drop constraint if exists competency_verification_request_renews_fk;
alter table competency_verification_request add constraint competency_verification_request_renews_fk
  foreign key (renews_decision_id) references competency_verification_decision(id) on delete restrict;

alter table competency_verification_decision drop constraint if exists competency_verification_decision_check;
alter table competency_verification_decision add constraint competency_verification_decision_check check (
  outcome_code ~ '^[a-z][a-z0-9_]{1,40}$'
  and (outcome_class is null or outcome_class in ('verified', 'partial', 'further_evidence', 'not_demonstrated', 'unable_to_determine'))
  and jsonb_typeof(criteria_results) = 'array'
  and jsonb_typeof(checklist_results) = 'array'
  and char_length(btrim(rationale)) between 10 and 4000
  and (valid_until is null or valid_from is not null)
);


-- ---- 5. PREDICATES ------------------------------------------------------------------------------------

-- The appointment is the person own, active, in a usable office, and its position holds the capability now.
create or replace function public.competency_appointment_holds(p_appointment uuid, p_person uuid, p_capability text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select p_appointment is not null and p_person is not null and exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.id = p_appointment
       and a.person_id = p_person
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = p_capability
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
  )
$$;

-- A method version applies to a competency in a context. Empty lists mean no restriction of that kind.
create or replace function public.competency_method_applies(p_content jsonb, p_competency uuid, p_context text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from framework_competencies c
      join framework_domains d on d.id = c.domain_id
      join frameworks f on f.id = d.framework_id
     where c.id = p_competency
       and (coalesce(jsonb_array_length(p_content #> '{applicability,frameworkIds}'), 0) = 0
            or (p_content #> '{applicability,frameworkIds}') ? f.id::text)
       and (coalesce(jsonb_array_length(p_content #> '{applicability,competencyIds}'), 0) = 0
            or (p_content #> '{applicability,competencyIds}') ? c.id::text)
       and (coalesce(jsonb_array_length(p_content #> '{applicability,professionTermIds}'), 0) = 0
            or (p_content #> '{applicability,professionTermIds}') ? coalesce(f.profession_term_id::text, '-'))
       and (coalesce(jsonb_array_length(p_content #> '{applicability,specialtyTermIds}'), 0) = 0
            or (p_content #> '{applicability,specialtyTermIds}') ? coalesce(f.specialty_term_id::text, '-'))
       and (coalesce(jsonb_array_length(p_content #> '{applicability,contexts}'), 0) = 0
            or (p_content #> '{applicability,contexts}') ? p_context)
  )
$$;

-- A live scope of the appointment covers the competency, and every narrowing kind present allows the method,
-- the level and the context, on the day.
create or replace function public.competency_assessor_covers(p_appointment uuid, p_competency uuid, p_method uuid,
  p_level uuid, p_context text, p_on date)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  with live as (
    select * from competency_assessor_scope s
     where s.appointment_id = p_appointment and s.ended_at is null
       and s.valid_from <= p_on and (s.valid_until is null or s.valid_until >= p_on)
  ), comp as (
    select c.id, d.id as domain_id, f.id as framework_id, f.profession_term_id, f.specialty_term_id
      from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
     where c.id = p_competency
  )
  select exists (
      select 1 from live s, comp
       where (s.scope_kind = 'profession' and s.scope_ref = comp.profession_term_id)
          or (s.scope_kind = 'specialty' and s.scope_ref = comp.specialty_term_id)
          or (s.scope_kind = 'framework' and s.scope_ref = comp.framework_id)
          or (s.scope_kind = 'domain' and s.scope_ref = comp.domain_id)
          or (s.scope_kind = 'competency' and s.scope_ref = comp.id))
    and (not exists (select 1 from live where scope_kind = 'method')
         or exists (select 1 from live where scope_kind = 'method' and scope_ref = p_method))
    and (not exists (select 1 from live where scope_kind = 'context')
         or exists (select 1 from live where scope_kind = 'context' and scope_value = p_context))
    and (p_level is null or not exists (select 1 from live where scope_kind = 'max_level')
         or exists (select 1 from live s join scoring_levels mx on mx.id = s.scope_ref join scoring_levels lv on lv.id = p_level
                     where s.scope_kind = 'max_level' and lv.scale_id = mx.scale_id and lv.score <= mx.score))
$$;

-- The derived state of a request: withdrawn, decided (a final outcome), awaiting_evidence (further evidence was
-- asked for and none has arrived since), assigned or open.
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

revoke all on function public.competency_appointment_holds(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.competency_method_applies(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.competency_assessor_covers(uuid, uuid, uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.competency_verification_state(uuid) from public, anon, authenticated;
grant execute on function public.competency_appointment_holds(uuid, uuid, text) to service_role;
grant execute on function public.competency_method_applies(jsonb, uuid, text) to service_role;
grant execute on function public.competency_assessor_covers(uuid, uuid, uuid, uuid, text, date) to service_role;
grant execute on function public.competency_verification_state(uuid) to service_role;


-- ---- 6. GUARDS: METHODS, VERSIONS AND SCOPES ------------------------------------------------------------

create or replace function public.competency_verification_method_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_method: a method is part of the record. Retire its versions instead';
  end if;
  if tg_op = 'UPDATE' then
    -- The foreign key clearing created_by when that profile is erased.
    if pg_trigger_depth() > 1 and old.created_by is not null and new.created_by is null
       and (new.id, new.code, new.name, new.kind, new.created_at) is not distinct from (old.id, old.code, old.name, old.kind, old.created_at) then
      return new;
    end if;
    if new.code is distinct from old.code or new.kind is distinct from old.kind or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'competency_verification_method: a method code, kind and origin cannot be rewritten';
    end if;
    return new;
  end if;
  if not public.individual_holds_capability(new.created_by, 'hq.competency.verification.manage') then
    raise exception 'competency_verification_method: not authorised. It needs an active appointment holding hq.competency.verification.manage';
  end if;
  new.created_at := now();
  return new;
end
$$;

drop trigger if exists competency_verification_method_guard on competency_verification_method;
create trigger competency_verification_method_guard before insert or update or delete on competency_verification_method
  for each row execute function public.competency_verification_method_guard();

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

create or replace function public.competency_assessor_scope_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_person uuid;
  v_role text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_assessor_scope: a scope is part of the record. End it instead';
  end if;
  if tg_op = 'UPDATE' then
    -- The foreign keys clearing granted_by or ended_by when that profile is erased.
    if pg_trigger_depth() > 1
       and (new.id, new.appointment_id, new.scope_kind, new.scope_ref, new.scope_value, new.valid_from, new.valid_until, new.grant_reason, new.created_at, new.ended_at, new.end_reason)
           is not distinct from
           (old.id, old.appointment_id, old.scope_kind, old.scope_ref, old.scope_value, old.valid_from, old.valid_until, old.grant_reason, old.created_at, old.ended_at, old.end_reason)
       and (new.granted_by is null or new.granted_by = old.granted_by)
       and (new.ended_by is null or new.ended_by = old.ended_by) then
      return new;
    end if;
    if (new.id, new.appointment_id, new.scope_kind, new.scope_ref, new.scope_value, new.valid_from, new.valid_until, new.granted_by, new.grant_reason, new.created_at)
       is distinct from
       (old.id, old.appointment_id, old.scope_kind, old.scope_ref, old.scope_value, old.valid_from, old.valid_until, old.granted_by, old.grant_reason, old.created_at) then
      raise exception 'competency_assessor_scope: a scope is never rewritten. End it and grant another';
    end if;
    if old.ended_at is not null then
      raise exception 'competency_assessor_scope: this scope has ended and is kept as history';
    end if;
    if new.ended_at is not null then
      if not public.individual_holds_capability(new.ended_by, 'hq.competency.verification.manage') then
        raise exception 'competency_assessor_scope: not authorised to end a scope. It needs hq.competency.verification.manage';
      end if;
    end if;
    return new;
  end if;

  select a.person_id, a.role into v_person, v_role from ogs_office_appointments a where a.id = new.appointment_id;
  if not found then
    raise exception 'competency_assessor_scope: unknown appointment';
  end if;
  if not public.competency_appointment_holds(new.appointment_id, v_person, 'hq.competency.verification.assess') then
    raise exception 'competency_assessor_scope: the appointment must be active and its position must hold hq.competency.verification.assess';
  end if;
  if not public.individual_holds_capability(new.granted_by, 'hq.competency.verification.manage') then
    raise exception 'competency_assessor_scope: not authorised. A scope is granted by an active appointment holding hq.competency.verification.manage';
  end if;
  if new.granted_by = v_person then
    raise exception 'competency_assessor_scope: not independent. An assessor cannot scope their own appointment';
  end if;
  if new.scope_kind in ('profession', 'specialty') and not exists (
    select 1 from taxonomy_terms t join taxonomies x on x.id = t.taxonomy_id where t.id = new.scope_ref and x.kind = new.scope_kind) then
    raise exception 'competency_assessor_scope: % must be a % taxonomy term', new.scope_ref, new.scope_kind;
  end if;
  if new.scope_kind = 'framework' and not exists (select 1 from frameworks f where f.id = new.scope_ref and f.hospital_id is null) then
    raise exception 'competency_assessor_scope: the framework must be a shared framework';
  end if;
  if new.scope_kind = 'domain' and not exists (
    select 1 from framework_domains d join frameworks f on f.id = d.framework_id where d.id = new.scope_ref and f.hospital_id is null) then
    raise exception 'competency_assessor_scope: the domain must belong to a shared framework';
  end if;
  if new.scope_kind = 'competency' and not exists (
    select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
     where c.id = new.scope_ref and f.hospital_id is null) then
    raise exception 'competency_assessor_scope: the competency must belong to a shared framework';
  end if;
  if new.scope_kind = 'method' and not exists (select 1 from competency_verification_method m where m.id = new.scope_ref) then
    raise exception 'competency_assessor_scope: unknown assessment method';
  end if;
  if new.scope_kind = 'max_level' and not exists (select 1 from scoring_levels l where l.id = new.scope_ref) then
    raise exception 'competency_assessor_scope: unknown proficiency level';
  end if;
  new.created_at := now(); new.ended_at := null; new.ended_by := null; new.end_reason := null;
  return new;
end
$$;

drop trigger if exists competency_assessor_scope_guard on competency_assessor_scope;
create trigger competency_assessor_scope_guard before insert or update or delete on competency_assessor_scope
  for each row execute function public.competency_assessor_scope_guard();


-- ---- 7. GUARDS: THE WORKFLOW RECORDS --------------------------------------------------------------------

create or replace function public.competency_verification_request_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_version competency_verification_method_version%rowtype;
  v_fw record;
  v_outcomes integer;
  v_renews record;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_request is append-only: withdraw it instead';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'competency_verification_request is append-only: add evidence or an event instead';
  end if;

  -- The framework version is the governed major.minor.revision (012), composed as the catalogue shows it.
  select f.id, concat(coalesce(f.version_major, 1), '.', coalesce(f.version_minor, 0), '.', coalesce(f.version_revision, 0)) as version,
         f.hospital_id, f.pub_status, f.is_active, jsonb_array_length(c.learning_outcomes) as n
    into v_fw
    from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks f on f.id = d.framework_id
   where c.id = new.competency_id;
  if not found then
    raise exception 'competency_verification_request: unknown competency';
  end if;
  if v_fw.hospital_id is not null or v_fw.pub_status is distinct from 'published' or v_fw.is_active is false then
    raise exception 'competency_verification_request: only a competency of a published, shared framework can be verified';
  end if;
  if exists (select 1 from unnest(new.outcome_indexes) i where i >= coalesce(v_fw.n, 0)) then
    raise exception 'competency_verification_request: a learning outcome named is not one of this competency';
  end if;

  select * into v_version from competency_verification_method_version where id = new.method_version_id;
  if not found or v_version.state <> 'published' then
    raise exception 'competency_verification_request: the assessment method version must be published';
  end if;
  if not public.competency_method_applies(v_version.content, new.competency_id, new.context) then
    raise exception 'competency_verification_request: this assessment method does not apply to this competency in this context';
  end if;
  if new.target_level_id is not null and not exists (
    select 1 from scoring_levels l where l.id = new.target_level_id and l.scale_id::text = v_version.content ->> 'scaleId') then
    raise exception 'competency_verification_request: the level asked for is not on the proficiency scale of the method';
  end if;
  if new.renews_decision_id is not null then
    select d.user_id, r.competency_id, d.outcome_class into v_renews
      from competency_verification_decision d join competency_verification_request r on r.id = d.request_id
     where d.id = new.renews_decision_id;
    if not found or v_renews.user_id <> new.user_id or v_renews.competency_id <> new.competency_id or v_renews.outcome_class <> 'verified' then
      raise exception 'competency_verification_request: a renewal names an earlier verification of the same person and competency';
    end if;
  end if;

  new.competency_hash := competency_content_hash(new.competency_id);
  new.competency_snapshot := (
    select jsonb_build_object('name', c.name, 'code', c.code, 'learning_outcomes', c.learning_outcomes, 'expected_level_id', c.expected_level_id)
      from framework_competencies c where c.id = new.competency_id);
  new.framework_id := v_fw.id;
  new.framework_version := v_fw.version;
  new.created_at := now();
  return new;
end
$$;

drop trigger if exists competency_verification_request_guard on competency_verification_request;
create trigger competency_verification_request_guard before insert or update or delete on competency_verification_request
  for each row execute function public.competency_verification_request_guard();

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

create or replace function public.competency_verification_event_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare
  v_req competency_verification_request%rowtype;
  v_version competency_verification_method_version%rowtype;
  v_state text;
  v_assigned record;
  v_dec record;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'competency_verification_event is append-only: add a new event instead';
  end if;
  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1
       and (new.id, new.request_id, new.user_id, new.event, new.decision_id, new.reason, new.created_at)
           is not distinct from (old.id, old.request_id, old.user_id, old.event, old.decision_id, old.reason, old.created_at) then
      return new;
    end if;
    raise exception 'competency_verification_event is append-only: add a new event instead';
  end if;

  select * into v_req from competency_verification_request where id = new.request_id and user_id = new.user_id;
  if not found then
    raise exception 'competency_verification_event: unknown request';
  end if;
  select * into v_version from competency_verification_method_version where id = v_req.method_version_id;
  v_state := public.competency_verification_state(new.request_id);

  if new.event = 'withdrawn' then
    if new.actor_id is distinct from v_req.user_id then
      raise exception 'competency_verification_event: only the person can withdraw their request';
    end if;
    if v_state in ('withdrawn', 'decided') then
      raise exception 'competency_verification_event: a % request cannot be withdrawn', v_state;
    end if;

  elsif new.event = 'assigned' then
    if v_state not in ('open', 'assigned') then
      raise exception 'competency_verification_event: a % request cannot be assigned', v_state;
    end if;
    if new.assessor_id = v_req.user_id or new.actor_id = v_req.user_id then
      raise exception 'competency_verification_event: no self-verification. A person cannot assess, or assign, their own request';
    end if;
    if not public.competency_appointment_holds(new.appointment_id, new.assessor_id, 'hq.competency.verification.assess') then
      raise exception 'competency_verification_event: the assessor appointment must be their own, active, and hold hq.competency.verification.assess';
    end if;
    if not public.competency_assessor_covers(new.appointment_id, v_req.competency_id, v_version.method_id, v_req.target_level_id, v_req.context, current_date) then
      raise exception 'competency_verification_event: out of scope. No live scope of that appointment covers this competency, method, level and context';
    end if;
    if new.actor_id = new.assessor_id then
      if coalesce(v_version.content #>> '{workflow,assignment}', 'administrator') <> 'self_claim' then
        raise exception 'competency_verification_event: this method is assigned by an administrator. An assessor cannot claim it';
      end if;
      if v_state = 'assigned' then
        raise exception 'competency_verification_event: this request is already assigned. An assessor cannot claim it from another';
      end if;
    elsif not public.individual_holds_capability(new.actor_id, 'hq.competency.verification.manage') then
      raise exception 'competency_verification_event: not authorised to assign. It needs hq.competency.verification.manage';
    end if;

  elsif new.event = 'assignment_declined' then
    select assessor_id, event into v_assigned from competency_verification_event
     where request_id = new.request_id and event in ('assigned', 'assignment_declined') order by created_at desc, id desc limit 1;
    if v_assigned.event is distinct from 'assigned' or (new.actor_id is distinct from v_assigned.assessor_id
       and not public.individual_holds_capability(new.actor_id, 'hq.competency.verification.manage')) then
      raise exception 'competency_verification_event: only the assigned assessor or an administrator can decline an assignment';
    end if;

  elsif new.event = 'revoked' then
    select d.outcome_class, d.request_id into v_dec from competency_verification_decision d where d.id = new.decision_id and d.request_id = new.request_id;
    if not found or v_dec.outcome_class not in ('verified', 'partial') then
      raise exception 'competency_verification_event: only a standing verified or partial outcome can be revoked';
    end if;
    if exists (select 1 from competency_verification_event where decision_id = new.decision_id and event = 'revoked') then
      raise exception 'competency_verification_event: that outcome is already revoked';
    end if;
    if new.actor_id is null or new.actor_id = v_req.user_id
       or not public.individual_holds_capability(new.actor_id, 'hq.competency.verification.manage') then
      raise exception 'competency_verification_event: not authorised to revoke. It needs hq.competency.verification.manage, and never on your own outcome';
    end if;
  end if;
  new.created_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists competency_verification_event_guard on competency_verification_event;
create trigger competency_verification_event_guard before insert or update or delete on competency_verification_event
  for each row execute function public.competency_verification_event_guard();

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


-- ---- 7b. SUBMISSION, ATOMICALLY ---------------------------------------------------------------------------
--
-- A request and its evidence arrive together or not at all. The request table is append-only, so a request whose
-- evidence failed half way could never be removed. Each evidence item still passes its own trigger. Evidence is
-- [{kind, id, outcomeIndexes, linkId}] with kind cpd, learning_record, evidence, profile_item, study_achievement or
-- reflection (a reflection only when the person deliberately attaches it, never automatically). linkId is the
-- portfolio evidence link it came from, for traceability only (no foreign key: the portfolio owns its tables).

create or replace function public.competency_verification_add_evidence(p_user uuid, p_request uuid, p_evidence jsonb)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_e jsonb;
  v_kind text;
  v_id uuid;
  v_n integer := 0;
begin
  if jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) > 50 then
    raise exception 'competency_verification_add_evidence: evidence is a list of at most 50 items';
  end if;
  for v_e in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) loop
    v_kind := v_e ->> 'kind';
    v_id := (v_e ->> 'id')::uuid;
    insert into competency_verification_evidence (request_id, user_id, kind, cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, study_achievement_id, portfolio_link_id, outcome_indexes)
    values (p_request, p_user, v_kind,
      case when v_kind = 'cpd' then v_id end, case when v_kind = 'learning_record' then v_id end, case when v_kind = 'evidence' then v_id end,
      case when v_kind = 'profile_item' then v_id end, case when v_kind = 'reflection' then v_id end, case when v_kind = 'study_achievement' then v_id end,
      nullif(v_e ->> 'linkId', '')::uuid,
      coalesce((select array_agg(x::integer) from jsonb_array_elements_text(v_e -> 'outcomeIndexes') x), '{-1}'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

create or replace function public.competency_verification_submit(p_user uuid, p_competency uuid, p_method_version uuid, p_outcomes integer[],
  p_target_level uuid, p_context text, p_note text, p_renews uuid, p_evidence jsonb)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  insert into competency_verification_request (user_id, competency_id, method_version_id, outcome_indexes, target_level_id, context, note, renews_decision_id)
  values (p_user, p_competency, p_method_version, coalesce(nullif(p_outcomes, '{}'), '{-1}'), p_target_level, coalesce(p_context, 'independent'), p_note, p_renews)
  returning id into v_id;
  perform public.competency_verification_add_evidence(p_user, v_id, p_evidence);
  return v_id;
end
$$;

revoke all on function public.competency_verification_add_evidence(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.competency_verification_submit(uuid, uuid, uuid, integer[], uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.competency_verification_add_evidence(uuid, uuid, jsonb) to service_role;
grant execute on function public.competency_verification_submit(uuid, uuid, uuid, integer[], uuid, text, text, uuid, jsonb) to service_role;


-- ---- 8. PRIVACY: RLS ON, THE PERSON READS THEIR OWN -------------------------------------------------------

alter table competency_verification_method enable row level security;
alter table competency_verification_method_version enable row level security;
alter table competency_assessor_scope enable row level security;
alter table competency_verification_request enable row level security;
alter table competency_verification_evidence enable row level security;
alter table competency_verification_event enable row level security;
alter table competency_verification_decision enable row level security;

drop policy if exists competency_verification_request_read_own on competency_verification_request;
create policy competency_verification_request_read_own on competency_verification_request for select using (auth.uid() = user_id);
drop policy if exists competency_verification_evidence_read_own on competency_verification_evidence;
create policy competency_verification_evidence_read_own on competency_verification_evidence for select using (auth.uid() = user_id);
drop policy if exists competency_verification_event_read_own on competency_verification_event;
create policy competency_verification_event_read_own on competency_verification_event for select using (auth.uid() = user_id);
drop policy if exists competency_verification_decision_read_own on competency_verification_decision;
create policy competency_verification_decision_read_own on competency_verification_decision for select using (auth.uid() = user_id);

comment on table competency_verification_method_version is
  'COMPETEN-PROFESSIONAL-COMPETENCY-01 C5. The criteria of one assessment method as data. Edited only as a draft, published by hq.competency.verification.manage, then never changed. Decisions pin it and its content hash.';
comment on table competency_assessor_scope is
  'C5. What one assessor appointment may assess: coverage (profession, specialty, framework, domain, competency) narrowed by method, highest level and context, with validity. Granted by manage, never by the assessor.';
comment on table competency_verification_decision is
  'C5. One assessment outcome, by the assigned, appointed, in-scope assessor who is not the person, against the pinned method version. An outcome of this assessment, never a general declaration of competence. Append-only.';


-- ---- 9. VERIFICATION -----------------------------------------------------------------------------------

select code, space from hq_capability where code like 'hq.competency.verification.%' order by code;
select position_code, capability_code from hq_position_capability
 where effective_to is null and (capability_code like 'hq.competency.verification.%' or position_code in ('competency_verification_administrator', 'competency_assessor'))
 order by position_code, capability_code;
select count(*) as appointed from ogs_office_appointments where role in ('competency_verification_administrator', 'competency_assessor') and status = 'active';

notify pgrst, 'reload schema';
