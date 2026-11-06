-- ROLLBACK FOR MIGRATION 901. APPLY THIS FILE WHOLE. Removes every lifeos_ object and all LifeOS data.
-- Only for use with an owner GO. Nothing outside lifeos_ objects is touched.
begin;
drop view if exists lifeos_live_grant;
drop view if exists lifeos_live_idempotency;
drop view if exists lifeos_live_entitlement;
drop function if exists lifeos_mutate(uuid, text, text, text, text, jsonb);
drop function if exists lifeos_rate_take(text, text, integer, integer);
drop table if exists lifeos_rate_window, lifeos_idempotency, lifeos_audit_event, lifeos_suggestion,
  lifeos_permission_grant, lifeos_weekly_review, lifeos_big_rock, lifeos_weekly_plan, lifeos_protected_block,
  lifeos_calendar_event, lifeos_integration_connection, lifeos_delegation, lifeos_quadrant_classification,
  lifeos_commitment, lifeos_project, lifeos_goal, lifeos_world, lifeos_membership, lifeos_workspace, lifeos_entitlement, lifeos_tenant,
  lifeos_identity_link, lifeos_individual, lifeos_flag cascade;
drop function if exists lifeos_stamp();
drop function if exists lifeos_audit();
drop function if exists lifeos_log_quadrant();
drop function if exists lifeos_refuse_change();
drop function if exists lifeos_guard_personal_membership();
commit;
notify pgrst, 'reload schema';
