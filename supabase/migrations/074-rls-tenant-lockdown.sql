-- 074-rls-tenant-lockdown.sql
-- SECURITY FIX (SSW-XWI-TEST-001, P1): close cross-tenant data exposure on the
-- operational-PHI and competency-outcome tables.
--
-- PROBLEM (migrations 011 / 038 / 039):
--   * op_* tables (038) and op_observations (039) were given
--     `for select to authenticated using (true)` — i.e. ANY signed-in user of
--     ANY tenant can SELECT every row (patients, assignments, escalations,
--     safety alerts, tasks, observations, ...).
--   * competency_decisions (011) "Staff read/write" policies gate on ROLE ONLY
--     with NO tenant predicate — cross-tenant read AND write of competency
--     outcomes.
--   Because the public anon key ships in the browser bundle, any authenticated
--   user could bypass the server API and reach another tenant's data directly
--   via PostgREST. RLS was the only gate for direct access, and it was open.
--
-- WHY THIS FIX IS SAFE (verified against the codebase):
--   The application never reads or writes these tables through the anon key.
--   All data access is server-side via the service-role client
--   (createAdminClient), which BYPASSES RLS, with tenant scoping enforced in
--   code (scope() -> .eq("hospital_id", hid)). The ONLY anon-key/browser reads
--   in the app are on `hospitals` and `profiles`. Dropping the client-reachable
--   policies therefore makes these tables service-role-only (RLS enabled + no
--   policy = deny-all for the anon/authenticated roles) — the SAME secure
--   pattern already used by the newer shift tables (migrations 065-073) — and
--   changes nothing the application relies on.
--
-- Idempotent. Safe to re-run.

-- 1. Operational-PHI tables (038) + clinical observations (039): drop the
--    permissive `using (true)` read policies. RLS stays enabled -> service-role
--    only. (These tables have no client WRITE policy, so writes are already
--    service-role only.)
do $$
declare t text;
begin
  foreach t in array array[
    'op_beds','op_shifts','op_shift_staff','op_patients','op_patient_assignments',
    'op_escalations','op_safety_alerts','op_handovers','op_handover_items','op_tasks',
    'op_observations'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_read on %I', t, t);
  end loop;
end $$;

-- 2. Competency outcomes (011): drop the tenant-less role-only read + write
--    policies. Service-role only henceforth.
alter table competency_decisions enable row level security;
drop policy if exists "Nurse reads own decisions" on competency_decisions;
drop policy if exists "Staff read decisions"      on competency_decisions;
drop policy if exists "Staff write decisions"     on competency_decisions;

-- RESULT: every table above now has RLS ENABLED with NO client policy. The
-- anon/authenticated roles receive zero rows and cannot write; the service-role
-- key used by the server API retains full access. Cross-tenant direct access
-- via the public anon key is closed.
--
-- FOLLOW-UP (not part of this P1 fix — recommend a separate RLS review):
--   * positions (037) still uses `using (true)` (workforce/org structure).
--   * evidence (029) and scheduled_assessments (030) are tenant-scoped and
--     should be re-checked for the same client-policy exposure.
--   Shared platform CONTENT (frameworks, blueprints, curricula, scoring scales,
--   taxonomies, policies, benner_scale) intentionally allows authenticated
--   reads and is NOT changed here.
