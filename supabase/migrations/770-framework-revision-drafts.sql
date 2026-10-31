-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and sql functions between dollar quotes and a do-block. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 770: REVISION DRAFTS FOR PUBLISHED COMPETENCY FRAMEWORKS
--
-- FRAMEWORK-DESIGN-STUDIO-02, owner ruling D2 (31 Oct 2026): content changes to a PUBLISHED framework go into an
-- editable revision draft. Learners and assessors keep reading the published content, unchanged, until the proposed
-- content is clinically approved by an independent reviewer and released by an independent publisher. Then it is
-- applied to the live rows in the publication statement itself, whole or not at all (as 752 does for a layout).
-- Build record: docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/770-build-record.md
--
-- APPLY ON STAGING FIRST. ADDITIVE. Three tables, two nullable columns on clinical_content_version, one index, one
-- check replaced (widened for the new case only), new functions and triggers, four function bodies replaced. No
-- existing row is changed. Re-running it is a no-op. OPS-001 s8: proposed Medium (new triggers on frameworks, guards
-- of the clinical review replaced), so it carries a staging rollback rehearsal.
-- Application order: 750, 751, 752, 760, 761, then 770. The file refuses (nothing changed) without them.
-- Depends on 395 (clinical review), 466 (trg_cfca_framework_publication_guard, unchanged), 640
-- (trg_frameworks_sod_publication_guard, unchanged, and clinical_content_version_sod_floor), 641 (decision scope
-- guard, unchanged), 690 (clinical_review_decision_guard body), 751 (outcome ids), 752 (layout apply), 760
-- (clinical_review_decision_sod_guard body) and 761 (competency_content_hash and clinical_content_version_guard bodies).
--
-- ----------------------------------------------------------------------------------------------------
-- 1. STORAGE, VALIDATED BY THE SCHEMA.
--    framework_revision            one OPEN revision per framework at most (unique on a generated column, not a partial
--                                  index). Opened only on a shared, CFCA, published framework. open, then applying and
--                                  published (only inside the publication statement) or discarded. Never deleted.
--    framework_revision_competency the PROPOSED content of a competency, a full copy of the fields the content hash
--                                  covers plus its code. competency_id is the STABLE id: the live id (origin_competency_id,
--                                  same value) or, for a new competency, the id it will have when published (pre-allocated,
--                                  checked unused). A new one names its live domain and place. base_hash is the live hash
--                                  when the copy was made, computed by the trigger.
--    framework_revision_criterion  the PROPOSED criteria of each revision competency, the whole set (active and retired).
--                                  skill_id is the stable id (origin_skill_id, same value, or pre-allocated). A move to
--                                  another competency, or another section, is a change of its competency_id or
--                                  component_code. Its competency must be in the revision (composite foreign key), and a
--                                  live criterion enters only with its own competency, so both sides of a move are in it.
--    framework_revision_add_competency copies a live competency and every criterion of it in one statement.
--    RLS on, no policy: invisible to every signed-in or anonymous read. Every live table is untouched until publication.
--
-- 2. CLINICAL REVIEW OF THE PROPOSED CONTENT, AGAINST THE STABLE ID.
--    framework_revision_competency_hash(revision, competency) is competency_content_hash (761) over the revision rows:
--    the same keys, types, order and active-only criteria, so the proposed hash IS the hash the live row will have.
--    clinical_content_version gains revision_id and proposed_competency_id. A version with revision_id set has its hash
--    and snapshot computed from the revision by the 761 guard (extended), and is bound to the live competency id, or, for
--    a NEW competency, names its pre-allocated id in proposed_competency_id (competency_id null until publication).
--    The 690 decision guard (extended) treats a version as current when it matches the live content OR the content
--    proposed in the open revision, and scopes a new competency by its proposed domain. The 760 SoD guard (extended)
--    reads the same subject and audit trail by the stable id, so whoever authored a revision change of a competency is
--    an author of it and cannot approve it. The 640 floor (extended) uses the PROPOSED risk.
--
-- 3. APPLIED IN THE PUBLICATION STATEMENT. frameworks_revision_apply_on_publish, BEFORE UPDATE OF pub_status, version_*
--    on frameworks, for a publication (the row becomes published, or a published row takes a new version, as 640 and
--    752 read it) of a framework with an open revision. Its name sorts BEFORE trg_cfca_framework_publication_guard (466)
--    and trg_frameworks_sod_publication_guard (640), so those guards, UNCHANGED, judge the content as it will be
--    published: 466 that every competency is approved at its (new) current content, 640 that the publisher authored
--    none of it, new competencies included. It
--      1  refuses a revision that can no longer be applied (live content changed since the copy, a criterion added to or
--         moved out of a revision competency live, a domain or an id gone or taken), nothing written
--      2  marks the revision applying, updates the existing competencies and criteria by their ids, inserts new ones with
--         their pre-allocated ids, retires by is_active false, NEVER deletes
--      3  binds the versions of new competencies to their now live ids (the only update a version may take)
--      4  asserts every revision competency now hashes exactly as reviewed, or refuses the whole statement
--      5  refuses unless every competency is clinically approved at the applied content, the 466 predicate, here too,
--         because 466 fires only on an update OF pub_status and a statement could change the version alone
--    If any later guard refuses, the statement and every write above roll back. frameworks_revision_release_on_publish
--    (AFTER, so only for a row actually written) marks it published with the released version, and a deferred
--    constraint trigger refuses to commit a revision left applying (a BEFORE trigger that skipped the row would leave
--    it so). framework_versions keeps every earlier version. Stored evidence, assessment and Passport rows keep their ids.
--
-- NOT CHANGED: 466 and 640 publication guards, 641 scope guard, 751 outcome-id trigger, 752 and 760 layout apply (which
-- runs after, AFTER ROW, over the applied content), competency_content_hash, competency_clinically_approved.
-- NOT ACTIVATED. No revision exists until the app opens one.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/ROLLBACK-770.sql
-- ====================================================================================================

do $pre$
begin
  if to_regprocedure('public.competency_content_hash_covers_retirement()') is null then
    raise exception '770: apply 761 first (the active-criteria content hash). Nothing was changed';
  end if;
  if to_regclass('public.framework_areas') is null then
    raise exception '770: apply 760 first (its clinical_review_decision_sod_guard body is the one extended here). Nothing was changed';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'frameworks_layout_apply_on_publish' and tgrelid = 'public.frameworks'::regclass) then
    raise exception '770: apply 752 first. Nothing was changed';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_content_version' and column_name = 'method_version_id') then
    raise exception '770: apply 690 first. Nothing was changed';
  end if;
end
$pre$;


-- ---- 1. the revision and its proposed rows ------------------------------------------------------------

create table if not exists framework_revision (
  id               uuid primary key default gen_random_uuid(),
  framework_id     uuid not null references frameworks(id) on delete cascade,
  status           text not null default 'open',
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_by        uuid,
  closed_at        timestamptz,
  released_version text,
  open_framework_id uuid generated always as (case when status in ('open', 'applying') then framework_id end) stored
);
alter table framework_revision drop constraint if exists framework_revision_check;
alter table framework_revision add constraint framework_revision_check
  check (status in ('open', 'applying', 'published', 'discarded')
     and ((status in ('open', 'applying')) = (closed_at is null))
     and (released_version is null or status = 'published'));
create unique index if not exists ux_framework_revision_open on framework_revision(open_framework_id);
create index if not exists idx_framework_revision_framework on framework_revision(framework_id);
alter table framework_revision enable row level security;

create table if not exists framework_revision_competency (
  id                   uuid primary key default gen_random_uuid(),
  revision_id          uuid not null references framework_revision(id) on delete cascade,
  competency_id        uuid not null,
  origin_competency_id uuid references framework_competencies(id) on delete cascade,
  domain_id            uuid references framework_domains(id) on delete cascade,
  sort_order           integer,
  code                 text,
  name                 text not null,
  description          text,
  learning_outcomes    jsonb not null default '[]'::jsonb,
  expected_level_id    uuid references scoring_levels(id) on delete set null,
  practice_id          uuid references practices(id) on delete set null,
  cpu_id               uuid references clinical_practice_units(id) on delete set null,
  risk_category        text,
  base_hash            text,
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  updated_by           uuid,
  updated_at           timestamptz not null default now()
);
alter table framework_revision_competency drop constraint if exists framework_revision_competency_check;
alter table framework_revision_competency add constraint framework_revision_competency_check
  check ((origin_competency_id is null or origin_competency_id = competency_id)
     and ((origin_competency_id is null and domain_id is not null and sort_order is not null and base_hash is null)
       or (origin_competency_id is not null and domain_id is null and sort_order is null and base_hash is not null))
     and jsonb_typeof(learning_outcomes) = 'array'
     and char_length(btrim(name)) > 0);
create unique index if not exists ux_framework_revision_competency on framework_revision_competency(revision_id, competency_id);
create index if not exists idx_framework_revision_competency_subject on framework_revision_competency(competency_id);
alter table framework_revision_competency enable row level security;

create table if not exists framework_revision_criterion (
  id               uuid primary key default gen_random_uuid(),
  revision_id      uuid not null references framework_revision(id) on delete cascade,
  skill_id         uuid not null,
  origin_skill_id  uuid references competency_skills(id) on delete cascade,
  competency_id    uuid not null,
  name             text not null,
  component_code   text references competency_assessment_component(code) on delete restrict,
  source_ref       text,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  foreign key (revision_id, competency_id) references framework_revision_competency(revision_id, competency_id) on delete cascade
);
alter table framework_revision_criterion drop constraint if exists framework_revision_criterion_check;
alter table framework_revision_criterion add constraint framework_revision_criterion_check
  check ((origin_skill_id is null or origin_skill_id = skill_id)
     and char_length(btrim(name)) > 0
     and (source_ref is null or char_length(source_ref) <= 300));
create unique index if not exists ux_framework_revision_criterion on framework_revision_criterion(revision_id, skill_id);
create index if not exists idx_framework_revision_criterion_competency on framework_revision_criterion(revision_id, competency_id);
alter table framework_revision_criterion enable row level security;


-- ---- 2. the proposed content hash, with exactly the semantics of competency_content_hash (761) ----------

create or replace function public.framework_revision_competency_hash(p_revision uuid, p_competency uuid)
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
    'skills', coalesce((select jsonb_agg(s.name || coalesce(' [' || s.component_code || ']', '') order by s.name, s.skill_id)
                          from framework_revision_criterion s
                         where s.revision_id = c.revision_id and s.competency_id = c.competency_id and s.is_active is not false), '[]'::jsonb)
  )::text)
  from framework_revision_competency c
  where c.revision_id = p_revision and c.competency_id = p_competency
$$;

-- The snapshot a version stores beside that hash: the shape of the 761 competency snapshot, over the revision rows.
create or replace function public.framework_revision_competency_snapshot(p_revision uuid, p_competency uuid)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object('name', c.name, 'description', c.description, 'learning_outcomes', c.learning_outcomes,
      'expected_level_id', c.expected_level_id, 'practice_id', c.practice_id, 'cpu_id', c.cpu_id, 'risk_category', c.risk_category,
      'skills', coalesce((select jsonb_agg(s.name order by s.name, s.skill_id) from framework_revision_criterion s
                           where s.revision_id = c.revision_id and s.competency_id = c.competency_id and s.is_active is not false), '[]'::jsonb))
    from framework_revision_competency c
   where c.revision_id = p_revision and c.competency_id = p_competency
$$;

-- Every competency of one revision: its proposed hash beside the live hash and the live hash when it was copied.
create or replace function public.framework_revision_hashes(p_revision uuid)
returns table (competency_id uuid, origin_competency_id uuid, proposed_hash text, base_hash text, live_hash text)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.competency_id, c.origin_competency_id, public.framework_revision_competency_hash(c.revision_id, c.competency_id),
         c.base_hash, case when c.origin_competency_id is null then null else public.competency_content_hash(c.origin_competency_id) end
    from framework_revision_competency c
   where c.revision_id = p_revision
$$;

-- The competencies, among p_ids, proposed in an OPEN revision, with where each sits (for the review queue and status).
create or replace function public.framework_revision_open_hashes(p_ids uuid[])
returns table (competency_id uuid, revision_id uuid, framework_id uuid, domain_id uuid, proposed_hash text, is_new boolean)
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.competency_id, c.revision_id, r.framework_id, coalesce(c.domain_id, (select x.domain_id from framework_competencies x where x.id = c.origin_competency_id)),
         public.framework_revision_competency_hash(c.revision_id, c.competency_id), c.origin_competency_id is null
    from framework_revision_competency c join framework_revision r on r.id = c.revision_id
   where r.status = 'open' and c.competency_id = any(p_ids)
$$;

-- Whether a hash is a CURRENT content of a competency: its live content, or what the open revision proposes for it.
create or replace function public.competency_review_current(p_competency uuid, p_hash text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select p_hash is not null and (
    exists (select 1 from framework_competencies c where c.id = p_competency and public.competency_content_hash(c.id) = p_hash)
    or exists (select 1 from framework_revision_competency rc join framework_revision r on r.id = rc.revision_id
                where r.status = 'open' and rc.competency_id = p_competency
                  and public.framework_revision_competency_hash(rc.revision_id, rc.competency_id) = p_hash))
$$;

-- The 395 scope rule for a domain (clinical_scope_covers reads it through a live competency).
create or replace function public.clinical_scope_covers_domain(p_appointment uuid, p_domain uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_reviewer_scope s
      join framework_domains d on d.id = p_domain
      join frameworks f on f.id = d.framework_id
     where s.appointment_id = p_appointment
       and s.ended_at is null
       and ((s.scope_kind = 'profession' and s.scope_ref = f.profession_term_id)
         or (s.scope_kind = 'specialty' and s.scope_ref = f.specialty_term_id)
         or (s.scope_kind = 'framework' and s.scope_ref = f.id)
         or (s.scope_kind = 'domain' and s.scope_ref = d.id))
  )
$$;


-- ---- 3. the guards on the revision rows ----------------------------------------------------------------

create or replace function public.framework_revision_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'framework_revision: a revision is never deleted. Discard it instead';
  end if;
  if tg_op = 'INSERT' then
    if new.status is distinct from 'open' or new.closed_at is not null or new.closed_by is not null or new.released_version is not null then
      raise exception 'framework_revision: a revision starts open';
    end if;
    if not exists (select 1 from frameworks f where f.id = new.framework_id and f.hospital_id is null and f.competency_layer is not null
                    and f.pub_status = 'published') then
      raise exception 'framework_revision: a revision is opened only on a shared, centrally governed, published framework';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.framework_id is distinct from old.framework_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'framework_revision: what a revision is of, and who opened it, never change';
  end if;
  if old.status in ('published', 'discarded') then
    raise exception 'framework_revision: this revision is closed. Open a new one';
  end if;
  if new.status = old.status then
    if new.closed_by is distinct from old.closed_by or new.closed_at is distinct from old.closed_at or new.released_version is distinct from old.released_version then
      raise exception 'framework_revision: only its status closes a revision';
    end if;
    return new;
  end if;
  if old.status = 'open' and new.status = 'discarded' then
    if new.closed_by is null or new.released_version is not null then
      raise exception 'framework_revision: a discarded revision records who discarded it and releases nothing';
    end if;
    new.closed_at := now();
    new.updated_at := now();
    return new;
  end if;
  if old.status = 'open' and new.status = 'applying' and pg_trigger_depth() > 1 then
    return new;
  end if;
  if old.status = 'applying' and new.status = 'published' and pg_trigger_depth() > 1 then
    new.closed_at := now();
    return new;
  end if;
  raise exception 'framework_revision: a revision is published only by publishing its framework, or discarded';
end;
$$;

drop trigger if exists framework_revision_guard on framework_revision;
create trigger framework_revision_guard
  before insert or update or delete on framework_revision
  for each row execute function public.framework_revision_guard();

-- Committed only settled: a revision is never left applying (its publication statement did not complete).
create or replace function public.framework_revision_settled()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from framework_revision r where r.id = new.id and r.status = 'applying') then
    raise exception 'framework revision: it was applied but its framework was not published in the same statement, so nothing is kept';
  end if;
  return null;
end;
$$;

drop trigger if exists framework_revision_settled on framework_revision;
create constraint trigger framework_revision_settled
  after insert or update on framework_revision
  deferrable initially deferred
  for each row execute function public.framework_revision_settled();

-- The proposed content of a competency: only in an open revision, of its own framework, ids that cannot be confused.
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
  if new.origin_competency_id is null and not exists (select 1 from framework_domains d where d.id = new.domain_id and d.framework_id = v_fw) then
    raise exception 'framework_revision_competency: a new competency is proposed in a domain of the framework of this revision';
  end if;
  new.updated_at := now();
  update framework_revision set updated_at = now() where id = new.revision_id;
  return new;
end;
$$;

drop trigger if exists framework_revision_competency_guard on framework_revision_competency;
create trigger framework_revision_competency_guard
  before insert or update or delete on framework_revision_competency
  for each row execute function public.framework_revision_competency_guard();

-- The proposed criteria: only in an open revision. A published criterion enters only with its own competency.
create or replace function public.framework_revision_criterion_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_rev uuid := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if not exists (select 1 from framework_revision r where r.id = v_rev and r.status = 'open') then
    raise exception 'framework_revision_criterion: the revision is not open';
  end if;
  if tg_op = 'DELETE' then
    if old.origin_skill_id is not null then
      raise exception 'framework_revision_criterion: a published criterion is never removed. Retire it instead';
    end if;
    update framework_revision set updated_at = now() where id = old.revision_id;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.revision_id is distinct from old.revision_id or new.skill_id is distinct from old.skill_id
       or new.origin_skill_id is distinct from old.origin_skill_id or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'framework_revision_criterion: which criterion this is never changes';
    end if;
  else
    if new.origin_skill_id is not null then
      if not exists (select 1 from competency_skills s join framework_revision_competency rc
                        on rc.revision_id = new.revision_id and rc.origin_competency_id = s.competency_id
                      where s.id = new.origin_skill_id) then
        raise exception 'framework_revision_criterion: a published criterion enters a revision only with its own competency';
      end if;
    elsif exists (select 1 from competency_skills s where s.id = new.skill_id) then
      raise exception 'framework_revision_criterion: a new criterion takes a new id';
    end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  update framework_revision set updated_at = now() where id = new.revision_id;
  return new;
end;
$$;

drop trigger if exists framework_revision_criterion_guard on framework_revision_criterion;
create trigger framework_revision_criterion_guard
  before insert or update or delete on framework_revision_criterion
  for each row execute function public.framework_revision_criterion_guard();


-- ---- 4. opening a revision and bringing a competency into it, each in one statement --------------------

create or replace function public.framework_revision_open(p_framework uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v uuid;
begin
  select id into v from framework_revision where framework_id = p_framework and status = 'open';
  if found then
    return v;
  end if;
  insert into framework_revision (framework_id, created_by) values (p_framework, p_actor)
    on conflict (open_framework_id) do nothing returning id into v;
  if v is null then
    select id into v from framework_revision where framework_id = p_framework and status in ('open', 'applying');
  end if;
  return v;
end;
$$;

-- A live competency and EVERY criterion of it (active and retired), copied whole. Already there: its row id.
create or replace function public.framework_revision_add_competency(p_revision uuid, p_competency uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v uuid;
begin
  select id into v from framework_revision_competency where revision_id = p_revision and competency_id = p_competency;
  if found then
    return v;
  end if;
  insert into framework_revision_competency (revision_id, competency_id, origin_competency_id, code, name, description, learning_outcomes,
      expected_level_id, practice_id, cpu_id, risk_category, created_by, updated_by)
    select p_revision, c.id, c.id, c.code, c.name, c.description, c.learning_outcomes, c.expected_level_id, c.practice_id, c.cpu_id,
           c.risk_category, p_actor, p_actor
      from framework_competencies c where c.id = p_competency
    returning id into v;
  if v is null then
    raise exception 'framework_revision_add_competency: unknown competency';
  end if;
  insert into framework_revision_criterion (revision_id, skill_id, origin_skill_id, competency_id, name, component_code, source_ref, sort_order,
      is_active, created_by, updated_by)
    select p_revision, s.id, s.id, s.competency_id, s.name, s.component_code, s.source_ref, s.sort_order, s.is_active, p_actor, p_actor
      from competency_skills s where s.competency_id = p_competency;
  return v;
end;
$$;


-- ---- 5. why a revision can no longer be applied, or null ----------------------------------------------

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
  if exists (select 1 from framework_revision_competency rc where rc.revision_id = p_revision and rc.origin_competency_id is null
              and (exists (select 1 from framework_competencies c where c.id = rc.competency_id)
                or not exists (select 1 from framework_domains d where d.id = rc.domain_id and d.framework_id = v_fw))) then
    return 'a new competency has lost its domain or its id';
  end if;
  if exists (select 1 from framework_revision_criterion k where k.revision_id = p_revision and k.origin_skill_id is null
              and exists (select 1 from competency_skills s where s.id = k.skill_id)) then
    return 'a new criterion has lost its id';
  end if;
  return null;
end;
$$;


-- ---- 6. applied in the publication statement ----------------------------------------------------------

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
begin
  -- Defence in depth (the WHEN clause already says so): only a publication.
  if new.pub_status is distinct from 'published'
     or (old.pub_status is not distinct from 'published'
         and new.version_major is not distinct from old.version_major and new.version_minor is not distinct from old.version_minor
         and new.version_revision is not distinct from old.version_revision) then
    return new;
  end if;
  select id into v_rev from framework_revision where framework_id = new.id and status = 'open' for update;
  if not found then
    return new;
  end if;

  v_problem := public.framework_revision_problem(v_rev);
  if v_problem is not null then
    raise exception 'framework revision at publication: the revision can no longer be applied, %. Nothing was published and the revision is kept. Discard it and start again, then put the framework forward again', v_problem;
  end if;

  update framework_revision set status = 'applying' where id = v_rev;

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

drop trigger if exists frameworks_revision_apply_on_publish on frameworks;
create trigger frameworks_revision_apply_on_publish
  before update of pub_status, version_major, version_minor, version_revision on frameworks
  for each row
  when (new.pub_status = 'published'
        and (old.pub_status is distinct from 'published'
             or new.version_major is distinct from old.version_major
             or new.version_minor is distinct from old.version_minor
             or new.version_revision is distinct from old.version_revision))
  execute function public.frameworks_revision_apply_on_publish();

-- After the row is written (every BEFORE guard accepted it): the revision is published, with the version it released.
create or replace function public.frameworks_revision_release_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update framework_revision
     set status = 'published', closed_by = new.published_by,
         released_version = coalesce(new.version_major, 1) || '.' || coalesce(new.version_minor, 0) || '.' || coalesce(new.version_revision, 0)
   where framework_id = new.id and status = 'applying';
  return null;
end;
$$;

drop trigger if exists frameworks_revision_release_on_publish on frameworks;
create trigger frameworks_revision_release_on_publish
  after update of pub_status, version_major, version_minor, version_revision on frameworks
  for each row
  when (new.pub_status = 'published'
        and (old.pub_status is distinct from 'published'
             or new.version_major is distinct from old.version_major
             or new.version_minor is distinct from old.version_minor
             or new.version_revision is distinct from old.version_revision))
  execute function public.frameworks_revision_release_on_publish();


-- ---- 7. clinical review of the proposed content ------------------------------------------------------

alter table clinical_content_version add column if not exists revision_id uuid references framework_revision(id) on delete cascade;
alter table clinical_content_version add column if not exists proposed_competency_id uuid;

alter table clinical_content_version drop constraint if exists clinical_content_version_subject_check;
alter table clinical_content_version add constraint clinical_content_version_subject_check
  check ((content_kind = 'competency' and (competency_id is not null or (revision_id is not null and proposed_competency_id is not null)) and case_version_id is null and knowledge_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'case' and case_version_id is not null and competency_id is null and knowledge_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'resource' and knowledge_version_id is not null and competency_id is null and case_version_id is null and learning_version_id is null and method_version_id is null)
      or (content_kind = 'learning' and learning_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null and method_version_id is null)
      or (content_kind = 'method' and method_version_id is not null and competency_id is null and case_version_id is null and knowledge_version_id is null and learning_version_id is null));
alter table clinical_content_version drop constraint if exists clinical_content_version_revision_check;
alter table clinical_content_version add constraint clinical_content_version_revision_check
  check ((revision_id is null or content_kind = 'competency')
     and (proposed_competency_id is null or (revision_id is not null and (competency_id is null or competency_id = proposed_competency_id))));
create unique index if not exists ux_clinical_content_version_proposed_hash on clinical_content_version(proposed_competency_id, content_hash);
create index if not exists idx_clinical_content_version_revision on clinical_content_version(revision_id);

-- The 761 body of clinical_content_version_guard, with the revision branch and the binding update (770).

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
  v_rc framework_revision_competency%rowtype;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  -- 770: the one write that is not an insert. When a revision is applied in its publication statement, a version of a
  -- NEW competency is bound to the competency it named, which now exists with that id. No other column may change.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and old.content_kind = 'competency' and old.competency_id is null
     and old.proposed_competency_id is not null and new.competency_id is not distinct from old.proposed_competency_id
     and (to_jsonb(new) - 'competency_id') = (to_jsonb(old) - 'competency_id')
     and exists (select 1 from framework_competencies c where c.id = old.proposed_competency_id)
     and exists (select 1 from framework_revision r where r.id = old.revision_id and r.status = 'applying') then
    return new;
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
  -- 770: a version of the content PROPOSED in an open revision draft. The database computes the hash and the snapshot
  -- from the revision rows, with exactly the semantics of competency_content_hash, and binds the version to the stable
  -- competency id (the live id, or the id a new competency will have when the revision is published).
  if new.revision_id is not null then
    select * into v_rc from framework_revision_competency rc
     where rc.revision_id = new.revision_id and rc.competency_id = coalesce(new.competency_id, new.proposed_competency_id);
    if not found then
      raise exception 'clinical_content_version: that competency is not in this revision';
    end if;
    if not exists (select 1 from framework_revision r join frameworks f on f.id = r.framework_id
                    where r.id = new.revision_id and r.status = 'open' and f.hospital_id is null) then
      raise exception 'clinical_content_version: a revision is put forward for review only while it is open, in a shared framework';
    end if;
    if v_rc.origin_competency_id is null then
      new.competency_id := null;
      new.proposed_competency_id := v_rc.competency_id;
    else
      new.competency_id := v_rc.origin_competency_id;
      new.proposed_competency_id := null;
    end if;
    new.content_hash := public.framework_revision_competency_hash(new.revision_id, v_rc.competency_id);
    new.content_snapshot := public.framework_revision_competency_snapshot(new.revision_id, v_rc.competency_id);
    new.created_at := now();
    return new;
  end if;
  if new.proposed_competency_id is not null then
    raise exception 'clinical_content_version: only a version of a revision names a proposed competency';
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

-- The 640 body of clinical_content_version_sod_floor, with the proposed risk of a revision version (770).

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
    select case when rc.risk_category = 'high' or u.risk_category = 'high' then 'high' else 'standard' end into v_risk
      from framework_revision_competency rc left join clinical_practice_units u on u.id = rc.cpu_id
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

-- The 690 body of clinical_review_decision_guard, with the scope of a new competency and the open revision as current (770).

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
    -- 770: a NEW competency proposed in a revision has no live row yet. It is in scope by the domain it is proposed in.
    if v_version.competency_id is null then
      if not exists (select 1 from framework_revision_competency rc
                      where rc.revision_id = v_version.revision_id and rc.competency_id = v_version.proposed_competency_id
                        and public.clinical_scope_covers_domain(new.appointment_id, rc.domain_id)) then
        raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers the competency';
      end if;
    elsif not clinical_scope_covers(new.appointment_id, v_version.competency_id) then
      raise exception 'clinical_review_decision: out of scope. No active scope of this appointment covers the competency';
    end if;
    -- 770: current means the live content, or the content proposed for it in the open revision of its framework.
    if not public.competency_review_current(coalesce(v_version.competency_id, v_version.proposed_competency_id), v_version.content_hash) then
      raise exception 'clinical_review_decision: stale. The content has changed since this version, so it needs a new version and renewed approval';
    end if;
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- The 760 body of clinical_review_decision_sod_guard, reading the subject by its stable id (770).

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
           'reorder_layout', 'create_area', 'rename_area', 'delete_area', 'reorder_areas', 'set_domain_area', 'move_competency_domain'));
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


-- ---- 8. grants: the HQ server (service role) only ----------------------------------------------------

revoke execute on function public.framework_revision_competency_hash(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_competency_snapshot(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_hashes(uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_open_hashes(uuid[]) from public, anon, authenticated;
revoke execute on function public.competency_review_current(uuid, text) from public, anon, authenticated;
revoke execute on function public.clinical_scope_covers_domain(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_open(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_add_competency(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.framework_revision_problem(uuid) from public, anon, authenticated;
revoke execute on function public.frameworks_revision_apply_on_publish() from public, anon, authenticated;
revoke execute on function public.frameworks_revision_release_on_publish() from public, anon, authenticated;
grant execute on function public.framework_revision_hashes(uuid) to service_role;
grant execute on function public.framework_revision_open_hashes(uuid[]) to service_role;
grant execute on function public.framework_revision_open(uuid, uuid) to service_role;
grant execute on function public.framework_revision_add_competency(uuid, uuid, uuid) to service_role;
grant execute on function public.framework_revision_problem(uuid) to service_role;

comment on table framework_revision is
  '770: a revision draft of a published framework (ruling D2). At most one open. Applied to the live rows only in its framework publication statement.';
comment on table framework_revision_competency is
  '770: the proposed content of one competency in a revision. competency_id is the stable id (live, or pre-allocated for a new one).';
comment on table framework_revision_criterion is
  '770: the proposed criteria of the competencies of a revision, the whole set. skill_id is the stable id (live, or pre-allocated).';
comment on function public.framework_revision_competency_hash(uuid, uuid) is
  '770: competency_content_hash (761) over the revision rows. Equal to the live hash the competency will have when the revision is applied.';
comment on function public.frameworks_revision_apply_on_publish() is
  '770: applies the open revision to the live rows in the publication statement, BEFORE the 466 and 640 guards judge it. Updates and inserts by stable id, never deletes.';


-- Verification: the tables with RLS on and no policy, the triggers on frameworks in firing order, no revision yet, and
-- every existing version still satisfies the widened checks.
select 'tables_rls_no_policy' as item, count(*)::text as value from pg_class c
 where c.relname in ('framework_revision', 'framework_revision_competency', 'framework_revision_criterion') and c.relrowsecurity
   and not exists (select 1 from pg_policies p where p.tablename = c.relname)
union all select 'frameworks_before_triggers', string_agg(tgname, ',' order by tgname) from pg_trigger
 where tgrelid = 'frameworks'::regclass and not tgisinternal and (tgtype & 2) = 2
union all select 'frameworks_after_triggers', string_agg(tgname, ',' order by tgname) from pg_trigger
 where tgrelid = 'frameworks'::regclass and not tgisinternal and (tgtype & 2) = 0
union all select 'revisions', count(*)::text from framework_revision
union all select 'versions_with_revision', count(*)::text from clinical_content_version where revision_id is not null or proposed_competency_id is not null;

notify pgrst, 'reload schema';
