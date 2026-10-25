-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql DO block. Paste the entire file into the SQL editor and run it once.
-- ====================================================================================================
-- ROLLBACK 510 (staging). Removes the Competency Verification Studio tables, functions, positions and capabilities.
--
-- IT REFUSES, AND CHANGES NOTHING, when verification history exists (any request) or when anybody was ever
-- appointed to either position. Removing it then would destroy decisions about real or synthetic people, or
-- leave appointments to positions that no longer exist. Fix forward instead.
-- Roll 511 back FIRST if it is applied (ROLLBACK-511.sql), so the 500 guard no longer names these codes.
-- ====================================================================================================

do $$
begin
  if to_regclass('public.competency_verification_request') is not null
     and exists (select 1 from competency_verification_request) then
    raise exception 'ROLLBACK-510 refused: verification requests exist. They are history. Fix forward instead';
  end if;
  if exists (select 1 from ogs_office_appointments where role in ('competency_verification_administrator', 'competency_assessor')) then
    raise exception 'ROLLBACK-510 refused: somebody has been appointed to a Verification Studio position. End and keep the record, and fix forward';
  end if;
  if exists (select 1 from hq_capability_exclusions() where capability_a like 'hq.competency.verification.%' or capability_b like 'hq.competency.verification.%') then
    raise exception 'ROLLBACK-510 refused: 511 is still applied. Run ROLLBACK-511 first';
  end if;
end
$$;

drop table if exists competency_verification_decision cascade;
drop table if exists competency_verification_event cascade;
drop table if exists competency_verification_evidence cascade;
drop table if exists competency_verification_request cascade;
drop table if exists competency_assessor_scope cascade;
drop table if exists competency_verification_method_version cascade;
drop table if exists competency_verification_method cascade;

drop function if exists public.competency_verification_submit(uuid, uuid, uuid, integer[], uuid, text, text, uuid, jsonb);
drop function if exists public.competency_verification_add_evidence(uuid, uuid, jsonb);
drop function if exists public.competency_verification_decision_guard();
drop function if exists public.competency_verification_event_guard();
drop function if exists public.competency_verification_evidence_guard();
drop function if exists public.competency_verification_request_guard();
drop function if exists public.competency_assessor_scope_guard();
drop function if exists public.competency_verification_method_version_guard();
drop function if exists public.competency_verification_method_guard();
drop function if exists public.competency_method_content_problem(jsonb);
drop function if exists public.competency_verification_state(uuid);
drop function if exists public.competency_assessor_covers(uuid, uuid, uuid, uuid, text, date);
drop function if exists public.competency_method_applies(jsonb, uuid, text);
drop function if exists public.competency_appointment_holds(uuid, uuid, text);

delete from hq_position_capability where position_code in ('competency_verification_administrator', 'competency_assessor')
   or capability_code in ('hq.competency.verification.manage', 'hq.competency.verification.assess');
delete from hq_position where code in ('competency_verification_administrator', 'competency_assessor');
delete from hq_capability where code in ('hq.competency.verification.manage', 'hq.competency.verification.assess');

notify pgrst, 'reload schema';
