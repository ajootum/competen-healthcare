-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK-620 (staging rehearsal, or production only with an owner GO).
-- Removes what 620 added and restores the 610 and 511 definitions it replaced. Any structure version after
-- version 1 is lost with its table, so take a copy first (select from hq_gov_structure_version). A 610 row
-- that a later version added stays, without its version columns. The audit_log rows stay.
-- A relationship row whose type is not one of the six 610 types makes the restored CHECK fail. Retire or
-- record it first, the rollback then stops before changing anything else.
-- ====================================================================================================
drop trigger if exists trg_hq_gov_appointment_version_stamp on hq_gov_seat_appointment;
drop trigger if exists trg_hq_gov_delegation_version_stamp on hq_gov_delegation;
drop trigger if exists trg_hq_gov_structure_version_guard on hq_gov_structure_version;
drop function if exists hq_gov_studio_publish(uuid, text, text, uuid, date, text, text);
drop function if exists hq_gov_studio_transition(uuid, text, text, uuid, text, text);
drop function if exists hq_gov_studio_save_draft(uuid, text, text, uuid, integer, jsonb, text, text, text);
drop function if exists hq_gov_studio_create_draft(uuid, text, text, text, text, text);
drop function if exists hq_gov_studio_create_structure(uuid, text, text, text, text, text, text, text);
drop function if exists hq_gov_studio_add_relation_type(uuid, text, text, text, text, text, text, text);
drop function if exists hq_gov_studio_audit(uuid, text, text, text, uuid, text, jsonb, jsonb);
drop function if exists hq_gov_studio_check(uuid);
drop function if exists hq_gov_studio_project(uuid);
drop function if exists hq_gov_studio_require(uuid, text, boolean);
drop function if exists hq_gov_studio_can_edit(uuid);
drop function if exists hq_gov_structure_version_guard();
drop function if exists hq_gov_delegation_version_stamp();
drop function if exists hq_gov_appointment_version_stamp();
alter table hq_gov_delegation drop constraint if exists hq_gov_delegation_relation_fk;
alter table hq_gov_delegation add constraint hq_gov_delegation_relation_check
  check (relation in ('interim_authority', 'corporate_reporting', 'mandate', 'specialist_oversight', 'joint_review', 'service'));
alter table hq_gov_seat drop constraint if exists hq_gov_seat_kind_check;
alter table hq_gov_seat add constraint hq_gov_seat_kind_check
  check (seat_kind in ('director', 'committee_function', 'lead', 'portfolio', 'it_function'));
alter table hq_gov_body drop constraint if exists hq_gov_body_level_check;
alter table hq_gov_body add constraint hq_gov_body_level_check
  check ((kind = 'service' and level is null) or (kind <> 'service' and level is not null and level in (1, 2, 3)));
alter table hq_gov_body drop constraint if exists hq_gov_body_kind_check;
alter table hq_gov_body add constraint hq_gov_body_kind_check
  check (kind in ('holding_company', 'board', 'committee', 'product_lead', 'service'));
alter table hq_gov_seat_appointment drop column if exists structure_version_id;
alter table hq_gov_link drop column if exists retired_version_id;
alter table hq_gov_link drop column if exists introduced_version_id;
alter table hq_gov_link drop column if exists is_active;
alter table hq_gov_delegation drop column if exists decided_version_id;
alter table hq_gov_delegation drop column if exists retired_version_id;
alter table hq_gov_delegation drop column if exists introduced_version_id;
alter table hq_gov_delegation drop column if exists is_active;
alter table hq_gov_seat drop column if exists retired_version_id;
alter table hq_gov_seat drop column if exists introduced_version_id;
alter table hq_gov_seat drop column if exists appointment_requirements;
alter table hq_gov_body drop column if exists retired_version_id;
alter table hq_gov_body drop column if exists introduced_version_id;
alter table hq_gov_body drop column if exists structure_code;
drop function if exists hq_gov_published_version(text);
drop table if exists hq_gov_relation_type;
drop table if exists hq_gov_structure_version;
drop table if exists hq_gov_structure;
-- The 610 relationship guard, restored exactly.
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
  if tg_op = 'UPDATE' and old.status = 'withdrawn' then
    raise exception 'hq_gov history: a withdrawn delegation cannot be reopened';
  end if;
  -- Only an established body can delegate. A board that is not incorporated delegates nothing.
  if new.status in ('interim', 'approved') then
    select * into v_from from hq_gov_body where code = new.from_body_code;
    if v_from.constitution_status <> 'established' then
      raise exception 'hq_gov invalid: % is not established, so it cannot delegate yet', v_from.name;
    end if;
  end if;
  return new;
end;
$$;
-- The 511 sensitive classes, restored exactly.
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
                    'hq.learning.certificate.issue') then 'platform'
    else null
  end
$$;
-- The capability, only while no position holds it.
delete from hq_capability c where c.code = 'hq.platform.governance.manage'
  and not exists (select 1 from hq_position_capability g where g.capability_code = c.code);
notify pgrst, 'reload schema';
