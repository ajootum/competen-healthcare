-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 641: MANY-TO-MANY HQ APPOINTMENTS, SHARED ROLES AND INDIVIDUALLY SCOPED AUTHORITY
--
-- Owner addendum to HQ-SOD-CROSSCUT-01, "Competen HQ Governance Consolidation" (28 Oct 2026): few
-- configurable role types, unlimited authorised holders, flexible responsibilities and mandatory independent
-- decisions. Extends 640 (which stays as staged). Staging first. Production is applied by the owner by hand.
-- Build record: docs/evidence/HQ-SOD-CROSSCUT-01/641-build-record.md
--
-- DEPENDS ON 640 and everything 640 depends on, plus 451 (individual_holds_capability), 462
-- (learning_holds_capability), 510 (competency_appointment_holds) and 620 (hq_gov_studio_can_edit). APPLY
-- AFTER 640. Additive. Re-running it is a no-op. It appoints NOBODY and changes no existing appointment.
--
-- ----------------------------------------------------------------------------------------------------
-- MEASURED BEFORE BUILDING. ogs_office_appointments has no unique index or constraint, so a person could
-- already hold many roles and a role many holders. The 610 seat model keeps one live record per seat: seats
-- are governance records (board, committee, portfolio), capability-free, and never cap HQ position holders.
-- Board composition and committee voting stay with their legal documents and terms of reference.
--
-- WHAT IT ADDS.
--   On an HQ appointment (ogs_office_appointments, HQ offices only):
--     capability_scope   null = everything the position grants. Otherwise only these, a subset of the
--                        position's live grants. Content scope stays the 395 reviewer scopes.
--     is_primary         the primary coordinator or accountable owner of the role. At most one live per role.
--     authorised_by/at   who authorised this write, stamped on it. Required on every write that gives or
--                        changes authority. Never the appointee. Always a platform owner.
--   On a position (hq_position), the appointment rules:
--     max_holders        null = unlimited (the default). Never a cap unless the owner sets one.
--     primary_policy     not_used, optional (default) or required (the board shows a missing primary).
--     scoped_appointments  true = each appointment must name the capabilities it carries, so a broad role
--                        never grants everything by default. ON for scholar_clinical_lead.
--   hq_appointment_rules_guard   enforces the above for every writer (non-switchable independence).
--   hq_appointment_audit         an audit_log row for every HQ appointment write, for every writer.
--   hq_appointment_in_force()    capability scope and term dates. The five holds-capability functions
--                        (440, 451, 462, 510, 620) and clinical approval are narrowed by it, so effective
--                        capability is the union over appointments, each narrowed by its own scope and term.
--   hq_position_admin_set_rules  the no-code rules, owner only, audit first (the 500 pattern).
-- What it does NOT change: 640's item-level guards, which already evaluate a person across ALL their
-- appointments, the 395 one-decision-per-reviewer rule (so two appointments never give two approvals), the
-- competency assessor separation, and every existing appointment, decision and audit row.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/HQ-SOD-CROSSCUT-01/ROLLBACK-641.sql
-- ====================================================================================================


-- ---- 1. columns -------------------------------------------------------------------------------------

alter table ogs_office_appointments add column if not exists capability_scope text[];
alter table ogs_office_appointments add column if not exists is_primary boolean not null default false;
alter table ogs_office_appointments add column if not exists authorised_by uuid references profiles(id) on delete set null;
alter table ogs_office_appointments add column if not exists authorised_at timestamptz;

alter table hq_position add column if not exists max_holders integer;
alter table hq_position add column if not exists primary_policy text not null default 'optional';
alter table hq_position add column if not exists scoped_appointments boolean not null default false;
alter table hq_position drop constraint if exists hq_position_appointment_rules_check;
alter table hq_position add constraint hq_position_appointment_rules_check
  check ((max_holders is null or max_holders >= 1) and primary_policy in ('not_used', 'optional', 'required'));


-- ---- 2. scope and term: whether an appointment carries a capability today ------------------------------

create or replace function hq_appointment_in_force(p_scope text[], p_term_start date, p_term_end date, p_capability text)
returns boolean
language sql
stable
set search_path = public
as $$
  select (p_scope is null or p_capability = any(p_scope) or p_capability = 'hq.platform.home.view')
     and (p_term_start is null or p_term_start <= current_date)
     and (p_term_end is null or p_term_end >= current_date)
$$;

-- The five holds-capability functions, each unchanged except for the one narrowing line.
create or replace function public.ckri_holds_capability(p_person uuid, p_capability text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select p_person is not null and exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.person_id = p_person
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = p_capability
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
       and hq_appointment_in_force(a.capability_scope, a.term_start, a.term_end, pc.capability_code)
  )
$$;

create or replace function public.individual_holds_capability(p_person uuid, p_capability text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select p_person is not null and exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.person_id = p_person
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = p_capability
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
       and hq_appointment_in_force(a.capability_scope, a.term_start, a.term_end, pc.capability_code)
  )
$$;

create or replace function public.learning_holds_capability(p_person uuid, p_capability text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from ogs_office_appointments a
      join ogs_offices o on o.id = a.office_id
      join hq_position p on p.code = a.role
      join hq_position_capability pc on pc.position_code = p.code
     where a.person_id = p_person
       and a.status = 'active'
       and o.is_active is not false
       and coalesce(o.status, 'active') not in ('dissolved', 'archived')
       and p.is_active
       and pc.capability_code = p_capability
       and pc.effective_to is null
       and (pc.effective_from is null or pc.effective_from <= now())
       and hq_appointment_in_force(a.capability_scope, a.term_start, a.term_end, pc.capability_code)
  )
$$;

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
       and hq_appointment_in_force(a.capability_scope, a.term_start, a.term_end, pc.capability_code)
  )
$$;

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
       and hq_appointment_in_force(a.capability_scope, a.term_start, a.term_end, pc.capability_code)
  ))
$$;

-- Clinical approval: the 461 guard checks the position. This checks the appointment's own scope and term.
create or replace function public.clinical_review_decision_scope_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from ogs_office_appointments a
                  where a.id = new.appointment_id
                    and hq_appointment_in_force(a.capability_scope, a.term_start, a.term_end, 'hq.quality.clinical.approve')) then
    raise exception 'clinical_review_decision: not authorised. This appointment does not carry clinical approval, or its term is not in force';
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_review_decision_scope_guard on clinical_review_decision;
create trigger clinical_review_decision_scope_guard
  before insert on clinical_review_decision
  for each row execute function public.clinical_review_decision_scope_guard();


-- ---- 3. the appointment rules, for every writer ------------------------------------------------------

create or replace function hq_appointment_rules_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hq boolean;
  v_pos hq_position%rowtype;
  v_bad text;
begin
  -- A cascade (a profile removed, ON DELETE SET NULL) is not a writer giving authority.
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  select o.office_type like 'hq\_%' into v_hq from ogs_offices o where o.id = new.office_id;
  if not coalesce(v_hq, false) then
    return new;
  end if;
  if new.term_start is not null and new.term_end is not null and new.term_end < new.term_start then
    raise exception 'hq_appointment invalid: the term ends before it starts';
  end if;
  if new.status is distinct from 'active' then
    -- An appointment that grants nothing is nobody's primary.
    new.is_primary := false;
    return new;
  end if;
  select * into v_pos from hq_position where code = new.role;
  if not found then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' and old.role is not distinct from new.role
     and old.person_id is not distinct from new.person_id and old.office_id is not distinct from new.office_id
     and old.capability_scope is not distinct from new.capability_scope and old.is_primary is not distinct from new.is_primary
     and old.term_start is not distinct from new.term_start and old.term_end is not distinct from new.term_end then
    return new;
  end if;

  -- Non-switchable independence: authorised on THIS write, by an owner, never by the appointee.
  if new.authorised_by is null or new.authorised_at is null
     or (tg_op = 'UPDATE' and new.authorised_at is not distinct from old.authorised_at) then
    raise exception 'hq_appointment not_authorised: an HQ appointment, and every change to what it carries, records who authorised it on that change';
  end if;
  if new.authorised_by = new.person_id then
    raise exception 'hq_appointment not_independent: nobody appoints themselves or changes what their own appointment carries';
  end if;
  if not hq_actor_is_owner(new.authorised_by) then
    raise exception 'hq_appointment owner_required: HQ appointments are made and changed by a platform owner';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hq_appointment_role:' || new.role, 0));
  if v_pos.max_holders is not null and (
      select count(*) from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
       where x.role = new.role and x.status = 'active' and x.id <> new.id and o.office_type like 'hq\_%') >= v_pos.max_holders then
    raise exception 'hq_appointment capacity: % allows at most % concurrent holders', v_pos.name, v_pos.max_holders;
  end if;

  if new.is_primary then
    if v_pos.primary_policy = 'not_used' then
      raise exception 'hq_appointment invalid: % does not use a primary holder', v_pos.name;
    end if;
    if exists (select 1 from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
                where x.role = new.role and x.status = 'active' and x.is_primary and x.id <> new.id and o.office_type like 'hq\_%') then
      raise exception 'hq_appointment exists: % already has a primary holder. Remove that designation first', v_pos.name;
    end if;
  end if;

  if new.capability_scope is not null then
    if cardinality(new.capability_scope) = 0 then
      raise exception 'hq_appointment invalid: a capability scope names at least one capability. Leave it unset for everything the position grants';
    end if;
    select string_agg(c, ', ') into v_bad from unnest(new.capability_scope) c
     where not exists (select 1 from hq_position_capability g where g.position_code = new.role and g.capability_code = c
                         and (g.effective_to is null or g.effective_to > now()));
    if v_bad is not null then
      raise exception 'hq_appointment invalid: % does not grant %', v_pos.name, v_bad;
    end if;
  elsif v_pos.scoped_appointments then
    raise exception 'hq_appointment invalid: % grants authority per appointment. Name the capabilities this appointment carries', v_pos.name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hq_appointment_rules_guard on ogs_office_appointments;
create trigger trg_hq_appointment_rules_guard
  before insert or update on ogs_office_appointments
  for each row execute function hq_appointment_rules_guard();

-- Every HQ appointment write leaves an audit row, whoever writes it.
create or replace function hq_appointment_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hq boolean;
  v_old jsonb;
begin
  select o.office_type like 'hq\_%' into v_hq from ogs_offices o where o.id = new.office_id;
  if not coalesce(v_hq, false) then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status and old.role is not distinct from new.role
       and old.person_id is not distinct from new.person_id and old.capability_scope is not distinct from new.capability_scope
       and old.is_primary is not distinct from new.is_primary and old.term_start is not distinct from new.term_start
       and old.term_end is not distinct from new.term_end then
      return new;
    end if;
    v_old := jsonb_build_object('status', old.status, 'role', old.role, 'person_id', old.person_id, 'capability_scope', old.capability_scope,
                                'is_primary', old.is_primary, 'term_start', old.term_start, 'term_end', old.term_end);
  end if;
  insert into audit_log (actor_id, action, entity_type, entity_id, entity_name, old_value, new_value)
  values (new.authorised_by, case when tg_op = 'INSERT' then 'hq_appointment_recorded' else 'hq_appointment_changed' end,
          'ogs_office_appointment', new.id, new.role, v_old,
          jsonb_build_object('status', new.status, 'role', new.role, 'person_id', new.person_id, 'capability_scope', new.capability_scope,
                             'is_primary', new.is_primary, 'term_start', new.term_start, 'term_end', new.term_end,
                             'authorised_at', new.authorised_at));
  return new;
end;
$$;

drop trigger if exists trg_hq_appointment_audit on ogs_office_appointments;
create trigger trg_hq_appointment_audit
  after insert or update on ogs_office_appointments
  for each row execute function hq_appointment_audit();


-- ---- 4. the no-code appointment rules: owner, reason, audit FIRST, then the change ---------------------

create or replace function hq_position_admin_set_rules(
  p_actor uuid, p_actor_name text, p_trace text,
  p_code text, p_max_holders integer, p_primary_policy text, p_scoped_appointments boolean, p_product_line text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old hq_position%rowtype;
  v_live integer;
  v_row jsonb;
begin
  perform hq_position_admin_require(p_actor, p_reason);
  select * into v_old from hq_position where code = p_code for update;
  if not found then
    raise exception 'hq_position_admin not_found: no such HQ position';
  end if;
  if p_max_holders is not null and p_max_holders < 1 then
    raise exception 'hq_position_admin invalid: a maximum is at least 1, or unset for unlimited holders';
  end if;
  if p_primary_policy is null or p_primary_policy not in ('not_used', 'optional', 'required') then
    raise exception 'hq_position_admin invalid: the primary holder policy is not_used, optional or required';
  end if;
  if p_scoped_appointments is null then
    raise exception 'hq_position_admin invalid: scoped appointments must be true or false';
  end if;
  if p_product_line is not null and not exists (select 1 from plat_product_line where code = p_product_line) then
    raise exception 'hq_position_admin not_found: no product line %', p_product_line;
  end if;
  if v_old.max_holders is not distinct from p_max_holders and v_old.primary_policy = p_primary_policy
     and v_old.scoped_appointments = p_scoped_appointments and v_old.product_line_code is not distinct from p_product_line then
    raise exception 'hq_position_admin unchanged: the appointment rules are already these';
  end if;
  select count(*) into v_live from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
   where x.role = p_code and x.status = 'active' and o.office_type like 'hq\_%';
  if p_max_holders is not null and v_live > p_max_holders then
    raise exception 'hq_position_admin invalid: % has % live holders, more than %. End appointments first', v_old.name, v_live, p_max_holders;
  end if;
  if p_primary_policy = 'not_used' and exists (select 1 from ogs_office_appointments x where x.role = p_code and x.status = 'active' and x.is_primary) then
    raise exception 'hq_position_admin invalid: % has a primary holder. Remove that designation first', v_old.name;
  end if;
  if p_scoped_appointments and exists (select 1 from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
                                        where x.role = p_code and x.status = 'active' and x.capability_scope is null and o.office_type like 'hq\_%') then
    raise exception 'hq_position_admin invalid: % has holders whose appointment carries everything. Scope those appointments first', v_old.name;
  end if;

  v_row := jsonb_build_object('max_holders', p_max_holders, 'primary_policy', p_primary_policy,
                              'scoped_appointments', p_scoped_appointments, 'product_line_code', p_product_line, 'reason', btrim(p_reason));
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_position_rules_set', 'hq_position', p_code,
          jsonb_build_object('max_holders', v_old.max_holders, 'primary_policy', v_old.primary_policy,
                             'scoped_appointments', v_old.scoped_appointments, 'product_line_code', v_old.product_line_code),
          v_row, p_trace);

  update hq_position set max_holders = p_max_holders, primary_policy = p_primary_policy,
         scoped_appointments = p_scoped_appointments, product_line_code = p_product_line
   where code = p_code;
  return v_row || jsonb_build_object('code', p_code);
end;
$$;

revoke all on function hq_position_admin_set_rules(uuid, text, text, text, integer, text, boolean, text, text) from public, anon, authenticated;
grant execute on function hq_position_admin_set_rules(uuid, text, text, text, integer, text, boolean, text, text) to service_role;
revoke all on function hq_appointment_in_force(text[], date, date, text) from public, anon, authenticated;
grant execute on function hq_appointment_in_force(text[], date, date, text) to service_role;


-- ---- 5. Scholar: the broad cross-cutting role carries authority per appointment ------------------------

update hq_position set scoped_appointments = true
 where code = 'scholar_clinical_lead' and scoped_appointments = false
   and not exists (select 1 from ogs_office_appointments x where x.role = 'scholar_clinical_lead' and x.status = 'active' and x.capability_scope is null);


-- Verification: nothing appointed, no live HQ appointment broken by the new rules (expect zero rows in the
-- last two), and the Scholar lead scoped.
select code, max_holders, primary_policy, scoped_appointments from hq_position where code = 'scholar_clinical_lead';

select x.id, x.role, x.term_start, x.term_end from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
 where x.status = 'active' and o.office_type like 'hq\_%'
   and ((x.term_start is not null and x.term_start > current_date) or (x.term_end is not null and x.term_end < current_date));

select x.role, count(*) from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
 where x.status = 'active' and x.is_primary and o.office_type like 'hq\_%' group by x.role having count(*) > 1;

notify pgrst, 'reload schema';
