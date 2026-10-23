-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql function body between dollar quotes. A runner that splits
-- on the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 383: AN ATOMIC RATE LIMIT FOR ADMINISTRATOR PASSWORD RESETS
--
-- HQ-USERS-B (owner GO 2026-10-23, Password-reset security: concurrency-safe rate limits). Reserved
-- number 383. OPS-001 s8 tier: Medium (a new function that gates a security control), so it carries a
-- staging rollback rehearsal: apply twice, fingerprint, roll back, fingerprint, re-apply twice, fingerprint.
--
-- APPLY ON STAGING FIRST. It creates one function and changes its grants. It alters no table, row or
-- policy, and re-running it is a no-op (create or replace, then the same grants).
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It makes "3 requests per person and 20 per administrator per hour" true even when two requests arrive
-- at the same moment, which counting and inserting from the application could not guarantee.
--
-- ----------------------------------------------------------------------------------------------------
-- HOW.
--
--   hq_reserve_password_reset(actor, target, actor_name, trace) takes ONE transaction-scoped advisory
--   lock, so reservations are serialised (a handful an hour, so one lock costs nothing and cannot
--   deadlock). Under it, it counts this hour of admin_password_reset_reserved rows in audit_log by the
--   DATABASE clock (now()), refuses with actor_limited at 20 for the administrator or target_limited at
--   3 for the person, and otherwise inserts this request reservation row and answers reserved.
--
--   The limits are written HERE, not passed in: no caller can widen them. Refused requests insert
--   nothing, so they do not keep a person locked out.
--
-- NOBODY BUT THE SERVICE ROLE MAY CALL IT. Execute is revoked from public, anon and authenticated, so a
-- signed-in browser cannot write audit rows or probe the limits through PostgREST.
--
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. APPLY WHOLE banner above (dollar
--   quotes). notify pgrst last.
--
-- ROLLBACK (staging): drop function hq_reserve_password_reset(uuid, uuid, text, text). The application
--   then refuses every administrator reset (503) until it is restored -- it never sends unmetered.
-- ====================================================================================================

create or replace function hq_reserve_password_reset(p_actor uuid, p_target uuid, p_actor_name text, p_trace text)
returns table (outcome text, reserved_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_actor int;
  v_target int;
begin
  perform pg_advisory_xact_lock(hashtextextended('hq_reserve_password_reset', 0));

  select count(*) into v_actor from audit_log
   where action = 'admin_password_reset_reserved' and actor_id = p_actor and created_at > v_now - interval '1 hour';
  if v_actor >= 20 then
    return query select 'actor_limited'::text, v_now;
    return;
  end if;

  select count(*) into v_target from audit_log
   where action = 'admin_password_reset_reserved' and entity_id = p_target and created_at > v_now - interval '1 hour';
  if v_target >= 3 then
    return query select 'target_limited'::text, v_now;
    return;
  end if;

  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, new_value, trace_id, created_at)
  values (p_actor, p_actor_name, 'admin_password_reset_reserved', 'user', p_target, '{}'::jsonb, p_trace, v_now);
  return query select 'reserved'::text, v_now;
end;
$$;

revoke all on function hq_reserve_password_reset(uuid, uuid, text, text) from public;
revoke all on function hq_reserve_password_reset(uuid, uuid, text, text) from anon;
revoke all on function hq_reserve_password_reset(uuid, uuid, text, text) from authenticated;
grant execute on function hq_reserve_password_reset(uuid, uuid, text, text) to service_role;

-- Verification: the function exists, and only the service role (and the owner) may execute it.
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
  from pg_proc p
 where p.proname = 'hq_reserve_password_reset';

select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_name = 'hq_reserve_password_reset'
 order by grantee;

notify pgrst, 'reload schema';
