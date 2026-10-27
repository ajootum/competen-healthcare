-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It defines plpgsql functions and triggers between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 620: ORGANISATION AND GOVERNANCE STUDIO (COMPETEN-SCHOLAR-GOV-IMPLEMENT-01, ADDENDUM V1.2)
--
-- Owner direction, 27 Oct 2026: make the organisation and governance structure fully no-code configurable,
-- as a shared Competen Holdings capability reusable across Scholar, Enterprise, Practice and Recruitment.
-- Extends 610. Does not rebuild it. Staging first. Production needs its own owner GO.
--
-- DEPENDS ON 610 (the hq_gov registry), 500 (hq_actor_is_owner, hq_position_capability guard), 511 (the
-- last definition of hq_capability_sensitive_class, replaced here with one code added), 281
-- (plat_product_line), 264 and 116/117. APPLY AFTER 610. Additive. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- THE MODEL. A STRUCTURE is one governance context, keyed to a product line (Scholar is product line
-- individual). A structure has VERSIONS. A version holds the whole structure as one definition document:
-- levels, units (boards, committees, departments, portfolios, shared services), positions (seats),
-- relationships and their types, workflow links and independence pairs.
--
--   Draft -> Review -> Approved -> Published -> Superseded   (a draft or review may also be discarded)
--
-- Only a draft is edited. Publishing PROJECTS the version into the 610 tables, which every existing
-- screen, guard and separation-of-duties check already reads. So the 610 rules keep applying to whatever
-- is published, and the publication is atomic: a version that breaks any 610 constraint or guard does not
-- publish at all. A published version is immutable and stays readable as history.
--
-- NOTHING IS DELETED. An item in the published structure must appear in every later draft. To remove it,
-- it is RETIRED (is_active false, retired_version_id set). A position with a live appointment cannot be
-- retired, and a unit cannot be retired while it holds an active position. An existing relationship never
-- changes its bodies, type or scope (the 610 guard). It is retired and a new one is added instead. A new
-- relationship is always published PENDING, so publication never activates a delegation.
--
-- HISTORY IS NEVER RE-POINTED. A seat appointment records the structure version it was made under, and a
-- relationship decision records the version in force. Rows recorded before this migration carry null,
-- which means version 1: it is the only structure that existed before 620.
--
-- WHO MAY DO WHAT (the smallest safe gate, recorded in the build record):
--   edit, submit, return, discard a draft, add a relationship type   owner, or a holder of the new
--                                     hq.platform.governance.manage through an active HQ appointment.
--                                     The capability is granted to NO position. It is platform-sensitive,
--                                     so granting it needs the 500 acknowledgement.
--   approve and publish               platform owner only. An owner approving a version they edited or
--                                     submitted is recorded as self_approved.
--   create a structure                platform owner only.
-- No structure change grants anything: seats have no capability, and linking a seat to an hq_position is
-- a reference. Appointments, structure and executable capability stay three separate things.
--
-- WHAT IS SEEDED. The Scholar structure, its 610 content as VERSION 1 (published, effective 27 Oct 2026),
-- eight relationship types, and the capability. Nobody is appointed. No grant is made. No 610 row is
-- changed except the new version columns being filled in.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/SCHOLAR-GOV-IMPLEMENT-01/ROLLBACK-620.sql
-- ====================================================================================================

-- 1. The capability. Granted to no position.
insert into hq_capability (code, space, label, description) values
  ('hq.platform.governance.manage', 'platform', 'Organisation and governance studio',
   'Draft, edit and submit organisation and governance structure versions. Approval and publication stay with the platform owner. Grants no appointment and no other right')
on conflict (code) do nothing;

-- 511 sensitive classes unchanged, plus hq.platform.governance.manage in the platform class.
create or replace function hq_capability_sensitive_class(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern',
                    'hq.competency.verification.manage', 'hq.competency.verification.assess') then 'clinical'
    when p_code in ('hq.practice.commercial.manage', 'hq.individual.commercial.manage', 'hq.learning.price.approve',
                    'hq.platform.ai.manage') then 'financial'
    when p_code in ('hq.platform.users.view', 'hq.platform.users.reset', 'hq.platform.system.view',
                    'hq.platform.settings.view', 'hq.platform.operations.view', 'hq.platform.tenants.view',
                    'hq.platform.audit.view', 'hq.individual.pilot.grant', 'hq.individual.config.manage',
                    'hq.individual.professional.verify', 'hq.practice.licence.verify',
                    'hq.practice.provision.execute', 'hq.practice.flags.manage', 'hq.practice.release.activate',
                    'hq.practice.release.rollback', 'hq.practice.export.execute', 'hq.practice.change.approve',
                    'hq.practice.risk.accept', 'hq.practice.configuration.manage',
                    'hq.learning.certificate.issue', 'hq.platform.governance.manage') then 'platform'
    else null
  end
$$;

-- 2. Structures: one per governance context, keyed to a product line.
create table if not exists hq_gov_structure (
  code              text primary key,
  name              text not null,
  product_line_code text not null references plat_product_line(code),
  description       text,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
alter table hq_gov_structure drop constraint if exists hq_gov_structure_code_check;
alter table hq_gov_structure add constraint hq_gov_structure_code_check check (code ~ '^[a-z][a-z0-9_]{2,62}$');
alter table hq_gov_structure drop constraint if exists hq_gov_structure_name_check;
alter table hq_gov_structure add constraint hq_gov_structure_name_check check (btrim(name) <> '');
alter table hq_gov_structure enable row level security;
drop policy if exists hq_gov_structure_read on hq_gov_structure;
create policy hq_gov_structure_read on hq_gov_structure for select to authenticated using (true);

-- 3. Versions. The definition is the whole structure. Only a draft changes.
create table if not exists hq_gov_structure_version (
  id                       uuid primary key default gen_random_uuid(),
  structure_code           text not null references hq_gov_structure(code),
  version_no               integer not null,
  title                    text not null,
  change_summary           text,
  status                   text not null default 'draft',
  definition               jsonb not null default '{}'::jsonb,
  revision                 integer not null default 1,
  based_on_version_id      uuid references hq_gov_structure_version(id),
  created_by               uuid references profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  edited_by                uuid references profiles(id) on delete set null,
  edited_at                timestamptz,
  submitted_by             uuid references profiles(id) on delete set null,
  submitted_at             timestamptz,
  approved_by              uuid references profiles(id) on delete set null,
  approved_at              timestamptz,
  self_approved            boolean not null default false,
  published_by             uuid references profiles(id) on delete set null,
  published_at             timestamptz,
  effective_from           date,
  approval_basis           text,
  superseded_at            timestamptz,
  superseded_by_version_id uuid references hq_gov_structure_version(id),
  discarded_at             timestamptz
);
alter table hq_gov_structure_version drop constraint if exists hq_gov_version_status_check;
alter table hq_gov_structure_version add constraint hq_gov_version_status_check
  check (status in ('draft', 'review', 'approved', 'published', 'superseded', 'discarded'));
alter table hq_gov_structure_version drop constraint if exists hq_gov_version_title_check;
alter table hq_gov_structure_version add constraint hq_gov_version_title_check check (btrim(title) <> '');
alter table hq_gov_structure_version drop constraint if exists hq_gov_version_definition_check;
alter table hq_gov_structure_version add constraint hq_gov_version_definition_check
  check (jsonb_typeof(definition) = 'object' and pg_column_size(definition) < 1000000);
alter table hq_gov_structure_version drop constraint if exists hq_gov_version_published_check;
alter table hq_gov_structure_version add constraint hq_gov_version_published_check
  check (status not in ('published', 'superseded') or (published_at is not null and effective_from is not null));
alter table hq_gov_structure_version drop constraint if exists hq_gov_version_no_unique;
alter table hq_gov_structure_version add constraint hq_gov_version_no_unique unique (structure_code, version_no);
create index if not exists idx_hq_gov_version_structure on hq_gov_structure_version (structure_code, status);
alter table hq_gov_structure_version enable row level security;
drop policy if exists hq_gov_structure_version_read on hq_gov_structure_version;
create policy hq_gov_structure_version_read on hq_gov_structure_version for select to authenticated using (true);

-- 4. Relationship types, configurable. Additive: a type is retired, never removed.
create table if not exists hq_gov_relation_type (
  code        text primary key,
  label       text not null,
  line_style  text not null default 'solid',
  description text,
  is_active   boolean not null default true,
  sort        integer not null default 100,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table hq_gov_relation_type drop constraint if exists hq_gov_relation_type_code_check;
alter table hq_gov_relation_type add constraint hq_gov_relation_type_code_check check (code ~ '^[a-z][a-z0-9_]{2,62}$');
alter table hq_gov_relation_type drop constraint if exists hq_gov_relation_type_label_check;
alter table hq_gov_relation_type add constraint hq_gov_relation_type_label_check check (btrim(label) <> '');
alter table hq_gov_relation_type drop constraint if exists hq_gov_relation_type_style_check;
alter table hq_gov_relation_type add constraint hq_gov_relation_type_style_check check (line_style in ('solid', 'dashed', 'dotted'));
alter table hq_gov_relation_type enable row level security;
drop policy if exists hq_gov_relation_type_read on hq_gov_relation_type;
create policy hq_gov_relation_type_read on hq_gov_relation_type for select to authenticated using (true);
insert into hq_gov_relation_type (code, label, line_style, description, sort) values
  ('interim_authority', 'Interim corporate authority', 'solid', 'Documented interim authority pending formal constitution', 10),
  ('corporate_reporting', 'Corporate reporting', 'solid', 'Line reporting to a corporate authority', 20),
  ('mandate', 'Mandate', 'solid', 'The mandate under which a function acts', 30),
  ('delegation', 'Delegated approval', 'solid', 'Approval authority delegated by one body to another', 40),
  ('specialist_oversight', 'Specialist oversight', 'dotted', 'Specialist consultation and conditions, not line management', 50),
  ('escalation', 'Escalation', 'dotted', 'Where a matter is escalated', 60),
  ('service', 'Shared service', 'dashed', 'A shared service provided to another body', 70),
  ('joint_review', 'Joint specialist review', 'dashed', 'Joint review across domains before activation', 80)
on conflict (code) do nothing;

-- 5. 610 tables: the version columns, the wider kinds and levels, and relation types as data.
alter table hq_gov_body add column if not exists structure_code text references hq_gov_structure(code);
alter table hq_gov_body add column if not exists introduced_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_body add column if not exists retired_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_seat add column if not exists appointment_requirements text;
alter table hq_gov_seat add column if not exists introduced_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_seat add column if not exists retired_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_delegation add column if not exists is_active boolean not null default true;
alter table hq_gov_delegation add column if not exists introduced_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_delegation add column if not exists retired_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_delegation add column if not exists decided_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_link add column if not exists is_active boolean not null default true;
alter table hq_gov_link add column if not exists introduced_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_link add column if not exists retired_version_id uuid references hq_gov_structure_version(id);
alter table hq_gov_seat_appointment add column if not exists structure_version_id uuid references hq_gov_structure_version(id);

alter table hq_gov_body drop constraint if exists hq_gov_body_kind_check;
alter table hq_gov_body add constraint hq_gov_body_kind_check
  check (kind in ('holding_company', 'board', 'committee', 'product_lead', 'service', 'department', 'portfolio', 'unit'));
alter table hq_gov_body drop constraint if exists hq_gov_body_level_check;
alter table hq_gov_body add constraint hq_gov_body_level_check
  check ((kind = 'service' and level is null) or (kind <> 'service' and level is not null and level between 1 and 9));
alter table hq_gov_seat drop constraint if exists hq_gov_seat_kind_check;
alter table hq_gov_seat add constraint hq_gov_seat_kind_check
  check (seat_kind in ('director', 'committee_function', 'lead', 'portfolio', 'it_function', 'position', 'member'));
alter table hq_gov_delegation drop constraint if exists hq_gov_delegation_relation_check;
alter table hq_gov_delegation drop constraint if exists hq_gov_delegation_relation_fk;
alter table hq_gov_delegation add constraint hq_gov_delegation_relation_fk
  foreign key (relation) references hq_gov_relation_type(code);

-- 6. The 610 relationship guard, with one change: retiring or re-sorting a relationship (is_active, sort
--    and the version columns) is allowed whatever its status. Bodies, type and scope still never change, a
--    withdrawn relationship still never reopens, and only an established body still delegates.
create or replace function hq_gov_delegation_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from hq_gov_body%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'hq_gov history: a delegation is never deleted, it is withdrawn';
  end if;
  if tg_op = 'UPDATE' and (new.code is distinct from old.code or new.from_body_code is distinct from old.from_body_code
                           or new.to_body_code is distinct from old.to_body_code or new.scope is distinct from old.scope
                           or new.relation is distinct from old.relation) then
    raise exception 'hq_gov history: the bodies and scope of a delegation never change';
  end if;
  if tg_op = 'UPDATE' and old.status = 'withdrawn' and new.status is distinct from old.status then
    raise exception 'hq_gov history: a withdrawn delegation cannot be reopened';
  end if;
  if new.status in ('interim', 'approved') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    select * into v_from from hq_gov_body where code = new.from_body_code;
    if v_from.constitution_status <> 'established' then
      raise exception 'hq_gov invalid: % is not established, so it cannot delegate yet', v_from.name;
    end if;
  end if;
  return new;
end;
$$;

-- 7. History ties. The version in force for a structure, stamped on appointments and decisions.
create or replace function hq_gov_published_version(p_structure text)
returns uuid
language sql
stable
set search_path = public
as $$
  select v.id from hq_gov_structure_version v
   where v.structure_code = p_structure and v.status = 'published'
   order by v.version_no desc limit 1
$$;

create or replace function hq_gov_appointment_version_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.structure_version_id is null then
    select hq_gov_published_version(b.structure_code) into new.structure_version_id
      from hq_gov_seat s join hq_gov_body b on b.code = s.body_code
     where s.code = new.seat_code;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_hq_gov_appointment_version_stamp on hq_gov_seat_appointment;
create trigger trg_hq_gov_appointment_version_stamp
  before insert on hq_gov_seat_appointment
  for each row execute function hq_gov_appointment_version_stamp();

create or replace function hq_gov_delegation_version_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    select hq_gov_published_version(b.structure_code) into new.decided_version_id
      from hq_gov_body b where b.code = new.from_body_code;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_hq_gov_delegation_version_stamp on hq_gov_delegation;
create trigger trg_hq_gov_delegation_version_stamp
  before update on hq_gov_delegation
  for each row execute function hq_gov_delegation_version_stamp();

-- 8. The version guard, for every writer. Published history is immutable.
create or replace function hq_gov_structure_version_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'hq_gov history: a structure version is never deleted';
  end if;
  if tg_op = 'INSERT' then
    -- A new version is a draft. The one exception is the first version of a structure, which is how 620
    -- records the structure 610 already published.
    if new.status <> 'draft' and (new.status <> 'published'
        or exists (select 1 from hq_gov_structure_version v where v.structure_code = new.structure_code)) then
      raise exception 'hq_gov invalid: a new structure version starts as a draft';
    end if;
  else
    if new.id is distinct from old.id or new.structure_code is distinct from old.structure_code
       or new.version_no is distinct from old.version_no or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at or new.based_on_version_id is distinct from old.based_on_version_id then
      raise exception 'hq_gov history: the identity of a structure version never changes';
    end if;
    if old.status in ('superseded', 'discarded') then
      raise exception 'hq_gov history: a % version cannot be changed', old.status;
    end if;
    if old.status = 'published' and not (new.status = 'superseded' and new.definition = old.definition
        and new.title = old.title and new.effective_from is not distinct from old.effective_from) then
      raise exception 'hq_gov history: a published version is immutable. Draft a new version';
    end if;
    if new.definition is distinct from old.definition and not (old.status = 'draft' and new.status = 'draft') then
      raise exception 'hq_gov history: only a draft is edited. Return it to draft first';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'draft' and new.status in ('review', 'discarded'))
      or (old.status = 'review' and new.status in ('draft', 'approved', 'discarded'))
      or (old.status = 'approved' and new.status in ('draft', 'published'))
      or (old.status = 'published' and new.status = 'superseded')) then
      raise exception 'hq_gov invalid: a version cannot move from % to %', old.status, new.status;
    end if;
  end if;
  -- One open version (draft, review or approved) per structure.
  if new.status in ('draft', 'review', 'approved') and exists (
       select 1 from hq_gov_structure_version v
        where v.structure_code = new.structure_code and v.id <> new.id and v.status in ('draft', 'review', 'approved')) then
    raise exception 'hq_gov exists: this structure already has an open version. Publish or discard it first';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_hq_gov_structure_version_guard on hq_gov_structure_version;
create trigger trg_hq_gov_structure_version_guard
  before insert or update or delete on hq_gov_structure_version
  for each row execute function hq_gov_structure_version_guard();

-- 9. The gates.
create or replace function hq_gov_studio_can_edit(p_actor uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select p_actor is not null and (hq_actor_is_owner(p_actor) or exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.person_id = p_actor
       and a.status = 'active'
       and o.office_type like 'hq\_%'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = 'hq.platform.governance.manage'
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
  ))
$$;

create or replace function hq_gov_studio_require(p_actor uuid, p_reason text, p_owner_only boolean)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_owner_only and (p_actor is null or not hq_actor_is_owner(p_actor)) then
    raise exception 'hq_gov owner_required: approving, publishing and creating structures requires platform ownership';
  end if;
  if not p_owner_only and not hq_gov_studio_can_edit(p_actor) then
    raise exception 'hq_gov owner_required: editing a structure requires platform ownership or hq.platform.governance.manage';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'hq_gov invalid: a reason of at least 5 characters is required';
  end if;
end;
$$;

-- 10. Projection. Writes a version into the 610 tables. Every 610 constraint and guard applies, so a
--     version that breaks one does not publish. Called by publish, and in a rolled-back dry run by submit
--     and approve.
create or replace function hq_gov_studio_project(p_version uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v hq_gov_structure_version%rowtype;
  d jsonb;
  v_bad text;
begin
  select * into v from hq_gov_structure_version where id = p_version;
  if not found then
    raise exception 'hq_gov not_found: no such structure version';
  end if;
  d := v.definition;
  if jsonb_typeof(coalesce(d -> 'units', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(d -> 'positions', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(d -> 'relationships', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(d -> 'links', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(d -> 'independence_pairs', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(d -> 'levels', '[]'::jsonb)) <> 'array' then
    raise exception 'hq_gov invalid: the definition must hold levels, units, positions, relationships, links and independence_pairs as lists';
  end if;

  -- Codes are unique within the definition.
  select x.c into v_bad from (
    select u ->> 'code' as c from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u
    union all select p ->> 'code' from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) p
    union all select r ->> 'code' from jsonb_array_elements(coalesce(d -> 'relationships', '[]'::jsonb)) r
    union all select l ->> 'code' from jsonb_array_elements(coalesce(d -> 'links', '[]'::jsonb)) l) x
  group by x.c having count(*) > 1 limit 1;
  if v_bad is not null then
    raise exception 'hq_gov invalid: the code % is used twice in this version', v_bad;
  end if;

  -- A code belongs to one structure.
  select u ->> 'code' into v_bad from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u
    join hq_gov_body b on b.code = u ->> 'code' where b.structure_code is distinct from v.structure_code limit 1;
  if v_bad is null then
    select p ->> 'code' into v_bad from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) p
      join hq_gov_seat s on s.code = p ->> 'code' join hq_gov_body b on b.code = s.body_code
     where b.structure_code is distinct from v.structure_code limit 1;
  end if;
  if v_bad is not null then
    raise exception 'hq_gov invalid: % belongs to another structure', v_bad;
  end if;

  -- Nothing published is dropped. It is retired instead.
  select b.code into v_bad from hq_gov_body b where b.structure_code = v.structure_code
     and not exists (select 1 from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u where u ->> 'code' = b.code) limit 1;
  if v_bad is null then
    select s.code into v_bad from hq_gov_seat s join hq_gov_body b on b.code = s.body_code where b.structure_code = v.structure_code
       and not exists (select 1 from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) p where p ->> 'code' = s.code) limit 1;
  end if;
  if v_bad is null then
    select g.code into v_bad from hq_gov_delegation g join hq_gov_body b on b.code = g.from_body_code where b.structure_code = v.structure_code
       and not exists (select 1 from jsonb_array_elements(coalesce(d -> 'relationships', '[]'::jsonb)) r where r ->> 'code' = g.code) limit 1;
  end if;
  if v_bad is null then
    select l.code into v_bad from hq_gov_link l join hq_gov_seat s on s.code = l.seat_code join hq_gov_body b on b.code = s.body_code
     where b.structure_code = v.structure_code
       and not exists (select 1 from jsonb_array_elements(coalesce(d -> 'links', '[]'::jsonb)) x where x ->> 'code' = l.code) limit 1;
  end if;
  if v_bad is null then
    select x.seat_a || ' / ' || x.seat_b into v_bad from hq_gov_seat_exclusion x
      join hq_gov_seat s on s.code = x.seat_a join hq_gov_body b on b.code = s.body_code
     where b.structure_code = v.structure_code
       and not exists (select 1 from jsonb_array_elements(coalesce(d -> 'independence_pairs', '[]'::jsonb)) i
                        where (i ->> 'a' = x.seat_a and i ->> 'b' = x.seat_b) or (i ->> 'a' = x.seat_b and i ->> 'b' = x.seat_a)) limit 1;
  end if;
  if v_bad is not null then
    raise exception 'hq_gov history: % is in the published structure. Retire it instead of removing it', v_bad;
  end if;

  -- Levels named for every non-service unit.
  select u ->> 'code' into v_bad from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u
   where u ->> 'kind' <> 'service' and not exists (
     select 1 from jsonb_array_elements(coalesce(d -> 'levels', '[]'::jsonb)) l where (l ->> 'level') = (u ->> 'level')) limit 1;
  if v_bad is not null then
    raise exception 'hq_gov invalid: unit % sits on a level the version does not define', v_bad;
  end if;

  -- Retirement rules.
  select p ->> 'code' into v_bad from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) p
   where coalesce((p ->> 'retired')::boolean, false)
     and exists (select 1 from hq_gov_seat_appointment a where a.seat_code = p ->> 'code' and a.status <> 'ended') limit 1;
  if v_bad is not null then
    raise exception 'hq_gov invalid: position % has a live appointment record. End it before retiring the position', v_bad;
  end if;
  select u ->> 'code' into v_bad from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u
   where coalesce((u ->> 'retired')::boolean, false) and exists (
     select 1 from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) p
      where p ->> 'unit' = u ->> 'code' and not coalesce((p ->> 'retired')::boolean, false)) limit 1;
  if v_bad is null then
    select p ->> 'code' into v_bad from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) p
     where not coalesce((p ->> 'retired')::boolean, false) and exists (
       select 1 from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u
        where u ->> 'code' = p ->> 'unit' and coalesce((u ->> 'retired')::boolean, false)) limit 1;
  end if;
  if v_bad is not null then
    raise exception 'hq_gov invalid: % pairs a retired unit with an active position. Retire or move the positions first', v_bad;
  end if;
  select r ->> 'code' into v_bad from jsonb_array_elements(coalesce(d -> 'relationships', '[]'::jsonb)) r
   where not coalesce((r ->> 'retired')::boolean, false)
     and not exists (select 1 from hq_gov_relation_type t where t.code = r ->> 'type' and t.is_active) limit 1;
  if v_bad is not null then
    raise exception 'hq_gov invalid: relationship % names a relationship type that is not active', v_bad;
  end if;

  -- Units. Parents are set in a second pass so the order of the list does not matter.
  insert into hq_gov_body (code, level, kind, name, description, product_line_code, parent_body_code, constitution_status,
                           constitution_note, interim_authority, document_status, document_ref, sort, is_active,
                           structure_code, introduced_version_id, retired_version_id)
  select u ->> 'code', (u ->> 'level')::smallint, u ->> 'kind', u ->> 'name', nullif(u ->> 'description', ''),
         nullif(u ->> 'product_line', ''), null, coalesce(nullif(u ->> 'constitution_status', ''), 'pending_constitution'),
         nullif(u ->> 'constitution_note', ''), nullif(u ->> 'interim_authority', ''),
         coalesce(nullif(u ->> 'document_status', ''), 'none'), nullif(u ->> 'document_ref', ''),
         coalesce((u ->> 'sort')::integer, 100), not coalesce((u ->> 'retired')::boolean, false),
         v.structure_code, v.id, case when coalesce((u ->> 'retired')::boolean, false) then v.id end
    from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u
  on conflict (code) do update set
    level = excluded.level, kind = excluded.kind, name = excluded.name, description = excluded.description,
    product_line_code = excluded.product_line_code, constitution_status = excluded.constitution_status,
    constitution_note = excluded.constitution_note, interim_authority = excluded.interim_authority,
    document_status = excluded.document_status, document_ref = excluded.document_ref, sort = excluded.sort,
    is_active = excluded.is_active,
    retired_version_id = case when excluded.is_active then null
                              when hq_gov_body.is_active then v.id else hq_gov_body.retired_version_id end;
  update hq_gov_body b set parent_body_code = nullif(u ->> 'parent', '')
    from jsonb_array_elements(coalesce(d -> 'units', '[]'::jsonb)) u
   where b.code = u ->> 'code' and b.parent_body_code is distinct from nullif(u ->> 'parent', '');
  if exists (
    with recursive walk(start, cur, depth) as (
      select b.code, b.parent_body_code, 1 from hq_gov_body b where b.structure_code = v.structure_code
      union all
      select w.start, b.parent_body_code, w.depth + 1 from walk w join hq_gov_body b on b.code = w.cur
       where w.cur is not null and w.depth < 50)
    select 1 from walk where cur = start) then
    raise exception 'hq_gov invalid: a unit cannot sit inside itself';
  end if;

  -- Positions. Moving a position keeps its code, so its appointments stay with it.
  insert into hq_gov_seat (code, body_code, name, description, seat_kind, nomination_source, provider, accountability,
                           authority_position_code, exclusive, appointment_requirements, sort, is_active,
                           introduced_version_id, retired_version_id)
  select p ->> 'code', p ->> 'unit', p ->> 'name', nullif(p ->> 'description', ''), p ->> 'kind',
         nullif(p ->> 'nomination_source', ''), nullif(p ->> 'provider', ''), nullif(p ->> 'accountability', ''),
         nullif(p ->> 'authority_position', ''), coalesce((p ->> 'exclusive')::boolean, false),
         nullif(p ->> 'requirements', ''), coalesce((p ->> 'sort')::integer, 100),
         not coalesce((p ->> 'retired')::boolean, false), v.id,
         case when coalesce((p ->> 'retired')::boolean, false) then v.id end
    from jsonb_array_elements(coalesce(d -> 'positions', '[]'::jsonb)) p
  on conflict (code) do update set
    body_code = excluded.body_code, name = excluded.name, description = excluded.description, seat_kind = excluded.seat_kind,
    nomination_source = excluded.nomination_source, provider = excluded.provider, accountability = excluded.accountability,
    authority_position_code = excluded.authority_position_code, exclusive = excluded.exclusive,
    appointment_requirements = excluded.appointment_requirements, sort = excluded.sort, is_active = excluded.is_active,
    retired_version_id = case when excluded.is_active then null
                              when hq_gov_seat.is_active then v.id else hq_gov_seat.retired_version_id end;

  -- Relationships. New ones are always pending. Existing ones keep their status and decisions.
  insert into hq_gov_delegation (code, from_body_code, to_body_code, relation, scope, status, sort, is_active,
                                 introduced_version_id, retired_version_id)
  select r ->> 'code', r ->> 'from', r ->> 'to', r ->> 'type', r ->> 'scope', 'pending', coalesce((r ->> 'sort')::integer, 100),
         not coalesce((r ->> 'retired')::boolean, false), v.id,
         case when coalesce((r ->> 'retired')::boolean, false) then v.id end
    from jsonb_array_elements(coalesce(d -> 'relationships', '[]'::jsonb)) r
  on conflict (code) do update set
    from_body_code = excluded.from_body_code, to_body_code = excluded.to_body_code, relation = excluded.relation,
    scope = excluded.scope, sort = excluded.sort, is_active = excluded.is_active,
    retired_version_id = case when excluded.is_active then null
                              when hq_gov_delegation.is_active then v.id else hq_gov_delegation.retired_version_id end;

  -- Workflow links.
  insert into hq_gov_link (code, seat_code, kind, clearance_domain, step, label, route, capability_code, note, sort,
                           is_active, introduced_version_id, retired_version_id)
  select l ->> 'code', l ->> 'position', l ->> 'kind', nullif(l ->> 'clearance_domain', ''), (l ->> 'step')::smallint,
         l ->> 'label', nullif(l ->> 'route', ''), nullif(l ->> 'capability', ''), nullif(l ->> 'note', ''),
         coalesce((l ->> 'sort')::integer, 100), not coalesce((l ->> 'retired')::boolean, false), v.id,
         case when coalesce((l ->> 'retired')::boolean, false) then v.id end
    from jsonb_array_elements(coalesce(d -> 'links', '[]'::jsonb)) l
  on conflict (code) do update set
    seat_code = excluded.seat_code, kind = excluded.kind, clearance_domain = excluded.clearance_domain, step = excluded.step,
    label = excluded.label, route = excluded.route, capability_code = excluded.capability_code, note = excluded.note,
    sort = excluded.sort, is_active = excluded.is_active,
    retired_version_id = case when excluded.is_active then null
                              when hq_gov_link.is_active then v.id else hq_gov_link.retired_version_id end;

  -- Independence pairs are only ever added.
  insert into hq_gov_seat_exclusion (seat_a, seat_b, reason)
  select i ->> 'a', i ->> 'b', i ->> 'reason'
    from jsonb_array_elements(coalesce(d -> 'independence_pairs', '[]'::jsonb)) i
   where not exists (select 1 from hq_gov_seat_exclusion x
                      where (x.seat_a = i ->> 'a' and x.seat_b = i ->> 'b') or (x.seat_a = i ->> 'b' and x.seat_b = i ->> 'a'));
end;
$$;

-- A dry run: project, then roll back. Returns null when the version would publish, else the reason.
create or replace function hq_gov_studio_check(p_version uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform hq_gov_studio_project(p_version);
  raise exception 'hq_gov_dry_run_ok';
exception when others then
  if sqlerrm = 'hq_gov_dry_run_ok' then
    return null;
  end if;
  return sqlerrm;
end;
$$;

-- 11. The lifecycle writers. Audit row first, then the change, in one transaction (the 500 shape).
create or replace function hq_gov_studio_audit(p_actor uuid, p_actor_name text, p_trace text, p_action text,
                                               p_version uuid, p_name text, p_old jsonb, p_new jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, p_action, 'hq_gov_structure_version', p_version, p_name, p_old, p_new, p_trace)
$$;

create or replace function hq_gov_studio_create_structure(
  p_actor uuid, p_actor_name text, p_trace text, p_code text, p_name text, p_product_line text, p_description text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
begin
  perform hq_gov_studio_require(p_actor, p_reason, true);
  if exists (select 1 from hq_gov_structure where code = btrim(coalesce(p_code, ''))) then
    raise exception 'hq_gov exists: a structure with that code already exists';
  end if;
  v_row := jsonb_build_object('structure', btrim(coalesce(p_code, '')), 'name', btrim(coalesce(p_name, '')),
                              'product_line', p_product_line, 'reason', btrim(p_reason));
  perform hq_gov_studio_audit(p_actor, p_actor_name, p_trace, 'hq_gov_structure_create', null, btrim(coalesce(p_code, '')), null, v_row);
  insert into hq_gov_structure (code, name, product_line_code, description, created_by)
  values (btrim(coalesce(p_code, '')), btrim(coalesce(p_name, '')), p_product_line, nullif(btrim(coalesce(p_description, '')), ''), p_actor);
  return v_row;
end;
$$;

-- A draft starts as a copy of the published version, or empty for a new structure.
create or replace function hq_gov_studio_create_draft(
  p_actor uuid, p_actor_name text, p_trace text, p_structure text, p_title text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base hq_gov_structure_version%rowtype;
  v_id uuid;
  v_no integer;
  v_row jsonb;
begin
  perform hq_gov_studio_require(p_actor, p_reason, false);
  if not exists (select 1 from hq_gov_structure where code = p_structure) then
    raise exception 'hq_gov not_found: no such structure';
  end if;
  select * into v_base from hq_gov_structure_version where id = hq_gov_published_version(p_structure);
  select coalesce(max(version_no), 0) + 1 into v_no from hq_gov_structure_version where structure_code = p_structure;
  v_row := jsonb_build_object('structure', p_structure, 'version_no', v_no, 'based_on', v_base.id, 'reason', btrim(p_reason));
  perform hq_gov_studio_audit(p_actor, p_actor_name, p_trace, 'hq_gov_version_create_draft', null, p_structure, null, v_row);
  insert into hq_gov_structure_version (structure_code, version_no, title, status, definition, based_on_version_id, created_by, edited_by, edited_at)
  values (p_structure, v_no, coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Version ' || v_no), 'draft',
          coalesce(v_base.definition, '{"levels": [], "units": [], "positions": [], "relationships": [], "links": [], "independence_pairs": []}'::jsonb),
          v_base.id, p_actor, p_actor, now())
  returning id into v_id;
  return v_row || jsonb_build_object('version_id', v_id);
end;
$$;

-- Save the whole definition of a draft. p_revision must be the revision the editor read, so two editors
-- never overwrite each other silently.
create or replace function hq_gov_studio_save_draft(
  p_actor uuid, p_actor_name text, p_trace text, p_version uuid, p_revision integer, p_definition jsonb,
  p_title text, p_change_summary text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v hq_gov_structure_version%rowtype;
  v_row jsonb;
begin
  perform hq_gov_studio_require(p_actor, p_reason, false);
  select * into v from hq_gov_structure_version where id = p_version for update;
  if not found then
    raise exception 'hq_gov not_found: no such structure version';
  end if;
  if v.status <> 'draft' then
    raise exception 'hq_gov invalid: only a draft is edited. This version is %', v.status;
  end if;
  if p_revision is distinct from v.revision then
    raise exception 'hq_gov exists: the draft changed since you opened it (revision % now). Reload and apply your change again', v.revision;
  end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception 'hq_gov invalid: the definition must be an object';
  end if;
  v_row := jsonb_build_object('version_id', v.id, 'revision', v.revision + 1, 'definition_md5', md5(p_definition::text),
                              'reason', btrim(p_reason));
  perform hq_gov_studio_audit(p_actor, p_actor_name, p_trace, 'hq_gov_version_save_draft', v.id, v.structure_code,
                              jsonb_build_object('revision', v.revision, 'definition_md5', md5(v.definition::text)), v_row);
  update hq_gov_structure_version
     set definition = p_definition, revision = v.revision + 1, edited_by = p_actor, edited_at = now(),
         title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         change_summary = coalesce(nullif(btrim(coalesce(p_change_summary, '')), ''), change_summary)
   where id = v.id;
  return v_row;
end;
$$;

-- Move a version along the lifecycle. submit, return, discard: editor. approve: owner, with a dry run.
create or replace function hq_gov_studio_transition(
  p_actor uuid, p_actor_name text, p_trace text, p_version uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v hq_gov_structure_version%rowtype;
  v_to text;
  v_problem text;
  v_row jsonb;
begin
  if p_action not in ('submit', 'return', 'discard', 'approve') then
    raise exception 'hq_gov invalid: the action must be submit, return, discard or approve';
  end if;
  perform hq_gov_studio_require(p_actor, p_reason, p_action = 'approve');
  select * into v from hq_gov_structure_version where id = p_version for update;
  if not found then
    raise exception 'hq_gov not_found: no such structure version';
  end if;
  if not ((p_action = 'submit' and v.status = 'draft') or (p_action = 'return' and v.status in ('review', 'approved'))
          or (p_action = 'discard' and v.status in ('draft', 'review')) or (p_action = 'approve' and v.status = 'review')) then
    raise exception 'hq_gov invalid: a % version cannot be given the action %', v.status, p_action;
  end if;
  v_to := case p_action when 'submit' then 'review' when 'return' then 'draft' when 'discard' then 'discarded' else 'approved' end;
  if p_action in ('submit', 'approve') then
    v_problem := hq_gov_studio_check(v.id);
    if v_problem is not null then
      raise exception 'hq_gov invalid: this version would not publish: %', regexp_replace(v_problem, '^hq_gov \w+: ', '');
    end if;
  end if;
  v_row := jsonb_build_object('version_id', v.id, 'from', v.status, 'to', v_to, 'reason', btrim(p_reason),
                              'self_approved', coalesce(p_action = 'approve' and p_actor in (v.edited_by, v.submitted_by, v.created_by), false));
  perform hq_gov_studio_audit(p_actor, p_actor_name, p_trace, 'hq_gov_version_' || p_action, v.id, v.structure_code,
                              jsonb_build_object('status', v.status), v_row);
  update hq_gov_structure_version
     set status = v_to,
         submitted_by = case when p_action = 'submit' then p_actor else submitted_by end,
         submitted_at = case when p_action = 'submit' then now() else submitted_at end,
         approved_by = case when p_action = 'approve' then p_actor when p_action = 'return' then null else approved_by end,
         approved_at = case when p_action = 'approve' then now() when p_action = 'return' then null else approved_at end,
         self_approved = case when p_action = 'approve' then (v_row ->> 'self_approved')::boolean when p_action = 'return' then false else self_approved end,
         discarded_at = case when p_action = 'discard' then now() else discarded_at end
   where id = v.id;
  return v_row;
end;
$$;

-- Publish an approved version: project it, supersede the previous one, and freeze it. Owner only.
create or replace function hq_gov_studio_publish(
  p_actor uuid, p_actor_name text, p_trace text, p_version uuid, p_effective_from date, p_basis text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v hq_gov_structure_version%rowtype;
  v_prev uuid;
  v_row jsonb;
begin
  perform hq_gov_studio_require(p_actor, p_reason, true);
  select * into v from hq_gov_structure_version where id = p_version for update;
  if not found then
    raise exception 'hq_gov not_found: no such structure version';
  end if;
  if v.status <> 'approved' then
    raise exception 'hq_gov invalid: only an approved version is published. This version is %', v.status;
  end if;
  if length(btrim(coalesce(p_basis, ''))) < 5 then
    raise exception 'hq_gov invalid: publication names its basis (the decision or approval reference)';
  end if;
  v_prev := hq_gov_published_version(v.structure_code);
  v_row := jsonb_build_object('version_id', v.id, 'version_no', v.version_no, 'supersedes', v_prev,
                              'effective_from', coalesce(p_effective_from, current_date), 'basis', btrim(p_basis),
                              'definition_md5', md5(v.definition::text), 'reason', btrim(p_reason));
  perform hq_gov_studio_audit(p_actor, p_actor_name, p_trace, 'hq_gov_version_publish', v.id, v.structure_code,
                              jsonb_build_object('status', v.status), v_row);
  if v_prev is not null then
    update hq_gov_structure_version set status = 'superseded', superseded_at = now(), superseded_by_version_id = v.id
     where id = v_prev;
  end if;
  update hq_gov_structure_version
     set status = 'published', published_by = p_actor, published_at = now(),
         effective_from = coalesce(p_effective_from, current_date), approval_basis = btrim(p_basis)
   where id = v.id;
  perform hq_gov_studio_project(v.id);
  return v_row;
end;
$$;

create or replace function hq_gov_studio_add_relation_type(
  p_actor uuid, p_actor_name text, p_trace text, p_code text, p_label text, p_line_style text, p_description text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
begin
  perform hq_gov_studio_require(p_actor, p_reason, false);
  if exists (select 1 from hq_gov_relation_type where code = btrim(coalesce(p_code, ''))) then
    raise exception 'hq_gov exists: a relationship type with that code already exists';
  end if;
  v_row := jsonb_build_object('relation_type', btrim(coalesce(p_code, '')), 'label', btrim(coalesce(p_label, '')),
                              'line_style', p_line_style, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_gov_relation_type_add', 'hq_gov_relation_type', btrim(coalesce(p_code, '')), v_row, p_trace);
  insert into hq_gov_relation_type (code, label, line_style, description, created_by)
  values (btrim(coalesce(p_code, '')), btrim(coalesce(p_label, '')), coalesce(p_line_style, 'solid'),
          nullif(btrim(coalesce(p_description, '')), ''), p_actor);
  return v_row;
end;
$$;

-- 12. Seed: the Scholar structure, and its 610 content as version 1, published.
insert into hq_gov_structure (code, name, product_line_code, description)
select 'scholar', 'Competen Scholar', 'individual', 'Scholar Governance Model V1 with Addendum V1.1 (owner GO, 27 Oct 2026)'
where exists (select 1 from plat_product_line where code = 'individual')
on conflict (code) do nothing;

update hq_gov_body set structure_code = 'scholar'
 where structure_code is null and code in ('competen_holdings', 'scholar_board', 'scholar_governance_committee',
                                           'scholar_product_operations', 'holdings_technology_services')
   and exists (select 1 from hq_gov_structure where code = 'scholar');

insert into hq_gov_structure_version (structure_code, version_no, title, change_summary, status, definition,
                                      published_at, effective_from, approval_basis)
select 'scholar', 1, 'Scholar Governance Model V1.1', 'The structure migration 610 configured.', 'published',
  jsonb_build_object(
    'levels', '[{"level": 1, "label": "Corporate governance"}, {"level": 2, "label": "Academic, clinical and AI governance"}, {"level": 3, "label": "Product and operations"}]'::jsonb,
    'units', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'code', b.code, 'level', b.level, 'kind', b.kind, 'name', b.name, 'description', b.description,
        'product_line', b.product_line_code, 'parent', b.parent_body_code, 'constitution_status', b.constitution_status,
        'constitution_note', b.constitution_note, 'interim_authority', b.interim_authority,
        'document_status', b.document_status, 'document_ref', b.document_ref, 'sort', b.sort,
        'retired', case when b.is_active then null else true end)) order by b.sort, b.code)
      from hq_gov_body b where b.structure_code = 'scholar'), '[]'::jsonb),
    'positions', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'code', s.code, 'unit', s.body_code, 'name', s.name, 'description', s.description, 'kind', s.seat_kind,
        'nomination_source', s.nomination_source, 'provider', s.provider, 'accountability', s.accountability,
        'authority_position', s.authority_position_code, 'exclusive', case when s.exclusive then true end,
        'requirements', s.appointment_requirements, 'sort', s.sort,
        'retired', case when s.is_active then null else true end)) order by s.body_code, s.sort, s.code)
      from hq_gov_seat s join hq_gov_body b on b.code = s.body_code where b.structure_code = 'scholar'), '[]'::jsonb),
    'relationships', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'code', g.code, 'from', g.from_body_code, 'to', g.to_body_code, 'type', g.relation, 'scope', g.scope, 'sort', g.sort,
        'retired', case when g.is_active then null else true end)) order by g.sort, g.code)
      from hq_gov_delegation g join hq_gov_body b on b.code = g.from_body_code where b.structure_code = 'scholar'), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'code', l.code, 'position', l.seat_code, 'kind', l.kind, 'clearance_domain', l.clearance_domain, 'step', l.step,
        'label', l.label, 'route', l.route, 'capability', l.capability_code, 'note', l.note, 'sort', l.sort,
        'retired', case when l.is_active then null else true end)) order by l.sort, l.code)
      from hq_gov_link l join hq_gov_seat s on s.code = l.seat_code join hq_gov_body b on b.code = s.body_code
     where b.structure_code = 'scholar'), '[]'::jsonb),
    'independence_pairs', coalesce((select jsonb_agg(jsonb_build_object('a', x.seat_a, 'b', x.seat_b, 'reason', x.reason) order by x.seat_a, x.seat_b)
      from hq_gov_seat_exclusion x join hq_gov_seat s on s.code = x.seat_a join hq_gov_body b on b.code = s.body_code
     where b.structure_code = 'scholar'), '[]'::jsonb)),
  timestamptz '2026-10-27 00:00:00+03', date '2026-10-27',
  'Owner GO COMPETEN-SCHOLAR-GOV-IMPLEMENT-01 and Addendum V1.1, 27 Oct 2026 (migration 610)'
where exists (select 1 from hq_gov_structure where code = 'scholar')
  and not exists (select 1 from hq_gov_structure_version where structure_code = 'scholar');

-- Version 1 introduced every 610 row. The relationship guard above allows these columns.
update hq_gov_body set introduced_version_id = (select id from hq_gov_structure_version where structure_code = 'scholar' and version_no = 1)
 where structure_code = 'scholar' and introduced_version_id is null;
update hq_gov_seat s set introduced_version_id = (select id from hq_gov_structure_version where structure_code = 'scholar' and version_no = 1)
  from hq_gov_body b where b.code = s.body_code and b.structure_code = 'scholar' and s.introduced_version_id is null;
update hq_gov_delegation g set introduced_version_id = (select id from hq_gov_structure_version where structure_code = 'scholar' and version_no = 1)
  from hq_gov_body b where b.code = g.from_body_code and b.structure_code = 'scholar' and g.introduced_version_id is null;
update hq_gov_link l set introduced_version_id = (select id from hq_gov_structure_version where structure_code = 'scholar' and version_no = 1)
  from hq_gov_seat s join hq_gov_body b on b.code = s.body_code
 where s.code = l.seat_code and b.structure_code = 'scholar' and l.introduced_version_id is null;

-- Verification: one published Scholar version, and it projects without error (expect null).
select version_no, status, jsonb_array_length(definition -> 'positions') as positions
  from hq_gov_structure_version where structure_code = 'scholar';
select hq_gov_studio_check((select id from hq_gov_structure_version where structure_code = 'scholar' and version_no = 1)) as v1_projects;

notify pgrst, 'reload schema';
