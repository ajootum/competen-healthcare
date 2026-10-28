-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It restores five functions of migrations 440, 451, 462, 510 and 620 between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 641 (STAGING). Removes the appointment rules, the per-appointment scope and term narrowing, the
-- appointment audit trigger and the rules function, and restores the five holds-capability functions exactly.
-- It REFUSES while any live HQ appointment carries a capability scope, because removing it would WIDEN that
-- person's authority. 640 is untouched. Audit rows written by 641 stay as history.
-- Production: not to be run without the owner. Fix forward instead.

do $$
begin
  if exists (select 1 from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
              where x.status = 'active' and x.capability_scope is not null and o.office_type like 'hq\_%') then
    raise exception 'rollback 641 refused: a live HQ appointment carries a capability scope, and removing it would widen that authority. Fix forward instead';
  end if;
end;
$$;

drop trigger if exists trg_hq_appointment_rules_guard on ogs_office_appointments;
drop trigger if exists trg_hq_appointment_audit on ogs_office_appointments;
drop trigger if exists clinical_review_decision_scope_guard on clinical_review_decision;

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
  ))
$$;

drop function if exists hq_position_admin_set_rules(uuid, text, text, text, integer, text, boolean, text, text);
drop function if exists hq_appointment_rules_guard();
drop function if exists hq_appointment_audit();
drop function if exists public.clinical_review_decision_scope_guard();
drop function if exists hq_appointment_in_force(text[], date, date, text);

alter table hq_position drop constraint if exists hq_position_appointment_rules_check;
alter table hq_position drop column if exists max_holders;
alter table hq_position drop column if exists primary_policy;
alter table hq_position drop column if exists scoped_appointments;
alter table ogs_office_appointments drop column if exists capability_scope;
alter table ogs_office_appointments drop column if exists is_primary;
alter table ogs_office_appointments drop column if exists authorised_by;
alter table ogs_office_appointments drop column if exists authorised_at;

notify pgrst, 'reload schema';
