-- APPLY THIS FILE WHOLE. It contains policy bodies containing statement separators inside function calls, plus a
-- storage configuration block, and a statement-splitting runner would cut them. Paste the entire file
-- into the Supabase SQL editor and Run once.
--
-- Migration 334: canonical RLS and Storage end state (COMP-ENG-002D, authorised 2026-08-19)
--
-- FORWARD-ONLY. No historical migration is rewritten. This file converges a database built from the
-- numbered chain onto the approved canonical state, and states for each change what it supersedes.
--
-- WHY IT IS NEEDED AT ALL: a clean build replays 005, 007, 008, 009, 039, 109 and 166, which create
-- policies production does not have and should not have. Without this file, staging would differ from
-- production in both directions -- the exact false assurance COMP-ENG-002A section 3 describes.
--
-- ============================ RLS: the 20 MISSING dispositions ============================
--
-- RESTORE (1)   departments :: Group admin reads org departments -- properly org-scoped, genuinely
--               absent, the only one approved for restoration as written.
--               WARNING: it turns on p.role = 'group_admin', a role-name primitive ADR-008 retired.
--               Restored per approved disposition, and flagged as ADR-008 burn-down work, not as settled.
--
-- RETIRE (5)    Cross-tenant exposure. Each is `using (true) to authenticated` with NO tenant
--               predicate -- restoring would expose data across every tenant to any signed-in account.
--               op_observations_read is CLINICAL OBSERVATIONS. Dropped here so a clean build does not
--               recreate what 039/109/166 declare.
--
-- RETIRE (1)    assessments :: Educator validates assessments -- --               assessments, and validation is server-mediated at api/educator/ai-validate with getCaller
--               + isEducator + assertCycleScope + an audit row. Restoring opens an unaudited client
--               write path.
--
-- RETIRE (1)    competency_scores :: Educator views hospital scores (ALL) -- no live counterpart,
--               access is admin-client mediated through the same educator routes, and ALL means
--               restoring would open a client-side WRITE path to competency scores on a role name.
--
-- RETIRE (1)    profiles :: Super admin reads all profiles -- reintroduces the documented RLS
--               recursion -- a profiles policy that queries profiles -- and depends on the super_admin role name.
--               Super-admin reads are service-role mediated, and profiles keeps its 4 live policies.
--
-- RENAME (11)   Migration 009/007 policies renamed in-database and never written back. The legacy name
--               is dropped and the DEPLOYED name recreated with the DEPLOYED body. Bodies below are
--               emitted from the stored expressions Postgres itself holds, not retyped -- twelve hand-copied
--               predicates would be twelve chances to silently alter an authorization rule.
--               WARNING: these encode p.role in (...), which ADR-008 retired. Adopted here because
--               they are the live posture and removing them would break working features. Converting
--               them to capability checks is ADR-008 phase 3 work.
--
-- ============================ Storage: COMP-ENG-002D sections 3-5 ============================
--
-- avatars                PUBLIC read (deliberate: presentation assets), 5 MB, jpeg/png/webp.
--                        SVG excluded -- it can carry active content.
-- practice-attachments   PRIVATE, 25 MB, explicit document/image allowlist. It was previously
--                        UNCONSTRAINED: no size limit and no MIME allowlist at all.
-- evidence               left as measured (private, 50 MB) -- 002D sets no new decision for it.
--
-- Storage POLICIES remain deliberately absent: protected access is server-mediated through the
-- Competen authorization boundary with service-role credentials confined to the server (002D s5).
-- That is the canonical posture, recorded rather than accidental.

-- ---- renamed policies: retire the legacy name, create the deployed one ----
drop policy if exists "Assessor manages evidence" on assessment_evidence;
drop policy if exists "Manage evidence" on assessment_evidence;
create policy "Manage evidence" on assessment_evidence for all
  using (((recorded_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['educator'::text, 'hospital_admin'::text, 'super_admin'::text])))))));
drop policy if exists "View evidence on accessible assessments" on assessment_evidence;
drop policy if exists "View evidence" on assessment_evidence;
create policy "View evidence" on assessment_evidence for select
  using ((EXISTS ( SELECT 1
   FROM ((assessments a
     JOIN competency_cycles cy ON ((cy.id = a.cycle_id)))
     JOIN profiles p ON ((p.id = auth.uid())))
  WHERE ((a.id = assessment_evidence.assessment_id) AND ((cy.nurse_id = auth.uid()) OR (a.assessor_id = auth.uid()) OR (cy.hospital_id = p.hospital_id))))));
drop policy if exists "Assessor manages checklist responses" on checklist_responses;
drop policy if exists "Manage checklist responses" on checklist_responses;
create policy "Manage checklist responses" on checklist_responses for all
  using ((EXISTS ( SELECT 1
   FROM assessments a
  WHERE ((a.id = checklist_responses.assessment_id) AND ((a.assessor_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['educator'::text, 'hospital_admin'::text, 'super_admin'::text]))))))))));
drop policy if exists "Nurse views own competency scores" on competency_scores;
drop policy if exists "Nurse views competency scores" on competency_scores;
create policy "Nurse views competency scores" on competency_scores for select
  using (((EXISTS ( SELECT 1
   FROM competency_cycles c
  WHERE ((c.id = competency_scores.cycle_id) AND (c.nurse_id = auth.uid())))) OR current_user_is_super_admin()));
drop policy if exists "Nurse views own cycle frameworks" on cycle_frameworks;
drop policy if exists "Nurse views cycle frameworks" on cycle_frameworks;
create policy "Nurse views cycle frameworks" on cycle_frameworks for select
  using (((EXISTS ( SELECT 1
   FROM competency_cycles c
  WHERE ((c.id = cycle_frameworks.cycle_id) AND (c.nurse_id = auth.uid())))) OR current_user_is_super_admin()));
drop policy if exists "Nurse views own domain scores" on domain_scores;
drop policy if exists "Nurse views domain scores" on domain_scores;
create policy "Nurse views domain scores" on domain_scores for select
  using (((EXISTS ( SELECT 1
   FROM competency_cycles c
  WHERE ((c.id = domain_scores.cycle_id) AND (c.nurse_id = auth.uid())))) OR current_user_is_super_admin()));
drop policy if exists "Educator manages domain scores" on domain_scores;
drop policy if exists "Hospital staff manages domain scores" on domain_scores;
create policy "Hospital staff manages domain scores" on domain_scores for all
  using (((EXISTS ( SELECT 1
   FROM (competency_cycles c
     JOIN profiles p ON ((p.hospital_id = c.hospital_id)))
  WHERE ((c.id = domain_scores.cycle_id) AND (p.id = auth.uid())))) OR current_user_is_super_admin()));
drop policy if exists "Nurse views own framework scores" on framework_scores;
drop policy if exists "Nurse views framework scores" on framework_scores;
create policy "Nurse views framework scores" on framework_scores for select
  using (((EXISTS ( SELECT 1
   FROM competency_cycles c
  WHERE ((c.id = framework_scores.cycle_id) AND (c.nurse_id = auth.uid())))) OR current_user_is_super_admin()));
drop policy if exists "Educator manages framework scores" on framework_scores;
drop policy if exists "Hospital staff manages framework scores" on framework_scores;
create policy "Hospital staff manages framework scores" on framework_scores for all
  using (((EXISTS ( SELECT 1
   FROM (competency_cycles c
     JOIN profiles p ON ((p.hospital_id = c.hospital_id)))
  WHERE ((c.id = framework_scores.cycle_id) AND (p.id = auth.uid())))) OR current_user_is_super_admin()));
drop policy if exists "Hospital admin manages policies" on policies;
drop policy if exists "hospital admin policies" on policies;
create policy "hospital admin policies" on policies for all
  using (((hospital_id IS NOT NULL) AND current_user_is_hospital_admin_for(hospital_id)));
drop policy if exists "Hospital admin manages workflows" on workflow_templates;
drop policy if exists "hospital admin workflows" on workflow_templates;
create policy "hospital admin workflows" on workflow_templates for all
  using (((hospital_id IS NOT NULL) AND current_user_is_hospital_admin_for(hospital_id)));

-- ---- RETIRE: cross-tenant exposure (5) ----
drop policy if exists access_reviews_read on access_reviews;
drop policy if exists access_review_items_read on access_review_items;
drop policy if exists sod_rules_read on sod_rules;
drop policy if exists adm_profile_read on adm_unit_profile;
drop policy if exists op_observations_read on op_observations;

-- ---- RETIRE: removed product write path (1) ----
drop policy if exists "Educator validates assessments" on assessments;

-- ---- RETIRE: no live counterpart, ALL grant on a role name (1) ----
drop policy if exists "Educator views hospital scores" on competency_scores;

-- ---- RETIRE: RLS recursion + retired role-name primitive (1) ----
drop policy if exists "Super admin reads all profiles" on profiles;

-- ---- RESTORE: the one approved restoration (1) ----
drop policy if exists "Group admin reads org departments" on departments;
create policy "Group admin reads org departments" on departments for select
  using (
    hospital_id in (
      select h.id from hospitals h
      join profiles p on p.id = auth.uid()
      where p.role = 'group_admin' and h.organisation_id = p.organisation_id
    )
  );

-- ---- STORAGE: approved bucket configuration (COMP-ENG-002D sections 3 and 4) ----
-- Bucket rows already exist, so this only sets the approved constraints. It does not create buckets, and it
-- deliberately does not touch `evidence`, for which 002D records no new decision.
update storage.buckets
   set public = true,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

update storage.buckets
   set public = false,
       file_size_limit = 26214400,
       allowed_mime_types = array[
         'application/pdf',
         'image/jpeg', 'image/png', 'image/webp',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       ]
 where id = 'practice-attachments';

notify pgrst, 'reload schema';
