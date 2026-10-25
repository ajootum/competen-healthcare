-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql function bodies between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 500: HQ POSITIONS AND THEIR GRANTS AS A GOVERNED, NO-CODE WORKFLOW
--
-- Owner, 25 Oct 2026: "Can you make creation of roles in HQ no code i.e. configureable?" Until now every
-- hq_position and hq_position_capability row was written by a migration (264 onwards). This adds the
-- governed write path the HQ screen /super-admin/users/positions calls. Staging first. Production needs its
-- own owner GO. Build record: docs/evidence/HQ-POSITION-ADMIN-01/500-build-record.md.
--
-- DEPENDS ON 264 (hq_capability, hq_position, hq_position_capability), 040 (audit_log, profiles.roles and
-- platform_roles) and 178 (audit_log.trace_id). Independent of every other file. Additive. Re-running it is
-- a no-op. It writes NO position, NO grant and NO appointment.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--   hq_position_capability gains grant_reason, ended_by and end_reason, so a grant row says why it began
--   and who ended it and why.
--   hq_actor_is_owner(actor)          the owner predicate the HQ door uses (super_admin, or platform_owner),
--                                     so the database itself refuses a non-owner.
--   hq_capability_sensitive_class     clinical, financial or platform for the capabilities whose grant needs
--                                     the owner, a reason and an explicit acknowledgement.
--   hq_capability_exclusions()        the pairs no single position may hold live together.
--   hq_position_capability_guard      BEFORE trigger, for EVERY writer including migrations. It refuses an
--                                     excluded pair, and on update it refuses anything except ending a live
--                                     grant (setting effective_to with ended_by and end_reason). An ended
--                                     grant is history and is never reopened or rewritten.
--   hq_position_guard                 BEFORE update trigger. The code and the space of a position never change
--                                     (appointments resolve through both).
--   hq_position_admin_*               six functions, one per screen action. Each checks the owner, validates,
--                                     writes its audit_log row FIRST and then the change, in one transaction.
--                                     Execute is the service role only.
--
-- THE SEPARATION OF DUTIES, PER POSITION. Clinical approval with any clinical content author right
-- (competency, case, course, educator knowledge), clinical approval with clinical governance, case author
-- with case publish, course author with course publish, educator knowledge with knowledge publish, research
-- propose with research review and with research govern. The per-item independence triggers of 395, 422, 440,
-- 442, 443 and 463 are untouched and still refuse an author deciding their own content.
--
-- WHAT IT DOES NOT DO. Capabilities stay defined in code (src/lib/hq/spaces.ts) and enforced by routes, and
-- hq-guard B1 still requires the applied catalogue to equal the code catalogue. hq_position_admin_register
-- inserts only a capability the code catalogue already defines (checked by the route) and grants nothing.
-- One row per position and capability stays the rule (264 unique index), so a grant that was ended cannot be
-- granted again on the same position. That is refused with a reason, not reopened.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/HQ-POSITION-ADMIN-01/ROLLBACK-500.sql
-- ====================================================================================================

alter table hq_position_capability add column if not exists grant_reason text;
alter table hq_position_capability add column if not exists ended_by uuid references profiles(id) on delete set null;
alter table hq_position_capability add column if not exists end_reason text;

-- 1. The owner predicate. The same test as src/lib/hq/context.ts: estate role super_admin (roles, else
--    role) or platform role platform_owner (platform_roles, else platform_role).
create or replace function hq_actor_is_owner(p_actor uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from profiles p
     where p.id = p_actor
       and (
         coalesce(case when coalesce(cardinality(p.roles), 0) > 0 then 'super_admin' = any(p.roles) else p.role = 'super_admin' end, false)
         or coalesce(case when coalesce(cardinality(p.platform_roles), 0) > 0 then 'platform_owner' = any(p.platform_roles) else p.platform_role = 'platform_owner' end, false)
       )
  )
$$;

-- 2. The sensitive classes. Mirrored by HQ_SENSITIVE_CAPABILITIES in src/lib/hq/positions.ts, and the unit
--    test reads this file to prove the two agree.
create or replace function hq_capability_sensitive_class(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern') then 'clinical'
    when p_code in ('hq.practice.commercial.manage', 'hq.individual.commercial.manage', 'hq.learning.price.approve',
                    'hq.platform.ai.manage') then 'financial'
    when p_code in ('hq.platform.users.view', 'hq.platform.users.reset', 'hq.platform.system.view',
                    'hq.platform.settings.view', 'hq.platform.operations.view', 'hq.platform.tenants.view',
                    'hq.platform.audit.view', 'hq.individual.pilot.grant', 'hq.individual.config.manage',
                    'hq.individual.professional.verify', 'hq.practice.licence.verify',
                    'hq.practice.provision.execute', 'hq.practice.flags.manage', 'hq.practice.release.activate',
                    'hq.practice.release.rollback', 'hq.practice.export.execute', 'hq.practice.change.approve',
                    'hq.practice.risk.accept', 'hq.practice.configuration.manage',
                    'hq.learning.certificate.issue') then 'platform'
    else null
  end
$$;

-- 3. The excluded pairs. Mirrored by HQ_CAPABILITY_EXCLUSIONS in src/lib/hq/positions.ts.
create or replace function hq_capability_exclusions()
returns table (capability_a text, capability_b text, reason text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    ('hq.quality.clinical.approve', 'hq.quality.competency.author', 'a competency author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.quality.case.author', 'a case author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.learning.course.author', 'a course author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.learning.ckri.educator', 'a knowledge educator cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'a clinical reviewer cannot set reviewer scopes'),
    ('hq.quality.case.author', 'hq.quality.case.publish', 'a case author cannot publish cases'),
    ('hq.learning.course.author', 'hq.learning.course.publish', 'a course author cannot publish courses'),
    ('hq.learning.ckri.educator', 'hq.quality.knowledge.publish', 'a knowledge educator cannot publish knowledge resources'),
    ('hq.quality.research.propose', 'hq.quality.research.review', 'a research proposer cannot review research'),
    ('hq.quality.research.propose', 'hq.quality.research.govern', 'a research proposer cannot govern research')
  ) as t(capability_a, capability_b, reason)
$$;

-- 4. The grant guard, for every writer.
create or replace function hq_position_capability_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conflict record;
begin
  if tg_op = 'UPDATE' then
    if new.position_code is distinct from old.position_code or new.capability_code is distinct from old.capability_code
       or new.source is distinct from old.source or new.effective_from is distinct from old.effective_from
       or new.granted_by is distinct from old.granted_by or new.grant_reason is distinct from old.grant_reason
       or new.created_at is distinct from old.created_at or new.id is distinct from old.id then
      raise exception 'hq_position_capability history: a grant is never rewritten. Only ending a live grant is allowed';
    end if;
    if old.effective_to is not null then
      raise exception 'hq_position_capability history: this grant already ended and is kept as history. It cannot be reopened or changed';
    end if;
    if new.effective_to is null and (new.ended_by is distinct from old.ended_by or new.end_reason is distinct from old.end_reason) then
      raise exception 'hq_position_capability history: ended_by and end_reason are set only when the grant ends';
    end if;
    return new;
  end if;

  if new.effective_to is not null and new.effective_to <= now() then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hq_position_capability:' || new.position_code, 0));

  select e.reason, g.capability_code into v_conflict
    from hq_position_capability g
    join hq_capability_exclusions() e
      on (e.capability_a = new.capability_code and e.capability_b = g.capability_code)
      or (e.capability_b = new.capability_code and e.capability_a = g.capability_code)
   where g.position_code = new.position_code
     and g.id is distinct from new.id
     and (g.effective_to is null or g.effective_to > now())
   limit 1;
  if found then
    raise exception 'hq_position_capability separation_of_duties: % already holds %, and % (so % is refused)',
      new.position_code, v_conflict.capability_code, v_conflict.reason, new.capability_code;
  end if;
  return new;
end;
$$;

drop trigger if exists hq_position_capability_guard on hq_position_capability;
create trigger hq_position_capability_guard
  before insert or update on hq_position_capability
  for each row execute function hq_position_capability_guard();

-- 5. A position keeps its code and its space.
create or replace function hq_position_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.code is distinct from old.code or new.space is distinct from old.space then
    raise exception 'hq_position invalid: the code and the space of a position never change. Create a new position instead';
  end if;
  return new;
end;
$$;

drop trigger if exists hq_position_guard on hq_position;
create trigger hq_position_guard
  before update on hq_position
  for each row execute function hq_position_guard();

-- 6. The screen actions. Each one: owner, validate, audit_log FIRST, then the change. One transaction, so a
--    change without its audit row cannot exist and an audit row without its change is rolled back with it.
create or replace function hq_position_admin_require(p_actor uuid, p_reason text)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_actor is null or not hq_actor_is_owner(p_actor) then
    raise exception 'hq_position_admin owner_required: changing HQ positions requires platform ownership';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'hq_position_admin invalid: a reason of at least 5 characters is required';
  end if;
end;
$$;

create or replace function hq_position_admin_create(
  p_actor uuid, p_actor_name text, p_trace text,
  p_code text, p_space text, p_name text, p_description text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  if v_code !~ '^[a-z][a-z0-9_]{2,62}$' then
    raise exception 'hq_position_admin invalid: the code must be 3 to 63 lower-case letters, digits or underscores, starting with a letter';
  end if;
  if p_space is null or p_space not in ('executive', 'platform', 'practice', 'learning', 'quality') then
    raise exception 'hq_position_admin invalid: the space must be one of the five HQ spaces';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'hq_position_admin invalid: the name is required and at most 120 characters';
  end if;
  if v_desc is not null and length(v_desc) > 500 then
    raise exception 'hq_position_admin invalid: the description is at most 500 characters';
  end if;
  if exists (select 1 from hq_position where code = v_code) then
    raise exception 'hq_position_admin exists: a position with the code % already exists (positions are deactivated, never deleted)', v_code;
  end if;

  v_row := jsonb_build_object('code', v_code, 'space', p_space, 'name', v_name, 'description', v_desc,
                              'is_active', true, 'grants', jsonb_build_array('hq.platform.home.view'), 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_position_create', 'hq_position', v_code, v_row, p_trace);

  insert into hq_position (code, space, name, description, is_active) values (v_code, p_space, v_name, v_desc, true);
  -- The landing page every position reaches (264 s10). The new position only, never an existing one.
  insert into hq_position_capability (position_code, capability_code, source, granted_by, grant_reason)
  select v_code, 'hq.platform.home.view', 'explicit_grant', p_actor, 'HQ landing page for a new position'
   where exists (select 1 from hq_capability where code = 'hq.platform.home.view');
  return v_row;
end;
$$;

create or replace function hq_position_admin_update(
  p_actor uuid, p_actor_name text, p_trace text,
  p_code text, p_name text, p_description text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old hq_position%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  perform hq_position_admin_require(p_actor, p_reason);
  select * into v_old from hq_position where code = p_code for update;
  if not found then
    raise exception 'hq_position_admin not_found: no such HQ position';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'hq_position_admin invalid: the name is required and at most 120 characters';
  end if;
  if v_desc is not null and length(v_desc) > 500 then
    raise exception 'hq_position_admin invalid: the description is at most 500 characters';
  end if;
  if v_old.name = v_name and v_old.description is not distinct from v_desc then
    raise exception 'hq_position_admin unchanged: the name and description are already these';
  end if;

  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_position_update', 'hq_position', p_code,
          jsonb_build_object('name', v_old.name, 'description', v_old.description),
          jsonb_build_object('name', v_name, 'description', v_desc, 'reason', btrim(p_reason)), p_trace);

  update hq_position set name = v_name, description = v_desc where code = p_code;
  return jsonb_build_object('code', p_code, 'name', v_name, 'description', v_desc);
end;
$$;

create or replace function hq_position_admin_set_active(
  p_actor uuid, p_actor_name text, p_trace text,
  p_code text, p_active boolean, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old hq_position%rowtype;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  if p_active is null then
    raise exception 'hq_position_admin invalid: active must be true or false';
  end if;
  select * into v_old from hq_position where code = p_code for update;
  if not found then
    raise exception 'hq_position_admin not_found: no such HQ position';
  end if;
  if coalesce(v_old.is_active, true) = p_active then
    raise exception 'hq_position_admin unchanged: the position is already %', case when p_active then 'active' else 'deactivated' end;
  end if;

  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, case when p_active then 'hq_position_reactivate' else 'hq_position_deactivate' end,
          'hq_position', p_code, jsonb_build_object('is_active', coalesce(v_old.is_active, true)),
          jsonb_build_object('is_active', p_active, 'reason', btrim(p_reason)), p_trace);

  update hq_position set is_active = p_active where code = p_code;
  return jsonb_build_object('code', p_code, 'is_active', p_active);
end;
$$;

create or replace function hq_position_admin_grant(
  p_actor uuid, p_actor_name text, p_trace text,
  p_position text, p_capability text, p_reason text, p_acknowledge_sensitive boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pos hq_position%rowtype;
  v_class text := hq_capability_sensitive_class(p_capability);
  v_id uuid := gen_random_uuid();
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  select * into v_pos from hq_position where code = p_position for update;
  if not found then
    raise exception 'hq_position_admin not_found: no such HQ position';
  end if;
  if v_pos.is_active = false then
    raise exception 'hq_position_admin invalid: % is deactivated, so a grant to it would grant nothing', p_position;
  end if;
  if not exists (select 1 from hq_capability where code = p_capability) then
    raise exception 'hq_position_admin not_found: % is not in the applied capability catalogue', p_capability;
  end if;
  if exists (select 1 from hq_position_capability where position_code = p_position and capability_code = p_capability
              and (effective_to is null or effective_to > now())) then
    raise exception 'hq_position_admin exists: % already holds %', p_position, p_capability;
  end if;
  if exists (select 1 from hq_position_capability where position_code = p_position and capability_code = p_capability) then
    raise exception 'hq_position_admin history: % held % before and it was ended. The ended grant is kept as history and is not reopened', p_position, p_capability;
  end if;
  if v_class is not null and coalesce(p_acknowledge_sensitive, false) = false then
    raise exception 'hq_position_admin sensitive: % is a % capability. Its grant must be acknowledged as sensitive', p_capability, v_class;
  end if;

  v_row := jsonb_build_object('position', p_position, 'capability', p_capability, 'sensitive_class', v_class,
                              'source', 'explicit_grant', 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_position_grant', 'hq_position_capability', v_id, p_position, v_row, p_trace);

  insert into hq_position_capability (id, position_code, capability_code, source, granted_by, grant_reason)
  values (v_id, p_position, p_capability, 'explicit_grant', p_actor, btrim(p_reason));
  return v_row || jsonb_build_object('id', v_id);
end;
$$;

create or replace function hq_position_admin_end_grant(
  p_actor uuid, p_actor_name text, p_trace text,
  p_position text, p_capability text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_grant hq_position_capability%rowtype;
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  select * into v_grant from hq_position_capability
   where position_code = p_position and capability_code = p_capability
     and (effective_to is null or effective_to > now())
   for update;
  if not found then
    raise exception 'hq_position_admin not_found: % holds no live grant of %', p_position, p_capability;
  end if;
  if v_grant.effective_from >= now() then
    raise exception 'hq_position_admin invalid: this grant has not started yet and cannot be ended now';
  end if;

  v_row := jsonb_build_object('position', p_position, 'capability', p_capability, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_position_end_grant', 'hq_position_capability', v_grant.id, p_position,
          jsonb_build_object('effective_from', v_grant.effective_from, 'effective_to', v_grant.effective_to),
          v_row, p_trace);

  update hq_position_capability set effective_to = now(), ended_by = p_actor, end_reason = btrim(p_reason)
   where id = v_grant.id;
  return v_row || jsonb_build_object('id', v_grant.id);
end;
$$;

create or replace function hq_position_admin_register(
  p_actor uuid, p_actor_name text, p_trace text,
  p_code text, p_space text, p_label text, p_description text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  if p_code is null or p_code !~ '^hq\.[a-z]+\.[a-z_]+(\.[a-z_]+)*$' then
    raise exception 'hq_position_admin invalid: % is not an HQ capability code', p_code;
  end if;
  if p_space is null or p_space not in ('executive', 'platform', 'practice', 'learning', 'quality') then
    raise exception 'hq_position_admin invalid: the space must be one of the five HQ spaces';
  end if;
  if v_label = '' then
    raise exception 'hq_position_admin invalid: the label is required';
  end if;
  if exists (select 1 from hq_capability where code = p_code) then
    raise exception 'hq_position_admin exists: % is already in the applied catalogue', p_code;
  end if;

  v_row := jsonb_build_object('code', p_code, 'space', p_space, 'label', v_label,
                              'description', nullif(btrim(coalesce(p_description, '')), ''), 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_capability_register', 'hq_capability', p_code, v_row, p_trace);

  insert into hq_capability (code, space, label, description)
  values (p_code, p_space, v_label, nullif(btrim(coalesce(p_description, '')), ''));
  return v_row;
end;
$$;

-- 7. Nobody but the service role may call the actions. The guards and the pure helpers stay callable by
--    the triggers, which run as whoever writes.
revoke all on function hq_position_admin_require(uuid, text) from public, anon, authenticated;
revoke all on function hq_position_admin_create(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function hq_position_admin_update(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function hq_position_admin_set_active(uuid, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function hq_position_admin_grant(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function hq_position_admin_end_grant(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function hq_position_admin_register(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function hq_actor_is_owner(uuid) from public, anon, authenticated;
grant execute on function hq_position_admin_require(uuid, text) to service_role;
grant execute on function hq_position_admin_create(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function hq_position_admin_update(uuid, text, text, text, text, text, text) to service_role;
grant execute on function hq_position_admin_set_active(uuid, text, text, text, boolean, text) to service_role;
grant execute on function hq_position_admin_grant(uuid, text, text, text, text, text, boolean) to service_role;
grant execute on function hq_position_admin_end_grant(uuid, text, text, text, text, text) to service_role;
grant execute on function hq_position_admin_register(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function hq_actor_is_owner(uuid) to service_role;

-- Verification: no live position already holds an excluded pair (expect zero rows).
select g1.position_code, g1.capability_code, g2.capability_code
  from hq_position_capability g1
  join hq_position_capability g2 on g2.position_code = g1.position_code
  join hq_capability_exclusions() e on e.capability_a = g1.capability_code and e.capability_b = g2.capability_code
 where g1.effective_to is null and g2.effective_to is null;

notify pgrst, 'reload schema';
