-- ============================================================
-- MIGRATION 190: CODIFY THE DASHBOARD-AUTHORED POLICIES (AND DROP THE THREE THAT ARE WRONG)
--
-- THE PROBLEM IS REPRODUCIBILITY, NOT (MOSTLY) EXPOSURE. The RLS drift audit finds 31 policies live in
-- the database that no migration declares -- authored in the Supabase dashboard at some point and never
-- written back. A rebuild of this database from supabase/migrations would silently not recreate them,
-- and nothing would say so. This migration writes the sound ones into the repo VERBATIM (every predicate
-- below is copied from pg_get_expr output via plat_rls_registry, not retyped from memory) and removes
-- the three that are wrong, so after it applies the drift audit's UNDECLARED count goes 31 -> 0.
--
-- Three treatments, each with its precedent:
--
-- 1. DROPPED: "Admins write" on assessor_authorizations, indicator_measurements and quality_objects.
--    These are command ALL, gated on role ONLY -- no hospital predicate -- over tables that hold tenant
--    rows today (1, 180 and 8 rows with a hospital_id respectively). A hospital_admin of ANY hospital
--    could read and rewrite ANOTHER hospital's assessor authorizations, indicator measurements and
--    quality objects. That is the exact shape migration 176 scoped on competency_assessments. None of
--    the three tables is reachable through the user client (client-usage-audit: eleven user-client
--    tables, none here), so per the migration 189 doctrine the policy serves no application path and is
--    dropped rather than hand-scoped -- deny-by-default fails loudly if a future feature ever needs it.
--
-- 2. NARROWED ALL -> SELECT: the own-row policies on certifications, enrolments and lesson_progress.
--    Their predicate is sound (auth.uid() = user_id) but their command was ALL, which grants
--    INSERT/UPDATE/DELETE too: a user could issue their OWN certifications, enrol themselves, and mark
--    their own lessons complete -- self-attestation on the records this platform exists to make
--    trustworthy. Migration 175 fixed precisely this on competency_scores ("Hospital staff views
--    competency scores" was command ALL, so a nurse could raise her own score). Reads stay; writes are
--    the engine's job through the service role. subscriptions was already SELECT-only and is codified
--    as it stands.
--
-- 3. CODIFIED VERBATIM: the twelve read/write pairs on the master-content tables (quality_* framework
--    family, knowledge_* family, improvement_*, content_responsibilities). None of these tables holds a
--    tenant-owned row (the blanket-policy harness checks exactly this, and keeps checking); the reads
--    are the accepted shared-master-content pattern and the writes are role-gated. They are reproduced
--    exactly -- including the knowledge_* family granting 'educator' where the quality_* family does
--    not, a difference that is clearly deliberate and not this migration's to erase.
--
--    FLAGGED, NOT CHANGED: those write policies let a hospital_admin of any hospital edit SHARED master
--    content (quality frameworks, knowledge objects). Whether master-content authorship should be
--    super_admin-only is a governance question; entrenching the current answer verbatim is what makes
--    the repo truthful, and changing it deserves its own deliberate migration, not a side effect.
--
-- Idempotent: every create is preceded by a guarded drop of the same name.
-- ============================================================

-- -- 1. Role-only writes over tenant rows: dropped (migration 176 shape, migration 189 doctrine) -----

drop policy if exists "Admins write" on assessor_authorizations;
drop policy if exists "Admins write" on indicator_measurements;
drop policy if exists "Admins write" on quality_objects;

-- -- 2. Own-row policies: reads codified, self-attesting writes removed (migration 175 doctrine) -----

drop policy if exists "Users see own certifications" on certifications;
create policy "Users see own certifications" on certifications
  for select using (auth.uid() = user_id);

drop policy if exists "Users see own enrolments" on enrolments;
create policy "Users see own enrolments" on enrolments
  for select using (auth.uid() = user_id);

drop policy if exists "Users see own lesson progress" on lesson_progress;
create policy "Users see own lesson progress" on lesson_progress
  for select using (auth.uid() = user_id);

drop policy if exists "Users see own subscriptions" on subscriptions;
create policy "Users see own subscriptions" on subscriptions
  for select using (auth.uid() = user_id);

-- -- 3. Master-content pairs: codified verbatim ------------------------------------------------------

drop policy if exists "Authenticated read" on content_responsibilities;
create policy "Authenticated read" on content_responsibilities
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on content_responsibilities;
create policy "Admins write" on content_responsibilities
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on improvement_actions;
create policy "Authenticated read" on improvement_actions
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on improvement_actions;
create policy "Admins write" on improvement_actions
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on improvement_objects;
create policy "Authenticated read" on improvement_objects
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on improvement_objects;
create policy "Admins write" on improvement_objects
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on knowledge_links;
create policy "Authenticated read" on knowledge_links
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on knowledge_links;
create policy "Admins write" on knowledge_links
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin', 'educator'])));

drop policy if exists "Authenticated read" on knowledge_objects;
create policy "Authenticated read" on knowledge_objects
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on knowledge_objects;
create policy "Admins write" on knowledge_objects
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin', 'educator'])));

drop policy if exists "Authenticated read" on knowledge_requirements;
create policy "Authenticated read" on knowledge_requirements
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on knowledge_requirements;
create policy "Admins write" on knowledge_requirements
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin', 'educator'])));

drop policy if exists "Authenticated read" on quality_criteria;
create policy "Authenticated read" on quality_criteria
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on quality_criteria;
create policy "Admins write" on quality_criteria
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on quality_domains;
create policy "Authenticated read" on quality_domains
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on quality_domains;
create policy "Admins write" on quality_domains
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on quality_frameworks;
create policy "Authenticated read" on quality_frameworks
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on quality_frameworks;
create policy "Admins write" on quality_frameworks
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on quality_indicators;
create policy "Authenticated read" on quality_indicators
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on quality_indicators;
create policy "Admins write" on quality_indicators
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on quality_object_links;
create policy "Authenticated read" on quality_object_links
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on quality_object_links;
create policy "Admins write" on quality_object_links
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

drop policy if exists "Authenticated read" on quality_standards;
create policy "Authenticated read" on quality_standards
  for select using (auth.uid() is not null);
drop policy if exists "Admins write" on quality_standards;
create policy "Admins write" on quality_standards
  for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = any(array['super_admin', 'hospital_admin'])));

notify pgrst, 'reload schema';
