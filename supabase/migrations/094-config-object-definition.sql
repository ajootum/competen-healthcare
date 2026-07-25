-- ============================================================
-- 094 — Configuration object definition body (NCP builder designers)
-- Adds a generic `definition` jsonb to every registry object so the
-- type-specific no-code designers can persist their body ONTO the governed
-- object: metric formulas + thresholds (NCP-005), form fields (NCP-003),
-- workflow nodes (NCP-004), rule tables (NCP-007), layout canvas (NCP-001).
-- Safe to re-run (IF NOT EXISTS). Paste into the Supabase SQL editor and Run.
-- ============================================================
alter table configuration_registry_objects
  add column if not exists definition jsonb not null default '{}'::jsonb;
