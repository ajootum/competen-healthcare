-- ============================================================
-- MIGRATION 182: COMPETENCY DECISION HISTORY (XWI P2-10, immutability)
--
-- The gap: generateDecisionsForCycle DELETES every decision for the cycle and re-inserts. Re-running a
-- cycle therefore destroys the record that a clinician was ever found not_yet_competent, suspended or in
-- critical failure. In a competency platform that record IS the regulatory artefact -- "competent today"
-- is worth little without "and here is every judgement that led there".
--
-- Measured before building: all 77 live decisions sit at version_num = 1. The column exists, readers
-- order by it, and it has NEVER held a second version -- because the delete removes the row that would
-- have been version 1. The versioning machinery was reducing over a set that could not contain history.
--
-- DESIGN CALL: a separate history table, NOT a superseded_at flag on competency_decisions.
-- The flag is the tidier schema, but ~40 read sites select from competency_decisions and count what they
-- get. Every one of them would need `superseded_at is null`, and the cost of missing a single one is a
-- compliance percentage that is silently wrong -- the same failure class as the duplicate-assessment
-- double-weighting and the revocation-blind gate already fixed in this codebase. A separate table leaves
-- every existing reader exactly as correct as it is today, and history is additive rather than a
-- filter everyone must remember.
--
-- DELIBERATELY NO FOREIGN KEYS. This table exists so a record survives; a cascade from profiles or
-- competency_cycles would delete exactly the history it is here to keep. The ids are plain uuids and a
-- reader joins them when the referent still exists.
--
-- decision_id is uniquely indexed so re-running the archive cannot double-file the same original row; the
-- writer archives with ON CONFLICT DO NOTHING, so an interrupted run (archive committed, delete failed)
-- can be retried instead of deadlocking on its own successful first half. The index is NOT partial --
-- Postgres already treats nulls as distinct, and a predicate would only stop ON CONFLICT inferring it.
--
-- RLS: enabled with NO client policies -- the service-role-only pattern from migration 074. Readers go
-- through the API, which enforces role and tenant scope in code.
--
-- Plain statements, idempotent, no do-blocks, ASCII only.
-- ============================================================

create table if not exists competency_decision_history (
  id                 uuid primary key default gen_random_uuid(),
  decision_id        uuid,
  cycle_id           uuid,
  nurse_id           uuid not null,
  cpu_id             uuid,
  competency_id      uuid,
  framework_id       uuid,
  framework_version  text,
  outcome            text,
  maturity           text,
  decided_by         uuid,
  decided_by_name    text,
  effective_date     date,
  expiry_date        date,
  evidence_summary   text,
  critical_failure   boolean,
  validated_by       uuid,
  validated_at       timestamptz,
  validation_outcome text,
  version_num        integer,
  hospital_id        uuid,
  organisation_id    uuid,
  decided_at         timestamptz,
  superseded_at      timestamptz not null default now(),
  superseded_by      uuid,
  supersede_reason   text
);

create unique index if not exists ux_dechist_decision on competency_decision_history(decision_id);
create index if not exists idx_dechist_nurse_comp on competency_decision_history(nurse_id, competency_id, superseded_at desc);
create index if not exists idx_dechist_cycle      on competency_decision_history(cycle_id, superseded_at desc);
create index if not exists idx_dechist_hospital   on competency_decision_history(hospital_id, superseded_at desc);

alter table competency_decision_history enable row level security;

notify pgrst, 'reload schema';
