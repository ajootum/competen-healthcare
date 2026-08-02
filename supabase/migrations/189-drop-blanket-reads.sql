-- ============================================================
-- MIGRATION 189: DROP THE BLANKET READ POLICIES THAT SIT OVER TENANT DATA
--
-- WHAT WAS FOUND. "Any logged-in user reads every row" is written three ways in this database --
-- auth.role() = 'authenticated', auth.uid() IS NOT NULL, and bare `true` on a policy whose roles include
-- PUBLIC. The blanket-policy harness originally matched only the first spelling and reported 38 tables,
-- 9 with a tenant column, none with tenant rows behind them. Matching all three finds 175 tables -- and
-- THIRTY-FOUR of them hold rows that carry a hospital_id today. A logged-in user from any hospital can
-- read every other hospital's administration records, CMO plans, performance KPIs, medication schedules
-- and quality objects, through the ordinary client, with no error anywhere.
--
-- WHY DROP RATHER THAN SCOPE. None of the 34 is reachable through the USER client -- scripts/
-- client-usage-audit.ts walks every `.from()` receiver and finds exactly eleven user-client tables, none
-- of them here. All application access to these 34 goes through the service role, WHICH BYPASSES RLS
-- ENTIRELY, so these policies serve no application path at all; they are pure latent exposure. This
-- platform already runs 141 service-role-only tables as "RLS on, zero policies" and the anon harness
-- proves that category denies everything without a login. Dropping moves these 34 into that proven
-- category. Writing 34 hand-scoped policies instead would add 34 new things that can be wrong, to guard
-- an access path no code uses -- and if a future feature ever reads one of these through the user client,
-- deny-by-default fails LOUDLY (empty result) instead of silently serving other hospitals' rows.
--
-- WHAT IS DELIBERATELY KEPT. assessor_authorizations, indicator_measurements and quality_objects each
-- carry an "Admins write" ALL policy gated on role. Those are not blanket -- they name a role -- so they
-- stay. They ARE role-only (no hospital predicate), the same shape migration 176 scoped on
-- competency_assessments; latent for the same service-role reason, and left for a deliberate pass rather
-- than folded silently into this one.
--
-- skills IS THE SPECIAL CASE: its policy is `true` for PUBLIC, i.e. readable with NO LOGIN AT ALL. That
-- is the exact shape migration 174 fixed on courses, competencies and benner_scale -- this table was
-- missed because it held no rows, and the anon harness can only test tables that have data. The policy is
-- recreated as authenticated-read, matching 174's treatment of its siblings: it is shared master library
-- content, legitimately readable behind a login, not before one.
--
-- Idempotent: every drop is guarded, and the skills recreate is drop-then-create.
-- ============================================================

drop policy if exists "adm_airec_read" on adm_ai_recommendations;
drop policy if exists "adm_assets_read" on adm_assets;
drop policy if exists "adm_auto_read" on adm_automations;
drop policy if exists "adm_changes_read" on adm_changes;
drop policy if exists "adm_config_read" on adm_config_items;
drop policy if exists "adm_deleg_read" on adm_delegations;
drop policy if exists "adm_docs_read" on adm_documents;
drop policy if exists "adm_forms_read" on adm_forms;
drop policy if exists "adm_rules_read" on adm_operational_rules;
drop policy if exists "adm_rooms_read" on adm_rooms;
drop policy if exists "adm_services_read" on adm_services;
drop policy if exists "Authenticated read" on assessor_authorizations;
drop policy if exists "cdp_reminders_read" on cdp_reminders;
drop policy if exists "cmo_accr_read" on cmo_accreditations;
drop policy if exists "cmo_airec_read" on cmo_ai_recommendations;
drop policy if exists "cmo_assign_read" on cmo_assignments;
drop policy if exists "cmo_cert_read" on cmo_certifications;
drop policy if exists "cmo_config_read" on cmo_config;
drop policy if exists "cmo_forecast_read" on cmo_forecasts;
drop policy if exists "cmo_plans_read" on cmo_plans;
drop policy if exists "cmo_priv_read" on cmo_privileges;
drop policy if exists "cmo_pub_read" on cmo_publications;
drop policy if exists "competency_learning_links_read" on competency_learning_links;
drop policy if exists "cls_read" on competency_lifecycle_state;
drop policy if exists "Authenticated read" on indicator_measurements;
drop policy if exists "lce_read" on lifecycle_events;
drop policy if exists "op_med_schedule_read" on op_med_schedule;
drop policy if exists "pa_cost_read" on pa_cost_centres;
drop policy if exists "pa_improve_read" on pa_improvement_projects;
drop policy if exists "pa_kpis_read" on pa_kpis;
drop policy if exists "pa_perspectives_read" on pa_perspectives;
drop policy if exists "pa_pred_read" on pa_predictions;
drop policy if exists "pa_reports_read" on pa_reports;
drop policy if exists "Authenticated read" on quality_objects;

-- skills: anon-readable via `true` on PUBLIC. Narrowed to authenticated, exactly as migration 174 did
-- for courses, competencies and benner_scale.
drop policy if exists "Anyone can view skills" on skills;
create policy "Authenticated users view skills" on skills
  for select using (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
