-- 103-rls-positions-lockdown.sql
-- PW-014 P5 / PW-AC-04 — close the residual cross-tenant read exposure on the workforce-structure tables, the
-- follow-up explicitly noted by migration 074 (which already closed the op_* PHI + competency_decisions P1 hole).
--
-- PROBLEM (migration 037): position_library, position_templates and positions were given
--   `for select to authenticated using (true)` — any signed-in user of ANY tenant could SELECT every tenant's
--   org-structure rows (positions carry hospital_id) directly via the public anon key / PostgREST.
--
-- WHY THIS FIX IS SAFE (verified against the codebase, same rationale as 074):
--   The application never reads these tables through the anon key. Every reader uses the service-role client
--   (createAdminClient), which BYPASSES RLS, with tenant scoping enforced in code (getCaller + scope). Callers:
--   src/app/admin/positions/page.tsx (admin.*), src/app/api/workforce/{positions,position-library,
--   position-templates,assignments}/route.ts, src/app/api/enterprise/people/route.ts — all service-role.
--   Dropping the client-reachable read policies makes these tables RLS-enabled with NO client policy =
--   service-role-only (deny-all for anon/authenticated) — the same secure pattern as the op_* tables post-074.
--   Nothing the application relies on changes.
--
-- NOT changed: benner_scale (010) and other shared platform CONTENT intentionally allow authenticated reads.
-- Idempotent. Safe to re-run.

alter table positions          enable row level security;
alter table position_library   enable row level security;
alter table position_templates enable row level security;

-- Drop the permissive `using (true)` read policies from migration 037 (distinct names per table).
drop policy if exists positions_read on positions;
drop policy if exists poslib_read    on position_library;
drop policy if exists postpl_read    on position_templates;

-- RESULT: positions / position_library / position_templates are RLS-enabled with no client policy →
-- service-role only. Cross-tenant direct read via the public anon key is closed for the workforce-structure
-- tables, completing the 074 lockdown. Primary tenant isolation remains the server scope() layer; this is the
-- defense-in-depth floor PW-AC-04 requires.
