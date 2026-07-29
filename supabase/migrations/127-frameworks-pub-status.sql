-- 127 — Competency Studio: frameworks.pub_status column (schema-drift fix)
-- CST-008 Publishing / COMPETEN Studio. `frameworks.pub_status` is read and written across the
-- Studio (studio home attention KPIs studio/page.tsx, src/lib/studio-data.ts, /api/studio/authoring,
-- /api/content/lifecycle) and is inserted by seed-demo-ckcm.sql — but NO migration ever added the
-- column to `frameworks` (migration 011 added pub_status to clinical_practice_units only). The
-- result: the Studio's "Draft / Ready for publication" counts silently resolve to 0. This adds it
-- idempotently and normalises existing rows before applying the lifecycle check.
-- Plain, idempotent statements only (no do-blocks).

alter table frameworks add column if not exists pub_status text default 'draft';

-- Normalise: null or out-of-vocabulary values become 'draft' so the check below cannot reject data.
update frameworks
  set pub_status = 'draft'
  where pub_status is null
     or pub_status not in ('draft','in_review','approved','published','archived');

alter table frameworks drop constraint if exists frameworks_pub_status_check;
alter table frameworks add constraint frameworks_pub_status_check
  check (pub_status in ('draft','in_review','approved','published','archived'));

create index if not exists idx_frameworks_pub_status on frameworks(pub_status);

notify pgrst, 'reload schema';
