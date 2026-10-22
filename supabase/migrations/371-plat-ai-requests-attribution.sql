-- ============================================================
-- 371 -- AI usage log: typed attribution (COMPETEN-AI-LOG-001, PFS-000 section 15, COMP-ARCH-PSA-001)
--
-- plat_ai_requests (migration 055) records one row per server-side AI generation. Its tenant_id is a
-- foreign key to tenants(id). Two products passed ids that are not tenants into it -- Practice its
-- workspace id, the Enterprise copilots profiles.hospital_id -- and the database refused every one of
-- those rows. The application now passes a scoped attribution and writes the id to the right column.
--
-- This file adds the two columns the gateway writes:
--   workspace_id       Practice. FK to practice_workspace(id), on delete set null like tenant_id and
--                      actor_id, so deleting a workspace keeps the usage row.
--   attribution_scope  tenant | workspace | person. Null on rows written before this file, which is
--                      honest: those rows were never classified.
-- tenant_id and its FK to tenants(id) are UNCHANGED. Existing rows are untouched.
--
-- Compatibility: the application ships first and lands rows without these two columns until this file
-- is applied (it retries on PostgREST PGRST204). Applying it switches attribution on with no deploy.
-- Independent of 370: touches only plat_ai_requests and reads practice_workspace (migration 191).
-- RLS posture unchanged: the table stays service-role only (no policies).
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

alter table plat_ai_requests
  add column if not exists workspace_id uuid references practice_workspace(id) on delete set null;

alter table plat_ai_requests
  add column if not exists attribution_scope text
    check (attribution_scope in ('tenant', 'workspace', 'person'));

create index if not exists idx_plat_ai_requests_workspace on plat_ai_requests(workspace_id, created_at desc);

notify pgrst, 'reload schema';
