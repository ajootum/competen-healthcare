-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql trigger functions between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 395: COMPETEN HOLDINGS CLINICAL-CONTENT APPROVAL
--
-- Owner decisions D2 and D3, 2026-10-24. Shared by every Competen product that offers clinical content.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Three new tables, one nullable column on frameworks, two functions, three
-- triggers, two capabilities and one position. No existing row is changed. Re-running it is a no-op.
-- OPS-001 s8: proposed Medium (new trigger functions), so it carries a staging rollback rehearsal.
-- Depends on 384 (learning_outcomes, expected_level_id), 264 (hq_position, hq_capability), 117
-- (ogs_office_appointments) and 013 (taxonomy_terms).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets an appointed, scoped and independent clinical reviewer approve the EXACT content of a shared
-- competency, so that "clinically approved" is a fact the database can prove, bound to that content, lost
-- the moment the content materially changes, and kept apart from catalogue publication.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   competency_content_hash(id)    the material clinical content of a competency, as one md5: name,
--                                  description, learning outcomes, expected level, practice, CPU, risk
--                                  category and its skills. Any change to any of them is a new content
--                                  version. md5 is for change detection here, not for secrecy.
--   clinical_content_version       one row per (competency, content hash) put forward for review. The
--                                  hash and the snapshot are computed BY THE TRIGGER, never sent by a
--                                  writer, so a version can only ever describe the content it names. It
--                                  records who authored or materially edited that content and how many
--                                  independent approvals it needs (1 by default, configurable upward for
--                                  higher-risk content, at most 5). Append-only.
--   clinical_reviewer_scope        what an APPOINTMENT may review: a profession or specialty (taxonomy
--                                  terms), a framework, or a competency domain. Configuration, never code.
--                                  Nothing is nursing-specific: a scope is whatever term or record it names.
--   clinical_review_decision       approved or rejected, by one reviewer, under one appointment, for one
--                                  version. Append-only. The trigger REFUSES a decision when:
--                                    the reviewer authored or edited the version, or submitted it
--                                    the appointment is not held by the reviewer, not active, not held in an
--                                      active office, or its position does not hold hq.quality.clinical.approve
--                                    no active scope of that appointment covers the competency
--                                    the content of the competency has changed since the version (stale)
--                                  One decision per reviewer per version.
--   frameworks.specialty_term_id   the specialty a framework belongs to (taxonomy specialty), so a
--                                  specialty scope has something to match. Null means none recorded.
--
-- AUTHORITY, THROUGH EXISTING POSITIONS. hq.quality.clinical.approve is held by the new position
-- clinical_content_reviewer. hq.quality.clinical.govern (appoint scopes, set review counts) is granted to the
-- existing quality_council_member position. Appointing a person to a position stays the existing HQ
-- appointment workflow.
--
-- SEPARATE FROM PUBLICATION. Nothing here changes frameworks.pub_status, and publishing a framework or a
-- catalogue (394) approves nothing clinically.
--
-- RLS: on for the three tables, no policy. The server writes through the service role. A cascade from a
-- parent still deletes (pg_trigger_depth() > 1), so a competency can be removed.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CLINICAL/ROLLBACK-395.sql drops the triggers, functions, tables, the
--   column, the grants, the position and the capabilities. Review records made on staging are lost.
-- ====================================================================================================

alter table frameworks add column if not exists specialty_term_id uuid references taxonomy_terms(id) on delete restrict;


-- ---- 1. the material content of a competency, as one hash ----------------------------------------------

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
    'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb)
  )::text)
  from framework_competencies c
  where c.id = p_competency
$$;

-- The same, for many competencies at once (one round trip for a catalogue page).
create or replace function public.competency_content_hashes(p_ids uuid[])
returns table (competency_id uuid, content_hash text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.id, competency_content_hash(c.id) from framework_competencies c where c.id = any(p_ids)
$$;


-- ---- 2. clinical_content_version -----------------------------------------------------------------------

create table if not exists clinical_content_version (
  id                  uuid primary key default gen_random_uuid(),
  competency_id       uuid not null references framework_competencies(id) on delete cascade,
  content_hash        text not null,
  content_snapshot    jsonb not null,
  authored_by         uuid[] not null,
  submitted_by        uuid not null,
  required_approvals  int not null default 1,
  risk_basis          text,
  created_at          timestamptz not null default now()
);

alter table clinical_content_version drop constraint if exists clinical_content_version_check;
alter table clinical_content_version add constraint clinical_content_version_check
  check (required_approvals between 1 and 5
     and submitted_by = any(authored_by)
     and (risk_basis is null or char_length(risk_basis) <= 200));

create unique index if not exists ux_clinical_content_version_hash
  on clinical_content_version(competency_id, content_hash);

alter table clinical_content_version enable row level security;


-- ---- 3. clinical_reviewer_scope ------------------------------------------------------------------------

create table if not exists clinical_reviewer_scope (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references ogs_office_appointments(id) on delete cascade,
  scope_kind      text not null,
  scope_ref       uuid not null,
  granted_by      uuid,
  created_at      timestamptz not null default now(),
  ended_at        timestamptz
);

alter table clinical_reviewer_scope drop constraint if exists clinical_reviewer_scope_kind_check;
alter table clinical_reviewer_scope add constraint clinical_reviewer_scope_kind_check
  check (scope_kind in ('profession', 'specialty', 'framework', 'domain'));

create index if not exists idx_clinical_reviewer_scope_appointment
  on clinical_reviewer_scope(appointment_id);

alter table clinical_reviewer_scope enable row level security;


-- ---- 4. clinical_review_decision -----------------------------------------------------------------------

create table if not exists clinical_review_decision (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references clinical_content_version(id) on delete cascade,
  reviewer_id     uuid not null,
  appointment_id  uuid not null,
  decision        text not null,
  comment         text,
  created_at      timestamptz not null default now()
);

alter table clinical_review_decision drop constraint if exists clinical_review_decision_check;
alter table clinical_review_decision add constraint clinical_review_decision_check
  check (decision in ('approved', 'rejected') and (comment is null or char_length(comment) <= 2000));

create unique index if not exists ux_clinical_review_decision_reviewer
  on clinical_review_decision(version_id, reviewer_id);

alter table clinical_review_decision enable row level security;


-- ---- 5. whether an appointment may review a competency -------------------------------------------------

create or replace function public.clinical_scope_covers(p_appointment uuid, p_competency uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_reviewer_scope s
      join framework_competencies c on c.id = p_competency
      join framework_domains d on d.id = c.domain_id
      join frameworks f on f.id = d.framework_id
     where s.appointment_id = p_appointment
       and s.ended_at is null
       and ((s.scope_kind = 'profession' and s.scope_ref = f.profession_term_id)
         or (s.scope_kind = 'specialty' and s.scope_ref = f.specialty_term_id)
         or (s.scope_kind = 'framework' and s.scope_ref = f.id)
         or (s.scope_kind = 'domain' and s.scope_ref = d.id))
  )
$$;


-- ---- 6. the guards -------------------------------------------------------------------------------------

-- A version: the database computes the hash and snapshot, shared content only, append-only.
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

drop trigger if exists clinical_content_version_guard on clinical_content_version;
create trigger clinical_content_version_guard
  before insert or update or delete on clinical_content_version
  for each row execute function public.clinical_content_version_guard();

-- A decision: independent, authorised, in scope, current, append-only.
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

drop trigger if exists clinical_review_decision_guard on clinical_review_decision;
create trigger clinical_review_decision_guard
  before insert or update or delete on clinical_review_decision
  for each row execute function public.clinical_review_decision_guard();

-- A scope names a record of its kind: a profession or specialty term, a framework, or a domain. Shared only.
create or replace function public.clinical_reviewer_scope_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and (new.appointment_id is distinct from old.appointment_id or new.scope_kind is distinct from old.scope_kind
      or new.scope_ref is distinct from old.scope_ref) then
    raise exception 'clinical_reviewer_scope: a scope cannot be rewritten. End it and add another';
  end if;
  if tg_op = 'INSERT' then
    if new.scope_kind in ('profession', 'specialty') and not exists (
      select 1 from taxonomy_terms t join taxonomies x on x.id = t.taxonomy_id where t.id = new.scope_ref and x.kind = new.scope_kind) then
      raise exception 'clinical_reviewer_scope: % must be a % taxonomy term', new.scope_ref, new.scope_kind;
    end if;
    if new.scope_kind = 'framework' and not exists (select 1 from frameworks f where f.id = new.scope_ref and f.hospital_id is null) then
      raise exception 'clinical_reviewer_scope: the framework must be a shared framework';
    end if;
    if new.scope_kind = 'domain' and not exists (
      select 1 from framework_domains d join frameworks f on f.id = d.framework_id where d.id = new.scope_ref and f.hospital_id is null) then
      raise exception 'clinical_reviewer_scope: the domain must belong to a shared framework';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_reviewer_scope_guard on clinical_reviewer_scope;
create trigger clinical_reviewer_scope_guard
  before insert or update on clinical_reviewer_scope
  for each row execute function public.clinical_reviewer_scope_guard();


-- ---- 7. authority, through the existing position model -------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.quality.clinical.approve', 'quality', 'Clinical content approval',
   'Approve or reject the exact content version of shared competencies within an appointed scope'),
  ('hq.quality.clinical.govern', 'quality', 'Clinical review governance',
   'Set the scopes clinical reviewers are appointed to and the number of independent approvals content needs')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('clinical_content_reviewer', 'quality', 'Clinical Content Reviewer',
   'Reviews shared clinical content within the scopes the appointment is given')
on conflict (code) do nothing;

-- The reviewer position: approve, and the HQ landing page every position reaches.
insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('clinical_content_reviewer')) as p(code)
cross join (values ('hq.quality.clinical.approve'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

-- The existing Quality Council Member position: govern.
insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('quality_council_member')) as p(code)
cross join (values ('hq.quality.clinical.govern')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- Verification: the tables with RLS on and no policy, the triggers, the grants, and no rows.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('clinical_content_version', 'clinical_reviewer_scope', 'clinical_review_decision')
 order by c.relname;

select tgname from pg_trigger
 where tgname in ('clinical_content_version_guard', 'clinical_review_decision_guard', 'clinical_reviewer_scope_guard')
 order by tgname;

select position_code, capability_code from hq_position_capability
 where capability_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern') and effective_to is null
 order by capability_code;

notify pgrst, 'reload schema';
