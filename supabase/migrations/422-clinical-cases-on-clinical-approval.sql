-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 422: CLINICAL CASES ON THE HOLDINGS CLINICAL-APPROVAL PROCESS -- 395 GENERALISED, AND THE CASE LIBRARY
--
-- COMPETEN-HOLDINGS-AI-CONSUMPTION-01 C2/C3 and COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CI3-CI5, owner Stage 5 case
-- interface approval s3: "Extend the existing Holdings clinical-approval process to support case content. Do not build
-- a separate approval engine." Coordinator range 421-424. Fixes forward from 395, which is frozen.
--
-- APPLY ON STAGING FIRST. ADDITIVE OR WIDENING. Two new columns on clinical_content_version (every existing row
-- defaults to kind competency and keeps its values), competency_id nullable under a CHECK, 395's two guards replaced
-- (the competency branch unchanged), four new case tables with their guards, four functions, two capabilities and one
-- position. Re-running it is a no-op. OPS-001 s8: proposed Medium (a replaced governance trigger and new authority
-- grants), with a rollback rehearsal. Depends on 395 and the CFCA competency tables.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets the ONE Holdings clinical-approval process -- the same versions, independence, appointed positions, scopes,
-- version-exact staleness, append-only decisions and higher-risk counts that approve competencies -- approve the exact
-- version of a clinical case, while the case library keeps only the case content and its own publication, so a case
-- delivered for reuse is one a clinician approved, and approval and publication stay separate acts.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT CHANGES.
--
--   clinical_content_version   + content_kind (competency or case) and case_version_id. Exactly one subject, by CHECK:
--                              a competency version names a competency, a case version names a case version.
--   clinical_content_version_guard   REPLACED. Competency: 395's logic, unchanged. Case: the hash and the content
--                              snapshot are the database's own for the exact SUBMITTED case version.
--   clinical_review_decision_guard   REPLACED. Independence and authority: 395's, unchanged, for both kinds. Scope and
--                              staleness by kind: a case is in scope only if an active scope of the appointment covers
--                              EVERY CFCA competency it teaches, and it is stale if its hash no longer matches.
--
--   case_library_case          A case's identity: code, title, optional profession, active or retired.
--   case_library_version       The case content (the case-blueprint/1 document) with a database-computed hash, and the
--                              library's own lifecycle: draft, submitted, published, superseded, retired. A draft is
--                              editable by its authors. From submission the content is frozen. CLINICAL APPROVAL IS NOT
--                              STORED HERE: it is the 395 record of this exact version.
--   case_library_version_competency  The CFCA competencies a version teaches (the original identifiers).
--   case_library_submit        Freezes a draft and puts it forward through 395 (a clinical_content_version of kind case,
--                              with the governed approval count).
--   case_library_approved      True only when a 395 record of the case version's exact hash has its approvals and no
--                              rejection.
--   case_library_publish       A separate act: requires case_library_approved, supersedes the previously published one.
--   case_library_deliverable   The one check delivery uses: published AND approved for this exact version.
--   case_library_retire        Retires a case and its live versions.
--
--   Authority: hq.quality.case.author (new position clinical_case_educator, with home.view) and hq.quality.case.publish
--   (the Quality Council Member). Clinical review is the existing hq.quality.clinical.approve with its 395 scopes.
--
-- RLS: on for the four new tables, no policy. Execute on the functions: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CASES/ROLLBACK-422.sql restores 395's two guards byte for byte and drops the case
--   tables, columns, functions, capabilities and the position. It refuses once a case exists.
-- ====================================================================================================


-- ---- 1. the case library: identity and content ---------------------------------------------------------

create table if not exists case_library_case (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  title              text not null,
  profession_term_id uuid,
  status             text not null default 'active',
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table case_library_case drop constraint if exists case_library_case_check;
alter table case_library_case add constraint case_library_case_check
  check (code ~ '^CASE-[A-Z0-9][A-Z0-9-]{2,40}$' and char_length(btrim(title)) between 2 and 200 and status in ('active', 'retired'));
create unique index if not exists ux_case_library_case_code on case_library_case(code);
alter table case_library_case enable row level security;

create or replace function public.case_library_case_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'case_library_case: a case is the record. Retire it instead';
  end if;
  if new.code is distinct from old.code or new.created_at is distinct from old.created_at then
    raise exception 'case_library_case: a case code cannot be rewritten';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'case_library_case: a retired case stays retired';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists case_library_case_guard on case_library_case;
create trigger case_library_case_guard before update or delete on case_library_case for each row execute function public.case_library_case_guard();

create table if not exists case_library_version (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references case_library_case(id) on delete cascade,
  version_no          int not null,
  content             jsonb not null,
  content_hash        text not null default 'computed-by-trigger',
  level               text not null default 'intermediate',
  risk                text not null default 'standard',
  state               text not null default 'draft',
  authored_by         uuid[] not null,
  submitted_by        uuid,
  submitted_at        timestamptz,
  published_by        uuid,
  published_at        timestamptz,
  superseded_at       timestamptz,
  retired_at          timestamptz,
  origin_kind         text not null default 'educator',
  origin_candidate_id uuid,
  parent_version_id   uuid references case_library_version(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table case_library_version drop constraint if exists case_library_version_check;
alter table case_library_version add constraint case_library_version_check
  check (version_no >= 1 and jsonb_typeof(content) = 'object' and level in ('foundation', 'intermediate', 'advanced')
     and risk in ('standard', 'high') and state in ('draft', 'submitted', 'published', 'superseded', 'retired')
     and cardinality(authored_by) >= 1
     and (state = 'draft') = (submitted_at is null)
     and (state = 'draft' or (submitted_by is not null and submitted_by = any(authored_by)))
     and (state not in ('published', 'superseded') or (published_at is not null and published_by is not null))
     and origin_kind in ('educator', 'candidate', 'variation', 'revision')
     and (origin_kind <> 'candidate' or origin_candidate_id is not null)
     and (origin_kind not in ('variation', 'revision') or parent_version_id is not null));
create unique index if not exists ux_case_library_version_no on case_library_version(case_id, version_no);
create index if not exists idx_case_library_version_state on case_library_version(state, updated_at desc);
alter table case_library_version enable row level security;

-- The hash is the database's. A draft is editable. From submission the content, links, risk and authorship are frozen,
-- and the state moves only through the functions below (the setting competen.case_library).
create or replace function public.case_library_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.state = 'draft' then return old; end if;
    raise exception 'case_library_version: a submitted version is the record and cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then raise exception 'case_library_version: a version starts as a draft'; end if;
    new.content_hash := md5(new.content::text);
    new.submitted_by := null;
    new.submitted_at := null;
    new.published_by := null;
    new.published_at := null;
    return new;
  end if;
  if new.case_id is distinct from old.case_id or new.version_no is distinct from old.version_no or new.created_at is distinct from old.created_at
     or new.origin_kind is distinct from old.origin_kind or new.origin_candidate_id is distinct from old.origin_candidate_id or new.parent_version_id is distinct from old.parent_version_id then
    raise exception 'case_library_version: a version''s identity and provenance cannot be rewritten';
  end if;
  if coalesce(current_setting('competen.case_library', true), '') <> 'on' then
    if old.state <> 'draft' or new.state <> 'draft' then
      raise exception 'case_library_version: only a draft is edited directly. Submission, publication and retirement go through their functions';
    end if;
    new.content_hash := md5(new.content::text);
  elsif new.content is distinct from old.content or new.authored_by is distinct from old.authored_by or new.risk is distinct from old.risk or new.level is distinct from old.level then
    raise exception 'case_library_version: a submitted version''s content cannot change. Make a new version, which needs renewed approval';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists case_library_version_guard on case_library_version;
create trigger case_library_version_guard before insert or update or delete on case_library_version for each row execute function public.case_library_version_guard();

create table if not exists case_library_version_competency (
  version_id    uuid not null references case_library_version(id) on delete cascade,
  competency_id uuid not null references framework_competencies(id),
  primary key (version_id, competency_id)
);
alter table case_library_version_competency enable row level security;

create or replace function public.case_library_version_competency_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_state text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select state into v_state from case_library_version where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if v_state is distinct from 'draft' then
    raise exception 'case_library_version_competency: the outcomes a submitted version teaches cannot change. Make a new version';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists case_library_version_competency_guard on case_library_version_competency;
create trigger case_library_version_competency_guard before insert or update or delete on case_library_version_competency for each row execute function public.case_library_version_competency_guard();


-- ---- 2. 395 generalised: one clinical-approval process for competencies and cases ---------------------

alter table clinical_content_version add column if not exists content_kind text not null default 'competency';
alter table clinical_content_version add column if not exists case_version_id uuid references case_library_version(id) on delete cascade;
alter table clinical_content_version alter column competency_id drop not null;
alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and competency_id is not null and case_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null));
create unique index if not exists ux_clinical_content_version_case_hash on clinical_content_version(case_version_id, content_hash);

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


-- ---- 3. submission, approval, publication, delivery, retirement --------------------------------------

-- Freeze a draft and put it forward through the one clinical-approval process. Only an author or editor submits, and
-- only a version that names its CFCA competencies. The count comes from the governed counts (the caller reads them).
create or replace function public.case_library_submit(p_version uuid, p_submitter uuid, p_required int)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v case_library_version%rowtype;
  v_ccv uuid;
begin
  select * into v from case_library_version where id = p_version for update;
  if not found then raise exception 'case_library_submit: unknown version'; end if;
  if v.state <> 'draft' then raise exception 'case_library_submit: only a draft is submitted (this one is %)', v.state; end if;
  if p_submitter is null or not (p_submitter = any(v.authored_by)) then
    raise exception 'case_library_submit: only an author or editor of the version may submit it';
  end if;
  if not exists (select 1 from case_library_version_competency where version_id = v.id) then
    raise exception 'case_library_submit: name the CFCA competencies the case teaches first';
  end if;
  if p_required is null or p_required < 1 or p_required > 5 then raise exception 'case_library_submit: the required approvals must be 1 to 5'; end if;
  perform set_config('competen.case_library', 'on', true);
  update case_library_version set state = 'submitted', submitted_by = p_submitter, submitted_at = now() where id = v.id;
  perform set_config('competen.case_library', 'off', true);
  insert into clinical_content_version (content_kind, case_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis)
    values ('case', v.id, 'computed-by-trigger', '{}'::jsonb, v.authored_by, p_submitter, p_required, v.risk || ' risk case')
    returning id into v_ccv;
  return v_ccv;
end;
$$;

-- Approved: a 395 record of this case version's exact hash, with its approvals and no rejection.
create or replace function public.case_library_approved(p_version uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_content_version ccv
      join case_library_version cv on cv.id = ccv.case_version_id
     where ccv.content_kind = 'case' and ccv.case_version_id = p_version and ccv.content_hash = cv.content_hash
       and not exists (select 1 from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'rejected')
       and (select count(*) from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'approved') >= ccv.required_approvals
  )
$$;

-- Publish: a separate governed act, only for an approved version. The case's previously published version is superseded.
create or replace function public.case_library_publish(p_version uuid, p_publisher uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v case_library_version%rowtype;
  c case_library_case%rowtype;
begin
  select * into v from case_library_version where id = p_version for update;
  if not found then raise exception 'case_library_publish: unknown version'; end if;
  select * into c from case_library_case where id = v.case_id for update;
  if c.status <> 'active' then raise exception 'case_library_publish: the case is retired'; end if;
  if v.state <> 'submitted' then raise exception 'case_library_publish: only a submitted, clinically approved version is published (this one is %)', v.state; end if;
  if not case_library_approved(v.id) then raise exception 'case_library_publish: this exact version is not clinically approved'; end if;
  if p_publisher is null then raise exception 'case_library_publish: a publisher is required'; end if;
  perform set_config('competen.case_library', 'on', true);
  update case_library_version set state = 'superseded', superseded_at = now() where case_id = v.case_id and state = 'published' and id <> v.id;
  update case_library_version set state = 'published', published_by = p_publisher, published_at = now() where id = v.id;
  perform set_config('competen.case_library', 'off', true);
end;
$$;

-- The one check delivery uses: the case is active, this version is published, and this exact version is approved.
create or replace function public.case_library_deliverable(p_version uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from case_library_version cv join case_library_case c on c.id = cv.case_id
     where cv.id = p_version and cv.state = 'published' and c.status = 'active' and case_library_approved(cv.id)
  )
$$;

-- Retire a case: it is no longer offered. Its versions and their review records stay as the record.
create or replace function public.case_library_retire(p_case uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform 1 from case_library_case where id = p_case for update;
  if not found then raise exception 'case_library_retire: unknown case'; end if;
  perform set_config('competen.case_library', 'on', true);
  update case_library_version set state = 'retired', retired_at = now() where case_id = p_case and state in ('published', 'submitted');
  update case_library_case set status = 'retired' where id = p_case;
  perform set_config('competen.case_library', 'off', true);
end;
$$;

revoke all on function public.case_library_submit(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.case_library_approved(uuid) from public, anon, authenticated;
revoke all on function public.case_library_publish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.case_library_deliverable(uuid) from public, anon, authenticated;
revoke all on function public.case_library_retire(uuid) from public, anon, authenticated;
grant execute on function public.case_library_submit(uuid, uuid, int) to service_role;
grant execute on function public.case_library_approved(uuid) to service_role;
grant execute on function public.case_library_publish(uuid, uuid) to service_role;
grant execute on function public.case_library_deliverable(uuid) to service_role;
grant execute on function public.case_library_retire(uuid) to service_role;


-- ---- 4. authority, through the existing position model -------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.quality.case.author', 'quality', 'Clinical case authoring',
   'Author, edit and submit shared clinical cases for independent clinical review, and review candidate cases'),
  ('hq.quality.case.publish', 'quality', 'Clinical case publication',
   'Publish a clinically approved case version to the shared library, and retire cases')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('clinical_case_educator', 'quality', 'Clinical Case Educator',
   'Develops shared clinical cases in the case studio. Cannot approve or publish them')
on conflict (code) do nothing;

-- The educator position: author, and the HQ landing page every position reaches.
insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('clinical_case_educator')) as p(code)
cross join (values ('hq.quality.case.author'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

-- The existing Quality Council Member position: publish.
insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('quality_council_member')) as p(code)
cross join (values ('hq.quality.case.publish')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- Verification: the new tables with RLS on and no policy, the generalised version table, the grants.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('case_library_case', 'case_library_version', 'case_library_version_competency')
 order by c.relname;

select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'clinical_content_version' and column_name in ('content_kind', 'case_version_id', 'competency_id') order by 1;

select position_code, capability_code from hq_position_capability
 where capability_code in ('hq.quality.case.author', 'hq.quality.case.publish') and effective_to is null
 order by capability_code;

notify pgrst, 'reload schema';
