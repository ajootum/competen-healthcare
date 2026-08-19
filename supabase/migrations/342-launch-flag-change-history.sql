-- APPLY THIS FILE WHOLE. It defines a function body, so a statement-splitting runner would cut it in
-- half.
--
-- Migration 342: launch-flag change history, without opening the practice audit trail
--
-- ============================ THE CONSTRAINT THIS RESPECTS ============================
--
-- CPR-PD-014 section 7.2 B wants each launch toggle to show its current state, who last changed it,
-- when, and why. All four facts already exist: the flags API writes an audit event carrying the flag,
-- the before and after values and (since this build) the reason.
--
-- !! BUT practice_audit_event IS DELIBERATELY OUTSIDE THE PLATFORM PLANE. src/lib/access/plane-boundary.ts
-- says so in as many words: "its payloads carry clinical detail, and it is the practice's own trail.
-- Reaching it from a super-admin page must turn this harness red." That rule is correct and this
-- migration does not weaken it. The allowlist is table-and-column and cannot express "only rows whose
-- event_type is this one", so adding the table would grant every row of every practice trail in order
-- to show three columns about a platform switch.
--
-- ============================ WHAT THIS RETURNS, AND WHAT IT CANNOT ============================
--
-- The same shape as the onboarding projection in 339: a function whose RETURNS TABLE fixes the columns,
-- so no caller can widen it later. It is filtered to ONE event type and extracts FOUR named payload
-- keys. There is no branch that returns a payload wholesale, no parameter that selects a different
-- event type, and no path by which a clinical event could appear.
--
-- !! actor_id IS A UUID AND NOT A NAME. Resolving a display name is the caller's business and is
-- governed separately. Copying a name into this result would make it a second place a name can leak
-- from and would go stale the day somebody is renamed.
--
-- A flag never changed has NO ROW here. The screen renders that as "no recorded change" rather than
-- inventing a date -- section 10: unavailable and zero are different states.

create or replace function plat_launch_flag_change_history()
returns table(
  flag         text,
  changed_at   timestamptz,
  actor_id     uuid,
  from_enabled boolean,
  to_enabled   boolean,
  reason       text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (e.payload->>'flag')
    (e.payload->>'flag')::text,
    e.occurred_at,
    e.actor_id,
    (e.payload->>'from')::boolean,
    (e.payload->>'to')::boolean,
    (e.payload->>'reason')::text
  from public.practice_audit_event e
  where e.event_type = 'practice.launch_flag_changed'
    and e.payload ? 'flag'
  order by e.payload->>'flag', e.occurred_at desc
$$;

revoke all on function plat_launch_flag_change_history() from public;

revoke all on function plat_launch_flag_change_history() from anon;

grant execute on function plat_launch_flag_change_history() to service_role;

notify pgrst, 'reload schema';
