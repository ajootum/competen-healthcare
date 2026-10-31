-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and sql functions between dollar quotes and a do-block. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 771: THE STRUCTURE OF A PUBLISHED FRAMEWORK IN ITS REVISION DRAFT (labels, domains, practices, CPUs)
--
-- FRAMEWORK-DESIGN-STUDIO-02, owner ruling D3 (31 Oct 2026): on a PUBLISHED framework ALL changes pass through revision
-- drafts and independent publication. 770 carried the clinical content (competencies and criteria). Until now the
-- framework name and description, new domains and domain renames, and new or renamed practices and clinical practice
-- units (CPUs) still saved live. This file carries them in the same open revision, applied in the same publication
-- statement by the same trigger, whole or not at all.
-- Build record: docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/771-build-record.md
--
-- APPLY ON STAGING FIRST. ADDITIVE. Three tables, three columns and a check on framework_revision, one trigger, three
-- foreign keys of framework_revision_competency replaced by a trigger check, six function bodies replaced. No existing
-- row is changed. Re-running it is a no-op. OPS-001 s8: proposed Medium (the publication apply and a review guard are
-- replaced), so it carries a staging rollback rehearsal.
-- Application order: 750, 751, 752, 760, 761, 770, then 771. The file refuses (nothing changed) without 770.
-- Depends on 011 (practices, clinical_practice_units), 760 (framework_areas, domain Area scope trigger, unchanged) and
-- 770 (every body replaced here is the 770 body, extended).
--
-- ----------------------------------------------------------------------------------------------------
-- 1. STORAGE, VALIDATED BY THE SCHEMA. RLS on, no policy, invisible to every signed-in or anonymous read.
--    framework_revision            + framework_proposed, proposed_name, proposed_description: the framework label,
--                                  proposed (framework_proposed false = no change). Changed only while open.
--    framework_revision_domain     a rename of a live domain (origin_domain_id = domain_id, name and code) or a NEW
--                                  domain (pre-allocated id, checked unused, name, code, place, optional Area of the
--                                  same framework).
--    framework_revision_practice   a rename of a live practice of the framework, or a NEW one (pre-allocated id) in a
--                                  live domain or a new domain of the same revision.
--    framework_revision_cpu        a rename of a live CPU of the framework, or a NEW one (pre-allocated id, risk,
--                                  complexity, reassessment) in a live practice or a new practice of the same revision.
--    framework_revision_competency may now name a NEW domain, practice or CPU of its revision. Its three foreign keys to
--                                  the live tables become a trigger check (live row, or new row of the same revision).
--                                  A new competency of the revision may change domain within the revision.
--
-- 2. NOT CLINICAL CONTENT. None of these is in competency_content_hash, so no competency becomes stale and none needs
--    clinical review again. They are ORGANISATIONAL for review (as the 760 Area actions): the audit actions
--    cfca_revision_framework_updated, cfca_revision_domain_created, cfca_revision_domain_renamed,
--    cfca_revision_practice_created, cfca_revision_practice_renamed, cfca_revision_cpu_created and
--    cfca_revision_cpu_renamed are not authorship (clinical_review_decision_sod_guard, extended), but they ARE
--    contribution, so their actor cannot publish (640, unchanged). Linking a competency to a CPU stays a content change
--    of that competency (cpu_id is in the hash, recorded on the competency, authorship).
--    The 640 floor reads the risk of a NEW CPU from the revision, so a new high risk CPU raises the approvals needed.
--    A new competency in a NEW domain is in scope for a reviewer whose scope covers its framework, profession or
--    specialty (clinical_scope_covers_domain, extended).
--
-- 3. APPLIED IN THE PUBLICATION STATEMENT. frameworks_revision_apply_on_publish (770, extended) now also: sets the
--    framework name and description on the row being published, inserts new domains, practices and CPUs with their
--    pre-allocated ids (before the new competencies that name them), and renames by id. framework_revision_problem
--    (extended) refuses a revision whose new ids were taken, or whose new rows lost their parent, or whose competencies
--    name a practice or CPU that no longer exists. Any refusal (here, 466, 640, 752) rolls the whole statement back.
--    Nothing is ever deleted.
--
-- NOT CHANGED: 466 and 640 publication guards, 641, 690 decision guard, 751, 752 and 760 layout apply, 761 hash, the 770
-- version guard, hash, snapshot and revision guards, competency_clinically_approved.
-- NOT ACTIVATED. Nothing is written until the app proposes a change.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/ROLLBACK-771.sql
-- ====================================================================================================

do $pre$
begin
  if to_regclass('public.framework_revision_competency') is null
     or to_regprocedure('public.frameworks_revision_apply_on_publish()') is null
     or to_regprocedure('public.framework_revision_problem(uuid)') is null then
    raise exception '771: apply 770 first (revision drafts). Nothing was changed';
  end if;
  if to_regclass('public.framework_areas') is null then
    raise exception '771: apply 760 first (Areas). Nothing was changed';
  end if;
end
$pre$;


-- ---- 1. the proposed framework label, on the revision itself --------------------------------------------

alter table framework_revision add column if not exists framework_proposed boolean not null default false;
alter table framework_revision add column if not exists proposed_name text;
alter table framework_revision add column if not exists proposed_description text;
alter table framework_revision drop constraint if exists framework_revision_proposal_check;
alter table framework_revision add constraint framework_revision_proposal_check
  check ((not framework_proposed and proposed_name is null and proposed_description is null)
      or (framework_proposed and proposed_name is not null and char_length(btrim(proposed_name)) between 3 and 200
          and (proposed_description is null or char_length(proposed_description) <= 2000)));

-- The label changes only while the revision is open, and every change moves its updated_at (the publication request
-- compares it, so a change after the framework was put forward refuses the decision).
create or replace function public.framework_revision_proposal_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if (new.framework_proposed, new.proposed_name, new.proposed_description)
     is not distinct from (old.framework_proposed, old.proposed_name, old.proposed_description) then
    return new;
  end if;
  if old.status <> 'open' or new.status <> 'open' then
    raise exception 'framework_revision: the proposed framework name and description change only while the revision is open';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists framework_revision_proposal_guard on framework_revision;
create trigger framework_revision_proposal_guard
  before update of framework_proposed, proposed_name, proposed_description on framework_revision
  for each row execute function public.framework_revision_proposal_guard();


-- ---- 2. domains, practices and CPUs of a revision ------------------------------------------------------

create table if not exists framework_revision_domain (
  id               uuid primary key default gen_random_uuid(),
  revision_id      uuid not null references framework_revision(id) on delete cascade,
  domain_id        uuid not null,
  origin_domain_id uuid references framework_domains(id) on delete cascade,
  name             text not null,
  code             text,
  area_id          uuid references framework_areas(id) on delete set null,
  sort_order       integer,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);
alter table framework_revision_domain drop constraint if exists framework_revision_domain_check;
alter table framework_revision_domain add constraint framework_revision_domain_check
  check ((origin_domain_id is null or origin_domain_id = domain_id)
     and ((origin_domain_id is null and sort_order is not null) or (origin_domain_id is not null and sort_order is null and area_id is null))
     and char_length(btrim(name)) between 2 and 200
     and (code is null or char_length(code) <= 40));
create unique index if not exists ux_framework_revision_domain on framework_revision_domain(revision_id, domain_id);
create index if not exists idx_framework_revision_domain_subject on framework_revision_domain(domain_id);
alter table framework_revision_domain enable row level security;

create table if not exists framework_revision_practice (
  id                 uuid primary key default gen_random_uuid(),
  revision_id        uuid not null references framework_revision(id) on delete cascade,
  practice_id        uuid not null,
  origin_practice_id uuid references practices(id) on delete cascade,
  domain_id          uuid,
  name               text not null,
  description        text,
  code               text,
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
alter table framework_revision_practice drop constraint if exists framework_revision_practice_check;
alter table framework_revision_practice add constraint framework_revision_practice_check
  check ((origin_practice_id is null or origin_practice_id = practice_id)
     and ((origin_practice_id is null and domain_id is not null and code is not null) or (origin_practice_id is not null and domain_id is null))
     and char_length(btrim(name)) between 2 and 200
     and (description is null or char_length(description) <= 2000)
     and (code is null or char_length(code) <= 40));
create unique index if not exists ux_framework_revision_practice on framework_revision_practice(revision_id, practice_id);
create index if not exists idx_framework_revision_practice_subject on framework_revision_practice(practice_id);
alter table framework_revision_practice enable row level security;

create table if not exists framework_revision_cpu (
  id                  uuid primary key default gen_random_uuid(),
  revision_id         uuid not null references framework_revision(id) on delete cascade,
  cpu_id              uuid not null,
  origin_cpu_id       uuid references clinical_practice_units(id) on delete cascade,
  practice_id         uuid,
  name                text not null,
  description         text,
  code                text,
  risk_category       text,
  complexity          integer,
  reassessment_months integer,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now()
);
alter table framework_revision_cpu drop constraint if exists framework_revision_cpu_check;
alter table framework_revision_cpu add constraint framework_revision_cpu_check
  check ((origin_cpu_id is null or origin_cpu_id = cpu_id)
     and ((origin_cpu_id is null and practice_id is not null and code is not null and risk_category is not null and complexity is not null and reassessment_months is not null)
       or (origin_cpu_id is not null and practice_id is null and risk_category is null and complexity is null and reassessment_months is null))
     and (risk_category is null or risk_category in ('low', 'standard', 'high', 'critical'))
     and (complexity is null or complexity between 1 and 5)
     and (reassessment_months is null or reassessment_months between 1 and 120)
     and char_length(btrim(name)) between 3 and 200
     and (description is null or char_length(description) <= 2000)
     and (code is null or char_length(code) <= 40));
create unique index if not exists ux_framework_revision_cpu on framework_revision_cpu(revision_id, cpu_id);
create index if not exists idx_framework_revision_cpu_subject on framework_revision_cpu(cpu_id);
alter table framework_revision_cpu enable row level security;

-- Whether a domain is a domain of the framework of a revision: live, or new in that revision.
create or replace function public.framework_revision_domain_known(p_revision uuid, p_domain uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (select 1 from framework_domains d join framework_revision r on r.framework_id = d.framework_id
                  where r.id = p_revision and d.id = p_domain)
      or exists (select 1 from framework_revision_domain rd where rd.revision_id = p_revision and rd.domain_id = p_domain and rd.origin_domain_id is null)
$$;

-- Whether a practice is a practice of the framework of a revision: live (through its domain), or new in that revision.
create or replace function public.framework_revision_practice_known(p_revision uuid, p_practice uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (select 1 from practices p join framework_domains d on d.id = p.domain_id join framework_revision r on r.framework_id = d.framework_id
                  where r.id = p_revision and p.id = p_practice)
      or exists (select 1 from framework_revision_practice rp where rp.revision_id = p_revision and rp.practice_id = p_practice and rp.origin_practice_id is null)
$$;

-- The structure rows of a revision: only while it is open, ids that cannot be confused, parents of the same framework.
create or replace function public.framework_revision_structure_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_rev uuid := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  v_fw uuid;
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  k text := case tg_table_name when 'framework_revision_domain' then 'domain' when 'framework_revision_practice' then 'practice' else 'cpu' end;
  v_id uuid;
  v_origin uuid;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  select r.framework_id into v_fw from framework_revision r where r.id = v_rev and r.status = 'open';
  if not found then
    raise exception '%: the revision is not open', tg_table_name;
  end if;
  if tg_op = 'DELETE' then
    v_id := (o ->> (k || '_id'))::uuid;
    -- A new row is withdrawn only while nothing of the revision names it.
    if (o ->> ('origin_' || k || '_id')) is null and (
         (k = 'domain' and (exists (select 1 from framework_revision_competency c where c.revision_id = v_rev and c.domain_id = v_id)
                         or exists (select 1 from framework_revision_practice p where p.revision_id = v_rev and p.domain_id = v_id)))
      or (k = 'practice' and (exists (select 1 from framework_revision_competency c where c.revision_id = v_rev and c.practice_id = v_id)
                           or exists (select 1 from framework_revision_cpu u where u.revision_id = v_rev and u.practice_id = v_id)))
      or (k = 'cpu' and exists (select 1 from framework_revision_competency c where c.revision_id = v_rev and c.cpu_id = v_id))) then
      raise exception '%: something in the revision is placed under it. Move it first', tg_table_name;
    end if;
    update framework_revision set updated_at = now() where id = v_rev;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (n -> 'revision_id', n -> (k || '_id'), n -> ('origin_' || k || '_id'), n -> 'created_by', n -> 'created_at')
       is distinct from (o -> 'revision_id', o -> (k || '_id'), o -> ('origin_' || k || '_id'), o -> 'created_by', o -> 'created_at') then
      raise exception '%: which row this is never changes', tg_table_name;
    end if;
  end if;
  v_id := (n ->> (k || '_id'))::uuid;
  v_origin := (n ->> ('origin_' || k || '_id'))::uuid;
  if tg_op = 'INSERT' then
    if v_origin is not null then
      if (k = 'domain' and not exists (select 1 from framework_domains d where d.id = v_origin and d.framework_id = v_fw))
         or (k = 'practice' and not exists (select 1 from practices p join framework_domains d on d.id = p.domain_id where p.id = v_origin and d.framework_id = v_fw))
         or (k = 'cpu' and not exists (select 1 from clinical_practice_units u join practices p on p.id = u.practice_id join framework_domains d on d.id = p.domain_id
                                        where u.id = v_origin and d.framework_id = v_fw)) then
        raise exception '%: it is not of the framework of this revision', tg_table_name;
      end if;
    elsif (k = 'domain' and (exists (select 1 from framework_domains d where d.id = v_id) or exists (select 1 from framework_revision_domain x where x.domain_id = v_id)))
       or (k = 'practice' and (exists (select 1 from practices p where p.id = v_id) or exists (select 1 from framework_revision_practice x where x.practice_id = v_id)))
       or (k = 'cpu' and (exists (select 1 from clinical_practice_units u where u.id = v_id) or exists (select 1 from framework_revision_cpu x where x.cpu_id = v_id))) then
      raise exception '%: a new one takes a new id', tg_table_name;
    end if;
    new.created_at := now();
  end if;
  -- Parents of a new row: of the same framework, live or new in the same revision.
  if v_origin is null then
    if k = 'domain' and (n ->> 'area_id') is not null
       and not exists (select 1 from framework_areas a where a.id = (n ->> 'area_id')::uuid and a.framework_id = v_fw) then
      raise exception 'framework_revision_domain: the Area must belong to the framework of this revision';
    end if;
    if k = 'practice' and not public.framework_revision_domain_known(v_rev, (n ->> 'domain_id')::uuid) then
      raise exception 'framework_revision_practice: a new practice is placed in a domain of the framework of this revision';
    end if;
    if k = 'cpu' and not public.framework_revision_practice_known(v_rev, (n ->> 'practice_id')::uuid) then
      raise exception 'framework_revision_cpu: a new CPU is placed in a practice of the framework of this revision';
    end if;
  end if;
  new.updated_at := now();
  update framework_revision set updated_at = now() where id = v_rev;
  return new;
end;
$$;

drop trigger if exists framework_revision_structure_guard on framework_revision_domain;
create trigger framework_revision_structure_guard
  before insert or update or delete on framework_revision_domain
  for each row execute function public.framework_revision_structure_guard();
drop trigger if exists framework_revision_structure_guard on framework_revision_practice;
create trigger framework_revision_structure_guard
  before insert or update or delete on framework_revision_practice
  for each row execute function public.framework_revision_structure_guard();
drop trigger if exists framework_revision_structure_guard on framework_revision_cpu;
create trigger framework_revision_structure_guard
  before insert or update or delete on framework_revision_cpu
  for each row execute function public.framework_revision_structure_guard();


-- ---- 3. a revision competency may name a new domain, practice or CPU of its revision --------------------

alter table framework_revision_competency drop constraint if exists framework_revision_competency_domain_id_fkey;
alter table framework_revision_competency drop constraint if exists framework_revision_competency_practice_id_fkey;
alter table framework_revision_competency drop constraint if exists framework_revision_competency_cpu_id_fkey;

-- The 770 body of framework_revision_competency_guard, with the domain, practice and CPU of the revision (771).
create or replace function public.framework_revision_competency_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_fw uuid;
  v_rev uuid := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  select r.framework_id into v_fw from framework_revision r where r.id = v_rev and r.status = 'open';
  if not found then
    raise exception 'framework_revision_competency: the revision is not open';
  end if;
  if tg_op = 'DELETE' then
    if old.origin_competency_id is not null then
      raise exception 'framework_revision_competency: a published competency stays in its revision. Discard the revision to drop its changes';
    end if;
    if exists (select 1 from framework_revision_criterion k where k.revision_id = old.revision_id and k.competency_id = old.competency_id and k.origin_skill_id is not null) then
      raise exception 'framework_revision_competency: a published criterion was moved into this new competency. Move it back first';
    end if;
    update framework_revision set updated_at = now() where id = old.revision_id;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.revision_id is distinct from old.revision_id or new.competency_id is distinct from old.competency_id
       or new.origin_competency_id is distinct from old.origin_competency_id or new.base_hash is distinct from old.base_hash
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'framework_revision_competency: which competency this is, and its starting point, never change';
    end if;
  else
    if new.origin_competency_id is not null then
      if not exists (select 1 from framework_competencies c join framework_domains d on d.id = c.domain_id
                      where c.id = new.origin_competency_id and d.framework_id = v_fw) then
        raise exception 'framework_revision_competency: the competency is not of the framework of this revision';
      end if;
      new.base_hash := public.competency_content_hash(new.origin_competency_id);
    else
      if exists (select 1 from framework_competencies c where c.id = new.competency_id)
         or exists (select 1 from framework_revision_competency x where x.competency_id = new.competency_id) then
        raise exception 'framework_revision_competency: a new competency takes a new id';
      end if;
      new.base_hash := null;
    end if;
    new.created_at := now();
  end if;
  -- 771: a new competency sits in a live domain of the framework or in a new domain of the same revision.
  if new.origin_competency_id is null and (tg_op = 'INSERT' or new.domain_id is distinct from old.domain_id)
     and not public.framework_revision_domain_known(new.revision_id, new.domain_id) then
    raise exception 'framework_revision_competency: a new competency is proposed in a domain of the framework of this revision';
  end if;
  -- 771: in place of the foreign keys, a practice or CPU it names is a live one or a new one of the same revision.
  if new.practice_id is not null and (tg_op = 'INSERT' or new.practice_id is distinct from old.practice_id)
     and not exists (select 1 from practices p where p.id = new.practice_id)
     and not exists (select 1 from framework_revision_practice p where p.revision_id = new.revision_id and p.practice_id = new.practice_id and p.origin_practice_id is null) then
    raise exception 'framework_revision_competency: the practice it names does not exist';
  end if;
  if new.cpu_id is not null and (tg_op = 'INSERT' or new.cpu_id is distinct from old.cpu_id)
     and not exists (select 1 from clinical_practice_units u where u.id = new.cpu_id)
     and not exists (select 1 from framework_revision_cpu u where u.revision_id = new.revision_id and u.cpu_id = new.cpu_id and u.origin_cpu_id is null) then
    raise exception 'framework_revision_competency: the CPU it names does not exist';
  end if;
  new.updated_at := now();
  update framework_revision set updated_at = now() where id = new.revision_id;
  return new;
end;
$$;


-- ---- 4. review of a new competency in a new domain, and the risk of a new CPU -------------------------

-- The 770 body of clinical_scope_covers_domain, with a NEW domain of an open revision (771): its framework is the
-- revision framework, so a framework, profession or specialty scope covers it.
create or replace function public.clinical_scope_covers_domain(p_appointment uuid, p_domain uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_reviewer_scope s
      join (select d.id, d.framework_id from framework_domains d where d.id = p_domain
            union all
            select rd.domain_id, r.framework_id from framework_revision_domain rd join framework_revision r on r.id = rd.revision_id
             where rd.domain_id = p_domain and rd.origin_domain_id is null and r.status in ('open', 'applying')
               and not exists (select 1 from framework_domains x where x.id = p_domain)) d on true
      join frameworks f on f.id = d.framework_id
     where s.appointment_id = p_appointment
       and s.ended_at is null
       and ((s.scope_kind = 'profession' and s.scope_ref = f.profession_term_id)
         or (s.scope_kind = 'specialty' and s.scope_ref = f.specialty_term_id)
         or (s.scope_kind = 'framework' and s.scope_ref = f.id)
         or (s.scope_kind = 'domain' and s.scope_ref = d.id))
  )
$$;

-- The 770 body of clinical_content_version_sod_floor, with the risk of a NEW CPU of the revision (771).
create or replace function public.clinical_content_version_sod_floor()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_risk text;
  v_floor int;
begin
  if new.content_kind = 'competency' and new.revision_id is not null then
    -- 770: a revision version is reviewed at the risk it PROPOSES (its own risk category, else its proposed CPU).
    -- 771: a proposed CPU may be a new CPU of the revision, whose risk is the revision own.
    select case when rc.risk_category = 'high' or coalesce(u.risk_category, nu.risk_category) = 'high' then 'high' else 'standard' end into v_risk
      from framework_revision_competency rc
      left join clinical_practice_units u on u.id = rc.cpu_id
      left join framework_revision_cpu nu on nu.revision_id = rc.revision_id and nu.cpu_id = rc.cpu_id and nu.origin_cpu_id is null
     where rc.revision_id = new.revision_id and rc.competency_id = coalesce(new.competency_id, new.proposed_competency_id);
  elsif new.content_kind = 'competency' then
    select case when c.risk_category = 'high' or u.risk_category = 'high' then 'high' else 'standard' end into v_risk
      from framework_competencies c left join clinical_practice_units u on u.id = c.cpu_id where c.id = new.competency_id;
  elsif new.content_kind = 'case' then
    select cv.risk into v_risk from case_library_version cv where cv.id = new.case_version_id;
  elsif new.content_kind = 'resource' then
    select kv.risk into v_risk from ckri_knowledge_version kv where kv.id = new.knowledge_version_id;
  elsif new.content_kind = 'learning' then
    select lv.risk into v_risk from learning_offering_version lv where lv.id = new.learning_version_id;
  end if;
  v_floor := hq_sod_required_approvals(coalesce(v_risk, 'standard'));
  if new.required_approvals is null or new.required_approvals < v_floor then
    new.required_approvals := v_floor;
  end if;
  return new;
end;
$$;

-- The 770 body of clinical_review_decision_sod_guard, with the 771 organisational revision actions left out of
-- authorship (as the 760 Area actions are). They remain contribution for publication (640, unchanged).
create or replace function public.clinical_review_decision_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v clinical_content_version%rowtype;
  v_conflict boolean := false;
  v_parent uuid;
begin
  select * into v from clinical_content_version where id = new.version_id;
  if not found then
    return new;
  end if;
  -- Every version of the same subject, whatever was recorded on this one.
  v_conflict := exists (
    select 1 from clinical_content_version o
     where (new.reviewer_id = o.submitted_by or new.reviewer_id = any(o.authored_by))
       and ((v.content_kind = 'competency' and coalesce(o.competency_id, o.proposed_competency_id) = coalesce(v.competency_id, v.proposed_competency_id))
         or (v.content_kind = 'case' and o.case_version_id in (select cv.id from case_library_version cv
               where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)))
         or (v.content_kind = 'resource' and o.knowledge_version_id in (select kv.id from ckri_knowledge_version kv
               where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)))
         or (v.content_kind = 'learning' and o.learning_version_id in (select lv.id from learning_offering_version lv
               where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)))));

  if not v_conflict and v.content_kind = 'competency' then
    -- The audit trail of the competency and its framework, as authorsOf reads it (src/lib/competency/clinical-review.ts).
    select d.framework_id into v_parent from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = v.competency_id;
    -- 770: a new competency of a revision has no live row yet. Its framework is the revision framework.
    if v_parent is null and v.revision_id is not null then
      select r.framework_id into v_parent from framework_revision r where r.id = v.revision_id;
    end if;
    v_conflict := exists (
      select 1 from audit_log a
       where a.actor_id = new.reviewer_id and a.entity_id in (coalesce(v.competency_id, v.proposed_competency_id), v_parent)
         and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
           'catalogue_entry_add', 'catalogue_entry_status', 'catalogue_entry_remove', 'catalogue_entry_review',
           'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set',
           'reorder_layout', 'create_area', 'rename_area', 'delete_area', 'reorder_areas', 'set_domain_area', 'move_competency_domain',
           'cfca_revision_framework_updated', 'cfca_revision_domain_created', 'cfca_revision_domain_renamed',
           'cfca_revision_practice_created', 'cfca_revision_practice_renamed', 'cfca_revision_cpu_created', 'cfca_revision_cpu_renamed'));
  elsif not v_conflict and v.content_kind = 'case' then
    v_conflict := exists (select 1 from case_library_version cv
      where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)
        and (new.reviewer_id = any(cv.authored_by) or new.reviewer_id is not distinct from cv.submitted_by));
  elsif not v_conflict and v.content_kind = 'resource' then
    v_conflict := exists (select 1 from ckri_knowledge_version kv
      where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)
        and (new.reviewer_id = any(kv.authored_by) or new.reviewer_id is not distinct from kv.submitted_by
          or new.reviewer_id is not distinct from kv.educator_reviewed_by));
  elsif not v_conflict and v.content_kind = 'learning' then
    v_conflict := exists (select 1 from learning_offering_version lv
      where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)
        and (new.reviewer_id = any(lv.authored_by) or new.reviewer_id is not distinct from lv.submitted_by));
  end if;

  if v_conflict then
    raise exception 'clinical_review_decision: not independent. The reviewer authored, edited or submitted this content or an earlier version of it';
  end if;
  return new;
end;
$$;


-- ---- 5. why a revision can no longer be applied, or null (770 body, extended) -------------------------

create or replace function public.framework_revision_problem(p_revision uuid)
returns text
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_fw uuid;
  v_name text;
begin
  select framework_id into v_fw from framework_revision where id = p_revision;
  if not found then
    return 'the revision does not exist';
  end if;
  select coalesce(c.code, c.name) into v_name from framework_revision_competency rc join framework_competencies c on c.id = rc.origin_competency_id
   where rc.revision_id = p_revision
     and not exists (select 1 from framework_domains d where d.id = c.domain_id and d.framework_id = v_fw) limit 1;
  if found then
    return format('the competency %s is no longer in this framework', v_name);
  end if;
  select coalesce(c.code, c.name) into v_name from framework_revision_competency rc join framework_competencies c on c.id = rc.origin_competency_id
   where rc.revision_id = p_revision and public.competency_content_hash(c.id) is distinct from rc.base_hash limit 1;
  if found then
    return format('the published content of %s changed after the revision started', v_name);
  end if;
  select coalesce(c.code, c.name) into v_name from framework_revision_competency rc join framework_competencies c on c.id = rc.origin_competency_id
   where rc.revision_id = p_revision
     and exists (select 1 from competency_skills s where s.competency_id = c.id
                  and not exists (select 1 from framework_revision_criterion k where k.revision_id = p_revision and k.origin_skill_id = s.id)) limit 1;
  if found then
    return format('a criterion was added to %s after the revision started', v_name);
  end if;
  if exists (select 1 from framework_revision_criterion k join competency_skills s on s.id = k.origin_skill_id
              where k.revision_id = p_revision
                and not exists (select 1 from framework_revision_competency rc where rc.revision_id = p_revision and rc.origin_competency_id = s.competency_id)) then
    return 'a criterion of the revision was moved to another competency after the revision started';
  end if;
  -- 771: new domains, practices and CPUs keep their ids and their parents.
  if exists (select 1 from framework_revision_domain rd where rd.revision_id = p_revision and rd.origin_domain_id is null
              and exists (select 1 from framework_domains d where d.id = rd.domain_id)) then
    return 'a new domain has lost its id';
  end if;
  if exists (select 1 from framework_revision_practice rp where rp.revision_id = p_revision and rp.origin_practice_id is null
              and (exists (select 1 from practices p where p.id = rp.practice_id)
                or not public.framework_revision_domain_known(p_revision, rp.domain_id))) then
    return 'a new practice has lost its domain or its id';
  end if;
  if exists (select 1 from framework_revision_cpu ru where ru.revision_id = p_revision and ru.origin_cpu_id is null
              and (exists (select 1 from clinical_practice_units u where u.id = ru.cpu_id)
                or not public.framework_revision_practice_known(p_revision, ru.practice_id))) then
    return 'a new CPU has lost its practice or its id';
  end if;
  -- 770, with the new domains of 771: a new competency sits in a live domain of the framework or a new one of the revision.
  if exists (select 1 from framework_revision_competency rc where rc.revision_id = p_revision and rc.origin_competency_id is null
              and (exists (select 1 from framework_competencies c where c.id = rc.competency_id)
                or not public.framework_revision_domain_known(p_revision, rc.domain_id))) then
    return 'a new competency has lost its domain or its id';
  end if;
  -- 771: the practice and CPU a competency of the revision names still exist (live, or new in the revision).
  select coalesce(rc.code, rc.name) into v_name from framework_revision_competency rc
   where rc.revision_id = p_revision
     and ((rc.practice_id is not null and not exists (select 1 from practices p where p.id = rc.practice_id)
             and not exists (select 1 from framework_revision_practice p where p.revision_id = p_revision and p.practice_id = rc.practice_id and p.origin_practice_id is null))
       or (rc.cpu_id is not null and not exists (select 1 from clinical_practice_units u where u.id = rc.cpu_id)
             and not exists (select 1 from framework_revision_cpu u where u.revision_id = p_revision and u.cpu_id = rc.cpu_id and u.origin_cpu_id is null))) limit 1;
  if found then
    return format('the practice or CPU that %s names no longer exists', v_name);
  end if;
  if exists (select 1 from framework_revision_criterion k where k.revision_id = p_revision and k.origin_skill_id is null
              and exists (select 1 from competency_skills s where s.id = k.skill_id)) then
    return 'a new criterion has lost its id';
  end if;
  return null;
end;
$$;


-- ---- 6. applied in the publication statement (770 body, extended) -------------------------------------

create or replace function public.frameworks_revision_apply_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_rev uuid;
  v_problem text;
  v_total integer;
  v_unapproved integer;
  v_label framework_revision%rowtype;
begin
  -- Defence in depth (the WHEN clause already says so): only a publication.
  if new.pub_status is distinct from 'published'
     or (old.pub_status is not distinct from 'published'
         and new.version_major is not distinct from old.version_major and new.version_minor is not distinct from old.version_minor
         and new.version_revision is not distinct from old.version_revision) then
    return new;
  end if;
  select * into v_label from framework_revision where framework_id = new.id and status = 'open' for update;
  if not found then
    return new;
  end if;
  v_rev := v_label.id;

  v_problem := public.framework_revision_problem(v_rev);
  if v_problem is not null then
    raise exception 'framework revision at publication: the revision can no longer be applied, %. Nothing was published and the revision is kept. Discard it and start again, then put the framework forward again', v_problem;
  end if;

  update framework_revision set status = 'applying' where id = v_rev;

  -- 771: the framework label, on the row being published (this statement).
  if v_label.framework_proposed then
    new.name := v_label.proposed_name;
    new.description := v_label.proposed_description;
  end if;

  -- 771: new domains, practices and CPUs with their pre-allocated ids, parents first, then renames by id.
  insert into framework_domains (id, framework_id, name, code, sort_order, area_id)
    select rd.domain_id, new.id, rd.name, rd.code, rd.sort_order, rd.area_id
      from framework_revision_domain rd where rd.revision_id = v_rev and rd.origin_domain_id is null;
  update framework_domains d set name = rd.name, code = rd.code
    from framework_revision_domain rd
   where rd.revision_id = v_rev and rd.origin_domain_id = d.id and (d.name, d.code) is distinct from (rd.name, rd.code);
  insert into practices (id, domain_id, name, description, code, sort_order)
    select rp.practice_id, rp.domain_id, rp.name, rp.description, rp.code, 1
      from framework_revision_practice rp where rp.revision_id = v_rev and rp.origin_practice_id is null;
  update practices p set name = rp.name, description = rp.description, code = rp.code
    from framework_revision_practice rp
   where rp.revision_id = v_rev and rp.origin_practice_id = p.id and (p.name, p.description, p.code) is distinct from (rp.name, rp.description, rp.code);
  insert into clinical_practice_units (id, practice_id, name, description, code, risk_category, complexity, reassessment_months, pub_status, sort_order)
    select ru.cpu_id, ru.practice_id, ru.name, ru.description, ru.code, ru.risk_category, ru.complexity, ru.reassessment_months, 'draft', 1
      from framework_revision_cpu ru where ru.revision_id = v_rev and ru.origin_cpu_id is null;
  update clinical_practice_units u set name = ru.name, description = ru.description, code = ru.code
    from framework_revision_cpu ru
   where ru.revision_id = v_rev and ru.origin_cpu_id = u.id and (u.name, u.description, u.code) is distinct from (ru.name, ru.description, ru.code);

  -- Existing competencies: the content fields and the code, by id. Their domain and order stay the layout draft own.
  update framework_competencies c
     set code = rc.code, name = rc.name, description = rc.description, learning_outcomes = rc.learning_outcomes,
         expected_level_id = rc.expected_level_id, practice_id = rc.practice_id, cpu_id = rc.cpu_id, risk_category = rc.risk_category
    from framework_revision_competency rc
   where rc.revision_id = v_rev and rc.origin_competency_id = c.id
     and (c.code, c.name, c.description, c.learning_outcomes, c.expected_level_id, c.practice_id, c.cpu_id, c.risk_category)
         is distinct from (rc.code, rc.name, rc.description, rc.learning_outcomes, rc.expected_level_id, rc.practice_id, rc.cpu_id, rc.risk_category);

  -- New competencies, with the ids their reviews named.
  insert into framework_competencies (id, domain_id, sort_order, code, name, description, learning_outcomes, expected_level_id, practice_id, cpu_id, risk_category)
    select rc.competency_id, rc.domain_id, rc.sort_order, rc.code, rc.name, rc.description, rc.learning_outcomes, rc.expected_level_id,
           rc.practice_id, rc.cpu_id, rc.risk_category
      from framework_revision_competency rc where rc.revision_id = v_rev and rc.origin_competency_id is null;

  -- Existing criteria, by id: text, section, competency, source, order and retirement. Never deleted.
  update competency_skills s
     set competency_id = k.competency_id, name = k.name, component_code = k.component_code, source_ref = k.source_ref,
         sort_order = k.sort_order, is_active = k.is_active
    from framework_revision_criterion k
   where k.revision_id = v_rev and k.origin_skill_id = s.id
     and (s.competency_id, s.name, s.component_code, s.source_ref, s.sort_order, s.is_active)
         is distinct from (k.competency_id, k.name, k.component_code, k.source_ref, k.sort_order, k.is_active);

  -- New criteria, with their ids.
  insert into competency_skills (id, competency_id, name, component_code, source_ref, sort_order, is_active)
    select k.skill_id, k.competency_id, k.name, k.component_code, k.source_ref, k.sort_order, k.is_active
      from framework_revision_criterion k where k.revision_id = v_rev and k.origin_skill_id is null;

  -- The reviews of new competencies now name them.
  update clinical_content_version set competency_id = proposed_competency_id
   where revision_id = v_rev and competency_id is null and proposed_competency_id is not null;

  -- Exactly what was reviewed: every competency of the revision now hashes as its proposal did.
  if exists (select 1 from framework_revision_competency rc where rc.revision_id = v_rev
              and public.competency_content_hash(rc.competency_id) is distinct from public.framework_revision_competency_hash(v_rev, rc.competency_id)) then
    raise exception 'framework revision at publication: the applied content does not hash as the revision did. Nothing was published';
  end if;
  -- The 466 predicate over the applied content, here too: 466 fires on an update OF pub_status only, so a statement that
  -- changes the version alone must not apply content that is not clinically approved.
  select count(*), count(*) filter (where not public.competency_clinically_approved(c.id)) into v_total, v_unapproved
    from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = new.id;
  if v_unapproved > 0 then
    raise exception 'cfca publication: % of % competencies are not clinically approved at their current content', v_unapproved, v_total;
  end if;
  return new;
end;
$$;


-- ---- 7. grants: the HQ server (service role) only ----------------------------------------------------

revoke execute on function public.framework_revision_proposal_guard() from public, anon, authenticated;
revoke execute on function public.framework_revision_structure_guard() from public, anon, authenticated;
revoke execute on function public.framework_revision_domain_known(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_practice_known(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.clinical_scope_covers_domain(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_problem(uuid) from public, anon, authenticated;
revoke execute on function public.frameworks_revision_apply_on_publish() from public, anon, authenticated;
grant execute on function public.framework_revision_problem(uuid) to service_role;

comment on table framework_revision_domain is
  '771: a domain rename (origin_domain_id = domain_id) or a NEW domain (pre-allocated id) proposed in a revision draft. Applied only in the framework publication statement.';
comment on table framework_revision_practice is
  '771: a practice rename or a NEW practice (pre-allocated id) proposed in a revision draft. Applied only in the framework publication statement.';
comment on table framework_revision_cpu is
  '771: a CPU rename or a NEW CPU (pre-allocated id, risk) proposed in a revision draft. Applied only in the framework publication statement.';
comment on function public.frameworks_revision_apply_on_publish() is
  '770 + 771: applies the open revision (framework label, domains, practices, CPUs, competencies, criteria) to the live rows in the publication statement, BEFORE the 466 and 640 guards judge it. Inserts with pre-allocated ids and updates by id, never deletes.';


-- Verification: the new tables with RLS on and no policy, the three foreign keys gone, the triggers, nothing proposed.
select 'tables_rls_no_policy' as item, count(*)::text as value from pg_class c
 where c.relname in ('framework_revision_domain', 'framework_revision_practice', 'framework_revision_cpu') and c.relrowsecurity
   and not exists (select 1 from pg_policies p where p.tablename = c.relname)
union all select 'revision_competency_fks', string_agg(conname, ',' order by conname) from pg_constraint
 where conrelid = 'framework_revision_competency'::regclass and contype = 'f'
union all select 'structure_triggers', count(*)::text from pg_trigger where tgname in ('framework_revision_structure_guard', 'framework_revision_proposal_guard') and not tgisinternal
union all select 'proposed', (select count(*) from framework_revision where framework_proposed)::text || ' labels, '
   || (select count(*) from framework_revision_domain)::text || ' domains, ' || (select count(*) from framework_revision_practice)::text || ' practices, '
   || (select count(*) from framework_revision_cpu)::text || ' cpus';

notify pgrst, 'reload schema';
