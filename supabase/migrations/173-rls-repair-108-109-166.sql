-- ============================================================
-- MIGRATION 173: TURN RLS BACK ON FOR 13 TABLES THAT NEVER GOT IT
--
-- Found by scripts/rls-drift-audit.ts on its first run, and CONFIRMED EXPLOITABLE rather than assumed:
-- with nothing but the public anon key -- the one that ships in the browser bundle, no login at all --
-- all thirteen tables returned rows. 838 rows of real operational data across KPI values, benchmarks,
-- cost centres, rooms, services, documents and assets. A `profiles` control request in the same run was
-- correctly refused, so the result is the tables, not the test.
--
-- CAUSE: migrations 108 and 109 were TRUNCATED when applied by hand -- a known problem with those two,
-- previously thought to have cost only pa_predictions. It cost the tail of both files: every
-- `enable row level security` and every `create policy` after the cut-off point. Migration 166 is mine
-- and sod_exceptions lost the same way.
--
-- This restores exactly what those migrations intended -- authenticated may read, nobody but the service
-- role may write -- rather than inventing a policy. Names and predicates are copied from the originals so
-- the repo and the database say the same thing afterwards.
--
-- SAFE FOR THE APP: every one of these tables is read through the service-role client (fetchPerformance,
-- fetchAdmin, the access-governance loader), which bypasses RLS. What changes is that the ANON role stops
-- being able to read them.
--
-- Plain statements, idempotent: drop-if-exists then create, no do-blocks.
-- ============================================================

-- Migration 108 (Performance Analytics)
alter table pa_perspectives enable row level security;
alter table pa_kpis enable row level security;
alter table pa_kpi_values enable row level security;
alter table pa_benchmarks enable row level security;
alter table pa_improvement_projects enable row level security;
alter table pa_cost_centres enable row level security;
alter table pa_reports enable row level security;

drop policy if exists pa_perspectives_read on pa_perspectives;
create policy pa_perspectives_read on pa_perspectives for select to authenticated using (true);
drop policy if exists pa_kpis_read on pa_kpis;
create policy pa_kpis_read on pa_kpis for select to authenticated using (true);
drop policy if exists pa_kpi_values_read on pa_kpi_values;
create policy pa_kpi_values_read on pa_kpi_values for select to authenticated using (true);
drop policy if exists pa_benchmarks_read on pa_benchmarks;
create policy pa_benchmarks_read on pa_benchmarks for select to authenticated using (true);
drop policy if exists pa_improve_read on pa_improvement_projects;
create policy pa_improve_read on pa_improvement_projects for select to authenticated using (true);
drop policy if exists pa_cost_read on pa_cost_centres;
create policy pa_cost_read on pa_cost_centres for select to authenticated using (true);
drop policy if exists pa_reports_read on pa_reports;
create policy pa_reports_read on pa_reports for select to authenticated using (true);

-- Migration 109 (Administration & Config)
alter table adm_rooms enable row level security;
alter table adm_services enable row level security;
alter table adm_operational_rules enable row level security;
alter table adm_documents enable row level security;
alter table adm_assets enable row level security;

drop policy if exists adm_rooms_read on adm_rooms;
create policy adm_rooms_read on adm_rooms for select to authenticated using (true);
drop policy if exists adm_services_read on adm_services;
create policy adm_services_read on adm_services for select to authenticated using (true);
drop policy if exists adm_rules_read on adm_operational_rules;
create policy adm_rules_read on adm_operational_rules for select to authenticated using (true);
drop policy if exists adm_docs_read on adm_documents;
create policy adm_docs_read on adm_documents for select to authenticated using (true);
drop policy if exists adm_assets_read on adm_assets;
create policy adm_assets_read on adm_assets for select to authenticated using (true);

-- Migration 166 (Access Governance)
alter table sod_exceptions enable row level security;

drop policy if exists sod_exceptions_read on sod_exceptions;
create policy sod_exceptions_read on sod_exceptions for select to authenticated using (true);

notify pgrst, 'reload schema';
