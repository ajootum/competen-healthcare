-- ============================================================
-- MIGRATION 188: RESTORE 19 INDEXES THAT WERE DECLARED BUT NEVER CREATED
--
-- FOUND BY scripts/migration-object-audit.ts, which exists because nothing here had ever asked the
-- database whether a declared TABLE or INDEX arrived. schema-drift compares columns the code reads,
-- function-drift compares function bodies, rls-drift compares policies. Indexes were the gap, and they
-- are the quietest thing to lose: results stay correct, nothing errors, a tenant-filtered query simply
-- starts scanning the table. The only symptom is a page that gets slower as the data grows.
--
-- All 369 declared tables exist. These 19 indexes do not. They come from five migrations, and the pattern
-- says what happened in each case:
--
--   108  ALL NINE indexes missing. Migration 108 was already known to have been truncated on apply -- the
--        loss was recorded as costing its RLS tail. It cut EARLIER than that: the index block sits at
--        lines 120-128 and the `enable row level security` lines at 131-138, so 108 lost both. Its
--        tables and 494 rows of pa_kpi_values are all present and have been queried without these
--        indexes since. This is the one with real data behind it today.
--   109  indexes present, RLS tail missing -- so its cut fell between the two. Already repaired by 173.
--   183, 184, 185  RECENT migrations, same shape: tables created, trailing index block absent. The
--        truncation is not a one-off from last year; it is still happening, which is the argument for
--        this audit running rather than this migration being a tidy-up.
--   014, 105  one each, oldest and unexplained.
--
-- ux_pinned_module IS NOT A PERFORMANCE INDEX. It is UNIQUE on (user_id, workspace, module_key) -- the
-- only thing stopping the same module being pinned twice. Losing it is a correctness gap, not a slow
-- query. It is safe to create now because user_pinned_modules holds zero rows, so there are no existing
-- duplicates for the unique build to trip over. If it ever fails on a re-run, that means duplicates
-- arrived first and must be resolved before the constraint can go back.
--
-- Every definition below is copied VERBATIM from its source migration -- same name, same columns, same
-- order, same partial-index predicate. Retyping one from memory is how an index comes back subtly
-- different from the one the query planner was designed around.
--
-- Plain statements, idempotent (`if not exists` throughout), no do-blocks, ASCII only.
-- ============================================================

-- 014-learning-pathways.sql
create index if not exists idx_pathway_items_pathway on pathway_items(pathway_id);

-- 105-product-portfolio.sql
create index if not exists idx_products_suite on products(suite_id, status);

-- 108-performance-analytics.sql  (all nine -- the truncated block)
create index if not exists idx_pa_persp_hosp on pa_perspectives(hospital_id, sort_order);
create index if not exists idx_pa_kpis_hosp on pa_kpis(hospital_id, status);
create index if not exists idx_pa_kpis_persp on pa_kpis(perspective_id);
create index if not exists idx_pa_kpi_values_kpi on pa_kpi_values(kpi_id, period);
create index if not exists idx_pa_bench_kpi on pa_benchmarks(kpi_id);
create index if not exists idx_pa_improve_hosp on pa_improvement_projects(hospital_id, status);
create index if not exists idx_pa_cost_hosp on pa_cost_centres(hospital_id);
create index if not exists idx_pa_reports_hosp on pa_reports(hospital_id, status);
create index if not exists idx_pa_pred_hosp on pa_predictions(hospital_id, kind);

-- 183-learning-completion-provenance.sql
create index if not exists idx_pathway_items_completion on pathway_items(status, completion_method);
create index if not exists idx_pathway_items_verified on pathway_items(verified_at) where verified_at is not null;

-- 184-clinical-procedures.sql
create index if not exists idx_op_procedures_patient on op_procedures(patient_id, scheduled_for desc);
create index if not exists idx_op_procedures_shift on op_procedures(shift_id, status);
create index if not exists idx_op_procedures_hospital on op_procedures(hospital_id, status, scheduled_for desc);
create index if not exists idx_op_procedures_performer on op_procedures(performed_by, completed_at desc);

-- 185-pinned-modules.sql  (the first of these is the UNIQUE constraint, not a performance index)
create unique index if not exists ux_pinned_module on user_pinned_modules(user_id, workspace, module_key);
create index if not exists idx_pinned_user on user_pinned_modules(user_id, workspace, sort_order);

notify pgrst, 'reload schema';
