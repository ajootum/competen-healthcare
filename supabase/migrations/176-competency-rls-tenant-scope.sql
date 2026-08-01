-- ============================================================
-- MIGRATION 176: TENANT-SCOPE THE COMPETENCY ASSESSMENT POLICIES
--
-- Found by reviewing the eleven tables that scripts/client-usage-audit.ts identified as the ONLY ones
-- reached through the user client -- the only places an RLS mistake is reachable by a logged-in person.
-- Five policies on two of them check the caller's ROLE and nothing else:
--
--   competency_assessments  "Assessors see assigned assessments"   SELECT
--                           "Assessors insert assessments"         INSERT
--                           "Assessors update assessments"         UPDATE
--   competency_cycles       "Admins insert cycles"                 INSERT
--                           "Admins update cycles"                 UPDATE
--
-- Each reads, in full: does a profile exist for auth.uid() whose role is one of
-- hospital_admin/super_admin/assessor. There is NO hospital predicate. So an assessor at any hospital
-- could read, create and modify assessment records belonging to EVERY hospital on the platform --
-- competency evidence, which is the thing this system exists to make trustworthy.
--
-- NOT AN ANONYMOUS HOLE: all five call auth.uid(), so a logged-in account is required. competency_cycles
-- holds 28 rows today and competency_assessments is empty, so the cycle write path is live and the
-- assessment read path is latent -- but the assessment INSERT path is live regardless of the table being
-- empty, which is exactly how it would stop being empty.
--
-- SAFE TO NARROW: the only user-client reader of either table is src/app/admin/competencies, and it
-- already filters by `.eq("hospital_id", hospitalId)` and by cycle ids drawn from that same hospital. Its
-- queries are unchanged by this. Every other access is service-role, which bypasses RLS.
--
-- The scoping mirrors the policy on the same table that got it right -- "Admins see hospital cycles" --
-- rather than inventing a rule. competency_assessments has no hospital_id of its own, so it scopes
-- through its cycle. UPDATE policies gain a WITH CHECK as well as a USING, so a row cannot be updated
-- OUT of the caller's hospital.
--
-- Plain statements, idempotent, no do-blocks.
-- ============================================================

-- ── competency_assessments: scope through the cycle ──────────────────────────
drop policy if exists "Assessors see assigned assessments" on competency_assessments;
drop policy if exists competency_assessments_staff_read on competency_assessments;
create policy competency_assessments_staff_read on competency_assessments
  for select to authenticated
  using (
    exists (
      select 1
      from profiles p
      join competency_cycles c on c.id = competency_assessments.cycle_id
      where p.id = auth.uid()
        and p.role = any (array['hospital_admin', 'super_admin', 'assessor'])
        and (p.hospital_id = c.hospital_id or p.role = 'super_admin')
    )
  );

drop policy if exists "Assessors insert assessments" on competency_assessments;
drop policy if exists competency_assessments_staff_insert on competency_assessments;
create policy competency_assessments_staff_insert on competency_assessments
  for insert to authenticated
  with check (
    exists (
      select 1
      from profiles p
      join competency_cycles c on c.id = competency_assessments.cycle_id
      where p.id = auth.uid()
        and p.role = any (array['hospital_admin', 'super_admin', 'assessor'])
        and (p.hospital_id = c.hospital_id or p.role = 'super_admin')
    )
  );

drop policy if exists "Assessors update assessments" on competency_assessments;
drop policy if exists competency_assessments_staff_update on competency_assessments;
create policy competency_assessments_staff_update on competency_assessments
  for update to authenticated
  using (
    exists (
      select 1
      from profiles p
      join competency_cycles c on c.id = competency_assessments.cycle_id
      where p.id = auth.uid()
        and p.role = any (array['hospital_admin', 'super_admin', 'assessor'])
        and (p.hospital_id = c.hospital_id or p.role = 'super_admin')
    )
  )
  with check (
    exists (
      select 1
      from profiles p
      join competency_cycles c on c.id = competency_assessments.cycle_id
      where p.id = auth.uid()
        and p.role = any (array['hospital_admin', 'super_admin', 'assessor'])
        and (p.hospital_id = c.hospital_id or p.role = 'super_admin')
    )
  );

-- ── competency_cycles: it has hospital_id, so scope on it directly ───────────
drop policy if exists "Admins insert cycles" on competency_cycles;
drop policy if exists competency_cycles_admin_insert on competency_cycles;
create policy competency_cycles_admin_insert on competency_cycles
  for insert to authenticated
  with check (
    exists (
      select 1
      from profiles p
      where p.id = auth.uid()
        and p.role = any (array['hospital_admin', 'super_admin', 'assessor'])
        and (p.hospital_id = competency_cycles.hospital_id or p.role = 'super_admin')
    )
  );

drop policy if exists "Admins update cycles" on competency_cycles;
drop policy if exists competency_cycles_admin_update on competency_cycles;
create policy competency_cycles_admin_update on competency_cycles
  for update to authenticated
  using (
    exists (
      select 1
      from profiles p
      where p.id = auth.uid()
        and p.role = any (array['hospital_admin', 'super_admin', 'assessor'])
        and (p.hospital_id = competency_cycles.hospital_id or p.role = 'super_admin')
    )
  )
  with check (
    exists (
      select 1
      from profiles p
      where p.id = auth.uid()
        and p.role = any (array['hospital_admin', 'super_admin', 'assessor'])
        and (p.hospital_id = competency_cycles.hospital_id or p.role = 'super_admin')
    )
  );

notify pgrst, 'reload schema';
